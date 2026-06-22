/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Embedding layer: lazy-loads @huggingface/transformers + paraphrase-multilingual-MiniLM-L12-v2 (Q8, ~118MB).
 * Graceful fallback to zero-vectors if the model is unavailable.
 */

/** Singleton embedder instance. */
let _instance: RagEmbedder | null = null;

export function getRagEmbedder(): RagEmbedder {
    if (!_instance) _instance = new RagEmbedder();
    return _instance;
}

export function resetRagEmbedder(): void {
    _instance = null;
}

export class RagEmbedder {
    private pipeline: any = null;
    private modelName: string;
    private ready = false;
    private initError: string = '';
    private initPromise: Promise<void> | null = null;
    private cache: Map<string, number[]>;

    constructor(modelName?: string) {
        this.modelName = modelName || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
        this.cache = new Map();
    }

    isReady(): boolean {
        return this.ready;
    }

    getError(): string {
        return this.initError;
    }

    getModelName(): string {
        return this.modelName;
    }

    /** Initialize the ONNX pipeline. Lazy, called automatically by embed(). */
    async initialize(): Promise<void> {
        if (this.ready) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._init();
        try {
            await this.initPromise;
        } finally {
            this.initPromise = null;
        }
    }

    private async _init(): Promise<void> {
        try {
            const mod = await import('@huggingface/transformers');
            const { pipeline } = mod;
            this.pipeline = await pipeline('feature-extraction', this.modelName, { dtype: 'q8' });
            this.ready = true;
        } catch (err: any) {
            this.initError = err?.message || String(err);
            console.warn('[siyuan-all-in-one] RAG embedder init failed:', this.initError);
        }
    }

    /** Embed texts to float vectors. Returns zero-vectors on failure. */
    async embed(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];

        for (const text of texts) {
            // In-memory cache hit
            const cached = this.cache.get(text);
            if (cached) {
                results.push(cached);
                continue;
            }

            if (!this.ready) {
                try {
                    await this.initialize();
                } catch {
                    // graceful fallback below
                }
            }

            if (!this.ready || !this.pipeline) {
                const zero = new Array(768).fill(0);
                results.push(zero);
                continue;
            }

            try {
                const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
                const vec = Array.from(output.data as Float32Array) as number[];
                this.cache.set(text, vec);
                results.push(vec);
            } catch (err: any) {
                console.warn('[siyuan-all-in-one] Embed failed for text:', err?.message);
                const zero = new Array(768).fill(0);
                results.push(zero);
            }
        }

        return results;
    }
}

// ── Multi-provider singleton ────────────────────────────────────────────────

import type { EmbeddingProviderType, EmbeddingConfig, EmbeddingProvider } from './embedder-types';

let _provider: EmbeddingProvider | null = null;

/**
 * Get or create the singleton EmbeddingProvider based on current AppConfig.
 * Dispatches to BuiltinEmbedder, OllamaEmbedder, OpenAIEmbedder, or CustomEmbedder.
 */
export async function getRagEmbedderProvider(): Promise<EmbeddingProvider> {
    if (_provider) return _provider;

    // Dynamic import to avoid circular dependency at module level
    const { getAppConfig } = await import('../config-helper');
    const cfg: { ragEmbeddingProvider: EmbeddingProviderType; ragEmbeddingConfig: EmbeddingConfig } = getAppConfig();

    switch (cfg.ragEmbeddingProvider) {
        case 'ollama': {
            const { OllamaEmbedder } = await import('./embedder-remote');
            _provider = new OllamaEmbedder(cfg.ragEmbeddingConfig);
            break;
        }
        case 'openai': {
            const { OpenAIEmbedder } = await import('./embedder-remote');
            _provider = new OpenAIEmbedder(cfg.ragEmbeddingConfig);
            break;
        }
        case 'custom': {
            const { CustomEmbedder } = await import('./embedder-remote');
            _provider = new CustomEmbedder(cfg.ragEmbeddingConfig);
            break;
        }
        default: {
            const { BuiltinEmbedder } = await import('./embedder-builtin');
            _provider = new BuiltinEmbedder();
            break;
        }
    }

    await _provider.initialize();
    return _provider;
}

/** Reset the cached embedding provider singleton. */
export function resetEmbeddingProvider(): void {
    _provider = null;
}
