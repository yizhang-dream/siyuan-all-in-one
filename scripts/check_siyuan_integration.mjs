import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolvePluginDataDir, resolvePluginDir } from './siyuan_paths.mjs';

const root = process.cwd();
const deployDir = resolvePluginDir();
const dataDir = resolvePluginDataDir();
const strictDeploy = process.argv.includes('--strict-deploy');

const requiredManifestFields = [
  'name',
  'author',
  'version',
  'minAppVersion',
  'displayName',
  'description',
  'readme',
  'frontends',
  'backends',
];
const distFiles = ['index.js', 'index.css', 'plugin.json', 'icon.png'];

const pluginJsonPath = path.join(root, 'plugin.json');
assert.equal(existsSync(pluginJsonPath), true, 'plugin.json is missing');

const manifest = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
for (const field of requiredManifestFields) {
  assert.ok(manifest[field], `plugin.json missing ${field}`);
}
assert.equal(manifest.name, 'siyuan-all-in-one');
assert.ok(manifest.displayName?.zh_CN?.includes('闪卡'), 'zh_CN displayName should be readable Chinese');
assert.ok(manifest.description?.zh_CN?.includes('闪卡'), 'zh_CN description should be readable Chinese');
assert.ok(Array.isArray(manifest.frontends) && manifest.frontends.includes('desktop'));
assert.ok(Array.isArray(manifest.backends) && manifest.backends.includes('windows'));

const dist = Object.fromEntries(distFiles.map((file) => [file, fileStatus(path.join(root, 'dist', file))]));
const missingDist = Object.entries(dist).filter(([, status]) => !status.exists).map(([file]) => file);
assert.deepEqual(missingDist, [], `dist missing files: ${missingDist.join(', ')}`);

const deployed = Object.fromEntries(distFiles.map((file) => [file, fileStatus(path.join(deployDir, file))]));
const deployWarnings = [];
for (const file of ['index.js', 'index.css']) {
  const source = dist[file];
  const target = deployed[file];
  if (!target.exists) {
    deployWarnings.push(`${file} is not deployed`);
  } else if (target.mtimeMs < source.mtimeMs || target.size !== source.size) {
    deployWarnings.push(`${file} deployment is stale`);
  }
}

const dataStatus = {
  root: dirStatus(dataDir),
  cards: fileStatus(path.join(dataDir, 'cards')),
  mindmaps: fileStatus(path.join(dataDir, 'mindmaps')),
  config: fileStatus(path.join(dataDir, 'config')),
};

if (strictDeploy && deployWarnings.length > 0) {
  throw new Error(`Deployment check failed: ${deployWarnings.join('; ')}`);
}

console.log(JSON.stringify({
  manifest: {
    name: manifest.name,
    version: manifest.version,
    displayNameZhCN: manifest.displayName.zh_CN,
  },
  dist,
  deployDir,
  deployed,
  deployWarnings,
  dataDir,
  dataStatus,
  strictDeploy,
}, null, 2));

function fileStatus(filePath) {
  if (!existsSync(filePath)) return { exists: false };
  const stat = statSync(filePath);
  return {
    exists: true,
    size: stat.size,
    mtimeMs: Math.trunc(stat.mtimeMs),
  };
}

function dirStatus(dirPath) {
  if (!existsSync(dirPath)) return { exists: false };
  const stat = statSync(dirPath);
  return {
    exists: true,
    isDirectory: stat.isDirectory(),
    mtimeMs: Math.trunc(stat.mtimeMs),
  };
}
