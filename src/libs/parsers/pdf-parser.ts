import { createRequire } from 'module';
import type { SourceFileParser, ParseResult } from './types';

const require = createRequire(import.meta.url);
const fs = require('fs');

export class PdfParser implements SourceFileParser {
    supportedExtensions = ['.pdf'];

    async parse(filePath: string): Promise<ParseResult> {
        const { extractPdfText } = await import('../sources/pdf-extractor');
        const buf = fs.readFileSync(filePath);
        const result = await extractPdfText(new Uint8Array(buf).buffer, filePath);
        if (result.error) throw new Error(result.error);
        return { text: result.text, metadata: { format: 'pdf' } };
    }
}
