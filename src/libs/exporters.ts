import type { Card } from './types';
import type { ConceptNode, Relation } from './types/concept';
import type { SavedMindmap } from './mindmap-store';

export type ExportFormat =
    | 'cards-json'
    | 'cards-csv'
    | 'anki-tsv'
    | 'cards-markdown'
    | 'concepts-json'
    | 'mindmaps-markdown';

export interface ExportPayload {
    filename: string;
    mime: string;
    content: string;
}

export interface ExportSnapshot {
    cards?: Card[];
    concepts?: ConceptNode[];
    relations?: Relation[];
    mindmaps?: SavedMindmap[];
}

export function buildExportPayload(format: ExportFormat, snapshot: ExportSnapshot): ExportPayload {
    const cards = snapshot.cards || [];
    const concepts = snapshot.concepts || [];
    const relations = snapshot.relations || [];
    const mindmaps = snapshot.mindmaps || [];
    const stamp = compactDate(new Date());

    switch (format) {
        case 'cards-json':
            return {
                filename: `siyuan-all-in-one-cards-${stamp}.json`,
                mime: 'application/json;charset=utf-8',
                content: stableJSONStringify({ version: 1, type: 'cards', cards }),
            };
        case 'cards-csv':
            return {
                filename: `siyuan-all-in-one-cards-${stamp}.csv`,
                mime: 'text/csv;charset=utf-8',
                content: cardsToCSV(cards),
            };
        case 'anki-tsv':
            return {
                filename: `siyuan-all-in-one-anki-${stamp}.txt`,
                mime: 'text/tab-separated-values;charset=utf-8',
                content: cardsToAnkiTSV(cards),
            };
        case 'cards-markdown':
            return {
                filename: `siyuan-all-in-one-cards-${stamp}.md`,
                mime: 'text/markdown;charset=utf-8',
                content: cardsToMarkdown(cards),
            };
        case 'concepts-json':
            return {
                filename: `siyuan-all-in-one-concepts-${stamp}.json`,
                mime: 'application/json;charset=utf-8',
                content: stableJSONStringify({ version: 1, type: 'concept-graph', concepts, relations, cards }),
            };
        case 'mindmaps-markdown':
            return {
                filename: `siyuan-all-in-one-mindmaps-${stamp}.md`,
                mime: 'text/markdown;charset=utf-8',
                content: mindmapsToMarkdown(mindmaps),
            };
        default:
            throw new Error(`Unsupported export format: ${format satisfies never}`);
    }
}

export function exportPayloadToSiyuanMarkdown(filename: string, content: string): string {
    if (/\.md$/i.test(filename)) return content;
    const lang = /\.json$/i.test(filename) ? 'json' : /\.csv$/i.test(filename) ? 'csv' : 'tsv';
    return [
        `# ${filename}`,
        '',
        `\`\`\`${lang}`,
        content.trimEnd(),
        '```',
        '',
    ].join('\n');
}

export function cardsToCSV(cards: Card[]): string {
    const rows = [
        ['id', 'deck', 'question', 'answer', 'hint', 'tags', 'cardType', 'conceptId', 'agentId', 'linkedMindmapIds', 'sourceRefs', 'scheduler', 'fsrs', 'due', 'interval', 'ease', 'reps', 'lapses', 'consecutiveLapses', 'status', 'occlusion', 'created', 'modified'],
        ...cards.map((card) => [
            card.id,
            card.deck,
            card.question,
            card.answer,
            card.hint || '',
            (card.tags || []).join(' '),
            card.cardType || 'qa',
            card.conceptId || '',
            card.agentId || '',
            (card.linkedMindmapIds || []).join(' '),
            (card.sourceRefs || []).length > 0 ? JSON.stringify(card.sourceRefs) : '',
            card.scheduler || 'sm2',
            card.fsrs ? JSON.stringify(card.fsrs) : '',
            String(card.due || 0),
            String(card.interval || 0),
            String(card.ease || 0),
            String(card.reps || 0),
            String(card.lapses || 0),
            String(card.consecutiveLapses ?? ''),
            card.status || 'new',
            card.occlusion ? JSON.stringify(card.occlusion) : '',
            String(card.created || 0),
            String(card.modified || 0),
        ]),
    ];
    return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

export function cardsToAnkiTSV(cards: Card[]): string {
    return cards
        .map((card) => [
            stripLineBreaks(card.question),
            stripLineBreaks(card.answer),
            stripLineBreaks(card.hint || ''),
            card.deck || '',
            (card.tags || []).join(' '),
        ].map(tsvCell).join('\t'))
        .join('\n') + (cards.length ? '\n' : '');
}

export function cardsToMarkdown(cards: Card[]): string {
    const byDeck = new Map<string, Card[]>();
    for (const card of cards) {
        const deck = card.deck || '默认';
        byDeck.set(deck, [...(byDeck.get(deck) || []), card]);
    }

    const lines = ['# SiYuan All-in-One Cards', ''];
    for (const [deck, deckCards] of [...byDeck.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`## ${deck}`, '');
        deckCards.forEach((card, index) => {
            lines.push(`### ${index + 1}. ${card.question}`);
            lines.push('');
            lines.push(card.answer || '');
            if (card.hint) {
                lines.push('');
                lines.push(`> Hint: ${card.hint}`);
            }
            const meta = [
                card.cardType ? `type=${card.cardType}` : '',
                card.conceptId ? `concept=${card.conceptId}` : '',
                card.tags?.length ? `tags=${card.tags.join(',')}` : '',
            ].filter(Boolean);
            if (meta.length) {
                lines.push('');
                lines.push(`_${meta.join(' · ')}_`);
            }
            lines.push('');
        });
    }
    return lines.join('\n').trimEnd() + '\n';
}

export function mindmapsToMarkdown(mindmaps: SavedMindmap[]): string {
    if (mindmaps.length === 0) return '# SiYuan All-in-One Mindmaps\n\n';
    return mindmaps
        .map((mindmap) => [
            `# ${mindmap.title || mindmap.id}`,
            '',
            `<!-- id=${mindmap.id} source=${mindmap.source || ''} deck=${mindmap.deck || ''} -->`,
            `<!-- siyuan-all-in-one-mindmap=${serializeMindmapMetadata(mindmap)} -->`,
            '',
            mindmap.markdown || '',
        ].join('\n').trimEnd())
        .join('\n\n---\n\n') + '\n';
}

function serializeMindmapMetadata(mindmap: SavedMindmap): string {
    const metadata = {
        version: 1,
        id: mindmap.id,
        title: mindmap.title || '',
        source: mindmap.source || '',
        deck: mindmap.deck || '',
        cardIds: mindmap.cardIds || [],
        linkedCardIds: mindmap.linkedCardIds || [],
        created: mindmap.created || 0,
        modified: mindmap.modified || 0,
    };
    return JSON.stringify(metadata).replace(/--/g, '\\u002d\\u002d');
}

function stableJSONStringify(value: unknown): string {
    return JSON.stringify(value, null, 2) + '\n';
}

function csvCell(value: string): string {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function tsvCell(value: string): string {
    return String(value ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
}

function stripLineBreaks(value: string): string {
    return String(value ?? '').replace(/\r?\n/g, '<br>');
}

function compactDate(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        '-',
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('');
}
