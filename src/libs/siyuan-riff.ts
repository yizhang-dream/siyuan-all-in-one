import { fetchSyncPost } from 'siyuan';

export interface RiffDeckInfo {
    id: string;
    name: string;
    size: number;
    created?: string;
    updated?: string;
}

export interface RiffCardInfo {
    cardID: string;
    blockID: string;
    deckID: string;
    nextDues?: string[];
}

export interface RiffDueCards {
    cards: RiffCardInfo[];
    unreviewedCount: number;
    unreviewedNewCardCount: number;
    unreviewedOldCardCount: number;
}

export type RiffRating = 1 | 2 | 3 | 4;

export async function getRiffDecks(): Promise<RiffDeckInfo[]> {
    const response = await riffApi('/api/riff/getRiffDecks', {});
    return Array.isArray(response) ? response.map(normalizeDeck) : [];
}

export async function createRiffDeck(name: string): Promise<RiffDeckInfo | null> {
    const response = await riffApi('/api/riff/createRiffDeck', { name });
    return response ? normalizeDeck(response) : null;
}

export async function addRiffCards(deckID: string, blockIDs: string[]): Promise<RiffDeckInfo | null> {
    if (!deckID || blockIDs.length === 0) return null;
    const response = await riffApi('/api/riff/addRiffCards', { deckID, blockIDs });
    return response ? normalizeDeck(response) : null;
}

export async function removeRiffCards(deckID: string, blockIDs: string[]): Promise<RiffDeckInfo | null> {
    if (blockIDs.length === 0) return null;
    const response = await riffApi('/api/riff/removeRiffCards', { deckID, blockIDs });
    return response ? normalizeDeck(response) : null;
}

export async function getRiffDueCards(deckID = '', reviewedCards: Array<Pick<RiffCardInfo, 'cardID'>> = []): Promise<RiffDueCards> {
    const response = await riffApi('/api/riff/getRiffDueCards', { deckID, reviewedCards });
    return normalizeDueCards(response);
}

export async function reviewRiffCard(
    deckID: string,
    cardID: string,
    rating: RiffRating,
    reviewedCards: Array<Pick<RiffCardInfo, 'cardID'>> = []
): Promise<void> {
    await riffApi('/api/riff/reviewRiffCard', { deckID, cardID, rating, reviewedCards });
}

export async function skipReviewRiffCard(deckID: string, cardID: string): Promise<void> {
    await riffApi('/api/riff/skipReviewRiffCard', { deckID, cardID });
}

async function riffApi(endpoint: string, payload: unknown): Promise<any> {
    const response = await fetchSyncPost(endpoint, payload);
    if (response?.code && response.code !== 0) throw new Error(response.msg || `SiYuan Riff API failed: ${endpoint}`);
    return response?.data ?? response;
}

function normalizeDeck(deck: any): RiffDeckInfo {
    return {
        id: String(deck?.id || ''),
        name: String(deck?.name || ''),
        size: Number(deck?.size || 0),
        created: deck?.created ? String(deck.created) : undefined,
        updated: deck?.updated ? String(deck.updated) : undefined,
    };
}

function normalizeDueCards(data: any): RiffDueCards {
    return {
        cards: Array.isArray(data?.cards) ? data.cards.map(normalizeCard) : [],
        unreviewedCount: Number(data?.unreviewedCount || 0),
        unreviewedNewCardCount: Number(data?.unreviewedNewCardCount || 0),
        unreviewedOldCardCount: Number(data?.unreviewedOldCardCount || 0),
    };
}

function normalizeCard(card: any): RiffCardInfo {
    return {
        cardID: String(card?.cardID || card?.id || ''),
        blockID: String(card?.blockID || ''),
        deckID: String(card?.deckID || ''),
        nextDues: Array.isArray(card?.nextDues) ? card.nextDues.map(String) : undefined,
    };
}
