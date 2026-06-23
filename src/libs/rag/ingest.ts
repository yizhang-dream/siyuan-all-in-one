/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Document ingestion pipeline: chunk text → embed → store vectors.
 */

import { chunkText, type ChunkerOptions } from './chunker';
import { type RagEmbedder } from './embedder';
import { type VectorStore } from './vector-store';
import type { RagChunkMetadata, VectorEntry } from './types';

export interface IngestOptions extends ChunkerOptions {
    topK?: number;
}

export interface IngestResult {
    sourceId: string;
    chunkCount: number;
    fileName?: string;
}

/** Ingest raw text into the vector store. */
export async function ingestDocument(
    text: string,
    metadata: RagChunkMetadata,
    store: VectorStore,
    embedder: RagEmbedder,
    options: IngestOptions = {}
): Promise<IngestResult> {
    // Use explicit sourceId from metadata if provided (e.g. from sourceStore),
    // otherwise derive from file name / title.
    const sourceId = metadata.sourceId || 'rag-' + hashFileName(metadata.fileName || metadata.title || text.slice(0, 100));

    // Remove old chunks for this source
    store.removeBySourceId(sourceId);

    // Chunk — pass explicit sourceId so all chunks share the same sourceId
    const chunks = chunkText(text, metadata, { chunkSize: options.chunkSize, chunkOverlap: options.chunkOverlap }, sourceId);
    if (chunks.length === 0) return { sourceId, chunkCount: 0, fileName: metadata.fileName };

    // Embed in batches of 10 (transformers.js works better one at a time)
    const entries: VectorEntry[] = [];
    const chunkTexts = chunks.map((c) => c.text);
    const embeddings = await embedder.embed(chunkTexts);

    for (let i = 0; i < chunks.length; i++) {
        entries.push({
            id: chunks[i].id,
            sourceId: chunks[i].sourceId,
            chunkIndex: chunks[i].chunkIndex,
            text: chunks[i].text,
            embedding: embeddings[i] || new Array(384).fill(0),
            metadata: chunks[i].metadata,
        });
    }

    store.addAll(entries);
    await store.save();

    return { sourceId, chunkCount: entries.length, fileName: metadata.fileName };
}

/** Ingest a browser File object. */
export async function ingestFile(
    file: File,
    store: VectorStore,
    embedder: RagEmbedder,
    options: IngestOptions = {}
): Promise<IngestResult> {
    const text = await file.text();
    const mimeType = mimeFromExtension(file.name);
    return ingestDocument(text, { fileName: file.name, mimeType, title: file.name }, store, embedder, options);
}

// ── Helpers ───────────────────────────────────────────────

function mimeFromExtension(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'md':
        case 'markdown':
            return 'text/markdown';
        case 'html':
        case 'htm':
            return 'text/html';
        default:
            return 'text/plain';
    }
}

function hashFileName(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36).slice(0, 8);
}
