import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_concept_graph_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { buildConceptGraph } from '../src/libs/render/concept-graph';
import type { ConceptNode, Relation } from '../src/libs/types/concept';

const now = Date.now();
const concepts: ConceptNode[] = [
  {
    id: 'c-root',
    title: '间隔重复',
    parentIds: [],
    childIds: ['c-child'],
    relatedIds: [],
    cardIds: ['card-1'],
    sourceRefs: [{ type: 'manual', sourceId: 's1' }],
    tags: ['学习'],
    created: now,
    modified: now,
  },
  {
    id: 'c-child',
    title: 'SM-2',
    parentIds: ['c-root'],
    childIds: [],
    relatedIds: [],
    cardIds: [],
    sourceRefs: [],
    tags: [],
    created: now,
    modified: now,
  },
];

const relations: Relation[] = [
  { id: 'r1', fromId: 'c-root', toId: 'c-child', type: 'parent_child', sourceRefs: [], confidence: 0.9 },
  { id: 'r-hidden', fromId: 'c-root', toId: 'missing', type: 'related', sourceRefs: [] },
];

const graph = buildConceptGraph(concepts, relations, [
  { id: 'card-1', conceptId: 'c-root', question: '间隔重复是什么？' },
  { id: 'card-2', conceptId: 'c-child', question: 'SM-2 是什么？' },
]);

assert.equal(graph.width, 1000);
assert.equal(graph.height, 640);
assert.equal(graph.nodes.length, 2);
assert.equal(graph.edges.length, 1);

const root = graph.nodes.find((node) => node.id === 'c-root')!;
const child = graph.nodes.find((node) => node.id === 'c-child')!;
assert.equal(root.depth, 0);
assert.equal(root.isRoot, true);
assert.equal(root.cardCount, 1);
assert.equal(root.sourceCount, 1);
assert.equal(child.depth, 1);
assert.equal(child.cardCount, 1);
assert.ok(child.x > root.x);

console.log(JSON.stringify({
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  rootDepth: root.depth,
  childDepth: child.depth,
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
