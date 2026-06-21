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
    },
    {
        id: 'zhipu',
        name: '智谱 GLM (BigModel)',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
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
        id: 'minimax',
        name: 'MiniMax',
        baseUrl: 'https://api.minimaxi.com',
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
    notebookEndpoint: 'http://localhost:5055',
    cardsPerDay: 30,
    scheduler: 'sm2',
    defaultDeck: '默认',
    agents: [],
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
        language: String(raw?.language || 'zh-CN'),
        style: String(raw?.style || '简洁'),
        difficulty: String(raw?.difficulty || '进阶'),
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

    const rawAgents = Array.isArray(cfg?.agents) ? cfg.agents : [];
    return {
        providers,
        flashcardProviderId,
        flashcardModel: String(cfg?.flashcardModel ?? (hasOldLlmConfig ? cfg.llmModel : d.flashcardModel)),
        mindmapProviderId,
        mindmapModel: String(cfg?.mindmapModel ?? (hasOldLlmConfig ? cfg.llmModel : d.mindmapModel)),
        notebookEndpoint: cfg?.notebookEndpoint ?? d.notebookEndpoint,
        cardsPerDay: cfg?.cardsPerDay ?? d.cardsPerDay,
        scheduler: cfg?.scheduler === 'fsrs' ? 'fsrs' : 'sm2',
        defaultDeck: cfg?.defaultDeck ?? d.defaultDeck,
        agents: rawAgents.map(cleanAgent),
    };
}
