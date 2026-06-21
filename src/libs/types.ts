/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License — https://opensource.org/licenses/MIT
 *
 * 统一类型定义：卡片、配置、Agent。
 */

import type { CardType, SourceRef } from './types/concept';

/** 卡片状态 */
export type CardStatus = 'new' | 'learning' | 'review' | 'buried' | 'drill';
export type ReviewScheduler = 'sm2' | 'fsrs';

export interface FSRSCardState {
    stability: number;
    difficulty: number;
    retrievability?: number;
    state: 'new' | 'learning' | 'review' | 'relearning';
    scheduledDays: number;
    elapsedDays: number;
    learningSteps: number;
    lastReview?: number;
    lastRating?: number;
}

/** 单张闪卡 */
export interface Card {
    id: string;
    /** 关联的概念节点（新知识图谱模型，可选以兼容旧卡片） */
    conceptId?: string;
    question: string;
    answer: string;
    hint: string;
    deck: string;
    /** 溯源：由哪个 agent 生成（可选，仅记录，不影响任何逻辑） */
    agentId?: string;
    /** 关联的思维导图 id 列表（从导图生成的卡片记录来源，用于跳转） */
    linkedMindmapIds?: string[];
    tags: string[];
    /** 新卡片类型和溯源字段；旧卡片缺失时由 cleanCard 补默认值。 */
    cardType?: CardType;
    sourceRefs?: SourceRef[];
    scheduler?: ReviewScheduler;
    fsrs?: FSRSCardState;
    due: number; // epoch ms
    interval: number; // 天
    ease: number; // 倍率（≥1.3）
    reps: number;
    lapses: number;
    consecutiveLapses?: number;
    status: CardStatus;
    created: number;
    modified: number;
}

/**
 * 用户自定义的制卡 Agent（提示词模板）。
 * 用户自由编写 system prompt，配合语言/风格/难度等参数，
 * 由 generateFlashcards 注入到 LLM 调用。
 */
export interface AgentConfig {
    /** 唯一标识 */
    id: string;
    /** 用户起的名字，如"物理概念卡"、"医学记忆卡" */
    name: string;
    /** 完整 system prompt，支持占位符：{topic} {count} {language} {style} {difficulty} {context} */
    prompt: string;
    /** 建议生成数量 */
    suggestedCount: number;
    /** 输出语言代码：zh-CN / en / ja 等 */
    language: string;
    /** 卡片风格：简洁 / 详细 / 口语化 / 学术 */
    style: string;
    /** 难度：基础 / 进阶 / 挑战 */
    difficulty: string;
    /** 每张卡 token 预算，用于动态计算 maxTokens */
    tokensPerCard: number;
}

/**
 * AI 服务提供方（OpenAI 兼容端点）。
 * 用户可配置多个 Provider，每个功能（制卡/思维导图）可独立选择不同的 Provider + 模型。
 */
export interface Provider {
    /** 唯一标识：内置用固定 id（'deepseek'/'openai'/'ollama'），自定义用 genId */
    id: string;
    /** 显示名 */
    name: string;
    /** API 端点（完整 URL，如 https://api.deepseek.com/v1/chat/completions） */
    baseUrl: string;
    /** API 密钥 */
    apiKey: string;
    /** 可用模型列表（用户可编辑） */
    models: string[];
    /** 是否内置预设 */
    isBuiltIn: boolean;
}

/** 插件持久化配置 */
export interface AppConfig {
    /** AI Provider 注册表 */
    providers: Provider[];
    /** 制卡功能使用的 Provider id */
    flashcardProviderId: string;
    /** 制卡功能使用的模型名 */
    flashcardModel: string;
    /** 思维导图功能使用的 Provider id */
    mindmapProviderId: string;
    /** 思维导图功能使用的模型名 */
    mindmapModel: string;
    /** Open Notebook 搜索端点（独立于 Provider 体系） */
    notebookEndpoint: string;
    /** 每日新卡片上限 */
    cardsPerDay: number;
    /** 复习调度算法：SM-2 兼容默认，FSRS 可选。 */
    scheduler: ReviewScheduler;
    /** 默认牌组名 */
    defaultDeck: string;
    /** 用户自定义 agent 列表 */
    agents: AgentConfig[];
}
