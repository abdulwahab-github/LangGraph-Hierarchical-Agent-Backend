# ShopfloorGPT — LangGraph Hierarchical Agent Backend

A NestJS backend with a **LangGraph**-powered hierarchical agent system, connected to a **Weaviate** vector database with multi-tenancy, and using **Langchain + Google Gemini** for LLM communication.

---

## 📁 Project Structure

```
src/
├── main.ts                        # NestJS bootstrap
├── app.module.ts                  # Root module
├── app.controller.ts              # Health check endpoint
├── app.service.ts                 # App service
│
├── chat/
│   ├── chat.controller.ts         # POST /chat — streaming + JSON response
│   └── chat.module.ts             # Chat module (registers AgentService)
│
├── agents/
│   ├── agent.service.ts           # NestJS injectable wrapper for DelegatingAgent
│   ├── delegating.agent.ts        # ✅ LangGraph StateGraph — core agent hierarchy
│   ├── rag.agent.ts               # ✅ RAG agent — Weaviate + Langchain LLM
│   └── chart.tool.ts              # ✅ Mocked Chart.js config generator
│
└── weaviate/
    ├── weaviate.service.ts        # Weaviate client
    ├── createSchema.ts            # Schema setup (multi-tenancy ENABLED)
    ├── seedData.ts                # Insert 3 seed records
    └── testFetch.ts               # Verify data fetch
```

---

## 🚀 Setup & Run

### 1. Prerequisites
- Node.js 18+
- Docker + Docker Compose
- Google Gemini Free Tier API key → https://aistudio.google.com/app/apikey

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env and set your GEMINI_API_KEY
```

### 4. Start Weaviate in Docker
```bash
docker-compose up -d
# Verify it's running:
curl http://localhost:8080/v1/meta
```

### 5. Create schema (multi-tenancy enabled)
```bash
npm run weaviate:schema
```

### 6. Seed the database
```bash
npm run weaviate:seed
```

### 7. (Optional) Verify data
```bash
npm run weaviate:fetch
```

### 8. Start the NestJS server
```bash
npm run start:dev
# Server runs on http://localhost:3000
```

---

## 🔌 API Usage

### POST /chat

**Request body:**
```json
{ "query": "What is AI?" }
```

#### Mode 1 — Regular JSON response
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is Machine Learning?"}'
```

**Response:**
```json
{
  "answer": "Machine learning is a subset of AI that allows systems to learn from data...",
  "data": [
    {
      "type": "reference",
      "label": "1- Page 5",
      "fileId": "2",
      "pageNumbers": ["5"]
    }
  ]
}
```

#### Mode 2 — Streaming (Server-Sent Events)
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"query": "Show me a chart of AI growth"}'
```

**Streamed events:**
```
data: {"answer":"Here is your chart configuration.","data":[{"type":"chartConfig","type":"bar",...}]}

data: {"answer":"Artificial Intelligence is...", "data":[{"type":"reference","label":"1- Page 3","fileId":"1","pageNumbers":["3"]}]}

data: {"answer":"Here is your chart configuration. | Artificial Intelligence is...","data":[...all data...]}

data: [DONE]
```

---

## 🧠 LangGraph Agent Architecture

```
START
  │
  ▼
┌─────────┐
│ router  │  ← LLM decides: needsChart? needsRAG? neither?
└────┬────┘
     │
     ├─── needsChart only  ──→ [ chartNode ] ──────────────────┐
     │                                                          │
     ├─── needsRAG only    ──→ [ ragNode ]   ──────────────────┤
     │                                                          │
     ├─── both             ──→ [ chartNode ] → [ ragNode ] ─────┤
     │                                                          │
     └─── neither          ──→ [ directNode ] ─────────────────┤
                                                                │
                                                         [ aggregator ]
                                                                │
                                                              END
```

### Nodes
| Node | Responsibility |
|---|---|
| `router` | Calls LLM to classify query — returns `{needsChart, needsRAG}` |
| `chartNode` | Runs `ChartTool.run()` — returns mock Chart.js config |
| `ragNode` | Queries Weaviate (vector search or fetchObjects fallback), calls LLM to synthesise answer |
| `directNode` | Answers directly via LLM when no tools needed |
| `aggregator` | Merges all tool results into final `{answer, data[]}` |

---

## 📋 Response Schema

```typescript
// Streaming chunk / final response — as specified in task
{
  answer: string;   // LLM-generated answer text (streamed incrementally)
  data: object[];   // All reference/chart data objects
}

// Reference data object
{
  type: "reference",
  fileId: "1",
  pageNumbers: ["3"]
}

// Chart data object
{
  type: "chartConfig",
  type: "bar",
  data: { labels: [...], datasets: [...] },
  options: { ... }
}
```

---

## ✅ Task Requirements Checklist

| Requirement | Status |
|---|---|
| Weaviate in Docker | ✅ `docker-compose.yml` |
| Multi-tenancy ENABLED | ✅ `createSchema.ts` |
| fileId (not vectorized/indexed) | ✅ |
| question, answer, pageNumber fields | ✅ |
| 3+ seed entries | ✅ |
| LangGraph agent hierarchy | ✅ `StateGraph` with 5 nodes + edges |
| Delegating Agent routes queries | ✅ LLM-based routing node |
| Chart.js Tool (mocked) | ✅ Returns fixed config |
| RAG Agent queries Weaviate | ✅ vector search + fetchObjects fallback |
| RAG references format "1- Page 3" | ✅ grouped by fileId with index |
| LLM via Langchain | ✅ `ChatGoogleGenerativeAI` |
| Streamed response `{answer, data[]}` | ✅ SSE streaming via `AsyncGenerator` |
| Both tools simultaneously/sequentially | ✅ `both` branch: chartNode → ragNode |
| NestJS backend | ✅ |
| TypeScript | ✅ |
| Proper NestJS DI | ✅ `AgentService` injected into controller |