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
import { buildExportPayload, cardsToAnkiTSV, cardsToCSV, cardsToMarkdown, exportPayloadToSiyuanMarkdown, mindmapsToMarkdown } from '../src/libs/exporters';

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
    scheduler: 'fsrs',
    fsrs: { stability: 2.4, difficulty: 5.1, state: 'review', scheduledDays: 3, elapsedDays: 1, learningSteps: 0, lastReview: 1, lastRating: 3 },
    sourceRefs: [{ type: 'siyuan', blockId: '20260620120000-abcdefg', quote: 'Impulse theorem' }],
  },
];

const csv = cardsToCSV(cards);
assert.match(csv, /^id,deck,question,answer,.*scheduler,fsrs,/m);
assert.match(csv, /"Physics, Mechanics"/);
assert.match(csv, /"What is ""impulse""\\?"/);
assert.match(csv, /"Impulse equals force over time\\.\\nIt changes momentum\\."/);
assert.match(csv, /fsrs/);
assert.match(csv, /""stability"":2.4/);

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
  linkedCardIds: ['card-2'],
  source: 'concepts',
  deck: 'Physics, Mechanics',
  created: 1,
  modified: 2,
}]);
assert.match(mindmapMarkdown, /# Mechanics Map/);
assert.match(mindmapMarkdown, /<!-- id=map-1 source=concepts deck=Physics, Mechanics -->/);
assert.match(mindmapMarkdown, /Momentum #card-1/);
const mindmapMetaMatch = mindmapMarkdown.match(/<!-- siyuan-all-in-one-mindmap=(.+?) -->/);
assert.ok(mindmapMetaMatch, 'mindmap export should include recoverable plugin metadata');
const mindmapMeta = JSON.parse(mindmapMetaMatch[1]);
assert.equal(mindmapMeta.id, 'map-1');
assert.equal(mindmapMeta.deck, 'Physics, Mechanics');
assert.equal(mindmapMeta.cardIds[0], 'card-1');
assert.equal(mindmapMeta.linkedCardIds[0], 'card-2');
assert.equal(mindmapMeta.created, 1);
assert.equal(mindmapMeta.modified, 2);

const cardsJson = buildExportPayload('cards-json', { cards });
assert.equal(JSON.parse(cardsJson.content).cards[0].sourceRefs[0].blockId, '20260620120000-abcdefg');

const fence = String.fromCharCode(96).repeat(3);
const siyuanJsonMarkdown = exportPayloadToSiyuanMarkdown('backup.json', '{"ok":true}\\n');
assert.equal(siyuanJsonMarkdown, ['# backup.json', '', fence + 'json', '{"ok":true}', fence, ''].join('\\n'));
const siyuanCsvMarkdown = exportPayloadToSiyuanMarkdown('cards.csv', 'a,b\\n1,2\\n');
assert.ok(siyuanCsvMarkdown.startsWith(['# cards.csv', '', fence + 'csv', ''].join('\\n')));
assert.equal(exportPayloadToSiyuanMarkdown('cards.md', '# Already Markdown\\n'), '# Already Markdown\\n');

console.log(JSON.stringify({
  csv: true,
  ankiTsv: true,
  markdown: true,
  conceptGraphJson: true,
  mindmapMarkdown: true,
  siyuanMarkdownWrapper: true,
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
