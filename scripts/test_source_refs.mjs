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
import { buildOpenNotebookLocator, formatSourceLabel, formatSourceText, getSourceAction, sourceLocatorText } from '../src/libs/source-refs';

const urlRef = { type: 'url' as const, url: 'https://example.test/page', quote: '网页证据' };
assert.equal(formatSourceLabel(urlRef), 'URL · https://example.test/page');
assert.equal(formatSourceText(urlRef), '网页证据');
assert.equal(getSourceAction(urlRef).kind, 'open-url');
assert.equal(getSourceAction(urlRef).target, 'https://example.test/page');

const siyuanRef = { type: 'siyuan' as const, blockId: '20260620123456-abcdefg', quote: '思源块内容' };
assert.equal(getSourceAction(siyuanRef).kind, 'open-siyuan-block');
assert.equal(getSourceAction(siyuanRef).target, '20260620123456-abcdefg');

const openNotebookRef = {
  type: 'opennotebook' as const,
  sourceId: 'source-1',
  chunkId: 'chunk-2',
  page: 8,
  quote: 'OpenNotebook 片段',
};
const action = getSourceAction(openNotebookRef);
assert.equal(action.kind, 'open-opennotebook');
assert.match(action.copyText || '', /sourceId=source-1/);
assert.match(action.copyText || '', /chunkId=chunk-2/);
assert.match(action.copyText || '', /page=8/);
assert.match(sourceLocatorText(openNotebookRef), /quote=OpenNotebook 片段/);

const locator = buildOpenNotebookLocator(openNotebookRef);
assert.ok(locator);
assert.equal(locator.sourceId, 'source-1');
assert.equal(locator.chunkId, 'chunk-2');
assert.equal(locator.page, 8);
assert.equal(locator.locatorText, 'sourceId=source-1 chunkId=chunk-2 page=8');
assert.match(locator.prompt, /OpenNotebook/);
assert.match(locator.prompt, /sourceId=source-1/);
assert.equal(buildOpenNotebookLocator({ type: 'manual' as const, sourceId: 'manual-1' }), null);

console.log(JSON.stringify({
  urlAction: getSourceAction(urlRef).kind,
  siyuanAction: getSourceAction(siyuanRef).kind,
  openNotebookAction: action.kind,
  openNotebookLocator: locator.label,
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
