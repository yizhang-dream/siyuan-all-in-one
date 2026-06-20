export function buildPromptContract(language = 'zh-CN'): string {
    return [
        'STRICT OUTPUT CONTRACT',
        '- Return one JSON object only. Do not return markdown fences, prose, comments, or XML.',
        '- Use the exact top-level keys requested by this step. Unknown extra keys are allowed but ignored.',
        '- Keep every accepted item grounded in provided SOURCES or prior accepted candidates.',
        '- Every accepted concept, relation, and card must include non-empty sourceRefs.',
        '- Prefer short quoted evidence in sourceRefs.quote when possible.',
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
        '- The answer must be checkable from the source evidence.',
        '- Use cloze, reverse, enumeration, compare, or process only when that card type improves recall.',
    ].join('\n');
}
