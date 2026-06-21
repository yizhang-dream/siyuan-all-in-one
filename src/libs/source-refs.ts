import type { SourceRef } from './types/concept';

export type SourceActionKind = 'open-url' | 'open-siyuan-block' | 'open-opennotebook' | 'copy-locator' | 'none';

export interface SourceActionDescriptor {
    kind: SourceActionKind;
    label: string;
    target?: string;
    copyText?: string;
}

export interface OpenNotebookLocator {
    key: string;
    label: string;
    locatorText: string;
    prompt: string;
    sourceId?: string;
    chunkId?: string;
    page?: number;
    quote?: string;
}

const TYPE_LABELS: Record<SourceRef['type'], string> = {
    opennotebook: 'OpenNotebook',
    siyuan: 'SiYuan',
    manual: '手动',
    file: '文件',
    pdf: 'PDF',
    url: 'URL',
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

export function buildOpenNotebookLocator(ref: Partial<SourceRef> = {}): OpenNotebookLocator | null {
    if (ref.type && ref.type !== 'opennotebook') return null;
    if (!ref.sourceId && !ref.chunkId && !ref.quote) return null;

    const locatorParts = [
        ref.sourceId ? `sourceId=${ref.sourceId}` : '',
        ref.chunkId ? `chunkId=${ref.chunkId}` : '',
        ref.page !== undefined ? `page=${ref.page}` : '',
    ].filter(Boolean);
    const locatorText = locatorParts.join(' ');
    const quote = String(ref.quote || '').trim();
    const key = [ref.sourceId || '', ref.chunkId || '', ref.page ?? '', quote].join('|');
    const label = locatorText || 'OpenNotebook source';
    const prompt = quote
        ? `请基于这个 OpenNotebook 来源继续解释，并指出它适合生成哪些概念和闪卡：\n\n${locatorText}\n\n${quote}`
        : `请基于这个 OpenNotebook 来源继续解释，并指出它适合生成哪些概念和闪卡：\n\n${locatorText}`;

    return {
        key,
        label,
        locatorText,
        prompt,
        sourceId: ref.sourceId,
        chunkId: ref.chunkId,
        page: ref.page,
        quote,
    };
}

export function getSourceAction(ref: Partial<SourceRef> = {}): SourceActionDescriptor {
    if (ref.url) {
        return { kind: 'open-url', label: '打开链接', target: ref.url };
    }
    if (ref.type === 'opennotebook' && (ref.sourceId || ref.chunkId || ref.quote)) {
        return {
            kind: 'open-opennotebook',
            label: '打开来源',
            target: ref.sourceId || ref.chunkId,
            copyText: sourceLocatorText(ref),
        };
    }
    if (ref.type === 'siyuan' && ref.blockId) {
        return { kind: 'open-siyuan-block', label: '打开块', target: ref.blockId };
    }
    if (ref.blockId) {
        return { kind: 'open-siyuan-block', label: '打开块', target: ref.blockId };
    }
    if (ref.sourceId || ref.chunkId || ref.quote) {
        return { kind: 'copy-locator', label: '复制定位', copyText: sourceLocatorText(ref) };
    }
    return { kind: 'none', label: '' };
}
