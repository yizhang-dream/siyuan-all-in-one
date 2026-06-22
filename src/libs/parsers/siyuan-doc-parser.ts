import type { SourceFileParser, ParseResult } from './types';

export class SiyuanDocParser implements SourceFileParser {
    supportedExtensions = []; // Not matched by extension; accessed via parseSiyuanDoc()

    async parse(_filePath: string): Promise<ParseResult> {
        throw new Error('SiyuanDocParser.parse() not supported. Use parseSiyuanDoc(docId) instead.');
    }

    async parseSiyuanDoc(docId: string): Promise<ParseResult> {
        const sql = `SELECT * FROM blocks WHERE root_id = '${docId}' AND type = 'd' ORDER BY sort`;
        const resp = await fetch('/api/query/sql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stmt: sql }),
        });
        const json = await resp.json();
        if (json.code !== 0 || !json.data?.length) {
            throw new Error(`SiYuan doc read failed: ${json.msg || 'no blocks found'}`);
        }
        const blocks = json.data;
        const text = blocks.map((b: any) => b.markdown || b.content || '').join('\n\n');
        const title = blocks[0]?.content || docId;

        return { text, metadata: { format: 'siyuan-doc', docId, title } };
    }
}
