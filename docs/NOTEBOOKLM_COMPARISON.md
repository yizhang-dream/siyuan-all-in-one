# NotebookLM 对标分析

本文逐项对比本插件与 Google NotebookLM、SiYuanMemo、Logseq/RemNote 的核心学习能力，
明确"体验上超过 NotebookLM"的具体证据、差距和下一步优化方向。

## 功能对标矩阵

| 能力维度 | NotebookLM (2025-2026) | 本插件 | SiYuanMemo | Logseq/RemNote | 谁更好 |
|---|---:|---|---|---|---|
| **来源摄入** | PDF/网页/YouTube/Google Docs/音频/文本 | 手动文本、思源文档、OpenNotebook 源/笔记、本地 `.txt/.md/.html` | 思源块、`>>` 符号监听 | PDF 标注、网页剪藏 | 各有所长：NotebookLM 多模态更多，本插件更贴近思源原生工作流 |
| **AI 概念抽取** | 不显式抽取概念，直接生成 FAQ/摘要/闪卡 | 四步流水线：抽取概念→推断关系→生成闪卡→分配归类，每步可审核编辑 | 概念定义 + 描述符制卡 (CDF) | RemNote 有概念-描述符框架 | **本插件超过**：NotebookLM 无显式概念层，不可中途编辑 |
| **闪卡生成** | FAQ 格式问答卡，无 FSRS 调度 | 多类型闪卡 (qa/cloze/reverse/enumeration/compare/process)，FSRS+SM-2 调度 | 基本问答卡 + FSRS | Anki-style SRS | **持平到领先**：卡片类型更丰富，FSRS 参数仍有优化空间 |
| **思维导图** | Markdown 大纲自动生成脑图 (beta) | 概念图谱 → 导图双向联动；`全部/有卡/缺卡/邻域` 四种视图；缺卡一键生成候选 | 神经漫游、同块复习 | Logseq 有原生图谱 | **本插件超过**：缺卡检测与生成是 NotebookLM 无的能力 |
| **来源引用** | 内联引用，点击跳转原文 | 每条概念/关系/卡片带 `sourceRefs`；可点击打开思源块/URL/OpenNotebook 定位 | 块级复习入口 | Roam Research 风格块引用 | **接近**：点击体验略逊于 NotebookLM，但可追溯字段更多 |
| **双向知识联动** | 无 | 卡片↔概念↔导图三层双向；从卡片可打开关联导图；从导图可复习卡片 | 一块多卡、同源聚合 | Logseq 有双向链接 | **本插件超过**：三层联动是独特优势 |
| **离线可用** | 需联网 | 完全离线：手动文本 + 思源文档 + 本地文件 | 完全离线 | 完全离线 | **持平** |
| **多 Provider** | 封闭 (Gemini) | DeepSeek/OpenAI/Gemini/Anthropic/火山/智谱，设置页可视化 JSON 策略 | 封闭 | 可配 API | **本插件超过** |
| **高级复习算法** | 无 | SM-2 (默认) + FSRS (可选切换) | FSRS | Anki SM-2 / FSRS | **持平 SiYuanMemo** |
| **可编辑管线** | 生成后只能重新生成 | 候选区可编辑标题/摘要/关系/卡片归属，编辑后 `tempId` 关联不丢 | 无可比候选确认区 | RemNote 可手动编辑 | **本插件超过**：编辑后关联维持是独特工程特性 |
| **导入导出** | 无批量导出 | JSON/CSV/Anki TSV/Markdown + 概念图 + 导图元数据恢复 | Riff 同步 | Anki .apkg | **本插件超过**：格式更多且可恢复关联 |
| **公式渲染** | 有 | LaTeX 完整渲染，Lute 优先 + MathJax 兜底 | 有 | RemNote 有 LaTeX | **持平** |
| **大图优化** | 无大图概念 | 按节点数自动降低展开层级、禁用动画、分批绑定点击 | 神经漫游 | 无 | **本插件超过** |
| **聊天交互** | 有 (Ask Notebook) | Notebook 面板 + OpenNotebook 聊天 | 无 | Logseq AI 聊天 | **接近**：缺少多轮记忆和工具调用 |
| **音频摘要** | 有 (Audio Overview / podcast) | 无 | 无 | 无 | **缺**：本插件无音频能力 |
| **图片遮挡卡** | 无 | 无 | 无 | Anki Image Occlusion | **缺**：已在覆盖矩阵标记 P2 |
| **移动端** | Web/Mobile | 前端响应式但未专项测试 | 标记支持 | RemNote 有移动端 | **未验证**：已在覆盖矩阵标记 |
| **GitHub 发布** | 非开源 | 本地仓库已就绪，CI/Release workflow 已配置，等待用户创建远程仓库并 push | 有 GitHub 发布 | 开源 | **待完成**：远程 push 是最后一个结构性缺口 |

