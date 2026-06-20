import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolvePluginDataDir, resolvePluginDir } from './siyuan_paths.mjs';

const root = process.cwd();
const deployDir = resolvePluginDir();
const dataDir = resolvePluginDataDir();

const distJsPath = path.join(root, 'dist', 'index.js');
const distCssPath = path.join(root, 'dist', 'index.css');
const deployedJsPath = path.join(deployDir, 'index.js');
const deployedCssPath = path.join(deployDir, 'index.css');
const configPath = path.join(dataDir, 'config');

for (const filePath of [distJsPath, distCssPath, deployedJsPath, deployedCssPath]) {
  assert.equal(existsSync(filePath), true, `missing bundle artifact: ${filePath}`);
}

const js = readFileSync(deployedJsPath, 'utf8');
const css = readFileSync(deployedCssPath, 'utf8');
const distJs = readFileSync(distJsPath, 'utf8');
const distCss = readFileSync(distCssPath, 'utf8');

assert.equal(js, distJs, 'deployed index.js does not match dist/index.js');
assert.equal(css, distCss, 'deployed index.css does not match dist/index.css');
assert.match(js, /siyuan-all-in-one|All-in-One|知识闪卡/, 'bundle should contain plugin identity');
assert.match(js, /OpenNotebook|notebookEndpoint|Open Notebook/, 'bundle should contain OpenNotebook integration code');
assert.match(js, /Concepts|conceptStore|concepts/, 'bundle should contain concept panel/store code');
assert.match(js, /Mindmap|mindmapStore|mindmaps/, 'bundle should contain mindmap panel/store code');
assert.match(js, /Review|cardStore|cards/, 'bundle should contain review/card code');
assert.match(js, /Diagnostics|AI 干跑|运行检查/, 'bundle should contain diagnostics panel code');
assert.match(js, /copy-diagnostic-report|siyuan-all-in-one-diagnostics/, 'bundle should contain copyable diagnostics report code');
assert.match(js, /sourceRefs|uncertain|warnings/, 'bundle should contain source/warning pipeline fields');
assert.match(css, /all-in-one|aio-|concept|mindmap|notebook/i, 'bundle CSS should contain plugin styles');

const sensitiveValues = collectSensitiveConfigValues(configPath);
for (const value of sensitiveValues) {
  assert.equal(js.includes(value), false, 'deployed JS appears to contain a configured secret');
  assert.equal(css.includes(value), false, 'deployed CSS appears to contain a configured secret');
}

console.log(JSON.stringify({
  dist: fileSummary(distJsPath, distCssPath),
  deployed: fileSummary(deployedJsPath, deployedCssPath),
  checks: {
    identity: true,
    notebook: true,
    concepts: true,
    mindmap: true,
    review: true,
    diagnostics: true,
    copyableDiagnostics: true,
    sourceRefs: true,
    noConfiguredSecretsInBundle: true,
  },
}, null, 2));

function fileSummary(jsPath, cssPath) {
  return {
    jsBytes: statSync(jsPath).size,
    cssBytes: statSync(cssPath).size,
  };
}

function collectSensitiveConfigValues(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const values = [];
  for (const provider of Array.isArray(raw?.providers) ? raw.providers : []) {
    const apiKey = String(provider?.apiKey || '').trim();
    if (apiKey.length >= 12) values.push(apiKey);
  }
  const oldApiKey = String(raw?.llmApiKey || '').trim();
  if (oldApiKey.length >= 12) values.push(oldApiKey);
  return [...new Set(values)];
}
