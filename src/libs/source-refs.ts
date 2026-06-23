import type { SourceRef } from './types/concept';

export type SourceActionKind = 'open-url' | 'open-siyuan-block' | 'open-rag' | 'copy-locator' | 'none';

export interface SourceActionDescriptor {
    kind: SourceActionKind;
    label: string;
    target?: string;
    copyText?: string;
}

const TYPE_LABELS: Record<SourceRef['type'], string> = {
    siyuan: 'SiYuan',
    manual: '手动',
    file: '文件',
    pdf: 'PDF',
    url: 'URL',
    rag: 'RAG',
    opennotebook: 'OpenNotebook（已废弃）',
};

export function sourceTypeLabel(type?: SourceRef['type'] | string): string {
    return (type && TYPE_LABELS[type as SourceRef['type']]) || String(type || '来源');
}

export function formatSourceLabel(ref: Partial<SourceRef> = {}): string {
    const id = ref.blockId || ref.chunkId || ref.sourceId || ref.url || '';
    const page = ref.page !== undefined ? `p.${ref.page}` : '';
    return [sourceTypeLabel(ref.type), id, page].filter(Boolean).join(' · ');
}

export function formatSourceText(ref: Partial<SourceRef> = {}): string {
    return String(ref.quote || ref.url || ref.blockId || ref.chunkId || ref.sourceId || '').trim();
}

export function sourceLocatorText(ref: Partial<SourceRef> = {}): string {
    const parts = [
        `type=${ref.type || 'unknown'}`,
        ref.sourceId ? `sourceId=${ref.sourceId}` : '',
        ref.blockId ? `blockId=${ref.blockId}` : '',
        ref.chunkId ? `chunkId=${ref.chunkId}` : '',
        ref.page !== undefined ? `page=${ref.page}` : '',
        ref.url ? `url=${ref.url}` : '',
        ref.quote ? `quote=${ref.quote}` : '',
    ].filter(Boolean);
    return parts.join('\n');
}
export function getSourceAction(ref: Partial<SourceRef> = {}): SourceActionDescriptor {
    if (ref.url) {
        return { kind: 'open-url', label: '打开链接', target: ref.url };
    }
    if (ref.type === 'siyuan' && ref.blockId) {
        return { kind: 'open-siyuan-block', label: '打开块', target: ref.blockId };
    }
    if (ref.type === 'rag' && (ref.sourceId || ref.chunkId || ref.quote)) {
        return {
            kind: 'open-rag',
            label: '打开RAG来源',
            target: ref.sourceId || ref.chunkId,
            copyText: sourceLocatorText(ref),
        };
    }
    if (ref.blockId) {
        return { kind: 'open-siyuan-block', label: '打开块', target: ref.blockId };
    }
    if (ref.sourceId || ref.chunkId || ref.quote) {
        return { kind: 'copy-locator', label: '复制定位', copyText: sourceLocatorText(ref) };
    }
    return { kind: 'none', label: '' };
}
