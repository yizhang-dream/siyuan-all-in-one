/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 思维导图持久化层。像 CardStore 一样用 plugin.saveData/loadData 存储思维导图数据。
 * 每个思维导图保存：标题、markdown 内容、关联的卡片 id 列表、创建时间。
 */

export interface SavedMindmap {
    id: string;
    title: string;
    markdown: string;
    /** 关联的卡片 id 列表（基于卡片生成的导图，可空数组=独立导图） */
    cardIds: string[];
    /** 从该导图生成的卡片 id（反向关联） */
    linkedCardIds?: string[];
    /** 关联的牌组名（cards 模式） */
    deck?: string;
    /** 来源类型 */
    source?: 'cards' | 'doc' | 'manual' | 'concepts';
    created: number;
    modified: number;
}

export class MindmapStore {
    private plugin: any;
    private mindmaps: SavedMindmap[] = [];

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    async load(): Promise<void> {
        try {
            const data = await this.plugin.loadData('mindmaps');
            if (Array.isArray(data)) {
                this.mindmaps = data.map(cleanMindmap);
            }
        } catch {
            this.mindmaps = [];
        }
    }

    async save(): Promise<void> {
        await this.plugin.saveData('mindmaps', this.mindmaps);
    }

    getAll(): SavedMindmap[] {
        return [...this.mindmaps];
    }

    getById(id: string): SavedMindmap | undefined {
        return this.mindmaps.find((m) => m.id === id);
    }

    getByDeck(deck: string): SavedMindmap[] {
        return this.mindmaps.filter((m) => m.deck === deck);
    }

    /** 反查：包含某张卡片的导图（通过 cardIds 匹配） */
    getByCardId(cardId: string): SavedMindmap[] {
        return this.mindmaps.filter((m) => m.cardIds?.includes(cardId));
    }

    /** 添加或更新（同 deck 覆盖旧的） */
    async upsert(mindmap: SavedMindmap): Promise<SavedMindmap> {
        const idIdx = this.mindmaps.findIndex((m) => m.id === mindmap.id);
        const idx = idIdx >= 0
            ? idIdx
            : this.mindmaps.findIndex((m) => m.deck === mindmap.deck && m.deck !== undefined);
        if (idx >= 0) {
            // 保留旧的 linkedCardIds（反向关联不被覆盖）
            this.mindmaps[idx] = {
                ...mindmap,
                linkedCardIds: mergeIds(this.mindmaps[idx].linkedCardIds, mindmap.linkedCardIds),
                modified: Date.now(),
            };
        } else {
            this.mindmaps.push(mindmap);
        }
        await this.save();
        return mindmap;
    }

    async delete(id: string): Promise<void> {
        this.mindmaps = this.mindmaps.filter((m) => m.id !== id);
        await this.save();
    }

    async clear(): Promise<void> {
        this.mindmaps = [];
        await this.save();
    }

    importMindmaps(rawMindmaps: any[] = []): { added: number; updated: number } {
        let added = 0;
        let updated = 0;
        for (const raw of rawMindmaps) {
            const mindmap = cleanMindmap(raw);
            const existing = this.mindmaps.find((item) => item.id === mindmap.id);
            if (existing) {
                Object.assign(existing, {
                    ...mindmap,
                    cardIds: mergeIds(existing.cardIds, mindmap.cardIds),
                    linkedCardIds: mergeIds(existing.linkedCardIds, mindmap.linkedCardIds),
                });
                updated++;
            } else {
                this.mindmaps.push(mindmap);
                added++;
            }
        }
        return { added, updated };
    }
}

function mergeIds(a: string[] = [], b: string[] = []): string[] {
    return Array.from(new Set([...a, ...b].filter(Boolean)));
}

function cleanMindmap(raw: any): SavedMindmap {
    const now = Date.now();
    const source = ['cards', 'doc', 'manual', 'concepts'].includes(raw?.source) ? raw.source : 'manual';
    return {
        id: String(raw?.id || genMindmapId()),
        title: String(raw?.title || raw?.id || 'Untitled mindmap'),
        markdown: String(raw?.markdown || ''),
        cardIds: toStringArray(raw?.cardIds),
        linkedCardIds: toStringArray(raw?.linkedCardIds),
        deck: raw?.deck === undefined ? undefined : String(raw.deck),
        source,
        created: Number(raw?.created) || now,
        modified: Number(raw?.modified) || now,
    };
}

function toStringArray(value: any): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

/** 生成思维导图 id */
export function genMindmapId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return 'm' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
