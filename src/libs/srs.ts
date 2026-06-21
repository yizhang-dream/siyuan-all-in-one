/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * SM-2 间隔重复算法 — 修复版。
 * Reference: https://www.supermemo.com/en/archive/1990/supermemo2/sm2
 */

import { createEmptyCard, fsrs, Rating, State, type Card as FSRSCard, type Grade } from 'ts-fsrs';
import type { Card, CardStatus, ReviewScheduler } from './types';

/**
 * 生成唯一 id（优先 crypto.randomUUID，回退时间戳+随机）。
 */
function genId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return 'c' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * 创建新卡片，返回带合理默认值的完整 Card 对象。
 * 参数顺序：question → answer → hint → deck → tags → agentId?
 */
export function createCard(
    question: string,
    answer: string,
    hint = '',
    deck = '默认',
    tags: string[] = [],
    agentId?: string
): Card {
    const now = Date.now();
    return {
        id: genId(),
        question,
        answer,
        hint,
        deck,
        agentId,
        tags,
        scheduler: 'sm2',
        due: now,
        interval: 0,
        ease: 2.5,
        reps: 0,
        lapses: 0,
        status: 'new',
        created: now,
        modified: now,
    };
}

/** 4 档评分 → SM-2 quality 值 */
const QUALITY_MAP: Record<number, number> = { 0: 0, 1: 2, 2: 4, 3: 5 };

/**
 * 应用 SM-2 调度到卡片。
 * 传入 grade(0-3)，原地修改 card 并返回（fluent 风格）。
 */
export function schedule(grade: number, card: Card): Card {
    const q = QUALITY_MAP[grade] ?? 0;
    card.scheduler = 'sm2';

    if (q < 3) {
        // 遗忘：重置
        card.reps = 0;
        card.interval = 1;
        card.lapses += 1;
        card.consecutiveLapses = (card.consecutiveLapses || 0) + 1;
        card.status = 'learning';
    } else {
        // 回忆成功：增长间隔
        if (card.reps === 0) card.interval = 1;
        else if (card.reps === 1) card.interval = 6;
        else card.interval = Math.round(card.interval * card.ease);
        card.reps += 1;
        card.consecutiveLapses = 0;
        card.status = 'review';
    }

    // 调整 ease 因子（最低 1.3）
    card.ease = Math.max(1.3, card.ease + 0.1 - (3 - q) * 0.08);
    card.due = Date.now() + card.interval * 86_400_000;
    card.modified = Date.now();
    return card;
}

export function scheduleCard(
    grade: number,
    card: Card,
    scheduler: ReviewScheduler = 'sm2',
    now = Date.now()
): Card {
    if (scheduler === 'fsrs') return scheduleFSRS(grade, card, now);
    card.scheduler = 'sm2';
    schedule(grade, card);
    // Drill: enter drill if 2+ consecutive lapses; exit if Easy
    if (card.consecutiveLapses !== undefined && card.consecutiveLapses >= 2) {
        card.status = 'drill';
    }
    if (card.status === 'drill' && grade >= 3) {
        card.status = 'review';
        card.consecutiveLapses = 0;
    }
    return card;
}

export function scheduleFSRS(grade: number, card: Card, now = Date.now()): Card {
    const rating = toFSRSRating(grade);
    const scheduler = fsrs({
        request_retention: 0.9,
        maximum_interval: 36500,
        enable_fuzz: true,
        enable_short_term: true,
    });
    const result = scheduler.next(toFSRSCard(card, now), new Date(now), rating);
    const next = result.card;
    const retrievability = next.state === State.New
        ? undefined
        : scheduler.get_retrievability(next, new Date(now), false);

    card.scheduler = 'fsrs';
    card.fsrs = {
        stability: Number(next.stability) || 0,
        difficulty: Number(next.difficulty) || 0,
        retrievability: typeof retrievability === 'number' && Number.isFinite(retrievability) ? retrievability : undefined,
        state: fromFSRSState(next.state),
        scheduledDays: Number(next.scheduled_days) || 0,
        elapsedDays: Number(next.elapsed_days) || 0,
        learningSteps: Number(next.learning_steps) || 0,
        lastReview: next.last_review ? next.last_review.getTime() : now,
        lastRating: rating,
    };
    card.due = next.due.getTime();
    card.interval = Math.max(0, Math.round(Number(next.scheduled_days) || daysBetween(now, card.due)));
    card.ease = Math.max(1.3, Number(next.difficulty) ? 11 - Number(next.difficulty) : card.ease || 2.5);
    card.reps = Number(next.reps) || (card.reps + 1);
    card.lapses = Number(next.lapses) || card.lapses;
    card.status = toPluginStatus(next.state);
    card.modified = now;
    return card;
}

