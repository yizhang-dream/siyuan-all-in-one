/**
 * 内置 PDF 文本提取器 — 使用 pdfjs-dist，不依赖外部后端。
 */
import type { PipelineSource } from '../ai/pipeline';
import { textToUnstructuredPipelineSources } from './unstructured-partitioner';
// Static import — Vite CJS bundler converts ESM → CJS require at build time
import * as pdfjsLib from 'pdfjs-dist';

// pdfjs-dist v6 tries to spawn a Web Worker for off-thread parsing.
// In Electron's sandboxed renderer, `new Worker(filesystemPath)` fails because
// Electron only accepts HTTP/blob URLs for worker constructors. The fallback
// "fake worker" then attempts `import(filesystemPath)` which also fails.
//
// Our fix: read the bundled worker file at init and create a blob:// URL.
// blob:// URLs are valid Worker sources in all Chromium-based renderers
// (including Electron's sandboxed context). This allows the real worker to
// start successfully.
try {
    const req = eval('require');
    const path = req('path');
    const fs = req('fs');
    const workerPath = path.join(__dirname, 'pdf.worker.min.mjs');
    const workerCode = fs.readFileSync(workerPath, 'utf-8');
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
} catch {
    // If blob URL creation fails, leave workerSrc unset — pdfjs will try its
    // built-in fallbacks (may or may not work depending on environment).
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
