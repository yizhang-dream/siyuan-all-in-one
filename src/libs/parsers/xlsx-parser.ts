import * as XLSX from 'xlsx';
import type { SourceFileParser, ParseResult } from './types';

export class XlsxParser implements SourceFileParser {
    supportedExtensions = ['.xlsx', '.xls'];

    async parse(filePath: string): Promise<ParseResult> {
        const workbook = XLSX.readFile(filePath);
        const sheets = workbook.SheetNames.map(name => {
            const ws = workbook.Sheets[name];
            const csv = XLSX.utils.sheet_to_csv(ws);
            return `--- ${name} ---\n${csv}`;
        });
        return {
            text: sheets.join('\n\n'),
            metadata: { format: 'xlsx', sheetCount: workbook.SheetNames.length },
        };
    }
}
