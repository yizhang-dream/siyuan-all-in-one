/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * 思维导图生成逻辑。
 * - AI 知识树分组（2 层 JSON）
 * - chunk 分割 + 全覆盖校验 + 4 次重试
 * - tree → SiYuan mindmap markdown
 */

import type { Card } from './types';
import type { LLMConfig, KnowledgeTree } from './llm';
import { generateKnowledgeTree } from './llm';
import { stripMath, toSiyuanMath } from './siyuan';
import { toInlineMathText } from './render';

const MAX_CARDS_PER_CALL = 70; // 单次 AI 建树最大卡片数

/** 未分类桶名 */
const UNCATEGORIZED = '未分类';

/**
 * 对一组卡片调用 AI 建树，带全覆盖校验和重试。
 */
async function buildChunkTree(
    cards: Array<{ num: number; question: string }>,
    llmConfig: LLMConfig,
    onWarning?: (msg: string) => void
): Promise<KnowledgeTree> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const tree = await generateKnowledgeTree(cards, llmConfig);
            // 校验覆盖：去重（保留首次出现），统计遗漏
            const allNums = new Set(cards.map((c) => c.num));
            const usedNums = new Set<number>();
            for (const sub of tree.subtopics || []) {
                for (const kp of sub.knowledge_points || []) {
                    for (const n of kp.cards || []) {
                        usedNums.add(n); // 去重：重复分配不再报错，只记一次
                    }
                }
            }
            // 检查遗漏：如果遗漏超过 30% 才认为质量太差
            const missing = [...allNums].filter((n) => !usedNums.has(n));
            const missingRatio = missing.length / allNums.size;
            if (missingRatio > 0.3) {
                throw new Error(`遗漏 ${missing.length}/${allNums.size} 张卡片（>30%）`);
            }
            // 少量遗漏：补到第一个子主题的最后一个知识点
            if (missing.length > 0 && tree.subtopics?.length > 0) {
                const firstSub = tree.subtopics[0];
                const lastKp = firstSub.knowledge_points?.[firstSub.knowledge_points.length - 1];
                if (lastKp) {
                    lastKp.cards = [...(lastKp.cards || []), ...missing];
                } else {
                    firstSub.knowledge_points = [{ name: '其他', cards: missing }];
                }
            }
            // 过滤多余编号（不在输入范围内的）
            for (const sub of tree.subtopics || []) {
                for (const kp of sub.knowledge_points || []) {
                    kp.cards = (kp.cards || []).filter((n) => allNums.has(n));
                }
            }
            return tree;
        } catch (e: any) {
            lastError = e;
            console.warn(`[mindmap] 建树尝试 ${attempt + 1}/4 失败:`, e.message);
        }
    }

    // 全部失败：兜底按卡片问题首字母/首字分组（比单纯的"未分类"有用）
    console.warn('[mindmap] 建树全部失败，使用字母顺序分组兜底:', lastError?.message);
    if (onWarning) {
        onWarning(`AI 分组失败（${lastError?.message || '未知错误'}），已按首字字母分组。`);
    }
    const groups = new Map<string, number[]>();
    for (const c of cards) {
        const key = c.question.replace(/[\[\]\(\)《》$【】]/g, '').trim().charAt(0) || '?';
        const group = groups.get(key) || [];
        group.push(c.num);
        groups.set(key, group);
    }
    const subtopics = Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
        .map(([name, nums]) => ({
            name,
            knowledge_points: [
                { name: `相关卡片（${nums.length}张）`, cards: nums },
            ],
        }));
    return { subtopics };
}

/**
 * 从卡片列表构建知识树。大 deck 自动 chunk 分割。
 * @param cards 卡片列表
 * @param llmConfig LLM 配置
 */
