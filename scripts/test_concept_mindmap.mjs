import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_concept_mindmap_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { confirmPipelineResult } from '../src/libs/ai/pipeline';
import { syncConceptMindmap } from '../src/libs/concept-mindmap-sync';
import { conceptsToMindmap } from '../src/libs/render/concept-mindmap';
import { ConceptStore } from '../src/libs/store/concept-store';
import { CardStore } from '../src/libs/store';
import { MindmapStore } from '../src/libs/mindmap-store';
import type { Card } from '../src/libs/types';
import type { ConceptNode, Relation } from '../src/libs/types/concept';

const now = Date.now();
const concepts: ConceptNode[] = [
  {
    id: 'root',
    title: '间隔重复',
    summary: '用逐渐拉长的间隔安排复习。',
    parentIds: [],
    childIds: ['child'],
    relatedIds: [],
    cardIds: ['c11111111'],
    sourceRefs: [],
    tags: [],
    created: now,
    modified: now,
  },
  {
    id: 'child',
    title: 'SM-2',
    parentIds: ['root'],
    childIds: [],
    relatedIds: [],
    cardIds: ['c22222222'],
    sourceRefs: [],
    tags: [],
    created: now,
    modified: now,
  },
];

const relations: Relation[] = [
  { id: 'r1', fromId: 'root', toId: 'child', type: 'parent_child', sourceRefs: [], confidence: 1 },
  { id: 'r2', fromId: 'child', toId: 'root', type: 'related', sourceRefs: [], confidence: 0.5 },
];

const cards = [
  {
    id: 'c11111111',
    conceptId: 'root',
    question: '间隔重复为什么能改善长期记忆？',
    answer: '它利用遗忘曲线，在即将遗忘时复习。',
    hint: '',
    deck: '默认',
    tags: [],
    due: now,
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    status: 'new',
    created: now,
    modified: now,
  },
  {
    id: 'c22222222',
    conceptId: 'child',
    question: 'SM-2 如何更新复习间隔？',
    answer: '根据评分、间隔和 ease 计算下一次复习。',
    hint: '',
    deck: '默认',
    tags: [],
    due: now,
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    status: 'new',
    created: now,
    modified: now,
  },
] satisfies Card[];

const result = conceptsToMindmap(concepts, relations, cards, '测试图谱');

assert.equal(result.title, '测试图谱');
assert.equal(result.conceptCount, 2);
assert.equal(result.relationCount, 2);
assert.equal(result.cards.length, 2);
assert.match(result.markdown, /- 测试图谱（2 个概念 \\/ 2 张卡片）/);
assert.match(result.markdown, /  - 间隔重复/);
assert.match(result.markdown, /    - SM-2/);
assert.match(result.markdown, /#c11111111/);
assert.match(result.markdown, /#c22222222/);

class MemoryPlugin {
  data = new Map<string, any>();
  async loadData(key: string) {
    return this.data.get(key);
  }
  async saveData(key: string, value: any) {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

const plugin = new MemoryPlugin();
const conceptStore = new ConceptStore(plugin);
const cardStore = new CardStore(plugin);
const mindmapStore = new MindmapStore(plugin);
await conceptStore.load();
await cardStore.load();
await mindmapStore.load();

const pipelineResult = {
  concepts: [
    {
      tempId: 'learning',
      title: 'Learning schedule',
      summary: 'A plan for reviewing knowledge over time.',
      sourceRefs: [{ type: 'manual', sourceId: 'source-1', chunkId: 'source-1', quote: 'reviewing knowledge over time' }],
      confidence: 0.92,
      tags: ['learning'],
    },
    {
      tempId: 'spacing',
      title: 'Spacing effect',
      summary: 'Memory improves when reviews are spaced over time.',
      sourceRefs: [{ type: 'manual', sourceId: 'source-1', chunkId: 'source-1', quote: 'reviews are spaced over time' }],
      confidence: 0.91,
      tags: ['memory'],
    },
  ],
  relations: [
    {
      fromTempId: 'learning',
      toTempId: 'spacing',
      type: 'parent_child',
      sourceRefs: [{ type: 'manual', sourceId: 'source-1', chunkId: 'source-1', quote: 'reviews are spaced over time' }],
      confidence: 0.88,
    },
    {
      fromTempId: 'learning',
      toTempId: 'spacing',
      type: 'parent_child',
      sourceRefs: [{ type: 'manual', sourceId: 'source-2', chunkId: 'source-2', quote: 'duplicate relation should merge refs' }],
      confidence: 0.8,
    },
  ],
  cards: [
    {
      conceptTempId: 'spacing',
      cardType: 'qa',
      front: 'What is the spacing effect?',
      back: 'Memory improves when reviews are spaced over time.',
      sourceRefs: [{ type: 'manual', sourceId: 'source-1', chunkId: 'source-1', quote: 'reviews are spaced over time' }],
      confidence: 0.93,
    },
  ],
  uncertain: [],
  warnings: [],
};

const summary = await confirmPipelineResult(pipelineResult, conceptStore, cardStore, {
  deck: 'concept-map',
  tags: ['e2e'],
});

assert.equal(summary.createdConcepts.length, 2);
assert.equal(summary.createdRelations.length, 2);
assert.equal(summary.createdCards.length, 1);
assert.equal(conceptStore.getRelations().length, 1);
assert.equal(conceptStore.getRelations()[0].sourceRefs.length, 2);

const storedConcepts = conceptStore.getAll();
const storedRelations = conceptStore.getRelations();
const storedCards = cardStore.getAll();
const e2eMap = conceptsToMindmap(storedConcepts, storedRelations, storedCards, 'Pipeline map');

assert.equal(e2eMap.conceptCount, 2);
assert.equal(e2eMap.relationCount, 1);
assert.equal(e2eMap.cards.length, 1);
assert.match(e2eMap.markdown, /- Pipeline map/);
assert.match(e2eMap.markdown, /  - Learning schedule/);
assert.match(e2eMap.markdown, /    - Spacing effect/);
assert.match(e2eMap.markdown, /#c/);

const firstSync = await syncConceptMindmap(conceptStore, cardStore, mindmapStore, { title: 'Synced concept map' });
const secondSync = await syncConceptMindmap(conceptStore, cardStore, mindmapStore, { title: 'Synced concept map' });

assert.equal(firstSync.saved.id, secondSync.saved.id);
assert.equal(mindmapStore.getAll().length, 1);
assert.equal(mindmapStore.getAll()[0].source, 'concepts');
assert.equal(mindmapStore.getAll()[0].cardIds.length, 1);
assert.match(mindmapStore.getAll()[0].markdown, /Synced concept map/);

console.log(JSON.stringify({
  concepts: e2eMap.conceptCount,
  cards: e2eMap.cards.length,
  lines: e2eMap.markdown.split('\\n').length,
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
