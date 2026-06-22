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
            // transformers.js uses onnxruntime-node by default; alias to web variant
            // so Vite can bundle it for the Electron renderer.
            "onnxruntime-node": "onnxruntime-web",
        },
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
            external: ["siyuan", "process"],
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
