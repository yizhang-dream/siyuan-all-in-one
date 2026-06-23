/*
 * 统一来源持久化层。
 * 存储键：'sources'
 */
import type { ConceptNode, Relation } from './types/concept';
import type { Card } from './types/card';

export type SourceRecordType = 'file' | 'url' | 'paste' | 'pdf' | 'siyuan-doc';

export interface SourceRecord {
    id: string;
    title: string;
    type: SourceRecordType;
    content: string;
    contentHash?: string;
    metadata: {
        fileName?: string;
        url?: string;
        mimeType?: string;
        siyuanDocId?: string;
        pageCount?: number;
        fileSize?: number;
        addedAt: number;
    };
    chunkStatus: 'pending' | 'done' | 'error';
    errorMessage?: string;
    retryCount: number;
}

export class SourceStore {
    private sources: SourceRecord[] = [];
    private plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async load(): Promise<void> {
        try {
            const data = await this.plugin.loadData('sources');
            this.sources = Array.isArray(data) ? data : [];
        } catch {
            this.sources = [];
        }
    }

    async save(): Promise<void> {
        await this.plugin.saveData('sources', this.sources);
    }

    getAll(): SourceRecord[] {
        return [...this.sources];
    }

    getById(id: string): SourceRecord | undefined {
        return this.sources.find(s => s.id === id);
    }

    getByType(type: SourceRecordType): SourceRecord[] {
        return this.sources.filter(s => s.type === type);
    }

    getByHash(hash: string): SourceRecord | undefined {
        return this.sources.find(s => s.contentHash === hash);
    }

    getByUrl(url: string): SourceRecord | undefined {
        return this.sources.find(s => s.metadata.url === url);
    }

    add(source: SourceRecord): void {
        this.sources.push(source);
    }

    update(id: string, partial: Partial<SourceRecord>): void {
        const idx = this.sources.findIndex(s => s.id === id);
        if (idx >= 0) Object.assign(this.sources[idx], partial);
    }

    remove(id: string): void {
        this.sources = this.sources.filter(s => s.id !== id);
    }

}
