import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { resolvePluginDataDir } from './siyuan_paths.mjs';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const outFile = path.join(root, 'release', `${pkg.name}-v${pkg.version}.zip`);

assert.equal(existsSync(outFile), true, `missing release zip: ${outFile}`);

const zip = unzipSync(new Uint8Array(readFileSync(outFile)));
const entries = Object.keys(zip).sort();
const requiredEntries = [
  'README.md',
  'README_zh_CN.md',
  'i18n/en_US.json',
  'i18n/zh_CN.json',
  'icon.png',
  'index.css',
  'index.js',
  'plugin.json',
];

assert.deepEqual(entries, requiredEntries, 'release zip should contain only marketplace plugin assets');

const manifest = JSON.parse(strFromU8(zip['plugin.json']));
assert.equal(manifest.name, pkg.name, 'release manifest name should match package.json');
assert.equal(manifest.version, pkg.version, 'release manifest version should match package.json');
assert.ok(manifest.displayName, 'release manifest should include displayName');
assert.ok(manifest.url?.startsWith('https://github.com/'), 'release manifest should include GitHub URL');

assert.ok(zip['index.js'].byteLength > 1_000_000, 'release index.js should look like a production bundle');
assert.ok(zip['index.css'].byteLength > 10_000, 'release index.css should include plugin styles');

const js = strFromU8(zip['index.js']);
const css = strFromU8(zip['index.css']);
const readme = strFromU8(zip['README.md']);
const readmeZh = strFromU8(zip['README_zh_CN.md']);

assert.match(js, /OpenNotebook|notebookEndpoint/, 'release bundle should include OpenNotebook integration');
assert.match(js, /Concepts|conceptStore|sourceRefs/, 'release bundle should include concept graph pipeline');
assert.match(js, /Mindmap|mindmapStore|linkedCardIds/, 'release bundle should include mindmap-card links');
assert.match(js, /scheduleCard|fsrs|scheduler/, 'release bundle should include configurable review scheduling');
assert.match(css, /all-in-one|aio-|mindmap|notebook/i, 'release CSS should include plugin styles');
assert.match(readme, /OpenNotebook|FSRS|Graph Generate/, 'English README should describe core capabilities');
assert.match(readmeZh, /OpenNotebook|FSRS|图谱生成/, 'Chinese README should describe core capabilities');

for (const forbidden of ['node_modules/', 'dist/', 'release/', '.deploy-backups/', '.env', '_temp_']) {
  assert.equal(entries.some((entry) => entry.startsWith(forbidden)), false, `release zip should not include ${forbidden}`);
}

const configPath = path.join(resolvePluginDataDir(), 'config');
const configuredSecrets = collectSensitiveConfigValues(configPath);
for (const value of configuredSecrets) {
  assert.equal(js.includes(value), false, 'release JS appears to contain a configured secret');
  assert.equal(css.includes(value), false, 'release CSS appears to contain a configured secret');
}

console.log(JSON.stringify({
  file: outFile,
  bytes: statSync(outFile).size,
  entries,
  manifest: {
    name: manifest.name,
    version: manifest.version,
    displayName: manifest.displayName,
  },
  checks: {
    exactEntries: true,
    manifestMetadata: true,
    coreCapabilities: true,
    noForbiddenPaths: true,
    noConfiguredSecrets: true,
  },
}, null, 2));

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
