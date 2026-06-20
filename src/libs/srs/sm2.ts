/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * SM-2 间隔重复算法。适配新 Card 类型（含 conceptId, cardType, sourceRefs）。
 * Reference: https://www.supermemo.com/en/archive/1990/supermemo2/sm2
 */

import type { Card, CardStatus } from '../types/card';
import type { CardType, SourceRef } from '../types/concept';

function genId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return 'c' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * 创建新卡片。
 * 参数：question → answer → hint → deck → tags → cardType → conceptId → sourceRefs
 */
export function createCard(
    question: string,
    answer: string,
    hint = '',
    deck = '默认',
    tags: string[] = [],
    cardType: CardType = 'qa',
    conceptId?: string,
    sourceRefs: SourceRef[] = []
): Card {
    const now = Date.now();
    return {
        id: genId(),
        conceptId,
        question, answer, hint, deck, tags,
        cardType, sourceRefs,
        due: now, interval: 0, ease: 2.5,
        reps: 0, lapses: 0,
        status: 'new',
        created: now, modified: now,
    };
}

/** 4 档评分 → SM-2 quality 值 */
const QUALITY_MAP: Record<number, number> = { 0: 0, 1: 2, 2: 4, 3: 5 };

/** 应用 SM-2 调度到卡片，原地修改并返回。 */
export function schedule(grade: number, card: Card): Card {
    const q = QUALITY_MAP[grade] ?? 0;
    if (q < 3) {
        card.reps = 0;
        card.interval = 1;
        card.lapses += 1;
        card.status = 'learning';
    } else {
        if (card.reps === 0) card.interval = 1;
        else if (card.reps === 1) card.interval = 6;
        else card.interval = Math.round(card.interval * card.ease);
        card.reps += 1;
        card.status = 'review';
    }
    card.ease = Math.max(1.3, card.ease + 0.1 - (3 - q) * 0.08);
    card.due = Date.now() + card.interval * 86_400_000;
    card.modified = Date.now();
    return card;
}

/** 判断卡片是否到期（含新卡片）。buried 不算到期。 */
export function isDue(card: Card, now = Date.now()): boolean {
    if (card.status === 'buried') return false;
    return card.status === 'new' || card.due <= now;
}

/** 清洗/补全导入的卡片对象。 */
export function cleanCard(raw: any): Card {
    const now = Date.now();
    const validStatuses: CardStatus[] = ['new', 'learning', 'review', 'buried'];
    const status = validStatuses.includes(raw?.status) ? raw.status : 'new';
    return {
        id: String(raw?.id || genId()),
        conceptId: raw?.conceptId ? String(raw.conceptId) : undefined,
        question: String(raw?.question ?? ''),
        answer: String(raw?.answer ?? ''),
        hint: String(raw?.hint ?? ''),
        deck: String(raw?.deck ?? '默认'),
        tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
        cardType: raw?.cardType || 'qa',
        sourceRefs: Array.isArray(raw?.sourceRefs) ? raw.sourceRefs : [],
        due: Number(raw?.due) || now,
        interval: Number(raw?.interval) || 0,
        ease: Number(raw?.ease) || 2.5,
        reps: Number(raw?.reps) || 0,
        lapses: Number(raw?.lapses) || 0,
        status,
        created: Number(raw?.created) || now,
        modified: Number(raw?.modified) || now,
    };
}
