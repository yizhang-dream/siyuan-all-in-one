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
    notebookEndpoint: string;
    cardsPerDay: number;
    defaultDeck: string;
    agents: AgentConfig[];
}
