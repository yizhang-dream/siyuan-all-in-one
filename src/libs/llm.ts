/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * OpenAI 兼容 API 客户端（支持 DeepSeek、OpenAI、Claude、Ollama 等任意兼容服务）。
 * - 修复 JSON 提取算法（括号配对，替代非贪婪正则）
 * - 按 agent 的 system prompt 生成卡片
 * - 按 count + agent.tokensPerCard 动态计算 maxTokens
 */

import type { AgentConfig } from './types';
import type { AppConfig, Provider } from './types';
import type { ToolDefinition, ToolCall } from './tools';

/** Anthropic API 版本头，用于 Anthropic Claude 请求 */
const ANTHROPIC_API_VERSION = '2023-06-01';

/** 单次 LLM 调用的输出 token 上限 */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * URL 解析辅助函数。
 * 处理用户粘贴的各种 baseUrl 格式，自动拼接正确的端点路径。
 *
 * 规则：
 * 1. 以 /chat/completions 结尾 → 视为完整聊天端点，直接用
 * 2. 以 / 结尾 → 去掉默认 endpoint 的 /v1 前缀
 * 3. 以 # 结尾 → 强制原样使用
 * 4. 其他 → 直接拼接完整默认 endpoint
 */
export function buildApiUrl(baseUrl: string, endpoint: string): string {
    const trimmed = (baseUrl || '').trim();
    const normalized = trimmed.replace(/\/+$/, '');

    // 规则3：以 # 结尾，强制原样
    if (trimmed.endsWith('#')) {
        return trimmed.slice(0, -1);
    }

    // 规则1：已是完整 chat 端点
    if (normalized.match(/\/chat\/completions$/i)) {
        if (endpoint.includes('/models')) {
            // 请求模型列表，回退到同层 /models
            return normalized.replace(/\/chat\/completions$/i, '') + '/models';
        }
        return normalized;
    }

    // 规则2：以 / 结尾，去掉 /v1 前缀
    if (trimmed.endsWith('/')) {
        const base = trimmed.slice(0, -1);
        const ep = endpoint.startsWith('/v1') ? endpoint.substring(3) : endpoint;
        return base + ep;
    }

    // 规则4：直接拼接
    return normalized + endpoint;
}

/**
 * 根据 provider id 返回聊天端点和模型列表端点。
 * 不同 provider 的端点路径不同。
 */
export function getEndpoints(providerId: string): { chat: string; models: string } {
    switch (providerId) {
        case 'gemini':
            return { chat: '/v1beta/models/{model}:generateContent', models: '/v1beta/models' };
        case 'volcano':
            return { chat: '/api/v3/chat/completions', models: '/api/v3/models' };
        case 'anthropic':
            return { chat: '/v1/messages', models: '/v1/models' };
        case 'glm':
            // 智谱 BigModel（标准/直充）：baseUrl 已含 /api/paas/v4，端点直接拼 /chat/completions
            return { chat: '/chat/completions', models: '/models' };
        case 'glm-coding':
            // 智谱编程套餐：baseUrl 已含 /api/coding/paas/v4，端点路径相同
            return { chat: '/chat/completions', models: '/models' };
        // 以下 provider 的 baseUrl 已含 /v1 路径，端点不使用 /v1 前缀
        case 'moonshot-coding':
        case 'qwen':
        case 'hunyuan':
        case 'stepfun':
        case 'lingyiwanwu':
        case 'opencode-zen':
        case 'opencode-go':
            return { chat: '/chat/completions', models: '/models' };
        case 'volcano-coding':
            // 火山引擎 编程套餐：使用 /api/coding/v3 路径
            return { chat: '/api/coding/v3/chat/completions', models: '/api/coding/v3/models' };
        default:
            return { chat: '/v1/chat/completions', models: '/v1/models' };
    }
}

/**
 * 从 Provider 注册表 + 功能指针解析出 LLMConfig。
 * 自动拼接聊天端点 URL。
 */
export function resolveLLMConfig(
    appConfig: AppConfig,
    providerId: string,
    model: string
): LLMConfig {
    const provider = (appConfig.providers || []).find((p) => p.id === providerId);
    const endpoints = getEndpoints(providerId);
    const chatUrl = provider
        ? buildApiUrl(provider.baseUrl, endpoints.chat).replace('{model}', model)
        : '';
    return {
        endpoint: chatUrl,
        model: model || provider?.models?.[0] || '',
        apiKey: provider?.apiKey || '',
        providerId,
        disableThinking: provider?.disableThinking,
    };
}

/**
 * 从 Provider 的 API 自动获取可用模型列表。
 * 支持 OpenAI 格式（/v1/models）、Gemini 格式、Anthropic 格式。
 */
