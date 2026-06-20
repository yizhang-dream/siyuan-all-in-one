import type { ConceptCandidate, RelationCandidate } from '../../types/concept';
import type { PromptSourceChunk } from './extract-concepts';
import { buildFlashcardQualityContract, buildPromptContract } from './contracts';

export function buildGenerateCardsPrompt(
    concepts: ConceptCandidate[],
    relations: RelationCandidate[],
    chunks: PromptSourceChunk[],
    targetCount: number,
    language = 'zh-CN'
): string {
    return `你是一个高质量闪卡候选生成助手。你的任务是基于概念和来源生成可复习的卡片候选。

卡片类型：
- qa：问答卡
- cloze：填空卡
- reverse：反向卡
- enumeration：枚举卡
- compare：对比卡
- process：流程卡

硬性规则：
1. 只能使用 SOURCES 中的信息，不要引入外部知识。
2. 每张卡只测试一个知识点。
3. front 必须明确，back 必须足以判断对错。
4. 不要生成无意义记忆噪音。
5. 每张卡必须绑定 conceptTempId 和 sourceRefs。
6. 如果答案无法从来源直接支持，不要生成。
7. 优先生成 ${targetCount} 张；如果证据不足，可以少于这个数量。
8. 输出语言使用 ${language}。
9. 只输出 JSON，不要 Markdown，不要代码块，不要解释。

输出 JSON schema：
{
  "cards": [
    {
      "conceptTempId": "c1",
      "cardType": "qa",
      "front": "问题",
      "back": "答案",
      "hint": "可选提示",
      "confidence": 0.0,
      "sourceRefs": [
        {"type":"siyuan|opennotebook|manual|pdf|url","sourceId":"...","blockId":"...","chunkId":"...","quote":"短证据","page":1,"url":"..."}
      ]
    }
  ],
  "uncertain": [
    {"type":"card","content":"...","reason":"证据不足的原因"}
  ],
  "warnings": ["可选警告"]
}

${buildPromptContract(language)}
${buildFlashcardQualityContract()}

CONCEPTS:
${JSON.stringify(concepts, null, 2)}

RELATIONS:
${JSON.stringify(relations, null, 2)}

SOURCES:
${JSON.stringify(chunks, null, 2)}`;
}
