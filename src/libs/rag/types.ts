/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Local RAG types. Lightweight type definitions for the self-contained
 * RAG pipeline (chunking → embedding → vector store → retrieval).
 */

/** A text chunk produced by the chunking engine. */
export interface RagChunk {
    id: string;
    sourceId: string;
    chunkIndex: number;
    text: string;
    metadata: RagChunkMetadata;
}

export interface RagChunkMetadata {
    fileName?: string;
    pageNumber?: number;
    mimeType?: string;
    url?: string;
    title?: string;
    sectionHeading?: string;
    /** Source record ID from sourceStore (e.g. "p<random>") */
    sourceId?: string;
}

/** A stored vector entry. */
export interface VectorEntry {
    id: string;
    sourceId: string;
    chunkIndex: number;
    text: string;
    embedding: number[];
    metadata: RagChunkMetadata;
}

/** A search result with relevance score. */
export interface RagSearchResult {
    chunk: RagChunk;
    score: number;
}

/** RAG subsystem configuration. */
export interface RagConfig {
    enabled: boolean;
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    embeddingModel: string;
}

/** Tracked ingested document for dedup. */
export interface IngestedDocRecord {
    sourceId: string;
    fileName?: string;
    ingestedAt: number;
    chunkCount: number;
}
