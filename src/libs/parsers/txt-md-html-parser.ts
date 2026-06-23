import * as fs from 'fs';
import type { SourceFileParser, ParseResult } from './types';

export class TxtMdHtmlParser implements SourceFileParser {
    supportedExtensions = ['.txt', '.md', '.markdown', '.html', '.htm', '.csv', '.tsv', '.log', '.xml', '.json'];

    async parse(filePath: string): Promise<ParseResult> {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        let content = fs.readFileSync(filePath, 'utf-8');

        if (ext === 'html' || ext === 'htm') {
            // Simple HTML tag stripping (no jsdom dependency needed)
            content = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        return { text: content, metadata: { format: ext } };
    }
}
