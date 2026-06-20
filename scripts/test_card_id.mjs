import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_card_id_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { extractCardIdFromText, stripCardIdFromText } from '../src/libs/card-id';

assert.equal(extractCardIdFromText('Question #c1a2b3c4d5e6f789'), 'c1a2b3c4d5e6f789');
assert.equal(extractCardIdFromText('Question #clx9zzzzzz'), 'clx9zzzzzz');
assert.equal(extractCardIdFromText('Question #canki:123-abc'), 'canki:123-abc');
assert.equal(extractCardIdFromText('Question #tag in the middle'), null);
assert.equal(stripCardIdFromText('Question #clx9zzzzzz'), 'Question');

console.log(JSON.stringify({
  hex: extractCardIdFromText('Question #c1a2b3c4d5e6f789'),
  base36: extractCardIdFromText('Question #clx9zzzzzz'),
  stripped: stripCardIdFromText('Question #clx9zzzzzz'),
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
