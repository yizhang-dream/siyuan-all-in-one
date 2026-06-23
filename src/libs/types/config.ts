/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 配置类型定义。
 */

/** AI 服务提供方（OpenAI 兼容端点） */
export interface Provider {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    isBuiltIn: boolean;
}

/** 用户自定义制卡 Agent（提示词模板） */
export interface AgentConfig {
    id: string;
    name: string;
    prompt: string;
    suggestedCount: number;
    language: string;
    style: string;
    difficulty: string;
    tokensPerCard: number;
}

/** 插件持久化配置 */
export interface AppConfig {
    providers: Provider[];
    flashcardProviderId: string;
    flashcardModel: string;
    mindmapProviderId: string;
    mindmapModel: string;
    ragProviderId?: string;
    ragModel?: string;
    visionProviderId?: string;
    visionModel?: string;
    cardsPerDay: number;
    scheduler: 'sm2' | 'fsrs';
    defaultDeck: string;
    agents: AgentConfig[];
    /** RAG 嵌入向量提供方类型 */
    ragEmbeddingProvider: 'builtin' | 'ollama' | 'openai' | 'custom';
    /** RAG 嵌入向量提供方连接配置 */
    ragEmbeddingConfig: { endpoint: string; apiKey: string; model: string; };
    /** 是否使用 PaddleOCR 离线提取（不需 API，替代云端视觉） */
    usePaddleOcrOffline?: boolean;
}
