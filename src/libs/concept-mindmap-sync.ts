import { conceptsToMindmap, type ConceptMindmapResult } from './render/concept-mindmap';
import { genMindmapId, type SavedMindmap } from './mindmap-store';

export interface ConceptStoreSnapshotLike {
    getAll(): any[];
    getRelations(): any[];
}

export interface CardStoreSnapshotLike {
    getAll(): any[];
}

export interface MindmapStoreLike {
    getAll(): SavedMindmap[];
    getById(id: string): SavedMindmap | undefined;
    upsert(mindmap: SavedMindmap): Promise<SavedMindmap>;
}

export interface SyncConceptMindmapOptions {
    title?: string;
    currentMindmapId?: string;
}

export interface SyncConceptMindmapResult {
    saved: SavedMindmap;
    mindmap: ConceptMindmapResult;
}

export async function syncConceptMindmap(
    conceptStore: ConceptStoreSnapshotLike,
    cardStore: CardStoreSnapshotLike,
    mindmapStore: MindmapStoreLike,
    options: SyncConceptMindmapOptions = {}
): Promise<SyncConceptMindmapResult> {
    const concepts = conceptStore.getAll();
    const relations = conceptStore.getRelations();
    const cards = cardStore.getAll();
    const mindmap = conceptsToMindmap(concepts, relations, cards, options.title || '概念图谱');
    const existing = findExistingConceptMindmap(mindmapStore, options.currentMindmapId);
    const now = Date.now();
    const saved: SavedMindmap = {
        id: existing?.id || genMindmapId(),
        title: mindmap.title,
        markdown: mindmap.markdown,
        cardIds: mindmap.cards.map((card) => card.id),
        linkedCardIds: existing?.linkedCardIds || [],
        source: 'concepts',
        created: existing?.created || now,
        modified: now,
    };
    await mindmapStore.upsert(saved);
    return { saved, mindmap };
}

function findExistingConceptMindmap(
    mindmapStore: MindmapStoreLike,
    currentMindmapId?: string
): SavedMindmap | undefined {
    const current = currentMindmapId ? mindmapStore.getById(currentMindmapId) : undefined;
    if (current?.source === 'concepts') return current;
    return mindmapStore
        .getAll()
        .filter((mindmap) => mindmap.source === 'concepts')
        .sort((a, b) => (b.modified || 0) - (a.modified || 0))[0];
}
