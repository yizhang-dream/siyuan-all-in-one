# siyuan-all-in-one Technical Architecture

## 1. Top-Level Structure

```
src/index.ts          → Plugin entry (SiYuan Plugin subclass)
  → src/App.svelte    → Tab shell with 5-tab navigation
```

`index.ts` registers a main tab (`addTab`) and top-bar icon (`addTopBar`). On load it instantiates all stores (CardStore, ConceptStore, MindmapStore, SourceStore, ConversationStore, VectorStore) and mounts `App.svelte`.

`App.svelte` provides the 5-tab layout:
| Tab | Panel | Description |
|-----|-------|-------------|
| 来源库 | `SourceLibrary.svelte` | File/URL/paste/SiYuan doc import, parser registry, vision extraction |
| RAG对话 | `Rag.svelte` | Multi-turn conversation, RAG search, Agent tool-calling |
| 制卡 | `Generate.svelte` / `Review.svelte` / `Browse.svelte` / `Import.svelte` | Card making (manual/AI/occlusion), SM-2/FSRS review, card browsing, import/export |
| 导图 | `Knowledge.svelte` | Concept graph + mindmap views (Phase 4) |
| 设置 | `Settings.svelte` | Provider config, agents, RAG embedding, vision, review params |

Panel switching uses `activeTab` state. Sub-tabs under 制卡 use `activeSubTab`.

## 2. Data Architecture

### Storage Keys (`plugin.loadData / saveData`)
| Key | Content |
|-----|---------|
| `config` | `AppConfig` — providers, model selection, scheduler, agents, RAG embedding config, vision config |
| `cards` | `Card[]` — SM-2/FSRS fields, conceptId, cardType, sourceRefs |
| `concepts` | `ConceptNode[]` + `Relation[]` — concept graph |
| `mindmaps` | `Mindmap[]` — mindmap markdown + metadata |
| `sources` | `SourceRecord[]` — imported documents |
| `chat-sessions.json` | `SessionIndex[]` — lightweight conversation index |
| `sessions/{id}.json` | `ChatMessage[]` — full message history per session (via SiYuan file API) |

### Core Types

- **SourceRecord** (`src/libs/source-store.ts`): type (`file`/`url`/`paste`/`pdf`/`siyuan-doc`), content, contentHash, chunkStatus (`pending`/`done`/`error`), metadata (fileName, url, mimeType, siyuanDocId, pageCount).
- **SourceRef** (`src/libs/types/concept.ts`): polymorphic reference back to evidence — `type` (`source`/`siyuan-doc`/`manual`), `sourceId`, `blockId`, `chunkId`, `quote`, `page`.
- **ConversationSession** (`src/libs/conversation-store.ts`): `SessionIndex` (id, title, messageCount, sourceIds) + `ChatMessage` (role: user/assistant/tool, content, sources, contextDocuments, tool_calls).
- **Card** (`src/libs/types.ts`): question, answer, hint, deck, tags, cardType, conceptId, agentId, SM-2 fields (interval/ease/reps/lapses/due), optional FSRS state (stability/difficulty/retrievability).
- **ConceptNode** / **Relation** (`src/libs/types/concept.ts`): concept title, summary, tags, sourceRefs, cardIds, parent/child/related ids; typed relations with fromId/toId.
- **AgentConfig** (`src/libs/types.ts`): user-defined card generation template with system prompt, language, style, difficulty, tokensPerCard.

## 3. RAG Pipeline

```
chunk → embed → store → query → context injection
```

| Step | File | Description |
|------|------|-------------|
| Chunk | `src/libs/rag/chunker.ts` | `chunkText(text, options)` — sentence-aware slicing with overlap |
| Embed | `src/libs/rag/embedder.ts` | `RagEmbedder` — ONNX pipeline via `@huggingface/transformers` + local model |
| Embed (cloud) | `src/libs/rag/embedder-remote.ts` | `OllamaEmbedder`, `OpenAIEmbedder`, `CustomEmbedder`, `BaiduEmbedder`, `GeminiEmbedder` |
| Store | `src/libs/rag/vector-store.ts` | `VectorStore` — in-memory index with cosine similarity search, persistent via `saveData` |
| Ingest | `src/libs/rag/ingest.ts` | `ingestDocument(store, embedder, sourceRecord)` — chunk + embed + store |
| Query | `src/libs/rag/query.ts` | `ragQuery(text, store, embedder, opts)` → `RagSearchResult[]`; `ragContext(...)` → formatted context string |
| Bridge | `src/libs/rag/rag-bridge.ts` | `buildRagConceptRequest(...)` — creates a pipeline request from RAG context for card generation |

**Embedding providers** (`EmbeddingProviderType`): `builtin` | `ollama` | `siliconflow` | `qwen` | `zhipu` | `hunyuan` | `baidu` | `cohere` | `jina` | `mistral` | `voyage` | `gemini-embed` | `together` | `nomic` | `openai` | `custom`.

## 4. LLM Integration

### Provider System

18 builtin providers in `src/libs/config.ts` (`BUILTIN_PROVIDERS`), each with id, name, baseUrl, apiKey, models list. Users can add custom OpenAI-compatible providers.

`resolveLLMConfig(appConfig, providerId, model)` (`src/libs/llm.ts:99`) resolves provider config → builds chat endpoint URL → returns `LLMConfig`.

