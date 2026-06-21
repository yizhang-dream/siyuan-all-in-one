export function buildPromptContract(language = 'zh-CN'): string {
    return [
        'STRICT OUTPUT CONTRACT',
        '- Return one JSON object only. Do not return markdown fences, prose, comments, or XML.',
        '- Use the exact top-level keys requested by this step. Unknown extra keys are allowed but ignored.',
        '- Keep every accepted item grounded in provided SOURCES or prior accepted candidates.',
        '- Every accepted concept, relation, and card must include non-empty sourceRefs.',
        '- Prefer short quoted evidence in sourceRefs.quote when possible.',
        '- Evidence budget: use 1-2 sourceRefs per accepted item unless more are strictly required.',
        '- Keep sourceRefs.quote short and selective; quote only the evidence-bearing phrase or sentence.',
        '- Do not invent facts, source ids, pages, URLs, or relationships not supported by the input.',
        '- If evidence is weak, put the item in uncertain or warnings instead of forcing it.',
        '- If there are no valid items, return an empty array for that key and explain why in warnings.',
        `- Natural-language fields should use ${language}. Machine keys must stay exactly as specified.`,
    ].join('\n');
}

export function buildFlashcardQualityContract(): string {
    return [
        'FLASHCARD QUALITY CONTRACT',
        '- Test one idea per card.',
        '- Prefer active recall over recognition.',
        '- Avoid vague prompts such as "explain this" unless the expected answer is tightly bounded.',
        '- Do not ask "What is X?" when the answer would be a broad chapter summary instead of a specific recall target.',
        '- Do not ask questions whose answer is absent from sourceRefs.',
        '- Do not turn a heading into a card unless the source also explains the heading.',
        '- Do not combine two unrelated facts, formulas, definitions, or processes in one card.',
        '- The answer must be checkable from the source evidence.',
        '- Use cloze, reverse, enumeration, compare, or process only when that card type improves recall.',
    ].join('\n');
}

export function buildRelationRubric(): string {
    return [
        'RELATION RUBRIC',
        '- parent_child: use only for true type/subtype, whole/part, or container/member hierarchy that can become a mindmap branch.',
        '- prerequisite: use only when understanding or applying one concept requires the other first.',
        '- cause_effect: use only when the source states causation, production, prevention, influence, or a mechanism.',
        '- sequence: use only for time order, procedural order, derivation steps, or workflow stages.',
        '- contrast: use only when the source gives a shared comparison dimension and at least one difference.',
        '- related: use only as a weak fallback when the source explicitly connects the concepts but no stronger relation is justified.',
        '- If two relation types seem possible, choose the most specific supported type and put ambiguity in warnings.',
    ].join('\n');
}
