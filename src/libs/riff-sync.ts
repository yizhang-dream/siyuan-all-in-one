import type { Card } from './types';
import { addRiffCards, createRiffDeck, getRiffDecks, type RiffDeckInfo } from './siyuan-riff';
import { createDoc, ensureNotebook, insertBlock, sanitizeDocTitle, setBlockAttrs, updateBlock } from './siyuan';

export interface RiffSyncOptions {
    notebookName?: string;
    docTitle?: string;
    deckName?: string;
    maxCards?: number;
    existingRecords?: RiffSyncRecord[];
    skipExisting?: boolean;
}

export interface RiffSyncResult {
    docId: string;
    deck: RiffDeckInfo | null;
    blockIds: string[];
    updatedBlockIds: string[];
    skippedCardIds: string[];
    createdRecords: RiffSyncRecord[];
    updatedRecords: RiffSyncRecord[];
    nextRecords: RiffSyncRecord[];
}

export interface RiffSyncRecord {
    cardId: string;
    blockId: string;
    deckId: string;
    deckName: string;
    docId: string;
    syncedAt: number;
    cardModified: number;
}

export interface RiffSyncState {
    version: 1;
    records: RiffSyncRecord[];
}

export type RiffProjectionStatus = 'fresh' | 'stale' | 'unsynced' | 'orphan';

export interface RiffProjectionAuditEntry {
    status: RiffProjectionStatus;
    cardId: string;
    question: string;
    blockId: string;
    deckName: string;
    docId: string;
    cardModified: number;
    syncedAt: number;
}

export interface RiffProjectionAudit {
    deckName: string;
    totalCards: number;
    eligibleCards: number;
    records: number;
    fresh: number;
    stale: number;
    unsynced: number;
    orphanRecords: number;
    entries: RiffProjectionAuditEntry[];
}

export async function syncCardsToSiyuanRiff(cards: Card[], options: RiffSyncOptions = {}): Promise<RiffSyncResult> {
    const deckName = options.deckName || '知识闪卡 All-in-One';
    const existingRecords = cleanRiffSyncState({ version: 1, records: options.existingRecords || [] }).records;
    const recordsByCardId = new Map(
        existingRecords
            .filter((record) => sameDeckName(record.deckName, deckName))
            .map((record) => [record.cardId, record])
    );
    const validCards = cards.filter((card) => card.question?.trim() && card.answer?.trim());
    const updatedRecords: RiffSyncRecord[] = [];
    const updatedBlockIds: string[] = [];
    const skippedCardIds = options.skipExisting === false
        ? []
        : validCards.filter((card) => isFreshSync(recordsByCardId.get(card.id), card)).map((card) => card.id);
    const selectedForCreate = validCards
        .filter((card) => options.skipExisting === false || !recordsByCardId.has(card.id))
        .slice(0, options.maxCards || 200);
    const selectedForUpdate = options.skipExisting === false
        ? []
        : validCards
            .filter((card) => isStaleSync(recordsByCardId.get(card.id), card))
            .slice(0, Math.max(0, (options.maxCards || 200) - selectedForCreate.length));
    if (validCards.length === 0) throw new Error('No cards to sync to SiYuan Riff');
    if (selectedForCreate.length === 0 && selectedForUpdate.length === 0) {
        return {
            docId: '',
            deck: null,
            blockIds: [],
            updatedBlockIds: [],
            skippedCardIds,
            createdRecords: [],
            updatedRecords: [],
            nextRecords: existingRecords,
        };
    }

    for (const card of selectedForUpdate) {
        const existing = recordsByCardId.get(card.id);
        if (!existing) continue;
        await updateBlock(existing.blockId, cardToRiffMarkdown(card));
        await setBlockAttrs(existing.blockId, buildRiffCardAttrs(card));
        updatedBlockIds.push(existing.blockId);
        updatedRecords.push({
            ...existing,
            syncedAt: Date.now(),
            cardModified: card.modified || 0,
        });
    }

    let docId = '';
    let finalDeck: RiffDeckInfo | null = null;
    if (selectedForCreate.length > 0) {
        const notebookId = await ensureNotebook(options.notebookName || '知识闪卡');
        const title = sanitizeDocTitle(options.docTitle || `Riff 同步 ${new Date().toISOString().slice(0, 10)}`) || 'Riff 同步';
        docId = await createDoc(notebookId, title);
        if (!docId) throw new Error('Failed to create SiYuan document for Riff sync');
    }

    const deck = selectedForCreate.length > 0 ? await ensureRiffDeck(deckName) : null;
    const blockIds: string[] = [];
    const createdRecords: RiffSyncRecord[] = [];
    let previousId = '';

    for (const card of selectedForCreate) {
        const blockId = await insertBlock(docId, cardToRiffMarkdown(card), previousId || undefined);
        if (!blockId) continue;
        previousId = blockId;
        blockIds.push(blockId);
        await setBlockAttrs(blockId, buildRiffCardAttrs(card));
        createdRecords.push({
            cardId: card.id,
            blockId,
            deckId: deck?.id || '',
            deckName: deck?.name || deckName,
            docId,
            syncedAt: Date.now(),
            cardModified: card.modified || 0,
        });
    }

    if (selectedForCreate.length > 0 && blockIds.length === 0) throw new Error('No SiYuan blocks were created for Riff sync');
    if (deck && blockIds.length > 0) {
        finalDeck = await addRiffCards(deck.id, blockIds) || deck;
    }
    const normalizedCreated = createdRecords.map((record) => ({
        ...record,
        deckId: finalDeck?.id || record.deckId,
        deckName: finalDeck?.name || record.deckName,
    }));
    return {
        docId,
        deck: finalDeck,
        blockIds,
        updatedBlockIds,
        skippedCardIds,
        createdRecords: normalizedCreated,
        updatedRecords,
        nextRecords: mergeRiffSyncRecords(existingRecords, [...updatedRecords, ...normalizedCreated]),
    };
}

