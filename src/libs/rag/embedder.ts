/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Embedding layer: lazy-loads @huggingface/transformers + paraphrase-multilingual-MiniLM-L12-v2 (Q8, ~118MB).
 * Graceful fallback to zero-vectors if the model is unavailable.
 *
 * Performance: embeddings are L2-normalized ({ normalize: true }) so cosine similarity
 * in the vector store can use a simple dot product. For long texts (>500 chars),
 * sentence-level splitting with weighted-averaging produces better semantic representations.
 */

import { splitIntoSentences } from './chunker';

/** Singleton embedder instance. */
let _instance: RagEmbedder | null = null;

export function getRagEmbedder(pluginDirPath?: string): RagEmbedder {
    if (!_instance) _instance = new RagEmbedder(undefined, pluginDirPath);
    return _instance;
}

export function resetRagEmbedder(): void {
    _instance = null;
}

export class RagEmbedder {
    private pipeline: any = null;
    private modelName: string;
    private pluginDirPath: string;
    private ready = false;
    private initError: string = '';
    private initPromise: Promise<void> | null = null;
    private cache: Map<string, number[]>;

    constructor(modelName?: string, pluginDirPath?: string) {
        this.modelName = modelName || 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
        this.pluginDirPath = pluginDirPath || '';
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
            // Dynamic import of @huggingface/transformers — Vite bundles it into index.js
            // so it resolves correctly in Electron's renderer process.
            const mod = await import('@huggingface/transformers');
            const { pipeline, env } = mod;
            this.configureLocalModelPath(env);
            env.remoteHost = 'https://hf-mirror.com';
            this.pipeline = await pipeline('feature-extraction', this.modelName, { dtype: 'q8' });
            this.ready = true;
        } catch (err: any) {
            this.initError = err?.message || String(err);
            console.warn('[siyuan-all-in-one] RAG embedder init failed:', this.initError);
        }
    }

    /**
     * Point transformers.js to the bundled local model files so no download is needed.
     * Resolution order:
     *   1. this.pluginDirPath (explicitly provided by caller)
     *   2. __dirname (CJS bundle — available in Node.js/Electron require() scope)
     *   3. import.meta.url (ESM fallback — may be mangled by Vite CJS transform)
     *   4. No local path — fall back to downloading from network
     *
     * IMPORTANT: Vite's CJS build (formats: ["cjs"]) breaks `new URL('.', import.meta.url)`:
     *   - `import.meta.url` → CJS shim resolving to wrong URL in Electron
     *   - `'.'` → base64 data URL (pathname always "")
     *   Using __dirname instead, which is correct in CJS context.
     */
    private configureLocalModelPath(env: any): void {
        let baseDir = this.pluginDirPath;
        if (!baseDir) {
            // CJS bundle (Vite outputs 'cjs'): __dirname is available and points to dist/
            if (typeof __dirname !== 'undefined') {
                baseDir = __dirname;
                // Normalize path separators for Windows
                if (baseDir.includes('\\')) {
                    baseDir = baseDir.replace(/\\/g, '/');
                }
                if (!baseDir.endsWith('/')) {
                    baseDir += '/';
                }
            } else {
                // ESM fallback: derive from import.meta.url
                try {
                    const url = new URL('.', import.meta.url);
                    // url.pathname is like /C:/Users/.../plugins/siyuan-all-in-one/
                    let path = url.pathname;
                    // On Windows, remove leading / so /C:/... becomes C:/...
                    if (path.startsWith('/') && /^\/[A-Z]:\//i.test(path)) {
                        path = path.slice(1);
                    }
                    // Replace forward slashes with backslashes on Windows
                    if (path.includes(':\\') || path.includes(':/')) {
                        path = path.replace(/\//g, '\\');
                    }
                    baseDir = path;
                } catch {
                    // import.meta.url unavailable — fall through to no local path
                }
            }
        }
        if (baseDir) {
            // Ensure trailing separator for path joining
            const sep = baseDir.includes('\\') ? '\\' : '/';
            if (!baseDir.endsWith(sep)) {
                baseDir += sep;
            }
            env.localModelPath = baseDir + 'models' + sep;
            env.allowLocalModels = true;
        }
    }

    /** Threshold in chars above which sentence-level weighted embedding is used. */
    private static readonly SENTENCE_EMBED_THRESHOLD = 500;

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
                const zero = new Array(DEFAULT_EMBEDDING_DIM).fill(0);
                results.push(zero);
                continue;
            }

            try {
                const vec = text.length > RagEmbedder.SENTENCE_EMBED_THRESHOLD
                    ? await this.embedSentencesWeighted(text)
                    : await this.embedDirect(text);
                this.cache.set(text, vec);
                results.push(vec);
            } catch (err: any) {
                console.warn('[siyuan-all-in-one] Embed failed for text:', err?.message);
                const zero = new Array(DEFAULT_EMBEDDING_DIM).fill(0);
                results.push(zero);
            }
        }

        return results;
    }

    /** Direct pipeline call for short texts. */
    private async embedDirect(text: string): Promise<number[]> {
        const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data as Float32Array);
    }

    /**
     * Sentence-level weighted embedding for long texts.
     *
     * Splits the text into sentences, embeds each independently, then computes a
     * weighted average (weights = sentence character length). The result is
     * L2-normalized to maintain unit-vector invariants for dot-product search.
     *
     * This avoids truncating or splitting mid-sentence, producing better semantic
     * representations for retrieval.
     */
    private async embedSentencesWeighted(text: string): Promise<number[]> {
        const sentences = splitIntoSentences(text);
        // Short-circuit: if single sentence, embed directly (avoids averaging overhead)
        if (sentences.length <= 1) {
            return this.embedDirect(text);
        }

        const dim = DEFAULT_EMBEDDING_DIM;
        const weightedSum = new Array(dim).fill(0);
        let totalWeight = 0;

        for (const sentence of sentences) {
            const weight = sentence.length;
            if (weight === 0) continue;

            try {
                const output = await this.pipeline(sentence, { pooling: 'mean', normalize: true });
                const embedding = Array.from(output.data as Float32Array);

                for (let i = 0; i < dim; i++) {
                    weightedSum[i] += embedding[i] * weight;
                }
                totalWeight += weight;
            } catch {
                // Skip failed sentences — they contribute 0 to the weighted sum
            }
        }

        // All sentences failed — return zero vector
        if (totalWeight === 0) {
            return new Array(dim).fill(0);
        }

        // Weighted average
        for (let i = 0; i < dim; i++) {
            weightedSum[i] /= totalWeight;
        }

        // L2-normalize: pipeline normalizes each sentence, but the weighted
        // average of unit vectors is not necessarily a unit vector.
        let norm = 0;
        for (let i = 0; i < dim; i++) {
            norm += weightedSum[i] * weightedSum[i];
        }
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < dim; i++) {
                weightedSum[i] /= norm;
            }
        }

        return weightedSum;
    }
}