Supported protocols:
- **OpenAI-compatible**: `/v1/chat/completions` (default), with `response_format: { type: "json_object" }` for structured output.
- **Gemini**: `/v1beta/models/{model}:generateContent`, uses `systemInstruction` + `generationConfig.responseMimeType`.
- **Anthropic**: `/v1/messages`, system prompt in top-level `system`, no JSON mode (strict prompt-only).
- **Provider-specific endpoints**: GLM (`/chat/completions`), Volcano (`/api/v3/chat/completions`), Volcano coding (`/api/coding/v3/chat/completions`).

### Vision Extraction

`callVisionLLM(appConfig, providerId, model, images)` (`src/libs/llm.ts:408`) sends base64-encoded images to a cloud vision API (default: GLM OCR) with 429 retry logic. Used by `SourceLibrary.svelte` for PDF formula/text extraction.

### Card Generation Pipeline

`runPromptPipeline(sources, options)` (`src/libs/ai/pipeline.ts`) runs 4 steps:
1. **extract-concepts** → `ConceptCandidate[]`
2. **infer-relations** → `RelationCandidate[]`
3. **generate-cards** → `CardCandidate[]`
4. **assign-cards** → cards → concept mapping

Output is not written directly — users confirm candidates first via `confirmPipelineResult()`. Prompts in `src/libs/ai/prompts/`.

Standalone card generation via `generateFlashcards(topic, count, agent, config)` (`src/libs/llm.ts:718`) uses user-defined AgentConfig templates with `{topic}/{count}/{language}` placeholders.

## 5. Agent System

**Tool definitions** in `src/libs/tools.ts`:
- `rag_search` — RAG vector store search
- `sql_query` — SiYuan SQL query
- `get_block_content` — fetch block Markdown by ID
- `create_note` — create note in SiYuan notebook

**Tool loop** in `Rag.svelte` (agent mode):
1. Call LLM with tools available
2. If response has `toolCalls` → execute tools via `executeTool()` → feed results back
3. Repeat until LLM returns no tool calls
4. Save final assistant message with context documents

**Tool selection**: `getEnabledTools(selectedTools)` filters by `ToolConfig.enabled` and overrides `autoApprove`. Config persisted in `AppConfig` via UI in Settings panel.

## 6. File Structure Map

```
src/
├── index.ts                   # Plugin entry: load stores, register tab/topbar
├── App.svelte                 # Tab shell with 5-tab + sub-tab routing
├── panels/
│   ├── SourceLibrary.svelte   # Document import, parser registry, vision extraction
│   ├── Rag.svelte             # RAG conversation + Agent tool-loop
│   ├── Generate.svelte        # Manual/AI/occlusion card creation
│   ├── Review.svelte          # SM-2 / FSRS spaced repetition review
│   ├── Browse.svelte          # Card browsing, editing, concept link
│   ├── Import.svelte          # Import/export (cards, concepts, mindmaps)
│   ├── Knowledge.svelte       # Concept graph + mindmap views
│   ├── Concepts.svelte        # AI pipeline candidate confirmation
│   ├── Mindmap.svelte         # Mindmap rendering and card generation
│   └── Settings.svelte        # Full configuration panel
├── libs/
│   ├── srs.ts                 # SM-2 + FSRS dual scheduler
│   ├── store.ts               # CardStore CRUD, import/export
│   ├── store/concept-store.ts # ConceptNode + Relation CRUD
│   ├── source-store.ts        # SourceRecord CRUD
│   ├── conversation-store.ts  # SessionIndex + ChatMessage persistence
│   ├── llm.ts                 # LLM client, resolveLLMConfig, vision, flashcard gen
│   ├── tools.ts               # Agent tool definitions + executors
│   ├── config.ts              # AppConfig defaults, BUILTIN_PROVIDERS, cleanConfig
│   ├── types.ts               # Card, Provider, AgentConfig, AppConfig
│   ├── types/concept.ts       # ConceptNode, Relation, SourceRef, PipelineResult
│   ├── ai/
│   │   ├── pipeline.ts        # runPromptPipeline (4 steps)
│   │   ├── prompts/           # extract-concepts, infer-relations, generate-cards, assign-cards
│   │   ├── selection.ts       # Candidate filtering + confidence threshold
│   │   └── siyuan-adapters.ts # SiYuan doc → PipelineSource conversion
│   ├── rag/
│   │   ├── chunker.ts         # Text chunking
│   │   ├── embedder.ts        # Builtin ONNX embedder
│   │   ├── embedder-remote.ts # Ollama/OpenAI/Custom/Baidu/Gemini embedders
│   │   ├── embedder-types.ts  # EmbeddingProviderType, EmbeddingConfig
│   │   ├── vector-store.ts    # In-memory vector index + cosine similarity
│   │   ├── ingest.ts          # Document ingestion pipeline
│   │   ├── query.ts           # ragQuery, ragContext, formatRagContext
│   │   └── rag-bridge.ts      # RAG → Concept pipeline bridge
│   ├── sources/
│   │   ├── source-hub.ts      # Unified source collection
│   │   ├── local-file-adapters.ts
│   │   ├── pdf-extractor.ts
│   │   └── web-fetcher.ts
│   ├── parsers/               # ParserRegistry + TxtMdHtml/Pdf/Pandoc/Xlsx/ImageOcr/SiyuanDoc parsers
│   ├── render/
│   │   ├── concept-graph.ts   # Concept graph data structures
│   │   └── concept-mindmap.ts # Mindmap conversion
│   ├── exporters.ts           # Cards/concepts/mindmaps export (JSON/CSV/Markdown)
│   └── importers.ts           # Plugin-native import
└── mindmap/                   # Mindmap rendering utilities
```
