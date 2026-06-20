# 测试与部署手册

本文档记录当前项目已经存在的测试层次，以及每层测试证明什么、不证明什么。

## 1. 快速本地验证

```bash
npm run verify
```

包含：

- `npm run typecheck`
- `npm test`
- `npm run build`

它证明 TypeScript 类型、核心单元测试、UI 合约测试和生产构建都能通过。

## 2. 单项测试

```bash
npm run test:json
npm run test:prompt-contracts
npm run test:notebook-client
npm run test:sources
npm run test:source-refs
npm run test:notebook-bridge
npm run test:ui-contracts
npm run test:render
npm run test:providers
npm run test:exporters
npm run test:mindmap-cards
npm run test:selection
npm run test:pipeline
npm run test:concept-store
npm run test:graph
npm run test:concept-mindmap
npm run test:card-id
```

重点说明：

- `test:json`：验证 `parseLLMJSON` 对不稳定模型输出的修复能力。
- `test:prompt-contracts`：验证提示词包含结构化输出和质量契约。
- `test:notebook-client`：验证 OpenNotebook API 路径、chat context、notes detail。
- `test:sources`：验证 OpenNotebook 搜索结果、选中 note detail、思源文档 Markdown 转成 `PipelineSource`。
- `test:notebook-bridge`：验证 Notebook 面板到 Concepts 面板的 query/sourceIds/noteIds。
- `test:ui-contracts`：静态检查关键 UI wiring，防止重构时断掉跳转和诊断。
- `test:render`：验证 Markdown/HTML fallback、LaTeX delimiter 保留、Lute 优先、导图节点公式 inline-safe。
- `test:providers`：验证主流 provider 的 endpoint 解析、鉴权头、请求体、响应文本抽取和本地无 key 兼容服务。
- `test:exporters`：验证 JSON、CSV、Anki TSV、Markdown、概念图 JSON、导图 Markdown 导出格式。
- `test:mindmap-cards`：验证导图节点解析、导图制卡草稿归一化、`linkedCardIds` 合并。
- `test:pipeline`：验证候选确认会创建概念、关系、卡片，并跳过重复/不合格卡片。
- `test:concept-mindmap`：验证概念图可以同步成 mindmap markdown。

## 3. 部署到本机 SiYuan

先构建：

```bash
npm run build
```

再部署：

```bash
npm run deploy:siyuan -- --apply
```

部署目标：

```text
<SiYuan data>/plugins/siyuan-all-in-one/
```

自定义 SiYuan 工作空间时：

```bash
npm run deploy:siyuan -- --apply --siyuan-data "/path/to/SiYuan/data"
npm run check:full -- --siyuan-data "/path/to/SiYuan/data"
```

脚本会复制：

- `index.js`
- `index.css`
- `plugin.json`
- `icon.png`
- `README.md`
- `README_zh_CN.md`
- `i18n`

同时会在项目下创建 `.deploy-backups/<timestamp>/`。

## 4. 本机完整检查

```bash
npm run check:full
```

包含：

- `check:siyuan -- --strict-deploy`
- `check:data`
- `check:runtime`
- `check:bundle`

它证明：

- 部署目录存在且关键文件齐全。
- 部署 JS/CSS 与当前 `dist` 一致。
- 插件数据目录可读。
- 真实卡片、概念、关系、导图数据能被当前代码兼容读取。
- SiYuan kernel 可访问，插件已启用。
- 运行时加载的 JS/CSS 与部署目录一致。
- bundle 包含 Notebook、Concepts、Mindmap、Review、Diagnostics、SourceRefs 等关键模块。
- bundle 不包含配置里的真实 API key。

## 5. 真实 OpenNotebook + LLM 检查

```bash
npm run check:live
```

包含：

- `check:ai-live`
- `check:e2e-live`

它会读取真实配置，调用真实 OpenNotebook 和 LLM。脚本设计为不改真实数据：

- `check:ai-live` 只生成候选，不保存。
- `check:e2e-live` 使用内存版 plugin/store 完成确认和导图同步。
- 脚本用 `cards/config/concepts/relations/mindmaps` 的内容哈希比较前后状态。

如果想改测试 query：

```bash
npm run check:live -- --query "your query"
```

或设置环境变量：

```bash
set OPENNOTEBOOK_TEST_QUERY=impulse momentum
npm run check:live
```

## 6. 插件内人工验收

部署后重启 SiYuan 或重载插件，然后检查：

1. 顶栏图标能打开 All-in-One 主 Tab。
2. `诊断` 面板基础检查通过。
3. `诊断` 面板 AI dry run 能生成概念、关系、卡片候选，且报告可复制。
4. `问答` 面板能列出 OpenNotebook notebooks、sources、notes。
5. 选择 source/note 后点生成候选，会跳到 `概念` 面板。
6. 重复点击同一个 source/note 也会重新触发 `概念` 面板。
7. `概念` 面板的“混合来源”可以叠加手动文本、OpenNotebook 和多个思源文档。
8. `概念` 面板生成候选后，可以编辑概念、关系和卡片，再确认写入。
9. 从已关联概念的卡片可以同步并打开概念导图。
10. `导图` 面板可以从当前导图生成卡片，并保持导图 `linkedCardIds` 关联。
11. `导入导出` 面板可以导出卡片 JSON/CSV/Anki TSV/Markdown、概念图 JSON、导图 Markdown。
12. SourceRef 可以跳回 OpenNotebook、SiYuan 块或 URL。
13. 复习面板仍能按 SM-2 调度旧卡片。
14. 带公式的卡片在 Review、Browse、Concepts 候选、Notebook 聊天、Mindmap 复习浮层中可以渲染。

## 7. 本轮实际通过结果

2026-06-21 已通过：

```bash
npm run verify
npm run deploy:siyuan -- --apply
npm run package:release
npm run check:full
npm run check:live
npm run check:data
```

真实数据复查结果：

- cards: 133
- concepts: 0
- relations: 0
- mindmaps: 0

说明 live E2E 没有把测试写入真实插件数据。

本轮新增验证：

- `test:providers` 覆盖 DeepSeek/OpenAI-compatible/Gemini/Anthropic 等 provider adapter。
- `test:exporters` 覆盖导出格式兼容层。
- `test:sources` 覆盖思源文档到 `PipelineSource` 的转换。
- `test:ui-contracts` 覆盖 `Concepts.svelte` 混合来源入口、候选编辑、导出 UI wiring。

## 8. 常见风险

- 终端可能显示中文乱码，但源码大多是 UTF-8；不要仅凭 PowerShell 输出判断文件损坏。
- `npm run verify` 会重新生成 `dist`；跑完后需要再次 `deploy:siyuan -- --apply` 才能让 SiYuan 加载最新构建。
- SiYuan 可能触碰数据文件 mtime；判断 live 脚本是否改真实数据应看内容哈希。
- 浏览器自动化当前不稳定，优先依赖脚本和插件内 Diagnostics。
- OpenNotebook API 字段可能随版本漂移，source adapter 应保持宽松归一化。
