/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 概念节点中间层类型定义。
 * ConceptNode 是闪卡和思维导图共享的知识节点，
 * 闪卡挂载到概念上，思维导图是概念树的可视化视图。
 */

/** 来源引用——每个概念、关系、卡片都可追溯到原始材料 */
export interface SourceRef {
    type: 'opennotebook' | 'siyuan' | 'manual' | 'file' | 'pdf' | 'url';
    sourceId?: string;
    blockId?: string;
    chunkId?: string;
    quote?: string;
    page?: number;
    url?: string;
}

/** 概念节点——知识图谱的核心实体 */
export interface ConceptNode {
    id: string;
    title: string;
    summary?: string;
    parentIds: string[];
    childIds: string[];
    relatedIds: string[];
    cardIds: string[];
    sourceRefs: SourceRef[];
    tags: string[];
    confidence?: number;
    created: number;
    modified: number;
}

/** 关系类型 */
export type RelationType =
    | 'parent_child'
    | 'prerequisite'
    | 'contrast'
    | 'cause_effect'
    | 'sequence'
    | 'related';

/** 概念间关系 */
export interface Relation {
    id: string;
    fromId: string;
    toId: string;
    type: RelationType;
    sourceRefs: SourceRef[];
    confidence?: number;
}

/** AI 流水线产出的概念候选（待确认） */
export interface ConceptCandidate {
    tempId: string;
    title: string;
    summary?: string;
    sourceRefs: SourceRef[];
    confidence: number;
    tags?: string[];
}

/** AI 流水线产出的关系候选（待确认） */
export interface RelationCandidate {
    fromTempId: string;
    toTempId: string;
    type: RelationType;
    sourceRefs: SourceRef[];
    confidence: number;
}

/** AI 流水线产出的卡片候选（待确认） */
export interface CardCandidate {
    conceptTempId?: string;
    cardType: CardType;
    front: string;
    back: string;
    hint?: string;
    descriptorDimension?: string;
    sourceRefs: SourceRef[];
    confidence: number;
}

/** 流水线完整输出 */
export interface PipelineResult {
    concepts: ConceptCandidate[];
    relations: RelationCandidate[];
    cards: CardCandidate[];
    uncertain: Array<{ type: string; content: string; reason: string }>;
    warnings: string[];
}

/** 卡片类型 */
export type CardType = 'qa' | 'cloze' | 'reverse' | 'enumeration' | 'compare' | 'process' | 'image-occlusion';

/** 卡片类型元数据 */
export const CARD_TYPE_LABELS: Record<CardType, string> = {
    qa: '问答',
    cloze: '填空',
    reverse: '反向',
    enumeration: '枚举',
    compare: '对比',
    process: '流程',
    'image-occlusion': '图片遮挡',
};
