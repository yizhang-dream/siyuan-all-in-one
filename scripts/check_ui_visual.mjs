import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readArg, resolveKernelEndpoint } from './siyuan_paths.mjs';

const root = process.cwd();
const chromePath = readArg('--chrome') || process.env.CHROME_PATH || findChrome();
const endpoint = resolveKernelEndpoint();
const keepScreenshot = process.argv.includes('--keep-screenshot');
const port = Number(readArg('--cdp-port') || 9237);
const windowSize = readArg('--window-size') || '1440,1000';
const [viewportWidth, viewportHeight] = windowSize.split(',').map((item) => Number(item.trim()) || 0);
const minAppWidth = viewportWidth && viewportWidth < 1200 ? 500 : 800;
const minAppHeight = viewportHeight && viewportHeight < 900 ? 400 : 500;
const tempDir = path.join(root, `_temp_ui_visual_check_${port}`);
const screenshotPath = path.join(tempDir, 'siyuan-all-in-one.png');
const userDataDir = path.join(tempDir, 'chrome-profile');
const pluginName = 'siyuan-all-in-one';
const requiredNavTitles = ['快速制卡', '导入', '知识库', '模型', '图谱生成', '导图', '诊断', '统计'];

assert.ok(chromePath, 'Chrome or Edge executable was not found. Set CHROME_PATH or pass --chrome.');
assert.ok(endpoint, 'SiYuan kernel endpoint is required.');

await rm(tempDir, { recursive: true, force: true });
await mkdir(userDataDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-crash-reporter',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  `--window-size=${windowSize}`,
  endpoint,
], { stdio: ['ignore', 'ignore', 'pipe'] });

let stderr = '';
chrome.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

try {
  const wsUrl = await waitForWsUrl(port, 15_000);
  const cdp = await connectCdp(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  await waitFor(cdp, 'window.siyuan && window.siyuan.ws && window.siyuan.ws.app', 30_000, 'SiYuan frontend app did not load.');
  const pluginState = await waitForPlugin(cdp);
  assert.equal(pluginState.found, true, `${pluginName} plugin instance was not found in SiYuan frontend.`);
  assert.equal(pluginState.hasTopBarIcon, true, `${pluginName} topbar icon was not registered at runtime.`);

  const opened = await evaluate(cdp, `
    (() => {
      const plugin = window.siyuan.ws.app.plugins.find((item) => item && item.name === ${JSON.stringify(pluginName)});
      const icon = plugin.topBarIcons && plugin.topBarIcons[0];
      if (!icon) return false;
      icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      icon.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      icon.click();
      return true;
    })()
  `);
  assert.equal(opened, true, 'failed to click plugin topbar icon');

  const uiState = await waitForApp(cdp);
  assert.equal(uiState.hasApp, true, 'All-in-One app root was not rendered.');
  for (const title of requiredNavTitles) {
    assert.ok(uiState.navTitles.includes(title), `plugin navigation should include ${title}.`);
  }
  assert.equal(uiState.navTitles.includes('modelsTab'), false, 'plugin navigation should not expose missing i18n key modelsTab.');
  assert.equal(uiState.navTitles.includes('diagnosticsTab'), false, 'plugin navigation should not expose missing i18n key diagnosticsTab.');

  const panels = [];
  for (const title of ['复习', ...requiredNavTitles]) {
    const panelState = await clickAndMeasurePanel(cdp, title);
    if (title === '图谱生成') {
      panelState.mixedSource = await checkConceptMixedSourceControls(cdp);
    }
    panels.push(panelState);
  }
  const settings = await openAndMeasureSettings(cdp);

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  const shot = await stat(screenshotPath);
  assert.ok(shot.size > 50_000, `plugin screenshot looks too small: ${shot.size} bytes`);

  const geometry = await evaluate(cdp, `
    (() => {
      const app = document.querySelector('.all-in-one-app');
      if (!app) return { ok: false, reason: 'missing app root' };
      const rect = app.getBoundingClientRect();
      const styles = getComputedStyle(app);
      return {
        ok: rect.width > ${minAppWidth} && rect.height > ${minAppHeight},
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        display: styles.display,
        background: styles.backgroundColor,
      };
    })()
  `);
  assert.equal(geometry.ok, true, `plugin app root has unexpected geometry: ${JSON.stringify(geometry)}`);

  await cdp.send('Browser.close').catch(() => {});

  console.log(JSON.stringify({
    endpoint,
    chrome: chromePath,
    plugin: pluginState,
    ui: uiState,
    panels,
    settings,
    screenshot: {
      captured: true,
      bytes: shot.size,
      kept: keepScreenshot,
      path: keepScreenshot ? screenshotPath : '',
    },
    geometry,
    windowSize,
  }, null, 2));
} finally {
  setTimeout(() => chrome.kill('SIGKILL'), 1000);
  if (!keepScreenshot) {
    setTimeout(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }, 2500);
  }
}

