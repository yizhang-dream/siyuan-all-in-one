/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Vector store following CardStore pattern. Stores embeddings via
 * SiYuan Plugin.saveData/loadData. Cosine similarity O(n) search.
 */

import type { VectorEntry, RagChunk, RagSearchResult } from './types';

function cleanVectorEntry(raw: any): VectorEntry {
    return {
        id: String(raw?.id || ''),
        sourceId: String(raw?.sourceId || ''),
        chunkIndex: Number(raw?.chunkIndex) || 0,
        text: String(raw?.text || ''),
        embedding: Array.isArray(raw?.embedding) ? raw.embedding.map(Number) : [],
        metadata: {
            fileName: raw?.metadata?.fileName ? String(raw.metadata.fileName) : undefined,
            pageNumber: raw?.metadata?.pageNumber ? Number(raw.metadata.pageNumber) : undefined,
            mimeType: raw?.metadata?.mimeType ? String(raw.metadata.mimeType) : undefined,
            url: raw?.metadata?.url ? String(raw.metadata.url) : undefined,
            title: raw?.metadata?.title ? String(raw.metadata.title) : undefined,
            sectionHeading: raw?.metadata?.sectionHeading ? String(raw.metadata.sectionHeading) : undefined,
        },
    };
}

/**
 * Dot product as cosine similarity shortcut.
 *
 * All stored embeddings are L2-normalized unit vectors (the embedder uses
 * `{ normalize: true }`), so cosine similarity = a · b.  For zero-vector
 * fallbacks the dot product naturally returns 0, which is correct
 * (zero similarity to any other vector).
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
    }
    return dot;
}

export class VectorStore {
    private entries: VectorEntry[] = [];
    private plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async load(): Promise<void> {
        try {
            const data = await this.plugin.loadData('rag-vectors');
            this.entries = Array.isArray(data) ? data.map(cleanVectorEntry) : [];
        } catch {
            this.entries = [];
        }
    }

    async save(): Promise<void> {
        await this.plugin.saveData('rag-vectors', this.entries);
    }

    getAll(): VectorEntry[] {
        return this.entries;
    }

    getCount(): number {
        return this.entries.length;
    }

    getBySourceId(sourceId: string): VectorEntry[] {
        return this.entries.filter((e) => e.sourceId === sourceId);
    }

    add(entry: VectorEntry): void {
        const idx = this.entries.findIndex((e) => e.id === entry.id);
        if (idx !== -1) {
            this.entries[idx] = entry;
        } else {
            this.entries.push(entry);
        }
    }

    addAll(entries: VectorEntry[]): void {
        for (const entry of entries) {
            this.add(entry);
        }
    }

    removeBySourceId(sourceId: string): number {
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => e.sourceId !== sourceId);
        return before - this.entries.length;
    }

    clear(): void {
        this.entries = [];
    }

    search(queryEmbedding: number[], topK = 5, sourceIds?: string[]): RagSearchResult[] {
        const results: RagSearchResult[] = [];
        for (const entry of this.entries) {
            if (!entry.embedding || entry.embedding.length === 0) continue;
            if (sourceIds && sourceIds.length > 0 && !sourceIds.includes(entry.sourceId)) continue;
            const score = cosineSimilarity(queryEmbedding, entry.embedding);
            const chunk: RagChunk = {
                id: entry.id,
                sourceId: entry.sourceId,
                chunkIndex: entry.chunkIndex,
                text: entry.text,
                metadata: entry.metadata,
            };
            results.push({ chunk, score });
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /**
     * BM25-like keyword search fallback when the embedding model is unavailable.
     *
     * Tokenizes the query (Chinese: bigram split; English/numbers: space-split,
     * lowercased), scores each entry by term-frequency of query tokens in its
     * text, and returns the top K results normalised to 0‑1.
     */
    keywordSearch(query: string, topK = 5, sourceIds?: string[]): RagSearchResult[] {
        const queryTokens = this.tokenize(query);
        if (queryTokens.length === 0) return [];

        const results: RagSearchResult[] = [];
        let maxScore = 0;

        for (const entry of this.entries) {
            if (!entry.text) continue;
            if (sourceIds && sourceIds.length > 0 && !sourceIds.includes(entry.sourceId)) continue;

            const entryTokens = this.tokenize(entry.text);
            let score = 0;
            for (const qt of queryTokens) {
                for (const et of entryTokens) {
                    if (et === qt) score++;
                }
            }

            if (score > 0) {
                const chunk: RagChunk = {
                    id: entry.id,
                    sourceId: entry.sourceId,
                    chunkIndex: entry.chunkIndex,
                    text: entry.text,
                    metadata: entry.metadata,
                };
                results.push({ chunk, score });
                if (score > maxScore) maxScore = score;
            }
        }

        // Normalize scores to 0-1 range (max score → 1.0)
        if (maxScore > 0) {
            for (const r of results) {
                r.score = r.score / maxScore;
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /**
     * Simple tokenizer: English/numbers → individual lowercased words;
     * Chinese characters → bigram tokens.
     */
    private tokenize(text: string): string[] {
        const tokens: string[] = [];
        // Match sequences of ASCII alphanumeric, or individual CJK characters
        const parts = text.match(/[a-zA-Z0-9]+|[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
        if (!parts) return tokens;

        for (const part of parts) {
            if (/[a-zA-Z0-9]/.test(part)) {
                tokens.push(part.toLowerCase());
            } else {
                // Chinese: character bigrams
                if (part.length >= 2) {
                    for (let i = 0; i < part.length - 1; i++) {
                        tokens.push(part.substring(i, i + 2));
                    }
                }
                // Always include unigram for single chars / edge coverage
                tokens.push(part);
            }
        }
        return tokens;
    }
}
