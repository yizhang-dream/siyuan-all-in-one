/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 知识来源管理：从 Open Notebook / 思源文档 / 手动输入 获取上下文内容。
 */

import { fetchSyncPost } from 'siyuan';
import { OpenNotebookClient } from './notebook';
import { openNotebookResultsToPipelineSources } from './ai/source-adapters';
import type { PipelineSource } from './ai/pipeline';
import { siyuanDocsToPipelineSources, type SiyuanDocContent } from './ai/siyuan-source-adapters';

export { siyuanDocsToPipelineSources };
export type { SiyuanDocContent };

/** 来源类型 */
export type SourceType = 'none' | 'notebook' | 'siyuan' | 'manual';

/** 来源配置 */
export interface SourceConfig {
    type: SourceType;
    notebookQuery?: string;
    notebookSourceIds?: string[];
    /** 思源文档 ID 列表（支持多选） */
    siyuanDocIds: string[];
    manualText?: string;
}

export interface DocItem {
    id: string;
    title: string;
}

/** 搜索思源文档（用 SQL 全文搜索文档标题和内容） */
export async function searchSiyuanDocs(keyword: string): Promise<DocItem[]> {
    if (!keyword.trim()) return [];
    try {
        const resp = await fetchSyncPost('/api/query/sql', {
            stmt: `SELECT id, content, hpath FROM blocks WHERE type='d' AND (hpath LIKE '%${keyword.replace(/'/g, "''")}%' OR content LIKE '%${keyword.replace(/'/g, "''")}%') LIMIT 30`,
        });
        const rows = resp?.data || [];
        return rows.map((d: any) => ({
            id: d.id || '',
            title: d.content || d.hpath || 'Untitled',
        }));
    } catch {
        return [];
    }
}

/** 读取思源文档 Markdown 内容 */
export async function readSiyuanDoc(docId: string): Promise<string> {
    try {
        const resp = await fetchSyncPost('/api/export/exportMdContent', { id: docId });
        return resp?.data?.content || '';
    } catch {
        return '';
    }
}

export async function readSiyuanDocsAsPipelineSources(
    docs: DocItem[],
    options: { maxCharsPerDoc?: number } = {}
): Promise<PipelineSource[]> {
    const items: SiyuanDocContent[] = [];
    for (const doc of docs) {
        const content = await readSiyuanDoc(doc.id);
        if (content.trim()) {
            items.push({ id: doc.id, title: doc.title, content });
        }
    }
    return siyuanDocsToPipelineSources(items, options);
}

/**
 * 根据来源配置获取上下文文本。
 */
export async function fetchContext(
    config: SourceConfig,
    notebookEndpoint?: string
): Promise<string> {
    switch (config.type) {
        case 'notebook':
            if (!notebookEndpoint || !config.notebookQuery?.trim()) return '';
            try {
                const client = new OpenNotebookClient(notebookEndpoint);
                if (config.notebookSourceIds && config.notebookSourceIds.length > 0) {
                    const results = await client.searchInSources(config.notebookQuery, config.notebookSourceIds, { limit: 10 });
                    return openNotebookResultsToContext(results, config.notebookQuery);
                }
                const results = await client.search(config.notebookQuery, { limit: 10 });
                return openNotebookResultsToContext(results, config.notebookQuery);
            } catch {
                return '';
            }

        case 'siyuan': {
            const ids = config.siyuanDocIds || [];
            if (ids.length === 0) return '';
            const docs = ids.map((id) => ({ id, title: id }));
            const sources = await readSiyuanDocsAsPipelineSources(docs, { maxCharsPerDoc: 8000 });
            return sources.map((source) => source.text).join('\n\n-----\n\n');
        }

        case 'manual':
            return config.manualText || '';

        default:
            return '';
    }
}

function openNotebookResultsToContext(results: any[], query: string): string {
    return openNotebookResultsToPipelineSources(results, query, { maxCharsPerSource: 2500 })
        .map((source, index) => [
            `[OpenNotebook ${index + 1}] sourceId=${source.sourceId || ''} chunkId=${source.chunkId || ''}`,
            source.url ? `url=${source.url}` : '',
            source.page !== undefined ? `page=${source.page}` : '',
            source.text,
        ].filter(Boolean).join('\n'))
        .join('\n\n---\n\n');
}