export async function buildTree(
    cards: Card[],
    llmConfig: LLMConfig,
    onWarning?: (msg: string) => void
): Promise<KnowledgeTree> {
    if (cards.length === 0) {
        return { subtopics: [] };
    }

    // 编号（1-based）
    const numbered = cards.map((c, i) => ({
        num: i + 1,
        question: stripMath(c.question),
    }));

    // 小 deck 直接建树
    if (numbered.length <= MAX_CARDS_PER_CALL) {
        return buildChunkTree(numbered, llmConfig, onWarning);
    }

    // 大 deck：分 chunk 建树后合并
    const chunks: Array<typeof numbered> = [];
    for (let i = 0; i < numbered.length; i += MAX_CARDS_PER_CALL) {
        // chunk 内重新编号
        const chunk = numbered.slice(i, i + MAX_CARDS_PER_CALL).map((c, j) => ({
            num: j + 1,
            question: c.question,
        }));
        chunks.push(chunk);
    }

    const subTrees = await Promise.all(
        chunks.map((chunk) => buildChunkTree(chunk, llmConfig, onWarning))
    );

    // 合并：每个 chunk 的 subtopics 作为顶级主题，名称加序号
    // 关键修复：偏移卡片索引，使 chunk 内局部 num 映射回全局 cards 数组
    const merged: KnowledgeTree = { subtopics: [] };
    subTrees.forEach((tree, idx) => {
        const offset = idx * MAX_CARDS_PER_CALL;
        for (const sub of tree.subtopics || []) {
            merged.subtopics.push({
                name: idx > 0 ? `${sub.name} (${idx + 1})` : sub.name,
                knowledge_points: (sub.knowledge_points || []).map((kp) => ({
                    name: kp.name,
                    cards: (kp.cards || []).map((n) => n + offset),
                })),
            });
        }
    });
    return merged;
}

/**
 * 根据 SM-2 复习状态返回稳定文本标记（用于索引列表和导出）。
 */
export function getStatusLabel(card: Card): string {
    if (card.status === 'buried') return '[buried]';
    if (card.status === 'review' && card.reps >= 3 && card.lapses === 0 && card.interval >= 6) return '[mastered]';
    if (card.status === 'learning' || (card.status === 'review' && (card.reps < 3 || card.lapses > 0))) return '[learning]';
    return '[weak]';
}

/**
 * 根据 SM-2 复习状态返回状态分类（用于 markmap 着色）。
 */
export function getStatusCategory(card: Card): 'mastered' | 'learning' | 'weak' | 'buried' {
    if (card.status === 'buried') return 'buried';
    if (card.status === 'review' && card.reps >= 3 && card.lapses === 0 && card.interval >= 6) return 'mastered';
    if (card.status === 'learning' || (card.status === 'review' && (card.reps < 3 || card.lapses > 0))) return 'learning';
    return 'weak';
}

/** 分块阈值：超过此数量的主题才拆分多块，否则保持单个思维导图 */
const SPLIT_THRESHOLD = 3;

/**
 * 将知识树转换为 markmap 的 Markdown 缩进列表格式。
 * 叶子节点带 cardId 标记（#c-xxx），供 markmap 渲染层着色和点击跳转。
 * 不加 emoji 前缀——颜色由 markmap-render 的 color 回调控制。
 */
export function treeToMarkdown(
    tree: KnowledgeTree,
    cards: Card[],
    rootTitle: string
): string {
    const lines: string[] = [`- ${rootTitle}`];

    for (const sub of tree.subtopics || []) {
        lines.push(`  - ${sub.name}`);
        for (const kp of sub.knowledge_points || []) {
            lines.push(`    - ${kp.name}`);
            for (const num of kp.cards || []) {
                const card = cards[num - 1];
                if (card) {
                    lines.push(`      - ${toMindmapLine(card.question)} #${card.id}`);
                }
            }
        }
    }

    return lines.join('\n');
}

/** 单个主题的思维导图 markdown（含知识点和叶子卡片） */
function subtopicToMarkdown(
    subName: string,
    knowledgePoints: KnowledgeTree['subtopics'][0]['knowledge_points'],
    cards: Card[]
): string {
    const lines: string[] = [`- ${subName}`];
    for (const kp of knowledgePoints || []) {
        lines.push(`  - ${kp.name}`);
        for (const num of kp.cards || []) {
            const card = cards[num - 1];
            if (card) {
                lines.push(`    - ${toMindmapLine(card.question)} #${card.id}`);
            }
        }
    }
    return lines.join('\n');
}

