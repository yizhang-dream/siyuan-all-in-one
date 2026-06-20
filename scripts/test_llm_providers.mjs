import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const tempDir = path.join(root, '_temp_llm_provider_test');
const entry = path.join(tempDir, 'fixture.ts');
const outfile = path.join(tempDir, 'fixture.mjs');

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });

await writeFile(entry, `
import assert from 'node:assert/strict';
import {
  buildLLMRequest,
  callLLM,
  extractLLMContent,
  fetchProviderModels,
  resolveLLMConfig,
} from '../src/libs/llm';

const messages = [
  { role: 'system' as const, content: 'Use strict JSON.' },
  { role: 'user' as const, content: 'Generate one card.' },
  { role: 'assistant' as const, content: 'Previous answer.' },
];

const appConfig: any = {
  providers: [
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: 'ds-key', models: ['deepseek-chat'], isBuiltIn: true },
    { id: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gm-key', models: ['gemini-2.5-flash'], isBuiltIn: true },
    { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'claude-key', models: ['claude-3-5-sonnet-latest'], isBuiltIn: true },
    { id: 'volcano', name: 'Volcano', baseUrl: 'https://ark.cn-beijing.volces.com', apiKey: 'ark-key', models: ['doubao-seed'], isBuiltIn: true },
    { id: 'zhipu', name: 'Zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'glm-key', models: ['glm-4-plus'], isBuiltIn: true },
    { id: 'local', name: 'Local', baseUrl: 'http://localhost:11434', apiKey: '', models: ['qwen2.5'], isBuiltIn: false },
  ],
  flashcardProviderId: 'deepseek',
  flashcardModel: 'deepseek-chat',
  mindmapProviderId: 'deepseek',
  mindmapModel: 'deepseek-chat',
  notebookEndpoint: '',
  cardsPerDay: 20,
  defaultDeck: 'default',
  agents: [],
};

assert.equal(resolveLLMConfig(appConfig, 'deepseek', '').endpoint, 'https://api.deepseek.com/v1/chat/completions');
assert.equal(resolveLLMConfig(appConfig, 'deepseek', '').model, 'deepseek-chat');
assert.equal(resolveLLMConfig(appConfig, 'gemini', 'gemini-2.5-flash').endpoint, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
assert.equal(resolveLLMConfig(appConfig, 'anthropic', 'claude-3-5-sonnet-latest').endpoint, 'https://api.anthropic.com/v1/messages');
assert.equal(resolveLLMConfig(appConfig, 'volcano', 'doubao-seed').endpoint, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
assert.equal(resolveLLMConfig(appConfig, 'zhipu', 'glm-4-plus').endpoint, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
assert.equal(resolveLLMConfig(appConfig, 'local', 'qwen2.5').endpoint, 'http://localhost:11434/v1/chat/completions');

const deepseekRequest = buildLLMRequest(messages, {
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',
  apiKey: 'ds-key',
  providerId: 'deepseek',
  maxTokens: 123,
  temperature: 0.2,
  timeout: 1000,
});
assert.equal(deepseekRequest.headers.Authorization, 'Bearer ds-key');
assert.equal(deepseekRequest.body.model, 'deepseek-chat');
assert.deepEqual(deepseekRequest.body.messages, messages);
assert.deepEqual(deepseekRequest.body.thinking, { type: 'disabled' });

const openaiNoKeyRequest = buildLLMRequest(messages, {
  endpoint: 'http://localhost:11434/v1/chat/completions',
  model: 'qwen2.5',
  apiKey: '',
  providerId: 'local',
  maxTokens: 123,
  temperature: 0.2,
  timeout: 1000,
});
assert.equal('Authorization' in openaiNoKeyRequest.headers, false);
assert.equal(openaiNoKeyRequest.body.thinking, undefined);

const geminiRequest = buildLLMRequest(messages, {
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  model: 'gemini-2.5-flash',
  apiKey: 'gm-key',
  providerId: 'gemini',
  maxTokens: 456,
  temperature: 0.4,
  timeout: 1000,
});
assert.equal(geminiRequest.headers['x-goog-api-key'], 'gm-key');
assert.equal(geminiRequest.body.systemInstruction.parts[0].text, 'Use strict JSON.');
assert.deepEqual(geminiRequest.body.contents.map((c: any) => c.role), ['user', 'model']);
assert.equal(geminiRequest.body.generationConfig.maxOutputTokens, 456);

const anthropicRequest = buildLLMRequest(messages, {
  endpoint: 'https://api.anthropic.com/v1/messages',
  model: 'claude-3-5-sonnet-latest',
  apiKey: 'claude-key',
  providerId: 'anthropic',
  maxTokens: 789,
  temperature: 0.1,
  timeout: 1000,
});
assert.equal(anthropicRequest.headers['x-api-key'], 'claude-key');
assert.equal(anthropicRequest.headers['anthropic-version'], '2023-06-01');
assert.equal(anthropicRequest.body.system, 'Use strict JSON.');
assert.deepEqual(anthropicRequest.body.messages.map((m: any) => m.role), ['user', 'assistant']);
assert.equal(anthropicRequest.body.max_tokens, 789);

assert.equal(
  extractLLMContent({ choices: [{ message: { content: [{ text: 'A' }, { text: 'B' }] } }] }, 'openai'),
  'AB'
);
assert.equal(
  extractLLMContent({ candidates: [{ content: { parts: [{ text: 'Gem' }, { text: 'ini' }] } }] }, 'gemini'),
  'Gemini'
);
assert.equal(
  extractLLMContent({ content: [{ type: 'text', text: 'Claude' }] }, 'anthropic'),
  'Claude'
);

const calls: any[] = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  if (url.includes('gemini')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'gemini-response' }] } }] }),
      text: async () => '',
    };
  }
  if (url.includes('anthropic')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: 'anthropic-response' }] }),
      text: async () => '',
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'openai-response' } }] }),
    text: async () => '',
  };
};

assert.equal(await callLLM(messages, {
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',
  apiKey: 'ds-key',
  providerId: 'deepseek',
  maxTokens: 128,
  temperature: 0.2,
  timeout: 1000,
}), 'openai-response');
assert.equal(calls.at(-1).body.thinking.type, 'disabled');

assert.equal(await callLLM(messages, {
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  model: 'gemini-2.5-flash',
  apiKey: 'gm-key',
  providerId: 'gemini',
  maxTokens: 128,
  temperature: 0.2,
  timeout: 1000,
}), 'gemini-response');
assert.equal(calls.at(-1).init.headers['x-goog-api-key'], 'gm-key');

assert.equal(await callLLM(messages, {
  endpoint: 'https://api.anthropic.com/v1/messages',
  model: 'claude-3-5-sonnet-latest',
  apiKey: 'claude-key',
  providerId: 'anthropic',
  maxTokens: 128,
  temperature: 0.2,
  timeout: 1000,
}), 'anthropic-response');
assert.equal(calls.at(-1).init.headers['anthropic-version'], '2023-06-01');

(globalThis as any).fetch = async (url: string, init: any) => {
  calls.push({ url, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({ models: [{ name: 'models/gemini-2.5-flash' }] }),
    text: async () => '',
  };
};
assert.deepEqual(await fetchProviderModels(appConfig.providers[1]), ['gemini-2.5-flash']);
assert.equal(calls.at(-1).init.headers['x-goog-api-key'], 'gm-key');

console.log(JSON.stringify({
  endpoints: true,
  requestAdapters: true,
  responseAdapters: true,
  callLLMProviderDispatch: true,
  modelListAuth: true,
}, null, 2));
`, 'utf8');

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
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
