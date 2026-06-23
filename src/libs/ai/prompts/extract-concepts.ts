import type { SourceRef } from '../../types/concept';
import { buildPromptContract } from './contracts';

export interface PromptSourceChunk {
    id: string;
    text: string;
    sourceRef: SourceRef;
}

export function buildExtractConceptsPrompt(chunks: PromptSourceChunk[], language = 'auto'): string {
    return `你是一个保守的学习材料结构化助手。你的任务是从给定资料中抽取“概念节点候选”。

硬性规则：
1. 只能使用 SOURCES 中的信息，不要引入外部知识。
2. 每个概念必须有 sourceRefs，且 sourceRefs 必须引用 SOURCES 中存在的 id。
3. title 要短，适合作为思维导图节点。
4. summary 用一句话解释，必须能被来源支持。
5. 不确定、证据不足、需要外部知识才能成立的内容放入 uncertain。
6. 输出语言使用 ${language}。
7. 只输出 JSON，不要 Markdown，不要代码块，不要解释。

输出 JSON schema：
{
  "concepts": [
    {
      "tempId": "c1",
      "title": "概念名",
      "summary": "一句话解释",
      "tags": ["可选标签"],
      "confidence": 0.0,
      "sourceRefs": [
        {"type":"siyuan-doc|manual|source","sourceId":"...","blockId":"...","quote":"短证据","page":1}
      ]
    }
  ],
  "uncertain": [
    {"type":"concept","content":"...","reason":"证据不足的原因"}
  ],
  "warnings": ["可选警告"]
}

${buildPromptContract(language)}

SOURCES:
${JSON.stringify(chunks, null, 2)}`;
}
