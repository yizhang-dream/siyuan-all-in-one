import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_parsers_smoke_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

function findAny(ext, ...dirs) {
  for (const dir of dirs) {
    try {
      const entries = readdirSync(dir, { recursive: true });
      for (const e of entries) {
        const full = path.join(dir, e);
        if (full.toLowerCase().endsWith(ext) && existsSync(full)) {
          try { const s = require('fs').statSync(full); if (s.size > 1000) return full; } catch (_) {}
        }
      }
    } catch (_) {}
  }
  return null;
}

const STATIC_FILES = {
  txt: 'C:/Users/zyz/Downloads/input.txt',
  md: 'C:/Users/zyz/Downloads/index.md',
  pdf: 'C:/Users/zyz/Documents/calcu_hw2.pdf',
  xlsx: 'C:/Users/zyz/Documents/canvas_offline/files/0/105686_1730357401_322__Q5_HW_9-2.xlsx',
  png: 'C:/Users/zyz/zhihu_posts.png',
  jpg: 'C:/Users/zyz/.cache/opencode/packages/oh-my-opencode-slim@latest/node_modules/exif-parser/test/starfish.jpg',
};

const BONUS_SEARCH = {
  docx: { ext: '.docx', dirs: ['C:/Users/zyz/.qq-chat-exporter/resources/files', 'C:/Users/zyz/Downloads'] },
  pptx: { ext: '.pptx', dirs: ['C:/Users/zyz/.cache/codex-runtimes', 'C:/Users/zyz/Downloads'] },
  epub: { ext: '.epub', dirs: ['C:/Users/zyz/.qq-chat-exporter/resources/files'] },
};

console.log('=== Scanning for test files ===');
const files = {};
for (const [key, filePath] of Object.entries(STATIC_FILES)) {
  if (existsSync(filePath)) {
    files[key] = filePath;
    console.log('  found: ' + key + ' => ' + filePath);
  } else {
    console.log('  MISSING: ' + key + ' => ' + filePath);
  }
}
for (const [key, spec] of Object.entries(BONUS_SEARCH)) {
  const found = findAny(spec.ext, ...spec.dirs);
  if (found) {
    files[key] = found;
    console.log('  found: ' + key + ' => ' + found);
  } else {
    console.log('  MISSING: ' + key);
  }
}

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

// ESM shim for CJS 'xlsx' to avoid "Dynamic require of stream" bundling error
const xlsxShim = path.join(tempDir, 'xlsx_shim.mjs');
await writeFile(xlsxShim, [
  "import { createRequire } from 'module';",
  "const req = createRequire(import.meta.url);",
  "const xlsx = req('xlsx');",
  "export default xlsx;",
  "export const {",
  "  readFile, read, write, writeFile, writeFileSync, utils, SSF, stream, CFB,",
  "  version, parse_xlscfb, parse_zip",
  "} = xlsx;",
].join('\n'), 'utf8');

