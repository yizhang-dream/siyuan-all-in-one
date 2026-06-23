import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_source_refs_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { formatSourceLabel, formatSourceText, getSourceAction, sourceLocatorText } from '../src/libs/source-refs';

const urlRef = { type: 'url' as const, url: 'https://example.test/page', quote: '网页证据' };
assert.equal(formatSourceLabel(urlRef), 'URL · https://example.test/page');
assert.equal(formatSourceText(urlRef), '网页证据');
assert.equal(getSourceAction(urlRef).kind, 'open-url');
assert.equal(getSourceAction(urlRef).target, 'https://example.test/page');

const siyuanRef = { type: 'siyuan' as const, blockId: '20260620123456-abcdefg', quote: '思源块内容' };
assert.equal(getSourceAction(siyuanRef).kind, 'open-siyuan-block');
assert.equal(getSourceAction(siyuanRef).target, '20260620123456-abcdefg');

const ragRef = {
  type: 'rag' as const,
  sourceId: 'rag-1',
  chunkId: 'chunk-2',
  page: 8,
  quote: 'RAG 搜索片段',
};
const action = getSourceAction(ragRef);
assert.equal(action.kind, 'open-rag');
assert.match(action.copyText || '', /sourceId=rag-1/);
assert.match(action.copyText || '', /chunkId=chunk-2/);
assert.match(sourceLocatorText(ragRef), /quote=RAG 搜索片段/);

console.log(JSON.stringify({
  urlAction: getSourceAction(urlRef).kind,
  siyuanAction: getSourceAction(siyuanRef).kind,
  openNotebookAction: action.kind,
  openNotebookLocator: 'rag-source',
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