export async function fetchProviderModels(provider: Provider): Promise<string[]> {
    const endpoints = getEndpoints(provider.id);
    const url = buildApiUrl(provider.baseUrl, endpoints.models);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // 不同 provider 的认证方式
    if (provider.id === 'gemini') {
        if (provider.apiKey) headers['x-goog-api-key'] = provider.apiKey;
    } else if (provider.id === 'anthropic') {
        if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
        headers['anthropic-version'] = ANTHROPIC_API_VERSION;
    } else {
        if (provider.apiKey) headers['Authorization'] = 'Bearer ' + provider.apiKey;
    }

    const resp = await fetch(url, { method: 'GET', headers });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`获取模型列表失败 (${resp.status}): ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    let modelsArray: any[] = [];

    if (provider.id === 'gemini') {
        // Gemini 格式：{ models: [{ name: "models/gemini-pro", displayName: "..." }] }
        modelsArray = (data.models || []).map((m: any) => ({
            id: String(m.name || '').replace('models/', ''),
        }));
    } else if (Array.isArray(data)) {
        modelsArray = data;
    } else if (data.data && Array.isArray(data.data)) {
        // OpenAI 格式：{ data: [{ id: "gpt-4o" }] }
        modelsArray = data.data;
    } else if (data.models && Array.isArray(data.models)) {
        modelsArray = data.models;
    }

    // 提取 id 字符串，过滤空值
    const modelIds = modelsArray
        .map((m: any) => {
            if (typeof m === 'string') return m;
            return m.id || m.name || '';
        })
        .filter(Boolean) as string[];

    return modelIds;
}

export interface LLMConfig {
    endpoint?: string;
    model?: string;
    apiKey?: string;
    providerId?: string;
    responseFormat?: 'text' | 'json_object';
    maxTokens?: number;
    temperature?: number;
    timeout?: number;
    /** 是否禁用思考/推理 token（如 DeepSeek） */
    disableThinking?: boolean;
    /** 请求失败时的最大重试次数（默认 5） */
    maxRetries?: number;
    /** 指数退避的初始延迟（ms）（默认 15000） */
    retryDelayMs?: number;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export type StructuredOutputStrategy = 'openai-compatible' | 'gemini-native' | 'prompt-only';

export interface ProviderCapabilities {
    structuredOutputStrategy: StructuredOutputStrategy;
    structuredOutputLabel: string;
    usesNativeJsonConstraint: boolean;
    fallbackOnUnsupported: boolean;
}

/**
 * Provider 能力说明只用于请求构造和 UI 可观测性，不写入用户配置。
 * 自定义兼容服务默认先尝试 OpenAI JSON mode，再由 pipeline 在不支持时回退。
 */
export function getProviderCapabilities(providerId = 'openai-compatible'): ProviderCapabilities {
    if (providerId === 'gemini') {
        return {
            structuredOutputStrategy: 'gemini-native',
            structuredOutputLabel: 'JSON 原生',
            usesNativeJsonConstraint: true,
            fallbackOnUnsupported: true,
        };
    }
    if (providerId === 'anthropic') {
        return {
            structuredOutputStrategy: 'prompt-only',
            structuredOutputLabel: 'JSON 提示词',
            usesNativeJsonConstraint: false,
            fallbackOnUnsupported: false,
        };
    }
    return {
        structuredOutputStrategy: 'openai-compatible',
        structuredOutputLabel: 'JSON mode + 回退',
        usesNativeJsonConstraint: true,
        fallbackOnUnsupported: true,
    };
}

const DEFAULT_CONFIG: Required<LLMConfig> = {
    endpoint: '',
    model: '',
    apiKey: '',
    providerId: '',
    responseFormat: 'text',
    maxTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.7,
    timeout: 300_000,
    disableThinking: false,
    maxRetries: 5,
    retryDelayMs: 15_000,
};

export class LLMError extends Error {
    status: number;
    constructor(message: string, status = 0) {
        super(message);
        this.name = 'LLMError';
        this.status = status;
    }
}

export interface LLMRequest {
    headers: Record<string, string>;
    body: Record<string, any>;
}

export interface CallLLMOptions {
    tools?: ToolDefinition[];
    abortSignal?: AbortSignal;
    onChunk?: (text: string) => void;
    onToolCallChunk?: (toolCall: ToolCall) => void;
}

/**
 * 根据 provider 构造请求体和认证头。
 * 外部继续传统一的 ChatMessage，差异集中在这里，避免 UI/流水线感知厂商协议。
 */
export function buildLLMRequest(messages: ChatMessage[], config: Required<LLMConfig>): LLMRequest {
    const providerId = config.providerId || 'openai-compatible';
    const capabilities = getProviderCapabilities(providerId);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (providerId === 'gemini') {
        if (config.apiKey) headers['x-goog-api-key'] = config.apiKey;
        const systemText = joinMessages(messages, 'system');
        const contents = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            }));
        const body: Record<string, any> = {
            contents,
            generationConfig: {
                temperature: config.temperature,
                maxOutputTokens: config.maxTokens,
            },
        };
        if (config.responseFormat === 'json_object' && capabilities.structuredOutputStrategy === 'gemini-native') {
            body.generationConfig.responseMimeType = 'application/json';
        }
        if (systemText) {
            body.systemInstruction = { parts: [{ text: systemText }] };
        }
        return { headers, body };
    }

    if (providerId === 'anthropic') {
        if (config.apiKey) headers['x-api-key'] = config.apiKey;
        headers['anthropic-version'] = ANTHROPIC_API_VERSION;
        const systemText = joinMessages(messages, 'system');
        const body: Record<string, any> = {
            model: config.model,
            max_tokens: config.maxTokens,
            temperature: config.temperature,
            messages: messages
                .filter((m) => m.role !== 'system')
                .map((m) => ({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: m.content,
                })),
        };
        if (systemText) body.system = systemText;
        return { headers, body };
    }

    if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;
    const body: Record<string, any> = {
        model: config.model,
        messages,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
    };
    if (config.responseFormat === 'json_object' && capabilities.structuredOutputStrategy === 'openai-compatible') {
        body.response_format = { type: 'json_object' };
    }
    if (config.disableThinking || providerId === 'deepseek') {
        body.thinking = { type: 'disabled' };
    }
    return { headers, body };
}

export function extractLLMContent(json: any, providerId = 'openai-compatible'): string {
    let content: unknown;

    if (providerId === 'gemini') {
        const parts = json?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
            content = parts
                .map((part: any) => typeof part?.text === 'string' ? part.text : '')
                .filter(Boolean)
                .join('');
        }
    } else if (providerId === 'anthropic') {
        const blocks = json?.content;
        if (Array.isArray(blocks)) {
            content = blocks
                .map((block: any) => typeof block?.text === 'string' ? block.text : '')
                .filter(Boolean)
                .join('');
        }
    } else {
        content = json?.choices?.[0]?.message?.content;
        if (Array.isArray(content)) {
            content = content
                .map((part: any) => {
                    if (typeof part === 'string') return part;
                    if (typeof part?.text === 'string') return part.text;
                    if (typeof part?.content === 'string') return part.content;
                    return '';
                })
                .filter(Boolean)
                .join('');
        }
    }

    if (typeof content !== 'string' || !content) {
        // Defensive: include API error and raw response for debugging
        let details = '';

        // Check for API-level error field (e.g. { error: { message: '...' } })
        const apiError = json?.error;
        if (apiError) {
            if (typeof apiError === 'string') {
                details += `API error: ${apiError}. `;
            } else if (apiError?.message) {
                details += `API error: ${apiError.message}. `;
            } else {
                details += `API error: ${JSON.stringify(apiError).slice(0, 300)}. `;
            }
        }

        // Include raw response snippet so the user can see what the model returned
        try {
            const rawSnippet = JSON.stringify(json).slice(0, 1000);
            details += `Raw response: ${rawSnippet}`;
            console.warn('[llm] Full raw response:', JSON.stringify(json));
        } catch {
            details += `Raw response: [unable to stringify]`;
        }

        throw new LLMError(`API 响应缺少可解析的文本内容（provider: ${providerId}）: ${details}`, 0);
    }
    return content;
}

/**
 * 视觉 API 的图片输入。
 * base64 为裸 base64 字符串（不含 data: 前缀）。
 */
export interface VisionImage {
    base64: string;
    mimeType?: string;
}

/**
 * 调用 OpenAI 兼容的视觉 API 提取图片中的文字 / LaTeX 公式。
 * 复用 resolveLLMConfig 查找 endpoint/apiKey，使用与 callLLM 相同的重试逻辑。
 * 超时设为 60s（视觉调用比纯文本慢）。
 */
export async function callVisionLLM(
    appConfig: AppConfig,
    providerId: string,
    model: string,
    prompt: string,
    images: VisionImage[],
    options?: { maxTokens?: number }
): Promise<string> {
    const cfg = resolveLLMConfig(appConfig, providerId, model);
    if (!cfg.endpoint || !cfg.model) {
        const msg = !cfg.model && cfg.endpoint
            ? '请先在设置中点击"获取模型"选择模型'
            : '请先在设置中配置视觉模型 Provider';
        throw new LLMError(msg, 0);
    }

    const content: any[] = [{ type: 'text', text: prompt }];
    for (const img of images) {
        content.push({
            type: 'image_url',
            image_url: {
                url: `data:${img.mimeType || 'image/png'};base64,${img.base64}`,
                detail: 'high',
            },
        });
    }

    const messages = [{ role: 'user', content }] as any[];

    // 合并配置（不覆盖 endpoint/model/apiKey，用 resolveLLMConfig 的）
    const effectiveConfig: Record<string, any> = {};
    for (const [key, value] of Object.entries({
        model: cfg.model,
        endpoint: cfg.endpoint,
        apiKey: cfg.apiKey,
        providerId: cfg.providerId,
        maxTokens: options?.maxTokens ?? 4096,
        temperature: 0.1,
        timeout: 60_000,
        maxRetries: 3,
        retryDelayMs: 5_000,
        disableThinking: cfg.disableThinking,
    })) {
        if (value !== undefined && value !== null && value !== '') {
            effectiveConfig[key] = value;
        }
    }
    const mergedCfg = { ...DEFAULT_CONFIG, ...effectiveConfig } as Required<LLMConfig>;
    mergedCfg.endpoint = cfg.endpoint || '';
    mergedCfg.model = cfg.model || '';

    const maxRetries = mergedCfg.maxRetries;
    const baseDelay = mergedCfg.retryDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), mergedCfg.timeout);

            // 构造 OpenAI 兼容的请求（不使用 buildLLMRequest，因为需要 image_url 格式）
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (mergedCfg.apiKey) headers['Authorization'] = 'Bearer ' + mergedCfg.apiKey;

            const body: Record<string, any> = {
                model: mergedCfg.model,
                messages,
                max_tokens: mergedCfg.maxTokens,
                temperature: mergedCfg.temperature,
            };
            if (mergedCfg.disableThinking) {
                body.thinking = { type: 'disabled' };
            }

            const resp = await fetch(mergedCfg.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (resp.ok) {
                const json = await resp.json();
                return extractLLMContent(json, mergedCfg.providerId);
            }

            if (resp.status === 429) {
                if (attempt < maxRetries) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    console.warn(`[vision] 429 限流，${delay}ms 后重试 (${attempt + 1}/${maxRetries})`);
                    await sleep(delay);
                    continue;
                }
                throw new LLMError('视觉 API 限流，已达最大重试次数', 429);
            }

            const errBody = await resp.text().catch(() => '');
            throw new LLMError(`视觉 API 错误 ${resp.status}: ${errBody.slice(0, 200)}`, resp.status);
        } catch (err: any) {
            if (err instanceof LLMError) throw err;
            if (err.name === 'AbortError') {
                throw new LLMError('视觉 API 请求超时', 0);
            }
            if (attempt === maxRetries) {
                throw new LLMError(`视觉 API 网络错误（重试 ${maxRetries} 次后）: ${err.message}`, 0);
            }
            const delay = baseDelay * Math.pow(2, attempt);
            console.warn(`[vision] 网络错误 (尝试 ${attempt + 1})，${delay}ms 后重试:`, err.message);
            await sleep(delay);
        }
    }

    throw new LLMError('视觉 API 调用失败', 0);
}

function joinMessages(messages: ChatMessage[], role: ChatMessage['role']): string {
    return messages
        .filter((m) => m.role === role && m.content.trim())
        .map((m) => m.content.trim())
        .join('\n\n');
}

/**
 * 调用 LLM API，带 429 指数退避。
 * 返回 response content 字符串（无 tools 参数）或完整响应（含 tool_calls）。
 *
 * 重载1: 无 tools → 返回 string（向后兼容）
 */
export async function callLLM(
    messages: ChatMessage[],
    config?: LLMConfig
): Promise<string>;

/**
 * 重载2: 有 tools → 返回包含 content/toolCalls/finishReason 的对象
 */
export async function callLLM(
    messages: ChatMessage[],
    config: LLMConfig,
    options: CallLLMOptions
): Promise<{ content: string; toolCalls?: ToolCall[]; finishReason: string }>;

export async function callLLM(
    messages: ChatMessage[],
    config?: LLMConfig,
    options?: CallLLMOptions
): Promise<any> {
    // 安全合并：过滤掉空值，防止用户留空的字段（如 model=''）覆盖默认值
    const effectiveConfig: Record<string, any> = {};
    if (config) {
        for (const [key, value] of Object.entries(config)) {
            if (value !== undefined && value !== null && value !== '') {
                effectiveConfig[key] = value;
            }
        }
    }
    const cfg = { ...DEFAULT_CONFIG, ...effectiveConfig } as Required<LLMConfig>;

    // 校验必要字段：用户必须在设置中配置 Provider
    if (!cfg.endpoint || !cfg.model || !cfg.providerId) {
        const missing = [];
        if (!cfg.endpoint) missing.push('endpoint');
        if (!cfg.model) missing.push('model');
        if (!cfg.providerId) missing.push('providerId');
        const msg = !cfg.model && cfg.providerId
            ? '请先在设置中点击"获取模型"选择模型'
            : `请先在设置中配置 AI Provider（缺少: ${missing.join(', ')}）`;
        throw new LLMError(msg, 0);
    }

    const maxRetries = cfg.maxRetries;
    const baseDelay = cfg.retryDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), cfg.timeout);

            const request = buildLLMRequest(messages, cfg);

            // Inject tools into the request body if provided
            const body = { ...request.body };
            if (options?.tools && options.tools.length > 0) {
                body.tools = options.tools;
                body.tool_choice = 'auto';
            }

            // Enable SSE streaming if callbacks are provided
            const useStreaming = !!(options?.onChunk || options?.onToolCallChunk);
            if (useStreaming) {
                body.stream = true;
            }

            const resp = await fetch(cfg.endpoint, {
                method: 'POST',
                headers: request.headers,
                body: JSON.stringify(body),
                signal: options?.abortSignal || controller.signal,
            });

            clearTimeout(timeoutId);

            if (resp.ok) {
                if (useStreaming && resp.body) {
                    return await parseStreamingResponse(resp, cfg.providerId, options!.tools, options!.onChunk, options!.onToolCallChunk);
                }
                const json = await resp.json();
                return parseLLMResponse(json, cfg.providerId, options?.tools);
            }

            if (resp.status === 429) {
                if (attempt < maxRetries) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    console.warn(`[llm] 429 限流，${delay}ms 后重试 (${attempt + 1}/${maxRetries})`);
                    await sleep(delay);
                    continue;
                }
                throw new LLMError('API 限流，已达最大重试次数', 429);
            }

            const errBody = await resp.text().catch(() => '');
            throw new LLMError(`API 错误 ${resp.status}: ${errBody.slice(0, 200)}`, resp.status);
        } catch (err: any) {
            if (err instanceof LLMError) throw err;
            if (err.name === 'AbortError') {
                throw new LLMError('API 请求超时', 0);
            }
            if (attempt === maxRetries) {
                throw new LLMError(`API 网络错误（重试 ${maxRetries} 次后）: ${err.message}`, 0);
            }
            const delay = baseDelay * Math.pow(2, attempt);
            console.warn(`[llm] 网络错误 (尝试 ${attempt + 1})，${delay}ms 后重试:`, err.message);
            await sleep(delay);
        }
    }

    throw new LLMError('API 调用失败', 0);
}

/** Parse LLM response, extracting content and optionally tool_calls. */
function parseLLMResponse(
    json: any,
    providerId: string,
    tools?: ToolDefinition[]
): string | { content: string; toolCalls?: ToolCall[]; finishReason: string } {
    // Helper: extract content string, using '' for null/undefined
    function safeContent(raw: any): string {
        if (typeof raw === 'string') return raw;
        if (raw === null || raw === undefined) return '';
        return String(raw);
    }

    if (providerId === 'gemini') {
        if (tools) {
            return { content: extractLLMContent(json, providerId), toolCalls: undefined, finishReason: 'stop' };
        }
        return extractLLMContent(json, providerId);
    }
    if (providerId === 'anthropic') {
        if (tools) {
            return { content: extractLLMContent(json, providerId), toolCalls: undefined, finishReason: 'stop' };
        }
        return extractLLMContent(json, providerId);
    }

    const choice = json?.choices?.[0];
    if (!choice) {
        throw new LLMError(`API 响应缺少 choices: ${JSON.stringify(json).slice(0, 500)}`, 0);
    }

    const message = choice.message || {};
    const content: string = safeContent(message.content);
    const rawToolCalls = message.tool_calls;
    const finishReason: string = choice.finish_reason || 'stop';

    if (tools && rawToolCalls && Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
        const toolCalls: ToolCall[] = rawToolCalls.map((tc: any) => ({
            id: tc.id || '',
            type: 'function' as const,
            function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
            },
        }));
        return { content, toolCalls, finishReason };
    }

    if (tools && finishReason === 'tool_calls') {
        return { content, toolCalls: undefined, finishReason };
    }

    // When tools are provided, always return object format (content is always a string)
    if (tools) {
        return { content, toolCalls: undefined, finishReason };
    }

    // No tools — return content string for backward compatibility
    if (!content) {
        throw new LLMError(`API 响应缺少可解析的文本内容（provider: ${providerId}）: ${JSON.stringify(json).slice(0, 500)}`, 0);
    }
    return content;
}

/**
 * Parse SSE streaming response from OpenAI-compatible API.
 * Accumulates text deltas and tool call deltas, then returns the same format as parseLLMResponse.
 */
async function parseStreamingResponse(
    resp: Response,
    providerId: string,
    tools?: ToolDefinition[],
    onChunk?: (text: string) => void,
    onToolCallChunk?: (toolCall: ToolCall) => void,
): Promise<string | { content: string; toolCalls?: ToolCall[]; finishReason: string }> {
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedContent = '';
    const toolCallAccumulators: Map<number, any> = new Map();
    let finishReason = 'stop';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
                const parsed = JSON.parse(dataStr);
                const choice = parsed.choices?.[0];
                if (!choice) continue;

                if (choice.finish_reason) {
                    finishReason = choice.finish_reason;
                }

                const delta = choice.delta || {};

                // Text delta
                if (delta.content) {
                    accumulatedContent += delta.content;
                    onChunk?.(delta.content);
                }

                // Tool call delta — accumulate by index
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCallAccumulators.has(idx)) {
                            toolCallAccumulators.set(idx, {
                                id: tc.id || '',
                                type: 'function' as const,
                                function: {
                                    name: tc.function?.name || '',
                                    arguments: tc.function?.arguments || '',
                                },
                            });
                        } else {
                            const existing = toolCallAccumulators.get(idx);
                            if (tc.function) {
                                if (tc.function.name) existing.function.name = tc.function.name;
                                if (tc.function.arguments) existing.function.arguments += tc.function.arguments;
                            }
                            if (tc.id) existing.id = tc.id;
                        }
                    }
                }
            } catch {
                // Skip unparseable chunks
            }
        }
    }

    // Build final tool calls from accumulators
    const toolCalls: ToolCall[] | undefined = toolCallAccumulators.size > 0
        ? Array.from(toolCallAccumulators.values()).map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
            },
        }))
        : undefined;

    // Notify complete tool calls
    if (toolCalls && onToolCallChunk) {
        for (const tc of toolCalls) {
            onToolCallChunk(tc);
        }
    }

    const content = accumulatedContent;

    if (tools) {
        return { content: content || '', toolCalls, finishReason };
    }

    // No tools — return content string for backward compatibility
    if (!content) {
        throw new LLMError(`API 流式响应未返回文本内容（provider: ${providerId}）`, 0);
    }
    return content;
}

/** AI 生成的原始卡片数据 */
export interface GeneratedCard {
    question: string;
    answer: string;
    hint: string;
}

/**
 * 用 AI 生成知识卡片。
 * @param topic 主题
 * @param count 数量
 * @param agent 用户自定义 agent（提供 system prompt + token 策略 + 语言/风格/难度）
 * @param config LLM 配置
 * @param context 知识库上下文（可选）
 */
export async function generateFlashcards(
    topic: string,
    count: number,
    agent: AgentConfig,
    config?: LLMConfig,
    context?: string
): Promise<GeneratedCard[]> {
    // 按 count + agent.tokensPerCard 动态计算 maxTokens
    const estimatedTokens = Math.min(MAX_OUTPUT_TOKENS, count * (agent.tokensPerCard || 400) + 500);
    const effectiveConfig: LLMConfig = {
        ...config,
        maxTokens: Math.max(config?.maxTokens || 0, estimatedTokens),
    };

    // 注入占位符到用户的 system prompt
    const filledPrompt = (agent.prompt || '')
        .replace(/\{topic\}/g, topic)
        .replace(/\{count\}/g, String(count))
        .replace(/\{language\}/g, agent.language || 'auto')
        .replace(/\{style\}/g, agent.style || 'standard')
        .replace(/\{difficulty\}/g, agent.difficulty || 'intermediate')
        .replace(/\{context\}/g, context || '');

    // 固定的输出格式约束（代码追加，用户不用写）
    const systemPrompt = `${filledPrompt}

输出要求（必须严格遵守）：
- 严格输出 JSON 数组格式，不要包含 markdown 代码块标记
- 每张卡片包含 question、answer、hint 三个字段
- 生成 ${count} 张卡片
- 公式必须使用 LaTeX 定界符：行内公式用 $...$，独立公式用 $$...$$
- 输出格式示例：[{"question":"...","answer":"...","hint":"..."}]`;

    const userPrompt = context
        ? `主题：${topic}\n\n请生成 ${count} 张知识卡片。\n\n参考以下笔记内容：\n${context}`
        : `主题：${topic}\n\n请生成 ${count} 张知识卡片。`;

    const content = await callLLM(
        [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        effectiveConfig
    );

    return parseGeneratedCards(content);
}

/** 知识树节点（移植自 flashcard_mindmap.py 的 JSON 结构） */
export interface KnowledgeTree {
    subtopics: Array<{
        name: string;
        knowledge_points: Array<{
            name: string;
            cards: number[]; // 卡片在输入数组中的 1-based 索引
        }>;
    }>;
}

/**
 * 用 AI 对卡片做知识树分组。
 * @param cards 编号后的卡片列表 [{num, question}, ...]
 * @param config LLM 配置
 *
 * 提示词设计参考：
 * - mindmap-generator：反幻觉条款（只基于输入内容，不编造）
 * - auto-mindmapping：few-shot 示例驱动（给完整 JSON 样例）
 * - MindGeniusAI：CJK 语言检测 + 双语模板
 */
export async function generateKnowledgeTree(
    numberedCards: Array<{ num: number; question: string }>,
    config?: LLMConfig
): Promise<KnowledgeTree> {
    const cardList = numberedCards
        .map((c) => `[${c.num}] ${c.question}`)
        .join('\n');

    // CJK 语言检测：卡片内容含中日韩字符 → 中文提示词，否则英文
    const isCJK = numberedCards.some((c) => /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(c.question));

    const systemPrompt = isCJK
        ? `你是一位学科知识结构专家。将给定的卡片列表组织成层次化的知识树结构。

输出严格 JSON 格式（不要 markdown 标记，不要额外说明）：
{
  "subtopics": [
    {
      "name": "主题名（简洁概括，2-6 字）",
      "knowledge_points": [
        {"name": "知识点名", "cards": [1, 5, 12]}
      ]
    }
  ]
}

分组要求：
1. 主题名和知识点名必须使用中文，准确概括该组卡片的共同学科概念
2. cards 数组中的数字是输入卡片的编号（1-based），每张卡片至少出现一次
3. 允许一张卡片出现在多个知识点（如某卡涉及多个概念）
4. subtopics 3-6 个，每个下 2-5 个 knowledge_points
5. 同一主题内的知识点不应有概念重叠

重要约束（防止幻觉）：
- 主题名和知识点名必须严格基于卡片内容，不要编造卡片中不存在的概念
- 不要使用泛化的分类（如"其他"、"综合"），每个主题都必须有明确的学科含义
- 如果卡片内容是英文，主题名仍用中文概括，但可以保留关键英文术语`
        : `You are a subject-matter expert at organizing study cards into a hierarchical knowledge tree.

Output strictly JSON (no markdown, no extra text):
{
  "subtopics": [
    {
      "name": "Topic name (concise, 2-5 words)",
      "knowledge_points": [
        {"name": "Knowledge point name", "cards": [1, 5, 12]}
      ]
    }
  ]
}

Requirements:
1. Topic and knowledge point names must accurately reflect the shared concept of the cards in that group
2. The numbers in cards arrays are 1-based card numbers from the input; every card must appear at least once
3. A card may appear in multiple knowledge points if it covers multiple concepts
4. 3-6 subtopics, each with 2-5 knowledge points
5. Knowledge points within the same topic should not overlap conceptually

Anti-hallucination constraints:
- Names must be strictly based on card content; do not invent concepts not present in the cards
- Avoid generic categories like "Other" or "Miscellaneous"; every topic must have a clear subject meaning`;

    // few-shot 示例（来自 auto-mindmapping 的设计理念：给完整样例比写规则更有效）
    const examplePrompt = isCJK
        ? `\n示例（输入 5 张物理卡片时的正确输出）：
输入：[1] 牛顿第二定律 [2] 加速度的定义 [3] 牛顿第三定律 [4] 动量守恒 [5] 冲量定理
输出：{"subtopics":[{"name":"牛顿运动定律","knowledge_points":[{"name":"第二定律与加速度","cards":[1,2]},{"name":"第三定律","cards":[3]}]},{"name":"动量与冲量","knowledge_points":[{"name":"动量守恒","cards":[4]},{"name":"冲量定理","cards":[5]}]}]}`
        : '';

    const content = await callLLM(
        [
            { role: 'system', content: systemPrompt + examplePrompt },
            { role: 'user', content: `以下是 ${numberedCards.length} 张卡片，请组织成知识树：\n\n${cardList}` },
        ],
        { ...config, temperature: 0.3 }
    );

    try {
        return parseLLMJSON(content, 'object');
    } catch (e: any) {
        throw new LLMError(`知识树 JSON 解析失败: ${e.message}`, 0);
    }
}

// ─── 内部辅助 ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** 解析 AI 生成的卡片 JSON */
function parseGeneratedCards(content: string): GeneratedCard[] {
    try {
        const parsed = parseLLMJSON(content, 'array');
        if (!Array.isArray(parsed)) throw new Error('响应不是数组');
        return parsed.map((item: any) => ({
            question: String(item?.question ?? ''),
            answer: String(item?.answer ?? ''),
            hint: String(item?.hint ?? ''),
        }));
    } catch (e: any) {
        throw new LLMError(`卡片 JSON 解析失败: ${e.message}`, 0);
    }
}

/**
 * 从文本中提取 JSON。使用括号配对算法，支持嵌套结构和含特殊字符的内容。
 * @param prefer 'array' 优先匹配 [...]，'object' 优先匹配 {...}
 */
export function extractJSON(text: string, prefer: 'array' | 'object' = 'array'): string | null {
    const openChar = prefer === 'array' ? '[' : '{';
    const closeChar = prefer === 'array' ? ']' : '}';
    const altOpen = prefer === 'array' ? '{' : '[';
    const altClose = prefer === 'array' ? '}' : ']';

    // 先尝试优先类型
    let result = findBalanced(text, openChar, closeChar);
    if (result) return result;
    // 再尝试另一种
    result = findBalanced(text, altOpen, altClose);
    return result;
}

/**
 * 从 LLM 响应中解析 JSON，并对常见的轻微格式漂移做修复。
 * 修复范围刻意保持保守：不补字段、不猜业务语义，只修 JSON 语法噪声。
 */
export function parseLLMJSON(text: string, prefer: 'array' | 'object' = 'array'): any {
    const candidates = collectBalancedCandidates(text, prefer);
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            try {
                return JSON.parse(repairLooseJSON(candidate));
            } catch {
                // Try next balanced candidate.
            }
        }
    }

    throw new LLMError(`无法从 AI 响应中解析 JSON: ${text.slice(0, 300)}`, 0);
}

/** 用括号配对算法找到第一个完整匹配的 JSON 片段。 */
function findBalanced(text: string, open: string, close: string): string | null {
    let start = text.indexOf(open);
    while (start !== -1) {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                continue;
            }
            if (inString) continue;

            if (ch === open) depth++;
            else if (ch === close) {
                depth--;
                if (depth === 0) {
                    const candidate = text.slice(start, i + 1);
                    try {
                        JSON.parse(candidate);
                        return candidate;
                    } catch {
                        // 不是有效 JSON，继续找下一个起始位置
                        break;
                    }
                }
            }
        }
        start = text.indexOf(open, start + 1);
    }
    return null;
}

function collectBalancedCandidates(text: string, prefer: 'array' | 'object'): string[] {
    const primary = prefer === 'array'
        ? findAllBalanced(text, '[', ']')
        : findAllBalanced(text, '{', '}');
    if (primary.length > 0) return primary.sort((a, b) => b.length - a.length);
    const secondary = prefer === 'array'
        ? findAllBalanced(text, '{', '}')
        : findAllBalanced(text, '[', ']');
    return secondary.sort((a, b) => b.length - a.length);
}

function findAllBalanced(text: string, open: string, close: string): string[] {
    const out: string[] = [];
    let start = text.indexOf(open);
    while (start !== -1) {
        let depth = 0;
        let inString = false;
        let quote = '';
        let escape = false;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if ((ch === '"' || ch === "'") && (!inString || ch === quote)) {
                inString = !inString;
                quote = inString ? ch : '';
                continue;
            }
            if (inString) continue;

            if (ch === open) depth++;
            else if (ch === close) {
                depth--;
                if (depth === 0) {
                    out.push(text.slice(start, i + 1));
                    break;
                }
            }
        }
        start = text.indexOf(open, start + 1);
    }
    return out;
}

function repairLooseJSON(input: string): string {
    let text = input
        .replace(/^\uFEFF/, '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();

    text = replaceBareLiterals(replaceSpecialNumbers(stripJsonComments(text)));
    text = text
        .replace(/，(?=\s*["'}\]\w-])/g, ',')
        .replace(/：(?=\s*)/g, ':')
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, (_m, prefix, key) => `${prefix}"${key.replace(/"/g, '\\"')}":`)
        .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, value) => `:"${value.replace(/"/g, '\\"')}"`)
        .replace(/([\[,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, prefix, value) => `${prefix}"${value.replace(/"/g, '\\"')}"`);

    let previous = '';
    while (previous !== text) {
        previous = text;
        text = text.replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":');
    }

    return escapeStringWhitespace(text);
}

function replaceBareLiterals(input: string): string {
    let out = '';
    let inString = false;
    let quote = '';
    let escape = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (escape) {
            out += ch;
            escape = false;
            continue;
        }
        if (ch === '\\') {
            out += ch;
            escape = true;
            continue;
        }
        if ((ch === '"' || ch === "'") && (!inString || ch === quote)) {
            inString = !inString;
            quote = inString ? ch : '';
            out += ch;
            continue;
        }
        if (!inString && /[A-Za-z_]/.test(ch)) {
            let end = i + 1;
            while (end < input.length && /[A-Za-z_]/.test(input[end])) end++;
            const word = input.slice(i, end);
            if (word === 'True') out += 'true';
            else if (word === 'False') out += 'false';
            else if (word === 'None' || word === 'undefined') out += 'null';
            else out += word;
            i = end - 1;
            continue;
        }
        out += ch;
    }
    return out;
}

