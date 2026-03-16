// src/agents/delegating.agent.ts
import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { ChatGroq } from '@langchain/groq';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChartTool } from './chart.tool';
import type { ChartConfig } from './chart.tool';
import { RAGAgent } from './rag.agent';
import type { RagReference } from './rag.agent';

// ─── State definition ────────────────────────────────────────────────────────
const AgentStateAnnotation = Annotation.Root({
  query: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  needsChart: Annotation<boolean>({
    reducer: (_, b) => b,
    default: () => false,
  }),
  needsRAG: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
  chartConfig: Annotation<ChartConfig | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
  ragAnswer: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  ragReferences: Annotation<RagReference[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),
  directAnswer: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  finalAnswer: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  finalData: Annotation<object[]>({ reducer: (_, b) => b, default: () => [] }),
});

type AgentState = typeof AgentStateAnnotation.State;

export interface StreamChunk {
  answer: string;
  data: object[];
}

// ─── Retry + graceful fallback helper ───────────────────────────────────────
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
      const isRateLimit =
        err?.message?.includes('429') || err?.message?.includes('rate limit');
      const isLast = i === retries;
      if (isRateLimit && !isLast) {
        const wait = 10000 + i * 5000;
        console.warn(
          `[LLM] Rate limited. Retrying in ${wait / 1000}s... (attempt ${i + 1}/${retries})`,
        );
        await new Promise((r) => setTimeout(r, wait));
      } else {
        console.warn(
          `[LLM] Fallback triggered. Reason: ${err?.message?.slice(0, 100)}`,
        );
        return fallback;
      }
    }
  }
  return fallback;
}

export class DelegatingAgent {
  private llm: ChatGroq;
  private chartTool: ChartTool;
  private ragAgent: RAGAgent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private graph: any;

  constructor() {
    this.llm = new ChatGroq({
      model: 'llama-3.1-8b-instant', // fast, generous free tier (14,400 req/day)
      apiKey: process.env.GROQ_API_KEY,
    });
    this.chartTool = new ChartTool();
    this.ragAgent = new RAGAgent();
    this.graph = this.buildGraph();
  }

