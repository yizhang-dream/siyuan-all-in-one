/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Anki 导入文件解析器。支持：
 * 1. .txt / .csv — Anki「导出 → 记忆卡为纯文本」（Tab/分号/竖线分隔）
 * 2. .apkg — Anki 包（ZIP + SQLite），需导出时勾选「支持旧版 Anki」
 *
 * 注意：新版 Anki 默认导出的 .apkg 用加密的 anki21b 格式，
 * 浏览器端无法读取。请在导出时勾选「支持旧版 Anki，效率较低」选项。
 */

import { toSiyuanMath } from './siyuan';

/** 解析后的导入卡片 */
export interface ParsedCard {
    question: string;
    answer: string;
    hint: string;
    deck: string;
    tags: string[];
    duplicate: boolean;
}

export class AnkiParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AnkiParseError';
    }
}

export interface ParseStats {
    total: number;
    duplicates: number;
    importable: number;
}

// ─── 辅助 ─────────────────────────────────────────────────

function stripHtml(html: string): string {
    if (!html) return '';
    let r = html;
    r = r.replace(/<br\s*\/?>/gi, '\n');
    r = r.replace(/<\/div>/gi, '\n');
    r = r.replace(/<div[^>]*>/gi, '');
    r = r.replace(/<\/?(b|i|strong|em|u|s|sub|sup|mark)[^>]*>/gi, '');
    r = r.replace(/<[^>]+>/g, '');
    for (const [ent, ch] of [['&nbsp;',' '],['&amp;','&'],['&lt;','<'],['&gt;','>'],['&quot;','"'],['&#39;',"'"]]) {
        r = r.split(ent).join(ch);
    }
    return r.trim();
}

export function calcStats(cards: ParsedCard[]): ParseStats {
    const total = cards.length;
    const duplicates = cards.filter((c) => c.duplicate).length;
    return { total, duplicates, importable: total - duplicates };
}

// ─── .txt 解析 ────────────────────────────────────────────

function detectDelimiter(line: string): string {
    if (line.includes('\t')) return '\t';
    if (line.includes(';')) return ';';
    if (line.includes('|')) return '|';
    return '';
}

export function parseAnkiTxt(
    text: string,
    defaultDeck: string = 'Anki 导入',
    isDuplicate?: (question: string) => boolean
): ParsedCard[] {
    if (!text || !text.trim()) throw new AnkiParseError('文件内容为空');

    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) throw new AnkiParseError('文件无有效行');

    const delimiter = detectDelimiter(lines[0]);
    if (!delimiter) {
        throw new AnkiParseError('无法检测分隔符。请确认文件由 Anki 导出（Tab/分号/竖线分隔）。');
    }

    const cards: ParsedCard[] = [];
    for (const line of lines) {
        const parts = line.split(delimiter).map((p) => p.trim());
        if (parts.length < 2) continue;

        const question = stripHtml(parts[0]);
        const answer = stripHtml(parts[1]);
        if (!question || !answer) continue;

        let hint = '';
        let tags: string[] = [];
        if (parts.length >= 3 && parts[2].trim()) {
            const third = parts[2].trim();
            const possibleTags = third.split(/\s+/).filter(Boolean);
            if (possibleTags.length > 1 || /^[a-zA-Z0-9_\u4e00-\u9fff-]+$/.test(third)) {
                tags = possibleTags;
            } else {
                hint = third;
            }
        }
        if (parts.length >= 4 && parts[3].trim()) {
            tags = [...tags, ...parts[3].trim().split(/\s+/).filter(Boolean)];
        }

        cards.push({
            question: toSiyuanMath(question),
            answer: toSiyuanMath(answer),
            hint: toSiyuanMath(hint),
            deck: defaultDeck,
            tags,
            duplicate: isDuplicate ? isDuplicate(question) : false,
        });
    }

    if (cards.length === 0) throw new AnkiParseError('未解析出有效卡片');
    return cards;
}

// ─── .apkg 解析（ZIP + SQLite） ───────────────────────────

/** 加载 sql.js 纯 asm.js 版本（无 WASM 依赖）。 */
async function loadSqlJs(): Promise<any> {
    // @ts-ignore
    const initSqlJs = (await import('sql.js/dist/sql-asm.js')).default;
    return await initSqlJs({});
}

/**
 * 解析 .apkg 文件。
 * 遍历 ZIP 内所有 collection 文件，自动跳过「请更新」桩和无法读取的加密格式。
 */
