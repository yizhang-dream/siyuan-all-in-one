import { OpenNotebookClient, type SearchResult } from '../notebook';
import type { PipelineSource } from './pipeline';

export interface OpenNotebookPipelineSourceOptions {
    endpoint: string;
    query: string;
    sourceIds?: string[];
    noteIds?: string[];
    limit?: number;
    searchType?: 'text' | 'vector';
    minimumScore?: number;
    maxCharsPerSource?: number;
}

export async function fetchOpenNotebookPipelineSources(
    options: OpenNotebookPipelineSourceOptions
): Promise<PipelineSource[]> {
    const query = options.query.trim();
    const noteIds = uniqueStrings(options.noteIds || []);
    const selectedSourceIds = uniqueStrings(options.sourceIds || []);
    if (!options.endpoint || (!query && noteIds.length === 0 && selectedSourceIds.length === 0)) return [];

    const client = new OpenNotebookClient(options.endpoint);
    const searchType = options.searchType || 'text';
    const sourceResults = query ? [] : await fetchOpenNotebookSourceResults(client, selectedSourceIds);
    const noteResults = await fetchOpenNotebookNoteResults(client, noteIds);
    const scopedIds = [...selectedSourceIds, ...noteIds].filter(Boolean);
    let results: SearchResult[] = [];

    if (query) {
        try {
            results = scopedIds.length
                ? await client.searchInSources(query, scopedIds, {
                    type: searchType,
                    limit: options.limit || 12,
                })
                : await client.search(query, {
                    type: searchType,
                    limit: options.limit || 12,
                    minimumScore: options.minimumScore ?? 0.2,
                });
        } catch (err) {
            if (searchType !== 'vector') throw err;
            results = scopedIds.length
                ? await client.searchInSources(query, scopedIds, {
                    type: 'text',
                    limit: options.limit || 12,
                })
                : await client.search(query, {
                    type: 'text',
                    limit: options.limit || 12,
                    minimumScore: options.minimumScore ?? 0.2,
                });
        }
    }

    return openNotebookResultsToPipelineSources([...sourceResults, ...noteResults, ...results], query, {
        maxCharsPerSource: options.maxCharsPerSource,
    });
}

export function openNotebookResultsToPipelineSources(
    results: SearchResult[],
    query = '',
    options: { maxCharsPerSource?: number } = {}
): PipelineSource[] {
    const seen = new Set<string>();
    const maxChars = Math.max(500, Math.min(12000, options.maxCharsPerSource || 5000));
    return results
        .map((result, index) => {
            const text = normalizeSearchContent(result);
            if (!text) return null;
            const chunkId = toString(result.chunkId || result.id || result.metadata?.chunk_id || `opennotebook-${index + 1}`);
            const sourceId = toString(result.sourceId || result.parentId || result.metadata?.source_id || result.id || chunkId);
            const id = `on-${chunkId}`;
            const dedupeKey = [sourceId, chunkId, text.slice(0, 120)].join('|');
            if (seen.has(dedupeKey)) return null;
            seen.add(dedupeKey);
            const clipped = text.slice(0, maxChars);
            const score = typeof result.score === 'number'
                ? result.score
                : typeof result.relevance === 'number'
                    ? result.relevance
                    : undefined;
            return {
                id,
                type: 'source' as const,
                sourceId,
                chunkId,
                quote: clipped.slice(0, 500),
                page: result.page,
                url: result.url || result.metadata?.url,
                text: [
                    result.title ? `# ${result.title}` : '',
                    query ? `Query: ${query}` : '',
                    score !== undefined ? `Score: ${score}` : '',
                    result.url || result.metadata?.url ? `URL: ${result.url || result.metadata?.url}` : '',
                    clipped,
                ].filter(Boolean).join('\n\n'),
            };
        })
        .filter((item: PipelineSource | null): item is PipelineSource => Boolean(item));
}

