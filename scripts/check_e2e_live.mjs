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
const targetCards = Number(readArg('--cards') || process.env.E2E_LIVE_TARGET_CARDS || 1);
const tempDir = path.join(root, '_temp_e2e_live_check');
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
import { confirmPipelineResult, fetchOpenNotebookPipelineSources, runPromptPipeline } from '../src/libs/ai';
import { syncConceptMindmap } from '../src/libs/concept-mindmap-sync';
import { CardStore } from '../src/libs/store';
import { ConceptStore } from '../src/libs/store/concept-store';
import { MindmapStore } from '../src/libs/mindmap-store';

const dataDir = ${JSON.stringify(dataDir)};
const query = ${JSON.stringify(query)};
const targetCards = ${JSON.stringify(targetCards)};

class MemoryPlugin {
  data = new Map<string, any>();
  writes: string[] = [];
  async loadData(key: string) {
    return this.data.get(key);
  }
  async saveData(key: string, value: any) {
    this.writes.push(key);
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

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
assert.ok(result.concepts.length > 0, 'live AI pipeline produced no concepts');
assert.ok(result.cards.length > 0, 'live AI pipeline produced no cards');

const plugin = new MemoryPlugin();
const conceptStore = new ConceptStore(plugin);
const cardStore = new CardStore(plugin);
const mindmapStore = new MindmapStore(plugin);
await conceptStore.load();
await cardStore.load();
await mindmapStore.load();

const selectedConceptIds = result.concepts
  .filter((concept) => concept.confidence >= 0.65)
  .map((concept) => concept.tempId);
const selectedCardIndexes = result.cards
  .map((card, index) => ({ card, index }))
  .filter(({ card }) => card.confidence >= 0.6)
  .slice(0, Math.max(1, targetCards))
  .map(({ index }) => index);
const selectedRelationIndexes = result.relations
  .map((relation, index) => ({ relation, index }))
  .filter(({ relation }) => relation.confidence >= 0.6)
  .map(({ index }) => index);

assert.ok(selectedConceptIds.length > 0, 'no concept candidates met confirmation threshold');
assert.ok(selectedCardIndexes.length > 0, 'no card candidates met confirmation threshold');

const summary = await confirmPipelineResult(result, conceptStore, cardStore, {
  acceptedConceptTempIds: selectedConceptIds,
  acceptedCardIndexes: selectedCardIndexes,
  acceptedRelationIndexes: selectedRelationIndexes,
  deck: 'Live E2E Dry Run',
  tags: ['live-e2e'],
});

assert.ok(summary.createdConcepts.length > 0, 'confirmation created no concepts');
assert.ok(summary.createdCards.length > 0, 'confirmation created no cards');
assert.equal(cardStore.getAll().every((card) => card.conceptId), true, 'confirmed cards must be attached to concepts');
assert.equal(cardStore.getAll().every((card) => card.sourceRefs.length > 0), true, 'confirmed cards must keep sourceRefs');

const synced = await syncConceptMindmap(conceptStore, cardStore, mindmapStore, { title: 'Live E2E Concept Map' });
const savedMindmaps = mindmapStore.getAll();

assert.equal(savedMindmaps.length, 1, 'concept mindmap should be upserted exactly once');
assert.equal(savedMindmaps[0].source, 'concepts', 'synced mindmap must use concepts source');
assert.ok(savedMindmaps[0].cardIds.length > 0, 'synced mindmap should include card ids');
assert.ok(synced.mindmap.markdown.includes('#c'), 'mindmap markdown should include card anchors');
assert.ok(synced.mindmap.markdown.split('\\n').length > 1, 'mindmap markdown should contain concept lines');
assert.ok(
  conceptStore.getAll().some((concept) => synced.mindmap.markdown.includes(concept.title)),
  'mindmap markdown should include at least one concept title'
);
assert.ok(plugin.writes.includes('concepts'), 'concept confirmation should save concepts in memory');
assert.ok(plugin.writes.includes('cards'), 'concept confirmation should save cards in memory');
assert.ok(plugin.writes.includes('mindmaps'), 'mindmap sync should save mindmaps in memory');

console.log(JSON.stringify({
  query,
  provider: {
    id: provider.id,
    model: llmConfig.model,
    apiKeySet: Boolean(provider.apiKey),
  },
  sources: sources.length,
  candidates: {
    concepts: result.concepts.length,
    relations: result.relations.length,
    cards: result.cards.length,
    uncertain: result.uncertain.length,
    warnings: result.warnings,
  },
  confirmed: {
    concepts: summary.createdConcepts.length,
    relations: summary.createdRelations.length,
    cards: summary.createdCards.length,
    skippedCards: summary.skippedCards.length,
  },
  syncedMindmap: {
    id: synced.saved.id,
    title: synced.saved.title,
    cardIds: synced.saved.cardIds.length,
    markdownLines: synced.saved.markdown.split('\\n').length,
  },
  writes: [...new Set(plugin.writes)].sort(),
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
  assert.deepEqual(snapshotDataFiles(dataDir), before, 'check:e2e-live must not modify real plugin data files');
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
