import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_siyuan_riff_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import {
  addRiffCards,
  createRiffDeck,
  getRiffDecks,
  getRiffDueCards,
  reviewRiffCard,
  skipReviewRiffCard,
} from '../src/libs/siyuan-riff';
import { calls } from 'siyuan';

const decks = await getRiffDecks();
assert.equal(decks[0].id, 'deck-1');
assert.equal(decks[0].size, 2);

const created = await createRiffDeck('AI Cards');
assert.equal(created?.name, 'AI Cards');

const addResult = await addRiffCards('deck-1', ['block-1', 'block-2']);
assert.equal(addResult?.id, 'deck-1');
assert.deepEqual(calls.at(-1).payload.blockIDs, ['block-1', 'block-2']);

const due = await getRiffDueCards('deck-1', [{ cardID: 'card-old' }]);
assert.equal(due.cards[0].cardID, 'card-1');
assert.equal(due.cards[0].blockID, 'block-1');
assert.equal(due.unreviewedCount, 1);

await reviewRiffCard('deck-1', 'card-1', 3);
assert.equal(calls.at(-1).endpoint, '/api/riff/reviewRiffCard');
assert.equal(calls.at(-1).payload.rating, 3);

await skipReviewRiffCard('deck-1', 'card-1');
assert.equal(calls.at(-1).endpoint, '/api/riff/skipReviewRiffCard');

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
export async function fetchSyncPost(endpoint, payload) {
  calls.push({ endpoint, payload });
  if (endpoint === '/api/riff/getRiffDecks') return { code: 0, data: [{ id: 'deck-1', name: 'Default', size: 2 }] };
  if (endpoint === '/api/riff/createRiffDeck') return { code: 0, data: { id: 'deck-2', name: payload.name, size: 0 } };
  if (endpoint === '/api/riff/addRiffCards') return { code: 0, data: { id: payload.deckID, name: 'Default', size: payload.blockIDs.length } };
  if (endpoint === '/api/riff/getRiffDueCards') return { code: 0, data: { cards: [{ cardID: 'card-1', blockID: 'block-1', deckID: payload.deckID }], unreviewedCount: 1, unreviewedNewCardCount: 1, unreviewedOldCardCount: 0 } };
  return { code: 0, data: {} };
}
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
    decks: true,
    createDeck: true,
    addCards: true,
    dueCards: true,
    review: true,
    skip: true,
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
