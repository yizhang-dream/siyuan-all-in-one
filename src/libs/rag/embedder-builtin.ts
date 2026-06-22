/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Builtin embedder: wraps RagEmbedder with the EmbeddingProvider interface.
 */

import { RagEmbedder } from './embedder';
import type { EmbeddingProvider } from './embedder-types';
import { DEFAULT_EMBEDDING_DIM } from './embedder-types';

export class BuiltinEmbedder implements EmbeddingProvider {
    private inner: RagEmbedder;

    constructor() {
        this.inner = new RagEmbedder();
    }

    async initialize(): Promise<void> {
        await this.inner.initialize();
    }

    isReady(): boolean {
        return this.inner.isReady();
    }

    getError(): string {
        return this.inner.getError();
    }

    getModelName(): string {
        return this.inner.getModelName();
    }

    getDimension(): number {
        return DEFAULT_EMBEDDING_DIM;
    }

    async embed(texts: string[]): Promise<number[][]> {
        return this.inner.embed(texts);
    }
}