export async function ensureRiffDeck(name: string): Promise<RiffDeckInfo> {
    const decks = await getRiffDecks();
    const existing = decks.find((deck) => deck.name === name);
    if (existing) return existing;
    const created = await createRiffDeck(name);
    if (!created?.id) throw new Error(`Failed to create SiYuan Riff deck: ${name}`);
    return created;
}

export function cardToRiffMarkdown(card: Card): string {
    const lines = [
        `**Q:** ${normalizeInline(card.question)}`,
        '',
        `==A: ${normalizeInline(card.answer)}==`,
    ];
    if (card.hint) {
        lines.push('', `> Hint: ${normalizeInline(card.hint)}`);
    }
    const meta = [
        card.deck ? `deck=${card.deck}` : '',
        card.cardType ? `type=${card.cardType}` : '',
        card.conceptId ? `concept=${card.conceptId}` : '',
    ].filter(Boolean).join(' · ');
    if (meta) lines.push('', `_${meta}_`);
    return lines.join('\n');
}

function buildRiffCardAttrs(card: Card): Record<string, string> {
    return {
        'custom-aio-card-id': card.id,
        'custom-aio-concept-id': card.conceptId || '',
        'custom-aio-card-type': card.cardType || 'qa',
        'custom-aio-source-refs': safeJSONStringify(card.sourceRefs || []),
    };
}

function normalizeInline(value: string): string {
    return String(value || '').replace(/\r?\n/g, '<br>').trim();
}

function safeJSONStringify(value: unknown): string {
    return JSON.stringify(value).replace(/--/g, '\\u002d\\u002d');
}

export function cleanRiffSyncState(raw: any): RiffSyncState {
    const records = Array.isArray(raw?.records) ? raw.records : Array.isArray(raw) ? raw : [];
    return {
        version: 1,
        records: records.map(cleanRiffSyncRecord).filter((record): record is RiffSyncRecord => Boolean(record)),
    };
}

export function mergeRiffSyncRecords(existing: RiffSyncRecord[], created: RiffSyncRecord[]): RiffSyncRecord[] {
    const byKey = new Map<string, RiffSyncRecord>();
    for (const record of [...existing, ...created]) {
        byKey.set(`${record.deckName}::${record.cardId}`, record);
    }
    return [...byKey.values()];
}

