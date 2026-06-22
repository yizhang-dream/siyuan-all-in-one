import type { CardCandidate, ConceptCandidate } from '../../types/concept';
import { buildPromptContract } from './contracts';

export function buildAssignCardsPrompt(
    concepts: ConceptCandidate[],
    cards: CardCandidate[],
    language = 'auto'
): string {
    return `你是一个闪卡归类助手。你的任务是把未归类卡片匹配到最合适的概念候选。

硬性规则：
1. 优先匹配已有 concept，不要轻易创建新概念。
2. 不要修改卡片 front/back/hint。
3. confidence < 0.7 的匹配放入 needsUserReview。
4. 如果没有合适概念，输出 suggestedNewConcepts。
5. 输出语言使用 ${language}。
6. 只输出 JSON，不要 Markdown，不要代码块，不要解释。

输出 JSON schema：
{
  "assignments": [
    {
      "cardIndex": 0,
      "conceptTempId": "c1",
      "confidence": 0.0,
      "reason": "匹配理由"
    }
  ],
  "suggestedNewConcepts": [
    {
      "title": "新概念名",
      "summary": "为什么需要新概念",
      "cardIndexes": [0]
    }
  ],
  "needsUserReview": [
    {
      "cardIndex": 0,
      "reason": "需要人工判断的原因"
    }
  ],
  "warnings": ["可选警告"]
}

${buildPromptContract(language)}

CONCEPTS:
${JSON.stringify(concepts, null, 2)}

CARDS:
${JSON.stringify(cards, null, 2)}`;
}
