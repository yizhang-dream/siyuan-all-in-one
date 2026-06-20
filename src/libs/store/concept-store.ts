/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 概念节点持久化层。ConceptNode 是闪卡和思维导图共享的中间层。
 * 存储：plugin.loadData/saveData('concepts') + ('relations')
 */

import type { ConceptNode, Relation, RelationType, SourceRef } from '../types/concept';

const VALID_RELATION_TYPES: RelationType[] = [
    'parent_child',
    'prerequisite',
    'contrast',
    'cause_effect',
    'sequence',
    'related',
];

const VALID_SOURCE_TYPES: SourceRef['type'][] = ['opennotebook', 'siyuan', 'manual', 'pdf', 'url'];

function genId(prefix: string): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export class ConceptStore {
    private plugin: any;
    private concepts: ConceptNode[] = [];
    private relations: Relation[] = [];

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async load(): Promise<void> {
        try {
            const conceptData = await this.plugin.loadData('concepts');
            this.concepts = Array.isArray(conceptData) ? conceptData.map(cleanConceptNode) : [];
        } catch { this.concepts = []; }
        try {
            const relationData = await this.plugin.loadData('relations');
            this.relations = Array.isArray(relationData) ? relationData.map(cleanRelation) : [];
        } catch { this.relations = []; }
    }

    async save(): Promise<void> {
        await this.plugin.saveData('concepts', this.concepts);
        await this.plugin.saveData('relations', this.relations);
    }

    // ── 概念 CRUD ──────────────────────────────────────────

    getAll(): ConceptNode[] { return [...this.concepts]; }

    getById(id: string): ConceptNode | undefined {
        return this.concepts.find((c) => c.id === id);
    }

    getRoots(): ConceptNode[] {
        return this.concepts.filter((c) => c.parentIds.length === 0);
    }

    getChildren(id: string): ConceptNode[] {
        return this.concepts.filter((c) => c.parentIds.includes(id));
    }

    getParents(id: string): ConceptNode[] {
        const node = this.getById(id);
        if (!node) return [];
        return node.parentIds
            .map((pid) => this.getById(pid))
            .filter(Boolean) as ConceptNode[];
    }

    add(node: ConceptNode): void {
        this.concepts.push(node);
    }

    create(title: string, summary?: string): ConceptNode {
        const now = Date.now();
        const node: ConceptNode = {
            id: genId('k'),
            title, summary,
            parentIds: [], childIds: [], relatedIds: [], cardIds: [],
            sourceRefs: [], tags: [],
            created: now, modified: now,
        };
        this.add(node);
        return node;
    }

    update(id: string, updates: Partial<ConceptNode>): void {
        const idx = this.concepts.findIndex((c) => c.id === id);
        if (idx !== -1) {
            this.concepts[idx] = { ...this.concepts[idx], ...updates, modified: Date.now() };
        }
    }

    delete(id: string): void {
        // 从其他节点的关联列表中移除
        for (const c of this.concepts) {
            c.parentIds = c.parentIds.filter((x) => x !== id);
            c.childIds = c.childIds.filter((x) => x !== id);
            c.relatedIds = c.relatedIds.filter((x) => x !== id);
            c.cardIds = c.cardIds.filter((x) => x !== id);
        }
        // 删除关联的关系
        this.relations = this.relations.filter((r) => r.fromId !== id && r.toId !== id);
        this.concepts = this.concepts.filter((c) => c.id !== id);
    }

    // ── 卡片关联 ────────────────────────────────────────────

    /** 将卡片挂载到概念节点 */
    attachCard(conceptId: string, cardId: string): void {
        const node = this.getById(conceptId);
        if (node && !node.cardIds.includes(cardId)) {
            node.cardIds.push(cardId);
            node.modified = Date.now();
        }
    }

    /** 从概念节点卸载卡片 */
    detachCard(conceptId: string, cardId: string): void {
        const node = this.getById(conceptId);
        if (node) {
            node.cardIds = node.cardIds.filter((x) => x !== cardId);
            node.modified = Date.now();
        }
    }

    /** 反查：包含某张卡片的概念 */
    getByCardId(cardId: string): ConceptNode[] {
        return this.concepts.filter((c) => c.cardIds.includes(cardId));
    }

    // ── 关系管理 ────────────────────────────────────────────

    getRelations(): Relation[] { return [...this.relations]; }

    getRelationsByNode(nodeId: string): Relation[] {
        return this.relations.filter((r) => r.fromId === nodeId || r.toId === nodeId);
    }

    addRelation(fromId: string, toId: string, type: RelationType, sourceRefs: SourceRef[] = []): Relation {
        const existing = this.relations.find((r) => r.fromId === fromId && r.toId === toId && r.type === type);
        if (existing) {
            existing.sourceRefs = mergeSourceRefs(existing.sourceRefs || [], sourceRefs);
            return existing;
        }
        const rel: Relation = {
            id: genId('r'),
            fromId, toId, type, sourceRefs,
            created: Date.now() as any,
        } as Relation;
        this.relations.push(rel);
        // 同步更新 parent_child 关系的 parentIds/childIds
        if (type === 'parent_child') {
            this.update(fromId, {});
            const parent = this.getById(fromId);
            const child = this.getById(toId);
            if (parent && !parent.childIds.includes(toId)) parent.childIds.push(toId);
            if (child && !child.parentIds.includes(fromId)) child.parentIds.push(fromId);
        }
        return rel;
    }

    removeRelation(id: string): void {
        const relation = this.relations.find((r) => r.id === id);
        this.relations = this.relations.filter((r) => r.id !== id);
        if (relation?.type === 'parent_child') {
            const parent = this.getById(relation.fromId);
            const child = this.getById(relation.toId);
            if (parent) {
                parent.childIds = parent.childIds.filter((childId) => childId !== relation.toId);
                parent.modified = Date.now();
            }
            if (child) {
                child.parentIds = child.parentIds.filter((parentId) => parentId !== relation.fromId);
                child.modified = Date.now();
            }
        }
    }

    // ── 查询辅助 ────────────────────────────────────────────

    getByTag(tag: string): ConceptNode[] {
        return this.concepts.filter((c) => c.tags.includes(tag));
    }

    /** 未归类卡片（cardIds 为空或不存在 conceptId 的卡片） */
    getUnassignedCards(allCardIds: string[]): string[] {
        const assigned = new Set<string>();
        for (const c of this.concepts) {
            for (const cid of c.cardIds) assigned.add(cid);
        }
        return allCardIds.filter((id) => !assigned.has(id));
    }

    clear(): void {
        this.concepts = [];
        this.relations = [];
    }
}