function normalizeSearchContent(result: SearchResult): string {
    return toString(
        result.content ||
        result.text ||
        result.chunk_text ||
        result.snippet ||
        result.summary ||
        result.excerpt ||
        result.page_content ||
        result.pageContent ||
        result.chunk?.text ||
        result.chunk?.content ||
        result.document?.content ||
        result.metadata?.content ||
        result.metadata?.text ||
        result.metadata?.chunk_text ||
        result.metadata?.page_content ||
        ''
    )
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function fetchOpenNotebookNoteResults(
    client: OpenNotebookClient,
    noteIds: string[]
): Promise<SearchResult[]> {
    const settled = await Promise.all(
        noteIds.map(async (noteId) => {
            try {
                return noteDetailToSearchResult(await client.getNote(noteId), noteId);
            } catch {
                return null;
            }
        })
    );
    return settled.filter((item: SearchResult | null): item is SearchResult => Boolean(item));
}

async function fetchOpenNotebookSourceResults(
    client: OpenNotebookClient,
    sourceIds: string[]
): Promise<SearchResult[]> {
    const settled = await Promise.all(
        sourceIds.map(async (sourceId) => {
            try {
                return sourceDetailToSearchResult(await client.getSource(sourceId), sourceId);
            } catch {
                return null;
            }
        })
    );
    return settled.filter((item: SearchResult | null): item is SearchResult => Boolean(item));
}

function sourceDetailToSearchResult(detail: any, fallbackId: string): SearchResult | null {
    const content = firstNestedString(detail, [
        'full_text',
        'fullText',
        'content',
        'text',
        'markdown',
        'body',
        'summary',
        'description',
    ]);
    if (!content.trim()) return null;

    const id = firstNestedString(detail, ['id', 'source_id', 'sourceId']) || fallbackId;
    const title = firstNestedString(detail, ['title', 'name', 'filename']) || 'Selected source';
    const url = firstNestedString(detail, ['url', 'uri', 'source_url', 'sourceUrl']);
    const page = Number(firstNestedString(detail, ['page', 'page_number', 'pageNumber']));

    return {
        id,
        title,
        content,
        parentId: id,
        sourceId: id,
        chunkId: id,
        url: url || undefined,
        page: Number.isFinite(page) ? page : undefined,
        metadata: { source_id: id },
    };
}

function noteDetailToSearchResult(detail: any, fallbackId: string): SearchResult | null {
    const content = firstNestedString(detail, [
        'content',
        'text',
        'markdown',
        'body',
        'full_text',
        'fullText',
        'page_content',
        'pageContent',
        'note',
        'summary',
    ]);
    if (!content.trim()) return null;

    const id = firstNestedString(detail, ['id', 'note_id', 'noteId']) || fallbackId;
    const title = firstNestedString(detail, ['title', 'name']) || 'Selected note';
    const url = firstNestedString(detail, ['url', 'uri', 'source_url', 'sourceUrl']);
    const page = Number(firstNestedString(detail, ['page', 'page_number', 'pageNumber']));

    return {
        id: fallbackId,
        title,
        content,
        parentId: id,
        sourceId: id,
        chunkId: fallbackId,
        url: url || undefined,
        page: Number.isFinite(page) ? page : undefined,
        metadata: { note_id: id },
    };
}

function firstNestedString(value: any, keys: string[], depth = 4): string {
    if (value === undefined || value === null || depth < 0) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = firstNestedString(item, keys, depth - 1);
            if (found) return found;
        }
        return '';
    }
    if (typeof value !== 'object') return '';

    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === 'string' || typeof candidate === 'number') {
            const found = String(candidate).trim();
            if (found) return found;
        }
    }

    for (const key of ['data', 'note', 'item', 'record', 'result', 'document', 'metadata', 'source']) {
        const found = firstNestedString(value[key], keys, depth - 1);
        if (found) return found;
    }

    return '';
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => toString(value).trim()).filter(Boolean)));
}

function toString(value: any): string {
    if (value === undefined || value === null) return '';
    return String(value);
}
