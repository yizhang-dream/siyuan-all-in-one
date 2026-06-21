import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_source_adapter_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { fetchOpenNotebookPipelineSources, openNotebookResultsToPipelineSources } from '../src/libs/ai/source-adapters';
import { siyuanDocsToPipelineSources } from '../src/libs/ai/siyuan-source-adapters';
import { normalizeOpenNotebookSearchResults, type SearchResult } from '../src/libs/notebook';

const results: SearchResult[] = [
  {
    id: 'chunk-1',
    parentId: 'source-1',
    sourceId: 'source-1',
    chunkId: 'chunk-1',
    title: 'SM-2 算法笔记',
    content: 'SM-2 根据回答质量调整复习间隔。',
    score: 0.91,
    url: 'https://example.test/sm2',
    page: 3,
  },
  {
    id: 'chunk-1',
    parentId: 'source-1',
    title: '重复 chunk',
    content: 'SM-2 根据回答质量调整复习间隔。',
  },
  {
    id: 'chunk-2',
    title: '空内容',
    content: '   ',
  },
  {
    id: 'chunk-3',
    parentId: 'source-2',
    sourceId: 'source-2',
    chunkId: 'chunk-3',
    title: '字段漂移',
    content: '',
    text: 'OpenNotebook 的不同版本可能返回 text 字段。',
    metadata: { url: 'https://example.test/text', page: 7 },
    relevance: 0.72,
  },
  {
    id: 'chunk-4',
    parentId: 'source-3',
    title: '长内容',
    content: 'A'.repeat(1200),
  },
];

const sources = openNotebookResultsToPipelineSources(results, 'SM-2', { maxCharsPerSource: 800 });

assert.equal(sources.length, 3);
assert.equal(sources[0].id, 'on-chunk-1');
assert.equal(sources[0].type, 'opennotebook');
assert.equal(sources[0].sourceId, 'source-1');
assert.equal(sources[0].chunkId, 'chunk-1');
assert.equal(sources[0].quote, 'SM-2 根据回答质量调整复习间隔。');
assert.equal(sources[0].url, 'https://example.test/sm2');
assert.equal(sources[0].page, 3);
assert.match(sources[0].text, /# SM-2 算法笔记/);
assert.match(sources[0].text, /Query: SM-2/);
assert.match(sources[0].text, /Score: 0.91/);

assert.equal(sources[1].sourceId, 'source-2');
assert.equal(sources[1].chunkId, 'chunk-3');
assert.equal(sources[1].url, 'https://example.test/text');
assert.match(sources[1].text, /OpenNotebook 的不同版本可能返回 text 字段。/);

assert.equal(sources[2].sourceId, 'source-3');
assert.equal(sources[2].text.includes('A'.repeat(801)), false);

const drifted = normalizeOpenNotebookSearchResults({
  results: {
    items: [
      {
        node_id: 'node-1',
        page_content: 'Nested wrapper content from a vector store.',
        score: '0.83',
        page_number: '12',
        source: { id: 'src-nested', title: 'Nested Source', url: 'https://example.test/nested' },
      },
      {
        chunk: { id: 'chunk-nested', text: 'Chunk object text.' },
        document: { title: 'Document title', content: 'Document fallback content.', source_id: 'doc-source' },
        metadata: { page_number: 4 },
      },
    ],
  },
});

assert.equal(drifted.length, 2);
assert.equal(drifted[0].id, 'node-1');
assert.equal(drifted[0].sourceId, 'src-nested');
assert.equal(drifted[0].title, 'Nested Source');
assert.equal(drifted[0].content, 'Nested wrapper content from a vector store.');
assert.equal(drifted[0].score, 0.83);
assert.equal(drifted[0].page, 12);
assert.equal(drifted[0].url, 'https://example.test/nested');
assert.equal(drifted[1].id, 'chunk-nested');
assert.equal(drifted[1].sourceId, 'doc-source');
assert.equal(drifted[1].title, 'Document title');
assert.equal(drifted[1].content, 'Chunk object text.');

let searchBody: any = null;
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  if (url.endsWith('/api/sources/source-1')) {
    return new Response(JSON.stringify({
      id: 'source-1',
      title: 'Selected source detail',
      full_text: 'Direct source detail content should work without a search query.',
    }), { status: 200 });
  }
  if (url.endsWith('/api/notes/note-1')) {
    return new Response(JSON.stringify({
      id: 'note-1',
      title: 'Selected note detail',
      content: 'Direct note detail content should seed concept and card candidates.',
    }), { status: 200 });
  }
  if (url.endsWith('/api/search')) {
    searchBody = JSON.parse(init.body || '{}');
    return new Response(JSON.stringify({
      results: [],
    }), { status: 200 });
  }
  return new Response(JSON.stringify({ results: [] }), { status: 200 });
};

const selectedSourceOnly = await fetchOpenNotebookPipelineSources({
  endpoint: 'http://localhost:5055',
  query: '',
  sourceIds: ['source-1'],
  limit: 2,
  searchType: 'text',
});

assert.equal(selectedSourceOnly.length, 1);
assert.equal(selectedSourceOnly[0].sourceId, 'source-1');
assert.equal(selectedSourceOnly[0].chunkId, 'source-1');
assert.match(selectedSourceOnly[0].text, /# Selected source detail/);
assert.match(selectedSourceOnly[0].text, /without a search query/);

const scopedNoteSources = await fetchOpenNotebookPipelineSources({
  endpoint: 'http://localhost:5055',
  query: 'selected note',
  noteIds: ['note-1'],
  limit: 2,
  searchType: 'text',
});

assert.equal(searchBody.query, 'selected note');
assert.equal(scopedNoteSources.length, 1);
assert.equal(scopedNoteSources[0].sourceId, 'note-1');
assert.equal(scopedNoteSources[0].chunkId, 'note-1');
assert.match(scopedNoteSources[0].text, /# Selected note detail/);
assert.match(scopedNoteSources[0].text, /Direct note detail content should seed/i);

const siyuanSources = siyuanDocsToPipelineSources([
  {
    id: '20260620120000-abcdefg',
    title: '冲量与动量',
    content: '冲量定理说明合外力的冲量等于动量变化。\\n\\n'.repeat(40),
  },
  {
    id: '20260620120000-abcdefg',
    title: '重复文档',
    content: '重复内容应被去重。',
  },
  {
    id: 'empty-doc',
    title: '空文档',
    content: '   ',
  },
], { maxCharsPerDoc: 900 });

assert.equal(siyuanSources.length, 1);
assert.equal(siyuanSources[0].type, 'siyuan');
assert.equal(siyuanSources[0].sourceId, '20260620120000-abcdefg');
assert.equal(siyuanSources[0].blockId, '20260620120000-abcdefg');
assert.equal(siyuanSources[0].chunkId, '20260620120000-abcdefg');
assert.match(siyuanSources[0].text, /# 冲量与动量/);
assert.match(siyuanSources[0].text, /SiYuan blockId: 20260620120000-abcdefg/);
assert.equal(siyuanSources[0].text.includes('冲量定理'.repeat(100)), false);

console.log(JSON.stringify({
  pipelineSources: sources.length,
  selectedSourceOnly: selectedSourceOnly.length,
  scopedNoteSources: scopedNoteSources.length,
  siyuanSources: siyuanSources.length,
  sourceType: sources[0].type,
  sourceId: sources[0].sourceId,
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
