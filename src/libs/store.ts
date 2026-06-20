/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 卡片持久化层。封装 Plugin.loadData/saveData，提供 CRUD + 统计 + 去重。
 */

import type { Card } from './types';
import { createCard, cleanCard, isDue } from './srs';

export class CardStore {
    private cards: Card[] = [];
    private plugin: any;

    constructor(plugin: any) {
        this.plugin = plugin;
    }

    /** 从 SiYuan 存储加载卡片（自动清洗）。 */
    async load(): Promise<Card[]> {
        try {
            const data = await this.plugin.loadData('cards');
            this.cards = Array.isArray(data) ? data.map(cleanCard) : [];
        } catch {
            this.cards = [];
        }
        return this.getAll();
    }

    /** 持久化到 SiYuan 存储。 */
    async save(): Promise<void> {
        await this.plugin.saveData('cards', this.cards);
    }

    // ── 查询 ──────────────────────────────────────────────

    /** 返回所有卡片（浅拷贝数组，元素为引用）。 */
    getAll(): Card[] {
        return [...this.cards];
    }

    /** 返回到期卡片（含新卡片，排除 buried）。与 getStats() 的 due 口径一致。 */
    getDue(): Card[] {
        const now = Date.now();
        return this.cards.filter((c) => isDue(c, now));
    }

    /** 按 deck 筛选。 */
    getByDeck(deck: string): Card[] {
        return this.cards.filter((c) => c.deck === deck);
    }

    /** 去重排序后的 deck 列表。 */
    getDecks(): string[] {
        return [...new Set(this.cards.map((c) => c.deck))].sort();
    }

    /** 按 id 查找。 */
    getById(id: string): Card | undefined {
        return this.cards.find((c) => c.id === id);
    }

    /** 所有标签去重排序。 */
    getAllTags(): string[] {
        const set = new Set<string>();
        for (const c of this.cards) {
            for (const t of c.tags) set.add(t);
        }
        return [...set].sort();
    }

    /** 文本搜索（question/answer/hint/tags）。 */
    search(query: string): Card[] {
        const q = query.toLowerCase();
        return this.cards.filter(
            (c) =>
                c.question?.toLowerCase().includes(q) ||
                c.answer?.toLowerCase().includes(q) ||
                c.hint?.toLowerCase().includes(q) ||
                c.tags.some((t) => t.toLowerCase().includes(q))
        );
    }

    // ── 增删改 ────────────────────────────────────────────

    add(card: Card): void {
        this.cards.push(card);
    }

    /** 工厂方法：创建并添加。参数顺序同 createCard。 */
    create(
        question: string,
        answer: string,
        hint = '',
        deck = '默认',
        tags: string[] = [],
        agentId?: string
    ): Card {
        const card = createCard(question, answer, hint, deck, tags, agentId);
        this.add(card);
        return card;
    }

    /** 按 id 部分更新。tags 为数组时整体替换。 */
    update(id: string, updates: Partial<Card>): void {
        const idx = this.cards.findIndex((c) => c.id === id);
        if (idx !== -1) {
            this.cards[idx] = { ...this.cards[idx], ...updates, modified: Date.now() };
        }
    }

    delete(id: string): void {
        this.cards = this.cards.filter((c) => c.id !== id);
    }

    deleteMany(ids: string[]): void {
        const set = new Set(ids);
        this.cards = this.cards.filter((c) => !set.has(c.id));
    }

    clear(): void {
        this.cards = [];
    }

    // ── 去重 ──────────────────────────────────────────────

    /** 归一化问题文本（去定界符/标点/空白）用于去重比较。 */
    static normalizeQ(text: string): string {
        return text
            .replace(/\$+|\\[()[\]]|\s+|[，。？！,.?!:;：；"'`]/g, '')
            .toLowerCase();
    }

    /** 检查是否存在相同问题（归一化后）。 */
    isDuplicate(question: string): boolean {
        const norm = CardStore.normalizeQ(question);
        if (!norm) return false;
        return this.cards.some((c) => CardStore.normalizeQ(c.question) === norm);
    }

    // ── 统计 ──────────────────────────────────────────────

    getStats() {
        const now = Date.now();
        const total = this.cards.length;
        const newCount = this.cards.filter((c) => c.status === 'new').length;
        // due 口径与 getDue() 完全一致：isDue(card)
        const due = this.cards.filter((c) => isDue(c, now)).length;
        const learning = this.cards.filter((c) => c.status === 'learning').length;
        const reviewing = this.cards.filter((c) => c.status === 'review').length;
        const decks = this.getDecks().map((name) => ({
            name,
            count: this.cards.filter((c) => c.deck === name).length,
        }));
        return { total, new: newCount, due, learning, reviewing, decks };
    }

    // ── 导入导出 ──────────────────────────────────────────

    /** 导入卡片数组（自动清洗 + 按 id 合并）。 */
    importCards(rawCards: any[]): { added: number; updated: number } {
        let added = 0;
        let updated = 0;
        for (const raw of rawCards) {
            const card = cleanCard(raw);
            const existing = this.getById(card.id);
            if (existing) {
                Object.assign(existing, card);
                updated++;
            } else {
                this.cards.push(card);
                added++;
            }
        }
        return { added, updated };
    }

    exportCards(): Card[] {
        return this.getAll();
    }
}
