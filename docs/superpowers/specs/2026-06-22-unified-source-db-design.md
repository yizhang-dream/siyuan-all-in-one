# 统一来源数据库 — 设计规范

**版本**: 1.1
**日期**: 2026-06-22
**状态**: Draft
**参考项目**: simstudioai/sim（解析器接口模式）、chatboxai/chatbox（文件类型覆盖）、FlowiseAI/Flowise（DocumentStore + whereUsed）、terwer/siyuan-plugin-importer（思源 Pandoc 桥）

---

## 1. 动机

当前系统存在以下问题：
- **无中心来源注册表**：每个面板独立管理来源，相同文件可能被 RAG 面板和 Concepts 面板重复上传
- **来源内容不持久化**：Concepts 面板每次跑管线都重新从思源 API / 本地文件读取
- **RAG 向量存储与概念卡片 SourceRef 脱节**：chunkId 字符串孤岛，无反向查询
- **跨面板来源不可复用**：在 RAG 面板上传的文件不能直接在 Concepts 或 Generate 面板使用

目标：建立一个**统一来源数据库**，所有外部内容一次性导入 → 自动 RAG 索引 → 所有面板直接读取。来源库为一个独立新 Tab。

---

## 2. 数据模型

### 2.1 SourceRecord — 来源记录

```typescript
interface SourceRecord {
  id: string;                    // crypto.randomUUID()，导入时生成
  title: string;                 // 文件名、文档标题、URL 标题
  type: SourceRecordType;        // 'file' | 'url' | 'paste' | 'pdf' | 'siyuan-doc'
  content: string;               // 原文全文，最大 5MB（SiYuan saveData 上限由 Electron localStorage 决定，实践中单个文件 >5MB 应分段存储或仅索引不全量保存）
  contentHash?: string;          // SHA-256，用于去重判断
  metadata: {
    fileName?: string;           // 文件名（file/pdf 类型）
    url?: string;                // 原始 URL（url 类型）
    mimeType?: string;           // MIME 类型
    siyuanDocId?: string;        // 思源文档 ID（siyuan-doc 类型）
    pageCount?: number;          // 页数（pdf/pptx/xlsx 类型）
    fileSize?: number;           // 原始文件大小 (bytes)
    addedAt: number;             // 导入时间戳
  };
  whereUsed: {
    rag: boolean;                // 是否用于 RAG 对话
    generate: boolean;           // 是否用于制卡
    concepts: boolean;           // 是否用于图谱/导图
    usageCount: number;          // 总使用次数
  };
  chunkStatus: 'pending' | 'done' | 'error';
  errorMessage?: string;         // 失败原因（仅 chunkStatus='error' 时）
  retryCount: number;            // 重试次数，默认 0
}
```

### 2.2 SourceRecordType — 五种类型

| 类型 | 来源 | 内容获取方式 |
|------|------|------------|
| `file` | 上传文本/DOCX/PPTX/XLSX/EPUB | 解析后存入 |
| `url` | 网址 | fetch 后存入 |
| `paste` | 粘贴文本 | 直接存入 |
| `pdf` | 上传 PDF | pdfjs-dist 提取后存入 |
| `siyuan-doc` | 思源文档 | SiYuan API 读取后自动导入 |

### 2.3 SourceRef — 简化卡片引用（不向后兼容）

```typescript
interface SourceRef {
  type: 'siyuan-doc' | 'manual' | 'source';
  sourceId?: string;             // 指向 SourceStore 中的 SourceRecord.id
  blockId?: string;              // 思源块 ID（siyuan-doc 类型）
  quote?: string;                // 摘录文本（最大 500 字符）
  page?: number;                 // PDF 页码
}
```

**删除的类型**（旧数据迁移时需要处理）：`'opennotebook'`, `'file'`, `'url'`, `'pdf'`, `'rag'`
- 旧数据中的 `type: 'file'/'url'/'pdf'` → 自动映射为 `type: 'source'` + 保留 `sourceId`

### 2.4 存储键

| 键 | 内容 | 备注 |
|----|------|------|
| `'sources'` | `SourceRecord[]` | 新增，SourceStore 管理 |
| `'rag-vectors'` | `VectorEntry[]` | 保留，sourceId 外键关联 SourceStore |
| `'concepts'` | `ConceptNode[]` | 保留，SourceRef.sourceId 链接 SourceStore |
| `'relations'` | `Relation[]` | 保留 |
| `'cards'` | `Card[]` | 保留，SourceRef.sourceId 链接 SourceStore |
| `'config'` | `AppConfig` | 保留 |

