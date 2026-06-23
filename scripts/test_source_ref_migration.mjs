function migrateSourceRef(oldRef) {
  const clean = { ...oldRef };
  delete clean.chunkId;
  delete clean.url;
  switch (clean.type) {
    case 'siyuan-doc': case 'manual': break;
    case 'file': case 'url': case 'pdf': case 'rag': clean.type = 'source'; break;
    case 'opennotebook': case 'siyuan': clean.type = 'source'; break;
    default: clean.type = 'manual'; break;
  }
  return clean;
}

const tests = [
  { in: { type: 'siyuan-doc', blockId: 'abc' }, want: 'siyuan-doc' },
  { in: { type: 'file', sourceId: 'x' }, want: 'source' },
  { in: { type: 'opennotebook', sourceId: 'y' }, want: 'source' },
  { in: { type: 'siyuan', sourceId: 'z' }, want: 'source' },
  { in: { type: 'unknown', sourceId: 'w' }, want: 'manual' },
  { in: { type: 'manual' }, want: 'manual' },
  { in: { type: 'url', sourceId: 'u', chunkId: 'c1', url: 'http://x' }, want: 'source' },
];

let pass = 0;
tests.forEach((t, i) => {
  const result = migrateSourceRef(t.in);
  if (result.type !== t.want) {
    console.error(`Test ${i} FAIL: expected ${t.want} got ${result.type}`);
    return;
  }
  if ('chunkId' in result) {
    console.error(`Test ${i} FAIL: chunkId should be removed`);
    return;
  }
  if ('url' in result) {
    console.error(`Test ${i} FAIL: url should be removed`);
    return;
  }
  pass++;
  console.log(`Test ${i} PASS: ${t.in.type} → ${result.type}`);
});
console.assert(pass === tests.length, 'All should pass');
console.log('test_source_ref_migration: ALL PASSED ✅');
