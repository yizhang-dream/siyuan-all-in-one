import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_render_math_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { escapeHTML, renderToHTML, toInlineMathText } from '../src/libs/render';
import { conceptsToMindmap } from '../src/libs/render/concept-mindmap';

assert.equal(escapeHTML('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');

const fallbackHtml = renderToHTML('Line 1\\n$E = mc^2$ and \\\\(a+b\\\\)');
assert.equal(fallbackHtml, '<p>Line 1 $E = mc^2$ and \\\\(a+b\\\\)</p>');
assert.match(fallbackHtml, /\\$E = mc\\^2\\$/);
assert.match(fallbackHtml, /\\\\\\(a\\+b\\\\\\)/);
assert.doesNotMatch(fallbackHtml, /<script|<img/i);

const markdownHtml = renderToHTML([
  '# Heading',
  '',
  '- **strong** item',
  '- \`code\` item',
  '',
  'See [link](https://example.test).',
].join('\\n'));
assert.match(markdownHtml, /<h1>Heading<\\/h1>/);
assert.match(markdownHtml, /<ul>/);
assert.match(markdownHtml, /<strong>strong<\\/strong>/);
assert.match(markdownHtml, /<code>code<\\/code>/);
assert.match(markdownHtml, /<a href="https:\\/\\/example\\.test"/);

(globalThis as any).window = {
  Lute: {
    Md2HTMLDOM(text: string) {
      return '<p data-lute="1">' + text + '</p>';
    },
  },
};
assert.equal(renderToHTML('x'), '<p data-lute="1">x</p>');
delete (globalThis as any).window;

assert.equal(toInlineMathText('\\\\[F = ma\\\\]'), '$F = ma$');
assert.equal(toInlineMathText('$$ F = ma $$'), '$F = ma$');
assert.equal(toInlineMathText('Use \\\\(a+b\\\\) now'), 'Use $a+b$ now');
assert.equal(toInlineMathText('A\\n\\nB'), 'A B');

const conceptMap = conceptsToMindmap(
  [
    {
      id: 'k1',
      title: 'Newton law \\\\(F = ma\\\\)',
      summary: 'Display formula \\\\[p = mv\\\\]',
      parentIds: [],
      childIds: [],
      relatedIds: [],
      cardIds: ['c1'],
      sourceRefs: [],
      tags: [],
      created: 1,
      modified: 1,
    },
  ],
  [],
  [
    {
      id: 'c1',
      question: 'What does \\\\[F = ma\\\\] mean?',
      answer: 'Force equals mass times acceleration.',
      hint: '',
      deck: 'physics',
      tags: [],
      due: 0,
      interval: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      status: 'new',
      created: 1,
      modified: 1,
      conceptId: 'k1',
      cardType: 'qa',
      sourceRefs: [],
    },
  ],
  'Formula Map'
);

assert.match(conceptMap.markdown, /Newton law \\$F = ma\\$/);
assert.match(conceptMap.markdown, /Display formula \\$p = mv\\$/);
assert.match(conceptMap.markdown, /What does \\$F = ma\\$ mean\\? #c1/);
assert.doesNotMatch(conceptMap.markdown, /\\n\\$\\$/);

console.log(JSON.stringify({
  escaped: true,
  fallbackMathPreserved: true,
  fallbackMarkdown: true,
  lutePreferred: true,
  inlineMindmapMath: true,
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
