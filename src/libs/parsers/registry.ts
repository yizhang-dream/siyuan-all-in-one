import type { SourceFileParser } from './types';

export class ParserRegistry {
    private parsers: SourceFileParser[] = [];

    register(parser: SourceFileParser): void {
        this.parsers.push(parser);
    }

    getParser(extension: string): SourceFileParser | undefined {
        const lower = extension.toLowerCase();
        return this.parsers.find(p =>
            p.supportedExtensions.some(ext => ext.toLowerCase() === lower)
        );
    }

    getSupportedExtensions(): string[] {
        return [...new Set(this.parsers.flatMap(p => p.supportedExtensions))];
    }
}
