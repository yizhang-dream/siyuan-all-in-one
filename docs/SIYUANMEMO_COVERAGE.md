# SiYuanMemo 功能覆盖矩阵

目标：本插件最终应覆盖 SiYuanMemo 的核心学习能力，并在 NotebookLM 式来源处理、概念图谱、思维导图关联闪卡、多来源证据链上超过它。本文按 SiYuanMemo 发布包 README 与 i18n 暴露能力拆解，标记当前状态和后续实现顺序。

调研来源见 `docs/SIYUANMEMO_REVIEW.md`。

## 覆盖原则

- **不复制 bundle**：SiYuanMemo 仓库当前主要暴露发布包，未展开源码；本插件不直接复制压缩代码。
- **覆盖能力，不照搬交互**：SiYuanMemo 偏块内符号监听、队列与神经漫游；本插件主线是来源选择、候选确认、概念图谱、导图和卡片联动。
- **块 ID 作为锚点**：兼容思源生态和 SiYuanMemo 的块级思路，但保留 `Concept/Card/Mindmap/SourceRef` 结构化真源。
- **Riff 作为投影层**：复用思源原生卡包和 FSRS 能力，但不让 Riff 吞掉插件图谱语义。

## 功能矩阵

| SiYuanMemo 能力 | 当前覆盖 | 当前证据 | 差距 | 下一步 |
|---|---:|---|---|---|
| FSRS 间隔重复 | 部分 | `ts-fsrs` 调度器、设置页切换、`test:srs` | 缺学习/重学步骤 UI、复习日志回放、参数优化器 | 增加复习日志与 FSRS 参数预设 |
| Final Drill / 机械练习 | 部分 ✅ | `consecutiveLapses` 计数、`drill` 卡片状态、连续 2 次 Again 进入 drill、Easy 退出 drill | UI 未展示独立 drill 队列入口；缺 drill 频率控制 | Review 面板增加 drill 计数和队列视图 |
| Retrieval Practice 队列 | 部分 | Review 面板按到期卡复习 | 缺多队列提交语义、队列排序、手动插队 | 抽象 QueueStore |
| Incremental Learning / 渐进学习 | 未覆盖 | 无 topic/excerpt 队列 | 缺摘录、Topic、渐进阅读 | 与 OpenNotebook/SiYuan 文档摘录联动 |
| Filtered Review / 筛选复习 | 部分 | Browse 筛选/选中卡片可进入临时复习队列；导图 `有卡/缺卡/邻域` 视图 | 导图筛选结果尚不能直接进入复习；缺持久化队列 | 从导图创建临时筛选复习队列，并抽象 QueueStore |
| Neural Roaming / 神经漫游 | 部分 | 概念图、SourceRef 回跳、导图搜索邻域 | 缺扩散激活、轨迹历史、汇合节点 | 以 `ConceptGraph + backlink/sourceRefs` 做漫游原型 |
| CDF 概念描述符制卡 | 部分 ✅ | 概念优先 pipeline、cardType、提示词质量契约、CDF 维度制卡 toggle（定义/公式/过程/对比/应用/因果/限制等维度） | descriptorDimension 字段仅存于候选层，未落持久化；缺双向卡生成 | 增加 CDF 维度持久化与反向卡自动生成 |
| 符号监听制卡 | 部分 ✅ | `>>` qa、`<<` reverse、`<>` cloze、`;;` 备用语法；Generate 面板自动检测符号卡片数量并一键创建 | 未监听思源编辑器实时输入；缺 `\` 多行延续语法 | 可选扩展编辑器输入监听 |
| 原生快速制卡监听/同步 | 部分 | Riff API 适配、Riff 同步入口 | 缺监听思源原生快速制卡并导入插件 | 增加只读扫描/导入 Riff 卡片入口 |
| 一块多卡 | 部分 | 插件 `Card` 与 `SourceRef.blockId` 可多卡指向同块 | UI 未聚合同块卡，导出/审计弱 | Browse/Review 增加“同来源/同块卡片”面板 |
| 块级复习入口 | 部分 | SourceRef 可跳块；Riff 同步把卡投影成块 | 缺块菜单“复习当前块及子块” | 增加 block menu 与基于 blockId subtree 的筛选队列 |
| SRS Browser 表格管理 | 部分 | Browse 面板列表/编辑/搜索 | 缺表格列排序、批量队列操作、同块卡操作 | 扩展 Browse 为密集表格模式 |
| 卡片规划：提前/推迟/分摊/排序 | 部分 | SM-2/FSRS 基本调度 | 缺 bulk reschedule、queue ordering | 增加批量排期操作 |
| 公式制卡与公式复习稳定 | 部分 | 渲染层保留 LaTeX，Review/Browse/Mindmap 渲染公式 | 缺公式块局部挖空制卡 | 加 cloze 公式候选和测试 |
| 图片遮挡卡 | 部分 ✅ | `ImageOcclusionRegion`/`ImageOcclusionCard` 数据模型、`image-occlusion` 卡片类型、`CARD_TYPE_LABELS` 翻译 | 缺画布编辑器和复习渲染 | 后置 canvas/SVG 遮挡编辑器 |
| 有序/无序列表模板卡 | 部分 | Markdown/导图节点制卡 | 缺列表模板解析与渐进提示 | 增加 SiYuan list block importer |
| AI 制卡 / AI 工作台 | 部分 | 多 provider、prompt pipeline、候选确认 | 缺会话式 AI 工作台和工具审批 | 可在 Notebook/Concepts 基础上扩展 |
| 摘录与渐进阅读 | 部分 | OpenNotebook/SiYuan 多来源输入 | 缺 Alt+X 摘录、Topic 管理 | 做“摘录到候选区/概念区” |
| Riff 同步 | 部分 | 手动同步到思源块与 Riff，重复同步跳过/更新；Import 面板展示 fresh/stale/unsynced/orphan 投影审计 | 缺反向导入 Riff、真实块存在性扫描 | 增加 Riff 反向读取和块存在性校验 |
| 块属性清理 | 部分 ✅ | `buildBlockAttrScanReport` 基于 riff-sync 记录扫描已知属性块；Import 面板显示扫描结果和属性键列表 | 未调用思源 API 真实扫描块属性；无可选 block ID 的精确清理 | 增加思源 API 属性扫描和选择性清除 |
| 移动端适配 | 部分 ✅ | 4 个面板有 `@media` 响应式断点（Concepts 1200px/900px、Generate 720px、Import 720px、Stats 600px）；11 个面板使用 `min-width: 0` 防溢出；`plugin.json` 声明 mobile/browser-mobile frontend | 未做 375px 超窄视口/触屏专项测试；侧栏导航在极小宽度未折叠 | 增加 375px 触屏 UI 冒烟和导航折叠 |

## 当前已经超过 SiYuanMemo 的方向

- 混合来源：手动文本、OpenNotebook source/note、SiYuan 文档可进入同一 pipeline。
- 候选确认：概念、关系、卡片确认前可编辑，关联用 tempId 保持。
- 导图/卡片/图谱三路径：来源一次性生成、卡片生成导图、导图生成卡片。
- 导图缺口发现：`全部/有卡/缺卡/邻域` 视图直接回答“哪些知识点还没卡”。
- Provider 结构化输出适配：OpenAI-compatible、Gemini、Anthropic、自定义兼容服务的 JSON 策略和回退。
- 兼容导入导出：卡片 JSON/CSV/Anki TSV/Markdown、概念图 JSON、导图 Markdown 元数据恢复。

## 优先实现路线

### P0：把现有范式做扎实

1. Riff/块投影审计：已展示本地映射中的已同步、待更新、未同步、孤儿记录；下一步补真实块存在性扫描。
2. CDF 候选模式：把来源材料先拆成概念锚点和描述维度。
3. 从导图缺卡节点直接生成候选卡，并保留节点路径和 conceptId。
4. Browse/Review 增加同概念、同来源、同导图节点的聚合操作。

### P1：覆盖 SiYuanMemo 队列能力

1. QueueStore：普通复习、Browse 临时筛选复习、导图临时筛选复习、drill 队列统一抽象。
2. Final Drill：低评分进入临时机械练习，评分 4 移出。
3. 手动插队、队列排序、批量提前/推迟/分摊。

### P2：覆盖块级和渐进阅读能力

1. block menu：从当前块/子树创建筛选复习。
2. SiYuan 文档摘录到候选区，形成 Topic/Concept。
3. Riff 反向导入：从思源已有闪卡块创建插件 Card/Concept 链接。

### P3：高级卡型

1. 列表模板卡。
2. 公式 cloze。
3. 图片遮挡卡。

## 验收标准

每个能力从“部分覆盖”升级到“覆盖”，必须同时满足：

- 有数据模型或清晰的外部 API 边界。
- UI 有入口且符合 SiYuan 风格。
- 对真实存储的写操作有确认或可回滚策略。
- 有单元/合约测试。
- 如果涉及真实 SiYuan 数据，检查脚本默认只读，写入行为必须由用户明确触发。
