import { fetchOpenNotebookPipelineSources } from '../ai/source-adapters';
import type { PipelineSource } from '../ai/pipeline';
import { readSiyuanDocsAsPipelineSources, type DocItem } from '../sources';
import { localTextFilesToPipelineSources, type LocalTextFileInput } from './local-file-adapters';
import { textToUnstructuredPipelineSources } from './unstructured-partitioner';
import { fetchWebPage, webPageToPipelineSources } from './web-fetcher';
import { extractPdfText, pdfToPipelineSources } from './pdf-extractor';

export type SourceHubMode = 'manual' | 'opennotebook' | 'mixed';

export interface SourceHubRequest {
    mode: SourceHubMode;
    manualText?: string;
    // OpenNotebook (optional)
    notebookEndpoint?: string;
    notebookQuery?: string;
    notebookSourceIds?: string[];
    notebookNoteIds?: string[];
    // SiYuan + local files
    siyuanDocs?: DocItem[];
    localFiles?: LocalTextFileInput[];
    // Unstructured text
    unstructuredText?: string;
    unstructuredFileName?: string;
    // Built-in: URL web pages
    urls?: string[];
    // Built-in: PDF files
    pdfBuffers?: Array<{ buffer: ArrayBuffer; fileName: string }>;
    // Options
    openNotebookLimit?: number;
    openNotebookSearchType?: 'text' | 'vector';
    maxCharsPerSiyuanDoc?: number;
    maxCharsPerLocalFileChunk?: number;
}

export interface SourceHubResult {
    sources: PipelineSource[];
    stats: SourceHubStats;
}

export interface SourceHubStats {
    manual: number;
    source: number;
    siyuanDoc: number;
    totalBeforeDedupe: number;
    total: number;
}

export async function collectPipelineSources(request: SourceHubRequest): Promise<SourceHubResult> {
    const sources: PipelineSource[] = [];
    const manualText = String(request.manualText || '').trim();
    const notebookQuery = String(request.notebookQuery || '').trim();
    const notebookSourceIds = uniqueStrings(request.notebookSourceIds || []);
    const notebookNoteIds = uniqueStrings(request.notebookNoteIds || []);
    const siyuanDocs = request.siyuanDocs || [];
    const localFiles = request.localFiles || [];
    const urls = uniqueStrings(request.urls || []);
    const pdfBuffers = request.pdfBuffers || [];

    if ((request.mode === 'manual' || request.mode === 'mixed') && manualText) {
        sources.push(buildManualPipelineSource(manualText));
    }

    // OpenNotebook (optional, only when endpoint configured)
    if (
        (request.mode === 'opennotebook' || request.mode === 'mixed') &&
        request.notebookEndpoint &&
        (notebookQuery || notebookSourceIds.length > 0 || notebookNoteIds.length > 0)
    ) {
        sources.push(...await fetchOpenNotebookPipelineSources({
            endpoint: request.notebookEndpoint,
            query: notebookQuery,
            sourceIds: notebookSourceIds,
            noteIds: notebookNoteIds,
            limit: request.openNotebookLimit || 12,
            searchType: request.openNotebookSearchType || 'text',
        }));
    }

    if (request.mode === 'mixed' && siyuanDocs.length > 0) {
        sources.push(...await readSiyuanDocsAsPipelineSources(siyuanDocs, {
            maxCharsPerDoc: request.maxCharsPerSiyuanDoc || 8000,
        }));
    }

    if (request.mode === 'mixed' && localFiles.length > 0) {
        sources.push(...localTextFilesToPipelineSources(localFiles, {
            maxCharsPerChunk: request.maxCharsPerLocalFileChunk || 6000,
        }));
    }

    // Built-in URL fetcher
    if (request.mode === 'mixed' && urls.length > 0) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const results = await Promise.allSettled(
            urls.map((url) => fetchWebPage(url, controller.signal))
        );
        clearTimeout(timeout);
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.text) {
                sources.push(...webPageToPipelineSources(result.value, 10));
            }
        }
    }

    // Built-in PDF extractor
    if (request.mode === 'mixed' && pdfBuffers.length > 0) {
        for (const pdf of pdfBuffers) {
            const result = await extractPdfText(pdf.buffer, pdf.fileName);
            if (result.text) {
                sources.push(...pdfToPipelineSources(result, 16));
            }
        }
    }

    // Unstructured partitioner (explicitly provided text)
    const unstructuredText = String(request.unstructuredText || '').trim();
    if (request.mode === 'mixed' && unstructuredText) {
        sources.push(...textToUnstructuredPipelineSources(
            unstructuredText,
            request.unstructuredFileName || 'unstructured-input',
            { maxElements: 40 }
        ));
    }

    const totalBeforeDedupe = sources.length;
    const deduped = dedupePipelineSources(sources);
    return {
        sources: deduped,
        stats: {
            manual: deduped.filter((s) => s.type === 'manual').length,
            source: deduped.filter((s) => s.type === 'source').length,
            siyuanDoc: deduped.filter((s) => s.type === 'siyuan-doc').length,
            totalBeforeDedupe,
            total: deduped.length,
        },
    };
}

export function buildManualPipelineSource(text: string): PipelineSource {
    const clipped = String(text || '').trim();
    return {
        id: 'manual-1',
        type: 'manual',
        sourceId: 'manual-1',
        chunkId: 'manual-1',
        quote: clipped.slice(0, 500),
        text: clipped,
    };
}

export function dedupePipelineSources(sources: PipelineSource[]): PipelineSource[] {
    const seen = new Set<string>();
    return sources.filter((source) => {
        const key = [
            source.type || 'manual',
            source.sourceId || '',
            source.blockId || '',
            source.chunkId || '',
            source.text.slice(0, 120),
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)));
}
