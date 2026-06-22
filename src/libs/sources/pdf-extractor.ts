/**
 * 内置 PDF 文本提取器 — 使用 pdfjs-dist v3，不依赖外部后端。
 *
 * ── Array.prototype pollution guard ──────────────────────────────────────────
 * SiYuan / other plugins may add enumerable properties to Array.prototype
 * (e.g. groupedParallelExecute, executeSequentially, findOrLesser, …).
 * pdfjs-dist v3 uses `for..in` on arrays internally, which picks up these
 * extra properties and throws "The Array.prototype contains unexpected
 * enumerable properties".
 *
 * We temporarily strip all non-standard enumerable Array.prototype entries
 * for the duration of the pdfjs call, then restore them.
 */
import type { PipelineSource } from '../ai/pipeline';
import { textToUnstructuredPipelineSources } from './unstructured-partitioner';
// Use the legacy CJS build for Electron compatibility
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
// Register pdf.js worker on the main thread (no separate worker file needed)
// This is the official v3 approach for Node.js/Electron environments
import 'pdfjs-dist/legacy/build/pdf.worker.entry';

// ── helpers ─────────────────────────────────────────────────────────────────
const ARRAY_PROTO = Array.prototype;

/**
 * Snapshot, remove, and later restore any non-standard enumerable properties
 * on Array.prototype. Returns a restore function.
 */
function sanitizeArrayProto(): () => void {
    const pollutedKeys: string[] = [];
    const saved: Record<string, unknown> = {};
    // Object.keys only returns enumerable own(-ish) properties.
    // Standard Array methods (push, pop, forEach, …) are non-enumerable
    // so they won't appear here — only custom additions will.
    for (const key of Object.getOwnPropertyNames(ARRAY_PROTO)) {
        const desc = Object.getOwnPropertyDescriptor(ARRAY_PROTO, key);
        if (desc && desc.enumerable) {
            pollutedKeys.push(key);
            saved[key] = (ARRAY_PROTO as any)[key];
            delete (ARRAY_PROTO as any)[key];
        }
    }
    return function restore() {
        for (const key of pollutedKeys) {
            try {
                Object.defineProperty(ARRAY_PROTO, key, {
                    value: saved[key],
                    enumerable: true,
                    writable: true,
                    configurable: true,
                });
            } catch { /* best-effort */ }
        }
    };
}

async function getDocumentSafe(
    src: Parameters<typeof pdfjsLib.getDocument>[0],
): Promise<PDFDocumentProxy> {
    const restore = sanitizeArrayProto();
    try {
        return await pdfjsLib.getDocument(src).promise;
    } finally {
        restore();
    }
}

export interface PdfExtractResult {
    fileName: string;
    text: string;
    pageCount: number;
    error?: string;
}

/** 从 PDF 文件 ArrayBuffer 中提取文本 */
export async function extractPdfText(
    buffer: ArrayBuffer,
    fileName: string,
    signal?: AbortSignal
): Promise<PdfExtractResult> {
    try {
        const doc = await getDocumentSafe({
            data: new Uint8Array(buffer),
            useSystemFonts: true,
        });

        const pageCount = doc.numPages;
        const pageTexts: string[] = [];

        for (let i = 1; i <= pageCount; i++) {
            if (signal?.aborted) break;
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const text = content.items
                .map((item: any) => item.str || '')
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (text) pageTexts.push(text);
        }

        return {
            fileName,
            text: pageTexts.join('\n\n'),
            pageCount,
        };
    } catch (err: any) {
        throw new Error(`PDF 解析失败: ${err?.message || String(err)}`);
    }
}

/** 将 PDF 提取结果转为 PipelineSource[] */
export function pdfToPipelineSources(result: PdfExtractResult, maxSources = 16): PipelineSource[] {
    if (!result.text.trim()) return [];
    const enriched = `# ${result.fileName} (${result.pageCount} pages)\n\n${result.text}`;
    return textToUnstructuredPipelineSources(enriched, result.fileName, { maxElements: maxSources }).map((s) => ({ ...s, type: 'source' as const }));
}

/** 从 File 对象读取 PDF */
export function readPdfFile(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error('Failed to read PDF file'));
        reader.readAsArrayBuffer(file);
    });
}
