import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { readArg, resolveKernelEndpoint, resolvePluginDataDir, resolvePluginDir } from './siyuan_paths.mjs';

const root = process.cwd();
const dataDir = resolvePluginDataDir();
const deployDir = resolvePluginDir();
const tempDir = path.join(root, '_temp_runtime_check');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');
const query = readArg('--query') || process.env.OPENNOTEBOOK_TEST_QUERY || 'impulse momentum';

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanConfig } from '../src/libs/config';
import { OpenNotebookClient } from '../src/libs/notebook';
import { fetchOpenNotebookPipelineSources } from '../src/libs/ai/source-adapters';

const dataDir = ${JSON.stringify(dataDir)};
const query = ${JSON.stringify(query)};

function readJson(key: string) {
  const filePath = path.join(dataDir, key);
  if (!existsSync(filePath)) return undefined;
  const text = readFileSync(filePath, 'utf8').trim();
  return text ? JSON.parse(text) : undefined;
}

const config = cleanConfig(readJson('config') || {});
const client = new OpenNotebookClient(config.notebookEndpoint, 10_000);

const notebooks = await client.listNotebooks();
const sources = await client.listSources(undefined, 5).catch(() => []);
const pipelineSources = await fetchOpenNotebookPipelineSources({
  endpoint: config.notebookEndpoint,
  query,
  limit: 5,
  maxCharsPerSource: 1200,
}).catch((error) => {
  return { error: error?.message || String(error) } as any;
});

const searchFailed = !Array.isArray(pipelineSources);
assert.ok(notebooks.length > 0, 'OpenNotebook returned no notebooks');
assert.equal(searchFailed, false, 'OpenNotebook pipeline source search failed: ' + (pipelineSources as any).error);
assert.ok(Array.isArray(pipelineSources) && pipelineSources.length > 0, 'OpenNotebook search returned no pipeline sources');

console.log(JSON.stringify({
  notebookEndpoint: config.notebookEndpoint,
  notebooks: notebooks.length,
  sampleNotebook: notebooks[0] ? { id: notebooks[0].id, name: notebooks[0].name, archived: notebooks[0].archived } : null,
  sources: sources.length,
  query,
  pipelineSources: Array.isArray(pipelineSources) ? pipelineSources.length : 0,
  samplePipelineSource: Array.isArray(pipelineSources) && pipelineSources[0]
    ? {
        id: pipelineSources[0].id,
        sourceId: pipelineSources[0].sourceId,
        chunkId: pipelineSources[0].chunkId,
        chars: pipelineSources[0].text.length,
      }
    : null,
  searchWarning: searchFailed ? pipelineSources.error : '',
}, null, 2));
`, 'utf8');

const processStatus = getSiyuanProcessStatus();
const kernelStatus = await getSiyuanKernelStatus();
const pluginStatus = await getSiyuanPluginStatus();

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  external: ['siyuan'],
  logLevel: 'silent',
});

try {
  assert.equal(existsSync(dataDir), true, `plugin data directory does not exist: ${dataDir}`);
  assert.equal(kernelStatus.ok, true, `SiYuan kernel is not reachable: ${JSON.stringify(kernelStatus)}`);
  assert.equal(pluginStatus.found, true, 'siyuan-all-in-one is not visible in SiYuan plugin list');
  assert.equal(pluginStatus.enabled, true, 'siyuan-all-in-one is not enabled in SiYuan');
  assert.equal(pluginStatus.incompatible, false, 'siyuan-all-in-one is marked incompatible by SiYuan');
  assert.equal(pluginStatus.jsMatchesDeploy, true, 'SiYuan kernel plugin JS does not match deployed index.js');
  assert.equal(pluginStatus.cssMatchesDeploy, true, 'SiYuan kernel plugin CSS does not match deployed index.css');
  console.log(JSON.stringify({ processes: processStatus, siyuanKernel: kernelStatus, plugin: pluginStatus }, null, 2));
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function getSiyuanProcessStatus() {
  if (process.platform !== 'win32') {
    return { checked: false, reason: 'process check is implemented for Windows tasklist only' };
  }
  try {
    const appOutput = execFileSync('tasklist', ['/FI', 'IMAGENAME eq SiYuan.exe', '/FO', 'CSV'], { encoding: 'utf8' });
    const kernelOutput = execFileSync('tasklist', ['/FI', 'IMAGENAME eq SiYuan-Kernel.exe', '/FO', 'CSV'], { encoding: 'utf8' });
    return {
      checked: true,
      siyuanProcesses: countTasklistRows(appOutput, 'SiYuan.exe'),
      kernelProcesses: countTasklistRows(kernelOutput, 'SiYuan-Kernel.exe'),
    };
  } catch (error) {
    return { checked: false, reason: error?.message || String(error) };
  }
}

function countTasklistRows(output, imageName) {
  return output
    .split(/\\r?\\n/)
    .filter((line) => line.toLowerCase().includes(`"${imageName.toLowerCase()}"`))
    .length;
}

async function getSiyuanKernelStatus() {
  const endpoint = resolveKernelEndpoint();
  try {
    const resp = await fetch(`${endpoint}/api/system/version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(3000),
    });
    const data = await resp.json().catch(() => ({}));
    return {
      endpoint,
      ok: resp.ok && data?.code === 0,
      status: resp.status,
      version: data?.data || '',
      message: data?.msg || '',
    };
  } catch (error) {
    return {
      endpoint,
      ok: false,
      error: error?.message || String(error),
    };
  }
}

async function getSiyuanPluginStatus() {
  const endpoint = resolveKernelEndpoint();
  try {
    const resp = await fetch(`${endpoint}/api/petal/loadPetals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frontend: 'desktop' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json().catch(() => ({}));
    const plugin = Array.isArray(data?.data)
      ? data.data.find((item) => item?.name === 'siyuan-all-in-one')
      : null;
    const deployedJs = readTextIfExists(path.join(deployDir, 'index.js'));
    const deployedCss = readTextIfExists(path.join(deployDir, 'index.css'));
    const pluginJs = typeof plugin?.js === 'string' ? plugin.js : '';
    const pluginCss = typeof plugin?.css === 'string' ? plugin.css : '';
    return plugin ? {
      found: true,
      enabled: Boolean(plugin.enabled),
      incompatible: Boolean(plugin.incompatible),
      disabledInPublish: Boolean(plugin.disabledInPublish),
      jsChars: pluginJs.length,
      cssChars: pluginCss.length,
      deployedJsChars: deployedJs.length,
      deployedCssChars: deployedCss.length,
      jsMatchesDeploy: hashText(pluginJs) === hashText(deployedJs),
      cssMatchesDeploy: hashText(pluginCss) === hashText(deployedCss),
    } : {
      found: false,
      status: resp.status,
      message: data?.msg || '',
    };
  } catch (error) {
    return {
      found: false,
      error: error?.message || String(error),
    };
  }
}

function readTextIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function hashText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
