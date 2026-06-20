import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  pluginName,
  readArg,
  resolveKernelEndpoint,
  resolvePluginDataDir,
  resolvePluginDir,
  resolveSiyuanDataDir,
} from './siyuan_paths.mjs';

const originalArgv = [...process.argv];
const originalEnv = {
  SIYUAN_DATA_DIR: process.env.SIYUAN_DATA_DIR,
  SIYUAN_PLUGIN_DIR: process.env.SIYUAN_PLUGIN_DIR,
  SIYUAN_PLUGIN_DATA_DIR: process.env.SIYUAN_PLUGIN_DATA_DIR,
  SIYUAN_KERNEL_ENDPOINT: process.env.SIYUAN_KERNEL_ENDPOINT,
};

try {
  clearEnv();

  process.argv = ['node', 'test', '--siyuan-data', '~/SiYuanCustom/data', '--kernel', 'http://127.0.0.1:7777'];
  assert.equal(readArg('--siyuan-data'), '~/SiYuanCustom/data');
  assert.equal(resolveSiyuanDataDir(), path.join(os.homedir(), 'SiYuanCustom', 'data'));
  assert.equal(resolvePluginDir(), path.join(os.homedir(), 'SiYuanCustom', 'data', 'plugins', pluginName));
  assert.equal(resolvePluginDataDir(), path.join(os.homedir(), 'SiYuanCustom', 'data', 'storage', 'petal', pluginName));
  assert.equal(resolveKernelEndpoint(), 'http://127.0.0.1:7777');

  process.argv = ['node', 'test'];
  process.env.SIYUAN_DATA_DIR = path.join(os.tmpdir(), 'siyuan-data-env');
  assert.equal(resolveSiyuanDataDir(), path.resolve(process.env.SIYUAN_DATA_DIR));
  assert.equal(resolvePluginDir(), path.join(process.env.SIYUAN_DATA_DIR, 'plugins', pluginName));
  assert.equal(resolvePluginDataDir(), path.join(process.env.SIYUAN_DATA_DIR, 'storage', 'petal', pluginName));

  process.env.SIYUAN_PLUGIN_DIR = path.join(os.tmpdir(), 'custom-plugin-dir');
  process.env.SIYUAN_PLUGIN_DATA_DIR = path.join(os.tmpdir(), 'custom-plugin-data-dir');
  process.env.SIYUAN_KERNEL_ENDPOINT = 'http://localhost:6807';
  assert.equal(resolvePluginDir(), path.resolve(process.env.SIYUAN_PLUGIN_DIR));
  assert.equal(resolvePluginDataDir(), path.resolve(process.env.SIYUAN_PLUGIN_DATA_DIR));
  assert.equal(resolveKernelEndpoint(), 'http://localhost:6807');

  process.argv = [
    'node',
    'test',
    '--plugin-dir',
    '~/plugin-override',
    '--plugin-data-dir',
    '~/plugin-data-override',
  ];
  assert.equal(resolvePluginDir(), path.join(os.homedir(), 'plugin-override'));
  assert.equal(resolvePluginDataDir(), path.join(os.homedir(), 'plugin-data-override'));

  console.log(JSON.stringify({
    pluginName,
    cliSiyuanData: true,
    envSiyuanData: true,
    pluginOverrides: true,
    kernelOverride: true,
  }, null, 2));
} finally {
  process.argv = originalArgv;
  restoreEnv();
}

function clearEnv() {
  delete process.env.SIYUAN_DATA_DIR;
  delete process.env.SIYUAN_PLUGIN_DIR;
  delete process.env.SIYUAN_PLUGIN_DATA_DIR;
  delete process.env.SIYUAN_KERNEL_ENDPOINT;
}

function restoreEnv() {
  clearEnv();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value !== undefined) process.env[key] = value;
  }
}