export async function parseAnkiApkg(
    fileBuffer: ArrayBuffer,
    isDuplicate?: (question: string) => boolean
): Promise<ParsedCard[]> {
    const { unzipSync } = await import('fflate');
    const files = unzipSync(new Uint8Array(fileBuffer));

    console.log('[anki] ZIP 内文件:', Object.keys(files).map((n) => `${n}(${files[n].length}B)`));

    const SQL = await loadSqlJs();
    // 按优先级尝试每个候选文件
    const candidates = Object.keys(files).filter((n) => n.match(/collection/i));
    let lastError: string = '';

    for (const name of candidates) {
        console.log(`[anki] 尝试 ${name}...`);
        try {
            const db = new SQL.Database(files[name]);

            // 验证是否是有效数据库
            const testResult = db.exec('SELECT count(*) FROM notes');
            if (testResult.length === 0) {
                db.close();
                continue;
            }
            const noteCount = testResult[0].values[0][0] as number;
            console.log(`[anki] ${name}: notes=${noteCount}`);

            // 跳过兼容性桩（只有 1 条"请更新"提示）
            if (noteCount <= 1) {
                const sample = db.exec('SELECT flds FROM notes LIMIT 1');
                if (sample.length > 0) {
                    const flds = sample[0].values[0][0] as string;
                    if (flds && flds.includes('请更新')) {
                        db.close();
                        console.warn(`[anki] ${name}: 兼容性桩，跳过`);
                        continue;
                    }
                }
            }

            try {
                const cards = extractCardsFromDb(db, isDuplicate);
                console.log(`[anki] ${name} 成功提取 ${cards.length} 张卡片`);
                return cards;
            } finally {
                db.close();
            }
        } catch (e: any) {
            console.warn(`[anki] ${name} 读取失败:`, e.message);
            lastError = e.message;
        }
    }

    throw new AnkiParseError(
        '无法读取 apkg 数据库。' +
        (lastError ? `（${lastError}）` : '') +
        '\n请尝试以下方法之一：\n' +
        '1. 在 Anki 导出时勾选「支持旧版 Anki」选项\n' +
        '2. 或用「记忆卡为纯文本」格式导出为 .txt 文件'
    );
}

/** 从 SQLite 数据库提取卡片。 */
function extractCardsFromDb(db: any, isDuplicate?: (q: string) => boolean): ParsedCard[] {
    // 1. 读 col 表
    let decks: Record<string, { name: string }> = {};
    let models: Record<string, { flds: Array<{ name: string }> }> = {};
    try {
        const colResult = db.exec('SELECT decks, models FROM col LIMIT 1');
        if (colResult.length > 0 && colResult[0].values.length > 0) {
            const row = colResult[0].values[0];
            decks = JSON.parse(row[0] || '{}');
            models = JSON.parse(row[1] || '{}');
        }
    } catch (e) {
        console.warn('[anki] 读取 col 表失败', e);
    }

    // 2. 读 notes（用字符串 key 避免大整数精度问题）
    const notesResult = db.exec('SELECT id, mid, tags, flds FROM notes');
    if (notesResult.length === 0) throw new AnkiParseError('数据库中无 notes');

    const noteMap = new Map<string, { mid: string; tags: string[]; fields: string[] }>();
    for (const row of notesResult[0].values) {
        noteMap.set(String(row[0]), {
            mid: String(row[1]),
            tags: ((row[2] as string) || '').split(' ').filter(Boolean),
            fields: ((row[3] as string) || '').split('\x1f'),
        });
    }

    // 3. 读 cards 关联 note + deck
    const cardsResult = db.exec('SELECT nid, did FROM cards');
    const cards: ParsedCard[] = [];

    if (cardsResult.length > 0) {
        for (const row of cardsResult[0].values) {
            const note = noteMap.get(String(row[0]));
            if (!note) continue;
            const parsed = mapNoteToCard(note, String(row[1]), decks, models, isDuplicate);
            if (parsed) cards.push(parsed);
        }
    } else {
        for (const [, note] of noteMap) {
            const parsed = mapNoteToCard(note, '1', decks, models, isDuplicate);
            if (parsed) cards.push(parsed);
        }
    }

    if (cards.length === 0) throw new AnkiParseError('未从数据库提取出有效卡片');
    return cards;
}

function mapNoteToCard(
    note: { mid: string; tags: string[]; fields: string[] },
    did: string,
    decks: Record<string, { name: string }>,
    models: Record<string, { flds: Array<{ name: string }> }>,
    isDuplicate?: (q: string) => boolean
): ParsedCard | null {
    const fields = note.fields;
    const model = models[note.mid];
    const fieldNames = model?.flds?.map((f) => f.name) || [];

    const getField = (...names: string[]): string => {
        for (const name of names) {
            const idx = fieldNames.indexOf(name);
            if (idx >= 0 && fields[idx]) return fields[idx];
        }
        for (const name of names) {
            for (let i = 0; i < fieldNames.length; i++) {
                if (fieldNames[i].toLowerCase() === name.toLowerCase() && fields[i]) return fields[i];
            }
        }
        return '';
    };

    let q = fieldNames.length ? getField('Question', 'Front', '正面', '问') : '';
    let a = fieldNames.length ? getField('Answer', 'Back', '背面', '答') : '';
    let h = fieldNames.length ? getField('Hint', 'Extra', '提示') : '';

    // 位置兜底
    if (!q && fields[0]) q = fields[0];
    if (!a && fields[1]) a = fields[1];
    if (!h && fields[2]) h = fields[2];

    const question = stripHtml(q);
    const answer = stripHtml(a);
    if (!question || !answer) return null;

    return {
        question: toSiyuanMath(question),
        answer: toSiyuanMath(answer),
        hint: toSiyuanMath(stripHtml(h)),
        deck: decks[did]?.name || 'Anki 导入',
        tags: note.tags || [],
        duplicate: isDuplicate ? isDuplicate(question) : false,
    };
}

// ─── 统一入口 ─────────────────────────────────────────────

export async function parseAnkiFile(
    file: File,
    defaultDeck: string = 'Anki 导入',
    isDuplicate?: (question: string) => boolean
): Promise<ParsedCard[]> {
    const name = file.name.toLowerCase();

    if (name.endsWith('.apkg')) {
        return parseAnkiApkg(await file.arrayBuffer(), isDuplicate);
    }

    const text = await file.text();
    return parseAnkiTxt(text, defaultDeck, isDuplicate);
}
