import type { Card } from './types';
import type { ConceptNode, Relation } from './types/concept';
import type { SavedMindmap } from './mindmap-store';

export type PluginImportKind =
    | 'cards-json'
    | 'concepts-json'
    | 'mindmaps-markdown'
    | 'mixed-json'
    | 'unknown';

export interface PluginImportPayload {
    kind: PluginImportKind;
    cards: Card[];
    concepts: ConceptNode[];
    relations: Relation[];
    mindmaps: SavedMindmap[];
    warnings: string[];
}

export function parsePluginImport(content: string, filename = ''): PluginImportPayload {
    const empty = createEmptyPayload();
    const trimmed = String(content || '').trim();
    if (!trimmed) {
        return { ...empty, warnings: ['文件内容为空'] };
    }

    if (looksLikeMarkdown(filename, trimmed)) {
        const mindmaps = parseMindmapsMarkdown(trimmed);
        if (mindmaps.length > 0) {
            return { ...empty, kind: 'mindmaps-markdown', mindmaps };
        }
    }

    if (looksLikeJSON(filename, trimmed)) {
        try {
            return parsePluginJSON(JSON.parse(trimmed));
        } catch (error: any) {
            return { ...empty, warnings: [`JSON 解析失败：${error?.message || error}`] };
        }
    }

    return { ...empty, kind: 'unknown', warnings: ['未识别为插件备份格式'] };
}

export function parseMindmapsMarkdown(content: string): SavedMindmap[] {
    return splitMindmapSections(content)
        .map(parseMindmapSection)
        .filter(Boolean) as SavedMindmap[];
}

function parsePluginJSON(value: any): PluginImportPayload {
    const payload = createEmptyPayload();
    if (Array.isArray(value)) {
        return { ...payload, kind: 'cards-json', cards: value as Card[] };
    }

    if (!value || typeof value !== 'object') {
        return { ...payload, warnings: ['JSON 顶层结构不是对象或数组'] };
    }

    const cards = Array.isArray(value.cards) ? value.cards : [];
    const concepts = Array.isArray(value.concepts) ? value.concepts : [];
    const relations = Array.isArray(value.relations) ? value.relations : [];
    const mindmaps = Array.isArray(value.mindmaps) ? value.mindmaps : [];

    if (value.type === 'cards' && cards.length >= 0) {
        return { ...payload, kind: 'cards-json', cards };
    }
    if (value.type === 'concept-graph') {
        return { ...payload, kind: 'concepts-json', cards, concepts, relations };
    }
    if (cards.length || concepts.length || relations.length || mindmaps.length) {
        return { ...payload, kind: 'mixed-json', cards, concepts, relations, mindmaps };
    }
    return { ...payload, warnings: ['JSON 中没有可导入的 cards/concepts/relations/mindmaps'] };
}

function parseMindmapSection(section: string): SavedMindmap | undefined {
    const meta = parseMindmapMetadata(section) || parseLegacyMindmapMetadata(section);
    if (!meta) return undefined;
    if (!String(meta.id || '').trim()) return undefined;
    const markdown = section
        .replace(/^# .+$/m, '')
        .replace(/<!--\s*id=.*?-->/g, '')
        .replace(/<!--\s*siyuan-all-in-one-mindmap=.*?-->/g, '')
        .trim();
    const now = Date.now();
    return {
        id: String(meta.id || ''),
        title: String(meta.title || titleFromSection(section) || meta.id || 'Untitled mindmap'),
        markdown,
        cardIds: toStringArray(meta.cardIds),
        linkedCardIds: toStringArray(meta.linkedCardIds),
        deck: meta.deck === undefined ? undefined : String(meta.deck),
        source: normalizeMindmapSource(meta.source),
        created: Number(meta.created) || now,
        modified: Number(meta.modified) || now,
    };
}

function parseMindmapMetadata(section: string): any | undefined {
    const match = section.match(/<!--\s*siyuan-all-in-one-mindmap=(.+?)\s*-->/s);
    if (!match) return undefined;
    try {
        return JSON.parse(match[1]);
    } catch {
        return undefined;
    }
}

function parseLegacyMindmapMetadata(section: string): any | undefined {
    const match = section.match(/<!--\s*id=([^\s]+)\s+source=([^\s]*)\s+deck=(.*?)\s*-->/);
    if (!match) return undefined;
    return {
        id: match[1],
        source: match[2],
        deck: match[3],
        title: titleFromSection(section),
        cardIds: [],
        linkedCardIds: [],
    };
}

function splitMindmapSections(content: string): string[] {
    return content
        .split(/\n\s*---\s*\n/g)
        .map((section) => section.trim())
        .filter(Boolean);
}

function titleFromSection(section: string): string {
    return section.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
}

function looksLikeMarkdown(filename: string, content: string): boolean {
    return /\.(md|markdown)$/i.test(filename) || /siyuan-all-in-one-mindmap=|<!--\s*id=/.test(content);
}

function looksLikeJSON(filename: string, content: string): boolean {
    return /\.json$/i.test(filename) || content.startsWith('{') || content.startsWith('[');
}

function normalizeMindmapSource(value: any): SavedMindmap['source'] {
    const source = String(value || '');
    return source === 'cards' || source === 'doc' || source === 'concepts' ? source : 'manual';
}

function toStringArray(value: any): string[] {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function createEmptyPayload(): PluginImportPayload {
    return {
        kind: 'unknown',
        cards: [],
        concepts: [],
        relations: [],
        mindmaps: [],
        warnings: [],
    };
}
