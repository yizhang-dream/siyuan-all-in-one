import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_exporter_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { buildExportPayload, cardsToAnkiTSV, cardsToCSV, cardsToMarkdown, mindmapsToMarkdown } from '../src/libs/exporters';

const cards: any[] = [
  {
    id: 'card-1',
    question: 'What is "impulse"?',
    answer: 'Impulse equals force over time.\\nIt changes momentum.',
    hint: 'J = Δp',
    deck: 'Physics, Mechanics',
    tags: ['physics', 'momentum'],
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
    sourceRefs: [{ type: 'siyuan', blockId: '20260620120000-abcdefg', quote: 'Impulse theorem' }],
  },
];

const csv = cardsToCSV(cards);
assert.match(csv, /^id,deck,question,answer/m);
assert.match(csv, /"Physics, Mechanics"/);
assert.match(csv, /"What is ""impulse""\\?"/);
assert.match(csv, /"Impulse equals force over time\\.\\nIt changes momentum\\."/);

const tsv = cardsToAnkiTSV(cards);
assert.equal(tsv.split('\\t').length, 5);
assert.match(tsv, /Impulse equals force over time\\.<br>It changes momentum\\./);
assert.doesNotMatch(tsv, /\\t\\t\\t\\t\\t/);

const markdown = cardsToMarkdown(cards);
assert.match(markdown, /# SiYuan All-in-One Cards/);
assert.match(markdown, /## Physics, Mechanics/);
assert.match(markdown, /### 1\\. What is "impulse"\\?/);
assert.match(markdown, /concept=concept-1/);

const graphPayload = buildExportPayload('concepts-json', {
  cards,
  concepts: [{
    id: 'concept-1',
    title: 'Impulse',
    summary: 'Force over time',
    parentIds: [],
    childIds: [],
    relatedIds: [],
    cardIds: ['card-1'],
    sourceRefs: [],
    tags: [],
    created: 1,
    modified: 2,
  }],
  relations: [{
    id: 'rel-1',
    fromId: 'concept-1',
    toId: 'concept-2',
    type: 'related',
    sourceRefs: [],
  }],
});
assert.match(graphPayload.filename, /^siyuan-all-in-one-concepts-\\d{8}-\\d{6}\\.json$/);
const graph = JSON.parse(graphPayload.content);
assert.equal(graph.type, 'concept-graph');
assert.equal(graph.concepts[0].cardIds[0], 'card-1');
assert.equal(graph.relations[0].type, 'related');

const mindmapMarkdown = mindmapsToMarkdown([{
  id: 'map-1',
  title: 'Mechanics Map',
  markdown: '- Mechanics\\n  - Momentum #card-1',
  cardIds: ['card-1'],
  source: 'concepts',
  created: 1,
  modified: 2,
}]);
assert.match(mindmapMarkdown, /# Mechanics Map/);
assert.match(mindmapMarkdown, /<!-- id=map-1 source=concepts deck= -->/);
assert.match(mindmapMarkdown, /Momentum #card-1/);

const cardsJson = buildExportPayload('cards-json', { cards });
assert.equal(JSON.parse(cardsJson.content).cards[0].sourceRefs[0].blockId, '20260620120000-abcdefg');

console.log(JSON.stringify({
  csv: true,
  ankiTsv: true,
  markdown: true,
  conceptGraphJson: true,
  mindmapMarkdown: true,
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
