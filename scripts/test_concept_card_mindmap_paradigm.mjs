import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_paradigm_test');
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
import { confirmPipelineResult, runPromptPipeline } from '../src/libs/ai/pipeline';
import { syncConceptMindmap } from '../src/libs/concept-mindmap-sync';
import { normalizeMindmapCardDrafts, extractMindmapTopics } from '../src/libs/mindmap-cards';
import { treeToSections } from '../src/libs/mindmap';
import { profileMindmapMarkdown } from '../src/libs/markmap-render';
import { CardStore } from '../src/libs/store';
import { ConceptStore } from '../src/libs/store/concept-store';
import { MindmapStore, genMindmapId } from '../src/libs/mindmap-store';
import { createCard } from '../src/libs/srs/sm2';
import type { Card } from '../src/libs/types/card';

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

const mixedSources = [
  {
    id: 'manual-extra',
    type: 'manual',
    text: 'Impulse is the accumulated effect of net force over time.',
  },
  {
    id: 'on-note-1',
    type: 'opennotebook',
    sourceId: 'source:mechanics',
    chunkId: 'chunk:impulse',
    text: 'The impulse-momentum theorem states that impulse equals change in momentum.',
  },
  {
    id: 'siyuan-block-1',
    type: 'siyuan',
    sourceId: 'doc:physics',
    blockId: 'block:momentum',
    text: 'Momentum is mass times velocity, p = mv.',
  },
] as const;

const generated = await runPromptPipeline([...mixedSources], {
  targetCardCount: 2,
  jsonCaller: async (_prompt, step) => {
    if (step === 'extract-concepts') {
      return {
        concepts: [
          {
            tempId: 'impulse',
            title: 'Impulse',
            summary: 'The accumulated effect of net force over time.',
            sourceRefs: ['manual-extra'],
            confidence: 0.93,
          },
          {
            tempId: 'momentum',
            title: 'Momentum',
            summary: 'Mass times velocity.',
            sourceRefs: ['siyuan-block-1'],
            confidence: 0.91,
          },
        ],
      };
    }
    if (step === 'infer-relations') {
      return {
        relations: [
          {
            from: 'Impulse',
            to: 'Momentum',
            relation_type: 'causes',
            references: ['The impulse-momentum theorem states that impulse equals change in momentum.'],
            confidence: 0.9,
          },
        ],
      };
    }
    return {
      cards: [
        {
          conceptTitle: 'Impulse',
          cardType: 'qa',
          front: 'What does impulse measure?',
          back: 'Impulse measures the accumulated effect of net force over time.',
          sourceRefs: ['manual-extra'],
          confidence: 0.92,
        },
        {
          conceptTitle: 'Momentum',
          cardType: 'qa',
          front: 'What is momentum?',
          back: 'Momentum is mass times velocity, p = mv.',
          sourceRefs: ['siyuan-block-1'],
          confidence: 0.9,
        },
      ],
    };
  },
});

assert.equal(generated.concepts.length, 2);
assert.equal(generated.relations.length, 1);
assert.equal(generated.cards.length, 2);
assert.equal(generated.concepts.some((concept) => concept.sourceRefs[0].type === 'manual'), true);
assert.equal(generated.concepts.some((concept) => concept.sourceRefs[0].type === 'siyuan'), true);
assert.equal(generated.relations[0].sourceRefs[0].type, 'opennotebook');

generated.concepts[0].title = 'Edited impulse';
generated.concepts[1].title = 'Edited momentum';
generated.relations[0].fromTempId = 'momentum';
generated.relations[0].toTempId = 'impulse';
generated.relations[0].type = 'prerequisite';
generated.cards[0].conceptTempId = 'momentum';
generated.cards[0].front = 'Which edited concept owns this card?';
generated.cards[0].back = 'The user reassigned it to edited momentum before confirmation.';

const confirmed = await confirmPipelineResult(generated, conceptStore, cardStore, {
  acceptedConceptTempIds: ['impulse', 'momentum'],
  acceptedRelationIndexes: [0],
  acceptedCardIndexes: [0, 1],
  deck: 'paradigm',
  tags: ['bidirectional'],
});

assert.equal(confirmed.createdConcepts.length, 2);
assert.equal(confirmed.createdRelations.length, 1);
assert.equal(confirmed.createdCards.length, 2);

const impulseId = confirmed.conceptIdByTempId.impulse;
const momentumId = confirmed.conceptIdByTempId.momentum;
const storedCards = cardStore.getAll();
const storedRelations = conceptStore.getRelations();

assert.equal(conceptStore.getById(impulseId)?.title, 'Edited impulse');
assert.equal(conceptStore.getById(momentumId)?.title, 'Edited momentum');
assert.equal(storedRelations[0].fromId, momentumId);
assert.equal(storedRelations[0].toId, impulseId);
assert.equal(storedRelations[0].type, 'prerequisite');
assert.equal(storedCards[0].conceptId, momentumId);
assert.equal(conceptStore.getById(momentumId)?.cardIds.includes(storedCards[0].id), true);
assert.equal(conceptStore.getById(impulseId)?.cardIds.includes(storedCards[0].id), false);