### 2.5 SourceStore

```typescript
class SourceStore {
  // CRUD
  getAll(): SourceRecord[];
  getById(id: string): SourceRecord | undefined;
  getByType(type: SourceRecordType): SourceRecord[];
  getByHash(hash: string): SourceRecord | undefined;  // 去重用
  getByUrl(url: string): SourceRecord | undefined;     // URL 去重用
  add(source: SourceRecord): void;
  update(id: string, partial: Partial<SourceRecord>): void;
  remove(id: string): void;
  // 持久化
  save(): Promise<void>;
  load(): Promise<void>;
  // whereUsed 追踪（参考 Flowise IDocumentStoreWhereUsed）
  trackUsage(sourceId: string, panel: 'rag' | 'generate' | 'concepts'): void;
}
```

---

## 3. 导入管线

### 3.1 导入流程

```
用户选择来源 → 提取文本 → 创建 SourceRecord → 自动 chunk → 自动 embed → VectorStore → chunkStatus = 'done'
                                                         ↓ 失败
                                                   chunkStatus = 'error'
                                                 errorMessage = 原因
```

### 3.2 解析器架构（参考 simstudioai/sim）

采用 `FileParser` 接口 + 注册表调度模式。每种格式一个独立解析器，通过扩展名匹配分发：

```typescript
// 参考 simstudioai/sim 的 FileParser 接口
interface SourceFileParser {
  supportedExtensions: string[];
  parse(filePath: string): Promise<{ text: string; metadata: Record<string, any> }>;
  parseBuffer?(buffer: Buffer, filename: string): Promise<{ text: string; metadata: Record<string, any> }>;
}

// 注册表（src/libs/parsers/index.ts）
class ParserRegistry {
  private parsers: SourceFileParser[] = [];
  register(parser: SourceFileParser): void;
  getParser(extension: string): SourceFileParser | undefined;
  getSupportedExtensions(): string[];
}

// 使用
const registry = new ParserRegistry();
registry.register(new TxtMdHtmlParser());
registry.register(new PdfParser());
registry.register(new PandocParser());      // DOCX/PPTX/EPUB/ODT 等
registry.register(new XlsxParser());
registry.register(new ImageOcrParser());

const parser = registry.getParser('.docx');
const { text, metadata } = await parser.parse(filePath);
```

### 3.3 解析器实现（优先用思源 Pandoc API）

参考 `terwer/siyuan-plugin-importer` 插件——SiYuan 内置 Pandoc 引擎（`/api/convert/pandoc`），可以转几十种格式。**能用 Pandoc 的不用 npm 包**：

| 格式 | 实现方式 | 依赖 |
|------|---------|------|
| TXT/MD/HTML/CSV/TSV | 已有多格式读取 | 无（已有） |
| PDF | `pdfjs-dist` | 已有 |
| DOCX, PPTX, EPUB, ODT, RTF, Org, RST, LaTeX | **SiYuan Pandoc API** | 无（思源内置） |
| XLSX | `xlsx (SheetJS)` | 新增（Pandoc 对 Excel 不行） |
| PNG/JPG/BMP/TIFF/WebP | `tesseract.js` OCR | 新增 |
| 思源文档 | SiYuan HTTP API | 已有 |
| 网页 URL | `fetchWebPage()` | 已有 |
| 粘贴文本 | 直接使用 | 无 |

对比 `chatboxai/chatbox` 的覆盖范围：PDF/DOCX/EPUB/TXT/MD/图片 — 我们完全覆盖，少了 3 个 npm 包。

### 3.4 支持的文件扩展名

```
.txt, .md, .log, .html, .htm, .csv, .tsv,
.pdf,
.docx, .doc,
.pptx, .ppt,
.xlsx, .xls,
.epub,
.odt, .rtf, .org, .rst, .tex,   ← Pandoc 免费赠送
.png, .jpg, .jpeg, .bmp, .tiff, .webp
```

### 3.5 错误处理

- 导入失败不阻塞：创建 SourceRecord 并标记 `chunkStatus: 'error'`
- 失败条目在 UI 中显示红色标记 + "重试"按钮
- 用户可以手动触发重试（`retryCount + 1`）

---

## 4. UI 重组

### 4.1 5 个顶级 Tab

```
1. 📂 来源库    2. 💬 RAG 对话    3. 🃏 制卡    4. 🧠 导图    5. ⚙️ 设置
```

### 4.2 Tab 3「制卡」— 子 Tab

```
制卡 | 复习 | 浏览 | 导入
```

