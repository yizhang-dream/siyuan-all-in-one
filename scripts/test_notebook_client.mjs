import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_notebook_client_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { OpenNotebookClient, NotebookError } from '../src/libs/notebook';

const calls: Array<{ url: string; method: string; body?: string }> = [];
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  calls.push({ url, method: init.method || 'GET', body: init.body });
  if (url.endsWith('/api/notebooks')) {
    return new Response(JSON.stringify({ items: [{ id: 'nb-1', name: 'Notebook A' }] }), { status: 200 });
  }
  if (url.includes('/api/sources?limit=100&notebook_id=notebook%3Acompat')) {
    return new Response(JSON.stringify({ detail: 'limit or notebook format rejected' }), { status: 422 });
  }
  if (url.includes('/api/sources?limit=100&notebook_id=compat')) {
    return new Response(JSON.stringify({ data: [{ id: 'source-compat', title: 'Source Compat' }] }), { status: 200 });
  }
  if (url.includes('/api/sources?')) {
    return new Response(JSON.stringify({ data: { records: [{ id: 'source-1', title: 'Source A' }] } }), { status: 200 });
  }
  if (url.endsWith('/api/search')) {
    const body = JSON.parse(init.body || '{}');
    if (body.type === 'vector') {
      return new Response('vector backend failed', { status: 500 });
    }
    return new Response(JSON.stringify({
      results: [{
        id: 'hit-1',
        source_id: 'source-1',
        title: 'Search Hit',
        content: 'Text fallback content.',
      }],
      search_type: body.type,
    }), { status: 200 });
  }
  if (url.endsWith('/api/models?type=language')) {
    return new Response(JSON.stringify({ models: [{ id: 'm1', type: 'language' }] }), { status: 200 });
  }
  if (url.endsWith('/api/chat/sessions/dead')) {
    return new Response(null, { status: 204 });
  }
  if (url.endsWith('/api/chat/context')) {
    return new Response(JSON.stringify({
      context: { ok: true },
      token_count: 123,
      char_count: 456,
    }), { status: 200 });
  }
  if (url.endsWith('/api/notes/note%201')) {
    return new Response(JSON.stringify({ id: 'note 1', title: 'Note One', content: 'Note body.' }), { status: 200 });
  }
  if (url.endsWith('/api/fail')) {
    return new Response('boom', { status: 503 });
  }
  return new Response(JSON.stringify([]), { status: 200 });
};

const client = new OpenNotebookClient('http://localhost:5055/api/');
const notebooks = await client.listNotebooks();
const sources = await client.listSources('notebook with spaces', 5);
const compatSources = await client.listSources('notebook:compat', 200);
const searchResults = await client.search('fallback search', { type: 'vector', limit: 2 });
const models = await client.getModels('language');
await client.deleteSession('dead');
const context = await client.buildContext('nb-1', ['source-1', 'source-2'], {
  sourceModes: {
    'source-1': 'full',
    'source-2': 'insights',
  },
  noteIds: ['note-1'],
  noteModes: {
    'note-1': 'full',
  },
});
const note = await client.getNote('note 1');

assert.equal(calls[0].url, 'http://localhost:5055/api/notebooks');
assert.equal(notebooks.length, 1);
assert.equal(notebooks[0].id, 'nb-1');
assert.match(calls[1].url, /notebook_id=notebook%20with%20spaces/);
assert.equal(sources.length, 1);
assert.equal(sources[0].id, 'source-1');
assert.ok(calls.some((call) => call.url.includes('/api/sources?limit=100&notebook_id=notebook%3Acompat')));
assert.ok(calls.some((call) => call.url.includes('/api/sources?limit=100&notebook_id=compat')));
assert.equal(compatSources.length, 1);
assert.equal(compatSources[0].id, 'source-compat');
const searchCalls = calls.filter((call) => call.url.endsWith('/api/search'));
assert.equal(searchCalls.length, 2);
assert.equal(JSON.parse(searchCalls[0].body || '{}').type, 'vector');
assert.equal(JSON.parse(searchCalls[1].body || '{}').type, 'text');
assert.equal(searchResults.length, 1);
assert.equal(searchResults[0].content, 'Text fallback content.');
assert.equal(models.length, 1);
assert.ok(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/api/chat/sessions/dead')));
assert.equal(context.tokenCount, 123);
assert.equal(context.charCount, 456);
assert.equal(note.id, 'note 1');
assert.equal(note.content, 'Note body.');
assert.ok(calls.some((call) => call.url.endsWith('/api/notes/note%201')));

const contextCall = calls.find((call) => call.url.endsWith('/api/chat/context'));
assert.ok(contextCall);
const contextBody = JSON.parse(contextCall.body || '{}');
assert.equal(contextBody.notebook_id, 'nb-1');
assert.equal(contextBody.context_config.sources['source-1'], 'full content');
assert.equal(contextBody.context_config.sources['source-2'], 'insights');
assert.equal(contextBody.context_config.notes['note-1'], 'full content');

await assert.rejects(
  () => client.request('GET', '/fail'),
  (err: any) => err instanceof NotebookError && err.status === 503 && err.message.includes('boom')
);

console.log(JSON.stringify({
  firstUrl: calls[0].url,
  notebooks: notebooks.length,
  sources: sources.length,
  compatSources: compatSources.length,
  searchFallbackCalls: searchCalls.length,
  models: models.length,
  deleteMethod: calls.find((call) => call.url.endsWith('/api/chat/sessions/dead'))?.method,
  contextSources: Object.keys(contextBody.context_config.sources).length,
  contextNotes: Object.keys(contextBody.context_config.notes).length,
  noteId: note.id,
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
