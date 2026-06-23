export interface ParseResult {
    text: string;
    metadata: Record<string, any>;
}

export interface SourceFileParser {
    /** 支持的扩展名列表（含点号，如 '.docx', '.pdf'） */
    supportedExtensions: string[];
    /** 从文件路径解析文本 */
    parse(filePath: string): Promise<ParseResult>;
    /** 可选：从 Buffer 解析 */
    parseBuffer?(buffer: Buffer, filename: string): Promise<ParseResult>;
}