- **制卡**：原 Generate.svelte 面板
- **复习**：原 Review.svelte 面板
- **浏览**：原 Browse.svelte 面板
- **导入**：原 Import.svelte 面板（仅 Anki/备份导入，无来源导入）

### 4.3 Tab 4「导图」

```
原 Concepts.svelte（图谱） + 原 Mindmap.svelte（导图）合并
模式切换：图谱视图 / 导图视图
共享 ConceptStore 数据
```

### 4.4 Tab 5「设置」

```
原 Settings.svelte 从 Dialog 模式改为独立 Tab
```

### 4.5 删除的 Tab

- 统计 Tab（原 Stats.svelte）→ 删除
- 独立导图 Tab（原 Mindmap.svelte）→ 合并到导图 Tab

---

## 5. 来源库 Tab 详细设计

### 5.1 布局

```
┌─────────────────────────────────────────────────┐
│ [导入 ▼]  [搜索来源...]  [全部 ▼]  [排序 ▼]      │  ← 顶部工具栏
├─────────────────────────────────────────────────┤
│ ☑ 来源标题 1                         file   ✓   │
│ ☑ 来源标题 2                         url    ✗   │  ← 来源列表
│ ☑ 来源标题 3                         pdf    ✓   │
│ ...                                             │
├─────────────────────────────────────────────────┤
│ 已选 3 项    [删除选中]  [用于RAG对话]  [制卡]   │  ← 底部操作栏
└─────────────────────────────────────────────────┘
```

### 5.2 导入下拉菜单

```
📄 文件（上传文件）     → 打开文件选择器
📎 粘贴（粘贴文本）     → 弹出粘贴对话框
🌐 URL（网址）          → 弹出 URL 输入框
📕 PDF（上传 PDF）      → 打开 PDF 文件选择器
📑 思源文档（搜索选择） → 弹出 SourcePicker 搜索已有思源文档
```

### 5.3 列表项展示

每条来源显示：
- 复选框
- 标题
- 类型图标
- 状态指示器（✓ done / ⏳ pending / ✗ error）
- 导入时间
- 操作按钮（重试 / 删除）

### 5.4 底部操作栏

- **已选 N 项**：选中计数
- **删除选中**：批量删除（whereUsed > 0 时弹出确认）
- **用于 RAG 对话**：通过共享 Store（`appStore.selectedSourceIds`）传递勾选，跳转到 RAG Tab
- **用于制卡**：同理，跳转到制卡 Tab

跨 Tab 状态传递方式：`appStore` 中新增 `selectedSourceIds: string[]` 字段，接收方 Tab 在 `onMount` 时读取并清空。

---

## 6. 面板间数据流

### 6.1 RAG 对话面板

- 顶部的来源范围选择器：展示来源库中 chunkStatus='done' 的所有条目
- 用户发送消息时：`ragQuery(question, { sourceIds: selectedSourceIds })` → 只在选中来源的向量中搜索
- 不选中任何来源：搜索整个向量存储

### 6.2 制卡面板

- 来源选择区域：从来源库选取来源 + 思源文档 + 手动输入
- `buildPipelineSources()` 改为：
  1. 从 SourceStore 读取选中的来源全文
  2. 从思源 API 读取选中文档全文
  3. 合并手动文本
  4. 统一送入管线

### 6.3 导图/图谱面板

- 来源模式从来源库选取来源
- 生成概念图时使用 SourceStore 内容

---

## 7. 数据迁移（旧→新）

### 7.1 SourceRef 迁移

```typescript
function migrateSourceRef(oldRef: { type: string; sourceId?: string; [k: string]: any }): SourceRef {
  switch (oldRef.type) {
    case 'siyuan-doc':
    case 'manual':
      return { ...oldRef, type: oldRef.type } as SourceRef;
    case 'file':
    case 'url':
    case 'pdf':
    case 'rag':
      return { ...oldRef, type: 'source' } as SourceRef;
    case 'opennotebook':
      return { ...oldRef, type: 'source' } as SourceRef; // 需要保留 sourceId 以便追溯
    default:
      return { ...oldRef, type: 'manual' } as SourceRef;
  }
}
```

### 7.2 向量存储

- 现有 VectorStore 数据不变（`'rag-vectors'` 键）
- VectorEntry.sourceId 与新 SourceStore.id 对齐
- **去重策略**：导入时对文件内容计算 SHA-256（`contentHash`），如果 `contentHash` 已存在则跳过导入并提示用户"此文件已导入"。URL 来源额外检查 `metadata.url` 是否已存在。思源文档以 `siyuanDocId` 匹配。

---

