import type { SourceRef } from './types/concept';

export type SourceActionKind = 'open-url' | 'open-siyuan-block' | 'open-rag' | 'copy-locator' | 'none';

export interface SourceActionDescriptor {
    kind: SourceActionKind;
    label: string;
    target?: string;
    copyText?: string;
}

const TYPE_LABELS: Record<string, string> = {
    'siyuan-doc': '思源文档',
    manual: '手动',
    source: '来源库',
};

export function sourceTypeLabel(type?: string): string {
    return (type && TYPE_LABELS[type]) || String(type || '来源');
}

export function formatSourceLabel(ref: Partial<SourceRef> = {}): string {
    const id = ref.blockId || ref.sourceId || '';
    const page = ref.page !== undefined ? `p.${ref.page}` : '';
    return [sourceTypeLabel(ref.type), id, page].filter(Boolean).join(' · ');
}

export function formatSourceText(ref: Partial<SourceRef> = {}): string {
    return String(ref.quote || ref.blockId || ref.sourceId || '').trim();
}

export function sourceLocatorText(ref: Partial<SourceRef> = {}): string {
    const parts = [
        `type=${ref.type || 'unknown'}`,
        ref.sourceId ? `sourceId=${ref.sourceId}` : '',
        ref.blockId ? `blockId=${ref.blockId}` : '',
        ref.page !== undefined ? `page=${ref.page}` : '',
        ref.quote ? `quote=${ref.quote}` : '',
    ].filter(Boolean);
    return parts.join('\n');
}

export function getSourceAction(ref: Partial<SourceRef> = {}): SourceActionDescriptor {
    if (ref.type === 'source' && (ref.sourceId || ref.quote)) {
        return {
            kind: 'open-rag',
            label: '打开来源',
            target: ref.sourceId,
            copyText: sourceLocatorText(ref),
        };
    }
    if (ref.type === 'siyuan-doc' && ref.blockId) {
        return { kind: 'open-siyuan-block', label: '打开块', target: ref.blockId };
    }
    if (ref.blockId) {
        return { kind: 'open-siyuan-block', label: '打开块', target: ref.blockId };
    }
    if (ref.sourceId || ref.quote) {
        return { kind: 'copy-locator', label: '复制定位', copyText: sourceLocatorText(ref) };
    }
    return { kind: 'none', label: '' };
}
