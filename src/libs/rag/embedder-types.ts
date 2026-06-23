/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Multi-provider embedding type definitions.
 */

export type EmbeddingProviderType = 'builtin' | 'ollama' | 'siliconflow' | 'qwen' | 'zhipu' | 'hunyuan' | 'baidu' | 'cohere' | 'jina' | 'mistral' | 'voyage' | 'gemini-embed' | 'together' | 'nomic' | 'openai' | 'custom';

export interface EmbeddingConfig {
    endpoint: string;
    apiKey: string;
    model: string;
}

export interface EmbeddingProvider {
    initialize(): Promise<void>;
    isReady(): boolean;
    getError(): string;
    getModelName(): string;
    getDimension(): number;
    embed(texts: string[]): Promise<number[][]>;
}

export const DEFAULT_EMBEDDING_DIM = 384;
