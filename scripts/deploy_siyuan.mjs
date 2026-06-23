import { cp, lstat, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathHelp, resolvePluginDir } from './siyuan_paths.mjs';

const root = process.cwd();
const deployDir = resolvePluginDir();
const apply = process.argv.includes('--apply');
const distDir = path.join(root, 'dist');
const backupRoot = path.join(root, '.deploy-backups', timestamp());
const requiredFiles = ['index.js', 'index.css', 'plugin.json', 'icon.png', 'README.md', 'README_zh_CN.md'];
const optionalDirs = ['i18n', 'models', 'node_modules'];

async function main() {
  assertDir(distDir, 'dist directory is missing. Run npm run build first.');
  if (existsSync(deployDir)) {
    await assertNotSymlink(deployDir);
  } else if (apply) {
    await mkdir(deployDir, { recursive: true });
  }

  const plan = [];
  for (const file of requiredFiles) {
    const source = path.join(distDir, file);
    if (!existsSync(source)) throw new Error(`dist artifact missing: ${file}`);
    plan.push({ kind: 'file', source, target: path.join(deployDir, file) });
  }
  for (const dir of optionalDirs) {
    const source = path.join(distDir, dir);
    if (existsSync(source)) plan.push({ kind: 'dir', source, target: path.join(deployDir, dir) });
  }

  const summary = [];
  for (const item of plan) {
    const sourceInfo = await stat(item.source);
    const targetInfo = existsSync(item.target) ? await stat(item.target) : null;
    summary.push({
      kind: item.kind,
      name: path.basename(item.source),
      sourceSize: sourceInfo.isFile() ? sourceInfo.size : await dirSize(item.source),
      targetExists: Boolean(targetInfo),
      targetSize: targetInfo?.isFile() ? targetInfo.size : targetInfo ? await dirSize(item.target) : 0,
      action: apply ? 'copy' : 'dry-run',
    });
  }

  if (!apply) {
    console.log(JSON.stringify({
      apply,
      deployDir,
      backupRoot,
      summary,
      next: `Run npm run deploy:siyuan -- --apply to copy files with backups.\n${pathHelp()}`,
    }, null, 2));
    return;
  }

  await mkdir(backupRoot, { recursive: true });
  for (const item of plan) {
    if (existsSync(item.target)) {
      await cp(item.target, path.join(backupRoot, path.basename(item.target)), {
        recursive: true,
        force: true,
      });
    }
    await cp(item.source, item.target, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    apply,
    deployDir,
    backupRoot,
    copied: summary.map((item) => item.name),
    next: 'Restart SiYuan or reload the plugin, then run npm run check:siyuan -- --strict-deploy.',
  }, null, 2));
}

function assertDir(dir, message) {
  if (!existsSync(dir)) throw new Error(message);
}

async function assertNotSymlink(dir) {
  const info = await lstat(dir);
  if (info.isSymbolicLink()) throw new Error(`${dir} is a symlink; use npm run make-link instead.`);
  if (!info.isDirectory()) throw new Error(`${dir} is not a directory`);
}

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
