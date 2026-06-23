import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const distDir = path.join(root, 'dist');
const outDir = path.join(root, 'release');
const outFile = path.join(outDir, `${pkg.name}-v${pkg.version}.zip`);

if (!existsSync(distDir)) {
  throw new Error('dist/ does not exist. Run npm run build first.');
}

const required = [
  'index.js',
  'index.css',
  'plugin.json',
  'icon.png',
  'README.md',
  'README_zh_CN.md',
  'i18n',
  'models',
  'node_modules',
];

const files = {};
for (const name of required) {
  const fullPath = path.join(distDir, name);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing release asset: dist/${name}`);
  }
  addPath(files, distDir, fullPath);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, zipSync(files, { level: 9 }));

console.log(JSON.stringify({
  package: pkg.name,
  version: pkg.version,
  output: outFile,
  files: Object.keys(files).sort(),
}, null, 2));

function addPath(files, baseDir, fullPath) {
  const stat = statSync(fullPath);
  if (stat.isDirectory()) {
    for (const child of readdirSync(fullPath)) {
      addPath(files, baseDir, path.join(fullPath, child));
    }
    return;
  }
  const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/');
  files[rel] = new Uint8Array(readFileSync(fullPath));
}