  private buildGraph() {
    // ── Node 1: Router — LLM decides routing (Groq is fast + generous) ───────
    const routerNode = async (state: AgentState) => {
      const fallbackRouting = () => {
        const lower = state.query.toLowerCase();
        return {
          needsChart:
            lower.includes('chart') ||
            lower.includes('graph') ||
            lower.includes('plot') ||
            lower.includes('visual'),
          needsRAG:
            lower.includes('what') ||
            lower.includes('how') ||
            lower.includes('explain') ||
            lower.includes('ai') ||
            lower.includes('deep') ||
            lower.includes('machine') ||
            lower.includes('learning') ||
            lower.includes('data') ||
            lower.includes('intelligence'),
        };
      };

      const text = await invokeLLMWithFallback(
        this.llm,
        [
          new SystemMessage(
            'You are a routing assistant. Given a user query, decide which tools are needed.\n' +
              'Respond ONLY with a valid JSON object — no markdown, no extra text.\n' +
              'Format: {"needsChart": boolean, "needsRAG": boolean}\n' +
              '- needsChart: true if the user wants a chart, graph, or visualization\n' +
              '- needsRAG: true if the user asks a factual question requiring database lookup',
          ),
          new HumanMessage(`User query: "${state.query}"`),
        ],
        JSON.stringify(fallbackRouting()), // fallback = keyword-based JSON string
      );

      let routing = fallbackRouting();
      try {
        const cleaned = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        routing = {
          needsChart: Boolean(parsed.needsChart),
          needsRAG: Boolean(parsed.needsRAG),
        };
      } catch {
        // keep keyword fallback result
      }

      console.log(
        `[Router] needsChart=${routing.needsChart}, needsRAG=${routing.needsRAG}`,
      );
      return routing;
    };

    // ── Node 2: Chart Tool ────────────────────────────────────────────────────
    const chartNode = async (state: AgentState) => {
      const chartConfig = await this.chartTool.run(state.query);
      return { chartConfig };
    };

    // ── Node 3: RAG Agent ─────────────────────────────────────────────────────
    const ragNode = async (state: AgentState) => {
      const result = await this.ragAgent.run(state.query);
      return { ragAnswer: result.answer, ragReferences: result.references };
    };

    // ── Node 4: Direct Answer ─────────────────────────────────────────────────
    const directNode = async (state: AgentState) => {
      const fallback = `I received your query: "${state.query}". Please try again shortly.`;
      const directAnswer = await invokeLLMWithFallback(
        this.llm,
        [
          new SystemMessage(
            'You are a helpful assistant. Answer the user query concisely and accurately.',
          ),
          new HumanMessage(state.query),
        ],
        fallback,
      );
      return { directAnswer };
    };

    // ── Node 5: Aggregator ────────────────────────────────────────────────────
    const aggregatorNode = async (state: AgentState) => {
      const answerParts: string[] = [];
      consrout finalData: object[] = [];

      if (state.directAnswer) answerParts.push(state.directAnswer);

      if (state.ragAnswer) {
        answerParts.push(state.ragAnswer);
        for (const ref of state.ragReferences) {
          finalData.push({
            type: 'reference',
            label: ref.label,
            fileId: ref.fileId,
            pageNumbers: ref.pageNumbers,
          });
        }
      }

      if (state.chartConfig) {
        answerParts.push('Here is the chart configuration for your request.');
        const { type: chartType, ...chartRest } = state.chartConfig;
        finalData.push({ type: 'chartConfig', chartType, ...chartRest });
      }

      return { finalAnswer: answerParts.join(' | '), finalData };
    };

    // ──  Build graph with method chaining ────────
    return new StateGraph(AgentStateAnnotation)
      .addNode('router', routerNode)
      .addNode('chartNode', chartNode)
      .addNode('ragNode', ragNode)
      .addNode('directNode', directNode)
      .addNode('aggregator', aggregatorNode)
      .addEdge(START, 'router')
      .addConditionalEdges(
        'router',
        (state: AgentState): string => {
          if (state.needsChart && state.needsRAG) return 'both';
          if (state.needsChart) return 'chart';
          if (state.needsRAG) return 'rag';
          return 'direct';
        },
        {
          both: 'chartNode',
          chart: 'chartNode',
          rag: 'ragNode',
          direct: 'directNode',
        },
      )
      .addConditionalEdges(
        'chartNode',
        (state: AgentState): string => (state.needsRAG ? 'rag' : 'aggregate'),
        { rag: 'ragNode', aggregate: 'aggregator' },
      )
      .addEdge('ragNode', 'aggregator')
      .addEdge('directNode', 'aggregator')
      .addEdge('aggregator', END)
      .compile();
  }

  // ─── Streaming run ──────
  async *run(query: string): AsyncGenerator<StreamChunk> {
    const initialState: AgentState = {
      query,
      needsChart: false,
      needsRAG: false,
      chartConfig: null,
      ragAnswer: '',
      ragReferences: [],
      directAnswer: '',
      finalAnswer: '',
      finalData: [],
    };

    const stream = this.graph.stream(initialState, { streamMode: 'updates' });
    let lastData: object[] = [];

    for await (const update of await stream) {
      for (const nodeName of Object.keys(update)) {
        const partial = update[nodeName] as Partial<AgentState>;

        if (nodeName === 'ragNode' && partial.ragAnswer) {
          const refData = (partial.ragReferences ?? []).map((ref) => ({
            type: 'reference',
            label: ref.label,
            fileId: ref.fileId,
            pageNumbers: ref.pageNumbers,
          }));
          lastData = [...lastData, ...refData];
          yield { answer: partial.ragAnswer, data: lastData };
        }

        if (nodeName === 'chartNode' && partial.chartConfig) {
          const { type: chartType, ...chartRest } = partial.chartConfig;
          lastData = [
            ...lastData,
            { type: 'chartConfig', chartType, ...chartRest },
          ];
          yield { answer: 'Here is your chart configuration.', data: lastData };
        }

        if (nodeName === 'directNode' && partial.directAnswer) {
          yield { answer: partial.directAnswer, data: [] };
        }

        if (nodeName === 'aggregator' && partial.finalAnswer !== undefined) {
          yield { answer: partial.finalAnswer, data: partial.finalData ?? [] };
        }
      }
    }
  }

  async runFull(query: string): Promise<StreamChunk> {
    let last: StreamChunk = { answer: '', data: [] };
    for await (const chunk of this.run(query)) {
      last = chunk;
    }
    return last;
  }
}
