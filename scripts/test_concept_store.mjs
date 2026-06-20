import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_concept_store_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { ConceptStore } from '../src/libs/store/concept-store';

class MemoryPlugin {
  data = new Map<string, any>();
  constructor(initial: Record<string, any>) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, value);
  }
  async loadData(key: string) {
    return this.data.get(key);
  }
  async saveData(key: string, value: any) {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }
}

const plugin = new MemoryPlugin({
  concepts: [
    {
      id: 42,
      name: 'Recovered concept',
      parentIds: 'not-an-array',
      childIds: [7],
      relatedIds: null,
      cardIds: ['card-a', 99],
      sourceRefs: [
        'source-a',
        { type: 'opennotebook', sourceId: 123, chunkId: 'chunk-1', page: '4', quote: 'quoted evidence' },
        { type: 'weird', unused: true },
      ],
      tags: ['ai', 2026],
      confidence: '0.77',
      created: 0,
      modified: 'bad',
    },
    {
      title: '',
    },
  ],
  relations: [
    {
      from: 42,
      to: 'child',
      relation_type: 'depends_on',
      references: ['source-a'],
      confidence: '0.81',
    },
    {
      id: 'r-ok',
      fromId: '42',
      toId: 'child',
      type: 'parent_child',
      sourceRefs: [{ type: 'url', url: 'https://example.test', page: '2' }],
    },
  ],
});

const store = new ConceptStore(plugin);
await store.load();

const concepts = store.getAll();
const relations = store.getRelations();

assert.equal(concepts.length, 2);
assert.equal(concepts[0].id, '42');
assert.equal(concepts[0].title, 'Recovered concept');
assert.deepEqual(concepts[0].parentIds, []);
assert.deepEqual(concepts[0].childIds, ['7']);
assert.deepEqual(concepts[0].cardIds, ['card-a', '99']);
assert.deepEqual(concepts[0].tags, ['ai', '2026']);
assert.equal(concepts[0].confidence, 0.77);
assert.equal(concepts[0].sourceRefs.length, 2);
assert.equal(concepts[0].sourceRefs[0].type, 'manual');
assert.equal(concepts[0].sourceRefs[0].sourceId, 'source-a');
assert.equal(concepts[0].sourceRefs[1].type, 'opennotebook');
assert.equal(concepts[0].sourceRefs[1].sourceId, '123');
assert.equal(concepts[0].sourceRefs[1].page, 4);
assert.equal(concepts[1].title, 'Untitled concept');
assert.equal(Array.isArray(concepts[1].parentIds), true);

assert.equal(relations.length, 2);
assert.equal(relations[0].fromId, '42');
assert.equal(relations[0].toId, 'child');
assert.equal(relations[0].type, 'related');
assert.equal(relations[0].sourceRefs[0].sourceId, 'source-a');
assert.equal(relations[0].confidence, 0.81);
assert.equal(relations[1].type, 'parent_child');
assert.equal(relations[1].sourceRefs[0].url, 'https://example.test');
assert.equal(relations[1].sourceRefs[0].page, 2);

store.addRelation('42', 'child', 'parent_child', [{ type: 'manual', sourceId: 'new-source' }]);
assert.equal(store.getRelations().length, 2);
assert.equal(store.getRelations()[1].sourceRefs.length, 2);

console.log(JSON.stringify({
  concepts: concepts.length,
  relations: relations.length,
  cleanedSourceRefs: concepts[0].sourceRefs.length,
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
