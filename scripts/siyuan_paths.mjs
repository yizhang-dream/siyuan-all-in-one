import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
export const pluginName = pkg.name || 'siyuan-all-in-one';

export function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

export function resolveSiyuanDataDir() {
  const explicit = readArg('--siyuan-data') || process.env.SIYUAN_DATA_DIR;
  if (explicit) return path.resolve(expandHome(explicit));

  const home = os.homedir();
  const candidates = [
    path.join(home, 'SiYuan', 'data'),
    path.join(home, 'Documents', 'SiYuan', 'data'),
    path.join(home, 'siyuan', 'data'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'SiYuan', 'data') : '',
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'SiYuan', 'data') : '',
    path.join(home, '.local', 'share', 'SiYuan', 'data'),
    path.join(home, 'Library', 'Application Support', 'SiYuan', 'data'),
  ].filter(Boolean);

  const existing = candidates.find((candidate) =>
    existsSync(path.join(candidate, 'plugins')) ||
    existsSync(path.join(candidate, 'storage')) ||
    existsSync(candidate)
  );
  return existing || candidates[0];
}

export function resolvePluginDir() {
  const explicit = readArg('--plugin-dir') || process.env.SIYUAN_PLUGIN_DIR;
  if (explicit) return path.resolve(expandHome(explicit));
  return path.join(resolveSiyuanDataDir(), 'plugins', pluginName);
}

export function resolvePluginDataDir() {
  const explicit = readArg('--plugin-data-dir') || process.env.SIYUAN_PLUGIN_DATA_DIR;
  if (explicit) return path.resolve(expandHome(explicit));
  return path.join(resolveSiyuanDataDir(), 'storage', 'petal', pluginName);
}

export function resolveKernelEndpoint() {
  return readArg('--kernel') || process.env.SIYUAN_KERNEL_ENDPOINT || 'http://127.0.0.1:6806';
}

export function pathHelp() {
  return [
    'Path overrides:',
    '  --siyuan-data <dir>       SiYuan data directory, e.g. ~/SiYuan/data',
    '  --plugin-dir <dir>        Deployed plugin directory',
    '  --plugin-data-dir <dir>   Plugin saveData directory',
    '  --kernel <url>            SiYuan kernel endpoint',
    '',
    'Environment variables:',
    '  SIYUAN_DATA_DIR, SIYUAN_PLUGIN_DIR, SIYUAN_PLUGIN_DATA_DIR, SIYUAN_KERNEL_ENDPOINT',
  ].join('\n');
}

function expandHome(input) {
  if (!input || input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}
