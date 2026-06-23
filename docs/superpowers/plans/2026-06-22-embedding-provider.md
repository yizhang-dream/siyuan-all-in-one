# 嵌入模型多 Provider — 实现计划

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 支持四种嵌入方案（内置/Ollama/OpenAI/自定义），Settings 中可切换，失败自动回退内置。

**Architecture:** EmbeddingProvider 接口 + 4 实现类 → RagEmbedderFacade 分发 → 现有代码零改动。

**Tech Stack:** TypeScript + @xenova/transformers（已有）+ fetch API

**参考 spec:** `docs/superpowers/specs/2026-06-22-embedding-provider-design.md`

**Worktree:** `C:\Users\zyz\ZCodeProject\siyuan-flashcards\.worktrees\unified-source-db`

---

## 文件结构

### 新增文件 (3)
```
src/libs/rag/
├── embedder-types.ts          # EmbeddingProvider 接口 + EmbeddingConfig 类型
├── embedder-builtin.ts        # BuiltinEmbedder（封装 RagEmbedder）
└── embedder-remote.ts         # RemoteEmbedderBase + Ollama/OpenAI/Custom
scripts/
└── test_embedding_providers.mjs
```

### 修改文件 (5)
```
src/libs/types.ts               # AppConfig 新字段
src/libs/types/config.ts        # 同上
src/libs/config.ts              # DEFAULT_CONFIG
src/libs/rag/embedder.ts        # getRagEmbedder() 签名
src/panels/Settings.svelte      # UI
```

---

## Task 1: 数据层 — 类型 + Config + 接口

### Task 1.1: 创建 EmbeddingProvider 接口

**Files:**
- Create: `src/libs/rag/embedder-types.ts`

- [ ] **Step 1: 写入接口文件**

```typescript
/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 嵌入模型 Provider 接口 + 配置类型。
 */

/** 嵌入模型方案 */
export type EmbeddingProviderType = 'builtin' | 'ollama' | 'openai' | 'custom';

/** 嵌入方案配置 */
export interface EmbeddingConfig {
    endpoint: string;
    apiKey: string;
    model: string;
}

/** 嵌入 Provider 接口 */
export interface EmbeddingProvider {
    initialize(): Promise<void>;
    isReady(): boolean;
    getError(): string;
    getModelName(): string;
    getDimension(): number;
    embed(texts: string[]): Promise<number[][]>;
}

/** 默认维度（内置 all-MiniLM-L6-v2） */
export const DEFAULT_EMBEDDING_DIM = 384;
```

### Task 1.2: 更新 AppConfig 类型

**Files:**
- Modify: `src/libs/types.ts`（AppConfig 接口末尾）
- Modify: `src/libs/types/config.ts`（同上）

- [ ] **Step 1: 在 types.ts 的 AppConfig 中添加字段（ragChunkOverlap 之后）**

```typescript
    // ── 嵌入模型 ────────────────────────
    /** 嵌入方案选择 */
    ragEmbeddingProvider: EmbeddingProviderType;
    /** 嵌入方案配置（内置方案忽略） */
    ragEmbeddingConfig: { endpoint: string; apiKey: string; model: string; };
```

- [ ] **Step 2: 在 types.ts 顶部添加 import**

```typescript
import type { EmbeddingProviderType } from './rag/embedder-types';
```

- [ ] **Step 3: 同样修改 `src/libs/types/config.ts`**

- [ ] **Step 4: 更新 DEFAULT_CONFIG（config.ts）**

```typescript
// 在 ragTopK 之后：
ragEmbeddingProvider: 'builtin',
ragEmbeddingConfig: { endpoint: '', apiKey: '', model: '' },
```

---

## Task 2: Provider 实现

### Task 2.1: BuiltinEmbedder（封装现有逻辑）

**Files:**
- Create: `src/libs/rag/embedder-builtin.ts`

```typescript
/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 内置嵌入方案：@xenova/transformers ONNX 运行时。
 */
import { RagEmbedder } from './embedder';
import type { EmbeddingProvider } from './embedder-types';

export class BuiltinEmbedder implements EmbeddingProvider {
    private inner: RagEmbedder;

    constructor(modelName?: string) {
        this.inner = new RagEmbedder(modelName);
    }

    async initialize(): Promise<void> {
        await this.inner.initialize();
    }

    isReady(): boolean { return this.inner.isReady(); }
    getError(): string { return this.inner.getError(); }
    getModelName(): string { return this.inner.getModelName(); }
    getDimension(): number { return 384; }

    async embed(texts: string[]): Promise<number[][]> {
        return this.inner.embed(texts);
    }
}
```