async function waitForPlugin(cdp) {
  return waitForValue(cdp, `
    (() => {
      const plugins = window.siyuan && window.siyuan.ws && window.siyuan.ws.app
        ? window.siyuan.ws.app.plugins || []
        : [];
      const plugin = plugins.find((item) => item && item.name === ${JSON.stringify(pluginName)});
      return {
        found: Boolean(plugin),
        hasOpenMainTab: typeof plugin?.openMainTab === 'function',
        hasTopBarIcon: Boolean(plugin?.topBarIcons?.[0]),
        pluginCount: plugins.length,
        pluginNames: plugins.map((item) => item && item.name).filter(Boolean),
      };
    })()
  `, (value) => value?.found && value?.hasTopBarIcon, 30_000, `${pluginName} topbar icon did not appear in SiYuan frontend plugins.`);
}

async function waitForApp(cdp) {
  return waitForValue(cdp, `
    (() => {
      const app = document.querySelector('.all-in-one-app');
      const navTitles = app
        ? [...app.querySelectorAll('[title]')].map((item) => item.getAttribute('title')).filter(Boolean)
        : [];
      const text = app ? app.innerText.slice(0, 1000) : '';
      return {
        hasApp: Boolean(app),
        navTitles,
        textSample: text,
        activeText: document.title,
      };
    })()
  `, (value) => value?.hasApp, 30_000, 'All-in-One app root did not render after clicking the topbar icon.');
}

async function clickAndMeasurePanel(cdp, title) {
  const clicked = await evaluate(cdp, `
    (() => {
      const app = document.querySelector('.all-in-one-app');
      const button = app
        ? [...app.querySelectorAll('.aio-nav-item[title]')].find((item) => item.getAttribute('title') === ${JSON.stringify(title)})
        : null;
      if (!button) return false;
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      button.click();
      return true;
    })()
  `);
  assert.equal(clicked, true, `failed to click plugin nav item: ${title}`);

  const state = await waitForValue(cdp, `
    (() => {
      const app = document.querySelector('.all-in-one-app');
      const active = app?.querySelector('.aio-nav-item--active');
      const content = app?.querySelector('.aio-content');
      const rect = content?.getBoundingClientRect();
      const activeTitle = active?.getAttribute('title') || '';
      const text = content?.innerText?.trim() || '';
      const contentOverflowX = content ? Math.max(0, content.scrollWidth - content.clientWidth) : 0;
      const appOverflowX = app ? Math.max(0, app.scrollWidth - app.clientWidth) : 0;
      return {
        title: ${JSON.stringify(title)},
        activeTitle,
        textSample: text.slice(0, 240),
        textLength: text.length,
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
        contentOverflowX,
        appOverflowX,
        visible: Boolean(content && rect && rect.width > 500 && rect.height > 400),
      };
    })()
  `, (value) => {
    if (value?.activeTitle !== title || !value?.visible) return false;
    if (title === '模型' && value.textSample === '加载中...') return false;
    return true;
  }, 15_000, `panel did not become active: ${title}`);

  assert.equal(state.activeTitle, title, `expected active nav title ${title}, got ${state.activeTitle}`);
  assert.ok(state.textLength > 0, `${title} panel should render visible text.`);
  if (title === '模型') {
    assert.notEqual(state.textSample, '加载中...', 'Models panel should finish loading during visual smoke test.');
    assert.doesNotMatch(state.textSample, /🔄/, 'Models panel should use a SiYuan refresh icon instead of emoji text.');
  }
  assert.ok(state.contentOverflowX <= 24, `${title} panel has excessive horizontal overflow: ${state.contentOverflowX}px`);
  assert.ok(state.appOverflowX <= 24, `${title} app root has excessive horizontal overflow: ${state.appOverflowX}px`);
  return state;
}

