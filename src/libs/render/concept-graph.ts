import type { ConceptNode, Relation, RelationType } from '../types/concept';

export interface ConceptGraphCardLike {
    id: string;
    question?: string;
    conceptId?: string;
}

export interface ConceptGraphNode {
    id: string;
    title: string;
    summary?: string;
    x: number;
    y: number;
    depth: number;
    cardCount: number;
    sourceCount: number;
    tagCount: number;
    isRoot: boolean;
}

export interface ConceptGraphEdge {
    id: string;
    fromId: string;
    toId: string;
    type: RelationType;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    confidence?: number;
}

export interface ConceptGraphModel {
    nodes: ConceptGraphNode[];
    edges: ConceptGraphEdge[];
    width: number;
    height: number;
}

const WIDTH = 1000;
const HEIGHT = 640;
const LEFT = 96;
const TOP = 72;
const X_GAP = 220;

export function buildConceptGraph(
    concepts: ConceptNode[],
    relations: Relation[],
    cards: ConceptGraphCardLike[] = []
): ConceptGraphModel {
    const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
    const visibleRelations = relations.filter((relation) =>
        conceptById.has(relation.fromId) && conceptById.has(relation.toId)
    );

    const childIdsByParent = new Map<string, string[]>();
    for (const relation of visibleRelations) {
        if (relation.type !== 'parent_child') continue;
        const children = childIdsByParent.get(relation.fromId) || [];
        if (!children.includes(relation.toId)) children.push(relation.toId);
        childIdsByParent.set(relation.fromId, children);
    }
    for (const concept of concepts) {
        for (const childId of concept.childIds || []) {
            if (!conceptById.has(childId)) continue;
            const children = childIdsByParent.get(concept.id) || [];
            if (!children.includes(childId)) children.push(childId);
            childIdsByParent.set(concept.id, children);
        }
    }

    const incoming = new Set<string>();
    for (const [parentId, children] of childIdsByParent.entries()) {
        if (!conceptById.has(parentId)) continue;
        for (const childId of children) incoming.add(childId);
    }

    const roots = concepts
        .filter((concept) => !incoming.has(concept.id))
        .sort(sortConcepts);
    const orderedRoots = roots.length ? roots : [...concepts].sort(sortConcepts);

    const depthById = new Map<string, number>();
    const visited = new Set<string>();
    const queue = orderedRoots.map((concept) => ({ id: concept.id, depth: 0 }));
    while (queue.length) {
        const current = queue.shift()!;
        const previousDepth = depthById.get(current.id);
        if (previousDepth !== undefined && previousDepth <= current.depth) continue;
        depthById.set(current.id, current.depth);
        if (visited.has(`${current.id}:${current.depth}`)) continue;
        visited.add(`${current.id}:${current.depth}`);
        for (const childId of childIdsByParent.get(current.id) || []) {
            queue.push({ id: childId, depth: current.depth + 1 });
        }
    }
    for (const concept of concepts) {
        if (!depthById.has(concept.id)) depthById.set(concept.id, 0);
    }

    const byDepth = new Map<number, ConceptNode[]>();
    for (const concept of concepts) {
        const depth = depthById.get(concept.id) || 0;
        const group = byDepth.get(depth) || [];
        group.push(concept);
        byDepth.set(depth, group);
    }

    const directCardCount = new Map<string, number>();
    for (const card of cards) {
        if (!card.conceptId) continue;
        directCardCount.set(card.conceptId, (directCardCount.get(card.conceptId) || 0) + 1);
    }

    const nodes: ConceptGraphNode[] = [];
    for (const [depth, group] of [...byDepth.entries()].sort(([a], [b]) => a - b)) {
        const sorted = group.sort(sortConcepts);
        const usableHeight = Math.max(1, HEIGHT - TOP * 2);
        const step = usableHeight / Math.max(1, sorted.length);
        sorted.forEach((concept, index) => {
            const cardIds = new Set(concept.cardIds || []);
            const cardCount = Math.max(cardIds.size, directCardCount.get(concept.id) || 0);
            nodes.push({
                id: concept.id,
                title: concept.title,
                summary: concept.summary,
                x: Math.min(WIDTH - 96, LEFT + depth * X_GAP),
                y: TOP + step * index + step / 2,
                depth,
                cardCount,
                sourceCount: concept.sourceRefs?.length || 0,
                tagCount: concept.tags?.length || 0,
                isRoot: !incoming.has(concept.id),
            });
        });
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edges = visibleRelations
        .map((relation) => {
            const from = nodeById.get(relation.fromId);
            const to = nodeById.get(relation.toId);
            if (!from || !to) return null;
            return {
                id: relation.id,
                fromId: relation.fromId,
                toId: relation.toId,
                type: relation.type,
                x1: from.x,
                y1: from.y,
                x2: to.x,
                y2: to.y,
                confidence: relation.confidence,
            };
        })
        .filter((edge: ConceptGraphEdge | null): edge is ConceptGraphEdge => Boolean(edge));

    return { nodes, edges, width: WIDTH, height: HEIGHT };
}

function sortConcepts(a: ConceptNode, b: ConceptNode): number {
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
}