function replaceSpecialNumbers(input: string): string {
    let out = '';
    let inString = false;
    let quote = '';
    let escape = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (escape) {
            out += ch;
            escape = false;
            continue;
        }
        if (ch === '\\') {
            out += ch;
            escape = true;
            continue;
        }
        if ((ch === '"' || ch === "'") && (!inString || ch === quote)) {
            inString = !inString;
            quote = inString ? ch : '';
            out += ch;
            continue;
        }
        if (!inString) {
            const rest = input.slice(i);
            const match = rest.match(/^[-+]?Infinity|^NaN/);
            if (match) {
                out += 'null';
                i += match[0].length - 1;
                continue;
            }
        }
        out += ch;
    }
    return out;
}

function escapeStringWhitespace(input: string): string {
    let out = '';
    let inString = false;
    let quote = '';
    let escape = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (escape) {
            out += ch;
            escape = false;
            continue;
        }
        if (ch === '\\') {
            out += ch;
            escape = true;
            continue;
        }
        if ((ch === '"' || ch === "'") && (!inString || ch === quote)) {
            inString = !inString;
            quote = inString ? ch : '';
            out += ch;
            continue;
        }
        if (inString) {
            if (ch === '\r') {
                if (input[i + 1] === '\n') i++;
                out += '\\n';
                continue;
            }
            if (ch === '\n' || ch === '\u2028' || ch === '\u2029') {
                out += '\\n';
                continue;
            }
            if (ch === '\t') {
                out += '\\t';
                continue;
            }
        }
        out += ch;
    }
    return out;
}

function stripJsonComments(input: string): string {
    let out = '';
    let inString = false;
    let quote = '';
    let escape = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        const next = input[i + 1];
        if (escape) {
            out += ch;
            escape = false;
            continue;
        }
        if (ch === '\\') {
            out += ch;
            escape = true;
            continue;
        }
        if ((ch === '"' || ch === "'") && (!inString || ch === quote)) {
            inString = !inString;
            quote = inString ? ch : '';
            out += ch;
            continue;
        }
        if (!inString && ch === '/' && next === '/') {
            while (i < input.length && input[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (!inString && ch === '/' && next === '*') {
            i += 2;
            while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
            i++;
            continue;
        }
        out += ch;
    }
    return out;
}
