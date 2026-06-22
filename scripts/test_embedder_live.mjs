/**
 * Live embedding model test — actually loads the ONNX model from local cache and embeds real text.
 * Usage: node --no-warnings scripts/test_embedder_live.mjs
 */
import { pipeline, env } from '@huggingface/transformers';
import { existsSync } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const modelDir = path.join(distDir, 'models', 'Xenova', 'paraphrase-multilingual-MiniLM-L12-v2');
const modelFile = path.join(modelDir, 'onnx', 'model_quantized.onnx');

console.log('=== Embedding Model Live Test ===\n');
console.log('1. Checking model files...');
console.log('   Model dir:', modelDir);
console.log('   model_quantized.onnx exists:', existsSync(modelFile));
if (existsSync(modelFile)) {
  const fs = await import('fs');
  console.log('   Size:', (fs.statSync(modelFile).size / (1024 * 1024)).toFixed(1), 'MB');
} else {
  console.error('   MODEL FILE NOT FOUND!');
  process.exit(1);
}

console.log('\n2. Initializing pipeline...');
env.localModelPath = path.join(distDir, 'models') + path.sep;
env.allowLocalModels = true;
env.remoteHost = 'https://hf-mirror.com';

const start = Date.now();
let pipe;
try {
  pipe = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', { dtype: 'q8' });
  const dur = Date.now() - start;
  console.log('   Pipeline created in', (dur / 1000).toFixed(1), 's');
} catch (e) {
  console.error('   PIPELINE FAILED:', e.message);
  process.exit(1);
}

console.log('\n3. Embedding test texts...');
const tests = [
  { label: 'Chinese short', text: '今天天气很好，适合出去玩。' },
  { label: 'Chinese long', text: '机器学习是人工智能的一个分支，它使计算机能够从数据中学习并做出预测或决策，而无需明确编程。深度学习是机器学习的一个子集，使用多层神经网络。' },
  { label: 'English short', text: 'The quick brown fox jumps over the lazy dog.' },
  { label: 'English long', text: 'Machine learning is a subset of artificial intelligence that enables computers to learn from data and make predictions or decisions without being explicitly programmed.' },
];

let allPassed = true;
for (const { label, text } of tests) {
  const t0 = Date.now();
  try {
    const result = await pipe(text, { pooling: 'mean', normalize: true });
    const ms = Date.now() - t0;
    const vec = Array.from(result.data);
    const dim = vec.length;
    const nonZero = vec.filter(v => v !== 0).length;
    const sumAbs = vec.reduce((s, v) => s + Math.abs(v), 0);

    const dimOk = dim === 384 ? '✓' : `✗ (got ${dim})`;
    const normOk = Math.abs(sumAbs - 1.0) < 0.15 ? '✓' : `✗ (sumAbs=${sumAbs.toFixed(3)})`;
    const valuesOk = nonZero > 10 ? '✓' : `✗ (only ${nonZero} non-zero vals)`;

    console.log(`   ${label}: ${dim}d, ${nonZero}/${dim} non-zero, ${ms}ms [dim ${dimOk}] [norm ${normOk}] [values ${valuesOk}]`);
    if (dim !== 384 || nonZero <= 10) allPassed = false;
  } catch (e) {
    console.log(`   ${label}: FAILED — ${e.message}`);
    allPassed = false;
  }
}

console.log('\n=== Result:', allPassed ? 'ALL PASSED ✅' : 'FAILURES ❌', '===');
process.exit(allPassed ? 0 : 1);
