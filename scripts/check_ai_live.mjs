import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { readArg, resolvePluginDataDir } from './siyuan_paths.mjs';

const root = process.cwd();
const dataDir = resolvePluginDataDir();
const query = readArg('--query') || process.env.OPENNOTEBOOK_TEST_QUERY || 'impulse momentum';
const targetCards = Number(readArg('--cards') || process.env.AI_LIVE_TARGET_CARDS || 1);
const tempDir = path.join(root, '_temp_ai_live_check');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanConfig } from '../src/libs/config';
import { resolveLLMConfig } from '../src/libs/llm';
import { fetchOpenNotebookPipelineSources, runPromptPipeline } from '../src/libs/ai';

const dataDir = ${JSON.stringify(dataDir)};
const query = ${JSON.stringify(query)};
const targetCards = ${JSON.stringify(targetCards)};

function readJson(key: string) {
  const filePath = path.join(dataDir, key);
  if (!existsSync(filePath)) return undefined;
  const text = readFileSync(filePath, 'utf8').trim();
  return text ? JSON.parse(text) : undefined;
}

const config = cleanConfig(readJson('config') || {});
const provider = config.providers.find((item) => item.id === config.flashcardProviderId);
assert.ok(provider, 'configured flashcard provider was not found');
assert.ok(config.flashcardModel || provider.models?.[0], 'flashcard model is not configured');
assert.ok(provider.apiKey || provider.baseUrl.includes('localhost') || provider.baseUrl.includes('127.0.0.1'), 'flashcard provider has no API key');

const llmConfig = resolveLLMConfig(config, config.flashcardProviderId, config.flashcardModel || provider.models?.[0] || '');
llmConfig.timeout = 90_000;
llmConfig.maxTokens = 2500;
llmConfig.temperature = 0.1;

const sources = await fetchOpenNotebookPipelineSources({
  endpoint: config.notebookEndpoint,
  query,
  limit: 3,
  maxCharsPerSource: 1400,
});

assert.ok(sources.length > 0, 'OpenNotebook produced no pipeline sources');

const result = await runPromptPipeline(sources, {
  llmConfig,
  targetCardCount: Math.max(1, targetCards),
  temperature: 0.1,
  language: 'zh-CN',
});

assert.ok(result.concepts.length > 0, 'live AI pipeline produced no concept candidates');
assert.ok(result.cards.length > 0, 'live AI pipeline produced no card candidates');
assert.ok(result.concepts.every((concept) => concept.sourceRefs.length > 0), 'all concepts must keep sourceRefs');
assert.ok(result.cards.every((card) => card.sourceRefs.length > 0), 'all cards must keep sourceRefs');

console.log(JSON.stringify({
  query,
  provider: {
    id: provider.id,
    baseUrl: provider.baseUrl.replace(/api[_-]?key=[^&]+/ig, 'api_key=***'),
    model: llmConfig.model,
    apiKeySet: Boolean(provider.apiKey),
  },
  sources: sources.length,
  concepts: result.concepts.length,
  relations: result.relations.length,
  cards: result.cards.length,
  uncertain: result.uncertain.length,
  warnings: result.warnings,
  sampleConcept: result.concepts[0] ? {
    title: result.concepts[0].title,
    confidence: result.concepts[0].confidence,
    refs: result.concepts[0].sourceRefs.length,
  } : null,
  sampleCard: result.cards[0] ? {
    cardType: result.cards[0].cardType,
    front: result.cards[0].front.slice(0, 120),
    confidence: result.cards[0].confidence,
    refs: result.cards[0].sourceRefs.length,
  } : null,
}, null, 2));
`, 'utf8');

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  external: ['siyuan'],
  logLevel: 'silent',
});

try {
  assert.equal(existsSync(dataDir), true, `plugin data directory does not exist: ${dataDir}`);
  const before = snapshotDataFiles(dataDir);
  await import(pathToFileURL(outfile).href);
  assert.deepEqual(snapshotDataFiles(dataDir), before, 'check:ai-live must not modify real plugin data files');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function snapshotDataFiles(dir) {
  return Object.fromEntries(
    ['cards', 'config', 'concepts', 'relations', 'mindmaps'].map((name) => {
      const filePath = path.join(dir, name);
      if (!existsSync(filePath)) return [name, { exists: false }];
      const stat = statSync(filePath);
      return [name, {
        exists: true,
        size: stat.size,
        sha256: createHash('sha256').update(readFileSync(filePath)).digest('hex'),
      }];
    })
  );
}
