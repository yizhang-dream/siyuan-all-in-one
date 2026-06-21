import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_srs_scheduler_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { cleanConfig } from '../src/libs/config';
import { cleanCard, createCard, schedule, scheduleCard, scheduleFSRS } from '../src/libs/srs';

const sm2Config = cleanConfig({});
assert.equal(sm2Config.scheduler, 'sm2');
const fsrsConfig = cleanConfig({ scheduler: 'fsrs' });
assert.equal(fsrsConfig.scheduler, 'fsrs');
const badConfig = cleanConfig({ scheduler: 'unknown' });
assert.equal(badConfig.scheduler, 'sm2');

const sm2Card = createCard('What is SM-2?', 'A spaced repetition scheduler.');
schedule(2, sm2Card);
assert.equal(sm2Card.scheduler, 'sm2');
assert.equal(sm2Card.status, 'review');
assert.equal(sm2Card.interval, 1);
assert.equal(Boolean(sm2Card.fsrs), false);

const fsrsCard = createCard('What is FSRS?', 'Free Spaced Repetition Scheduler.');
const now = Date.UTC(2026, 0, 1, 8, 0, 0);
scheduleFSRS(2, fsrsCard, now);
assert.equal(fsrsCard.scheduler, 'fsrs');
assert.ok(fsrsCard.fsrs, 'FSRS scheduling should persist fsrs state');
assert.ok(fsrsCard.fsrs!.stability > 0);
assert.ok(fsrsCard.fsrs!.difficulty > 0);
assert.ok(fsrsCard.due > now);
assert.ok(fsrsCard.reps >= 1);
assert.equal(['learning', 'review'].includes(fsrsCard.status), true);

const secondDue = fsrsCard.due;
scheduleCard(3, fsrsCard, 'fsrs', now + 86_400_000);
assert.equal(fsrsCard.scheduler, 'fsrs');
assert.ok(fsrsCard.fsrs!.lastReview);
assert.ok(fsrsCard.due >= secondDue);

const cleaned = cleanCard(JSON.parse(JSON.stringify(fsrsCard)));
assert.equal(cleaned.scheduler, 'fsrs');
assert.equal(cleaned.fsrs?.state, fsrsCard.fsrs?.state);
assert.equal(cleaned.fsrs?.lastRating, fsrsCard.fsrs?.lastRating);

console.log(JSON.stringify({
  defaultScheduler: sm2Config.scheduler,
  fsrsScheduler: fsrsConfig.scheduler,
  fsrsState: fsrsCard.fsrs?.state,
  fsrsInterval: fsrsCard.interval,
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
