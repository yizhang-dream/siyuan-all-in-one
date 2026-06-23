import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_source_hub_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { buildManualPipelineSource, collectPipelineSources, dedupePipelineSources } from '../src/libs/sources/source-hub';

const manual = buildManualPipelineSource('  Manual evidence about spaced repetition.  ');
assert.equal(manual.type, 'manual');
assert.equal(manual.sourceId, 'manual-1');
assert.equal(manual.text, 'Manual evidence about spaced repetition.');
assert.match(manual.quote || '', /Manual evidence/);

const deduped = dedupePipelineSources([
  manual,
  { ...manual },
  { ...manual, chunkId: 'manual-2', text: 'Manual evidence about spaced repetition.' },
]);
assert.equal(deduped.length, 2);

const calls: Array<{ url: string; body?: any }> = [];
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
  if (url.endsWith('/api/search')) {
    return new Response(JSON.stringify({
      results: [{
        id: 'on-hit-1',
        source_id: 'source-1',
        title: 'OpenNotebook hit',
        content: 'OpenNotebook text search result.',
      }],
      search_type: 'text',
    }), { status: 200 });
  }
  return new Response(JSON.stringify({}), { status: 200 });
};

const mixed = await collectPipelineSources({
  mode: 'mixed',
  manualText: 'Manual evidence about active recall.',
  siyuanDocs: [{ id: 'doc-1', title: 'SiYuan Doc' }],
  localFiles: [{
    name: 'local.html',
    type: 'text/html',
    text: '<h1>Local source</h1><p>Local HTML should become a file source.</p>',
  }],
});

assert.equal(mixed.stats.manual, 1);
assert.equal(mixed.stats.siyuanDoc, 1);
assert.equal(mixed.stats.source, 1);
assert.equal(mixed.stats.total, 3);
assert.ok(mixed.sources.some((source) => source.type === 'source' && source.sourceId === 'local.html'));

const manualOnlyIgnoresSiyuan = await collectPipelineSources({
  mode: 'manual',
  manualText: 'Only manual mode should ignore selected docs.',
  siyuanDocs: [{ id: 'doc-1', title: 'SiYuan Doc' }],
});
assert.equal(manualOnlyIgnoresSiyuan.sources.length, 1);
assert.equal(manualOnlyIgnoresSiyuan.stats.siyuanDoc, 0);

console.log(JSON.stringify({
  manual: true,
  dedupe: deduped.length,
  mixedSources: mixed.stats.total,
  fileSources: mixed.stats.file,
}, null, 2));
`, 'utf8');

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  external: ['onnxruntime-node', 'onnxruntime-web', '@xenova/transformers', 'canvas'],
  plugins: [{
    name: 'stub-siyuan',
    setup(build) {
      build.onResolve({ filter: /^siyuan$/ }, () => ({ path: 'siyuan-stub', namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: `
export async function fetchSyncPost(endpoint, payload) {
  if (endpoint === '/api/export/exportMdContent') {
    return { code: 0, data: { content: 'SiYuan document content for source hub testing.' } };
  }
  return { code: 0, data: {} };
}
`,
        loader: 'js',
      }));
    },
  }],
  logLevel: 'silent',
});

try {
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