/** 判断卡片是否到期（含新卡片）。buried 卡片不算到期。 */
export function isDue(card: Card, now = Date.now()): boolean {
    if (card.status === 'buried') return false;
    if (card.status === 'drill') return true;
    return card.status === 'new' || card.due <= now;
}

/** 清洗/补全导入的卡片对象，防止缺字段导致崩溃。旧数据的 type 字段在此被丢弃。 */
export function cleanCard(raw: any): Card {
    const now = Date.now();
    const validStatuses: CardStatus[] = ['new', 'learning', 'review', 'buried', 'drill'];
    const status = validStatuses.includes(raw?.status) ? raw.status : 'new';
    return {
        id: String(raw?.id || genId()),
        conceptId: raw?.conceptId ? String(raw.conceptId) : undefined,
        question: String(raw?.question ?? ''),
        answer: String(raw?.answer ?? ''),
        hint: String(raw?.hint ?? ''),
        deck: String(raw?.deck ?? '默认'),
        agentId: raw?.agentId ? String(raw.agentId) : undefined,
        linkedMindmapIds: Array.isArray(raw?.linkedMindmapIds) ? raw.linkedMindmapIds.map(String) : undefined,
        tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
        cardType: raw?.cardType || 'qa',
        sourceRefs: Array.isArray(raw?.sourceRefs) ? raw.sourceRefs : [],
        scheduler: raw?.scheduler === 'fsrs' ? 'fsrs' : raw?.scheduler === 'sm2' ? 'sm2' : undefined,
        fsrs: cleanFSRSState(raw?.fsrs),
        due: Number(raw?.due) || now,
        interval: Number(raw?.interval) || 0,
        ease: Number(raw?.ease) || 2.5,
        reps: Number(raw?.reps) || 0,
        lapses: Number(raw?.lapses) || 0,
        consecutiveLapses: Number.isFinite(Number(raw?.consecutiveLapses)) ? Number(raw.consecutiveLapses) : undefined,
        status,
        created: Number(raw?.created) || now,
        modified: Number(raw?.modified) || now,
    };
}

function toFSRSRating(grade: number): Grade {
    if (grade <= 0) return Rating.Again;
    if (grade === 1) return Rating.Hard;
    if (grade === 2) return Rating.Good;
    return Rating.Easy;
}

function toFSRSCard(card: Card, now: number): FSRSCard {
    if (!card.fsrs) {
        const created = Number(card.created) || now;
        return createEmptyCard(new Date(created));
    }
    return {
        due: new Date(Number(card.due) || now),
        stability: Number(card.fsrs.stability) || 0,
        difficulty: Number(card.fsrs.difficulty) || 0,
        elapsed_days: Number(card.fsrs.elapsedDays) || 0,
        scheduled_days: Number(card.fsrs.scheduledDays) || Number(card.interval) || 0,
        learning_steps: Number(card.fsrs.learningSteps) || 0,
        reps: Number(card.reps) || 0,
        lapses: Number(card.lapses) || 0,
        state: toFSRSState(card.fsrs.state, card.status),
        last_review: card.fsrs.lastReview ? new Date(card.fsrs.lastReview) : undefined,
    };
}

function toFSRSState(fsrsState: any, status: CardStatus): State {
    if (fsrsState === 'learning') return State.Learning;
    if (fsrsState === 'review') return State.Review;
    if (fsrsState === 'relearning') return State.Relearning;
    if (status === 'learning') return State.Learning;
    if (status === 'review') return State.Review;
    return State.New;
}

function fromFSRSState(state: State): 'new' | 'learning' | 'review' | 'relearning' {
    if (state === State.Learning) return 'learning';
    if (state === State.Review) return 'review';
    if (state === State.Relearning) return 'relearning';
    return 'new';
}

function toPluginStatus(state: State): CardStatus {
    if (state === State.New) return 'new';
    if (state === State.Review) return 'review';
    return 'learning';
}

function cleanFSRSState(raw: any): Card['fsrs'] {
    if (!raw || typeof raw !== 'object') return undefined;
    const state = ['new', 'learning', 'review', 'relearning'].includes(raw.state) ? raw.state : 'new';
    return {
        stability: Number(raw.stability) || 0,
        difficulty: Number(raw.difficulty) || 0,
        retrievability: Number.isFinite(Number(raw.retrievability)) ? Number(raw.retrievability) : undefined,
        state,
        scheduledDays: Number(raw.scheduledDays) || 0,
        elapsedDays: Number(raw.elapsedDays) || 0,
        learningSteps: Number(raw.learningSteps) || 0,
        lastReview: Number(raw.lastReview) || undefined,
        lastRating: Number(raw.lastRating) || undefined,
    };
}

function daysBetween(start: number, end: number): number {
    return Math.max(0, Math.round((end - start) / 86_400_000));
}
