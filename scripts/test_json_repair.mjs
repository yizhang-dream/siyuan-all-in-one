import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_json_repair_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { parseLLMJSON } from '../src/libs/llm';

const object = parseLLMJSON([
  '当然，下面是 JSON：',
  String.fromCharCode(96, 96, 96) + 'json',
  '{',
  '  // 模型偶尔会加注释',
  "  concepts: [",
  "    { tempId: 'c1', title: '间隔重复', confidence: 0.9, },",
  '  ],',
  '  warnings: [],',
  '}',
  String.fromCharCode(96, 96, 96),
].join('\\n'), 'object');

assert.equal(object.concepts[0].tempId, 'c1');
assert.equal(object.concepts[0].title, '间隔重复');
assert.equal(object.concepts[0].confidence, 0.9);

const array = parseLLMJSON([
  '[',
  "  {'question':'什么是 SM-2？','answer':'间隔重复算法',},",
  ']',
].join('\\n'), 'array');

assert.equal(array.length, 1);
assert.equal(array[0].question, '什么是 SM-2？');

const fullWidth = parseLLMJSON(\`{"cards"：[{"front":"A"，“back”:"B"，}],}\`, 'object');
assert.equal(fullWidth.cards[0].front, 'A');
assert.equal(fullWidth.cards[0].back, 'B');

const pythonLiterals = parseLLMJSON("{concepts:[{title:'True 值不是布尔', enabled: True, note: None}]}", 'object');
assert.equal(pythonLiterals.concepts[0].title, 'True 值不是布尔');
assert.equal(pythonLiterals.concepts[0].enabled, true);
assert.equal(pythonLiterals.concepts[0].note, null);

const mixedFragments = parseLLMJSON([
  'I first drafted the shape below, but it is not final:',
  "{concepts:[{tempId:'draft', title:'broken', confidence: ???, note:'ignore this longer invalid candidate'}]}",
  'Final JSON:',
  '{"concepts":[{"tempId":"ok","title":"Stable output","confidence":0.82}]}',
].join('\\n'), 'object');
assert.equal(mixedFragments.concepts[0].tempId, 'ok');
assert.equal(mixedFragments.concepts[0].confidence, 0.82);

const bracesInString = parseLLMJSON(
  '{"items":[{"text":"keep {braces} and [brackets] inside strings","enabled":False}]}',
  'object'
);
assert.equal(bracesInString.items[0].text, 'keep {braces} and [brackets] inside strings');
assert.equal(bracesInString.items[0].enabled, false);

const multilineString = parseLLMJSON([
  '{',
  '  cards: [',
  '    {',
  "      front: 'Why does the impulse-momentum theorem matter?',",
  '      back: "It connects force over time',
  'to change in momentum.",',
  '      confidence: NaN,',
  '    }',
  '  ]',
  '}',
].join('\\n'), 'object');
assert.equal(multilineString.cards[0].back, 'It connects force over time\\nto change in momentum.');
assert.equal(multilineString.cards[0].confidence, null);

console.log(JSON.stringify({
  repairedObjectConcepts: object.concepts.length,
  repairedArrayCards: array.length,
  repairedFullWidthCards: fullWidth.cards.length,
  repairedPythonLiterals: pythonLiterals.concepts.length,
  recoveredMixedFragments: mixedFragments.concepts.length,
  keptBracesInString: bracesInString.items.length,
  repairedMultilineStrings: multilineString.cards.length,
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
