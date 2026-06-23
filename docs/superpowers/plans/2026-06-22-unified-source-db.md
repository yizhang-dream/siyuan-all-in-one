# 统一来源数据库 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立统一来源数据库（SourceStore），所有外部内容在「来源库」Tab 一次性导入 → 自动 RAG 索引 → 所有面板直接读取；同时重组 UI 为 5 个顶级 Tab + 子 Tab。

**Architecture:** 分五阶段：Phase 1 数据层（SourceStore + 解析器注册表），Phase 2 来源库 UI，Phase 3 Tab 重组（5 Tab + 子 Tab + 合并导图），Phase 4 面板改造（移除分散的导入 UI、增加来源选择器），Phase 5 集成测试与清理。

**Tech Stack:** TypeScript + Svelte 4 + SiYuan Plugin API（`loadData/saveData`），新增 `xlsx` + `tesseract.js`

**参考 spec:** `docs/superpowers/specs/2026-06-22-unified-source-db-design.md`

---

## 文件结构总览

### 新增文件（12 个）
```
src/libs/
├── source-store.ts            # SourceStore 类
├── parsers/
│   ├── types.ts               # SourceFileParser 接口 + ParseResult
│   ├── registry.ts            # ParserRegistry 注册表
│   ├── txt-md-html-parser.ts  # TXT/MD/HTML 解析
│   ├── pdf-parser.ts          # pdfjs-dist 封装
│   ├── pandoc-parser.ts       # SiYuan Pandoc API 封装
│   ├── xlsx-parser.ts         # SheetJS 封装
│   ├── image-ocr-parser.ts    # tesseract.js 封装
│   └── siyuan-doc-parser.ts   # 思源文档读取
src/panels/
├── SourceLibrary.svelte       # 来源库新面板
└── Knowledge.svelte           # 合并后的导图面板
```

### 修改文件（12 个）
```
src/
├── icons.ts                   # 新增 iconAioLibrary
├── index.ts                   # 注册 SourceStore + 新 Tab + 子 Tab 路由
├── App.svelte                 # 5 Tab + 子 Tab + 跨 Tab 传参
├── libs/
│   ├── types/concept.ts       # SourceRef 类型简化
│   ├── source-refs.ts         # TYPE_LABELS 更新
│   ├── source-actions.ts      # getSourceAction 适配新类型
│   ├── store/concept-store.ts # VALID_SOURCE_TYPES 更新
│   ├── ai/pipeline.ts         # 支持从 SourceStore 读取来源
│   └── ai/source-hub.ts       # 新增 source 类型处理
├── panels/
│   ├── Rag.svelte             # 移除导入 UI，新增来源范围选择器
│   ├── Concepts.svelte        # 移除独立来源选择
│   └── Generate.svelte        # 改用来源库
```

### 删除文件（2 个）
```
src/panels/
├── Stats.svelte               # 删除统计 Tab
└── SourcePicker.svelte        # 合并到来源库 UI
```

---

## Phase 1: 数据层

### Task 1.1: 更新 SourceRef 类型定义

**Files:**
- Modify: `src/libs/types/concept.ts:11-19`

- [ ] **Step 1: 简化 SourceRef 类型**

编辑文件，将第 11-19 行替换为：

```typescript
/** 来源引用——每个概念、关系、卡片都可追溯到原始材料 */
export interface SourceRef {
    type: 'siyuan-doc' | 'manual' | 'source';
    sourceId?: string;             // SourceStore 中的 SourceRecord.id
    blockId?: string;              // 思源块 ID（siyuan-doc 类型）
    quote?: string;                // 摘录文本（最大 500 字符）
    page?: number;                 // PDF 页码
}
```

- [ ] **Step 2: 运行 TypeScript 检查**

```
npx tsc --noEmit
```

预期：大量类型错误（所有引用旧 `SourceRef.type` 的地方都会报错）。这是正常的——后续任务逐个修复。

### Task 1.2: 创建 SourceStore

**Files:**
- Create: `src/libs/source-store.ts`

- [ ] **Step 1: 创建 SourceStore 类**

写入文件：

```typescript
/*
 * 统一来源持久化层。
 * 存储键：'sources'
 */
import type { ConceptNode, Relation, Card } from './types/concept';

export type SourceRecordType = 'file' | 'url' | 'paste' | 'pdf' | 'siyuan-doc';

export interface SourceRecord {
    id: string;
    title: string;
    type: SourceRecordType;
    content: string;
    contentHash?: string;
    metadata: {
        fileName?: string;
        url?: string;
        mimeType?: string;
        siyuanDocId?: string;
        pageCount?: number;
        fileSize?: number;
        addedAt: number;
    };
    whereUsed: {
        rag: boolean;
        generate: boolean;
        concepts: boolean;
        usageCount: number;
    };
    chunkStatus: 'pending' | 'done' | 'error';
    errorMessage?: string;
    retryCount: number;
}

export class SourceStore {
    private sources: SourceRecord[] = [];
    private plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async load(): Promise<void> {
        try {
            const data = await this.plugin.loadData('sources');
            this.sources = Array.isArray(data) ? data : [];
        } catch {
            this.sources = [];
        }
    }

    async save(): Promise<void> {
        await this.plugin.saveData('sources', this.sources);
    }

    getAll(): SourceRecord[] {
        return [...this.sources];
    }

    getById(id: string): SourceRecord | undefined {
        return this.sources.find(s => s.id === id);
    }

    getByType(type: SourceRecordType): SourceRecord[] {
        return this.sources.filter(s => s.type === type);
    }

    getByHash(hash: string): SourceRecord | undefined {
        return this.sources.find(s => s.contentHash === hash);
    }

    getByUrl(url: string): SourceRecord | undefined {
        return this.sources.find(s => s.metadata.url === url);
    }

    add(source: SourceRecord): void {
        this.sources.push(source);
    }

    update(id: string, partial: Partial<SourceRecord>): void {
        const idx = this.sources.findIndex(s => s.id === id);
        if (idx >= 0) Object.assign(this.sources[idx], partial);
    }

    remove(id: string): void {
        this.sources = this.sources.filter(s => s.id !== id);
    }

    trackUsage(sourceId: string, panel: 'rag' | 'generate' | 'concepts'): void {
        const source = this.getById(sourceId);
        if (!source) return;
        source.whereUsed[panel] = true;
        source.whereUsed.usageCount += 1;
    }
}
```

- [ ] **Step 2: 运行 TypeScript 检查**

```
npx tsc --noEmit src/libs/source-store.ts
```

预期：通过（仅检查新文件本身）。

### Task 1.3: 创建解析器接口与注册表

**Files:**
- Create: `src/libs/parsers/types.ts`
- Create: `src/libs/parsers/registry.ts`

- [ ] **Step 1: 创建解析器接口**

写入 `src/libs/parsers/types.ts`：

```typescript
export interface ParseResult {
    text: string;
    metadata: Record<string, any>;
}

export interface SourceFileParser {
    /** 支持的扩展名列表（含点号，如 '.docx', '.pdf'） */
    supportedExtensions: string[];
    /** 从文件路径解析文本 */
    parse(filePath: string): Promise<ParseResult>;
    /** 可选：从 Buffer 解析 */
    parseBuffer?(buffer: Buffer, filename: string): Promise<ParseResult>;
}
```

- [ ] **Step 2: 创建注册表**

写入 `src/libs/parsers/registry.ts`：

```typescript
import type { SourceFileParser } from './types';

export class ParserRegistry {
    private parsers: SourceFileParser[] = [];

    register(parser: SourceFileParser): void {
        this.parsers.push(parser);
    }

    getParser(extension: string): SourceFileParser | undefined {
        const lower = extension.toLowerCase();
        return this.parsers.find(p =>
            p.supportedExtensions.some(ext => ext.toLowerCase() === lower)
        );
    }

    getSupportedExtensions(): string[] {
        return [...new Set(this.parsers.flatMap(p => p.supportedExtensions))];
    }
}
```

