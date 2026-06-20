/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 闪卡类型定义。卡片挂载到 ConceptNode 上（通过 conceptId）。
 */

import type { SourceRef, CardType } from './concept';

export type CardStatus = 'new' | 'learning' | 'review' | 'buried';

/** 单张闪卡 */
export interface Card {
    id: string;
    /** 关联的概念节点（可选=未归类） */
    conceptId?: string;
    question: string;
    answer: string;
    hint: string;
    deck: string;
    tags: string[];
    cardType: CardType;
    sourceRefs: SourceRef[];
    // SM-2 字段
    due: number;
    interval: number;
    ease: number;
    reps: number;
    lapses: number;
    status: CardStatus;
    created: number;
    modified: number;
}
