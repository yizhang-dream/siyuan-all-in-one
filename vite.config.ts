import { resolve } from "path"
import { defineConfig } from "vite"
import { viteStaticCopy } from "vite-plugin-static-copy"
import { svelte } from "@sveltejs/vite-plugin-svelte"

const env = process.env;
const isSrcmap = env.VITE_SOURCEMAP === 'inline';
const isDev = env.NODE_ENV === 'development';
const outputDir = isDev ? "dev" : "dist";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
            // ── @huggingface/transformers: force Node.js entry ──────────────────────
            // The package.json exports field has 'node' → transformers.node.cjs (CJS) /
            // transformers.node.mjs (ESM) vs 'default' → transformers.web.js.
            // Vite resolves to 'default' because it does not set the 'node' condition.
            // The web build (a) stubs onnxruntime-node as empty {} and (b) leaves the
            // onnxruntime-web/webgpu import as a raw ESM import — Vite's CJS conversion
            // of the complex ESM bundle silently drops the InferenceSession named export.
            //
            // The node build has ort.webgpu.bundle.min.mjs already inlined by esbuild
            // with explicit __export({ InferenceSession: () => qf, … }), preserving the
            // export. Using it ensures InferenceSession is available at runtime.
            // sharp — native C++ image processing addon. Stubbed because it cannot
            // load in Electron's sandboxed renderer and is never called by our plugin.
            "sharp": resolve(__dirname, "src/stubs/sharp.js"),
            // canvas — native C++ node-canvas addon. Stubbed because it cannot load
            // in Electron's sandboxed renderer. PaddleOCR depends on it but running
            // in Electron (browser context) means the native Canvas API is available.
            "canvas": resolve(__dirname, "src/stubs/canvas.js"),
            "@huggingface/transformers": resolve(__dirname, "node_modules/@huggingface/transformers/dist/transformers.node.cjs"),

            // transformers.js uses onnxruntime-node by default; alias to the
            // Node.js entry of onnxruntime-web so Vite bundles the correct runtime variant.
            // Using the bare specifier 'onnxruntime-web' resolves to the browser entry (ort.min.js)
            // via the exports field. Use an absolute path to bypass exports field restrictions
            // (the exports field doesn't expose ./dist/ort.node.min.js).
            "onnxruntime-node": resolve(__dirname, "node_modules/onnxruntime-web/dist/ort.node.min.js"),
        },
    },
    optimizeDeps: {
        exclude: [],
    },
    plugins: [
        svelte(),
        viteStaticCopy({
            targets: [
                { src: "./README*.md", dest: "./" },
                { src: "./plugin.json", dest: "./" },
                { src: "./icon.png", dest: "./" },
                { src: "./public/i18n/*.json", dest: "./i18n/" },
                // Bundle the ONNX embedding model so it works offline without downloading at runtime
                // Copy root-level model config/tokenizer files
                { src: "node_modules/@huggingface/transformers/.cache/Xenova/paraphrase-multilingual-MiniLM-L12-v2/config.json", dest: "./models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/" },
                { src: "node_modules/@huggingface/transformers/.cache/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tokenizer.json", dest: "./models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/" },
                { src: "node_modules/@huggingface/transformers/.cache/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tokenizer_config.json", dest: "./models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/" },
                // Copy the ONNX model binary (preserves onnx/ structure)
                { src: "node_modules/@huggingface/transformers/.cache/Xenova/paraphrase-multilingual-MiniLM-L12-v2/onnx/model_quantized.onnx", dest: "./models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/onnx/" },
                // pdfjs-dist runs on main thread via disableWorker: true — no worker needed
                // Bundle paddleocr-js for offline OCR at runtime (eval('require') resolves from dist/node_modules/)
                // Only copy dist/ and package.json — not the 131MB nested node_modules/ (onnxruntime-web is webpack-bundled into dist/)
                { src: "node_modules/paddleocr-js/dist/**/*", dest: "./node_modules/paddleocr-js/dist" },
                { src: "node_modules/paddleocr-js/package.json", dest: "./node_modules/paddleocr-js" },
                { src: "node_modules/paddleocr-js/LICENSE", dest: "./node_modules/paddleocr-js" },
                // canvas — stub native addon so paddleocr-js require('canvas') doesn't fail
                { src: "src/stubs/canvas-package/index.js", dest: "./node_modules/canvas" },
                { src: "src/stubs/canvas-package/package.json", dest: "./node_modules/canvas" },
                // Bundle PaddleOCR model files (~112MB) for offline OCR
                // These must be in TensorFlow.js GraphModel format (model.json + .bin weight files)
                // Download and convert using: scripts/download-paddleocr-models.ps1
                { src: "src/models/paddleocr/**/*", dest: "./models/paddleocr/" },
            ],
        }),
    ],
    define: {
        "process.env.DEV_MODE": JSON.stringify(isDev),
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV)
    },
    build: {
        outDir: outputDir,
        emptyOutDir: false,
        minify: !isDev,
        sourcemap: isSrcmap ? 'inline' : false,
        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            fileName: "index",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: [],
            external: [
                "siyuan",
                "paddleocr-js",
                "process",
                // Node.js built-in modules used by @huggingface/transformers (transformers.node.cjs)
                // and onnxruntime (ort.node.min.js). These MUST be external so Electron's renderer
                // can resolve them via require() at runtime.
                "fs",
                "path",
                "url",
                "stream",
                "stream/promises",
                "os",
                "crypto",
                "util",
                "events",
                "child_process",
                "node:fs",
                "node:fs/promises",
                "node:os",
                "node:util",
                "node:path",
                "node:stream",
                "node:events",
                "node:crypto",
                "node:child_process",
            ],
            output: {
                entryFileNames: "[name].js",
                // 禁止代码分割：所有依赖打进单个 index.js
                // SiYuan Electron 的 require 无法解析拆分的 chunk
                inlineDynamicImports: true,
                manualChunks: undefined,
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") return "index.css"
                    return assetInfo.name
                },
            },
        },
    }
})
