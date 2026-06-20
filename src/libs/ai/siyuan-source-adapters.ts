import type { PipelineSource } from './pipeline';

export interface SiyuanDocContent {
    id: string;
    title?: string;
    content: string;
}

export function siyuanDocsToPipelineSources(
    docs: SiyuanDocContent[],
    options: { maxCharsPerDoc?: number } = {}
): PipelineSource[] {
    const maxChars = Math.max(800, Math.min(20000, options.maxCharsPerDoc || 8000));
    const seen = new Set<string>();
    return docs
        .map((doc, index) => {
            const id = String(doc.id || `siyuan-doc-${index + 1}`).trim();
            const content = String(doc.content || '')
                .replace(/\r\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            if (!id || !content || seen.has(id)) return null;
            seen.add(id);
            const clipped = content.slice(0, maxChars);
            const title = String(doc.title || '').trim();
            return {
                id: `siyuan-${id}`,
                type: 'siyuan' as const,
                sourceId: id,
                blockId: id,
                chunkId: id,
                quote: clipped.slice(0, 500),
                text: [
                    title ? `# ${title}` : '',
                    `SiYuan blockId: ${id}`,
                    clipped,
                ].filter(Boolean).join('\n\n'),
            };
        })
        .filter((item: PipelineSource | null): item is PipelineSource => Boolean(item));
}
