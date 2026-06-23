/*
 * Lazy PaddleOCR wrapper for offline formula/text OCR.
 * paddleocr-js is 112MB+ — must NOT be bundled. Loaded via require() at runtime.
 * Uses a fallback chain for require resolution to handle different module loading contexts.
 *
 * Models (~112MB) are bundled separately at dist/models/paddleocr/ via viteStaticCopy.
 * They must be in TF.js GraphModel format (model.json + .bin weight shards) because
 * paddleocr-js defaults to TensorFlow.js backend.  If ONNX format is used instead,
 * set useTensorflow: false / useONNX: true below.
 *
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 */

let paddleOcrInstance: any = null;

/** Try to get the real Node.js `require` function. */
function getNodeRequire(): ((id: string) => any) | null {
    // Strategy 1: eval('require') — works in Rollup CJS output where the real
    // Node.js require is available in the enclosing scope of the CJS wrapper.
    try {
        const r = eval('require');
        if (typeof r === 'function') return r;
    } catch {
        // eval may be blocked by CSP, fall through
    }

    // Strategy 2: direct require reference — available when the module is
    // loaded via Node.js's native CJS loader (not bundled).
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const r = require;
        if (typeof r === 'function') return r;
    } catch {
        // not available in strict ESM contexts
    }

    // Strategy 3: window.require — Electron renderer with contextIsolation disabled
    // may expose require on the window object via preload.
    try {
        const r = (typeof window !== 'undefined' && (window as any).require);
        if (typeof r === 'function') return r;
    } catch {
        // fall through
    }

    return null;
}

/**
 * Resolve the absolute path to the paddleocr-js package directory using
 * Node.js module resolution relative to the current module's location.
 */
function resolvePaddleOcrAbsolutePath(): string | null {
    try {
        const pathMod = getNodeRequire()?.('path');
        const fsMod = getNodeRequire()?.('fs');
        if (!pathMod || !fsMod) return null;

        // Try resolution from various likely directories
        const candidates = [
            // Bundled alongside the plugin's index.js (via viteStaticCopy)
            pathMod.join(__dirname, 'node_modules', 'paddleocr-js'),
            // Parent node_modules (if plugin is nested)
            pathMod.join(__dirname, '..', 'node_modules', 'paddleocr-js'),
        ];
        for (const candidate of candidates) {
            try {
                const pkgPath = pathMod.join(candidate, 'package.json');
                if (fsMod.existsSync(pkgPath)) {
                    return candidate;
                }
            } catch {
                // continue searching
            }
        }
    } catch {
        // path/fs not available
    }
    return null;
}

/**
 * Resolve the absolute path to the bundled PaddleOCR model directory.
 * Models are bundled at dist/models/paddleocr/ via viteStaticCopy.
 * Returns null if path/fs modules are unavailable (e.g. browser context without node).
 */
function resolveModelPath(): string | null {
    try {
        const pathMod = getNodeRequire()?.('path');
        if (!pathMod) return null;
        // __dirname points to the plugin's dist/ directory at runtime
        return pathMod.join(__dirname, 'models', 'paddleocr');
    } catch {
        return null;
    }
}

async function loadPaddleOcr(): Promise<any> {
    if (paddleOcrInstance) return paddleOcrInstance;

    const nodeRequire = getNodeRequire();
    const debug = typeof console !== 'undefined' && console.debug;

    try {
        let mod: any;

        if (nodeRequire) {
            // Preferred path: use Node.js require with bare specifier.
            // Module resolution finds node_modules/paddleocr-js relative to this file.
            mod = nodeRequire('paddleocr-js');
        } else {
            // Fallback: resolve absolute path and require that.
            const absPath = resolvePaddleOcrAbsolutePath();
            if (!absPath) {
                throw new Error(
                    'paddleocr-js not found via module resolution or absolute path. ' +
                    'Ensure paddleocr-js is deployed to plugin node_modules/.'
                );
            }
            // eval('require') may fail but the direct require in the catch scope works
            // if we got here via Strategy 2 or 3 failing, try one more time with the
            // resolved path using the CJS require if available.
            const r = eval('require');
            if (typeof r !== 'function') {
                throw new Error('Cannot access Node.js require in this context');
            }
            mod = r(absPath);
        }

        const PaddleOCR = mod.PaddleOCR || mod.default;
        if (typeof PaddleOCR !== 'function') {
            throw new Error(
                `PaddleOCR class not found in module exports. ` +
                `Available exports: ${Object.keys(mod).join(', ')}`
            );
        }

        // Resolve absolute path to bundled model directory
        const modelPath = resolveModelPath();

        // Use TensorFlow.js backend by default (expected model format: model.json + .bin).
        // Set useTensorflow=false / useONNX=true if bundling ONNX (.onnx) models instead.
        paddleOcrInstance = new PaddleOCR({
            language: 'ch',
            useWasm: true,
            useTensorflow: true,
            useONNX: false,
            // Pass absolute modelPath so paddleocr-js finds models regardless of CWD.
            // The modelPath is set here and overrides the default "./models" or "/models".
            // Expected subdirectory structure under modelPath:
            //   text/det_db/model.json            — text detection (DB)
            //   text/rec_crnn/ch/model.json       — text recognition (CRNN, Chinese)
            //   layout/model.json                 — layout analysis
            //   table/structure/model.json         — table structure
            //   table/cell/model.json              — table cell detection
            //   formula/latex/model.json           — formula recognition
            //   barcode/detect.json                — barcode detection
            ...(modelPath ? { modelPath } : {}),
        });
        await paddleOcrInstance.init();
        return paddleOcrInstance;
    } catch (e: any) {
        // Log the detailed error for debugging (visible in Electron devtools)
        if (debug) {
            debug('[all-in-one] PaddleOCR load failed:', {
                message: e?.message || e,
                hasRequire: !!getNodeRequire(),
                hasPaddleDir: !!resolvePaddleOcrAbsolutePath(),
                modelPath: resolveModelPath(),
                cwd: typeof process !== 'undefined' ? process.cwd?.() : 'N/A',
                __dirname: typeof __dirname !== 'undefined' ? __dirname : 'N/A',
            });
        }
        throw new Error(`PaddleOCR 加载失败（请确认已安装 paddleocr-js）: ${e?.message || e}`);
    }
}

export async function isPaddleOcrAvailable(): Promise<boolean> {
    try {
        await loadPaddleOcr();
        return true;
    } catch (e: any) {
        // Log at info level for production awareness
        if (typeof console !== 'undefined' && console.info) {
            console.info('[all-in-one] PaddleOCR unavailable:', e?.message || e);
        }
        return false;
    }
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
