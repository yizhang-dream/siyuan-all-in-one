/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Local RAG barrel export.
 */

export { chunkText, splitIntoSentences } from './chunker';
export type { ChunkerOptions } from './chunker';

export { RagEmbedder, getRagEmbedder, resetRagEmbedder } from './embedder';

export { VectorStore } from './vector-store';

export { ingestDocument, ingestFile } from './ingest';
export type { IngestOptions, IngestResult } from './ingest';

export { ragQuery, ragContext, formatRagContext } from './query';
export type { QueryOptions } from './query';

export { buildRagConceptRequest } from './rag-bridge';
export type { RagConceptRequest, RagConceptRequestInput } from './rag-bridge';

export type {
    RagChunk,
    RagChunkMetadata,
    VectorEntry,
    RagSearchResult,
    RagConfig,
    IngestedDocRecord,
} from './types';

export type { EmbeddingProviderType, EmbeddingConfig, EmbeddingProvider } from './embedder-types';
export { DEFAULT_EMBEDDING_DIM } from './embedder-types';
export { BuiltinEmbedder } from './embedder-builtin';
export { RemoteEmbedderBase, OllamaEmbedder, OpenAIEmbedder, CustomEmbedder } from './embedder-remote';
export { getRagEmbedderProvider, resetEmbeddingProvider } from './embedder';
