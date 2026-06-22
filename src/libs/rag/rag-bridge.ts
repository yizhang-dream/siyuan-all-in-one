/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * RAG → Concepts bridge. Mirrors notebook-bridge.ts.
 */

export interface RagConceptRequest {
    key: string;
    query: string;
    ragContext: string;
    sourceLabel?: string;
    autoRun?: boolean;
}

export interface RagConceptRequestInput {
    question?: string;
    context?: string;
    sourceLabel?: string;
    autoRun?: boolean;
}

export function buildRagConceptRequest(input: RagConceptRequestInput): RagConceptRequest | null {
    const query = (input.question || '').trim();
    const context = (input.context || '').trim();
    if (!query && !context) return null;

    const sourceLabel = input.sourceLabel
        || (query ? `RAG: ${query.slice(0, 40)}` : 'RAG 上下文');

    return {
        key: [query, context].join('|'),
        query: query || '基于上下文生成卡片',
        ragContext: context,
        sourceLabel,
        autoRun: input.autoRun ?? true,
    };
}
