/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 知识来源管理：思源文档 / 手动输入。
 */

import { fetchSyncPost } from 'siyuan';
import type { PipelineSource } from './ai/pipeline';
import { siyuanDocsToPipelineSources, type SiyuanDocContent } from './ai/siyuan-source-adapters';

export { siyuanDocsToPipelineSources };
export type { SiyuanDocContent };

/** 来源类型 */
export type SourceType = 'none' | 'siyuan' | 'manual';

/** 来源配置 */
export interface SourceConfig {
    type: SourceType;
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
    config: SourceConfig
): Promise<string> {
    switch (config.type) {
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
