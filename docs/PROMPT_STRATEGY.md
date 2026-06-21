# 提示词策略与开源借鉴

本文档记录当前提示词设计思路，以及可以借鉴但不照搬的开源方向。

## 1. 当前提示词原则

当前项目的提示词不是单步“从文本生成卡片”，而是四步流水线：

1. 抽取概念候选。
2. 推断概念关系。
3. 生成卡片候选。
4. 将卡片归属到概念。

这种拆分符合本插件的新范式：闪卡和思维导图都不是最终源头，概念图谱才是中间层。

每一步都要求：

- 只基于 SOURCES，不引入外部知识。
- 输出 JSON object。
- 候选项必须带 `sourceRefs`。
- 证据不足进入 `uncertain` 或 `warnings`。
- 自然语言字段用用户指定语言，机器字段保持 schema。

## 2. 可借鉴的开源方向

这些项目/方向值得借鉴的是设计原则，不是直接复制 prompt。

- NotebookLM 类项目强调 source-grounded、citation-backed 答案。例如 notebooklm-py、NotebookLM MCP/skill 类项目都把“回答必须来自上传来源，并能回链证据”作为核心能力。
- 开源 NotebookLM 替代品如 SurfSense、SmartDoc AI、SoyLM 的共同方向是：多来源 ingestion、RAG、可配置模型、隐私优先。这支持本插件把资源解析和检索交给 OpenNotebook 后端。
- 知识图谱项目如 sift-kg、Mind Map AI、Graphiti、LightRAG 强调 entity/relation extraction、provenance、可查询图谱。这里最值得吸收的是“关系也要有证据”和“不要把弱关系强行结构化”。
- 闪卡/主动回忆项目如 FlashSmith、Memento、Skill-Anything、FSRS/Anki 生态强调 active recall、spaced repetition、可验证答案。这里最值得吸收的是“一卡一知识点”和“答案必须可核验”。
- prompt engineering 集合如 awesome-prompts 的启发是：prompt 应当工程化、可测试、可回归，而不是只收集模板。

## 3. 已落地到代码的 prompt contract

位置：`src/libs/ai/prompts/contracts.ts`

已落地：

- `STRICT OUTPUT CONTRACT`
- `FLASHCARD QUALITY CONTRACT`
- `RELATION RUBRIC`
- 禁止 markdown/prose/XML。
- 保留 sourceRefs。
- 每个候选控制 1 到 2 条证据，`quote` 只保留短证据。
- evidence weak 则 uncertain/warnings。
- 闪卡必须 active recall，避免泛泛解释。
- 闪卡负例约束：不把章节标题直接做卡，不问来源中没有答案的问题，不把多个事实塞进一张卡。
- 关系类型约束：`parent_child`、`prerequisite`、`cause_effect`、`sequence`、`contrast`、`related` 都有明确使用边界。

## 4. 已采用的开源提示词经验

这些经验已经进入 prompt contract 或测试，而不是只停留在文档：

- NotebookLM 类 source-grounded/citation-backed 原则 -> 每个概念、关系、卡片都必须保留 `sourceRefs`，证据弱则进入 `uncertain/warnings`。
- 知识图谱/GraphRAG 项目的 entity-relation provenance 原则 -> 关系也必须有证据，并使用 `RELATION RUBRIC` 限制关系类型。
- Anki/FSRS/主动回忆经验 -> `FLASHCARD QUALITY CONTRACT` 要求一卡一知识点、active recall、答案可从证据核验。
- prompt 工程集合的可回归思路 -> `scripts/test_prompt_contracts.mjs` 静态验证每个 prompt 都带结构化输出、证据、uncertain/warnings、证据预算、闪卡质量和关系 rubric。

## 5. 后续建议

### 5.1 增加少样例 few-shot

当前为了减少 token 和避免模型照抄样例，主要用 contract + schema。后续可加入少量高质量 few-shot：

- 一个“强证据概念”的正例。
- 一个“标题但无解释，放入 uncertain”的负例。
- 一个“弱相关不能强行 parent_child”的关系负例。
- 一个“多事实拆成两张卡”的闪卡正例。

### 5.2 增加 prompt 输出对抗样本

继续扩展 `scripts/test_json_repair.mjs` 和 pipeline 测试：

- markdown fence + 前后解释。
- OpenAI wrapper。
- 数组和对象混合碎片。
- 注释、尾逗号、单引号。
- 全角标点。
- Python literals。
- 裸换行字符串。
- `NaN/Infinity`。

## 6. 参考链接

- notebooklm-py: https://github.com/teng-lin/notebooklm-py
- NotebookLM skill: https://github.com/PleasePrompto/notebooklm-skill
- NotebookLM MCP: https://github.com/PleasePrompto/notebooklm-mcp
- SurfSense: https://github.com/MODSetter/SurfSense
- SmartDoc AI: https://github.com/dungtq2k5/smartdoc-ai
- SoyLM: https://github.com/soy-tuber/SoyLM
- sift-kg: https://github.com/juanceresa/sift-kg
- Mind Map AI: https://github.com/kliewerdaniel/mindmap03
- Graphiti: https://github.com/getzep/graphiti
- LightRAG: https://github.com/hkuds/lightrag
- FlashSmith: https://github.com/filiprumenovski/FlashSmith-V1
- Memento flashcards skill: https://github.com/NousResearch/hermes-agent/blob/main/optional-skills/productivity/memento-flashcards/SKILL.md
- Skill-Anything: https://github.com/SYuan03/Skill-Anything
- awesome-prompts: https://github.com/ai-boost/awesome-prompts
- FSRS TypeScript: https://github.com/open-spaced-repetition/ts-fsrs
- FSRS for Anki: https://github.com/open-spaced-repetition/fsrs4anki
- Sigma.js: https://github.com/jacomyal/sigma.js
- Graphology: https://github.com/graphology/graphology
- Cytoscape.js: https://github.com/cytoscape/cytoscape.js
