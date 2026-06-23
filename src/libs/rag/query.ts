/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * RAG query layer: embed question → cosine search → format context.
 */

import type { VectorStore } from './vector-store';
import type { RagSearchResult } from './types';

/** Minimal embedder interface for query — only needs embed() */
export interface QueryEmbedder {
    embed(texts: string[]): Promise<number[][]>;
}

export interface QueryOptions {
    topK?: number;
    minScore?: number;
    sourceIds?: string[];
}

/** Search vector store for chunks relevant to the question. */
export async function ragQuery(
    question: string,
    store: VectorStore,
    embedder: QueryEmbedder,
    options: QueryOptions = {}
): Promise<RagSearchResult[]> {
    const topK = options.topK || 5;
    const minScore = options.minScore ?? 0;

    const [qEmbedding] = await embedder.embed([question]);
    const results = store.search(qEmbedding, topK, options.sourceIds);
    return results.filter((r) => r.score >= minScore);
}

/** Convenience: query and format as LLM context string. */
export async function ragContext(
    question: string,
    store: VectorStore,
    embedder: QueryEmbedder,
    options: QueryOptions = {}
): Promise<string> {
    const results = await ragQuery(question, store, embedder, options);
    return formatRagContext(results);
}

/** Format search results as a context block for LLM prompts. */
export function formatRagContext(results: RagSearchResult[]): string {
    if (results.length === 0) return '';
    return results
        .map((r, i) => {
            const source = r.chunk.metadata.fileName || r.chunk.metadata.title || r.chunk.sourceId;
            const heading = r.chunk.metadata.sectionHeading ? ` § ${r.chunk.metadata.sectionHeading}` : '';
            const header = `[Source ${i + 1}: ${source}${heading}, score=${r.score.toFixed(2)}]`;
            return `${header}\n${r.chunk.text}`;
        })
        .join('\n\n---\n\n');
}
