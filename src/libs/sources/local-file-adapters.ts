import type { PipelineSource } from '../ai/pipeline';

export interface LocalTextFileInput {
    name: string;
    text: string;
    type?: string;
    lastModified?: number;
}

export interface LocalFileAdapterOptions {
    maxCharsPerChunk?: number;
    maxChunksPerFile?: number;
}

export async function fileToLocalTextInput(file: File): Promise<LocalTextFileInput> {
    return {
        name: file.name,
        text: await file.text(),
        type: file.type,
        lastModified: file.lastModified,
    };
}

export function localTextFilesToPipelineSources(
    files: LocalTextFileInput[],
    options: LocalFileAdapterOptions = {}
): PipelineSource[] {
    const maxChars = Math.max(1000, Math.min(20000, options.maxCharsPerChunk || 6000));
    const maxChunks = Math.max(1, Math.min(30, options.maxChunksPerFile || 8));
    const out: PipelineSource[] = [];

    files.forEach((file, fileIndex) => {
        const name = sanitizeFileName(file.name || `file-${fileIndex + 1}`);
        const text = normalizeLocalFileText(file);
        if (!text) return;

        const chunks = splitTextIntoChunks(text, maxChars).slice(0, maxChunks);
        chunks.forEach((chunk, chunkIndex) => {
            const id = `file-${hashText(`${name}:${chunkIndex}:${chunk.slice(0, 120)}`)}`;
            out.push({
                id,
                type: 'file',
                sourceId: name,
                chunkId: `${name}#${chunkIndex + 1}`,
                quote: chunk.slice(0, 500),
                text: [
                    `# ${name}`,
                    chunks.length > 1 ? `Chunk: ${chunkIndex + 1}/${chunks.length}` : '',
                    file.type ? `MIME: ${file.type}` : '',
                    chunk,
                ].filter(Boolean).join('\n\n'),
            });
        });
    });

    return out;
}

export function normalizeLocalFileText(file: LocalTextFileInput): string {
    const raw = String(file.text || '');
    const name = file.name || '';
    const type = file.type || '';
    if (isHtmlLike(name, type)) return htmlToPlainText(raw);
    return normalizeWhitespace(raw);
}

export function splitTextIntoChunks(text: string, maxChars = 6000): string[] {
    const normalized = normalizeWhitespace(text);
    if (!normalized) return [];
    if (normalized.length <= maxChars) return [normalized];

    const paragraphs = normalized.split(/\n{2,}/);
    const chunks: string[] = [];
    let current = '';

    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) continue;
        if (!current) {
            current = paragraph;
        } else if ((current.length + paragraph.length + 2) <= maxChars) {
            current += `\n\n${paragraph}`;
        } else {
            chunks.push(current);
            current = paragraph;
        }

        while (current.length > maxChars) {
            const splitAt = findSplitPoint(current, maxChars);
            chunks.push(current.slice(0, splitAt).trim());
            current = current.slice(splitAt).trim();
        }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

function htmlToPlainText(html: string): string {
    return normalizeWhitespace(
        html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<(br|hr)\b[^>]*>/gi, '\n')
            .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|blockquote)>/gi, '\n\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
    );
}

function normalizeWhitespace(text: string): string {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[ \f\v]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function isHtmlLike(name: string, type: string): boolean {
    return /html?/i.test(type) || /\.(html?|xhtml)$/i.test(name);
}

function sanitizeFileName(name: string): string {
    return String(name || 'file')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'file';
}

function findSplitPoint(text: string, maxChars: number): number {
    const window = text.slice(0, maxChars);
    const candidates = [
        window.lastIndexOf('\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('. '),
        window.lastIndexOf('；'),
        window.lastIndexOf('; '),
        window.lastIndexOf(' '),
    ].filter((index) => index > Math.floor(maxChars * 0.55));
    return candidates.length > 0 ? Math.max(...candidates) + 1 : maxChars;
}

function hashText(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
