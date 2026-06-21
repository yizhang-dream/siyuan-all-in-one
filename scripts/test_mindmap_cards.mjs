import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_mindmap_cards_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');
const siyuanStub = path.join(tempDir, 'siyuan-stub.ts');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(siyuanStub, `
export async function fetchSyncPost() {
  return {};
}
export function openTab() {}
`, 'utf8');

await writeFile(entry, `
import assert from 'node:assert/strict';
import {
  buildMindmapToCardsPrompt,
  extractMindmapTopics,
  normalizeMindmapCardDrafts,
} from '../src/libs/mindmap-cards';
import { treeToIndex, treeToSections } from '../src/libs/mindmap';
import { filterMindmapMarkdown, getMindmapRenderTuning, profileMindmapMarkdown, searchMindmapNodes, extractGapNodes, gapNodesToSourceText } from '../src/libs/markmap-render';
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

const cards = [
  {
    id: 'c11111111',
    question: 'What is impulse $J = \\\\Delta p$?',
    answer: 'Impulse changes momentum.',
    hint: '',
    deck: 'Physics',
    tags: [],
    due: 0,
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    status: 'new',
    created: 1,
    modified: 1,
  },
  {
    id: 'c22222222',
    question: 'How does momentum relate to mass?',
    answer: 'Momentum is mass times velocity.',
    hint: '',
    deck: 'Physics',
    tags: [],
    due: 0,
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    status: 'review',
    created: 1,
    modified: 1,
  },
] as any[];
const tree = {
  subtopics: [
    {
      name: 'Momentum',
      knowledge_points: [
        { name: 'Impulse theorem', cards: [1] },
        { name: 'Momentum definition', cards: [2] },
      ],
    },
  ],
};
const sections = treeToSections(tree, cards, 'Physics 知识树');
assert.equal(sections.length, 1);
assert.match(sections[0].mindmapMd, /#c11111111/);
assert.match(sections[0].mindmapMd, /#c22222222/);
assert.match(sections[0].mindmapMd, /\\$J = \\\\Delta p\\$/);
const indexMarkdown = treeToIndex(tree, cards);
assert.equal(indexMarkdown.includes('\`c11111111\`'), true);
assert.equal(indexMarkdown.includes('\`c22222222\`'), true);
assert.equal(indexMarkdown.includes('## 卡片索引'), true);
assert.match(indexMarkdown, /\[(weak|learning|mastered|buried)\]/);
assert.doesNotMatch(indexMarkdown, /📋|⚫|🟢|🟡|🔴/);

const smallProfile = profileMindmapMarkdown(sections[0].mindmapMd);
assert.equal(smallProfile.sizeClass, 'small');
assert.equal(smallProfile.initialExpandLevel, 3);
assert.equal(smallProfile.cardNodeCount, 2);
const smallTuning = getMindmapRenderTuning(smallProfile);
assert.equal(smallTuning.animationDuration, 300);
assert.equal(smallTuning.chunkedClickBinding, false);

const bigMarkdown = [
  '- Big map',
  ...Array.from({ length: 80 }, (_, topicIndex) => [
    \`  - Topic \${topicIndex + 1}\`,
    ...Array.from({ length: 4 }, (_, childIndex) =>
      \`    - Detail \${topicIndex + 1}.\${childIndex + 1} #c\${String(topicIndex).padStart(4, '0')}\${childIndex}\`
    ),
  ]).flat(),
].join('\\n');
const bigProfile = profileMindmapMarkdown(bigMarkdown);
assert.equal(bigProfile.nodeCount, 401);
assert.equal(bigProfile.cardNodeCount, 320);
assert.equal(bigProfile.sizeClass, 'large');
assert.equal(bigProfile.initialExpandLevel, 1);
const bigTuning = getMindmapRenderTuning(bigProfile);
assert.equal(bigTuning.animationDuration, 0);
assert.equal(bigTuning.chunkedClickBinding, true);
assert.equal(bigTuning.clickBindChunkSize < smallTuning.clickBindChunkSize, true);

const fakeMarkmap = {
  state: {
    data: {
      content: 'Mechanics',
      state: { id: 1, depth: 0 },
      children: [
        {
          content: 'Momentum #c11111111',
          state: { id: 2, depth: 1 },
          children: [
            { content: '<span>Impulse theorem</span>', state: { id: 3, depth: 2 }, children: [] },
          ],
        },
        {
          content: 'Energy',
          state: { id: 4, depth: 1 },
          children: [],
        },
      ],
    },
  },
} as any;
const titleSearch = searchMindmapNodes(fakeMarkmap, 'impulse');
assert.equal(titleSearch.matches.length, 1);
assert.deepEqual(titleSearch.activeMatch?.path, ['Mechanics', 'Momentum #c11111111', 'Impulse theorem']);
const pathSearch = searchMindmapNodes(fakeMarkmap, 'mechanics momentum');
assert.equal(pathSearch.matches.length, 2);
assert.equal(pathSearch.activeMatch?.text, 'Momentum');
const cardIdSearch = searchMindmapNodes(fakeMarkmap, 'c11111111');
assert.equal(cardIdSearch.matches.length, 1);
assert.equal(cardIdSearch.activeMatch?.cardId, 'c11111111');

const filteredCards = filterMindmapMarkdown(markdown, 'cards');
assert.equal(filteredCards.stats.totalNodes, 5);
assert.equal(filteredCards.stats.cardNodes, 2);
assert.equal(filteredCards.stats.visibleNodes, 4);
assert.match(filteredCards.markdown, /Momentum #c11111111/);
assert.match(filteredCards.markdown, /Work-energy theorem #c22222222/);
assert.doesNotMatch(filteredCards.markdown, /Impulse theorem/);
const filteredGaps = filterMindmapMarkdown(markdown, 'gaps');
assert.equal(filteredGaps.stats.gapLeaves, 1);
assert.match(filteredGaps.markdown, /Impulse theorem/);
assert.doesNotMatch(filteredGaps.markdown, /Work-energy theorem #c22222222/);
const filteredFocus = filterMindmapMarkdown(markdown, 'focus', 'momentum');
assert.equal(filteredFocus.stats.visibleNodes, 3);
assert.match(filteredFocus.markdown, /Impulse theorem/);
assert.doesNotMatch(filteredFocus.markdown, /Energy/);

const gaps = extractGapNodes(markdown);
assert.equal(gaps.length, 1);
assert.equal(gaps[0].cleanTitle, 'Impulse theorem');
assert.match(gaps[0].pathText, /Momentum/);
const gapText = gapNodesToSourceText(gaps);
assert.match(gapText, /## Impulse theorem/);
assert.match(gapText, /路径: .+ Impulse theorem/);

await store.upsert({
  id: 'cards-map',
  title: 'Physics 知识树',
  markdown: sections[0].mindmapMd,
  cardIds: cards.map((card) => card.id),
  source: 'cards',
  deck: 'Physics',
  created: 2,
  modified: 2,
});
assert.equal(store.getByCardId('c11111111')[0]?.id, 'cards-map');
assert.equal(store.getByCardId('c22222222')[0]?.deck, 'Physics');

console.log(JSON.stringify({
  topics: topics.length,
  drafts: drafts.length,
  linkedCardIdsMerged: true,
  cardsToMindmapLinked: true,
  largeMapTuning: true,
  mindmapSearch: true,
  mindmapViewFilters: true,
  gapNodeExtraction: true,
}, null, 2));
`, 'utf8');

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  plugins: [{
    name: 'siyuan-stub',
    setup(build) {
      build.onResolve({ filter: /^siyuan$/ }, () => ({ path: siyuanStub }));
    },
  }],
  logLevel: 'silent',
});

try {
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