function mergeSourceRefs(existing: SourceRef[], incoming: SourceRef[]): SourceRef[] {
    const seen = new Set<string>();
    const merged: SourceRef[] = [];
    for (const ref of [...existing, ...incoming]) {
        const key = [
            ref.type,
            ref.sourceId,
            ref.blockId,
            ref.chunkId,
            ref.page,
            ref.url,
            ref.quote,
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(ref);
    }
    return merged;
}

function cleanConceptNode(raw: any): ConceptNode {
    const now = Date.now();
    return {
        id: String(raw?.id || genId('k')),
        title: String(raw?.title || raw?.name || 'Untitled concept'),
        summary: raw?.summary === undefined ? undefined : String(raw.summary),
        parentIds: toStringArray(raw?.parentIds),
        childIds: toStringArray(raw?.childIds),
        relatedIds: toStringArray(raw?.relatedIds),
        cardIds: toStringArray(raw?.cardIds),
        sourceRefs: cleanSourceRefs(raw?.sourceRefs),
        tags: toStringArray(raw?.tags),
        confidence: toOptionalNumber(raw?.confidence),
        created: Number(raw?.created) || now,
        modified: Number(raw?.modified) || now,
    };
}

function cleanRelation(raw: any): Relation {
    return {
        id: String(raw?.id || genId('r')),
        fromId: String(raw?.fromId || raw?.from || ''),
        toId: String(raw?.toId || raw?.to || ''),
        type: normalizeRelationType(raw?.type || raw?.relationType || raw?.relation_type),
        sourceRefs: cleanSourceRefs(raw?.sourceRefs || raw?.references || raw?.sources),
        confidence: toOptionalNumber(raw?.confidence),
    };
}

function cleanSourceRefs(value: any): SourceRef[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((raw) => {
            if (typeof raw === 'string') {
                return { type: 'manual' as const, sourceId: raw };
            }
            const type = VALID_SOURCE_TYPES.includes(raw?.type) ? raw.type : 'manual';
            const ref: SourceRef = { type };
            if (raw?.sourceId !== undefined) ref.sourceId = String(raw.sourceId);
            if (raw?.blockId !== undefined) ref.blockId = String(raw.blockId);
            if (raw?.chunkId !== undefined) ref.chunkId = String(raw.chunkId);
            if (raw?.quote !== undefined) ref.quote = String(raw.quote);
            const page = Number(raw?.page);
            if (Number.isFinite(page)) ref.page = page;
            if (raw?.url !== undefined) ref.url = String(raw.url);
            return ref;
        })
        .filter((ref) => ref.sourceId || ref.blockId || ref.chunkId || ref.quote || ref.url);
}

function normalizeRelationType(value: any): RelationType {
    const type = String(value || '').trim();
    return VALID_RELATION_TYPES.includes(type as RelationType) ? type as RelationType : 'related';
}

function toStringArray(value: any): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function toOptionalNumber(value: any): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}