- [ ] **Step 3: 运行 TypeScript 检查**

```
npx tsc --noEmit src/libs/parsers/types.ts src/libs/parsers/registry.ts
```

### Task 1.4: 实现文本解析器（TXT/MD/HTML）

**Files:**
- Create: `src/libs/parsers/txt-md-html-parser.ts`

- [ ] **Step 1: 创建文本解析器**

```typescript
import * as fs from 'fs';
import { JSDOM } from 'jsdom';
import type { SourceFileParser, ParseResult } from './types';

export class TxtMdHtmlParser implements SourceFileParser {
    supportedExtensions = ['.txt', '.md', '.markdown', '.html', '.htm', '.csv', '.tsv', '.log', '.xml', '.json'];

    async parse(filePath: string): Promise<ParseResult> {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        let content = fs.readFileSync(filePath, 'utf-8');

        if (ext === 'html' || ext === 'htm') {
            try {
                const dom = new JSDOM(content);
                content = dom.window.document.body?.textContent || content;
            } catch { /* keep raw if parse fails */ }
        }

        return { text: content, metadata: { format: ext } };
    }
}
```

> **注意**：如果当前环境没有 `jsdom`，可以只做简单的 regex 去 HTML 标签：`content.replace(/<[^>]*>/g, ' ')`。后续任务可以根据实际情况调整。

- [ ] **Step 2: 运行 TypeScript 检查**

### Task 1.5: 实现 PDF 解析器

**Files:**
- Create: `src/libs/parsers/pdf-parser.ts`

- [ ] **Step 1: 创建 PDF 解析器**

```typescript
import type { SourceFileParser, ParseResult } from './types';

export class PdfParser implements SourceFileParser {
    supportedExtensions = ['.pdf'];

    async parse(filePath: string): Promise<ParseResult> {
        // 复用已有的 extractPdfText 逻辑
        const { extractPdfText } = await import('../sources/pdf-extractor');
        const text = await extractPdfText(new Uint8Array(
            await import('fs').then(m => m.readFileSync(filePath))
        ));
        return { text, metadata: { format: 'pdf' } };
    }
}
```

- [ ] **Step 2: 检查 pdf-extractor 导出**

确认 `src/libs/sources/pdf-extractor.ts` 导出了 `extractPdfText` 函数。如果没有，需要在 `pdf-parser.ts` 中直接调用 pdfjs-dist。

### Task 1.6: 实现 Pandoc 解析器（DOCX/PPTX/EPUB 等）

**Files:**
- Create: `src/libs/parsers/pandoc-parser.ts`

- [ ] **Step 1: 创建 Pandoc 解析器**

```typescript
import type { SourceFileParser, ParseResult } from './types';

// SiYuan 内置 Pandoc API 地址
const PANDOC_API = '/api/convert/pandoc';

export class PandocParser implements SourceFileParser {
    supportedExtensions = ['.docx', '.doc', '.pptx', '.ppt', '.epub', '.odt', '.rtf', '.org', '.rst', '.tex'];

    constructor(private plugin: any) {}

    async parse(filePath: string): Promise<ParseResult> {
        // 1. 上传文件到 temp 目录
        const dir = `pandoc-${Date.now()}`;
        const fileName = filePath.split(/[/\\]/).pop() || 'input';
        // Put file via SiYuan API
        const putForm = new FormData();
        putForm.append('file', new Blob([await fetch(filePath).then(r => r.blob())]));
        // ... 实际需要通过 SiYuan 的 putFile API

        // 2. 调用 Pandoc 转换
        const resp = await fetch(PANDOC_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dir,
                args: ['--to', 'markdown_strict-raw_html', fileName, '-o', 'output.md'],
            }),
        });
        const json = await resp.json();

        // 3. 读取输出
        if (json.code !== 0) {
            throw new Error(`Pandoc conversion failed: ${json.msg}`);
        }
        const outputPath = json.data.path + '/output.md';
        const text = await (await fetch(`/api/file/getFile?path=${encodeURIComponent(outputPath)}`)).text();

        return { text, metadata: { format: fileName.split('.').pop() || '' } };
    }
}
```

> **注意**：SiYuan 的 `/api/file/putFile` 和 `/api/file/getFile` 是内部 API。实际实现中，需要通过插件的 `request` 方法或 `fetch` 调用。此任务依赖对 SiYuan API 的准确理解——实施时可能需要查阅 SiYuan API 文档 (`/api/file/putFile` 的 formData 格式)。

- [ ] **Step 2: 用实际 API 测试替代上面的伪代码**

实施时需验证 SiYuan `putFile` / `getFile` 的准确调用方式。

### Task 1.7: 实现 XLSX + 图片 OCR 解析器

**Files:**
- Create: `src/libs/parsers/xlsx-parser.ts`
- Create: `src/libs/parsers/image-ocr-parser.ts`

- [ ] **Step 1: 安装依赖**

```
npm install xlsx tesseract.js
```

- [ ] **Step 2: 创建 XLSX 解析器**

```typescript
import * as XLSX from 'xlsx';
import type { SourceFileParser, ParseResult } from './types';

export class XlsxParser implements SourceFileParser {
    supportedExtensions = ['.xlsx', '.xls'];

    async parse(filePath: string): Promise<ParseResult> {
        const workbook = XLSX.readFile(filePath);
        const sheets = workbook.SheetNames.map(name => {
            const ws = workbook.Sheets[name];
            const csv = XLSX.utils.sheet_to_csv(ws);
            return `--- ${name} ---\n${csv}`;
        });
        return {
            text: sheets.join('\n\n'),
            metadata: { format: 'xlsx', sheetCount: workbook.SheetNames.length },
        };
    }
}
```

- [ ] **Step 3: 创建图片 OCR 解析器**

```typescript
import { createWorker } from 'tesseract.js';
import type { SourceFileParser, ParseResult } from './types';

export class ImageOcrParser implements SourceFileParser {
    supportedExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.webp'];

    async parse(filePath: string): Promise<ParseResult> {
        const worker = await createWorker('eng');
        try {
            const { data: { text } } = await worker.recognize(filePath);
            return { text, metadata: { format: 'image', ocrEngine: 'tesseract.js' } };
        } finally {
            await worker.terminate();
        }
    }
}
```

- [ ] **Step 4: 运行 TypeScript 检查**

```
npx tsc --noEmit
```

### Task 1.8: 实现思源文档解析器

**Files:**
- Create: `src/libs/parsers/siyuan-doc-parser.ts`

- [ ] **Step 1: 创建思源文档解析器**

```typescript
import type { SourceFileParser, ParseResult } from './types';

export class SiyuanDocParser implements SourceFileParser {
    supportedExtensions = []; // 不通过扩展名匹配，通过 type='siyuan-doc' 直接调用

    constructor(private plugin: any) {}

    async parseSiyuanDoc(docId: string): Promise<ParseResult> {
        // 通过 SiYuan API 读取文档内容
        const sql = `SELECT * FROM blocks WHERE root_id = '${docId}' AND type = 'd'`;
        const resp = await fetch('/api/query/sql', {
            method: 'POST',
            body: JSON.stringify({ stmt: sql }),
        });
        const json = await resp.json();
        if (json.code !== 0) {
            throw new Error(`SiYuan doc read failed: ${json.msg}`);
        }
        const blocks = json.data || [];
        const text = blocks.map((b: any) => b.markdown || b.content || '').join('\n\n');
        const title = blocks[0]?.content || docId;

        return { text, metadata: { format: 'siyuan-doc', docId, title } };
    }

    async parse(filePath: string): Promise<ParseResult> {
        // 不应通过文件路径调用——思源文档用 parseSiyuanDoc
        throw new Error('SiyuanDocParser.parse() is not supported. Use parseSiyuanDoc(docId) instead.');
    }
}
```

