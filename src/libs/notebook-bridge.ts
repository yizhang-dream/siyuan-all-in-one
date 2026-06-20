import type { OpenNotebookLocator } from './source-refs';

export interface NotebookConceptRequest {
    key: string;
    query: string;
    sourceIds: string[];
    noteIds: string[];
    sourceLabel?: string;
    autoRun?: boolean;
}

export interface NotebookConceptRequestInput {
    inputText?: string;
    activeLocator?: Partial<OpenNotebookLocator> | null;
    sourceModes?: Record<string, string>;
    noteModes?: Record<string, string>;
    fallbackSourceId?: string;
    autoRun?: boolean;
}

export function buildNotebookConceptRequest(
    input: NotebookConceptRequestInput
): NotebookConceptRequest | null {
    const sourceIds = uniqueStrings([
        ...Object.entries(input.sourceModes || {})
            .filter(([, mode]) => mode && mode !== 'off')
            .map(([id]) => id),
        input.activeLocator?.sourceId || '',
        input.fallbackSourceId || '',
    ]);
    const noteIds = uniqueStrings(
        Object.entries(input.noteModes || {})
            .filter(([, mode]) => mode && mode !== 'off')
            .map(([id]) => id)
    );

    const query = [
        input.activeLocator?.quote,
        input.inputText,
        input.activeLocator?.locatorText,
        sourceIds.length ? `sources ${sourceIds.join(' ')}` : '',
        noteIds.length ? `notes ${noteIds.join(' ')}` : '',
    ].map((value) => String(value || '').trim()).find(Boolean) || '';

    if (!query && sourceIds.length === 0 && noteIds.length === 0) return null;

    return {
        key: [query, sourceIds.join(','), noteIds.join(',')].join('|'),
        query,
        sourceIds,
        noteIds,
        sourceLabel: [
            sourceIds.length ? `sources: ${sourceIds.join(', ')}` : '',
            noteIds.length ? `notes: ${noteIds.join(', ')}` : '',
        ].filter(Boolean).join(' | ') || undefined,
        autoRun: input.autoRun ?? true,
    };
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values.map((item) => item.trim()).filter(Boolean)) {
        if (seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}