### Task 2.2: RemoteEmbedder（Ollama/OpenAI/Custom）

**Files:**
- Create: `src/libs/rag/embedder-remote.ts`

```typescript
/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 远程嵌入方案：Ollama / OpenAI / 自定义。
 */
import type { EmbeddingProvider, EmbeddingConfig } from './embedder-types';

/** 远程 Provider 基类 */
abstract class RemoteEmbedderBase implements EmbeddingProvider {
    protected config: EmbeddingConfig;
    protected ready = false;
    protected error = '';
    protected dimension = 384;

    constructor(config: EmbeddingConfig) {
        this.config = config;
    }

    abstract getEndpoint(): string;
    abstract buildBody(texts: string[]): any;
    abstract getHeaders(): Record<string, string>;

    getModelName(): string { return this.config.model; }
    getDimension(): number { return this.dimension; }
    isReady(): boolean { return this.ready; }
    getError(): string { return this.error; }

    async initialize(): Promise<void> {
        try {
            // 用单次 embed 测试连接
            const vec = await this.testConnection();
            this.dimension = vec.length;
            this.ready = true;
            this.error = '';
        } catch (err: any) {
            this.error = err?.message || String(err);
            this.ready = false;
        }
    }

    /** 单次测试请求，返回向量以获取维度 */
    private async testConnection(): Promise<number[]> {
        const results = await this.embed(['test']);
        return results[0];
    }

    async embed(texts: string[]): Promise<number[][]> {
        try {
            const body = this.buildBody(texts);
            const resp = await fetch(this.getEndpoint(), {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(body),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
            return this.parseResponse(await resp.json());
        } catch (err: any) {
            this.error = err?.message || String(err);
            throw err;  // 上层回退到内置
        }
    }

    abstract parseResponse(json: any): number[][];
}

/** Ollama (@xenova 本地) */
export class OllamaEmbedder extends RemoteEmbedderBase {
    getEndpoint(): string {
        return `${this.config.endpoint.replace(/\/$/, '')}/api/embed`;
    }
    getHeaders(): Record<string, string> {
        return { 'Content-Type': 'application/json' };
    }
    buildBody(texts: string[]): any {
        return { model: this.config.model, input: texts };
    }
    parseResponse(json: any): number[][] {
        return json.embeddings as number[][];
    }
}

/** OpenAI */
export class OpenAIEmbedder extends RemoteEmbedderBase {
    getEndpoint(): string {
        return 'https://api.openai.com/v1/embeddings';
    }
    getHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
        };
    }
    buildBody(texts: string[]): any {
        return { model: this.config.model, input: texts };
    }
    parseResponse(json: any): number[][] {
        return json.data.map((d: any) => d.embedding as number[]);
    }
}

/** 自定义 (OpenAI 兼容) */
export class CustomEmbedder extends RemoteEmbedderBase {
    getEndpoint(): string {
        return `${this.config.endpoint.replace(/\/$/, '')}/v1/embeddings`;
    }
    getHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        return headers;
    }
    buildBody(texts: string[]): any {
        return { model: this.config.model, input: texts };
    }
    parseResponse(json: any): number[][] {
        return json.data.map((d: any) => d.embedding as number[]);
    }
}
```

> **注意：** `testConnection()` 会触发一次真实 embed 调用。Ollama 第一次需要下载模型，可能超时。后续任务的 Settings UI 中应显示加载状态。可考虑在 initialize 中用更轻量的测试（如 GET /api/tags for Ollama），但使用实际 embed 调用更可靠。

---

## Task 3: RagEmbedder 适配层

### Task 3.1: 更新 getRagEmbedder 支持多 Provider

**Files:**
- Modify: `src/libs/rag/embedder.ts`

在文件末尾（`resetRagEmbedder()` 之后）添加：

```typescript
import { BuiltinEmbedder } from './embedder-builtin';
import { OllamaEmbedder, OpenAIEmbedder, CustomEmbedder } from './embedder-remote';
import type { EmbeddingProvider } from './embedder-types';
import type { AppConfig } from '../types';

let _providerInstance: EmbeddingProvider | null = null;

export function getRagEmbedderProvider(config?: Partial<AppConfig>): EmbeddingProvider {
    if (_providerInstance) return _providerInstance;

    const provider = config?.ragEmbeddingProvider || 'builtin';
    const ecfg = config?.ragEmbeddingConfig || { endpoint: '', apiKey: '', model: '' };

    switch (provider) {
        case 'ollama':   _providerInstance = new OllamaEmbedder(ecfg); break;
        case 'openai':   _providerInstance = new OpenAIEmbedder(ecfg); break;
        case 'custom':   _providerInstance = new CustomEmbedder(ecfg); break;
        default:         _providerInstance = new BuiltinEmbedder(); break;
    }

    return _providerInstance;
}

export function resetEmbeddingProvider(): void {
    _providerInstance = null;
}
```