> **注意**：SiYuan 读取文档块的 SQL API 可能需要调整（`blocks` 表的字段名可能因版本而异）。实施时需验证。

### Task 1.9: 创建解析器入口 + 注册全部解析器

**Files:**
- Create: `src/libs/parsers/index.ts`

- [ ] **Step 1: 创建导出文件**

```typescript
export { SourceFileParser, ParseResult } from './types';
export { ParserRegistry } from './registry';
export { TxtMdHtmlParser } from './txt-md-html-parser';
export { PdfParser } from './pdf-parser';
export { PandocParser } from './pandoc-parser';
export { XlsxParser } from './xlsx-parser';
export { ImageOcrParser } from './image-ocr-parser';
export { SiyuanDocParser } from './siyuan-doc-parser';
```

- [ ] **Step 2: 运行 TypeScript 全量检查**

```
npx tsc --noEmit
```

预期：仍有此前遗留的类型错误（其他文件引用旧 SourceRef.type 导致的），但解析器模块本身通过。

### Task 1.10: 更新 source-refs.ts TYPE_LABELS

**Files:**
- Modify: `src/libs/source-refs.ts`

- [ ] **Step 1: 更新类型标签**

将第 12-19 行替换为：

```typescript
const TYPE_LABELS: Record<string, string> = {
    'siyuan-doc': '思源文档',
    manual: '手动',
    source: '来源库',
};
```

- [ ] **Step 2: 更新 getSourceAction（第 48-70 行）**

将 `'siyuan'` 改为 `'siyuan-doc'`，将 `'rag'` 相关分支改为 `'source'` 相关：

```typescript
export function getSourceAction(ref: Partial<SourceRef> = {}): SourceActionDescriptor {
    if (ref.url) {
        return { kind: 'open-url', label: '打开链接', target: ref.url };
    }
    if (ref.type === 'siyuan-doc' && ref.blockId) {
        return { kind: 'open-siyuan-block', label: '打开块', target: ref.blockId };
    }
    if (ref.type === 'source' && (ref.sourceId || ref.quote)) {
        return { kind: 'copy-locator', label: '复制定位', copyText: sourceLocatorText(ref) };
    }
    if (ref.blockId) {
        return { kind: 'open-siyuan-block', label: '打开块', target: ref.blockId };
    }
    if (ref.sourceId || ref.quote) {
        return { kind: 'copy-locator', label: '复制定位', copyText: sourceLocatorText(ref) };
    }
    return { kind: 'none', label: '' };
}
```

### Task 1.11: 更新 concept-store.ts VALID_SOURCE_TYPES

**Files:**
- Modify: `src/libs/store/concept-store.ts:20`

- [ ] **Step 1: 更新有效来源类型**

将第 20 行替换为：

```typescript
const VALID_SOURCE_TYPES: SourceRef['type'][] = ['siyuan-doc', 'manual', 'source'];
```

### Task 1.12: 更新 source-actions.ts 适配新类型

**Files:**
- Modify: `src/libs/source-actions.ts`

- [ ] **Step 1: 查找所有引用旧 `SourceRef.type` 的分支**

用 grep 确认：`grep -n "type === " src/libs/source-actions.ts`

- [ ] **Step 2: 替换所有匹配项**

- `'opennotebook'` → 删除或改为 `'source'`
- `'siyuan'` → `'siyuan-doc'`
- `'file'`, `'url'`, `'pdf'`, `'rag'` → `'source'`

### Task 1.13: 在 index.ts 中注册 SourceStore

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 导入 SourceStore**

在第 17 行后添加：

```typescript
import { SourceStore } from './libs/source-store';
```

- [ ] **Step 2: 声明并初始化 SourceStore**

在 `private vectorStore!: VectorStore;` 后添加：

```typescript
private sourceStore!: SourceStore;
```

在 `await this.vectorStore.load();` 后添加：

```typescript
this.sourceStore = new SourceStore(this);
await this.sourceStore.load();
```

- [ ] **Step 3: 传入 App.svelte**

在 `new App({` 的 `props` 中添加：

```typescript
sourceStore: plugin.sourceStore,
```

- [ ] **Step 4: 在 load 后调用 SourceRef 迁移**

在 `index.ts` 的 `onload()` 中，所有 store 加载完毕后添加：

```typescript
// 一次性迁移旧的 SourceRef 类型 → 新类型
await this.migrateSourceRefs();
```

添加 `migrateSourceRefs()` 私有方法：

```typescript
private async migrateSourceRefs() {
  const CARDS_KEY = 'cards';
  const CONCEPTS_KEY = 'concepts';
  const RELATIONS_KEY = 'relations';

  const migrateRef = (ref: any) => {
    if (!ref || !ref.type) return ref;
    switch (ref.type) {
      case 'file': case 'url': case 'pdf': case 'rag': case 'opennotebook':
        return { ...ref, type: 'source' };
      case 'siyuan': return { ...ref, type: 'siyuan-doc' };
      default: return ref;
    }
  };

  // 迁移 cards
  try {
    const cards = await this.loadData(CARDS_KEY);
    if (Array.isArray(cards)) {
      let changed = false;
      for (const card of cards) {
        if (Array.isArray(card.sourceRefs)) {
          card.sourceRefs = card.sourceRefs.map(migrateRef);
          changed = true;
        }
      }
      if (changed) await this.saveData(CARDS_KEY, cards);
    }
  } catch {}

  // 迁移 concepts + relations
  try { await this.conceptStore.migrateSourceRefs(migrateRef); } catch {}
}
```

并在 `ConceptStore` 中添加 `migrateSourceRefs` 方法：

```typescript
async migrateSourceRefs(migrateFn: (ref: any) => any): Promise<void> {
  let changed = false;
  for (const node of this.concepts) {
    if (Array.isArray(node.sourceRefs)) {
      node.sourceRefs = node.sourceRefs.map(migrateFn);
      changed = true;
    }
  }
  for (const rel of this.relations) {
    if (Array.isArray(rel.sourceRefs)) {
      rel.sourceRefs = rel.sourceRefs.map(migrateFn);
      changed = true;
    }
  }
  if (changed) await this.save();
}
```

---

## Phase 2: 来源库 UI

### Task 2.1: 新增 iconAioLibrary 图标

**Files:**
- Modify: `src/icons.ts`

- [ ] **Step 1: 在 `AIO_ICONS` SVG 字符串中添加新 symbol**

在 `</svg>` 前添加以下 symbol（参考 Lucide `library` 图标）：

```html
  <symbol id="iconAioLibrary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </symbol>
```

### Task 2.2: 创建 SourceLibrary.svelte

**Files:**
- Create: `src/panels/SourceLibrary.svelte`

