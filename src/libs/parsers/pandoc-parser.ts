import { createRequire } from 'module';
import type { SourceFileParser, ParseResult } from './types';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');

/**
 * 通过 SiYuan 内置 Pandoc API 转换文档格式。
 * 支持：DOCX, PPTX, EPUB, ODT, RTF, Org, RST, LaTeX 等 Pandoc 支持的输入格式。
 */
export class PandocParser implements SourceFileParser {
    supportedExtensions = ['.docx', '.doc', '.pptx', '.ppt', '.epub', '.odt', '.rtf', '.org', '.rst', '.tex'];

    async parse(filePath: string): Promise<ParseResult> {
        
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath).slice(1);
        const dir = `pandoc-${Date.now()}`;

        // Step 1: Upload file to SiYuan temp directory via putFile
        const fileBuf = fs.readFileSync(filePath);
        const base64 = fileBuf.toString('base64');
        
        await fetch('/api/file/putFile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: `/temp/convert/pandoc/${dir}/${fileName}`,
                file: base64,
                isDir: false,
            }),
        });

        // Step 2: Call Pandoc API to convert
        const convertResp = await fetch('/api/convert/pandoc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dir,
                args: ['--to', 'markdown_strict-raw_html', fileName, '-o', 'output.md'],
            }),
        });
        const convertJson = await convertResp.json();
        if (convertJson.code !== 0) {
            throw new Error(`Pandoc conversion failed: ${convertJson.msg}`);
        }

        // Step 3: Get converted file content
        const outputUrl = `/api/file/getFile?path=${encodeURIComponent(`/temp/convert/pandoc/${dir}/output.md`)}`;
        const outputResp = await fetch(outputUrl);
        const outputJson = await outputResp.json();
        
        let text = '';
        if (outputJson.code === 0 && outputJson.data) {
            // getFile returns base64-encoded content
            const buf = Buffer.from(outputJson.data, 'base64');
            text = buf.toString('utf-8');
        } else {
            throw new Error(`Failed to read Pandoc output: ${outputJson.msg}`);
        }

        return { text, metadata: { format: ext, converter: 'pandoc' } };
    }
}
