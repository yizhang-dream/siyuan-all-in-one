import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_pipeline_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { assignCardsToConcepts, confirmPipelineResult, runPromptPipeline } from '../src/libs/ai/pipeline';
import { createCandidateSelection } from '../src/libs/ai/selection';
import { ConceptStore } from '../src/libs/store/concept-store';
import { CardStore } from '../src/libs/store';
import type { PipelineResult } from '../src/libs/types/concept';

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
await conceptStore.load();
await cardStore.load();

const emptyResult = await runPromptPipeline([
  { id: 'blank', text: '   ', type: 'manual' },
]);
assert.equal(emptyResult.concepts.length, 0);
assert.equal(emptyResult.relations.length, 0);
assert.equal(emptyResult.cards.length, 0);
assert.equal(emptyResult.warnings.length, 1);

const originalFetch = (globalThis as any).fetch;
const llmCalls: any[] = [];
const jsonModeFallbackResponses = [
  {
    concepts: [
      {
        tempId: 'json-c1',
        title: 'JSON mode fallback',
        summary: 'Pipeline retries without native JSON mode when a provider rejects response_format.',
        confidence: 0.91,
        sourceRefs: ['json-source'],
      },
    ],
  },
  { relations: [] },
  {
    cards: [
      {
        conceptTempId: 'json-c1',
        cardType: 'qa',
        front: 'What happens when JSON mode is unsupported?',
        back: 'The pipeline retries without native JSON mode and still parses strict JSON.',
        confidence: 0.9,
        sourceRefs: ['json-source'],
      },
    ],
  },
];
(globalThis as any).fetch = async (_url: string, init: any) => {
  const body = JSON.parse(init.body || '{}');
  llmCalls.push(body);
  if (body.response_format?.type === 'json_object') {
    return {
      ok: false,
      status: 400,
      text: async () => 'unsupported parameter: response_format',
      json: async () => ({}),
    };
  }
  const payload = jsonModeFallbackResponses.shift() || {};
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
    text: async () => '',
  };
};

const jsonModeFallback = await runPromptPipeline(
  [
    {
      id: 'json-source',
      text: 'Some OpenAI-compatible providers reject response_format even when they can return JSON by prompt.',
      type: 'manual',
    },
  ],
  {
    llmConfig: {
      endpoint: 'https://example.test/v1/chat/completions',
      model: 'local-json-ish',
      providerId: 'local',
      maxTokens: 2048,
      temperature: 0.1,
      timeout: 1000,
    },
    targetCardCount: 1,
  }
);
(globalThis as any).fetch = originalFetch;

assert.equal(jsonModeFallback.concepts.length, 1);
assert.equal(jsonModeFallback.cards.length, 1);
assert.equal(llmCalls.filter((body) => body.response_format?.type === 'json_object').length, 3);
assert.equal(llmCalls.filter((body) => !body.response_format).length, 3);

const recovered = await runPromptPipeline(
  [
    {
      id: 'manual-1',
      text: '间隔重复通过逐渐拉长复习间隔来改善长期记忆。SM-2 是一种经典调度算法。',
      type: 'manual',
    },
  ],
  {
    targetCardCount: 1,
    jsonCaller: async (_prompt, step) => {
      if (step === 'extract-concepts') {
        return {
          concepts: {
            items: [
              {
                id: 'c1',
                name: '间隔重复',
                definition: '逐渐拉长复习间隔的学习方法。',
                confidence: '0.91',
                evidence: ['manual-1'],
              },
            ],
          },
        };
      }
      if (step === 'infer-relations') {
        throw new Error('model returned prose instead of JSON');
      }
      return {
        cards: {
          data: [
            {
              concept_id: 'c1',
              type: 'qa',
              question: '间隔重复的核心做法是什么？',
              answer: '逐渐拉长复习间隔。',
              confidence: 0.88,
              sourceRefs: ['manual-1'],
            },
          ],
        },
      };
    },
  }
);

assert.equal(recovered.concepts.length, 1);
assert.equal(recovered.concepts[0].title, '间隔重复');
assert.equal(recovered.concepts[0].sourceRefs.length, 1);
assert.equal(recovered.relations.length, 0);
assert.equal(recovered.cards.length, 1);
assert.equal(recovered.cards[0].conceptTempId, 'c1');
assert.equal(recovered.cards[0].sourceRefs.length, 1);
assert.ok(recovered.warnings.some((warning) => warning.includes('infer-relations failed')));

