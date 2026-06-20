import type { Card } from '../types';
import type { ConceptNode, Relation } from '../types/concept';
import { toInlineMathText } from '../render';

export interface ConceptMindmapResult {
    title: string;
    markdown: string;
    cards: Card[];
    conceptCount: number;
    relationCount: number;
}

export function conceptsToMindmap(
    concepts: ConceptNode[],
    relations: Relation[],
    cards: Card[],
    title = '概念图谱'
): ConceptMindmapResult {
    const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
    const cardsByConceptId = new Map<string, Card[]>();
    for (const card of cards) {
        if (!card.conceptId) continue;
        const group = cardsByConceptId.get(card.conceptId) || [];
        group.push(card);
        cardsByConceptId.set(card.conceptId, group);
    }

    const childIdsByParent = new Map<string, string[]>();
    const incoming = new Set<string>();

    for (const relation of relations) {
        if (relation.type !== 'parent_child') continue;
        if (!conceptById.has(relation.fromId) || !conceptById.has(relation.toId)) continue;
        addChild(childIdsByParent, relation.fromId, relation.toId);
        incoming.add(relation.toId);
    }

    for (const concept of concepts) {
        for (const childId of concept.childIds || []) {
            if (!conceptById.has(childId)) continue;
            addChild(childIdsByParent, concept.id, childId);
            incoming.add(childId);
        }
    }

    const roots = concepts
        .filter((concept) => !incoming.has(concept.id))
        .sort(sortConcepts);
    const orderedRoots = roots.length ? roots : [...concepts].sort(sortConcepts);
    const linkedCards = new Map<string, Card>();
    const lines = [`- ${title}（${concepts.length} 个概念 / ${cards.length} 张卡片）`];
    const visited = new Set<string>();

    for (const root of orderedRoots) {
        appendConcept(lines, root, 1, visited, conceptById, childIdsByParent, cardsByConceptId, linkedCards);
    }

    for (const concept of concepts.sort(sortConcepts)) {
        if (!visited.has(concept.id)) {
            appendConcept(lines, concept, 1, visited, conceptById, childIdsByParent, cardsByConceptId, linkedCards);
        }
    }

    return {
        title,
        markdown: lines.join('\n'),
        cards: [...linkedCards.values()],
        conceptCount: concepts.length,
        relationCount: relations.length,
    };
}

function appendConcept(
    lines: string[],
    concept: ConceptNode,
    depth: number,
    visited: Set<string>,
    conceptById: Map<string, ConceptNode>,
    childIdsByParent: Map<string, string[]>,
    cardsByConceptId: Map<string, Card[]>,
    linkedCards: Map<string, Card>
) {
    const indent = '  '.repeat(depth);
    const alreadyVisited = visited.has(concept.id);
    lines.push(`${indent}- ${escapeLine(concept.title)}${alreadyVisited ? '（已在上方出现）' : ''}`);
    if (alreadyVisited) return;
    visited.add(concept.id);

    if (concept.summary) {
        lines.push(`${indent}  - ${escapeLine(concept.summary)}`);
    }

    const conceptCards = cardsByConceptId.get(concept.id) || [];
    for (const card of conceptCards.sort(sortCards)) {
        linkedCards.set(card.id, card);
        lines.push(`${indent}  - ${toMindmapMath(card.question)} #${card.id}`);
    }

    const childIds = (childIdsByParent.get(concept.id) || []).filter((id, index, arr) => arr.indexOf(id) === index);
    const children = childIds
        .map((id) => conceptById.get(id))
        .filter((child): child is ConceptNode => Boolean(child))
        .sort(sortConcepts);
    for (const child of children) {
        appendConcept(lines, child, depth + 1, visited, conceptById, childIdsByParent, cardsByConceptId, linkedCards);
    }
}

function addChild(map: Map<string, string[]>, parentId: string, childId: string) {
    const children = map.get(parentId) || [];
    if (!children.includes(childId)) children.push(childId);
    map.set(parentId, children);
}

function escapeLine(text: string): string {
    return toInlineMathText(text) || '未命名概念';
}

function sortConcepts(a: ConceptNode, b: ConceptNode): number {
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
}

function sortCards(a: Card, b: Card): number {
    return String(a.question || '').localeCompare(String(b.question || ''), 'zh-CN');
}

function toMindmapMath(text: string): string {
    return toInlineMathText(text);
}