## 8. npm 依赖变更

### 新增（仅 2 个）

```
xlsx                ^0.18.5  (XLSX 解析，Pandoc 不支持)
tesseract.js        ^5.1.0   (图片 OCR)
```

### 不需要的（已被 SiYuan Pandoc API 代替）

| 原本计划 | 代替方案 |
|----------|---------|
| mammoth (DOCX) | SiYuan Pandoc `/api/convert/pandoc` |
| node-pptx-parser (PPTX) | SiYuan Pandoc `/api/convert/pandoc` |
| epub (EPUB) | SiYuan Pandoc `/api/convert/pandoc` |

Pandoc 额外赠送：ODT, RTF, Org, RST, LaTeX — 零成本支持。

### 保留

所有现有依赖不变。

---

## 9. 文件结构变更

### 新增文件

| 路径 | 说明 |
|------|------|
| `src/libs/source-store.ts` | SourceStore 类，管理 SourceRecord[] + whereUsed 追踪 |
| `src/libs/parsers/` | 文件解析器目录（FileParser 接口 + 注册表模式） |
| `src/libs/parsers/types.ts` | SourceFileParser 接口 + ParseResult 类型 |
| `src/libs/parsers/registry.ts` | ParserRegistry 注册表 + 扩展名分发 |
| `src/libs/parsers/txt-md-html-parser.ts` | 文本/MD/HTML 解析（已有逻辑封装） |
| `src/libs/parsers/pdf-parser.ts` | pdfjs-dist 封装 |
| `src/libs/parsers/pandoc-parser.ts` | SiYuan Pandoc API 封装（DOCX/PPTX/EPUB/ODT/RTF 等） |
| `src/libs/parsers/xlsx-parser.ts` | SheetJS 封装 |
| `src/libs/parsers/image-ocr-parser.ts` | tesseract.js 封装 |
| `src/libs/parsers/siyuan-doc-parser.ts` | 思源文档读取封装 |
| `src/panels/SourceLibrary.svelte` | 来源库新面板 |
| `src/panels/Knowledge.svelte` | 合并后的导图面板（图谱+导图） |

### 修改文件

| 路径 | 变更 |
|------|------|
| `src/index.ts` | 注册新 Tab，addIcons 可能需要新增图标 |
| `src/App.svelte` | 更新 tabs 数组（5 tab + 子 tab 路由） |
| `src/libs/types/concept.ts` | 简化 SourceRef 类型定义 |
| `src/libs/source-refs.ts` | 更新 TYPE_LABELS，删除 opennotebook 处理 |
| `src/libs/store/concept-store.ts` | 更新 VALID_SOURCE_TYPES |
| `src/libs/ai/pipeline.ts` | 支持从 SourceStore 读取来源 |
| `src/libs/ai/source-hub.ts` | 增加 source 类型处理 |
| `src/panels/Rag.svelte` | 移除导入 UI，新增来源范围选择器 |
| `src/panels/Concepts.svelte` | 移除独立来源选择，改用来源库 |
| `src/panels/Generate.svelte` | 移除独立来源选择，改用来源库 |
| `src/panels/Mindmap.svelte` | 合并到 Knowledge.svelte |

### 删除文件

| 路径 | 原因 |
|------|------|
| `src/panels/Stats.svelte` | 删除统计 Tab |
| `src/panels/SourcePicker.svelte` | 合并到来源库 UI，思源文档选择器保留 |

---

## 10. 测试计划

### 新增测试

| 测试脚本 | 覆盖范围 |
|----------|---------|
| `test_source_store` | SourceStore CRUD、save/load |
| `test_parsers` | 每种解析器的正确性（需样本文件） |
| `test_source_ref_migration` | 旧 SourceRef 类型自动迁移 |
| `test_source_library_ui` | 来源库面板 UI 契约 |

### 更新测试

| 测试脚本 | 变更 |
|----------|------|
| `test_pipeline` | 验证从 SourceStore 读取来源 |
| `test_ui_contracts` | 更新面板引用（新 Tab 结构） |

---

## 11. 非目标（不做）

- ❌ 不做向后兼容旧 `opennotebook` SourceRef 标签（旧数据显示 "旧来源" 即可）
- ❌ 不做复杂 OCR 引擎（只用 tesseract.js，不做 detectron2）
- ❌ 不做云端存储（来源数据存储在思源 data/ 目录，通过 saveData 持久化）
- ❌ 不做协同编辑（来源库为单用户）
- ❌ 不做来源版本管理
- ❌ 不集成 Unstructured Python 后端（仅文档留未来扩展点）
