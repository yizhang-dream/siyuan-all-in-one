import type { AppConfig, AgentConfig, Provider } from './types';

/**
 * 内置 Provider 预设。
 * 用户只需填 API Key，点「获取模型」自动拉取可用模型列表。
 * baseUrl 只到根路径（不含 /v1/chat/completions），由 resolveLLMConfig 拼接。
 */
export const BUILTIN_PROVIDERS: Provider[] = [
    {
        id: 'deepseek',
        name: 'DeepSeek 深度求索',
        baseUrl: 'https://api.deepseek.com',
        apiKey: '',
        models: [],
        isBuiltIn: true,
        disableThinking: true,
    },
    {
        id: 'glm',
        name: '智谱 GLM (标准/直充)',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: '',
        models: [],
        isBuiltIn: true,
        disableThinking: true,
    },
    // 编程套餐：订阅制，不可用 Flash 系列免费模型（会扣余额），配额用尽静默暂停
    {
        id: 'glm-coding',
        name: '智谱 GLM (编程套餐)',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'moonshot',
        name: 'Moonshot 月之暗面 (Kimi)',
        baseUrl: 'https://api.moonshot.cn',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'moonshot-coding',
        name: 'Kimi 编程套餐 (Moonshot)',
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'siliconflow',
        name: 'SiliconFlow 硅基流动',
        baseUrl: 'https://api.siliconflow.cn',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'volcano',
        name: '火山引擎 (豆包)',
        baseUrl: 'https://ark.cn-beijing.volces.com',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'volcano-coding',
        name: '火山引擎 编程套餐 (Doubao)',
        baseUrl: 'https://ark.cn-beijing.volces.com',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'minimax',
        name: 'MiniMax',
        baseUrl: 'https://api.minimaxi.com',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'qwen',
        name: '通义千问 Qwen / DashScope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'hunyuan',
        name: '腾讯混元 Tencent Hunyuan',
        baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'stepfun',
        name: '阶跃星辰 StepFun',
        baseUrl: 'https://api.stepfun.com/v1',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'lingyiwanwu',
        name: '零一万物 01.AI / Yi',
        baseUrl: 'https://api.lingyiwanwu.com/v1',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'gemini',
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
    {
        id: 'anthropic',
        name: 'Anthropic Claude',
        baseUrl: 'https://api.anthropic.com',
        apiKey: '',
        models: [],
        isBuiltIn: true,
    },
];

export const DEFAULT_CONFIG: AppConfig = {
    providers: BUILTIN_PROVIDERS.map((p) => ({ ...p })),
    flashcardProviderId: 'deepseek',
    flashcardModel: '',
    mindmapProviderId: 'deepseek',
    mindmapModel: '',
    ragProviderId: 'deepseek',
    ragModel: '',
    visionProviderId: 'glm',
    visionModel: '',
    cardsPerDay: 30,
    scheduler: 'sm2',
    defaultDeck: 'Default',
    agents: [],
    ragEmbeddingProvider: 'builtin',
    ragEmbeddingConfig: { endpoint: '', apiKey: '', model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' },
    visionProviderType: 'off',
};

/** 生成唯一 id（用于自定义 Provider） */
export function genId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return 'p' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** 生成唯一 agent id */
export function genAgentId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return 'a' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** 清洗单个 agent 定义，补全缺失字段 */
export function cleanAgent(raw: any): AgentConfig {
    return {
        id: String(raw?.id || genAgentId()),
        name: String(raw?.name ?? '未命名 Agent'),
        prompt: String(raw?.prompt ?? ''),
        suggestedCount: Number(raw?.suggestedCount) || 10,
        language: String(raw?.language || 'auto'),
        style: String(raw?.style || 'standard'),
        difficulty: String(raw?.difficulty || 'intermediate'),
        tokensPerCard: Number(raw?.tokensPerCard) || 400,
    };
}

/** 清洗单个 Provider，补全缺失字段 */
export function cleanProvider(raw: any): Provider {
    return {
        id: String(raw?.id || genId()),
        name: String(raw?.name ?? '未命名'),
        baseUrl: String(raw?.baseUrl ?? ''),
        apiKey: String(raw?.apiKey ?? ''),
        models: Array.isArray(raw?.models) ? raw.models.map(String) : [],
        isBuiltIn: Boolean(raw?.isBuiltIn),
    };
}

/**
 * 清洗配置，含旧配置迁移逻辑。
 * 如果检测到旧的 llmEndpoint/llmModel/llmApiKey（单 Provider 时代），
 * 自动转为一个"已迁移"自定义 Provider 并设为各功能的默认指针。
 */
export function cleanConfig(cfg: any): AppConfig {
    const d = DEFAULT_CONFIG;

    // 迁移：旧配置有 llmEndpoint 但没有 providers
    const hasOldLlmConfig = cfg && cfg.llmEndpoint && !Array.isArray(cfg?.providers);
    let providers: Provider[];
    let flashcardProviderId: string;
    let mindmapProviderId: string;

    if (hasOldLlmConfig) {
        const migrated: Provider = {
            id: 'migrated',
            name: '已迁移',
            baseUrl: String(cfg.llmEndpoint),
            apiKey: String(cfg.llmApiKey || ''),
            models: [String(cfg.llmModel || 'deepseek-chat')],
            isBuiltIn: false,
        };
        providers = [migrated, ...BUILTIN_PROVIDERS.map((p) => ({ ...p }))];
        flashcardProviderId = 'migrated';
        mindmapProviderId = 'migrated';
    } else {
        const rawProviders = Array.isArray(cfg?.providers) ? cfg.providers : [];
        providers = rawProviders.map(cleanProvider);
        // 确保至少有内置预设
        if (providers.filter((p) => p.isBuiltIn).length === 0) {
            providers = [...BUILTIN_PROVIDERS.map((p) => ({ ...p })), ...providers];
        }
        flashcardProviderId = String(cfg?.flashcardProviderId || providers[0]?.id || d.flashcardProviderId);
        mindmapProviderId = String(cfg?.mindmapProviderId || providers[0]?.id || d.mindmapProviderId);
    }

    // 旧配置里的 'zhipu' 已合并为 'glm'
    if (flashcardProviderId === 'zhipu') flashcardProviderId = 'glm';
    let vpId = cfg?.visionProviderId || 'glm';
    if (vpId === 'zhipu') vpId = 'glm';

    // Merge: ensure all built-in providers exist in the saved config.
    // New built-ins (qwen, hunyuan, stepfun, lingyiwanwu, moonshot-coding, volcano-coding)
    // are appended so users see them in the dropdown without losing their customizations.
    const savedIds = new Set(providers.map(p => p.id));
    for (const builtin of BUILTIN_PROVIDERS) {
        if (!savedIds.has(builtin.id)) {
            providers.push({ ...builtin });
        }
    }

    const rawAgents = Array.isArray(cfg?.agents) ? cfg.agents : [];
    return {
        providers,
        flashcardProviderId,
        flashcardModel: String(cfg?.flashcardModel ?? (hasOldLlmConfig ? cfg.llmModel : d.flashcardModel)),
        mindmapProviderId,
        mindmapModel: String(cfg?.mindmapModel ?? (hasOldLlmConfig ? cfg.llmModel : d.mindmapModel)),
        ragProviderId: String(cfg?.ragProviderId || d.ragProviderId),
        ragModel: String(cfg?.ragModel ?? d.ragModel),
        visionProviderId: vpId,
        visionModel: String(cfg?.visionModel ?? d.visionModel),
        cardsPerDay: cfg?.cardsPerDay ?? d.cardsPerDay,
        scheduler: cfg?.scheduler === 'fsrs' ? 'fsrs' : 'sm2',
        defaultDeck: cfg?.defaultDeck ?? d.defaultDeck,
        agents: rawAgents.map(cleanAgent),
        ragEmbeddingProvider: cfg?.ragEmbeddingProvider === 'ollama' || cfg?.ragEmbeddingProvider === 'openai' || cfg?.ragEmbeddingProvider === 'custom' ? cfg.ragEmbeddingProvider : 'builtin',
        ragEmbeddingConfig: {
            endpoint: String(cfg?.ragEmbeddingConfig?.endpoint ?? ''),
            apiKey: String(cfg?.ragEmbeddingConfig?.apiKey ?? ''),
            model: String(cfg?.ragEmbeddingConfig?.model ?? ''),
        },
        visionProviderType: cfg?.visionProviderType || 'off',
    };
}