export function auditRiffSyncProjection(
    cards: Card[],
    records: RiffSyncRecord[],
    deckName = '知识闪卡 All-in-One'
): RiffProjectionAudit {
    const eligibleCards = cards.filter((card) => card.question?.trim() && card.answer?.trim());
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    const deckRecords = cleanRiffSyncState({ version: 1, records }).records.filter((record) => sameDeckName(record.deckName, deckName));
    const recordsByCardId = new Map(deckRecords.map((record) => [record.cardId, record]));
    const entries: RiffProjectionAuditEntry[] = [];

    for (const card of eligibleCards) {
        const record = recordsByCardId.get(card.id);
        if (!record) {
            entries.push({
                status: 'unsynced',
                cardId: card.id,
                question: card.question,
                blockId: '',
                deckName,
                docId: '',
                cardModified: Number(card.modified || 0),
                syncedAt: 0,
            });
            continue;
        }
        entries.push({
            status: isFreshSync(record, card) ? 'fresh' : 'stale',
            cardId: card.id,
            question: card.question,
            blockId: record.blockId,
            deckName: record.deckName,
            docId: record.docId,
            cardModified: Number(card.modified || 0),
            syncedAt: record.syncedAt,
        });
    }

    for (const record of deckRecords) {
        if (cardsById.has(record.cardId)) continue;
        entries.push({
            status: 'orphan',
            cardId: record.cardId,
            question: '',
            blockId: record.blockId,
            deckName: record.deckName,
            docId: record.docId,
            cardModified: record.cardModified,
            syncedAt: record.syncedAt,
        });
    }

    return {
        deckName,
        totalCards: cards.length,
        eligibleCards: eligibleCards.length,
        records: deckRecords.length,
        fresh: entries.filter((entry) => entry.status === 'fresh').length,
        stale: entries.filter((entry) => entry.status === 'stale').length,
        unsynced: entries.filter((entry) => entry.status === 'unsynced').length,
        orphanRecords: entries.filter((entry) => entry.status === 'orphan').length,
        entries,
    };
}

function cleanRiffSyncRecord(raw: any): RiffSyncRecord | null {
    const cardId = String(raw?.cardId || '');
    const blockId = String(raw?.blockId || '');
    const deckId = String(raw?.deckId || '');
    const deckName = String(raw?.deckName || '');
    if (!cardId || !blockId || !deckName) return null;
    return {
        cardId,
        blockId,
        deckId,
        deckName,
        docId: String(raw?.docId || ''),
        syncedAt: Number(raw?.syncedAt || 0),
        cardModified: Number(raw?.cardModified || 0),
    };
}

function normalizeDeckName(value: string): string {
    return String(value || '').trim().toLowerCase();
}

function sameDeckName(a: string, b: string): boolean {
    return normalizeDeckName(a) === normalizeDeckName(b);
}

function isFreshSync(record: RiffSyncRecord | undefined, card: Card): boolean {
    return Boolean(record && Number(record.cardModified || 0) >= Number(card.modified || 0));
}

function isStaleSync(record: RiffSyncRecord | undefined, card: Card): boolean {
    return Boolean(record && Number(record.cardModified || 0) < Number(card.modified || 0));
}

// ── 块属性清理 ────────────────────────────────────────────

export interface BlockAttrRecord {
    blockId: string;
    cardId: string;
    deckName: string;
    docId: string;
    syncedAt: number;
    attrs: string[];
}

export interface BlockAttrScanReport {
    totalBlocks: number;
    blocksWithAttrs: BlockAttrRecord[];
    attrKeys: string[];
}

const PLUGIN_BLOCK_ATTRS = ['custom-aio-card-id', 'custom-aio-concept-id', 'custom-aio-card-type', 'custom-aio-source-refs'];

/** 从 riff-sync 记录构建块属性扫描报告。不访问思源 API，只基于本地同步记录。 */
export function buildBlockAttrScanReport(state: RiffSyncState): BlockAttrScanReport {
    const seen = new Set<string>();
    const blocks: BlockAttrRecord[] = [];
    for (const rec of state.records) {
        if (seen.has(rec.blockId)) continue;
        seen.add(rec.blockId);
        blocks.push({
            blockId: rec.blockId,
            cardId: rec.cardId,
            deckName: rec.deckName,
            docId: rec.docId,
            syncedAt: rec.syncedAt,
            attrs: [...PLUGIN_BLOCK_ATTRS],
        });
    }
    return { totalBlocks: blocks.length, blocksWithAttrs: blocks, attrKeys: [...PLUGIN_BLOCK_ATTRS] };
}

export function getPluginBlockAttrKeys(): string[] {
    return [...PLUGIN_BLOCK_ATTRS];
}