const oneShotMap = await syncConceptMindmap(conceptStore, cardStore, mindmapStore, {
  title: 'One-shot cards and concept map',
});
assert.equal(oneShotMap.saved.source, 'concepts');
assert.equal(oneShotMap.saved.cardIds.length, 2);
assert.match(oneShotMap.saved.markdown, /Edited impulse/);
assert.match(oneShotMap.saved.markdown, /Edited momentum/);
assert.match(oneShotMap.saved.markdown, new RegExp(storedCards[0].id));

const cardsToMapTree = {
  subtopics: [
    {
      name: 'Mechanics',
      knowledge_points: [
        { name: 'Edited momentum review', cards: [1] },
        { name: 'Impulse theorem review', cards: [2] },
      ],
    },
  ],
};
const cardsToMapSections = treeToSections(cardsToMapTree, storedCards as Card[], 'Cards to map');
assert.equal(cardsToMapSections.length, 1);
assert.match(cardsToMapSections[0].mindmapMd, new RegExp(storedCards[0].id));
assert.match(cardsToMapSections[0].mindmapMd, new RegExp(storedCards[1].id));

const cardsMap = await mindmapStore.upsert({
  id: genMindmapId(),
  title: 'Cards to map',
  markdown: cardsToMapSections[0].mindmapMd,
  cardIds: storedCards.map((card) => card.id),
  source: 'cards',
  deck: 'paradigm',
  created: Date.now(),
  modified: Date.now(),
});
assert.equal(mindmapStore.getByCardId(storedCards[0].id).some((map) => map.id === cardsMap.id), true);
assert.equal(profileMindmapMarkdown(cardsToMapSections[0].mindmapMd).cardNodeCount, 2);

const mapFirstMarkdown = [
  '- Map-first mechanics',
  '  - Impulse theorem',
  '    - Force over time',
  '  - Momentum conservation',
].join('\\n');
const topics = extractMindmapTopics(mapFirstMarkdown);
const drafts = normalizeMindmapCardDrafts([
  {
    front: 'What does the impulse theorem connect?',
    back: 'It connects impulse with change in momentum.',
    topicTitle: 'Impulse theorem',
    confidence: 0.88,
  },
  {
    front: 'What does conservation of momentum require?',
    back: 'A closed system with no external net impulse.',
    topicTitle: 'Momentum conservation',
    confidence: 0.86,
  },
], topics);
assert.equal(drafts.length, 2);

const mapFirst = await mindmapStore.upsert({
  id: genMindmapId(),
  title: 'Map first',
  markdown: mapFirstMarkdown,
  cardIds: [],
  linkedCardIds: [],
  source: 'manual',
  created: Date.now(),
  modified: Date.now(),
});

const mapGeneratedIds: string[] = [];
for (const draft of drafts) {
  const card = createCard(draft.front, draft.back, draft.hint || '', 'map-first', ['mindmap'], 'qa', undefined, [
    {
      type: 'manual',
      sourceId: mapFirst.id,
      chunkId: draft.topicPath.join(' > '),
      quote: draft.topicPath.join(' > '),
    },
  ]);
  cardStore.add(card);
  mapGeneratedIds.push(card.id);
}
await mindmapStore.upsert({
  ...mapFirst,
  cardIds: mapGeneratedIds,
  linkedCardIds: mapGeneratedIds,
  modified: Date.now(),
});

const reloadedMapFirst = mindmapStore.getById(mapFirst.id)!;
assert.deepEqual(reloadedMapFirst.linkedCardIds?.sort(), mapGeneratedIds.slice().sort());
assert.equal(mindmapStore.getByCardId(mapGeneratedIds[0]).some((map) => map.id === mapFirst.id), true);
assert.equal(cardStore.getById(mapGeneratedIds[0])?.sourceRefs[0].sourceId, mapFirst.id);

await cardStore.save();
await conceptStore.save();
await mindmapStore.save();

const reloadedCards = new CardStore(plugin);
const reloadedConcepts = new ConceptStore(plugin);
const reloadedMaps = new MindmapStore(plugin);
await reloadedCards.load();
await reloadedConcepts.load();
await reloadedMaps.load();

assert.equal(reloadedCards.getAll().length, 4);
assert.equal(reloadedConcepts.getAll().length, 2);
assert.equal(reloadedMaps.getAll().length, 3);
assert.equal(reloadedMaps.getByCardId(mapGeneratedIds[1]).length, 1);
assert.equal(reloadedConcepts.getById(momentumId)?.cardIds.includes(storedCards[0].id), true);

console.log(JSON.stringify({
  mixedSourceConcepts: generated.concepts.length,
  oneShotMapCards: oneShotMap.saved.cardIds.length,
  cardsToMapCards: cardsMap.cardIds.length,
  mapToCards: mapGeneratedIds.length,
  persistedCards: reloadedCards.getAll().length,
  persistedMindmaps: reloadedMaps.getAll().length,
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
