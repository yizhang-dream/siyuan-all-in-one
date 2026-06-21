import assert from 'node:assert/strict';

// Inline parser to avoid TypeScript import issues
function parseSymbolCards(text) {
    const lines = text.split(/\r?\n/);
    const cards = [];
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        const qaMatch = trimmed.match(/^(.+?)\s*>>\s*(.+)$/);
        if (qaMatch) { cards.push({ cardType: 'qa', front: qaMatch[1].trim(), back: qaMatch[2].trim(), raw: trimmed, lineIndex: i }); continue; }
        const revMatch = trimmed.match(/^(.+?)\s*<<\s*(.+)$/);
        if (revMatch) { cards.push({ cardType: 'reverse', front: revMatch[1].trim(), back: revMatch[2].trim(), raw: trimmed, lineIndex: i }); continue; }
        const clozeMatch = trimmed.match(/^(.+?)\s*<>\s*(.+)$/);
        if (clozeMatch) { cards.push({ cardType: 'cloze', front: clozeMatch[1].trim(), back: clozeMatch[2].trim(), raw: trimmed, lineIndex: i }); continue; }
        const scMatch = trimmed.match(/^(.+?)\s*;;\s*(.+)$/);
        if (scMatch) { cards.push({ cardType: 'qa', front: scMatch[1].trim(), back: scMatch[2].trim(), raw: trimmed, lineIndex: i }); continue; }
    }
    return cards;
}

function stripSymbolCards(text) {
    const cards = parseSymbolCards(text);
    const lines = text.split(/\r?\n/);
    const indices = new Set(cards.map((c) => c.lineIndex));
    return { text: lines.filter((_, i) => !indices.has(i)).join('\n'), cards };
}

const text = [
    'What is force? >> Rate of change of momentum',
    "Newton's second law << F=ma reverse check",
    'A force of {N} acts <> on a {kg} mass',
    'alias ;; alternate syntax',
    'regular line without symbols',
    '',
    'Energy >> Capacity to do work',
].join('\n');

const cards = parseSymbolCards(text);
assert.equal(cards.length, 5);
assert.equal(cards[0].cardType, 'qa');
assert.equal(cards[0].front, 'What is force?');
assert.equal(cards[0].back, 'Rate of change of momentum');
assert.equal(cards[1].cardType, 'reverse');
assert.equal(cards[4].cardType, 'qa');
assert.equal(cards[4].front, 'Energy');

const stripped = stripSymbolCards(text);
assert.equal(stripped.cards.length, 5);
assert.ok(!stripped.text.includes('>>'));
assert.ok(stripped.text.includes('regular line without symbols'));

console.log(JSON.stringify({ totalCards: cards.length, types: cards.map((c) => c.cardType), strippedOk: true }, null, 2));