保持原有 `getRagEmbedder()` 和 `RagEmbedder` 类不变（旧的调用方仍可用）。

---

## Task 4: Settings UI

### Task 4.1: 嵌入模型选择区域

**Files:**
- Modify: `src/panels/Settings.svelte`

在 script 部分（现有 `ragEmbeddingModel` 变量附近）：

```typescript
import type { EmbeddingProviderType, EmbeddingConfig } from '../libs/rag/embedder-types';

// 嵌入模型
let embeddingProvider: EmbeddingProviderType = 'builtin';
let embeddingEndpoint = '';
let embeddingApiKey = '';
let embeddingModel = '';
let embeddingModelList: string[] = [];
let embeddingLoading = false;
let embeddingStatus: 'idle' | 'testing' | 'ready' | 'error' = 'idle';
let embeddingErrorMessage = '';

function onEmbeddingProviderChange() {
    embeddingStatus = 'idle';
    embeddingModelList = [];
    // 设置默认值
    if (embeddingProvider === 'builtin') {
        embeddingModel = 'all-MiniLM-L6-v2';
    } else if (embeddingProvider === 'ollama') {
        embeddingEndpoint = embeddingEndpoint || 'http://localhost:11434';
        embeddingModel = embeddingModel || 'all-minilm';
    } else if (embeddingProvider === 'openai') {
        embeddingModel = embeddingModel || 'text-embedding-3-small';
    }
}
```

在 onMount 中加载：

```typescript
embeddingProvider = config.ragEmbeddingProvider || 'builtin';
embeddingEndpoint = config.ragEmbeddingConfig?.endpoint || '';
embeddingApiKey = config.ragEmbeddingConfig?.apiKey || '';
embeddingModel = config.ragEmbeddingConfig?.model || '';
```

在 save() 中保存：

```typescript
ragEmbeddingProvider: embeddingProvider,
ragEmbeddingConfig: {
    endpoint: embeddingEndpoint,
    apiKey: embeddingApiKey,
    model: embeddingModel,
},
```

**获取模型函数：**

