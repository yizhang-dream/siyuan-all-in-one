import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_importer_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { buildExportPayload, mindmapsToMarkdown } from '../src/libs/exporters';
import { parsePluginImport } from '../src/libs/importers';
import { CardStore } from '../src/libs/store';
import { ConceptStore } from '../src/libs/store/concept-store';
import { MindmapStore } from '../src/libs/mindmap-store';

class MemoryPlugin {
  data = new Map<string, any>();
  async loadData(key: string) {
    return this.data.get(key);
  }
  async saveData(key: string, value: any) {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

const card = {
  id: 'card-1',
  question: 'What is impulse?',
  answer: 'Change in momentum.',
  hint: '',
  deck: 'Physics',
  tags: ['mechanics'],
  due: 0,
  interval: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  status: 'new',
  created: 1,
  modified: 2,
  conceptId: 'concept-1',
  cardType: 'qa',
  sourceRefs: [{ type: 'manual', quote: 'Impulse theorem' }],
};

const concept = {
  id: 'concept-1',
  title: 'Impulse',
  summary: 'Force over time',
  parentIds: [],
  childIds: ['concept-2'],
  relatedIds: [],
  cardIds: ['card-1'],
  sourceRefs: [],
  tags: [],
  created: 1,
  modified: 2,
};

const childConcept = {
  ...concept,
  id: 'concept-2',
  title: 'Momentum',
  childIds: [],
  parentIds: ['concept-1'],
  cardIds: [],
};

const relation = {
  id: 'rel-1',
  fromId: 'concept-1',
  toId: 'concept-2',
  type: 'parent_child',
  sourceRefs: [],
};

const graphPayload = buildExportPayload('concepts-json', {
  cards: [card as any],
  concepts: [concept as any, childConcept as any],
  relations: [relation as any],
});
const parsedGraph = parsePluginImport(graphPayload.content, graphPayload.filename);
assert.equal(parsedGraph.kind, 'concepts-json');
assert.equal(parsedGraph.cards[0].id, 'card-1');
assert.equal(parsedGraph.concepts.length, 2);
assert.equal(parsedGraph.relations[0].id, 'rel-1');

const plugin = new MemoryPlugin();
const cardStore = new CardStore(plugin);
const conceptStore = new ConceptStore(plugin);
const mindmapStore = new MindmapStore(plugin);
await cardStore.load();
await conceptStore.load();
await mindmapStore.load();

const cardResult = cardStore.importCards(parsedGraph.cards);
const conceptResult = conceptStore.importGraph(parsedGraph.concepts, parsedGraph.relations);
await cardStore.save();
await conceptStore.save();

assert.deepEqual(cardResult, { added: 1, updated: 0 });
assert.equal(conceptResult.conceptsAdded, 2);
assert.equal(conceptResult.relationsAdded, 1);
assert.equal(conceptStore.getById('concept-1')?.cardIds[0], 'card-1');
assert.equal(conceptStore.getById('concept-1')?.childIds.includes('concept-2'), true);
assert.equal(conceptStore.getById('concept-2')?.parentIds.includes('concept-1'), true);

const mindmapMarkdown = mindmapsToMarkdown([{
  id: 'map-1',
  title: 'Mechanics Map',
  markdown: '- Mechanics\\n  - Impulse #card-1',
  cardIds: ['card-1'],
  linkedCardIds: ['card-2'],
  deck: 'Physics',
  source: 'concepts',
  created: 3,
  modified: 4,
}]);
const parsedMindmaps = parsePluginImport(mindmapMarkdown, 'siyuan-all-in-one-mindmaps.md');
assert.equal(parsedMindmaps.kind, 'mindmaps-markdown');
assert.equal(parsedMindmaps.mindmaps[0].cardIds[0], 'card-1');
assert.equal(parsedMindmaps.mindmaps[0].linkedCardIds[0], 'card-2');
assert.doesNotMatch(parsedMindmaps.mindmaps[0].markdown, /siyuan-all-in-one-mindmap/);

const mindmapResult = mindmapStore.importMindmaps(parsedMindmaps.mindmaps);
await mindmapStore.save();
assert.deepEqual(mindmapResult, { added: 1, updated: 0 });
assert.equal(mindmapStore.getById('map-1')?.linkedCardIds?.[0], 'card-2');

const updateResult = mindmapStore.importMindmaps([{ id: 'map-1', title: 'Updated', markdown: '- Updated', cardIds: ['card-3'], linkedCardIds: ['card-4'] }]);
assert.deepEqual(updateResult, { added: 0, updated: 1 });
assert.deepEqual(mindmapStore.getById('map-1')?.cardIds.sort(), ['card-1', 'card-3']);
assert.deepEqual(mindmapStore.getById('map-1')?.linkedCardIds?.sort(), ['card-2', 'card-4']);

console.log(JSON.stringify({
  graphImport: true,
  mindmapMarkdownImport: true,
  mindmapLinkMerge: true,
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
