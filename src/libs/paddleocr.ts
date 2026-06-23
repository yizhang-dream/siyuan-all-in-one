/*
 * Lazy PaddleOCR wrapper for offline formula/text OCR.
 * paddleocr-js is 112MB — must NOT be bundled. Loaded via eval('require') at runtime.
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 */

let paddleOcrInstance: any = null;

async function loadPaddleOcr(): Promise<any> {
    if (paddleOcrInstance) return paddleOcrInstance;
    try {
        // eval('require') works in Electron renderer CJS context
        const mod = eval('require')('paddleocr-js');
        const PaddleOCR = mod.PaddleOCR || mod.default;
        paddleOcrInstance = new PaddleOCR({ language: 'ch', useWasm: true });
        await paddleOcrInstance.init();
        return paddleOcrInstance;
    } catch (e: any) {
        throw new Error(`PaddleOCR 加载失败（请确认已安装 paddleocr-js）: ${e?.message || e}`);
    }
}

export async function isPaddleOcrAvailable(): Promise<boolean> {
    try { await loadPaddleOcr(); return true; } catch { return false; }
}

export async function paddleOcrExtract(imageBase64: string, options?: { formula?: boolean }): Promise<string> {
    const ocr = await loadPaddleOcr();
    const buffer = Buffer.from(imageBase64, 'base64');
    if (options?.formula) {
        const results = await ocr.recognizeFormula(buffer);
        return results?.[0]?.formula || '';
    }
    const results = await ocr.recognize(buffer);
    // results is array of {text, confidence, box} — join text
    return results?.map((r: any) => r.text).join('\n') || '';
}
