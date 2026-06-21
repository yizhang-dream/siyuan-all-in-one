/**
 * 符号监听快速制卡 — 仿 SiYuanMemo 的 `&gt;&gt;` `&lt;&lt;` `&lt;&gt;` `;;` 快速制卡语法。
 * 适用场景：在手动文本输入或思源块中直接写制卡符号，插件自动解析并生成卡片。
 *
 * 语法：
 *   Q &gt;&gt; A          → qa 卡（问答卡）
 *   Q &lt;&lt; A          → reverse 卡（反向卡，答案变问题，问题变答案）
 *   front &lt;&gt; back   → cloze 卡（填空卡，front 和 back 拼接时自动挖空）
 *   Q ;; A           → 第二语法变体（answer 分号优先解析）
 */

export interface ParsedSymbolCard {
    /** 原始行文本 */
    raw: string;
    /** 卡片类型 */
    cardType: 'qa' | 'reverse' | 'cloze';
    /** 问题面 */
    front: string;
    /** 答案面 */
    back: string;
    /** 可选提示 */
    hint?: string;
    /** 在原文中的行号（0-based） */
    lineIndex: number;
}

/** 从多行文本中解析所有符号卡片候选 */
export function parseSymbolCards(text: string): ParsedSymbolCard[] {
    const lines = text.split(/\r?\n/);
    const cards: ParsedSymbolCard[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const parsed = parseLine(line, i);
        if (parsed) cards.push(parsed);
    }

    return cards;
}

function parseLine(line: string, lineIndex: number): ParsedSymbolCard | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // >>  qa card
    const qaMatch = trimmed.match(/^(.+?)\s*>>\s*(.+)$/);
    if (qaMatch) {
        return {
            raw: trimmed,
            cardType: 'qa',
            front: qaMatch[1].trim(),
            back: qaMatch[2].trim(),
            lineIndex,
        };
    }

    // <<  reverse card
    const revMatch = trimmed.match(/^(.+?)\s*<<\s*(.+)$/);
    if (revMatch) {
        return {
            raw: trimmed,
            cardType: 'reverse',
            front: revMatch[1].trim(),
            back: revMatch[2].trim(),
            lineIndex,
        };
    }

    // <>  cloze card
    const clozeMatch = trimmed.match(/^(.+?)\s*<>\s*(.+)$/);
    if (clozeMatch) {
        return {
            raw: trimmed,
            cardType: 'cloze',
            front: clozeMatch[1].trim(),
            back: clozeMatch[2].trim(),
            lineIndex,
        };
    }

    // ;;  second syntax (qa)
    const scMatch = trimmed.match(/^(.+?)\s*;;\s*(.+)$/);
    if (scMatch) {
        return {
            raw: trimmed,
            cardType: 'qa',
            front: scMatch[1].trim(),
            back: scMatch[2].trim(),
            lineIndex,
        };
    }

    return null;
}

/** 从卡片文本中移除已解析的符号行，返回纯文本和新卡片列表 */
export function stripSymbolCards(text: string): { text: string; cards: ParsedSymbolCard[] } {
    const cards = parseSymbolCards(text);
    const lines = text.split(/\r?\n/);
    const cardLineIndices = new Set(cards.map((card) => card.lineIndex));
    const remaining = lines.filter((_, i) => !cardLineIndices.has(i)).join('\n');
    return { text: remaining, cards };
}