const quoteMatched = await runPromptPipeline(
  [
    {
      id: 'source-a',
      text: 'Alpha concept appears in this chunk. Beta depends on Alpha.',
      type: 'manual',
    },
    {
      id: 'source-b',
      text: 'Gamma appears only in the second chunk.',
      type: 'manual',
    },
  ],
  {
    targetCardCount: 1,
    jsonCaller: async (_prompt, step) => {
      if (step === 'extract-concepts') {
        return {
          concepts: [
            {
              temp_id: 'alpha',
              name: 'Alpha',
              definition: 'Recovered from quote evidence',
              evidence: ['Alpha concept appears in this chunk'],
              confidence: 0.9,
            },
            {
              temp_id: 'beta',
              name: 'Beta',
              definition: 'Recovered from another quote',
              evidence: ['Beta depends on Alpha'],
              confidence: 0.87,
            },
          ],
        };
      }
      if (step === 'infer-relations') {
        return {
          relations: [
            {
              from: 'Beta',
              to: 'Alpha',
              relation_type: 'depends_on',
              references: ['Beta depends on Alpha'],
              confidence: 0.84,
            },
          ],
        };
      }
      return {
        cards: [
          {
            concept_title: 'Alpha',
            card_type: 'question_answer',
            q: 'Where does Alpha appear?',
            a: 'In the first chunk.',
            sources: ['Alpha concept appears in this chunk'],
            confidence: 0.86,
          },
        ],
      };
    },
  }
);

assert.equal(quoteMatched.concepts.length, 2);
assert.equal(quoteMatched.concepts[0].sourceRefs[0].sourceId, 'source-a');
assert.equal(quoteMatched.relations.length, 1);
assert.equal(quoteMatched.relations[0].type, 'prerequisite');
assert.equal(quoteMatched.relations[0].fromTempId, 'beta');
assert.equal(quoteMatched.relations[0].toTempId, 'alpha');
assert.equal(quoteMatched.cards.length, 1);
assert.equal(quoteMatched.cards[0].conceptTempId, 'alpha');
assert.equal(quoteMatched.cards[0].cardType, 'qa');
assert.equal(quoteMatched.cards[0].sourceRefs[0].sourceId, 'source-a');

const wrappedTextOutput = await runPromptPipeline(
  [
    {
      id: 'wrapped-source',
      text: 'Retrieval augmented generation grounds answers in retrieved source chunks.',
      type: 'source',
      sourceId: 'wrapped-source',
      chunkId: 'chunk-1',
    },
  ],
  {
    targetCardCount: 1,
    jsonCaller: async (_prompt, step) => {
      if (step === 'extract-concepts') {
        return {
          choices: [
            {
              message: {
                content: [
                  String.fromCharCode(96, 96, 96) + 'json',
                  '{"concepts":[{"tempId":"rag","title":"RAG","summary":"Grounds answers in retrieved chunks.","confidence":0.91,"sourceRefs":["wrapped-source"]}]}',
                  String.fromCharCode(96, 96, 96),
                ].join('\\n'),
              },
            },
          ],
        };
      }
      if (step === 'infer-relations') {
        return '[]';
      }
      return {
        content: '{"cards":[{"conceptTempId":"rag","cardType":"basic","front":"What does RAG ground answers in?","back":"Retrieved source chunks.","confidence":0.9,"sourceRefs":["wrapped-source"]}]}',
      };
    },
  }
);

assert.equal(wrappedTextOutput.concepts.length, 1);
assert.equal(wrappedTextOutput.concepts[0].tempId, 'rag');
assert.equal(wrappedTextOutput.relations.length, 0);
assert.equal(wrappedTextOutput.cards.length, 1);
assert.equal(wrappedTextOutput.cards[0].cardType, 'qa');
assert.equal(wrappedTextOutput.cards[0].sourceRefs[0].sourceId, 'wrapped-source');

