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

// SourceRef types after migration: siyuan-doc | manual | source
const siyuanRef = { type: 'siyuan-doc' as const, blockId: '20260620123456-abcdefg', quote: '思源块内容' };
assert.equal(getSourceAction(siyuanRef).kind, 'open-siyuan-block');
assert.equal(getSourceAction(siyuanRef).target, '20260620123456-abcdefg');

const sourceRef = {
  type: 'source' as const,
  sourceId: 'src-1',
  quote: '来源搜索片段',
};
assert.equal(formatSourceLabel(sourceRef), '来源库 · src-1');
assert.equal(formatSourceText(sourceRef), '来源搜索片段');

const manualRef = { type: 'manual' as const, quote: '手动输入文本' };
assert.equal(formatSourceLabel(manualRef), '手动');
assert.equal(formatSourceText(manualRef), '手动输入文本');

console.log(JSON.stringify({
  siyuanAction: getSourceAction(siyuanRef).kind,
  sourceLabel: formatSourceLabel(sourceRef),
  manualLabel: formatSourceLabel(manualRef),
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
