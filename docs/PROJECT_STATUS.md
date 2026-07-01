# siyuan-all-in-one v1.0 — 项目状态概况

> **适用场景**：新 LLM/开发者快速了解项目架构、当前状态、关键文件，无需遍历整个仓库。

---

## 1. 项目身份

| 维度 | 详情 |
|------|------|
| **名称** | siyuan-all-in-one（原 siyuan-flashcards） |
| **定位** | 思源笔记全功能 AI 学习工作台插件 |
| **运行环境** | SiYuan Note Electron 沙箱渲染进程（nodeIntegration: false, sandbox: true） |
| **技术栈** | TypeScript + Svelte 4 + Vite 5（CJS 输出） |
| **仓库** | `C:\Users\zyz\ZCodeProject\siyuan-flashcards\` |
| **部署** | 仅支持 PC 客户端 Electron 环境（Docker/移动端不可用 Pandoc 功能） |
| **入口** | `src/index.ts` — Plugin.onload() 注册 Tab + TopBar |
| **构建** | `npm run build` → `dist/index.js` (~5.3MB / ~1,644KB gzip) + `dist/index.css` (~83KB / ~11KB gzip) |
| **部署** | `Copy-Item dist/* → C:\Users\zyz\SiYuan\data\plugins\siyuan-all-in-one\`（需先 Remove-Item 强制覆盖，SiYuan 会锁定文件） |

---

## 2. 当前 Tab 结构（5 个主 Tab）

```
App.svelte 导航栏 (iconAio* 自嵌 SVG 图标，兼容任意图标包)
├── 📂 来源库 (SourceLibrary.svelte)     — 统一来源数据库 + 导入 + 索引
├── 💬 RAG 对话 (Rag.svelte)             — 会话式 AI 对话 + Agent 工具调用
├── 🃏 制卡 (Generate.svelte 子Tab)      — 4 个子Tab: 制卡|复习|浏览|导入
├── 🧠 导图 (Knowledge.svelte)           — 概念图谱+思维导图（合并面板）
└── ⚙️ 设置 (Settings.svelte)            — 全 Tab 模式（非 Dialog）
```

**已删除**：Stats.svelte、SourcePicker.svelte、Notebook.svelte、Diagnostics.svelte、Models.svelte。OpenNotebook 已从核心代码中移除，`source-refs.ts` 中 `OpenNotebookLocator` 接口已删除，历史数据通过 `index.ts` 的 `migrateRef()` 向后兼容。

---

## 3. 数据架构

### 核心存储（SiYuan saveData/loadData 键）

| 键 | 存储内容 | 管理类 |
|----|----------|--------|
| `cards` | Card[] 闪卡（含 FSRS 调度状态） | CardStore (libs/store.ts) |
| `concepts` | ConceptNode[] 概念图节点 | ConceptStore (libs/store/concept-store.ts) |
| `relations` | Relation[] 概念间关系 | ConceptStore |
| `sources` | SourceRecord[] 导入文档 | SourceStore (libs/source-store.ts) |
| `rag-vectors` | VectorEntry[] 嵌入向量 | VectorStore (libs/rag/vector-store.ts) |
| `source-meta` | { lastEmbeddingHash } 嵌入模型变更检测 | inline |
| `chat-sessions.json` | SessionIndex[] 轻量会话列表 | ConversationStore (libs/conversation-store.ts) |
| `agent-tools-config` | AgentToolsConfig 工具启用状态 | inline in Rag.svelte |
| `config` | AppConfig 全部设置（providers/agents/嵌入/视觉等） | SiYuan 标准 |
| `/data/storage/petal/.../sessions/{id}.json` | 完整消息历史 | ConversationStore（双文件模式） |

### SourceRef 类型（已简化）

```typescript
// 3 种类型：'siyuan-doc' | 'manual' | 'source'
// 旧类型 (opennotebook/file/pdf/url/rag) 已迁移，不再使用
interface SourceRef {
  type: 'siyuan-doc' | 'manual' | 'source';
  sourceId?: string;
  blockId?: string;
  quote?: string;
  page?: number;
}
```

---

## 4. RAG 管道

```
来源库导入 → chunkText (chunker.ts, ~500 token, 10%重叠)
  → embed (embedder.ts, 支持16种Provider)
  → VectorStore.addAll → saveData('rag-vectors')
  → Rag.svelte 查询: ragQuery → cosine(Dot Product) → formatRagContext
  → 注入 LLM 系统提示词 → callLLM
```

### 嵌入模型 Provider（16 种）

- **builtin** — @huggingface/transformers, paraphrase-multilingual-MiniLM-L12-v2 (384维, 118MB ONNX)
- **ollama** — 本地 ollama 服务器
- **siliconflow / qwen / zhipu / hunyuan / baidu** — 中国云嵌入 API
- **cohere / jina / mistral / voyage / gemini-embed / together / nomic** — 国际嵌入 API
- **openai** — OpenAI 嵌入
- **custom** — 自定义 OpenAI 兼容端点

所有非 builtin Provider 复用 `CustomEmbedder` 类。嵌入模型变更时**自动重建全部索引**（带进度条 UI）。

---

## 5. AI/LLM 集成

### Built-in Providers（20+ 个预设）

`libs/config.ts` 中 `BUILTIN_PROVIDERS` 数组。关键 ID：
- deepseek, glm (标准), glm-coding (编程套餐)
- openai, anthropic, gemini
- qwen, hunyuan, stepfun, lingyiwanwu, moonshot, siliconflow
- minimax, volcano, volcano-coding, moonshot-coding
- opencode-zen, opencode-go

### LLM 调用路径

- `libs/llm.ts`: `callLLM()` — 主调用函数，支持 tool_calls 返回 + 流式
- `libs/llm.ts`: `callVisionLLM()` — 视觉 API（PDF 公式提取），OpenAI `image_url` 格式
- `libs/llm.ts`: `resolveLLMConfig()` — 从 Provider baseUrl 构建完整端点

### 视觉提取管道

```
PDF → renderPdfPages (pdf-renderer.ts, canvas) → PNG pages
  → callVisionLLM (cloud API, GLM-4.6v-flash 免费)
  → Store markdown+LaTeX text in SourceStore
```

仅支持云 API（PaddleOCR 已删除，模型无法转换为 ONNX）。PDF 渲染使用 pdfjs-dist v3.11.174 legacy build + sanitizeArrayProto guard（Electron Array.prototype 污染问题）。

---

## 6. Agent 系统

### 工具选择
- ⚙️ 齿轮图标打开工具对话框
- 4 个工具：rag_search, sql_query, get_block_content, create_note
- 工具名中文显示，卡片式布局，已选计数

### Agent 循环（Copilot 模式）

```
while (shouldContinue):
  callLLM(messages, tools) → { content, toolCalls }
  if no toolCalls → break (final answer)
  push { role: 'assistant', tool_calls }
  for each toolCall:
    executeTool → push { role: 'tool', result }
  // loop continues, LLM sees tool results
```

### 工具调用渲染
- 消息中展开式卡片：🔧 调用工具 (N)
- 每个工具：名称 + ◷/✓ + 参数 + 结果（点击展开）

---

## 7. 会话系统

- **ConversationStore** 双文件模式：轻量索引 `chat-sessions.json` + 完整消息 `/data/storage/petal/.../sessions/{id}.json`
- 左侧 240px 会话列表：双击重命名、悬停删除、新建对话
- 自动命名：首条消息前 30 字符
- 多轮对话：发送完整历史给 LLM
- 消息级上下文：每条消息带 `contextDocuments[]`（来源引用）
- 自动保存：send() 完成后 saveData

---

## 8. Markdown 渲染

- 使用 SiYuan 内置 `window.Lute.New().Md2HTML()` 代替 marked
- 支持 callout、blockref、inline math、代码高亮
- XSS 防护：lute.SetSanitize(true)
- 代码块有工具栏 + 复制按钮

---

## 9. 关键文件速查

| 路径 | 用途 | 行数 |
|------|------|------|
| `src/index.ts` | 插件入口 + 生命周期 | ~310 |
| `src/App.svelte` | Tab 导航壳 | ~140 |
| `src/panels/Rag.svelte` | RAG 对话 + Agent + 会话 | ~1600 |
| `src/panels/SourceLibrary.svelte` | 来源库 + 导入 + 索引 | ~1100 |
| `src/panels/Settings.svelte` | 设置面板（超大文件） | ~1330 |
| `src/panels/Generate.svelte` | 制卡面板 | ~500 |
| `src/panels/Concepts.svelte` | 概念图谱 | ~1800 |
| `src/panels/Review.svelte` | 复习面板 | ~400 |
| `src/panels/Browse.svelte` | 浏览面板 | ~400 |
| `src/panels/Import.svelte` | 导入面板 | ~700 |
| `src/panels/Knowledge.svelte` | 导图面板（骨架） | ~30 |
| `src/libs/rag/embedder.ts` | 嵌入引擎（内置 ONNX） | ~160 |
| `src/libs/rag/embedder-remote.ts` | 远程嵌入客户端 | ~200 |
| `src/libs/rag/embedder-builtin.ts` | 内置嵌入适配层 | ~50 |
| `src/libs/rag/embedder-types.ts` | 嵌入接口定义 | ~30 |
| `src/libs/rag/chunker.ts` | 文本切块 | ~230 |
| `src/libs/rag/vector-store.ts` | 向量存储 | ~120 |
| `src/libs/rag/query.ts` | RAG 查询 | ~60 |
| `src/libs/rag/ingest.ts` | 文档摄入 | ~100 |
| `src/libs/llm.ts` | LLM 调用 + vision | ~460 |
| `src/libs/tools.ts` | Agent 工具定义 + 执行器 | ~200 |
| `src/libs/conversation-store.ts` | 会话存储 | ~140 |
| `src/libs/source-store.ts` | 来源存储 | ~85 |
| `src/libs/store.ts` | CardStore + MindmapStore | ~70 |
| `src/libs/store/concept-store.ts` | ConceptStore | ~390 |
| `src/libs/config.ts` | 默认配置 + Provider 预设 | ~220 |
| `src/libs/types.ts` | 全局类型定义 | ~160 |
| `src/libs/types/concept.ts` | 概念类型 | ~90 |
| `src/libs/config-helper.ts` | 全局配置访问器 | ~20 |
| `src/libs/source-refs.ts` | SourceRef 标签/动作 | ~70 |
| `src/libs/ai/pipeline.ts` | AI 流水线（概念抽取） | ~760 |
| `src/libs/sources/source-hub.ts` | 来源聚合入口 | ~170 |
| `src/libs/sources/pdf-extractor.ts` | PDF 文本提取（pdfjs v3） | ~70 |
| `src/libs/pdf-renderer.ts` | PDF → PNG 渲染器 | ~130 |
| `src/libs/parsers/` | 10 个解析器（txt/md/html/pdf/docx/pptx/xlsx/epub/图片/思源文档） | — |
| `src/icons.ts` | 自嵌 SVG 图标集（13 iconAio*） | ~70 |
| `src/stubs/` | Node 原生模块桩（sharp.js, canvas.js） | — |
| `vite.config.ts` | 构建配置（关键：CJS输出, node外部化, ONNX模型复制） | ~100 |

---

## 10. 构建/部署注意事项

1. **SiYuan 锁定文件**：必须 `Remove-Item -Force` 再 `Copy-Item -Force`，普通 Copy-Item 会静默失败
2. **CJS 环境**：`import.meta.url` 在 Vite CJS bundle 中损坏，使用 `eval('require')` 模式加载 Node 内置模块
3. **@huggingface/transformers**：必须 alias 到 `transformers.node.cjs`，外部化所有 Node 内置 + sharp 桩
4. **pdfjs-dist**：使用 v3.11.174 legacy build + worker.entry import + sanitizeArrayProto guard
5. **ONNX 模型**：打包在 `dist/models/` 中，运行时通过 `__dirname` 解析路径
6. **后加载验证**：部署后 `grep index.js` 确认关键代码存在

---

## 11. 已知问题 & 后续计划

| 优先级 | 问题 | 说明 |
|--------|------|------|
| 🔴→✅ | RAG fallback 零向量 | ✅ 已修复：VectorStore.keywordSearch() BM25 兜底 (10864f5) |
| 🔴→✅ | MathJax 与 Lute 冲突 | ✅ 已修复：renderMath() 优先 SiYuan native (db2c073) |
| 🟡→✅ | 解析路径不统一 | ✅ 已修复：source-hub.ts 从 SourceStore 读取 (4fca41d) |
| 🟡→✅ | Agent 无流式 | ✅ 已修复：callLLM SSE 流式 + onChunk 回调 (cb1f5d7) |
| 🟡→✅ | Knowledge.svelte 骨架 | ✅ 已修复：适配器渲染 Concepts/Mindmap (e3af9a9) |
| 🟢→✅ | 文档过时 | ✅ 已修复：README/ARCHITECTURE/TESTING/INSTALL/BACKEND_STRATEGY 重写 |
| 🟢→✅ | test:sources 失败 | ✅ 已修复：5 个测试 fixture 更新 (0a47042) |
| 🟢 | test:source-refs 失败 | 测试仍使用旧 SourceRef 类型 (url/rag/siyuan)，需与 test_source_refs.mjs 同步新合同 (siyuan-doc/manual/source) |
| 🟢 | 残留 OpenNotebook 引用 | package.json/INSTALL.md/TESTING.md/BACKEND_STRATEGY.md/source-refs.ts 已清理，index.ts 保留迁移代码（正确） |

---

## 12. Git 信息

- **当前分支**：main（已合并 feature/unified-source-db）
- **最新 commit**：`ef5d772` — fix: resolve duplicate vars + legacy imports after merge
- **远程**：`https://github.com/yizhang-dream/siyuan-all-in-one.git`

---

*最后更新：2026-06-24*