```typescript
async function fetchEmbeddingModels() {
    embeddingLoading = true;
    embeddingModelList = [];
    try {
        if (embeddingProvider === 'ollama') {
            const resp = await fetch(`${embeddingEndpoint.replace(/\/$/, '')}/api/tags`);
            const json = await resp.json();
            embeddingModelList = (json.models || []).map((m: any) => m.name);
        } else if (embeddingProvider === 'openai') {
            const resp = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${embeddingApiKey}` },
            });
            const json = await resp.json();
            embeddingModelList = (json.data || [])
                .filter((m: any) => m.id.startsWith('text-embedding-'))
                .map((m: any) => m.id);
        } else if (embeddingProvider === 'custom') {
            const resp = await fetch(`${embeddingEndpoint.replace(/\/$/, '')}/models`, {
                headers: embeddingApiKey ? { 'Authorization': `Bearer ${embeddingApiKey}` } : {},
            });
            const json = await resp.json();
            embeddingModelList = (json.data || []).map((m: any) => m.id);
        }
    } catch (err: any) {
        embeddingErrorMessage = err.message;
    }
    embeddingLoading = false;
}
```

**模板：** 在现有 RAG 设置区域最后（`ragEmbeddingModel` 输入框之后）添加：

```svelte
<div class="feature-block">
    <h3>嵌入模型</h3>

    <label class="b3-label">
        <span class="b3-label__text">方案选择</span>
        <select class="b3-select" bind:value={embeddingProvider} on:change={onEmbeddingProviderChange}>
            <option value="builtin">内置 (all-MiniLM-L6-v2, 384维)</option>
            <option value="ollama">Ollama 本地</option>
            <option value="openai">OpenAI</option>
            <option value="custom">自定义 (OpenAI 兼容)</option>
        </select>
    </label>

    {#if embeddingProvider !== 'builtin'}
        <label class="b3-label">
            <span class="b3-label__text">
                {embeddingProvider === 'ollama' ? '地址' : 'API 终端'}
            </span>
            <input class="b3-text-field" type="text" bind:value={embeddingEndpoint}
                placeholder={embeddingProvider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'} />
        </label>

        {#if embeddingProvider !== 'ollama'}
            <label class="b3-label">
                <span class="b3-label__text">API Key</span>
                <input class="b3-text-field" type="password" bind:value={embeddingApiKey}
                    placeholder={embeddingProvider === 'openai' ? 'sk-...' : 'your-key'} />
            </label>
        {/if}

        <label class="b3-label">
            <span class="b3-label__text">模型</span>
            <div class="embedding-model-row">
                {#if embeddingModelList.length > 0}
                    <select class="b3-select" bind:value={embeddingModel}>
                        {#each embeddingModelList as m}
                            <option value={m}>{m}</option>
                        {/each}
                    </select>
                {:else}
                    <input class="b3-text-field" type="text" bind:value={embeddingModel}
                        placeholder={embeddingProvider === 'ollama' ? 'all-minilm' : embeddingProvider === 'openai' ? 'text-embedding-3-small' : 'model-name'} />
                {/if}
                <button class="b3-button b3-button--small" on:click={fetchEmbeddingModels} disabled={embeddingLoading}>
                    {embeddingLoading ? '获取中...' : '获取模型'}
                </button>
                {#if embeddingStatus === 'ready'}
                    <span class="embedding-status ready">✓ 已就绪</span>
                {:else if embeddingStatus === 'error'}
                    <span class="embedding-status error">✗ {embeddingErrorMessage}</span>
                {/if}
            </div>
        </label>
    {/if}
</div>
```

**CSS：**

```scss
.embedding-model-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.embedding-model-row .b3-select,
.embedding-model-row .b3-text-field {
    flex: 1;
}
.embedding-status {
    font-size: var(--aio-fs-sm);
    white-space: nowrap;
}
.embedding-status.ready {
    color: var(--b3-card-success-color);
}
.embedding-status.error {
    color: var(--b3-card-error-color);
}
```

> **注意：** Settings.svelte 有 `showAsTab` 和 `{:else}` 两个分支。上面的模板需要在**两个分支**中都添加。推荐把嵌入模型 UI 抽取为独立函数或组件，避免重复。

---

## Task 5: 测试 + 构建 + 部署

### Task 5.1: 编写测试

**Files:**
- Create: `scripts/test_embedding_providers.mjs`

```javascript
// 测试嵌入 Provider 类型切换 + 配置序列化
import { execSync } from 'child_process';
import { existsSync } from 'fs';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ✗ ${name}: ${e.message}`);
    }
}

console.log('test:embedding-providers\n');

// 1. 编译检查：新文件存在
test('embedder-types.ts exists', () => {
    if (!existsSync('src/libs/rag/embedder-types.ts'))
        throw new Error('file not found');
});
test('embedder-builtin.ts exists', () => {
    if (!existsSync('src/libs/rag/embedder-builtin.ts'))
        throw new Error('file not found');
});
test('embedder-remote.ts exists', () => {
    if (!existsSync('src/libs/rag/embedder-remote.ts'))
        throw new Error('file not found');
});

// 2. TypeScript 编译
test('tsc passes', () => {
    execSync('npx tsc --noEmit', { cwd: '../../', stdio: 'pipe' });
});

// 3. 配置默认值验证
test('DEFAULT_CONFIG has embedding fields', () => {
    // 通过 require 检查 bundle
    const config = require('../src/libs/config');
    const def = config.DEFAULT_CONFIG;
    if (!('ragEmbeddingProvider' in def)) throw new Error('missing ragEmbeddingProvider');
    if (!('ragEmbeddingConfig' in def)) throw new Error('missing ragEmbeddingConfig');
});

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);
```

### Task 5.2: 构建 + 部署

- [ ] `npm run build`
- [ ] 强制删除旧部署文件：`Remove-Item -Force -LiteralPath "C:\Users\zyz\SiYuan\data\plugins\siyuan-all-in-one\*"`
- [ ] 复制新文件：`Copy-Item dist\* → SiYuan plugin dir`
- [ ] 验证部署：检查 `index.js` 包含 `embedder-remote` 相关代码

---

## 任务汇总

| # | 任务 | 文件 |
|---|------|------|
| 1.1 | embedder-types.ts | 新增 |
| 1.2 | AppConfig 字段 | 修改 types.ts + config.ts ×2 |
| 2.1 | BuiltinEmbedder | 新增 embedder-builtin.ts |
| 2.2 | RemoteEmbedder ×3 | 新增 embedder-remote.ts |
| 3.1 | getRagEmbedderProvider | 修改 embedder.ts |
| 4.1 | Settings UI | 修改 Settings.svelte |
| 5.1 | 测试 | 新增 test_embedding_providers.mjs |
| 5.2 | 构建部署 | — |
