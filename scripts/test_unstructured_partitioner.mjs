import assert from 'node:assert/strict';

// Inline partitioner functions (mirror src/libs/sources/unstructured-partitioner.ts)
function hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return Math.abs(hash).toString(36).slice(0, 8);
}

function partitionMarkdown(text, opts) {
    const lines = text.split(/\r?\n/);
    const elements = [];
    let currentText = '', currentType = 'NarrativeText', parentTitle = '', listLevel = 0;
    let inCodeBlock = false, codeText = '';

    function flush() {
        const trimmed = currentText.trim();
        if (trimmed || opts.preserveEmpty) {
            elements.push({ type: currentType, text: trimmed.slice(0, opts.maxChars), metadata: { fileName: opts.fileName, parentTitle: parentTitle || undefined, listLevel: listLevel || undefined } });
        }
        currentText = '';
    }

    for (const line of lines) {
        if (/^```/.test(line.trim())) { flush(); if (inCodeBlock) { if (codeText.trim()) elements.push({ type: 'CodeBlock', text: codeText.trim().slice(0, opts.maxChars), metadata: { fileName: opts.fileName } }); codeText = ''; } inCodeBlock = !inCodeBlock; continue; }
        if (inCodeBlock) { codeText += line + '\n'; continue; }
        const h = line.match(/^(#{1,6})\s+(.+)/);
        if (h) { flush(); parentTitle = h[2].trim(); elements.push({ type: 'Title', text: parentTitle.slice(0, opts.maxChars), metadata: { fileName: opts.fileName } }); continue; }
        const li = line.match(/^(\s*)[-*+]\s+(.+)/) || line.match(/^(\s*)\d+\.\s+(.+)/);
        if (li) { flush(); listLevel = Math.floor(li[1].length / 2) + 1; currentType = 'ListItem'; currentText = li[2].trim(); flush(); continue; }
        const q = line.match(/^>\s?(.+)/);
        if (q) { if (currentType !== 'NarrativeText') flush(); currentType = 'NarrativeText'; currentText += (currentText ? ' ' : '') + q[1].trim(); continue; }
        if (/^\|.+\|$/.test(line.trim()) && !/^[\s|:-]+$/.test(line.trim())) { if (currentType !== 'Table') flush(); currentType = 'Table'; currentText += (currentText ? '\n' : '') + line.trim(); continue; }
        if (!line.trim()) { flush(); currentType = 'NarrativeText'; continue; }
        if (currentType !== 'NarrativeText') flush();
        currentType = 'NarrativeText'; currentText += (currentText ? ' ' : '') + line.trim();
    }
    flush();
    return elements.slice(0, opts.maxElements);
}

// Markdown test
const md = [
    '# SM-2 Algorithm',
    '',
    'The SM-2 algorithm is a spaced repetition method developed by Piotr Wozniak.',
    'It uses an ease factor to determine optimal review intervals.',
    '',
    '## Key Concepts',
    '- Active recall',
    '- Spaced repetition',
    '- Ease factor',
    '',
    '```',
    'EF := EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))',
    '```',
    '',
    '| Grade | Quality | Interval |',
    '|-------|---------|----------|',
    '| 0     | Again   | 1 day    |',
    '| 3     | Easy    | grows    |',
    '',
    '> The most effective learning happens at the edge of forgetting.',
].join('\n');

const opts = { maxChars: 4000, maxElements: 40, fileName: 'sm2.md', preserveEmpty: false };
const elements = partitionMarkdown(md, opts);

assert.ok(elements.length >= 5, `Expected >=5 elements, got ${elements.length}`);
assert.equal(elements[0].type, 'Title');
assert.equal(elements[0].text, 'SM-2 Algorithm');
assert.ok(elements.some((e) => e.type === 'ListItem' && e.text === 'Active recall'));
assert.ok(elements.some((e) => e.type === 'CodeBlock' && e.text.includes('EF :=')));
assert.ok(elements.some((e) => e.type === 'Table'));
assert.ok(elements.some((e) => e.type === 'NarrativeText' && e.text.includes('spaced repetition')));

// Plain text partitioning
const plain = '# Introduction\n\nThis is a paragraph about the topic.\n\n# Section One\n\n- Point A\n- Point B';
const plainElements = partitionMarkdown(plain, opts);
assert.ok(plainElements.some((e) => e.type === 'Title' && e.text === 'Introduction'));
assert.ok(plainElements.some((e) => e.type === 'ListItem' && e.text === 'Point A'));

console.log(JSON.stringify({
    totalElements: elements.length,
    types: [...new Set(elements.map((e) => e.type))],
    hasTitle: true,
    hasList: true,
    hasCode: true,
    hasTable: true,
    hasNarrativeText: true,
    plainTextWorks: true,
}, null, 2));
