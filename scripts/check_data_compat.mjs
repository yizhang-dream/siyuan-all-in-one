import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { resolvePluginDataDir } from './siyuan_paths.mjs';

const root = process.cwd();
const dataDir = resolvePluginDataDir();
const tempDir = path.join(root, '_temp_data_compat_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CardStore } from '../src/libs/store';
import { ConceptStore } from '../src/libs/store/concept-store';
import { MindmapStore } from '../src/libs/mindmap-store';
import { cleanConfig } from '../src/libs/config';

const dataDir = ${JSON.stringify(dataDir)};
const requiredCardFields = [
  'id',
  'question',
  'answer',
  'hint',
  'deck',
  'tags',
  'cardType',
  'sourceRefs',
  'due',
  'interval',
  'ease',
  'reps',
  'lapses',
  'status',
  'created',
  'modified',
];

class ReadOnlyPlugin {
  reads = new Set<string>();
  writes = new Set<string>();

  async loadData(key: string) {
    this.reads.add(key);
    const filePath = path.join(dataDir, key);
    if (!existsSync(filePath)) return undefined;
    const text = readFileSync(filePath, 'utf8').trim();
    if (!text) return undefined;
    return JSON.parse(text);
  }

  async saveData(key: string, _value: unknown) {
    this.writes.add(key);
    throw new Error('check:data is read-only; attempted saveData(' + key + ')');
  }
}

function loadRawJson(key: string) {
  const filePath = path.join(dataDir, key);
  if (!existsSync(filePath)) return { exists: false, value: undefined };
  const text = readFileSync(filePath, 'utf8').trim();
  if (!text) return { exists: true, empty: true, value: undefined };
  return { exists: true, empty: false, value: JSON.parse(text) };
}

function countDuplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates.size;
}

function summarizeDecks(cards: Array<{ deck: string }>) {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.deck, (counts.get(card.deck) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));
}

