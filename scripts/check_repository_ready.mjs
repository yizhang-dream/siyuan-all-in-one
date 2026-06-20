import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();

const requiredFiles = [
  'README.md',
  'README_zh_CN.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'package.json',
  'package-lock.json',
  'plugin.json',
  '.gitignore',
  '.gitattributes',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  'docs/ARCHITECTURE.md',
  'docs/INSTALL.md',
  'docs/TESTING.md',
  'docs/PROMPT_STRATEGY.md',
];

for (const file of requiredFiles) {
  assert.ok(existsSync(path.join(root, file)), `missing repository file: ${file}`);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(root, 'plugin.json'), 'utf8'));

assert.equal(pkg.license, 'MIT', 'package license should be MIT');
assert.ok(pkg.repository?.url, 'package repository URL is required');
assert.ok(pkg.bugs?.url, 'package bugs URL is required');
assert.ok(pkg.homepage, 'package homepage is required');
assert.ok(manifest.url?.startsWith('https://github.com/'), 'plugin.json url should point to GitHub');
assert.ok(manifest.name && manifest.version && manifest.displayName, 'plugin manifest should include marketplace metadata');

const gitignore = readFileSync(path.join(root, '.gitignore'), 'utf8');
for (const pattern of ['node_modules/', 'dist/', 'release/', '.deploy-backups/', '.env', '_temp_*']) {
  assert.match(gitignore, new RegExp(escapeRegExp(pattern)), `.gitignore should include ${pattern}`);
}

const ignoredPaths = [
  'node_modules',
  'dist/index.js',
  'release/siyuan-all-in-one-v1.0.0.zip',
  '.deploy-backups/example',
  '.env',
  '_temp_example',
];
const ignored = checkIgnored(ignoredPaths);
for (const item of ignoredPaths) {
  assert.equal(ignored[item], true, `${item} should be ignored by git`);
}

const scanned = scanTextFiles(root);
const secretPattern = /(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|api[_-]?key\s*[:=]\s*['"][^'"]{12,})/i;
const offenders = scanned.filter((file) => secretPattern.test(readFileSync(file, 'utf8')));
assert.deepEqual(offenders.map((file) => path.relative(root, file)), [], 'repository text files should not contain obvious API keys');

console.log(JSON.stringify({
  requiredFiles: requiredFiles.length,
  ignoredPaths: ignoredPaths.length,
  packageMetadata: true,
  manifestMetadata: true,
  secretScanFiles: scanned.length,
}, null, 2));

function checkIgnored(paths) {
  const result = Object.fromEntries(paths.map((item) => [item, false]));
  try {
    const output = execFileSync('git', ['check-ignore', '-v', ...paths], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const ignoredPath = line.split(/\s+/).at(-1);
      if (ignoredPath && ignoredPath in result) result[ignoredPath] = true;
    }
  } catch {
    // git check-ignore exits non-zero when no paths match. Keep defaults.
  }
  return result;
}

function scanTextFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', 'release', '.deploy-backups', '.git'].includes(entry)) continue;
    const file = path.join(dir, entry);
    const stat = statSync(file);
    if (stat.isDirectory()) {
      out.push(...scanTextFiles(file));
    } else if (isTextFile(file) && stat.size < 2_000_000) {
      out.push(file);
    }
  }
  return out;
}

function isTextFile(file) {
  return /\.(cjs|css|html|js|json|md|mjs|scss|svelte|ts|txt|yaml|yml)$/i.test(file) ||
    ['.gitignore', '.gitattributes'].includes(path.basename(file));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
