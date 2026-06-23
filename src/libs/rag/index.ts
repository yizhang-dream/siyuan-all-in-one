/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Local RAG barrel export.
 */

export { chunkText } from './chunker';
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
