import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_prompt_contracts_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import {
  buildAssignCardsPrompt,
  buildExtractConceptsPrompt,
  buildGenerateCardsPrompt,
  buildInferRelationsPrompt,
} from '../src/libs/ai/prompts';
import type { ConceptCandidate, RelationCandidate, CardCandidate } from '../src/libs/types/concept';

const chunks = [
  {
    id: 'source-1',
    text: 'Active recall improves memory by forcing retrieval.',
    sourceRef: { type: 'manual' as const, sourceId: 'source-1', chunkId: 'source-1' },
  },
];

const concepts: ConceptCandidate[] = [
  {
    tempId: 'c1',
    title: 'Active recall',
    summary: 'Forcing retrieval improves memory.',
    sourceRefs: [{ type: 'manual', sourceId: 'source-1' }],
    confidence: 0.9,
  },
];

const relations: RelationCandidate[] = [];
const cards: CardCandidate[] = [
  {
    conceptTempId: 'c1',
    cardType: 'qa',
    front: 'What does active recall force?',
    back: 'Retrieval.',
    sourceRefs: [{ type: 'manual', sourceId: 'source-1' }],
    confidence: 0.9,
  },
];

const prompts = [
  buildExtractConceptsPrompt(chunks),
  buildInferRelationsPrompt(concepts, chunks),
  buildGenerateCardsPrompt(concepts, relations, chunks, 1),
  buildGenerateCardsPrompt(concepts, relations, chunks, 2, 'zh-CN', true),
  buildAssignCardsPrompt(concepts, cards),
];

for (const prompt of prompts) {
  assert.match(prompt, /STRICT OUTPUT CONTRACT/);
  assert.match(prompt, /Return one JSON object only/);
  assert.match(prompt, /sourceRefs/);
  assert.match(prompt, /Evidence budget/);
  assert.match(prompt, /uncertain|warnings/);
}

assert.match(prompts[2], /FLASHCARD QUALITY CONTRACT/);
assert.match(prompts[2], /Test one idea per card/);
assert.match(prompts[2], /Do not ask questions whose answer is absent from sourceRefs/);
assert.match(prompts[2], /Do not turn a heading into a card/);
assert.match(prompts[1], /RELATION RUBRIC/);
assert.ok(prompts[1].includes('parent_child: use only for true type/subtype'));
assert.ok(prompts[1].includes('related: use only as a weak fallback'));
assert.ok(prompts[3].includes('CDF (Concept Descriptor Framework)'), 'CDF mode prompt should include descriptor framework instructions');
assert.ok(prompts[3].includes('descriptorDimension'), 'CDF mode prompt should include descriptorDimension field in schema');

console.log(JSON.stringify({
  prompts: prompts.length,
  hasQualityContract: prompts[2].includes('FLASHCARD QUALITY CONTRACT'),
  hasEvidenceBudget: prompts.every((prompt) => prompt.includes('Evidence budget')),
  hasRelationRubric: prompts[1].includes('RELATION RUBRIC'),
  hasCDFMode: prompts[3].includes('CDF (Concept Descriptor Framework)'),
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
