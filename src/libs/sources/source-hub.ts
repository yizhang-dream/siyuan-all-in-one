import { fetchOpenNotebookPipelineSources } from '../ai/source-adapters';
import type { PipelineSource } from '../ai/pipeline';
import { readSiyuanDocsAsPipelineSources, type DocItem } from '../sources';
import { localTextFilesToPipelineSources, type LocalTextFileInput } from './local-file-adapters';
import { textToUnstructuredPipelineSources } from './unstructured-partitioner';

export type SourceHubMode = 'manual' | 'opennotebook' | 'mixed';

export interface SourceHubRequest {
    mode: SourceHubMode;
    manualText?: string;
    notebookEndpoint?: string;
    notebookQuery?: string;
    notebookSourceIds?: string[];
    notebookNoteIds?: string[];
    siyuanDocs?: DocItem[];
    localFiles?: LocalTextFileInput[];
    unstructuredText?: string;
    unstructuredFileName?: string;
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
    file: number;
    openNotebook: number;
    siyuan: number;
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

    if ((request.mode === 'manual' || request.mode === 'mixed') && manualText) {
        sources.push(buildManualPipelineSource(manualText));
    }

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

    // Unstructured 分区：将原始文本按结构自动拆分为 Title/NarrativeText/ListItem 等元素
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
            manual: deduped.filter((source) => source.type === 'manual').length,
            file: deduped.filter((source) => source.type === 'file').length,
            openNotebook: deduped.filter((source) => source.type === 'opennotebook').length,
            siyuan: deduped.filter((source) => source.type === 'siyuan').length,
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
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}
