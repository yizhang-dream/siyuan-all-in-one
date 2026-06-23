# 嵌入模型多 Provider 支持 — 设计规范

**版本**: 1.0
**日期**: 2026-06-22
**状态**: Draft

---

## 1. 动机

当前嵌入层仅支持 `@xenova/transformers` 本地 ONNX 模型（all-MiniLM-L6-v2），存在以下局限：
- 只能用小模型（22MB），无法用更大/更好的嵌入模型
- 无 GPU 加速（WASM only）
- 不支持用户已有基础设施（Ollama、OpenAI 等）

目标：支持四种嵌入方案，用户可自由切换，失败时自动回退到内置模型。

---

## 2. 四种方案

| 方案 | `provider` 值 | 模型来源 | 特征 |
|------|--------------|---------|------|
| 内置 | `builtin` | all-MiniLM-L6-v2 (ONNX) | 零依赖，384维，不可换模型 |
| Ollama | `ollama` | 用户拉取的任何嵌入模型 | 本地 GPU，384-1024维 |
| OpenAI | `openai` | text-embedding-3-small/large | 在线，1536/3072维 |
| 自定义 | `custom` | 用户填入 | 任何 OpenAI 兼容 `/v1/embeddings` |

---

## 3. 数据模型

### 3.1 AppConfig 新增字段

```typescript
interface AppConfig {
  // ... 现有字段保持不变 ...

  /** 嵌入方案选择 */
  ragEmbeddingProvider: 'builtin' | 'ollama' | 'openai' | 'custom';
  /** 嵌入方案配置（内置方案忽略此字段） */
  ragEmbeddingConfig: {
    endpoint: string;   // API 地址，如 http://localhost:11434
    apiKey: string;     // API 密钥（Ollama 留空）
    model: string;      // 模型名，如 all-minilm / text-embedding-3-small
  };
}
```

### 3.2 旧字段处理

| 旧字段 | 处理 |
|--------|------|
| `ragEmbeddingModel: string` | 保留作为兼容，内置方案时仍使用。`embeddingConfig.model` 优先。 |

---

## 4. 实现架构

### 4.1 EmbeddingProvider 接口

```typescript
interface EmbeddingProvider {
  /** 初始化（内置模型加载 ONNX，远程验证连接） */
  initialize(): Promise<void>;
  /** 是否就绪 */
  isReady(): boolean;
  /** 错误信息 */
  getError(): string;
  /** 模型名称 */
  getModelName(): string;
  /** 向量维度 */
  getDimension(): number;
  /** 嵌入文本列表 → 向量列表 */
  embed(texts: string[]): Promise<number[][]>;
}
```

### 4.2 四个实现

| 类 | 对应方案 | 说明 |
|----|---------|------|
| `BuiltinEmbedder` | builtin | 封装现有 `RagEmbedder`，复用 100% 逻辑 |
| `OllamaEmbedder` | ollama | `POST /api/embed`，batch 支持 |
| `OpenAIEmbedder` | openai | `POST /v1/embeddings`，OpenAI SDK 或 fetch |
| `CustomEmbedder` | custom | 同 OpenAI 兼容格式，用户自定义 endpoint |

所有远程实现共享 `RemoteEmbedderBase` 基类（HTTP 调用、错误处理、重试）。

### 4.3 RagEmbedderFacade（现有代码不变）

```typescript
export function getRagEmbedder(config?: AppConfig): EmbeddingProvider {
  switch (config?.ragEmbeddingProvider) {
    case 'ollama':   return new OllamaEmbedder(config.ragEmbeddingConfig);
    case 'openai':   return new OpenAIEmbedder(config.ragEmbeddingConfig);
    case 'custom':   return new CustomEmbedder(config.ragEmbeddingConfig);
    default:         return new BuiltinEmbedder();  // 默认内置
  }
}
```

现有 `RagEmbedder` 类不动——`BuiltinEmbedder` 只是它的适配器。

---

## 5. Settings UI

```
嵌入模型
  ○ 使用内置模型 (all-MiniLM-L6-v2, 384维, 无网络依赖)

  ○ Ollama 本地
      地址: [http://localhost:11434          ]  [获取模型]
      模型: [all-minilm                 ▾    ]  [{状态}]

  ○ OpenAI
      API Key: [sk-...                       ]
      模型:    [text-embedding-3-small  ▾    ]  [获取模型]  [{状态}]

  ○ 自定义 (OpenAI 兼容)
      终端:   [https://your-api/v1           ]  [获取模型]
      Key:    [your-key                      ]
      模型:   [your-model               ▾    ]  [{状态}]
```

**"获取模型"按钮：**

| 方案 | API | 过滤 |
|------|-----|------|
| Ollama | `GET {端点}/api/tags` | 全部列出，标注推荐 `all-minilm`、`nomic-embed-text` |
| OpenAI | `GET https://api.openai.com/v1/models` | 过滤 `text-embedding-*` |
| 自定义 | `GET {端点}/models` | 读取 `data[].id`，也支持手动输入 |

**状态指示器：**
- 选择方案后自动测试连接（或点击测试按钮）
- ✓ 已就绪 / ⏳ 检测中 / ✗ 连接失败（回退内置）

---

## 6. 错误处理与回退

1. 用户选择非内置方案 → 初始化时测试连接
2. 连接失败 → 标记状态为 error，显示错误信息
3. `embed()` 调用失败 → 自动回退到 `BuiltinEmbedder`
4. 保持现有 zero-vector fallback 逻辑

---

## 7. 文件变更

### 新增文件

| 路径 | 说明 |
|------|------|
| `src/libs/rag/embedder-provider.ts` | EmbeddingProvider 接口 |
| `src/libs/rag/embedder-builtin.ts` | BuiltinEmbedder（封装现有 RagEmbedder） |
| `src/libs/rag/embedder-remote.ts` | RemoteEmbedderBase + 三个远程实现 |
| `scripts/test_embedding_providers.mjs` | 测试脚本 |

### 修改文件

| 路径 | 变更 |
|------|------|
| `src/libs/types.ts` | AppConfig 新增 ragEmbeddingProvider + ragEmbeddingConfig |
| `src/libs/types/config.ts` | 同上 |
| `src/libs/config.ts` | DEFAULT_CONFIG 新增默认值 |
| `src/libs/rag/embedder.ts` | `getRagEmbedder()` 签名改为接受 config |
| `src/libs/rag/index.ts` | 导出新类型 |
| `src/panels/Settings.svelte` | 新增嵌入模型选择 UI |
| `src/panels/Rag.svelte` | 传递 config 给 embedder |

### 不修改

- RagEmbedder 类本身（向后兼容）
- vector-store.ts、query.ts、ingest.ts（它们通过 `getRagEmbedder()` 获取，接口不变）
- 现有测试脚本

---

## 8. 非目标

- ❌ 不支持流式嵌入
- ❌ 不实现多 Provider 混合（一次只用一种）
- ❌ 不做嵌入结果缓存策略变更（保持现有 Map 缓存）
- ❌ 不做向量维度自适应（用户需确保所选模型维度与已有向量存储兼容）