/** 总览思维导图：只展示主题层，不展开卡片（折叠视图） */
function treeToOverview(
    tree: KnowledgeTree,
    cards: Card[],
    rootTitle: string
): string {
    const lines: string[] = [`- ${rootTitle}`];
    for (const sub of tree.subtopics || []) {
        const cardCount = (sub.knowledge_points || []).reduce(
            (sum, kp) => sum + (kp.cards?.length || 0), 0
        );
        lines.push(`  - ${sub.name}（${cardCount}张）`);
    }
    return lines.join('\n');
}

/**
 * 思维导图分段：卡片多时拆成「总览 + 每主题一个小图」，少时保持单图。
 * 返回多个 markdown 段，每个段对应文档中的一个思维导图代码块。
 */
export function treeToSections(
    tree: KnowledgeTree,
    cards: Card[],
    rootTitle: string
): Array<{ heading: string; mindmapMd: string }> {
    const subtopics = tree.subtopics || [];

    // 主题少（≤阈值）：保持单个完整思维导图
    if (subtopics.length <= SPLIT_THRESHOLD) {
        return [{ heading: rootTitle, mindmapMd: treeToMarkdown(tree, cards, rootTitle) }];
    }

    // 主题多：总览 + 每主题拆分
    const sections: Array<{ heading: string; mindmapMd: string }> = [];

    // 1. 总览块（折叠视图，只到主题层）
    sections.push({
        heading: `📊 总览`,
        mindmapMd: treeToOverview(tree, cards, rootTitle),
    });

    // 2. 每个主题一个小思维导图
    for (const sub of subtopics) {
        const cardCount = (sub.knowledge_points || []).reduce(
            (sum, kp) => sum + (kp.cards?.length || 0), 0
        );
        if (cardCount === 0) continue;
        sections.push({
            heading: `🔬 ${sub.name}（${cardCount} 张）`,
            mindmapMd: subtopicToMarkdown(sub.name, sub.knowledge_points, cards),
        });
    }

    return sections;
}

/**
 * 生成卡片索引列表 markdown。
 * 每条含复习状态文本 + 卡片 id 锚点 + 问题文本。
 * 按知识点分组排列，与思维导图结构对应。
 */
export function treeToIndex(
    tree: KnowledgeTree,
    cards: Card[]
): string {
    const lines: string[] = ['## 卡片索引', ''];

    for (const sub of tree.subtopics || []) {
        lines.push(`### ${sub.name}`);
        for (const kp of sub.knowledge_points || []) {
            const hasCards = (kp.cards || []).length > 0;
            if (!hasCards) continue;
            lines.push(`**${kp.name}**`);
            for (const num of kp.cards || []) {
                const card = cards[num - 1];
                if (card) {
                    lines.push(`- ${getStatusLabel(card)} \`${card.id}\` ${toSiyuanMath(card.question)}`);
                }
            }
            lines.push('');
        }
    }

    return lines.join('\n');
}

function toMindmapLine(text: string): string {
    return toInlineMathText(text);
}

/**
 * 完整的思维导图生成流程。
 * @param deck 牌组名
 * @param cards 该牌组的卡片列表
 * @param llmConfig LLM 配置
 * @param onWarning 可选回调，用于向 UI 传递警告信息
 * @returns { sections, indexMarkdown, title, cardCount } 用于写入 SiYuan
 */
export async function generateMindmap(
    deck: string,
    cards: Card[],
    llmConfig: LLMConfig,
    onWarning?: (msg: string) => void
): Promise<{
    sections: Array<{ heading: string; mindmapMd: string }>;
    indexMarkdown: string;
    title: string;
    cardCount: number;
    tree: KnowledgeTree;
}> {
    const tree = await buildTree(cards, llmConfig, onWarning);
    const title = `${deck} 知识树（${cards.length} 张卡片）`;
    const sections = treeToSections(tree, cards, title);
    const indexMarkdown = treeToIndex(tree, cards);

    // 检测是否触发了兜底
    const isFallback = tree.subtopics.length > 0 &&
        tree.subtopics.every((s) => s.knowledge_points.length <= 2 && s.name !== UNCATEGORIZED && /^.$/u.test(s.name));
    if (isFallback && onWarning) {
        onWarning('AI 知识树分组失败（可能是 API 限流或超时），已按卡片首字字母分组作为替代。');
    }

    return { sections, indexMarkdown, title, cardCount: cards.length, tree };
}
