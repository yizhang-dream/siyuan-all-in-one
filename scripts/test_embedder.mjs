/**
 * Embedder test — tests BuiltinEmbedder, getRagEmbedderProvider (all 4 config types),
 * setAppConfig/getAppConfig roundtrip, and resetEmbeddingProvider.
 *
 * Usage: node scripts/test_embedder.mjs
 *
 * Pattern: write entry file → esbuild bundle → import & run → cleanup.
 * @xenova/transformers is mocked so tests run offline with no model download.
 */

import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_embedder_test');
const mockFile = path.join(tempDir, '_xenova_mock.mjs');
const entryFile = path.join(tempDir, '_test_entry.mjs');
const outfile = path.join(tempDir, '_test_bundle.mjs');

// ── Clean & prepare temp directory ──────────────────────────────
await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

// Write a mock for @xenova/transformers so BuiltinEmbedder.init works offline
await writeFile(mockFile, `
// Mock @xenova/transformers for offline testing
const mockPipelineFn = async (text, options) => ({
  data: new Float32Array(384).fill(0.1),
});

export async function pipeline(task, model, options) {
  return mockPipelineFn;
}

export default { pipeline };
`, 'utf8');

// ── Write entry file with all test cases ────────────────────────
await writeFile(entryFile, `
import assert from 'node:assert/strict';

// ── Imports ─────────────────────────────────────────────────────
import { setAppConfig, getAppConfig } from '../src/libs/config-helper.js';
import { getRagEmbedderProvider, resetEmbeddingProvider } from '../src/libs/rag/embedder.js';
import { BuiltinEmbedder } from '../src/libs/rag/embedder-builtin.js';

// ── Helpers ─────────────────────────────────────────────────────
function makeConfig(overrides = {}) {
  return {
    providers: [],
    flashcardProviderId: '',
    flashcardModel: '',
    mindmapProviderId: '',
    mindmapModel: '',
    cardsPerDay: 20,
    scheduler: 'sm2',
    defaultDeck: 'default',
    agents: [],
    ragEmbeddingProvider: 'builtin',
    ragEmbeddingConfig: { endpoint: '', apiKey: '', model: '' },
    ...overrides,
  };
}

let passed = 0;
let failed = 0;
function ok(condition, label) {
  if (condition) {
    console.log('  ✓', label);
    passed++;
  } else {
    console.log('  ✗', label);
    failed++;
  }
}

// ── Test 1: setAppConfig / getAppConfig roundtrip ───────────────
console.log('\\n1. setAppConfig / getAppConfig roundtrip');
{
  const cfg = makeConfig({
    ragEmbeddingProvider: 'ollama',
    ragEmbeddingConfig: { endpoint: 'http://test:11434', apiKey: 'k1', model: 'm1' },
  });
  setAppConfig(cfg);
  const got = getAppConfig();
  ok(got.ragEmbeddingProvider === 'ollama', 'provider is ollama');
  ok(got.ragEmbeddingConfig.endpoint === 'http://test:11434', 'endpoint matches');
  ok(got.ragEmbeddingConfig.apiKey === 'k1', 'apiKey matches');
  ok(got.ragEmbeddingConfig.model === 'm1', 'model matches');
}

// ── Test 2: getRagEmbedderProvider with builtin config ──────────
console.log('\\n2. getRagEmbedderProvider(builtin)');
{
  resetEmbeddingProvider();
  setAppConfig(makeConfig({ ragEmbeddingProvider: 'builtin' }));
  const provider = await getRagEmbedderProvider();
  ok(provider !== null && provider !== undefined, 'provider exists');
  ok(provider.constructor.name === 'BuiltinEmbedder', 'correct class BuiltinEmbedder');
  ok(provider.getModelName() === 'Xenova/all-MiniLM-L6-v2', 'default model name');
  ok(provider.getDimension() === 384, 'dimension is 384');
  ok(typeof provider.embed === 'function', 'embed is a function');
  ok(typeof provider.isReady === 'function', 'isReady is a function');
  ok(typeof provider.initialize === 'function', 'initialize is a function');
}

// ── Test 3: getRagEmbedderProvider with ollama config ───────────
console.log('\\n3. getRagEmbedderProvider(ollama)');
{
  resetEmbeddingProvider();
  setAppConfig(makeConfig({
    ragEmbeddingProvider: 'ollama',
    ragEmbeddingConfig: { endpoint: 'http://localhost:11434', apiKey: '', model: 'all-minilm' },
  }));
  const provider = await getRagEmbedderProvider();
  ok(provider !== null, 'provider exists');
  ok(provider.constructor.name === 'OllamaEmbedder', 'correct class OllamaEmbedder');
  ok(provider.getModelName() === 'all-minilm', 'model name from config');
  ok(provider.getDimension() === 384, 'default dimension 384');
  ok(typeof provider.getEndpoint === 'function', 'getEndpoint is a function');
}

// ── Test 4: getRagEmbedderProvider with openai config ───────────
console.log('\\n4. getRagEmbedderProvider(openai)');
{
  resetEmbeddingProvider();
  setAppConfig(makeConfig({
    ragEmbeddingProvider: 'openai',
    ragEmbeddingConfig: { endpoint: 'https://api.openai.com', apiKey: 'sk-test', model: 'text-embedding-3-small' },
  }));
  const provider = await getRagEmbedderProvider();
  ok(provider !== null, 'provider exists');
  ok(provider.constructor.name === 'OpenAIEmbedder', 'correct class OpenAIEmbedder');
  ok(provider.getModelName() === 'text-embedding-3-small', 'model name from config');
  ok(provider.getDimension() === 384, 'default dimension 384');
}

// ── Test 5: getRagEmbedderProvider with custom config ───────────
console.log('\\n5. getRagEmbedderProvider(custom)');
{
  resetEmbeddingProvider();
  setAppConfig(makeConfig({
    ragEmbeddingProvider: 'custom',
    ragEmbeddingConfig: { endpoint: 'http://localhost:8080', apiKey: '', model: 'custom-model' },
  }));
  const provider = await getRagEmbedderProvider();
  ok(provider !== null, 'provider exists');
  ok(provider.constructor.name === 'CustomEmbedder', 'correct class CustomEmbedder');
  ok(provider.getModelName() === 'custom-model', 'model name from config');
  ok(provider.getDimension() === 384, 'default dimension 384');
}

// ── Test 6: resetEmbeddingProvider creates new instance ─────────
console.log('\\n6. resetEmbeddingProvider creates new instance');
{
  resetEmbeddingProvider();
  setAppConfig(makeConfig({ ragEmbeddingProvider: 'builtin' }));
  const p1 = await getRagEmbedderProvider();
  const p2 = await getRagEmbedderProvider();
  ok(p1 === p2, 'same instance returned without reset');

  resetEmbeddingProvider();
  setAppConfig(makeConfig({ ragEmbeddingProvider: 'builtin' }));
  const p3 = await getRagEmbedderProvider();
  ok(p3 !== null && p3 !== undefined, 'new instance after reset exists');
  ok(p1 !== p3, 'new instance differs from previous');
}

// ── Test 7: BuiltinEmbedder basic instantiation ─────────────────
console.log('\\n7. BuiltinEmbedder basic instantiation');
{
  const embedder = new BuiltinEmbedder();
  ok(embedder !== null, 'can instantiate');
  ok(embedder.getModelName() === 'Xenova/all-MiniLM-L6-v2', 'default model name');
  ok(embedder.getDimension() === 384, 'dimension is 384');
  ok(embedder.isReady() === false, 'not ready before init');
  ok(embedder.getError() === '', 'no error before init');
  ok(typeof embedder.embed === 'function', 'embed method exists');
  ok(typeof embedder.initialize === 'function', 'initialize method exists');
}

// ── Summary ─────────────────────────────────────────────────────
console.log('');
console.log(\`Results: \${passed} passed, \${failed} failed\`);
if (failed > 0) process.exit(1);
`, 'utf8');

// ── Bundle with esbuild (mock @xenova/transformers) ─────────────
await esbuild.build({
  entryPoints: [entryFile],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  external: ['siyuan'],
  logLevel: 'silent',
  plugins: [{
    name: 'mock-xenova',
    setup(build) {
      build.onResolve({ filter: /^@xenova\/transformers$/ }, () => ({
        path: mockFile,
      }));
    },
  }],
});

// ── Run tests ───────────────────────────────────────────────────
try {
  await import(pathToFileURL(outfile).href);
  console.log('\\n✅ test_embedder: ALL TESTS PASSED');
} catch (e) {
  console.error('\\n❌ test_embedder: FATAL ERROR —', e.message);
  process.exit(1);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
