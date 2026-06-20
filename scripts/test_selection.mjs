import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_selection_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { buildConfirmationOptions, createCandidateSelection } from '../src/libs/ai/selection';
import type { PipelineResult } from '../src/libs/types/concept';

const result: PipelineResult = {
  concepts: [
    {
      tempId: 'c1',
      title: '高置信概念',
      sourceRefs: [{ type: 'manual', sourceId: 's1' }],
      confidence: 0.91,
    },
    {
      tempId: 'c2',
      title: '低置信概念',
      sourceRefs: [{ type: 'manual', sourceId: 's1' }],
      confidence: 0.4,
    },
  ],
  relations: [
    {
      fromTempId: 'c1',
      toTempId: 'c2',
      type: 'related',
      sourceRefs: [{ type: 'manual', sourceId: 's1' }],
      confidence: 0.95,
    },
    {
      fromTempId: 'c1',
      toTempId: 'c1',
      type: 'related',
      sourceRefs: [{ type: 'manual', sourceId: 's1' }],
      confidence: 0.95,
    },
  ],
  cards: [
    {
      conceptTempId: 'c1',
      cardType: 'qa',
      front: '应选卡片？',
      back: '是。',
      sourceRefs: [{ type: 'manual', sourceId: 's1' }],
      confidence: 0.9,
    },
    {
      conceptTempId: 'c2',
      cardType: 'qa',
      front: '不应选卡片？',
      back: '是，因为概念未选。',
      sourceRefs: [{ type: 'manual', sourceId: 's1' }],
      confidence: 0.9,
    },
    {
      cardType: 'qa',
      front: '无概念但可信？',
      back: '可以进入人工确认。',
      sourceRefs: [{ type: 'manual', sourceId: 's1' }],
      confidence: 0.9,
    },
  ],
  uncertain: [],
  warnings: [],
};

const selection = createCandidateSelection(result);
assert.deepEqual([...selection.conceptTempIds], ['c1']);
assert.deepEqual([...selection.relationIndexes], []);
assert.deepEqual([...selection.cardIndexes], [0, 2]);

const options = buildConfirmationOptions(selection, { deck: '测试', tags: ['selection'], save: false });
assert.deepEqual(options.acceptedConceptTempIds, ['c1']);
assert.deepEqual(options.acceptedRelationIndexes, []);
assert.deepEqual(options.acceptedCardIndexes, [0, 2]);
assert.equal(options.deck, '测试');
assert.deepEqual(options.tags, ['selection']);
assert.equal(options.save, false);

console.log(JSON.stringify({
  selectedConcepts: selection.conceptTempIds.size,
  selectedRelations: selection.relationIndexes.size,
  selectedCards: selection.cardIndexes.size,
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