const arrayContentOutput = await runPromptPipeline(
  [
    {
      id: 'array-content-source',
      text: 'Active recall improves memory by forcing retrieval instead of rereading.',
      type: 'manual',
    },
  ],
  {
    targetCardCount: 1,
    jsonCaller: async (_prompt, step) => {
      if (step === 'extract-concepts') {
        return {
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: '{"concepts":[{"tempId":"ar","title":"Active recall","summary":"Forcing retrieval improves memory.","confidence":0.9,"sourceRefs":["array-content-source"]}]}',
                },
              ],
            },
          ],
        };
      }
      if (step === 'infer-relations') {
        return {
          response: {
            content: [
              {
                text: '{"relations":[]}',
              },
            ],
          },
        };
      }
      return {
        message: {
          content: [
            {
              text: '{"cards":[{"conceptTempId":"ar","cardType":"qa","front":"How does active recall improve memory?","back":"It forces retrieval instead of rereading.","confidence":0.89,"sourceRefs":["array-content-source"]}]}',
            },
          ],
        },
      };
    },
  }
);

assert.equal(arrayContentOutput.concepts.length, 1);
assert.equal(arrayContentOutput.cards.length, 1);
assert.equal(arrayContentOutput.cards[0].conceptTempId, 'ar');

const nullConfidenceOutput = await runPromptPipeline(
  [
    {
      id: 'null-confidence-source',
      text: 'Impulse is force accumulated over time, and it equals the change in momentum.',
      type: 'manual',
    },
  ],
  {
    targetCardCount: 1,
    jsonCaller: async (_prompt, step) => {
      if (step === 'extract-concepts') {
        return '{"concepts":[{"tempId":"impulse","title":"Impulse","summary":"Force accumulated over time.","confidence":NaN,"sourceRefs":["null-confidence-source"]}]}';
      }
      if (step === 'infer-relations') return '{"relations":[]}';
      return '{"cards":[{"conceptTempId":"impulse","cardType":"qa","front":"What is impulse?","back":"Force accumulated over time, equal to change in momentum.","confidence":NaN,"sourceRefs":["null-confidence-source"]}]}';
    },
  }
);

assert.equal(nullConfidenceOutput.concepts.length, 1);
assert.equal(nullConfidenceOutput.concepts[0].confidence, 0.5);
assert.equal(nullConfidenceOutput.cards.length, 1);
assert.equal(nullConfidenceOutput.cards[0].confidence, 0.5);

const assignmentFailure = await assignCardsToConcepts(
  arrayContentOutput.concepts,
  arrayContentOutput.cards,
  {
    jsonCaller: async () => {
      throw new Error('assignment model returned invalid JSON');
    },
  }
);

assert.equal(assignmentFailure.assignments.length, 0);
assert.equal(assignmentFailure.suggestedNewConcepts.length, 0);
assert.equal(assignmentFailure.needsUserReview.length, 0);
assert.ok(assignmentFailure.warnings.some((warning) => warning.includes('assign-cards failed')));

const extractFailure = await runPromptPipeline(
  [{ id: 'bad-source', text: 'Useful text still exists, but the model failed.', type: 'manual' }],
  {
    jsonCaller: async (_prompt, step) => {
      if (step === 'extract-concepts') throw new Error('invalid JSON');
      return {};
    },
  }
);

assert.equal(extractFailure.concepts.length, 0);
assert.equal(extractFailure.cards.length, 0);
assert.ok(extractFailure.warnings.some((warning) => warning.includes('extract-concepts failed')));
assert.ok(extractFailure.warnings.some((warning) => warning.includes('No supported concept candidates')));

const cardFallback = await runPromptPipeline(
  [
    {
      id: 'fallback-source',
      text: 'Spaced repetition improves retention by reviewing material at expanding intervals.',
      type: 'manual',
    },
  ],
  {
    targetCardCount: 2,
    jsonCaller: async (_prompt, step) => {
      if (step === 'extract-concepts') {
        return {
          concepts: [
            {
              tempId: 'sr',
              title: 'Spaced repetition',
              summary: 'Reviewing material at expanding intervals improves retention.',
              confidence: 0.92,
              sourceRefs: ['fallback-source'],
            },
          ],
        };
      }
      if (step === 'generate-cards') throw new Error('card JSON malformed');
      return {};
    },
  }
);

assert.equal(cardFallback.concepts.length, 1);
assert.equal(cardFallback.cards.length, 1);
assert.equal(cardFallback.cards[0].front, 'What is Spaced repetition?');
assert.equal(cardFallback.cards[0].back, 'Reviewing material at expanding intervals improves retention.');
assert.equal(cardFallback.cards[0].confidence, 0.6);
assert.ok(cardFallback.warnings.some((warning) => warning.includes('generate-cards failed')));
assert.ok(cardFallback.warnings.some((warning) => warning.includes('conservative review-only cards')));
assert.equal(createCandidateSelection(cardFallback).cardIndexes.size, 0);