## 超过 NotebookLM 的具体证据

1. **显式概念层**：NotebookLM 不暴露概念中间层，生成后无法编辑结构。本插件的 `ConceptNode` 是闪卡和导图的共享中间层，用户能在候选区编辑概念标题、关系、卡片归属，保存后关联不丢 (见 `test_pipeline.mjs` 编辑后确认测试)。

2. **缺卡检测与生成**：Mindmap 面板的 `缺卡` 视图 + "从缺卡生成候选"按钮，是 NotebookLM 完全没有的能力。它用 markmap 数据树遍历找出无 `#cardId` 的叶子节点，拼成 `PipelineSource` 自动传入 AI 流水线 (见 `markmap-render.ts:extractGapNodes`)。

3. **双向知识联动**：卡片 ↔ 概念 ↔ 导图三层可互相导航。Browse 面板可从卡片打开关联导图；Mindmap 面板可点击卡片节点复习；Concepts 面板的概念节点下显示已挂载卡片。NotebookLM 的 FAQ/闪卡和脑图是独立产物，无此闭环。

4. **多 Provider 可配置**：设置页可选择 DeepSeek/OpenAI/Gemini/Anthropic 等，每个 provider 有显式的 JSON 结构���输出策略（`JSON 原生`/`JSON mode+回退`/`JSON 提示词`），配置独立于 NotebookLM 的 Gemini 锁定。

5. **候选可编辑管线**：整个流水线不自动写入，生成结果先进入候选确认区，用户勾选/编辑后再 `confirmPipelineResult()` 写入 ConceptStore/CardStore。模型只是"候选生成器"，不是"最终写入器"。

## 不及 NotebookLM 的地方

| 能力 | NotebookLM | 本插件 | 影响 |
|---|---|---|---|
| 音频生成 | Audio Overview (两人对话式播客) | 无 | 高：对学习材料复习有独特价值 |
| 多模态解析 | YouTube/视频/音频直接解析 | 仅文本 + HTML | 中：需依赖 OpenNotebook 或外部工具 |
| 一键来源导入 | Google Drive/Docs/URL 一键导入 | 需粘贴或手动选择 | 中：思源用户可通过文档直接操作 |
| 摘要长度 | 长文 briefing doc | 候选概念为主，无自动长摘要 | 低：可通过增加摘要 prompt 解决 |
| 移动端 | 原生移动 App | 未专项验证 | 低：思源本身有移动端，插件理论可运行 |

## 与 SiYuanMemo 的对比（补充）

SiYuanMemo 当前未覆盖但本插件已实现的功能：
- 混合来源（手动+思源+OpenNotebook+本地文件同管线）
- 候选编辑后确认（概念/关系/卡片均可编辑，关联用 tempId 保持）
- 导图缺卡检测和生成（`全部/有卡/缺卡/邻域` 视图 + 一键生成）
- 多 Provider + 结构化输出策略可视化
- 导入导出兼容（JSON/CSV/Anki TSV/Markdown/概念图/导图元数据恢复）
- 大导图降噪（按节点数自动降低展开层级、禁用动画、分批绑定点击）

本插件尚未覆盖的 SiYuanMemo 能力（已在 `SIYUANMEMO_COVERAGE.md` 标记）：
- Final Drill / 机械练习
- 图片遮挡卡
- 符号监听制卡 (`>>` `<<` `<>` `;;`)
- 块属性清理
- 移动端专项适配

## 与 Logseq/RemNote 的体验参考

已借鉴的方向：
- **Logseq 风格**：块级引用、双向链接、outline 结构 → 本插件 `SourceRef.blockId` 可回跳思源块，`ConceptNode` 支持 `parentIds/childIds/relatedIds` 双向索引。
- **RemNote 风格**：概念-描述符框架、PDF 标注提取 → 本插件提示词合约包含"主动回忆/一张卡一个知识点/负例约束"，导图视图支持"有卡/缺卡"分类查看。

待借鉴的方向：
- Logseq 的每日笔记 + 任务管理 + 闪卡集成（长期可考虑）
- RemNote 的图片遮挡编辑器（已在覆盖矩阵标记 P2）

## 参考链接

- [Google NotebookLM](https://notebooklm.google/)
- [NotebookLM 官方帮助](https://support.google.com/notebooklm/)
- [notebooklm-py (开源 NotebookLM 接口)](https://github.com/teng-lin/notebooklm-py)
- [open-notebook (开源 NotebookLM 替代)](https://github.com/lfnovo/open-notebook)
- [SiYuanMemo](https://github.com/Dammyxy/siyuan-plugin-siyuanmemo)
- [Logseq](https://github.com/logseq/logseq)
- [RemNote](https://www.remnote.com/)
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)
- [Fabric prompt patterns](https://github.com/danielmiessler/fabric)