const fixtureBody = `
import assert from 'node:assert/strict';

// pdfjs-dist v4+ needs DOMMatrix in Node — polyfill it
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      if (init) Object.assign(this, init);
      this.a = init?.a ?? 1; this.b = init?.b ?? 0;
      this.c = init?.c ?? 0; this.d = init?.d ?? 1;
      this.e = init?.e ?? 0; this.f = init?.f ?? 0;
    }
  };
}


import { TxtMdHtmlParser, PdfParser, XlsxParser, ImageOcrParser } from '../src/libs/parsers/index';

const FILES = ${JSON.stringify(files)};

const results = [];

async function testParser(name, ParserClass, fileKey, opts = {}) {
  const result = { name, fileKey, status: 'UNKNOWN', error: null, preview: null };
  const filePath = FILES[fileKey];
  if (!filePath) {
    result.status = 'SKIPPED';
    result.error = 'No test file available';
    results.push(result);
    return;
  }
  try {
    const parser = new ParserClass();
    const out = await parser.parse(filePath);
    assert.ok(out && typeof out.text === 'string', 'Missing text output');
    assert.ok(out.text.length > 0, 'Empty text output');
    result.status = 'PASS';
    result.preview = out.text.slice(0, 200);
    result.textLen = out.text.length;
    result.metadata = out.metadata;
  } catch (e) {
    result.status = 'FAIL';
    result.error = e.message || String(e);
    result.stack = e.stack?.split('\\n').slice(0, 6).join('\\n');
  }
  results.push(result);
}

async function main() {
  // --- TxtMdHtmlParser ---
  await testParser('TxtMdHtmlParser (.txt)', TxtMdHtmlParser, 'txt');
  await testParser('TxtMdHtmlParser (.md)', TxtMdHtmlParser, 'md');

  // --- PdfParser ---
  await testParser('PdfParser (.pdf)', PdfParser, 'pdf');

  // --- XlsxParser ---
  await testParser('XlsxParser (.xlsx)', XlsxParser, 'xlsx');

  // --- ImageOcrParser ---
  await testParser('ImageOcrParser (.png)', ImageOcrParser, 'png');
  await testParser('ImageOcrParser (.jpg)', ImageOcrParser, 'jpg', { slow: true });

  // --- PandocParser (SKIPPED — requires SiYuan API) ---
  const pandocExts = ['.docx', '.doc', '.pptx', '.ppt', '.epub', '.odt', '.rtf', '.org', '.rst', '.tex'];
  for (const ext of pandocExts) {
    const key = ext.replace('.', '');
    const found = FILES[key] ? ' (file found)' : ' (no file)';
    results.push({
      name: 'PandocParser (' + ext + ')',
      fileKey: key,
      status: 'SKIPPED',
      error: 'Requires SiYuan Pandoc API (PUT /api/file/putFile + /api/convert/pandoc)' + found,
    });
  }

  // --- SiyuanDocParser (SKIPPED — requires SiYuan API) ---
  results.push({
    name: 'SiyuanDocParser',
    fileKey: null,
    status: 'SKIPPED',
    error: 'Requires SiYuan API (POST /api/query/sql). Use parseSiyuanDoc(docId) instead of parse().',
  });

  // --- Print report ---
  console.log('\\n=== PARSER SMOKE TEST RESULTS ===');
  let pass = 0, fail = 0, skip = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? 'PASS'
      : r.status === 'FAIL' ? 'FAIL'
      : 'SKIP';
    console.log('[' + icon + '] ' + r.name);
    if (r.status === 'PASS') {
      pass++;
      console.log('       text length: ' + r.textLen + ', metadata: ' + JSON.stringify(r.metadata));
      console.log('       preview: ' + JSON.stringify(r.preview));
    } else if (r.status === 'FAIL') {
      fail++;
      console.log('       ERROR: ' + r.error);
      if (r.stack) console.log('       STACK: ' + r.stack);
    } else {
      skip++;
      console.log('       REASON: ' + r.error);
    }
  }
  console.log('\\nSummary: ' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');

  if (fail > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('FATAL:', e.message || e);
  console.error(e.stack);
  process.exit(1);
});
`;

await writeFile(entry, fixtureBody, 'utf8');

console.log('\n=== Bundling parsers with esbuild ===');
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile,
  external: ['siyuan', 'tesseract.js'],
  plugins: [
    {
      name: 'alias-xlsx',
      setup(build) {
        build.onResolve({ filter: /^xlsx$/ }, () => ({ path: xlsxShim }));
      },
    },
    {
      name: 'pdfjs-legacy',
      setup(build) {
        build.onResolve({ filter: /^pdfjs-dist$/ }, () => {
          return { path: path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs') };
        });
      },
    },
  ],
  logLevel: 'silent',
});
console.log('  bundle complete: ' + outfile);

try {
  console.log('\n=== Running tests ===\n');
  await import(pathToFileURL(outfile).href);
  console.log('\ntest_parsers_smoke: ALL PASSED ✅');
} catch (e) {
  console.error('\ntest_parsers_smoke: FAILED ❌');
  console.error(e.message || e);
  process.exit(1);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
