# SiYuanMemo 源码与设计借鉴

本文记录对 `Dammyxy/siyuan-plugin-siyuanmemo` 的只读调研，用于指导本插件的闪卡、概念、导图联动设计，避免凭印象复刻。

## 调研来源

- 仓库：`https://github.com/Dammyxy/siyuan-plugin-siyuanmemo`
- 本次检查的 HEAD：`4c92866bf5cb0aa44e474d48732816bb2a315e4e`
- 仓库根目录主要包含发布包、README、manifest；未展开 TypeScript 源码。
- 已解压 `package.zip` 检查运行包中的 `README.md`、`README_zh_CN.md`、`i18n/*.json` 与压缩后的 `index.js` 关键字。

因此结论主要来自 README、manifest、发布包文本和 bundle API 痕迹，不把 SiYuanMemo 作为可直接复制源码的依赖。

## 可以借鉴的核心判断

SiYuanMemo 的方向不是“完全使用思源原生闪卡”，而是做第二阶段的闪卡系统：

- 保留思源块作为上下文和双链锚点。
- 解耦块与闪卡，使一个块可以生成多张卡。
- 为插件新增卡型提供自己的复习 UI，避免污染思源原生复习界面。
- 通过块级入口控制复习粒度：当前块、当前文档块及子块。
- 通过神经漫游把双链、概念卡、描述符卡和复习队列结合起来。
- CDF 路线强调先找概念锚点，再拆定义、边界、机制、条件、证据、对比、例子等描述维度。
- 发布包中有 Riff 同步、同块卡片操作、筛选复习、块属性清理、AI CDF 制卡等入口文本。

这些点支持本插件当前判断：**思源块 ID 应是重要锚点，但插件自己的 Card/Concept/Mindmap 仍应保留为真源之一**。只依赖 Riff 的 blockID 模型，会丢失 OpenNotebook sourceRefs、候选编辑、概念关系、导图 linkedCardIds 等语义。

## 对本插件的具体启发

### 1. 块 ID 是锚点，不是唯一卡片 ID

`建议.txt` 提到“统一块 ID 是关联纽带”，SiYuanMemo 又强调“一块多卡”。两者合并后，正确模型应是：

```text
source block/document/note -> concept node -> many card candidates -> mindmap nodes
                         \-> optional SiYuan block/Riff projection
```

本插件已有 `Card.sourceRefs[]`、`ConceptNode.sourceRefs[]` 和 Riff 同步映射。后续应继续增强：

- 为 `SourceRef.blockId`、`SourceRef.sourceId`、`chunkId` 提供更强的 UI 入口。
- 导图节点优先携带 `conceptId/cardId/blockId` 元数据，而不是只靠标题匹配。
- 同一概念允许多张卡，同一块允许多张卡，导图节点只显示聚合状态。

### 2. CDF 可以变成提示词质量约束

SiYuanMemo 的 CDF 思路适合转成我们的候选生成 contract：

- 先抽“概念锚点”。
- 再抽描述维度：定义、边界、机制、条件、证据、对比、例子、误区、适用范围。
- 最后筛掉凑数卡，只保留能稳定回忆的候选。

这和当前 `Concept -> Relation -> CardCandidate` 流水线兼容。后续可加一个 `cdf` 卡片候选类型或 prompt preset，但不必照搬 SiYuanMemo 的符号制卡语法。

### 3. 导图视图应承担筛选复习与缺口发现

SiYuanMemo 有筛选复习队列和块级复习入口。本插件导图天然知道概念层级、卡片挂载和复习状态，因此导图应支持：

- `全部`：完整树。
- `有卡`：只看已挂卡的知识路径。
- `缺卡`：只看还没有卡片的叶子知识点。
- `邻域`：围绕搜索命中显示父链和直接子节点。

当前已在 `Mindmap.svelte` 中落地这四种显示范围；它不修改保存的导图 Markdown，只过滤当前渲染视图。

### 4. Riff 是投影层，不是替换层

SiYuanMemo 发布包和 README 都显示它有 Riff 同步和块属性清理能力，说明即便强化闪卡，也需要处理插件状态和思源状态之间的边界。

本插件当前策略保持不变：

- 插件卡片、概念、导图存储仍保留完整语义。
- “同步到卡包”把插件卡片投影为思源块，再加入 Riff。
- `riff-sync` 只记录本机 blockID/docID/deckID 映射，不能当跨设备备份。
- 清除同步记录不删除思源块和 Riff 卡包。

## 不应照搬的点

- 不直接复制 SiYuanMemo 的 bundle 或私有实现。仓库未提供展开源码，且功能边界和本插件目标不同。
- 不把符号监听制卡作为主交互。本插件主入口应是 NotebookLM 式来源选择、候选确认、图谱/导图/卡片联动。
- 不把神经漫游队列直接做成复习主线。我们的优先路线是概念图谱 + 导图定位 + 源证据回跳；漫游可作为后续探索模式。
- 不用块属性承载全部知识图谱。块属性适合保存投影和回跳元数据，复杂图谱仍应放在插件结构化存储里。

## 已转化为当前实现的事项

- 导图新增 `全部 / 有卡 / 缺卡 / 邻域` 显示范围。
- `filterMindmapMarkdown` 对保存 Markdown 做只读过滤，保护原图和导出兼容性。
- `test:mindmap-cards` 覆盖有卡、缺卡和邻域过滤。
- `test:ui-contracts` 防止导图过滤入口在 UI 重构中丢失。

## 后续建议

1. 增加 `blockId` 级别的导图节点元数据导入/导出，优先复用 `SourceRef`。
2. 在候选确认区加入 CDF 风格卡型建议：概念定义、概念-描述符、对比、机制、条件。
3. 在 Browse/Review 中增加“同来源/同概念/同导图节点”聚合入口，呼应 SiYuanMemo 的同块多卡管理。
4. 为 Riff 同步增加只读审计视图：哪些插件卡已投影到思源块，哪些块失效，哪些卡已编辑待同步。
