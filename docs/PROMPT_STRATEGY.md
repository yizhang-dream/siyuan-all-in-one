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
- 禁止 markdown/prose/XML。
- 保留 sourceRefs。
- evidence weak 则 uncertain/warnings。
- 闪卡必须 active recall，避免泛泛解释。

## 4. 下一步建议

### 4.1 加入负例约束

在生成卡片 prompt 中加入明确负例：

- 不要问“请解释 X”。
- 不要问来源中没有给出答案的问题。
- 不要把章节标题当成已解释概念。
- 不要把两个概念塞进一张卡。

### 4.2 加入 relation rubric

关系类型应有更硬的判定：

- `parent_child`：必须是上位/下位或整体/部分。
- `prerequisite`：必须有学习或推理前置依赖。
- `cause_effect`：必须有因果动词或明确因果描述。
- `sequence`：必须有时间、步骤或流程顺序。
- `contrast`：必须有对比维度。
- `related`：只能作为弱关系兜底。

### 4.3 加入 evidence budget

每个候选最多 1 到 2 条证据，quote 控制短句，避免 sourceRefs 太长导致 UI 和存储膨胀。

### 4.4 对 prompt 做回归测试

继续扩展 `scripts/test_prompt_contracts.mjs`：

- 检查每个 prompt 都包含 JSON schema。
- 检查每个 prompt 都要求 sourceRefs。
- 检查每个 prompt 都要求 uncertain/warnings。
- 检查生成卡 prompt 包含 active recall 质量约束。

### 4.5 增加模型输出对抗样本

继续扩展 `scripts/test_json_repair.mjs`：

- markdown fence + 前后解释。
- OpenAI wrapper。
- 数组和对象混合碎片。
- 注释、尾逗号、单引号。
- 全角标点。
- Python literals。
- 裸换行字符串。
- `NaN/Infinity`。

## 5. 参考链接

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

