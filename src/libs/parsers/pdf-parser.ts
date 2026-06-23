import type { SourceFileParser, ParseResult } from './types';

// Use eval('require') — works in Electron renderer's CJS context without throwing.
// createRequire(import.meta.url) throws in Vite CJS bundle because import.meta.url is shimmed.
const fs: typeof import('fs') = eval('require')('fs');

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