// ── Multi-provider singleton ────────────────────────────────────────────────

import { DEFAULT_EMBEDDING_DIM, type EmbeddingProviderType, type EmbeddingConfig, type EmbeddingProvider } from './embedder-types';

let _provider: EmbeddingProvider | null = null;

/**
 * Get or create the singleton EmbeddingProvider based on current AppConfig.
 * Dispatches to BuiltinEmbedder, OllamaEmbedder, OpenAIEmbedder, or CustomEmbedder.
 *
 * @param plugin - Optional plugin instance; its getPluginDir() is used for local model path resolution (builtin only).
 */
export async function getRagEmbedderProvider(plugin?: any): Promise<EmbeddingProvider> {
    if (_provider) return _provider;

    // Dynamic import to avoid circular dependency at module level
    const { getAppConfig } = await import('../config-helper');
    const cfg: { ragEmbeddingProvider: EmbeddingProviderType; ragEmbeddingConfig: EmbeddingConfig } = getAppConfig();

    // Extract plugin directory if plugin has a getPluginDir() method
    const pluginDir = plugin?.getPluginDir?.();

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
        case 'siliconflow':
        case 'qwen':
        case 'zhipu':
        case 'hunyuan':
        case 'cohere':
        case 'jina':
        case 'mistral':
        case 'custom': {
            const { CustomEmbedder } = await import('./embedder-remote');
            _provider = new CustomEmbedder(cfg.ragEmbeddingConfig);
            break;
        }
        case 'baidu': {
            const { BaiduEmbedder } = await import('./embedder-remote');
            _provider = new BaiduEmbedder(cfg.ragEmbeddingConfig);
            break;
        }
        default: {
            const { BuiltinEmbedder } = await import('./embedder-builtin');
            _provider = new BuiltinEmbedder(pluginDir);
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
