// src/agents/rag.agent.ts
import { ChatGroq } from '@langchain/groq';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { client } from '../weaviate/weaviate.service';

export interface RagReference {
  label: string;
  fileId: string;
  pageNumbers: string[];
}

export interface RagResult {
  answer: string;
  references: RagReference[];
}

async function invokeLLMWithFallback(
  llm: ChatGroq,
  messages: (SystemMessage | HumanMessage)[],
  fallback: string,
  retries = 2,
): Promise<string> {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await llm.invoke(messages);
      return typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
    } catch (err: any) {
      const isRateLimit = err?.message?.includes('429') || err?.message?.includes('rate limit');
      const isLast = i === retries;
      if (isRateLimit && !isLast) {
        const wait = 10000 + i * 5000;
        console.warn(`[RAG LLM] Rate limited. Retrying in ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        console.warn(`[RAG LLM] Using direct Weaviate answer as fallback.`);
        return fallback;
      }
    }
  }
  return fallback;
}

function scoreRelevance(obj: any, query: string): number {
  const queryLower    = query.toLowerCase().trim();
  const questionLower = (obj.question || '').toLowerCase();
  const answerLower   = (obj.answer || '').toLowerCase();
  let score = 0;

  if (questionLower === queryLower) score += 100;
  if (questionLower.includes(queryLower)) score += 50;

  const topicMatch = questionLower.match(/what is ([^?]+)\??/);
  if (topicMatch) {
    const topic = topicMatch[1].trim();
    if (queryLower.includes(topic)) score += 40;
  }

  const queryWords = queryLower.replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 2);
  const matchedInQuestion = queryWords.filter(w => questionLower.includes(w)).length;
  score += matchedInQuestion * 10;

  const matchedInAnswer = queryWords.filter(w => answerLower.includes(w)).length;
  score += matchedInAnswer * 2;

  return score;
}

export class RAGAgent {
  private llm: ChatGroq;

  constructor() {
    this.llm = new ChatGroq({
      model: 'llama-3.1-8b-instant',
      apiKey: process.env.GROQ_API_KEY,
    });
  }

  async run(query: string): Promise<RagResult> {
    // ─── 1. Fetch from Weaviate ───────────────────────────────────────────────
    let allObjects: any[] = [];

    try {
      const vectorResult = await client.graphql
        .get()
        .withClassName('QAData')
        .withTenant('default')
        .withNearText({ concepts: [query] })
        .withFields('fileId question answer pageNumber _additional { certainty }')
        .withLimit(10)
        .do();
      allObjects = vectorResult.data?.Get?.QAData ?? [];
    } catch {
      try {
        const fetchResult = await client.graphql
          .get()
          .withClassName('QAData')
          .withTenant('default')
          .withFields('fileId question answer pageNumber')
          .withLimit(25)
          .do();
        allObjects = fetchResult.data?.Get?.QAData ?? [];
      } catch (e) {
        console.error('[RAG] Weaviate fetch failed:', e);
      }
    }

    if (allObjects.length === 0) {
      return { answer: 'No relevant data found in the knowledge base.', references: [] };
    }

    // ─── 2. Score and rank objects ────────────────────────────────────────────
    const scored = allObjects
      .map((obj: any) => ({ obj, score: scoreRelevance(obj, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    console.log('[RAG] Scores:', scored.map(s => ({
      question: s.obj.question, score: s.score,
    })));

    let relevantObjects: any[] = [];
    if (scored.length > 0) {
      const topScore = scored[0].score;
      relevantObjects = scored
        .filter(({ score }) => score >= topScore - 20)
        .map(({ obj }) => obj);
    }

    // ─── 3. If NOTHING scored → query is unrelated to knowledge base ─────────
    // Return answer with NO references immediately
    if (relevantObjects.length === 0) {
      console.log(`[RAG] Query "${query}" has no relevant matches — returning no references`);
      const noContextAnswer = await invokeLLMWithFallback(
        this.llm,
        [
          new SystemMessage('You are a helpful assistant.'),
          new HumanMessage(
            `The user asked: "${query}"\n\n` +
            `Our knowledge base only contains information about AI, Machine Learning, and Deep Learning.\n` +
            `Politely tell the user their query is outside our knowledge base scope.`
          ),
        ],
        `I'm sorry, I don't have information about "${query}" in the knowledge base.`,
      );
      return { answer: noContextAnswer, references: [] }; // ✅ NO references
    }

    console.log(`[RAG] Query: "${query}" | Fetched: ${allObjects.length} | Relevant: ${relevantObjects.length}`);

    // ─── 4. Build context from relevant objects ───────────────────────────────
    const directAnswer = relevantObjects.map((obj: any) => obj.answer).filter(Boolean).join(' | ');

    const context = relevantObjects
      .map((obj: any, idx: number) =>
        `[Source ${idx + 1} | fileId: ${obj.fileId} | page: ${
          Array.isArray(obj.pageNumber) ? obj.pageNumber.join(', ') : obj.pageNumber
        }]\nQ: ${obj.question}\nA: ${obj.answer}`,
      )
      .join('\n\n');

    // ─── 5. Call LLM with structured JSON response ────────────────────────────
    const rawResponse = await invokeLLMWithFallback(
      this.llm,
      [
        new SystemMessage(
          'You are a helpful assistant. Answer using ONLY the provided context.\n' +
          'Respond ONLY with valid JSON — no markdown, no extra text.\n' +
          'Format: {"contextUsed": boolean, "answer": string}\n' +
          '- contextUsed: true if context is relevant to the query\n' +
          '- contextUsed: false if the query is unrelated to the context\n' +
          '- answer: your response to the user',
        ),
        new HumanMessage(`Context:\n${context}\n\nUser Query: ${query}`),
      ],
      JSON.stringify({ contextUsed: true, answer: directAnswer }),
    );

    // ─── 6. Parse LLM response ────────────────────────────────────────────────
    let contextUsed = true;
    let answer = directAnswer;

    try {
      const parsed = JSON.parse(rawResponse.replace(/```json|```/g, '').trim());
      contextUsed = Boolean(parsed.contextUsed);
      answer = String(parsed.answer || directAnswer);
    } catch {
      // JSON parse failed — use raw text and detect from keywords
      answer = rawResponse;
      const lower = rawResponse.toLowerCase();
      contextUsed = !['unable', 'cannot find', 'not able', 'no information',
        'not found', 'not mentioned', 'not in the context', 'not provided',
        'outside', 'not available', "don't have", "i don't"].some(p => lower.includes(p));
    }

    // ─── 7. Build references ONLY if context was actually used ────────────────
    const fileIdOrder: string[] = [];
    const groupedByFileId = new Map<string, string[]>();

    if (contextUsed) {
      for (const obj of relevantObjects) {
        const fid = String(obj.fileId);
        const pages: string[] = Array.isArray(obj.pageNumber)
          ? obj.pageNumber : [String(obj.pageNumber)];

        if (!groupedByFileId.has(fid)) {
          groupedByFileId.set(fid, []);
          fileIdOrder.push(fid);
        }
        const existing = groupedByFileId.get(fid)!;
        for (const p of pages) {
          if (!existing.includes(p)) existing.push(p);
        }
      }
    }

    const references: RagReference[] = fileIdOrder.map((fid, idx) => {
      const pages = groupedByFileId.get(fid)!;
      return {
        label: `${idx + 1}- ${pages.map((p) => `Page ${p}`).join(', ')}`,
        fileId: fid,
        pageNumbers: pages,
      };
    });

    console.log(`[RAG] contextUsed=${contextUsed} | references=${references.length}`);

    return { answer, references }; // ✅ references is [] when contextUsed=false
  }
}