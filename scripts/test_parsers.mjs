import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_parsers_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ParserRegistry, TxtMdHtmlParser } from '../src/libs/parsers/index';

const registry = new ParserRegistry();
registry.register(new TxtMdHtmlParser());

// Extension matching
assert.notEqual(registry.getParser('.txt'), undefined, 'Should find .txt');
assert.notEqual(registry.getParser('.md'), undefined, 'Should find .md');
assert.equal(registry.getParser('.xyz'), undefined, 'Should return undefined');

// Supported extensions
const exts = registry.getSupportedExtensions();
assert.ok(exts.includes('.txt'), 'Should include .txt');
assert.ok(exts.includes('.html'), 'Should include .html');

// TXT parsing
const tmpFile = path.join(os.tmpdir(), 'test-parser.txt');
fs.writeFileSync(tmpFile, 'Hello World\\n\\nSecond paragraph.');
const parser = registry.getParser('.txt')!;
const result = await parser.parse(tmpFile);
assert.ok(result.text.includes('Hello World'), 'Should parse text');
assert.ok(result.text.includes('Second paragraph'), 'Should preserve paragraphs');
assert.equal(result.metadata.format, 'txt', 'Should have format metadata');
fs.unlinkSync(tmpFile);

console.log(JSON.stringify({
  foundTxt: registry.getParser('.txt') !== undefined,
  foundMd: registry.getParser('.md') !== undefined,
  foundXyz: registry.getParser('.xyz') === undefined,
  extsCount: exts.length,
  parsedText: result.text.length,
  format: result.metadata.format,
}, null, 2));
`, 'utf8');

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  external: ['siyuan', 'tesseract.js'],
  logLevel: 'silent',
});

try {
  await import(pathToFileURL(outfile).href);
  console.log('test_parsers: ALL PASSED ✅');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
