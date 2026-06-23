/*
 * PDF page renderer — converts PDF pages to base64 PNG images
 * for vision-LLM formula/text extraction.
 * Uses pdfjs-dist v3 (legacy CJS build) with main-thread worker entry.
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
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
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

// ── types ───────────────────────────────────────────────────────────────────

export interface RenderedPage {
    pageNum: number;       // 1-indexed
    base64: string;        // raw base64 (NO data: prefix), PNG format
    width: number;
    height: number;
}

export interface RenderOptions {
    scale?: number;        // default 2.0 (good balance of quality vs size)
    maxPages?: number;     // default 0 = all pages; cap for large PDFs
}

// ── renderer ────────────────────────────────────────────────────────────────

/**
 * Render PDF pages to base64 PNG images.
 * @param buffer - ArrayBuffer of the PDF file
 * @param options - rendering options
 * @returns array of RenderedPage (1-indexed page numbers)
 */
export async function renderPdfPages(
    buffer: ArrayBuffer,
    options: RenderOptions = {}
): Promise<RenderedPage[]> {
    if (typeof document === 'undefined') {
        throw new Error('PDF rendering requires a browser/DOM environment');
    }

    const scale = options.scale ?? 2.0;
    const maxPages = options.maxPages ?? 0;
    const pages: RenderedPage[] = [];

    const restore = sanitizeArrayProto();
    try {
        const doc = await pdfjsLib.getDocument({
            data: new Uint8Array(buffer),
            useSystemFonts: true,
        }).promise;

        const totalPages = doc.numPages;
        const limit = maxPages > 0 ? Math.min(totalPages, maxPages) : totalPages;

        for (let pageNum = 1; pageNum <= limit; pageNum++) {
            const page = await doc.getPage(pageNum);
            try {
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    throw new Error('Failed to get 2D canvas context');
                }

                await page.render({ canvasContext: ctx, viewport }).promise;

                const dataUrl = canvas.toDataURL('image/png');  // "data:image/png;base64,...."
                const base64 = dataUrl.split(',')[1] ?? '';     // strip the data: prefix

                pages.push({
                    pageNum,
                    base64,
                    width: viewport.width,
                    height: viewport.height,
                });
            } finally {
                page.cleanup();
            }
        }

        doc.destroy();
        return pages;
    } finally {
        restore();
    }
}
