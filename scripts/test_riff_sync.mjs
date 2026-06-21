import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_riff_sync_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { auditRiffSyncProjection, cardToRiffMarkdown, ensureRiffDeck, syncCardsToSiyuanRiff } from '../src/libs/riff-sync';
import { calls } from 'siyuan';

const card: any = {
  id: 'card-1',
  question: 'What is impulse?',
  answer: 'Change in momentum.\\nJ = Δp',
  hint: 'Momentum theorem',
  deck: 'Physics',
  tags: ['mechanics'],
  cardType: 'qa',
  conceptId: 'concept-1',
  sourceRefs: [{ type: 'manual', quote: 'Impulse equals change in momentum.' }],
  due: 0,
  interval: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  status: 'new',
  created: 1,
  modified: 2,
};

const markdown = cardToRiffMarkdown(card);
assert.match(markdown, /\\*\\*Q:\\*\\* What is impulse\\?/);
assert.match(markdown, /==A: Change in momentum\\.<br>J = Δp==/);
assert.match(markdown, /concept=concept-1/);

const existingDeck = await ensureRiffDeck('Existing');
assert.equal(existingDeck.id, 'deck-existing');

const result = await syncCardsToSiyuanRiff([card], { deckName: 'New Deck', docTitle: 'Physics Sync' });
assert.equal(result.docId, '20260621120000-docid');
assert.equal(result.deck.id, 'deck-new');
assert.deepEqual(result.blockIds, ['20260621120000-block1']);
assert.equal(result.createdRecords[0].cardId, 'card-1');
assert.equal(result.createdRecords[0].blockId, '20260621120000-block1');
assert.equal(result.nextRecords.length, 1);

const endpoints = calls.map((call) => call.endpoint);
assert.ok(endpoints.includes('/api/filetree/createDocWithMd'));
assert.ok(endpoints.includes('/api/block/insertBlock'));
assert.ok(endpoints.includes('/api/attr/setBlockAttrs'));
assert.ok(endpoints.includes('/api/riff/addRiffCards'));

const attrCall = calls.find((call) => call.endpoint === '/api/attr/setBlockAttrs');
assert.equal(attrCall.payload.attrs['custom-aio-card-id'], 'card-1');
assert.equal(attrCall.payload.attrs['custom-aio-concept-id'], 'concept-1');
assert.match(attrCall.payload.attrs['custom-aio-source-refs'], /Impulse equals/);

calls.length = 0;
const skipped = await syncCardsToSiyuanRiff([card], { deckName: 'New Deck', existingRecords: result.nextRecords });
assert.equal(skipped.docId, '');
assert.equal(skipped.deck, null);
assert.deepEqual(skipped.blockIds, []);
assert.deepEqual(skipped.updatedBlockIds, []);
assert.deepEqual(skipped.skippedCardIds, ['card-1']);
assert.equal(skipped.nextRecords.length, 1);
assert.deepEqual(calls.map((call) => call.endpoint), []);

calls.length = 0;
const editedCard = { ...card, answer: 'Force integrated over time.', modified: 3 };
const updated = await syncCardsToSiyuanRiff([editedCard], { deckName: 'New Deck', existingRecords: result.nextRecords });
assert.equal(updated.docId, '');
assert.equal(updated.deck, null);
assert.deepEqual(updated.blockIds, []);
assert.deepEqual(updated.updatedBlockIds, ['20260621120000-block1']);
assert.equal(updated.updatedRecords[0].cardModified, 3);
assert.equal(updated.nextRecords[0].cardModified, 3);
assert.deepEqual(calls.map((call) => call.endpoint), ['/api/block/updateBlock', '/api/attr/setBlockAttrs']);
assert.match(calls[0].payload.data, /Force integrated over time/);

const audit = auditRiffSyncProjection([
  { ...card, modified: 3 },
  { ...card, id: 'card-stale', question: 'What is work?', answer: 'Force over displacement.', modified: 9 },
  { ...card, id: 'card-unsynced', question: 'What is force?', answer: 'Rate of momentum change.', modified: 1 },
  { ...card, id: 'empty-card', answer: '', modified: 1 },
], [
  ...updated.nextRecords,
  {
    cardId: 'card-stale',
    blockId: '20260621120000-stale',
    deckId: 'deck-new',
    deckName: 'New Deck',
    docId: '20260621120000-docid',
    syncedAt: 5,
    cardModified: 5,
  },
  {
    cardId: 'orphan-card',
    blockId: '20260621120000-orphan',
    deckId: 'deck-new',
    deckName: 'New Deck',
    docId: '20260621120000-docid',
    syncedAt: 5,
    cardModified: 5,
  },
], 'New Deck');

assert.equal(audit.totalCards, 4);
assert.equal(audit.eligibleCards, 3);
assert.equal(audit.records, 3);
assert.equal(audit.fresh, 1);
assert.equal(audit.stale, 1);
assert.equal(audit.unsynced, 1);
assert.equal(audit.orphanRecords, 1);
assert.deepEqual(audit.entries.map((entry) => entry.status).sort(), ['fresh', 'orphan', 'stale', 'unsynced']);

export default true;
`, 'utf8');

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  plugins: [{
    name: 'stub-siyuan',
    setup(build) {
      build.onResolve({ filter: /^siyuan$/ }, () => ({ path: 'siyuan-stub', namespace: 'stub' }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: `
export const calls = [];
let blockSeq = 0;
export async function fetchSyncPost(endpoint, payload) {
  calls.push({ endpoint, payload });
  if (endpoint === '/api/notebook/lsNotebooks') return { code: 0, data: { notebooks: [{ id: 'nb-1', name: '知识闪卡' }] } };
  if (endpoint === '/api/filetree/createDocWithMd') return { code: 0, data: '/20260621120000-docid' };
  if (endpoint === '/api/block/insertBlock') {
    blockSeq += 1;
    return { code: 0, data: { operations: [{ id: '20260621120000-block' + blockSeq }] } };
  }
  if (endpoint === '/api/block/updateBlock') return { code: 0, data: { operations: [{ id: payload.id }] } };
  if (endpoint === '/api/attr/setBlockAttrs') return { code: 0, data: {} };
  if (endpoint === '/api/riff/getRiffDecks') return { code: 0, data: [{ id: 'deck-existing', name: 'Existing', size: 3 }] };
  if (endpoint === '/api/riff/createRiffDeck') return { code: 0, data: { id: 'deck-new', name: payload.name, size: 0 } };
  if (endpoint === '/api/riff/addRiffCards') return { code: 0, data: { id: payload.deckID, name: 'New Deck', size: payload.blockIDs.length } };
  return { code: 0, data: {} };
}
export function openTab() {}
`,
        loader: 'js',
      }));
    },
  }],
  logLevel: 'silent',
});

try {
  await import(pathToFileURL(outfile).href);
  console.log(JSON.stringify({
    markdown: true,
    deckReuse: true,
    sync: true,
    attrs: true,
    duplicateSkip: true,
    staleUpdate: true,
    projectionAudit: true,
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
