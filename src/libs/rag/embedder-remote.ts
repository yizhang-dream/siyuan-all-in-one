/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Remote embedder: abstract base + Ollama / OpenAI / Custom implementations.
 */

import type { EmbeddingProvider, EmbeddingConfig } from './embedder-types';
import { DEFAULT_EMBEDDING_DIM } from './embedder-types';

/** Base class for remote (HTTP-based) embedding providers. */
export abstract class RemoteEmbedderBase implements EmbeddingProvider {
    protected ready = false;
    protected initError = '';
    protected modelName = '';
    protected dimension = DEFAULT_EMBEDDING_DIM;
    protected config: EmbeddingConfig;

    constructor(config: EmbeddingConfig) {
        this.config = config;
        this.modelName = config.model || 'unknown';
    }

    abstract getEndpoint(): string;
    abstract buildBody(texts: string[]): unknown;
    abstract getHeaders(): Record<string, string>;
    abstract parseResponse(json: any): number[][];

    async initialize(): Promise<void> {
        if (this.ready) return;
        try {
            this.dimension = await this.testConnection();
            this.ready = true;
        } catch (err: any) {
            this.initError = err?.message || String(err);
            console.warn('[siyuan-all-in-one] Remote embedder init failed:', this.initError);
        }
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

    getDimension(): number {
        return this.dimension;
    }

    /** Single-shot embed to determine dimension and verify connectivity. */
    async testConnection(): Promise<number> {
        const result = await this.embed(['test']);
        if (result.length === 0 || result[0].length === 0) {
            throw new Error('Empty embedding response');
        }
        return result[0].length;
    }

    async embed(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        const endpoint = this.getEndpoint();
        const body = this.buildBody(texts);
        const headers = this.getHeaders();

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Embedding API error ${response.status}: ${errorText}`);
        }

        const text = await response.text();
        if (!text) {
            throw new Error(`Embedding API returned empty response (status ${response.status})`);
        }
        let json: any;
        try {
            json = JSON.parse(text);
        } catch {
            throw new Error(`Embedding API returned non-JSON response: ${text.slice(0, 200)}`);
        }
        return this.parseResponse(json);
    }
}

/** Ollama embedder — POST {endpoint}/api/embed, body: {model, input} */
export class OllamaEmbedder extends RemoteEmbedderBase {
    getEndpoint(): string {
        const base = this.config.endpoint.replace(/\/+$/, '');
        return `${base}/api/embed`;
    }

    buildBody(texts: string[]): unknown {
        return {
            model: this.config.model,
            input: texts.length === 1 ? texts[0] : texts,
        };
    }

    getHeaders(): Record<string, string> {
        return {};
    }

    parseResponse(json: any): number[][] {
        const embeddings: number[][] = json.embeddings;
        if (!Array.isArray(embeddings) || embeddings.length === 0) {
            throw new Error('Ollama embed response missing embeddings array');
        }
        return embeddings;
    }
}

/** OpenAI-compatible embedder — POST /v1/embeddings, Bearer auth */
export class OpenAIEmbedder extends RemoteEmbedderBase {
    getEndpoint(): string {
        const base = this.config.endpoint.replace(/\/+$/, '');
        return `${base}/v1/embeddings`;
    }

    buildBody(texts: string[]): unknown {
        return {
            model: this.config.model,
            input: texts,
        };
    }

    getHeaders(): Record<string, string> {
        return {
            Authorization: `Bearer ${this.config.apiKey}`,
        };
    }

    parseResponse(json: any): number[][] {
        const data = json.data;
        if (!Array.isArray(data)) {
            throw new Error('OpenAI embed response missing data array');
        }
        // Sort by index to preserve order
        const sorted = [...data].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
        return sorted.map((item: any) => {
            if (!Array.isArray(item.embedding)) {
                throw new Error('OpenAI embed response item missing embedding array');
            }
            return item.embedding;
        });
    }
}

/** Custom OpenAI-compatible embedder — same API shape as OpenAI, optional Bearer auth */
export class CustomEmbedder extends RemoteEmbedderBase {
    getEndpoint(): string {
        const base = this.config.endpoint.replace(/\/+$/, '');
        return `${base}/v1/embeddings`;
    }

    buildBody(texts: string[]): unknown {
        return {
            model: this.config.model,
            input: texts,
        };
    }

    getHeaders(): Record<string, string> {
        if (this.config.apiKey) {
            return {
                Authorization: `Bearer ${this.config.apiKey}`,
            };
        }
        return {};
    }

    parseResponse(json: any): number[][] {
        const data = json.data;
        if (!Array.isArray(data)) {
            throw new Error('Custom embed response missing data array');
        }
        const sorted = [...data].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
        return sorted.map((item: any) => {
            if (!Array.isArray(item.embedding)) {
                throw new Error('Custom embed response item missing embedding array');
            }
            return item.embedding;
        });
    }
}
