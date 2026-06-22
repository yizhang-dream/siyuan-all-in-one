/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Content-type aware text chunker. Splits text into ~500-token chunks
 * with 10% overlap, preserving section headings in metadata.
 */

import type { RagChunk, RagChunkMetadata } from './types';

export interface ChunkerOptions {
    chunkSize?: number;
    chunkOverlap?: number;
}

const DEFAULT_CHUNK_TOKENS = 500;
const DEFAULT_OVERLAP = 0.1;

/** Estimate token count: ~3.5 chars per token average. */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

function estimateCharsFromTokens(tokens: number, text: string): number {
    if (hasCJK(text)) return tokens * 2;
    return tokens * 4;
}

function hasCJK(value: string): boolean {
    return /[一-鿿぀-ヿ가-힯]/.test(value);
}

function genChunkId(sourceId: string, index: number): string {
    return `chunk-${sourceId}-${index}`;
}

/** Split text into RagChunk[] with content-type aware strategy. */
export function chunkText(
    text: string,
    metadata: RagChunkMetadata,
    options: ChunkerOptions = {}
): RagChunk[] {
    const chunkSizeTokens = options.chunkSize || DEFAULT_CHUNK_TOKENS;
    const overlapFraction = options.chunkOverlap ?? DEFAULT_OVERLAP;
    const sourceId = hashFileName(metadata.fileName || metadata.title || text.slice(0, 80));

    if (!text.trim()) return [];

    const maxChars = estimateCharsFromTokens(chunkSizeTokens, text);
    const overlapChars = Math.floor(maxChars * overlapFraction);

    let sections: Array<{ heading: string; text: string }>;

    if (isMarkdown(text)) {
        sections = splitByMarkdownHeaders(text);
    } else if (isHtml(text)) {
        sections = splitByHtmlHeaders(text);
    } else {
        sections = [{ heading: '', text }];
    }

    const chunks: RagChunk[] = [];
    let index = 0;

    for (const section of sections) {
        const sectionChunks = splitRecursive(section.text, maxChars, overlapChars);
        for (const chunkText of sectionChunks) {
            chunks.push({
                id: genChunkId(sourceId, index),
                sourceId,
                chunkIndex: index,
                text: chunkText,
                metadata: {
                    ...metadata,
                    sectionHeading: section.heading || metadata.sectionHeading,
                },
            });
            index++;
        }
    }

    return chunks;
}

// ── Format detection ──────────────────────────────────────

function isMarkdown(text: string): boolean {
    const head = text.slice(0, 500);
    return /^#{1,6}\s|^- |^\* |^> |^```|^\|.*\|$/m.test(head);
}

function isHtml(text: string): boolean {
    const head = text.slice(0, 500);
    return /<[a-z][\s\S]*>/i.test(head);
}

// ── Markdown header splitter ──────────────────────────────

function splitByMarkdownHeaders(text: string): Array<{ heading: string; text: string }> {
    const lines = text.split(/\r?\n/);
    const sections: Array<{ heading: string; text: string }> = [];
    let currentHeading = '';
    let currentLines: string[] = [];

    for (const line of lines) {
        const h = line.match(/^(#{1,6})\s+(.+)/);
        if (h) {
            if (currentLines.length > 0) {
                sections.push({ heading: currentHeading, text: currentLines.join('\n') });
            }
            currentHeading = h[2].trim();
            currentLines = [];
        } else {
            currentLines.push(line);
        }
    }
    if (currentLines.length > 0) {
        sections.push({ heading: currentHeading, text: currentLines.join('\n') });
    }
    return sections;
}

// ── HTML header splitter ──────────────────────────────────

function splitByHtmlHeaders(text: string): Array<{ heading: string; text: string }> {
    const cleaned = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n');

    const parts = cleaned.split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/gi);
    const sections: Array<{ heading: string; text: string }> = [];
    let currentHeading = '';

    for (const part of parts) {
        const hMatch = part.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
        if (hMatch) {
            currentHeading = hMatch[1].replace(/<[^>]+>/g, '').trim();
        } else {
            const clean = part.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
            if (clean) {
                sections.push({ heading: currentHeading, text: clean });
            }
        }
    }
    return sections;
}

// ── Recursive character splitter ──────────────────────────

const SEPARATORS = ['\n\n', '\n', '. ', '。', '；', '; ', '  ', ' ', ''];

function splitRecursive(text: string, maxChars: number, overlapChars: number): string[] {
    if (estimateTokens(text) <= maxChars / 3.5 || !text.trim()) {
        return text.trim() ? [text.trim()] : [];
    }
    return splitWithOverlap(splitByBestSeparator(text, maxChars), maxChars, overlapChars);
}

function splitByBestSeparator(text: string, maxChars: number): string[] {
    for (const sep of SEPARATORS) {
        const parts = text.split(sep);
        if (parts.length > 1) {
            const merged = mergeShortParts(parts, maxChars, sep);
            if (merged.length > 1) return merged;
        }
    }
    return [text];
}

function mergeShortParts(parts: string[], maxChars: number, sep: string): string[] {
    const merged: string[] = [];
    let current = '';

    for (const part of parts) {
        const candidate = current ? current + sep + part : part;
        if (estimateTokens(candidate) * 4 <= maxChars * 1.3) {
            current = candidate;
        } else {
            if (current) merged.push(current);
            current = part;
        }
    }
    if (current) merged.push(current);
    return merged;
}

function splitWithOverlap(parts: string[], maxChars: number, overlapChars: number): string[] {
    const result: string[] = [];
    for (const part of parts) {
        if (part.length <= maxChars) {
            result.push(part);
        } else {
            // Hard split for oversized parts
            let start = 0;
            while (start < part.length) {
                let end = start + maxChars;
                if (end < part.length && overlapChars > 0) {
                    end += overlapChars;
                }
                result.push(part.slice(start, Math.min(end, part.length)));
                start += maxChars;
            }
        }
    }
    return result;
}

// ── Helpers ───────────────────────────────────────────────

function hashFileName(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36).slice(0, 8);
}
