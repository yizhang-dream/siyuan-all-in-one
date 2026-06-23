# siyuan-all-in-one v1.0 发布前待办清单

## 必须修复（阻塞发布）

### 1. Rag.svelte `ragContext` 未导入 — 运行时崩溃
- **文件**: `src/panels/Rag.svelte:4,281`
- **问题**: `generateCandidates()` 调用 `ragContext()` 但未在 import 声明中引入，点击"生成候选"会抛 `ReferenceError`
- **修复**: import 行补上 `ragContext`

### 2. plugin.json 描述/关键词仍提及 OpenNotebook
- **文件**: `plugin.json:29-30,52`
- **问题**: description 和 keywords 宣传已删除的 OpenNotebook 集成，误导用户
- **修复**: 重写 description，删除 OpenNotebook keyword

### 3. Concepts.svelte 大量死代码 — 类型未导入会隐式 `any`
- **文件**: `src/panels/Concepts.svelte`
- **问题**: 
  - `Notebook`/`Source` 类型引用但未导入（line 34,36）
  - `OpenNotebookClient` 构造但未导入（line 285）— 若调到会崩溃
  - 10+ 废弃变量、4 个废弃函数、6 段废弃 CSS
- **修复**: 删除全部 OpenNotebook 死代码

### 4. Mindmap.svelte `fetchContext` 参数错误
- **文件**: `src/panels/Mindmap.svelte:268,669`
- **问题**: `fetchContext(sourceConfig, cfg.notebookEndpoint)` 传了不存在的第二参数；"知识库"按钮永远 disabled
- **修复**: 删除第二参数，删除或隐藏"知识库"源标签页

---

## 应该修复（发布质量）

### 5. RAG 模块零测试
- **现状**: chunker/embedder/vector-store/ingest/query/rag-bridge 无任何测试
- **建议**: 至少覆盖 chunker（分块逻辑）、vector-store（余弦相似度）、query（端到端检索）

### 6. 嵌入回退 UX 文案不准
- **文件**: `Rag.svelte:330`
- **问题**: 显示"回退关键词匹配"，实际是零向量余弦搜索（按索引顺序返回，不是关键词匹配）
- **修复**: 改为"回退顺序匹配"或实现真正的关键词 fallback

### 7. ARCHITECTURE.md 严重过时
- 仍描述 Notebook.svelte、Diagnostics.svelte、Models.svelte（已删除）
- 仍描述 notebook.ts、source-adapters.ts（已删除）
- 未记录新增的 RAG 系统（rag/*.ts、Rag.svelte、VectorStore）
- **修复**: 重写架构文档

### 8. 构建产物 3.7MB
- `@xenova/transformers` + ONNX runtime 全量打包
- **建议**: 考虑 CDN 加载或 code-split，首次解析不阻塞插件启动

### 9. SourceRef `'opennotebook'` 旧数据标签显示
- 旧卡片的 `type:'opennotebook'` sourceRef 加载正常，但 TYPE_LABELS 缺 `opennotebook` 条目
- **建议**: 补上 `opennotebook: 'OpenNotebook（已废弃）'` 或迁移旧数据

---

## 可选优化（锦上添花）

### 10. Concepts.svelte `buildPipelineSources` 传无效字段
- 传了 `notebookEndpoint`/`notebookQuery`/`notebookSourceIds` 等 SourceHubRequest 没有的字段
- 被 TypeScript 静默忽略，不影响运行
- **建议**: 清理后可删

### 11. `appliedNotebookTargetKey` 废弃变量
- 声明后从未赋值
- **建议**: 随死代码清理一起删

### 12. README.md 检查
- 可能仍有 OpenNotebook 相关描述
- **建议**: 发布前通读一遍

### 13. SourcePicker `source-hint--warn` 样式
- 删除知识库标签后，警告提示（"请先配置 Open Notebook 端点"）已不会触发
- 相关代码已删，但 CSS class 仍存在
- **建议**: 清理无用 CSS

---

## 当前面板清单（8 个）

| 标签页 | 文件 | 状态 |
|---|---|---|
| 复习 | Review.svelte | ✅ 完整 |
| 浏览 | Browse.svelte | ✅ 完整 |
| 制卡 | Generate.svelte | ✅ 完整 |
| 导入 | Import.svelte | ✅ 完整 |
| RAG | Rag.svelte | ⚠️ 缺 `ragContext` 导入 |
| 图谱生成 | Concepts.svelte | ⚠️ 大量死代码 |
| 导图 | Mindmap.svelte | ⚠️ fetchContext 参数错误 |
| 统计 | Stats.svelte | ✅ 完整 |

## 测试覆盖（22 个脚本）

| 模块 | 测试 | 状态 |
|---|---|---|
| SRS 调度 | test_srs_scheduler | ✅ |
| AI 流水线 | test_pipeline | ✅ |
| 概念存储 | test_concept_store | ✅ |
| 卡片导入导出 | test_exporters + test_importers | ✅ |
| 源中心 | test_source_hub | ✅ |
| 来源引用 | test_source_refs | ✅ |
| UI 契约 | test_ui_contracts | ✅ |
| RAG 分块 | — | ❌ 缺失 |
| RAG 向量存储 | — | ❌ 缺失 |
| RAG 检索 | — | ❌ 缺失 |
| RAG 嵌入 | — | ❌ 缺失 |