const result: PipelineResult = {
  concepts: [
    {
      tempId: 'c1',
      title: '间隔重复',
      summary: '根据遗忘规律安排复习时间的方法。',
      sourceRefs: [{ type: 'manual', sourceId: 's1', chunkId: 's1', quote: '间隔重复根据遗忘规律安排复习时间' }],
      confidence: 0.92,
      tags: ['学习方法'],
    },
    {
      tempId: 'c2',
      title: 'SM-2',
      summary: '一种经典的间隔重复调度算法。',
      sourceRefs: [{ type: 'manual', sourceId: 's1', chunkId: 's1', quote: 'SM-2 是经典调度算法' }],
      confidence: 0.9,
      tags: ['算法'],
    },
  ],
  relations: [
    {
      fromTempId: 'c1',
      toTempId: 'c2',
      type: 'parent_child',
      sourceRefs: [{ type: 'manual', sourceId: 's1', chunkId: 's1', quote: 'SM-2 属于间隔重复算法' }],
      confidence: 0.86,
    },
  ],
  cards: [
    {
      conceptTempId: 'c2',
      cardType: 'qa',
      front: 'SM-2 是什么？',
      back: 'SM-2 是一种经典的间隔重复调度算法。',
      hint: '复习调度',
      sourceRefs: [{ type: 'manual', sourceId: 's1', chunkId: 's1', quote: 'SM-2 是经典调度算法' }],
      confidence: 0.93,
    },
    {
      conceptTempId: 'missing',
      cardType: 'qa',
      front: '这张卡应被跳过吗？',
      back: '是，因为概念未被接受。',
      sourceRefs: [{ type: 'manual', sourceId: 's1', chunkId: 's1', quote: '测试' }],
      confidence: 0.93,
    },
  ],
  uncertain: [],
  warnings: [],
};

const summary = await confirmPipelineResult(result, conceptStore, cardStore, {
  deck: '测试牌组',
  tags: ['pipeline'],
});

assert.equal(summary.createdConcepts.length, 2);
assert.equal(summary.createdRelations.length, 1);
assert.equal(summary.createdCards.length, 1);
assert.equal(summary.skippedCards.length, 1);
assert.ok(summary.conceptIdByTempId.c1);
assert.ok(summary.conceptIdByTempId.c2);

const concepts = conceptStore.getAll();
const relations = conceptStore.getRelations();
const cards = cardStore.getAll();

assert.equal(concepts.length, 2);
assert.equal(relations.length, 1);
assert.equal(cards.length, 1);
assert.equal(cards[0].conceptId, summary.conceptIdByTempId.c2);
assert.equal(cards[0].cardType, 'qa');
assert.equal(cards[0].sourceRefs.length, 1);
assert.equal(conceptStore.getById(summary.conceptIdByTempId.c2)?.cardIds.includes(cards[0].id), true);
assert.equal(plugin.data.has('concepts'), true);
assert.equal(plugin.data.has('relations'), true);
assert.equal(plugin.data.has('cards'), true);

const reloadedCardStore = new CardStore(plugin);
await reloadedCardStore.load();
const reloadedCards = reloadedCardStore.getAll();
assert.equal(reloadedCards[0].conceptId, summary.conceptIdByTempId.c2);
assert.equal(reloadedCards[0].cardType, 'qa');
assert.equal(reloadedCards[0].sourceRefs.length, 1);

const selfRelationPlugin = new MemoryPlugin();
const selfRelationConceptStore = new ConceptStore(selfRelationPlugin);
const selfRelationCardStore = new CardStore(selfRelationPlugin);
await selfRelationConceptStore.load();
await selfRelationCardStore.load();

const selfRelationSummary = await confirmPipelineResult(
  {
    concepts: [
      {
        tempId: 'loop',
        title: 'Self relation guard',
        summary: 'Relations should not connect a concept to itself.',
        sourceRefs: [{ type: 'manual', sourceId: 'self-source', chunkId: 'self-source', quote: 'Self loops are not useful here.' }],
        confidence: 0.95,
      },
    ],
    relations: [
      {
        fromTempId: 'loop',
        toTempId: 'loop',
        type: 'related',
        sourceRefs: [{ type: 'manual', sourceId: 'self-source', chunkId: 'self-source', quote: 'Self loops are not useful here.' }],
        confidence: 0.95,
      },
    ],
    cards: [],
    uncertain: [],
    warnings: [],
  },
  selfRelationConceptStore,
  selfRelationCardStore,
  {
    acceptedConceptTempIds: ['loop'],
    acceptedRelationIndexes: [0],
    acceptedCardIndexes: [],
    save: false,
  }
);
assert.equal(selfRelationSummary.createdConcepts.length, 1);
assert.equal(selfRelationSummary.createdRelations.length, 0);
assert.equal(selfRelationConceptStore.getRelations().length, 0);
assert.ok(selfRelationSummary.warnings.some((warning) => warning.includes('self relation')));

