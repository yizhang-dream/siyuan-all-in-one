import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_mindmap_cards_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import {
  buildMindmapToCardsPrompt,
  extractMindmapTopics,
  normalizeMindmapCardDrafts,
} from '../src/libs/mindmap-cards';
import { MindmapStore } from '../src/libs/mindmap-store';

const markdown = [
  '- Mechanics',
  '  - Momentum #c11111111',
  '    - Impulse theorem',
  '  - Energy',
  '    - Work-energy theorem #c22222222',
  '',
  '<!-- metadata should disappear -->',
].join('\\n');

const topics = extractMindmapTopics(markdown);
assert.equal(topics.length, 4);
assert.deepEqual(topics[0].path, ['Mechanics', 'Momentum']);
assert.equal(topics[0].title, 'Momentum');
assert.equal(topics[1].title, 'Impulse theorem');
assert.ok(topics.every((topic) => !topic.title.includes('#c')));

const prompt = buildMindmapToCardsPrompt(topics, 4);
assert.match(prompt, /目标卡片数：4/);
assert.match(prompt, /Return|输出格式|JSON/i);
assert.match(prompt, /Impulse theorem/);

const drafts = normalizeMindmapCardDrafts({
  cards: [
    {
      front: 'What does impulse change?',
      back: 'Impulse changes momentum.',
      hint: 'J = Δp',
      topicTitle: 'Impulse theorem',
      confidence: 0.9,
    },
    {
      question: 'What does impulse change?',
      answer: 'Duplicate should be removed.',
      topicTitle: 'Impulse theorem',
    },
    {
      question: 'Incomplete card',
      answer: '',
    },
  ],
}.cards, topics);
assert.equal(drafts.length, 1);
assert.equal(drafts[0].topicTitle, 'Impulse theorem');
assert.deepEqual(drafts[0].topicPath, ['Mechanics', 'Momentum', 'Impulse theorem']);
assert.equal(drafts[0].confidence, 0.9);

const writes: Record<string, any> = {};
const plugin = {
  async loadData(name: string) {
    return writes[name] || [];
  },
  async saveData(name: string, value: any) {
    writes[name] = JSON.parse(JSON.stringify(value));
  },
};
const store = new MindmapStore(plugin);
await store.load();
await store.upsert({
  id: 'map-1',
  title: 'Map',
  markdown,
  cardIds: ['old-card'],
  linkedCardIds: ['generated-1'],
  source: 'manual',
  created: 1,
  modified: 1,
});
await store.upsert({
  id: 'map-1',
  title: 'Map',
  markdown,
  cardIds: ['old-card', 'generated-2'],
  linkedCardIds: ['generated-2'],
  source: 'manual',
  created: 1,
  modified: 2,
});
const saved = store.getById('map-1')!;
assert.deepEqual(saved.linkedCardIds?.sort(), ['generated-1', 'generated-2']);
assert.deepEqual(writes.mindmaps[0].linkedCardIds.sort(), ['generated-1', 'generated-2']);

console.log(JSON.stringify({
  topics: topics.length,
  drafts: drafts.length,
  linkedCardIdsMerged: true,
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
