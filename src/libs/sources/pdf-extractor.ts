/**
 * 内置 PDF 文本提取器 — 使用 pdfjs-dist，不依赖外部后端。
 */
import type { PipelineSource } from '../ai/pipeline';
import { textToUnstructuredPipelineSources } from './unstructured-partitioner';

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
        const pdfjsLib = await import('pdfjs-dist');
        const doc = await pdfjsLib.getDocument({
            data: new Uint8Array(buffer),
            useWorkerFetch: false,
        }).promise;

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
        return {
            fileName,
            text: '',
            pageCount: 0,
            error: err?.message || String(err),
        };
    }
}

/** 将 PDF 提取结果转为 PipelineSource[] */
export function pdfToPipelineSources(result: PdfExtractResult, maxSources = 16): PipelineSource[] {
    if (!result.text.trim()) return [];
    const enriched = `# ${result.fileName} (${result.pageCount} pages)\n\n${result.text}`;
    return textToUnstructuredPipelineSources(enriched, result.fileName, { maxElements: maxSources }).map((s) => ({ ...s, type: 'pdf' as const }));
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
