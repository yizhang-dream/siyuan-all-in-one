import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_source_store_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { SourceStore } from '../src/libs/source-store';

const mockPlugin = {
  data: {} as Record<string, any>,
  async loadData(key: string) { return this.data[key] || null; },
  async saveData(key: string, value: any) { this.data[key] = value; },
};

async function test() {
  const store = new SourceStore(mockPlugin);
  await store.load();

  // Test add
  store.add({
    id: 'test-1',
    title: 'Test Source',
    type: 'file',
    content: 'hello world',
    metadata: { addedAt: Date.now() },
    whereUsed: { rag: false, generate: false, concepts: false, usageCount: 0 },
    chunkStatus: 'done',
    retryCount: 0,
  });
  assert.equal(store.getAll().length, 1, 'Should have 1 source');

  // Test getById
  const s = store.getById('test-1');
  assert.equal(s?.title, 'Test Source', 'Should find by id');

  // Test save/load cycle
  await store.save();
  const store2 = new SourceStore(mockPlugin);
  await store2.load();
  assert.equal(store2.getAll().length, 1, 'Should persist across instances');

  // Test remove
  store.remove('test-1');
  assert.equal(store.getAll().length, 0, 'Should be empty');

  // Test trackUsage
  store.add({
    id: 'test-2', title: 'T2', type: 'url', content: 'x',
    metadata: { addedAt: Date.now() },
    whereUsed: { rag: false, generate: false, concepts: false, usageCount: 0 },
    chunkStatus: 'done', retryCount: 0,
  });
  store.trackUsage('test-2', 'rag');
  const s2 = store.getById('test-2');
  assert.equal(s2?.whereUsed.rag, true, 'Should track rag');
  assert.equal(s2?.whereUsed.usageCount, 1, 'Should count');

  // Test getByHash
  store.add({
    id: 'test-3', title: 'Hashed', type: 'file', content: 'unique',
    contentHash: 'abc123', metadata: { addedAt: Date.now() },
    whereUsed: { rag: false, generate: false, concepts: false, usageCount: 0 },
    chunkStatus: 'done', retryCount: 0,
  });
  assert.equal(store.getByHash('abc123')?.id, 'test-3', 'Should find by hash');

  console.log(JSON.stringify({
    allCount: store.getAll().length,
    foundById: s?.title,
    persisted: store2.getAll().length,
    removed: store.getAll().length,
    trackedRag: s2?.whereUsed.rag,
    usageCount: s2?.whereUsed.usageCount,
    foundByHash: store.getByHash('abc123')?.id,
  }, null, 2));
}

test().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
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
  console.log('test_source_store: ALL PASSED ✅');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
