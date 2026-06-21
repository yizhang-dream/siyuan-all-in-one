import type { ConceptCandidate, RelationCandidate } from '../../types/concept';
import type { PromptSourceChunk } from './extract-concepts';
import { buildFlashcardQualityContract, buildPromptContract } from './contracts';

export function buildGenerateCardsPrompt(
    concepts: ConceptCandidate[],
    relations: RelationCandidate[],
    chunks: PromptSourceChunk[],
    targetCount: number,
    language = 'zh-CN',
    cdfMode = false
): string {
    const cdfSection = cdfMode ? buildCDFSection(language) : '';
    return `你是一个高质量闪卡候选生成助手。你的任务是基于概念和来源生成可复习的卡片候选。${cdfSection}

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
      ${cdfMode ? '"descriptorDimension": "definition|formula|process|compare|apply|cause|effect|limitation",' : ''}
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

function buildCDFSection(language = 'zh-CN'): string {
    return `

CDF (Concept Descriptor Framework) 模式：
在生成卡片之前，对每个概念识别 2-4 个描述维度。常见维度：
- definition：定义/是什么
- formula：公式/计算
- process：过程/步骤
- compare：对比/区别
- apply：应用/场景
- cause：原因/来源
- effect：结果/影响
- limitation：限制/边界/例外

规则：
1. 不是每个概念都需要覆盖所有维度，只选择来源中能被证据支持的维度。
2. 每个维度生成一张卡片，用 descriptorDimension 字段标记维度。
3. 优先覆盖不同维度，避免所有卡片都是纯定义卡。
4. 如果一个维度没有足够证据，跳过该维度。`;
}