async function checkConceptMixedSourceControls(cdp) {
  const clicked = await evaluate(cdp, `
    (() => {
      const app = document.querySelector('.all-in-one-app');
      const button = app
        ? [...app.querySelectorAll('.source-mode-tabs button')].find((item) => item.textContent.trim() === '混合来源')
        : null;
      if (!button) return false;
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      button.click();
      return true;
    })()
  `);
  assert.equal(clicked, true, 'failed to click mixed source mode in Concepts panel');

  const state = await waitForValue(cdp, `
    (() => {
      const app = document.querySelector('.all-in-one-app');
      const content = app?.querySelector('.aio-content');
      const sourceInput = content?.querySelector('.source-input');
      const notebookBox = content?.querySelector('.notebook-source-box');
      const siyuanBox = content?.querySelector('.siyuan-source-box');
      const searchInput = siyuanBox?.querySelector('input[placeholder*="思源文档"]');
      const searchButton = [...(siyuanBox?.querySelectorAll('button') || [])].find((item) => item.textContent.includes('搜索文档'));
      const targetInput = [...(content?.querySelectorAll('.candidate-settings label') || [])].find((label) => label.textContent.includes('目标卡片数'))?.querySelector('input');
      const deckInput = [...(content?.querySelectorAll('.candidate-settings label') || [])].find((label) => label.textContent.includes('写入牌组'))?.querySelector('input');
      const tagInput = [...(content?.querySelectorAll('.candidate-settings label') || [])].find((label) => label.textContent.includes('卡片标签'))?.querySelector('input');
      const rect = siyuanBox?.getBoundingClientRect();
      return {
        hasSourceInput: Boolean(sourceInput),
        sourcePlaceholder: sourceInput?.getAttribute('placeholder') || '',
        hasNotebookBox: Boolean(notebookBox),
        notebookText: notebookBox?.innerText?.slice(0, 160) || '',
        hasSiyuanBox: Boolean(siyuanBox),
        hasSiyuanSearchInput: Boolean(searchInput),
        hasSiyuanSearchButton: Boolean(searchButton),
        hasTargetInput: Boolean(targetInput),
        hasDeckInput: Boolean(deckInput),
        hasTagInput: Boolean(tagInput),
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
      };
    })()
  `, (value) => value?.hasSourceInput && value?.hasNotebookBox && value?.hasSiyuanBox, 5_000, 'mixed source controls did not render');

  assert.match(state.sourcePlaceholder, /OpenNotebook|思源文档/, 'Mixed source textarea should mention OpenNotebook / SiYuan docs.');
  assert.equal(state.hasSiyuanSearchInput, true, 'Mixed source mode should expose a SiYuan document search input.');
  assert.equal(state.hasSiyuanSearchButton, true, 'Mixed source mode should expose a SiYuan document search button.');
  assert.equal(state.hasTargetInput, true, 'Concepts panel should expose target card count.');
  assert.equal(state.hasDeckInput, true, 'Concepts panel should expose deck input.');
  assert.equal(state.hasTagInput, true, 'Concepts panel should expose tag input.');
  assert.ok(state.width > 300 && state.height > 20, `Mixed source box has unexpected geometry: ${JSON.stringify(state)}`);
  return state;
}

async function openAndMeasureSettings(cdp) {
  const clicked = await evaluate(cdp, `
    (() => {
      const app = document.querySelector('.all-in-one-app');
      const button = app
        ? [...app.querySelectorAll('.aio-nav-item[title]')].find((item) => item.getAttribute('title') === '设置')
        : null;
      if (!button) return false;
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      button.click();
      return true;
    })()
  `);
  assert.equal(clicked, true, 'failed to click plugin settings button');

  const state = await waitForValue(cdp, `
    (() => {
      const panel = document.querySelector('#all-in-one-settings .settings-panel');
      const dialog = panel?.closest('.b3-dialog') || panel?.closest('[role="dialog"]') || panel?.parentElement;
      const rect = panel?.getBoundingClientRect();
      const dialogRect = dialog?.getBoundingClientRect();
      const text = panel?.innerText?.trim() || '';
      const required = ['AI Provider 管理', '功能模型分配', '知识库搜索', 'Agent 管理', '保存设置'];
      const panelOverflowX = panel ? Math.max(0, panel.scrollWidth - panel.clientWidth) : 0;
      const dialogOverflowX = dialog ? Math.max(0, dialog.scrollWidth - dialog.clientWidth) : 0;
      return {
        hasPanel: Boolean(panel),
        textSample: text.slice(0, 600),
        textLength: text.length,
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
        dialogWidth: dialogRect ? Math.round(dialogRect.width) : 0,
        dialogHeight: dialogRect ? Math.round(dialogRect.height) : 0,
        panelOverflowX,
        dialogOverflowX,
        requiredText: Object.fromEntries(required.map((phrase) => [phrase, text.includes(phrase)])),
        hasStructuredOutputLabel: /JSON|结构化|原生|提示词|回退/.test(text),
        visible: Boolean(panel && rect && rect.width > 300 && rect.height > 300),
      };
    })()
  `, (value) => value?.hasPanel && value?.visible && value?.textLength > 0, 10_000, 'settings dialog did not render');

  for (const phrase of ['AI Provider 管理', '功能模型分配', '知识库搜索', 'Agent 管理', '保存设置']) {
    assert.equal(state.requiredText?.[phrase], true, `Settings panel should include ${phrase}.`);
  }
  assert.equal(state.hasStructuredOutputLabel, true, 'Settings panel should expose provider structured-output strategy labels.');
  assert.ok(state.panelOverflowX <= 24, `Settings panel has excessive horizontal overflow: ${state.panelOverflowX}px`);
  assert.ok(state.dialogOverflowX <= 24, `Settings dialog has excessive horizontal overflow: ${state.dialogOverflowX}px`);
  state.providerEditor = await openAndMeasureProviderEditor(cdp);
  return state;
}

