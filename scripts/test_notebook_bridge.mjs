import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_notebook_bridge_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { buildNotebookConceptRequest } from '../src/libs/notebook-bridge';

const scoped = buildNotebookConceptRequest({
  inputText: '请解释 SM-2 并生成卡片',
  activeLocator: {
    sourceId: 'source-1',
    chunkId: 'chunk-2',
    locatorText: 'sourceId=source-1 chunkId=chunk-2',
    quote: 'SM-2 是一种间隔重复调度算法',
  },
  sourceModes: {
    'source-1': 'full',
    'source-2': 'off',
    'source-3': 'insights',
  },
  noteModes: {
    'note-1': 'full',
    'note-2': 'off',
  },
});

assert.ok(scoped);
assert.equal(scoped.query, 'SM-2 是一种间隔重复调度算法');
assert.deepEqual(scoped.sourceIds, ['source-1', 'source-3']);
assert.deepEqual(scoped.noteIds, ['note-1']);
assert.match(scoped.sourceLabel || '', /sources: source-1, source-3/);
assert.match(scoped.sourceLabel || '', /notes: note-1/);
assert.equal(scoped.autoRun, true);

const fallback = buildNotebookConceptRequest({
  inputText: '',
  sourceModes: {},
  fallbackSourceId: 'source-x',
  autoRun: false,
});
assert.ok(fallback);
assert.equal(fallback.query, 'sources source-x');
assert.deepEqual(fallback.sourceIds, ['source-x']);
assert.deepEqual(fallback.noteIds, []);
assert.equal(fallback.autoRun, false);

const noteOnly = buildNotebookConceptRequest({
  inputText: '',
  sourceModes: {},
  noteModes: { 'note-x': 'full' },
});
assert.ok(noteOnly);
assert.equal(noteOnly.query, 'notes note-x');
assert.deepEqual(noteOnly.sourceIds, []);
assert.deepEqual(noteOnly.noteIds, ['note-x']);

const empty = buildNotebookConceptRequest({ inputText: '   ', sourceModes: {} });
assert.equal(empty, null);

console.log(JSON.stringify({
  scopedSources: scoped.sourceIds.length,
  scopedNotes: scoped.noteIds.length,
  fallbackSources: fallback.sourceIds.length,
  noteOnlyNotes: noteOnly.noteIds.length,
}, null, 2));
`, 'utf8');

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
});

try {
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
