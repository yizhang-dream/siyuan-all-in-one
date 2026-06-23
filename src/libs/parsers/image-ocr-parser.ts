import { createWorker } from 'tesseract.js';
import type { SourceFileParser, ParseResult } from './types';

export class ImageOcrParser implements SourceFileParser {
    supportedExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.webp'];

    async parse(filePath: string): Promise<ParseResult> {
        const worker = await createWorker('eng');
        try {
            const { data: { text } } = await worker.recognize(filePath);
            return { text, metadata: { format: 'image', ocrEngine: 'tesseract.js' } };
        } finally {
            await worker.terminate();
        }
    }
}