async function openAndMeasureProviderEditor(cdp) {
  const clicked = await evaluate(cdp, `
    (() => {
      const panel = document.querySelector('#all-in-one-settings .settings-panel');
      const providerGroup = panel?.querySelector('.settings-group');
      const button = providerGroup
        ? [...providerGroup.querySelectorAll('button')].find((item) => item.textContent.trim() === '编辑')
        : null;
      if (!button) return false;
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      button.click();
      return true;
    })()
  `);
  assert.equal(clicked, true, 'failed to open Provider editor from settings panel');

  const state = await waitForValue(cdp, `
    (() => {
      const dialog = document.querySelector('[aria-labelledby="provider-dialog-title"]');
      const rect = dialog?.getBoundingClientRect();
      const text = dialog?.innerText || '';
      const byId = (id) => Boolean(dialog?.querySelector('#' + id));
      return {
        hasDialog: Boolean(dialog),
        title: dialog?.querySelector('#provider-dialog-title')?.textContent?.trim() || '',
        hasName: byId('provider-name'),
        hasBaseUrl: byId('provider-base-url'),
        hasApiKey: byId('provider-api-key'),
        hasModelList: text.includes('模型列表'),
        hasFetchModels: text.includes('从 API 获取模型列表'),
        hasManualAdd: text.includes('手动添加'),
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
        overflowX: dialog ? Math.max(0, dialog.scrollWidth - dialog.clientWidth) : 0,
      };
    })()
  `, (value) => value?.hasDialog, 5_000, 'Provider editor dialog did not render');

  assert.match(state.title, /编辑 Provider|新增 Provider/, 'Provider editor should expose a clear title.');
  assert.equal(state.hasName, true, 'Provider editor should expose provider name input.');
  assert.equal(state.hasBaseUrl, true, 'Provider editor should expose API endpoint input.');
  assert.equal(state.hasApiKey, true, 'Provider editor should expose API key input.');
  assert.equal(state.hasModelList, true, 'Provider editor should expose model list.');
  assert.equal(state.hasFetchModels, true, 'Provider editor should expose model fetching.');
  assert.equal(state.hasManualAdd, true, 'Provider editor should expose manual model add.');
  assert.ok(state.width > 300 && state.height > 300, `Provider editor has unexpected geometry: ${JSON.stringify(state)}`);
  assert.ok(state.overflowX <= 24, `Provider editor has excessive horizontal overflow: ${state.overflowX}px`);
  return state;
}

async function waitFor(cdp, expression, timeoutMs, message) {
  await waitForValue(cdp, expression, Boolean, timeoutMs, message);
}

async function waitForValue(cdp, expression, predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await evaluate(cdp, expression).catch((error) => ({ error: error.message }));
    if (predicate(lastValue)) return lastValue;
    await sleep(250);
  }
  throw new Error(`${message} Last value: ${JSON.stringify(lastValue)}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.value;
}

async function waitForWsUrl(cdpPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((resp) => resp.json());
      const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome may still be starting.
    }
    await sleep(250);
  }
  throw new Error(`Chrome DevTools endpoint did not start. ${stderr.slice(-1000)}`);
}

async function connectCdp(url) {
  assert.equal(typeof WebSocket, 'function', 'This Node.js runtime does not provide global WebSocket.');
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result || {});
  });

  return {
    send(method, params = {}) {
      const next = ++id;
      ws.send(JSON.stringify({ id: next, method, params }));
      return new Promise((resolve, reject) => pending.set(next, { resolve, reject }));
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findChrome() {
  const home = os.homedir();
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
        ];
  return candidates.find((candidate) => existsSync(candidate)) || '';
}
