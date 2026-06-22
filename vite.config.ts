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
        alias: { "@": resolve(__dirname, "src") }
    },
    plugins: [
        svelte(),
        viteStaticCopy({
            targets: [
                { src: "./README*.md", dest: "./" },
                { src: "./plugin.json", dest: "./" },
                { src: "./icon.png", dest: "./" },
                { src: "./public/i18n/*.json", dest: "./i18n/" }
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
            external: ["siyuan", "process", "@huggingface/transformers", "@xenova/transformers"],
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