const editedPlugin = new MemoryPlugin();
const editedConceptStore = new ConceptStore(editedPlugin);
const editedCardStore = new CardStore(editedPlugin);
await editedConceptStore.load();
await editedCardStore.load();

const editedResult: PipelineResult = {
  concepts: [
    {
      tempId: 'root',
      title: '用户改名后的核心概念',
      summary: '用户在确认前编辑过的摘要。',
      sourceRefs: [{ type: 'manual', sourceId: 'edited-source', chunkId: 'chunk-1', quote: '核心概念证据' }],
      confidence: 0.99,
      tags: ['edited'],
    },
    {
      tempId: 'detail',
      title: '用户改名后的细节概念',
      summary: '关系端点会指向这个编辑后的候选。',
      sourceRefs: [{ type: 'manual', sourceId: 'edited-source', chunkId: 'chunk-2', quote: '细节概念证据' }],
      confidence: 0.98,
      tags: ['edited'],
    },
  ],
  relations: [
    {
      fromTempId: 'detail',
      toTempId: 'root',
      type: 'prerequisite',
      sourceRefs: [{ type: 'manual', sourceId: 'edited-source', chunkId: 'chunk-3', quote: '用户编辑后的关系证据' }],
      confidence: 0.97,
    },
  ],
  cards: [
    {
      conceptTempId: 'root',
      cardType: 'compare',
      front: '这张编辑后的卡片应该关联到哪个概念？',
      back: '应该关联到用户选择的 root 概念，而不是模型原始建议。',
      hint: '确认前可编辑归属',
      sourceRefs: [{ type: 'manual', sourceId: 'edited-source', chunkId: 'chunk-4', quote: '用户编辑后的卡片证据' }],
      confidence: 0.96,
    },
  ],
  uncertain: [],
  warnings: [],
};

const editedSummary = await confirmPipelineResult(editedResult, editedConceptStore, editedCardStore, {
  acceptedConceptTempIds: ['root', 'detail'],
  acceptedRelationIndexes: [0],
  acceptedCardIndexes: [0],
  deck: '编辑后确认',
  tags: ['edited-confirmation'],
});

assert.equal(editedSummary.createdConcepts.length, 2);
assert.equal(editedSummary.createdRelations.length, 1);
assert.equal(editedSummary.createdCards.length, 1);
assert.equal(editedSummary.skippedCards.length, 0);

const rootId = editedSummary.conceptIdByTempId.root;
const detailId = editedSummary.conceptIdByTempId.detail;
const editedConcepts = editedConceptStore.getAll();
const editedRelations = editedConceptStore.getRelations();
const editedCards = editedCardStore.getAll();

assert.equal(editedConceptStore.getById(rootId)?.title, '用户改名后的核心概念');
assert.equal(editedConceptStore.getById(detailId)?.title, '用户改名后的细节概念');
assert.equal(editedRelations.length, 1);
assert.equal(editedRelations[0].fromId, detailId);
assert.equal(editedRelations[0].toId, rootId);
assert.equal(editedRelations[0].type, 'prerequisite');
assert.equal(editedCards.length, 1);
assert.equal(editedCards[0].conceptId, rootId);
assert.equal(editedCards[0].cardType, 'compare');
assert.equal(editedConceptStore.getById(rootId)?.cardIds.includes(editedCards[0].id), true);
assert.equal(editedConceptStore.getById(detailId)?.cardIds.includes(editedCards[0].id), false);
assert.equal(editedConcepts.every((concept) => concept.tags.includes('edited')), true);

console.log(JSON.stringify({
  createdConcepts: summary.createdConcepts.length,
  createdRelations: summary.createdRelations.length,
  createdCards: summary.createdCards.length,
  skippedCards: summary.skippedCards.length,
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
