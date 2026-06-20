const CARD_ID_PATTERN = /#(c[\w:-]{3,80})\s*$/i;

export function extractCardIdFromText(text: string): string | null {
    const match = String(text || '').match(CARD_ID_PATTERN);
    return match ? match[1] : null;
}

export function stripCardIdFromText(text: string): string {
    return String(text || '').replace(CARD_ID_PATTERN, '').trim();
}
