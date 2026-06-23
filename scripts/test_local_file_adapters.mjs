import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_local_file_adapter_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { localTextFilesToPipelineSources, normalizeLocalFileText, splitTextIntoChunks } from '../src/libs/sources/local-file-adapters';

const htmlText = normalizeLocalFileText({
  name: 'lesson.html',
  type: 'text/html',
  text: '<html><head><style>.x{}</style><script>bad()</script></head><body><h1>Title &amp; Topic</h1><p>Alpha&nbsp;Beta</p><ul><li>First</li><li>Second</li></ul></body></html>',
});

assert.match(htmlText, /Title & Topic/);
assert.match(htmlText, /Alpha Beta/);
assert.match(htmlText, /First/);
assert.doesNotMatch(htmlText, /style|script|bad/);

const chunks = splitTextIntoChunks(['A'.repeat(1200), 'B'.repeat(1200), 'C'.repeat(1200)].join('\\n\\n'), 1500);
assert.equal(chunks.length, 3);
assert.ok(chunks.every((chunk) => chunk.length <= 1500));

const sources = localTextFilesToPipelineSources([
  {
    name: 'bad:/name?.md',
    type: 'text/markdown',
    text: '# Heading\\n\\nSpaced repetition uses expanding intervals.',
  },
  {
    name: 'lesson.html',
    type: 'text/html',
    text: '<h1>Physics</h1><p>Impulse equals change in momentum.</p>',
  },
], { maxCharsPerChunk: 1000 });

assert.equal(sources.length, 2);
assert.equal(sources[0].type, 'source');
assert.equal(sources[0].sourceId, 'bad_name_.md');
assert.equal(sources[0].chunkId, 'bad_name_.md#1');
assert.match(sources[0].text, /# bad_name_\\.md/);
assert.match(sources[0].text, /Spaced repetition/);
assert.equal(sources[1].sourceId, 'lesson.html');
assert.match(sources[1].text, /Impulse equals change in momentum/);
assert.doesNotMatch(sources[1].text, /<p>/);

console.log(JSON.stringify({
  html: true,
  chunks: chunks.length,
  sources: sources.length,
  sourceType: sources[0].type,
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