- [ ] **Step 1: 编写来源库面板**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import type { SourceRecord, SourceStore } from '../libs/source-store';
  import { ParserRegistry, TxtMdHtmlParser, PdfParser, PandocParser, XlsxParser, ImageOcrParser, SiyuanDocParser } from '../libs/parsers';

  export let plugin: any;
  export let sourceStore: SourceStore;
  export let vectorStore: any;
  export let preSelectedIds: string[] = [];
  export let appStore: any;

  // 状态
  let sources: SourceRecord[] = [];
  let selected = new Set<string>();
  let filterType = 'all';
  let searchQuery = '';
  let importMenuOpen = false;

  // 解析器注册表
  const registry = new ParserRegistry();
  registry.register(new TxtMdHtmlParser());
  registry.register(new PdfParser());
  registry.register(new PandocParser(plugin));
  registry.register(new XlsxParser());
  registry.register(new ImageOcrParser());

  onMount(() => {
    sources = sourceStore.getAll();
    // 接收跨 Tab 传入的预选
    if (appStore?.selectedSourceIds) {
      selected = new Set(appStore.selectedSourceIds);
      appStore.selectedSourceIds = []; // 消费后清空
    }
  });

  function toggleSelect(id: string) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    selected = selected; // trigger reactivity
  }

  function selectAll() {
    visibleSources.forEach(s => selected.add(s.id));
    selected = selected;
  }

  function deselectAll() {
    selected = new Set();
  }

  function deleteSelected() {
    const toDelete = [...selected].filter(id => {
      const s = sourceStore.getById(id);
      return s && s.whereUsed.usageCount === 0;
    });
    toDelete.forEach(id => sourceStore.remove(id));
    sourceStore.save();
    sources = sourceStore.getAll();
    selected = new Set();
  }

  async function importFiles() {
    // 打开文件选择器
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = registry.getSupportedExtensions().join(',');
    input.onchange = async () => {
      for (const file of Array.from(input.files || [])) {
        await importFile(file);
      }
    };
    input.click();
  }

  async function importFile(file: File) {
    // 创建临时 SourceRecord
    const id = crypto.randomUUID();
    const record: SourceRecord = {
      id,
      title: file.name,
      type: file.name.endsWith('.pdf') ? 'pdf' : 'file',
      content: '',
      metadata: {
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        addedAt: Date.now(),
      },
      whereUsed: { rag: false, generate: false, concepts: false, usageCount: 0 },
      chunkStatus: 'pending',
      retryCount: 0,
    };
    sourceStore.add(record);
    sourceStore.save();
    sources = sourceStore.getAll();

    // 解析文件
    try {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      const parser = registry.getParser(ext);
      if (!parser || !parser.parseBuffer) throw new Error(`Unsupported format: ${ext}`);

      const buffer = Buffer.from(await file.arrayBuffer());
      const { text } = await parser.parseBuffer(buffer, file.name);

      // 计算 hash
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      
      // 去重检查
      if (sourceStore.getByHash(hash)) {
        sourceStore.remove(id);
        sourceStore.save();
        sources = sourceStore.getAll();
        alert('此文件内容已存在于来源库中');
        return;
      }

      sourceStore.update(id, { content: text, contentHash: hash, chunkStatus: 'done' });
    } catch (err: any) {
      sourceStore.update(id, { chunkStatus: 'error', errorMessage: err.message });
    }
    sourceStore.save();
    sources = sourceStore.getAll();
  }

  async function importPaste() {
    const text = prompt('粘贴文本内容（完成后会作为新来源导入）:');
    if (!text?.trim()) return;
    const id = crypto.randomUUID();
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (sourceStore.getByHash(hash)) { alert('内容已存在'); return; }
    const record: SourceRecord = {
      id,
      title: text.slice(0, 50),
      type: 'paste',
      content: text,
      contentHash: hash,
      metadata: { addedAt: Date.now() },
      whereUsed: { rag: false, generate: false, concepts: false, usageCount: 0 },
      chunkStatus: 'done',
      retryCount: 0,
    };
    sourceStore.add(record);
    sourceStore.save();
    sources = sourceStore.getAll();
  }

  async function importUrl() {
    const url = prompt('输入网址:');
    if (!url?.trim()) return;
    const id = crypto.randomUUID();
    if (sourceStore.getByUrl(url)) { alert('此URL已导入'); return; }
    const record: SourceRecord = {
      id,
      title: url,
      type: 'url',
      content: '',
      metadata: { url, addedAt: Date.now() },
      whereUsed: { rag: false, generate: false, concepts: false, usageCount: 0 },
      chunkStatus: 'pending',
      retryCount: 0,
    };
    sourceStore.add(record);
    sourceStore.save();
    sources = sourceStore.getAll();

    try {
      const resp = await fetch(url);
      const html = await resp.text();
      const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      sourceStore.update(id, { content: text, contentHash: hash, chunkStatus: 'done' });
    } catch (err: any) {
      sourceStore.update(id, { chunkStatus: 'error', errorMessage: err.message });
    }
    sourceStore.save();
    sources = sourceStore.getAll();
  }

  // 思源文档搜索状态
  let siyuanSearchQuery = '';
  let siyuanSearchResults: Array<{ id: string; title: string; path: string }> = [];
  let siyuanSearchOpen = false;
  let siyuanSearchLoading = false;

  async function importSiyuanDoc() {
    siyuanSearchOpen = true;
    siyuanSearchQuery = '';
    siyuanSearchResults = [];
  }

  // 通过 SiYuan SQL API 搜索文档
  async function searchSiyuanDocs() {
    if (!siyuanSearchQuery.trim()) return;
    siyuanSearchLoading = true;
    try {
      const sql = `SELECT id, content as title, hpath as path FROM blocks WHERE type='d' AND content LIKE '%${siyuanSearchQuery.replace(/'/g, "''")}%' LIMIT 20`;
      const resp = await fetch('/api/query/sql', {
        method: 'POST',
        body: JSON.stringify({ stmt: sql }),
      });
      const json = await resp.json();
      siyuanSearchResults = (json.data || []).map((r: any) => ({ id: r.id, title: r.title, path: r.path }));
    } catch (e) { siyuanSearchResults = []; }
    siyuanSearchLoading = false;
  }

  async function selectSiyuanDoc(doc: { id: string; title: string; path: string }) {
    siyuanSearchOpen = false;
    // 创建 SourceRecord
    const id = crypto.randomUUID();
    const record: SourceRecord = {
      id,
      title: doc.title,
      type: 'siyuan-doc',
      content: '',
      metadata: { siyuanDocId: doc.id, addedAt: Date.now() },
      whereUsed: { rag: false, generate: false, concepts: false, usageCount: 0 },
      chunkStatus: 'pending',
      retryCount: 0,
    };
    sourceStore.add(record);
    sourceStore.save();
    sources = sourceStore.getAll();

    // 通过 SiYuan API 读取文档全文
    try {
      const sql = `SELECT markdown FROM blocks WHERE root_id='${doc.id}' ORDER BY sort LIMIT 500`;
      const resp = await fetch('/api/query/sql', { method: 'POST', body: JSON.stringify({ stmt: sql }) });
      const json = await resp.json();
      const text = (json.data || []).map((b: any) => b.markdown || '').join('\n\n');
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      sourceStore.update(id, { content: text, contentHash: hash, chunkStatus: 'done' });
    } catch (err: any) {
      sourceStore.update(id, { chunkStatus: 'error', errorMessage: err.message || '思源文档读取失败' });
    }
    sourceStore.save();
    sources = sourceStore.getAll();
  }

  // 核心导入逻辑：提取文本 + SHA-256 去重
  async function extractAndStore(sourceId: string, text: string) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const existing = sourceStore.getByHash(hash);
    if (existing && existing.id !== sourceId) {
      sourceStore.remove(sourceId);
      sourceStore.save();
      sources = sourceStore.getAll();
      alert('此内容已存在于来源库中');
      return false;
    }
    sourceStore.update(sourceId, { content: text, contentHash: hash, chunkStatus: 'done', errorMessage: undefined });
    sourceStore.save();
    sources = sourceStore.getAll();
    return true;
  }

  function retryImport(id: string) {
    const source = sourceStore.getById(id);
    if (!source) return;
    sourceStore.update(id, { chunkStatus: 'pending', errorMessage: undefined, retryCount: source.retryCount + 1 });
    sourceStore.save();
    sources = sourceStore.getAll();

    // 根据原始类型重新导入
    if (source.type === 'url' && source.metadata.url) {
      fetch(source.metadata.url).then(r => r.text()).then(html => {
        const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return extractAndStore(id, text);
      }).catch(err => {
        sourceStore.update(id, { chunkStatus: 'error', errorMessage: err.message });
        sourceStore.save();
        sources = sourceStore.getAll();
      });
    } else if (source.type === 'siyuan-doc' && source.metadata.siyuanDocId) {
      // 重新读取思源文档
      const sql = `SELECT markdown FROM blocks WHERE root_id='${source.metadata.siyuanDocId}' ORDER BY sort LIMIT 500`;
      fetch('/api/query/sql', { method: 'POST', body: JSON.stringify({ stmt: sql }) })
        .then(r => r.json()).then(json => {
          const text = (json.data || []).map((b: any) => b.markdown || '').join('\n\n');
          return extractAndStore(id, text);
        }).catch(err => {
          sourceStore.update(id, { chunkStatus: 'error', errorMessage: err.message || '思源文档重试失败' });
          sourceStore.save();
          sources = sourceStore.getAll();
        });
    } else {
      // file/pdf/paste 类型需要用户重新上传文件——提示用户
      alert(`此来源类型（${source.type}）需要重新上传文件。请先删除后重新导入。`);
      sourceStore.update(id, { chunkStatus: 'error', errorMessage: '需要重新上传文件' });
      sourceStore.save();
      sources = sourceStore.getAll();
    }
  }

  function useForRag() {
    appStore.selectedSourceIds = [...selected];
    // 触发跳转到 RAG Tab（由 App.svelte 监听 appStore 变化）
    if (appStore.onSwitchTab) appStore.onSwitchTab('rag');
  }

  function useForGenerate() {
    appStore.selectedSourceIds = [...selected];
    if (appStore.onSwitchTab) appStore.onSwitchTab('generate');
  }

  function useForConcepts() {
    appStore.selectedSourceIds = [...selected];
    if (appStore.onSwitchTab) appStore.onSwitchTab('concepts');
  }

  // 过滤后的来源列表
  $: visibleSources = sources.filter(s => {
    if (filterType !== 'all' && s.type !== filterType) return false;
    if (searchQuery && !s.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const typeLabels: Record<string, string> = {
    file: '文件', url: 'URL', paste: '粘贴', pdf: 'PDF', 'siyuan-doc': '思源',
  };

  // 状态图标
  function statusIcon(s: SourceRecord): string {
    if (s.chunkStatus === 'done') return '✓';
    if (s.chunkStatus === 'error') return '✗';
    return '⏳';
  }
</script>

<div class="source-library">
  <!-- 顶部工具栏 -->
  <div class="source-toolbar">
    <div class="source-toolbar-left">
      <div class="import-dropdown" class:open={importMenuOpen}>
        <button class="b3-button" on:click={() => importMenuOpen = !importMenuOpen}>
          导入 ▾
        </button>
        {#if importMenuOpen}
          <div class="import-menu">
            <button on:click={() => { importMenuOpen = false; importFiles(); }}>📄 文件（上传文件）</button>
            <button on:click={() => { importMenuOpen = false; importPaste(); }}>📎 粘贴（粘贴文本）</button>
            <button on:click={() => { importMenuOpen = false; importUrl(); }}>🌐 URL（网址）</button>
            <button on:click={() => { importMenuOpen = false; importFiles(); }}>📕 PDF（上传PDF）</button>
            <button on:click={() => { importMenuOpen = false; importSiyuanDoc(); }}>📑 思源文档（搜索选择）</button>
          </div>
        {/if}
      </div>
      <input class="b3-text-field" type="text" placeholder="搜索来源..." bind:value={searchQuery} />
      <select class="b3-select" bind:value={filterType}>
        <option value="all">全部</option>
        <option value="file">文件</option>
        <option value="url">URL</option>
        <option value="paste">粘贴</option>
        <option value="pdf">PDF</option>
        <option value="siyuan-doc">思源文档</option>
      </select>
    </div>
    <div class="source-toolbar-right">
      <button class="b3-button b3-button--small" on:click={selectAll}>全选</button>
      <button class="b3-button b3-button--small" on:click={deselectAll}>取消</button>
    </div>
  </div>

  <!-- 来源列表 -->
  <div class="source-list">
    {#each visibleSources as source}
      <div class="source-item" class:source-item--error={source.chunkStatus === 'error'}>
        <label class="source-item-check">
          <input type="checkbox" checked={selected.has(source.id)} on:change={() => toggleSelect(source.id)} />
        </label>
        <div class="source-item-info">
          <span class="source-item-title">{source.title}</span>
          <span class="source-item-meta">
            <span class="source-item-type">{typeLabels[source.type] || source.type}</span>
            <span class="source-item-status" class:error={source.chunkStatus === 'error'}>{statusIcon(source)}</span>
            <span>{new Date(source.metadata.addedAt).toLocaleDateString()}</span>
          </span>
        </div>
        <div class="source-item-actions">
          {#if source.whereUsed.usageCount > 0}
            <span class="usage-badge">用了{source.whereUsed.usageCount}次</span>
          {/if}
          {#if source.chunkStatus === 'error'}
            <button class="b3-button b3-button--small" on:click={() => retryImport(source.id)}>重试</button>
          {/if}
          <button class="b3-button b3-button--small b3-button--cancel" on:click={() => { sourceStore.remove(source.id); sourceStore.save(); sources = sourceStore.getAll(); selected.delete(source.id); selected = selected; }}>
            删除
          </button>
        </div>
      </div>
    {:else}
      <div class="source-empty">
        <p>来源库为空</p>
        <p class="source-empty-hint">点击"导入"添加文件、URL、粘贴文本或思源文档</p>
      </div>
    {/each}
  </div>

  <!-- 底部操作栏 -->
  <div class="source-bottom-bar">
    <span class="selected-count">已选 {selected.size} 项</span>
    <button class="b3-button b3-button--cancel" disabled={selected.size === 0} on:click={deleteSelected}>
      删除选中
    </button>
    <button class="b3-button" disabled={selected.size === 0} on:click={useForRag}>
      用于 RAG 对话
    </button>
    <button class="b3-button" disabled={selected.size === 0} on:click={useForGenerate}>
      用于制卡
    </button>
    <button class="b3-button" disabled={selected.size === 0} on:click={useForConcepts}>
      用于导图
    </button>
  </div>
</div>

<style>
  .source-library {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .source-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    gap: 8px;
    border-bottom: 1px solid var(--b3-border-color);
  }
  .source-toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .import-dropdown {
    position: relative;
  }
  .import-menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    background: var(--b3-theme-background);
    border: 1px solid var(--b3-border-color);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,.1);
    min-width: 180px;
  }
  .import-menu button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 13px;
  }
  .import-menu button:hover {
    background: var(--b3-list-hover);
  }
  .source-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .source-item {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    gap: 8px;
    border-bottom: 1px solid var(--b3-border-color-light, rgba(0,0,0,.04));
  }
  .source-item:hover {
    background: var(--b3-list-hover);
  }
  .source-item--error {
    border-left: 3px solid var(--b3-card-error-color, #ef4444);
  }
  .source-item-check {
    flex-shrink: 0;
  }
  .source-item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .source-item-title {
    font-size: var(--aio-fs-base);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .source-item-meta {
    display: flex;
    gap: 8px;
    font-size: var(--aio-fs-xs);
    opacity: 0.6;
  }
  .source-item-type {
    padding: 0 4px;
    background: var(--b3-theme-surface-light, rgba(0,0,0,.04));
    border-radius: 3px;
  }
  .source-item-status.error {
    color: var(--b3-card-error-color, #ef4444);
    font-weight: bold;
  }
  .source-item-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .usage-badge {
    font-size: var(--aio-fs-xs);
    padding: 1px 6px;
    background: var(--b3-theme-primary-light);
    border-radius: 10px;
    white-space: nowrap;
  }
  .source-empty {
    text-align: center;
    padding: 40px;
    opacity: 0.5;
  }
  .source-empty-hint {
    font-size: var(--aio-fs-sm);
  }
  .source-bottom-bar {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    gap: 8px;
    border-top: 1px solid var(--b3-border-color);
    background: var(--b3-theme-background);
  }
  .selected-count {
    font-size: var(--aio-fs-sm);
    font-weight: 500;
    min-width: 60px;
  }
</style>
```

- [ ] **Step 2: 运行 TypeScript 检查**

```
npx tsc --noEmit
```

---

## Phase 3: UI 重组

### Task 3.1: 更新 App.svelte — 5 Tab 路由 + appStore

**Files:**
- Modify: `src/App.svelte`

- [ ] **Step 1: 更新导入**

在第 1-14 行，替换为：

```typescript
<script lang="ts">
  import { onMount } from 'svelte';
  import Review from './panels/Review.svelte';
  import Browse from './panels/Browse.svelte';
  import Generate from './panels/Generate.svelte';
  import Import from './panels/Import.svelte';
  import Rag from './panels/Rag.svelte';
  import SourceLibrary from './panels/SourceLibrary.svelte';
  import Knowledge from './panels/Knowledge.svelte';
  import SettingsPanel from './panels/Settings.svelte';
  import { getT } from './libs/i18n';
  import { activateSourceRef, getSourceAction } from './libs/source-actions';
  import type { RagConceptRequest } from './libs/rag';
  import type { SourceRef } from './libs/types/concept';

  export let plugin: any;
  export let cardStore: any;
  export let mindmapStore: any;
  export let conceptStore: any;
  export let vectorStore: any;
  export let sourceStore: any;
  export let config: any;

  const t = getT(plugin);

  let activeTab = 'sources';
  let activeSubTab = 'generate'; // 制卡下的子 Tab
  let appStore = {
    selectedSourceIds: [] as string[],
    onSwitchTab: (tab: string) => { activeTab = tab; },
  };
```

- [ ] **Step 2: 更新 tabs 数组（第 57-66 行）**

```typescript
  const tabs = [
    { id: 'sources',  label: '来源库',   icon: 'iconAioLibrary' },
    { id: 'rag',      label: 'RAG 对话',  icon: 'iconAioSearch' },
    { id: 'make',     label: '制卡',      icon: 'iconAioSparkles' },
    { id: 'knowledge',label: '导图',      icon: 'iconAioGraph' },
    { id: 'settings', label: '设置',      icon: 'iconAioSettings' },
  ];

  const makeSubTabs = [
    { id: 'generate', label: '制卡' },
    { id: 'review',   label: '复习' },
    { id: 'browse',   label: '浏览' },
    { id: 'import',   label: '导入' },
  ];
```

- [ ] **Step 3: 更新模板（第 86 行后）**

在 `<div class="all-in-one-app">` 内的导航和内容区域，参考以下结构更新条件渲染：

```svelte
<div class="aio-content">
  <!-- 子 Tab（仅制卡 Tab 显示） -->
  {#if activeTab === 'make'}
    <div class="aio-subtabs">
      {#each makeSubTabs as sub}
        <button class="aio-subtab" class:aio-subtab--active={activeSubTab === sub.id} on:click={() => activeSubTab = sub.id}>
          {sub.label}
        </button>
      {/each}
    </div>
  {/if}

  {#if activeTab === 'make' && activeSubTab === 'generate'}
    <Generate {plugin} {cardStore} {conceptStore} {sourceStore} {config} />
  {:else if activeTab === 'make' && activeSubTab === 'review'}
    <Review {plugin} {cardStore} {config} />
  {:else if activeTab === 'make' && activeSubTab === 'browse'}
    <Browse {plugin} {cardStore} {conceptStore} {config} />
  {:else if activeTab === 'make' && activeSubTab === 'import'}
    <Import {plugin} {cardStore} {conceptStore} {mindmapStore} />
  {:else if activeTab === 'rag'}
    <Rag {plugin} {cardStore} {vectorStore} {sourceStore} {config} bind:appStore />
  {:else if activeTab === 'sources'}
    <SourceLibrary {plugin} {sourceStore} {vectorStore} bind:appStore />
  {:else if activeTab === 'knowledge'}
    <Knowledge {plugin} {cardStore} {conceptStore} {sourceStore} {config} />
  {:else if activeTab === 'settings'}
    <SettingsPanel showAsTab={true} {plugin} {config} />
  {/if}
</div>
```

- [ ] **Step 4: 添加子 Tab 样式**

在 `<style>` 中添加：

```scss
  .aio-subtabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--b3-border-color);
  }
  .aio-subtab {
    padding: 6px 16px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: var(--aio-fs-sm);
    color: var(--b3-theme-on-surface);
    opacity: 0.7;
    border-bottom: 2px solid transparent;
  }
  .aio-subtab:hover { opacity: 1; }
  .aio-subtab--active {
    opacity: 1;
    color: var(--b3-theme-primary);
    border-bottom-color: var(--b3-theme-primary);
  }
```

### Task 3.2: 创建 Knowledge.svelte（图谱+导图合并）

**Files:**
- Create: `src/panels/Knowledge.svelte`

- [ ] **Step 1: 创建合并面板**

此文件将 Concepts.svelte 的图谱视图和 Mindmap.svelte 的导图视图合并为一个面板，通过模式切换。实现较复杂（两个现有面板的核心逻辑需要迁移），此处给出结构框架：

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  export let plugin: any;
  export let cardStore: any;
  export let conceptStore: any;
  export let sourceStore: any;
  export let config: any;

  let mode: 'graph' | 'mindmap' = 'graph';
  let mindmapId: string | null = null; // 选中的导图

  onMount(() => {
    // 初始化——加载 conceptStore 数据
  });
</script>

<div class="knowledge-panel">
  <!-- 模式切换 -->
  <div class="knowledge-toolbar">
    <div class="mode-switch">
      <button class="b3-button b3-button--small" class:active={mode === 'graph'} on:click={() => mode = 'graph'}>
        图谱视图
      </button>
      <button class="b3-button b3-button--small" class:active={mode === 'mindmap'} on:click={() => mode = 'mindmap'}>
        导图视图
      </button>
    </div>
  </div>

  {#if mode === 'graph'}
    <!-- 图谱视图：迁移 Concepts.svelte 核心逻辑 -->
  {:else}
    <!-- 导图视图：迁移 Mindmap.svelte 核心逻辑 -->
  {/if}
</div>

<style>
  .knowledge-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .knowledge-toolbar {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--b3-border-color);
  }
  .mode-switch {
    display: flex;
    gap: 4px;
  }
  .mode-switch button.active {
    background: var(--b3-theme-primary);
    color: var(--b3-theme-on-primary);
  }
</style>
```

> **实施策略**：此面板是合并重构中最复杂的部分（Concepts.svelte 1796 行 + Mindmap.svelte 1088 行）。采用最小改动策略：
> 1. **不提取公共组件**（两个视图共享 ConceptStore 数据但渲染逻辑完全不同，强行提取会增加耦合）
> 2. Knowledge.svelte 内部用 `{#if mode === 'graph'}`/`{:else}` 分支，两个分支各自包含 Concepts.svelte 和 Mindmap.svelte 的核心 `<script>` 逻辑和模板
> 3. 删除重复的 props 传递（两个面板都需要 `plugin`/`cardStore`/`conceptStore`/`config` — 从 App.svelte 统一传入 Knowledge.svelte 即可）
> 4. 来源库集成：在 Knowledge.svelte 的 `<script>` 顶部添加 SourceStore 选择逻辑（从 `appStore.selectedSourceIds` 读取），两个视图各自由调用处传递

### Task 3.3: 适配 Settings.svelte 为 Tab 模式

**Files:**
- Modify: `src/panels/Settings.svelte`

- [ ] **Step 1: 添加 showAsTab prop**

在 `Settings.svelte` 的 `<script>` 中：

```typescript
export let plugin: any;
export let config: any;
export let showAsTab = false;  // 新增：Tab 模式下不包裹 Dialog
```

- [ ] **Step 2: 条件渲染 Dialog 外壳**

在 Settings.svelte 模板中，用 `{#if showAsTab}` 包裹内容区域（去掉 Dialog 容器），`{:else}` 保留原有 Dialog 结构。

最小改动示例（在模板最外层）：

```svelte
{#if showAsTab}
  <!-- Tab 模式：直接渲染内容，无边距/无标题栏 -->
  <div class="settings-tab-content">
    <!-- 原 Settings 内容 -->
  </div>
{:else}
  <!-- Dialog 模式（原有逻辑，不改动） -->
  <div class="b3-dialog__container">
    <!-- 原 Settings 内容 -->
  </div>
{/if}
```

- [ ] **Step 3: Tab 模式样式**

在 `<style>` 中添加：

```scss
.settings-tab-content {
  padding: 16px;
  overflow-y: auto;
  height: 100%;
}
```

### Task 3.4: 更新 index.ts — Tab 注册

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 更新顶部栏图标**

第 84 行的 topbar 图标保持不变（`iconAioRiffCard`），但需要确认 Tab 打开逻辑正确。

- [ ] **Step 2: 设置 Tab 面板**

Settings 原来通过 Dialog 打开。现在改为独立 Tab 后，需要检查 App.svelte 中是否正确导入了 Settings 组件，且 Settings.svelte 中需要适配作为 Tab 内容（而非 Dialog）渲染。

### Task 3.5: 删除 Stats.svelte + SourcePicker.svelte

- [ ] **Step 1: 删除文件**

```
Remove-Item -LiteralPath "src/panels/Stats.svelte"
Remove-Item -LiteralPath "src/panels/SourcePicker.svelte"
```

- [ ] **Step 2: 全局搜索残留引用**

```
rg "Stats" src/ --no-heading
rg "SourcePicker" src/ --no-heading
```

移除 App.svelte、index.ts 等文件中所有对这两个文件的 import。

- [ ] **Step 3: 后续清理提醒**

Mindmap.svelte 在 Knowledge.svelte 合并完成并验证后应删除（Step 不清除，以免过早删除导致回归困难）。Concepts.svelte 同理。

---

## Phase 4: 面板改造

### Task 4.1: Rag.svelte — 移除导入 UI + 添加来源范围选择器

**Files:**
- Modify: `src/panels/Rag.svelte`

- [ ] **Step 1: 移除导入相关 UI**

删除 Rag.svelte 中以下元素：
- 文件上传按钮
- 粘贴文本按钮
- URL 抓取按钮
- 文档列表显示区域

保留：模型选择、聊天界面、embedder 状态指示器。

- [ ] **Step 2: 添加来源范围选择器**

在聊天输入区上方添加：

```svelte
<div class="source-scope">
  <span class="source-scope-label">对话范围:</span>
  {#if selectedSources.length === 0}
    <span class="source-scope-all">全部来源</span>
  {:else}
    <span>{selectedSources.length} 个来源</span>
  {/if}
  <button class="b3-button b3-button--small" on:click={() => appStore.onSwitchTab('sources')}>
    选择来源
  </button>
</div>
```

- [ ] **Step 3: 从 appStore 接收预选来源**

```typescript
import { onMount } from 'svelte';

let selectedSources: string[] = [];
onMount(() => {
  if (appStore?.selectedSourceIds) {
    selectedSources = appStore.selectedSourceIds;
    appStore.selectedSourceIds = [];
  }
});
```

- [ ] **Step 4: 修改 ragQuery 调用**

在 `send()` 函数中，将搜索结果过滤为仅包含选中来源的向量：

```typescript
const results = vectorStore.search(embedding, topK);
const filtered = selectedSources.length > 0
  ? results.filter(r => selectedSources.includes(r.entry.sourceId))
  : results;
```

### Task 4.2: Concepts.svelte — 移除独立来源选择

**Files:**
- Modify: `src/panels/Concepts.svelte`

- [ ] **Step 1: 移除手动来源模式 UI**

删除以下区域：
- `source-mode-tabs`（手动/混合模式切换）
- `siyuan-source-box`（思源文档搜索区域）
- `addedUrls`（URL 输入区域）
- `localFiles`（本地文件选择区域）
- `pdfFiles`（PDF 选择区域）

- [ ] **Step 2: 添加"从来源库选取"按钮**

在概念面板顶部添加：

```svelte
<button class="b3-button" on:click={() => appStore.onSwitchTab('sources')}>
  从来源库选取来源
</button>
```

- [ ] **Step 3: 修改 buildPipelineSources() 调用**

从 SourceStore 读取来源：

```typescript
function buildPipelineSources() {
  const selectedSources = sourceStore.getAll().filter(s =>
    appStore?.selectedSourceIds?.includes(s.id)
  );
  const texts = selectedSources.map(s => s.content).filter(Boolean);
  // 送入管线
}
```

### Task 4.3: Generate.svelte — 改用来源库

**Files:**
- Modify: `src/panels/Generate.svelte`

- [ ] **Step 1: 声明 sourceStore + appStore props**

在 `Generate.svelte` 的 `<script>` 顶部 export 块中添加：

```typescript
export let sourceStore: any = null;
export let appStore: any = null;
```

- [ ] **Step 2: 替换 SourcePicker 为来源库按钮**

删除 `<SourcePicker>` 组件引用，替换为：

```svelte
<button class="b3-button" on:click={() => appStore?.onSwitchTab('sources')}>
  从来源库选择
</button>
```

- [ ] **Step 3: 修改 fetchContext 调用**

从 `sourceStore.getById(id).content` 读取来源内容，而非独立 fetch：

```typescript
function fetchContext(sourceConfig) {
  // 原来: fetch from URL or SiYuan API
  // 改为: 从 SourceStore 读取
  if (sourceConfig.type === 'source' && sourceConfig.sourceId) {
    const record = sourceStore.getById(sourceConfig.sourceId);
    return record?.content || '';
  }
  // 保留手动文本输入路径
  if (sourceConfig.type === 'manual' && sourceConfig.manualText) {
    return sourceConfig.manualText;
  }
  return '';
}
```

### Task 4.4: Knowledge.svelte — 来源选择

**Files:**
- Modify: `src/panels/Knowledge.svelte`

- [ ] **Step 1: 添加 appStore prop + 来源库选择按钮**

在 `<script>` 顶部添加：

```typescript
export let appStore: any = null;
```

在工具栏中添加按钮：

```svelte
<div class="knowledge-toolbar">
  <div class="mode-switch">
    <!-- 图谱/导图切换 -->
  </div>
  <button class="b3-button b3-button--small" on:click={() => appStore?.onSwitchTab('sources')}>
    从来源库选取
  </button>
</div>
```

- [ ] **Step 2: 在 onMount 中读取预选来源**

```typescript
let selectedSourceIds: string[] = [];
onMount(() => {
  if (appStore?.selectedSourceIds) {
    selectedSourceIds = appStore.selectedSourceIds;
    appStore.selectedSourceIds = [];
  }
});
```

---

## Phase 5: 集成测试与清理

### Task 5.1: 编写 SourceStore 测试

**Files:**
- Create: `scripts/test_source_store.mjs`

- [ ] **Step 1: 创建测试脚本**

```javascript
// 测试 SourceStore CRUD + save/load 周期
import { SourceStore } from '../src/libs/source-store.js';

// Mock plugin
const mockPlugin = {
  data: {},
  async loadData(key) { return this.data[key] || null; },
  async saveData(key, value) { this.data[key] = value; },
};

async function test() {
  const store = new SourceStore(mockPlugin);
  await store.load();

  // Test add
  store.add({
    id: 'test-1',
    title: 'Test Source',
    type: 'file',
    content: 'hello world',
    metadata: { addedAt: Date.now() },
    whereUsed: { rag: false, generate: false, concepts: false, usageCount: 0 },
    chunkStatus: 'done',
    retryCount: 0,
  });
  console.assert(store.getAll().length === 1, 'Should have 1 source');

  // Test getById
  const s = store.getById('test-1');
  console.assert(s?.title === 'Test Source', 'Should find by id');

  // Test save/load cycle
  await store.save();
  const store2 = new SourceStore(mockPlugin);
  await store2.load();
  console.assert(store2.getAll().length === 1, 'Should persist across instances');

  // Test remove
  store.remove('test-1');
  console.assert(store.getAll().length === 0, 'Should be empty after remove');

  // Test trackUsage
  store.add({ ...s, id: 'test-2' });
  store.trackUsage('test-2', 'rag');
  const s2 = store.getById('test-2');
  console.assert(s2?.whereUsed.rag === true, 'Should track rag usage');
  console.assert(s2?.whereUsed.usageCount === 1, 'Should increment count');

  console.log('test_source_store: ALL PASSED ✅');
}

test().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
```

- [ ] **Step 2: 运行测试**

```
node --no-warnings scripts/test_source_store.mjs
```

预期：ALL PASSED

### Task 5.2: 编写解析器测试

**Files:**
- Create: `scripts/test_parsers.mjs`

- [ ] **Step 1: 创建测试脚本**

```javascript
// 测试 ParserRegistry + 文本解析器
import { ParserRegistry, TxtMdHtmlParser } from '../src/libs/parsers/index.js';

const registry = new ParserRegistry();
registry.register(new TxtMdHtmlParser());

// Test: extension matching
const txtParser = registry.getParser('.txt');
console.assert(txtParser !== undefined, 'Should find .txt parser');
console.assert(txtParser.supportedExtensions.includes('.txt'), 'Should support .txt');

const mdParser = registry.getParser('.md');
console.assert(mdParser !== undefined, 'Should find .md parser');

const unknown = registry.getParser('.xyz');
console.assert(unknown === undefined, 'Should return undefined for unknown extension');

// Test: supported extensions
const exts = registry.getSupportedExtensions();
console.assert(exts.includes('.txt'), 'Should include .txt in supported extensions');
console.assert(exts.includes('.html'), 'Should include .html in supported extensions');

// Test: TXT parsing (with temp file)
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tmpFile = path.join(os.tmpdir(), 'test-parser.txt');
fs.writeFileSync(tmpFile, 'Hello World\n\nSecond paragraph.');
const result = await txtParser.parse(tmpFile);
console.assert(result.text.includes('Hello World'), 'Should parse text file');
console.assert(result.text.includes('Second paragraph'), 'Should preserve paragraphs');
console.assert(result.metadata.format === 'txt', 'Should have txt format metadata');
fs.unlinkSync(tmpFile);

console.log('test_parsers: ALL PASSED ✅');
```

- [ ] **Step 2: 运行测试**

```
node --no-warnings scripts/test_parsers.mjs
```

预期：ALL PASSED

### Task 5.3: 编写 SourceRef 迁移测试

**Files:**
- Create: `scripts/test_source_ref_migration.mjs`

- [ ] **Step 1: 创建迁移测试**

```javascript
function migrateSourceRef(oldRef) {
  switch (oldRef.type) {
    case 'siyuan-doc': case 'manual': return { ...oldRef };
    case 'file': case 'url': case 'pdf': case 'rag': return { ...oldRef, type: 'source' };
    case 'opennotebook': return { ...oldRef, type: 'source' };
    default: return { ...oldRef, type: 'manual' };
  }
}

// Tests
const tests = [
  { in: { type: 'siyuan-doc', blockId: 'abc' }, want: 'siyuan-doc' },
  { in: { type: 'file', sourceId: 'x' }, want: 'source' },
  { in: { type: 'opennotebook', sourceId: 'y' }, want: 'source' },
  { in: { type: 'unknown', sourceId: 'z' }, want: 'manual' },
];
tests.forEach(t => {
  const result = migrateSourceRef(t.in);
  console.assert(result.type === t.want, `Expected ${t.want} got ${result.type}`);
});
console.log('test_source_ref_migration: ALL PASSED ✅');
```

- [ ] **Step 2: 运行测试**

### Task 5.4: 运行全量测试 + TypeScript 检查

- [ ] **Step 1: 更新 package.json 测试列表**

在 `scripts` 中 `test` 命令加入新测试脚本。

- [ ] **Step 2: 运行全量测试**

```
npm test
```

- [ ] **Step 3: 运行 TypeScript 检查**

```
npx tsc --noEmit
```

预期：全部通过。

### Task 5.5: 构建 + 部署 + 冒烟验证

- [ ] **Step 1: 构建**

```
npm run build
```

- [ ] **Step 2: 部署到 SiYuan 插件目录**

```powershell
$src = 'C:\Users\zyz\ZCodeProject\siyuan-flashcards\dist\*'
$dst = 'C:\Users\zyz\SiYuan\data\plugins\siyuan-all-in-one\'
Get-ChildItem -LiteralPath $dst -File | Set-ItemProperty -Name IsReadOnly -Value $false
Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force -Confirm:$false
```

- [ ] **Step 3: 重新加载插件**

在 SiYuan 中：集市 → 已下载 → 关闭/开启 siyuan-all-in-one 插件。

- [ ] **Step 4: 冒烟验证**

1. 打开插件 → 来源库 Tab 可见
2. 导入一个测试文件 → 出现在列表中
3. 勾选 → 点击"用于 RAG 对话" → 跳转到 RAG Tab
4. 制卡 Tab 切换子 Tab（制卡/复习/浏览/导入）
5. 导图 Tab 切换图谱/导图模式
6. 设置 Tab 可见

---

## 实施风险与 TODO

| 风险 | 缓解措施 |
|------|---------|
| Pandoc API 调用方式不确定 | Task 1.6 需要查阅 SiYuan 内部 API 文档后调整；可先实现无 Pandoc 的最小版本 |
| Knowledge.svelte 合并复杂度高 | 允许 Phase 3 先做切换 UI，两个视图仍然各自渲染（不完全重构内部逻辑） |
| SourcePicker.svelte 删除影响 | 思源文档搜索功能需要重现在来源库中（或保留 SourcePicker 但改为来源库内部组件） |
| Stats Tab 删除用户可能不期望 | 功能暂时隐藏，后续可恢复 |
| Settings Dialog→Tab 迁移量大 | 最小改动：Settings.svelte 作为 Tab 时隐藏 Dialog 外壳 |

---

## 完成标准

- [ ] `npx tsc --noEmit` 零错误
- [ ] `npm test` 全部通过（含新测试）
- [ ] 来源库 Tab 可正常导入/浏览/选择来源
- [ ] 5 个顶级 Tab 全部正常切换
- [ ] 制卡 Tab 的 4 个子 Tab 正常切换
- [ ] 导图 Tab 的图谱/导图模式可切换
- [ ] RAG/制卡/导图三个面板能从未源库接收选中来源
- [ ] 旧 `opennotebook` SourceRef 加载不崩溃
- [ ] 构建产物正确部署到 SiYuan