function summarizeStatuses(cards: Array<{ status: string }>) {
  const counts = new Map<string, number>();
  for (const card of cards) counts.set(card.status, (counts.get(card.status) || 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function sampleInvalidCards(cards: any[]) {
  const invalid: Array<{ index: number; id: string; missing: string[] }> = [];
  cards.forEach((card, index) => {
    const missing = requiredCardFields.filter((field) => !(field in card));
    if (missing.length > 0) invalid.push({ index, id: String(card?.id || ''), missing });
  });
  return invalid.slice(0, 10);
}

assert.equal(existsSync(dataDir), true, 'SiYuan plugin data directory does not exist: ' + dataDir);

const rawCards = loadRawJson('cards');
const rawConfig = loadRawJson('config');
const rawMindmaps = loadRawJson('mindmaps');
const rawConcepts = loadRawJson('concepts');
const rawRelations = loadRawJson('relations');

assert.ok(!rawCards.exists || Array.isArray(rawCards.value), 'cards must be a JSON array when present');
assert.ok(!rawMindmaps.exists || Array.isArray(rawMindmaps.value), 'mindmaps must be a JSON array when present');
assert.ok(!rawConcepts.exists || Array.isArray(rawConcepts.value), 'concepts must be a JSON array when present');
assert.ok(!rawRelations.exists || Array.isArray(rawRelations.value), 'relations must be a JSON array when present');
assert.ok(!rawConfig.exists || typeof rawConfig.value === 'object', 'config must be a JSON object when present');

const plugin = new ReadOnlyPlugin();
const cardStore = new CardStore(plugin);
const conceptStore = new ConceptStore(plugin);
const mindmapStore = new MindmapStore(plugin);

await cardStore.load();
await conceptStore.load();
await mindmapStore.load();

const cards = cardStore.getAll();
const concepts = conceptStore.getAll();
const relations = conceptStore.getRelations();
const mindmaps = mindmapStore.getAll();
const config = cleanConfig(rawConfig.value || {});

const invalidCards = sampleInvalidCards(cards);
assert.deepEqual(invalidCards, [], 'cleaned cards are missing required fields: ' + JSON.stringify(invalidCards));
assert.equal(cards.every((card) => Array.isArray(card.tags)), true, 'all cleaned cards must have tags array');
assert.equal(cards.every((card) => Array.isArray(card.sourceRefs)), true, 'all cleaned cards must have sourceRefs array');
assert.equal(cards.every((card) => typeof card.id === 'string' && card.id.length > 0), true, 'all cleaned cards must have non-empty id');
assert.equal(cards.every((card) => typeof card.question === 'string'), true, 'all cleaned cards must have string question');
assert.equal(cards.every((card) => typeof card.answer === 'string'), true, 'all cleaned cards must have string answer');

const providerIds = new Set(config.providers.map((provider) => provider.id));
const configWarnings: string[] = [];
if (!providerIds.has(config.flashcardProviderId)) {
  configWarnings.push('flashcardProviderId does not match any provider');
}
if (!providerIds.has(config.mindmapProviderId)) {
  configWarnings.push('mindmapProviderId does not match any provider');
}
if (!Number.isFinite(Number(config.cardsPerDay))) {
  configWarnings.push('cardsPerDay is not numeric');
}
if (!String(config.notebookEndpoint || '').trim()) {
  configWarnings.push('notebookEndpoint is empty');
}

assert.ok(Array.isArray(config.providers) && config.providers.length > 0, 'cleaned config must have providers');
assert.ok(Number.isFinite(Number(config.cardsPerDay)), 'cleaned config cardsPerDay must be numeric');
assert.ok(String(config.notebookEndpoint || '').trim(), 'cleaned config must have notebookEndpoint');

const duplicateCardIds = countDuplicates(cards.map((card) => card.id));
const conceptIds = new Set(concepts.map((concept) => concept.id));
const relationDanglingCount = relations.filter(
  (relation) => !conceptIds.has(relation.fromId) || !conceptIds.has(relation.toId)
).length;
const conceptCardLinks = concepts.reduce((count, concept) => count + (concept.cardIds?.length || 0), 0);
const cardConceptLinks = cards.filter((card) => card.conceptId).length;

assert.equal(plugin.writes.size, 0, 'data compatibility check must not write plugin data');

console.log(JSON.stringify({
  dataDir,
  files: {
    cards: { exists: rawCards.exists, count: Array.isArray(rawCards.value) ? rawCards.value.length : 0 },
    config: { exists: rawConfig.exists },
    mindmaps: { exists: rawMindmaps.exists, count: Array.isArray(rawMindmaps.value) ? rawMindmaps.value.length : 0 },
    concepts: { exists: rawConcepts.exists, count: Array.isArray(rawConcepts.value) ? rawConcepts.value.length : 0 },
    relations: { exists: rawRelations.exists, count: Array.isArray(rawRelations.value) ? rawRelations.value.length : 0 },
  },
  loaded: {
    cards: cards.length,
    concepts: concepts.length,
    relations: relations.length,
    mindmaps: mindmaps.length,
  },
  cards: {
    duplicateIds: duplicateCardIds,
    statuses: summarizeStatuses(cards),
    topDecks: summarizeDecks(cards),
    withConceptId: cardConceptLinks,
    withSourceRefs: cards.filter((card) => card.sourceRefs.length > 0).length,
  },
  graph: {
    conceptCardLinks,
    relationDanglingCount,
  },
  config: {
    providers: config.providers.length,
    flashcardProviderId: config.flashcardProviderId,
    flashcardModelSet: Boolean(config.flashcardModel),
    mindmapProviderId: config.mindmapProviderId,
    mindmapModelSet: Boolean(config.mindmapModel),
    notebookEndpoint: config.notebookEndpoint,
    cardsPerDay: config.cardsPerDay,
    agents: config.agents.length,
    warnings: configWarnings,
  },
  reads: [...plugin.reads].sort(),
  readOnly: plugin.writes.size === 0,
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
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
