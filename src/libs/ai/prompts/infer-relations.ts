import type { ConceptCandidate } from '../../types/concept';
import type { PromptSourceChunk } from './extract-concepts';
import { buildPromptContract } from './contracts';

export function buildInferRelationsPrompt(
    concepts: ConceptCandidate[],
    chunks: PromptSourceChunk[],
    language = 'zh-CN'
): string {
    return `你是一个知识图谱关系审校助手。你的任务是在概念候选之间判断可证据支持的关系。

允许的关系类型：
- parent_child：A 包含 B，适合作为思维导图层级
- prerequisite：理解 A 需要先理解 B
- contrast：A 与 B 构成对比
- cause_effect：A 导致 B 或明显影响 B
- sequence：A 在流程或时间上先于 B
- related：弱相关，但来源明确显示有关联

硬性规则：
1. 只能在给定 concepts 之间建立关系，不要创建新概念。
2. 不要为了让图更满而强行连线。
3. 每条关系必须有 sourceRefs，且必须能从 SOURCES 支持。
4. parent_child 关系必须足够强，能支撑思维导图父子层级。
5. 低置信度或证据不足的关系放入 uncertain。
6. 输出语言使用 ${language}。
7. 只输出 JSON，不要 Markdown，不要代码块，不要解释。

输出 JSON schema：
{
  "relations": [
    {
      "fromTempId": "c1",
      "toTempId": "c2",
      "type": "parent_child",
      "confidence": 0.0,
      "sourceRefs": [
        {"type":"siyuan|opennotebook|manual|pdf|url","sourceId":"...","blockId":"...","chunkId":"...","quote":"短证据","page":1,"url":"..."}
      ]
    }
  ],
  "uncertain": [
    {"type":"relation","content":"c1 -> c2","reason":"证据不足的原因"}
  ],
  "warnings": ["可选警告"]
}

${buildPromptContract(language)}

CONCEPTS:
${JSON.stringify(concepts, null, 2)}

SOURCES:
${JSON.stringify(chunks, null, 2)}`;
}
