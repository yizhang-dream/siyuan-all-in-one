/**
 * 内置 Unstructured 兼容分区器 — 纯 JS 实现，无需 Python/外部服务。
 * 参考 Unstructured partition() 的 element 类型：
 *   Title, NarrativeText, ListItem, Table, CodeBlock, UncategorizedText
 *
 * 支持的输入格式：.txt, .md, .markdown, .html
 * 未来可扩展 PDF/docx（需外部 worker）。
 */

import type { PipelineSource } from '../ai/pipeline';

export type UnstructuredElementType =
    | 'Title'
    | 'NarrativeText'
    | 'ListItem'
    | 'Table'
    | 'CodeBlock'
    | 'UncategorizedText';

export interface UnstructuredElement {
    type: UnstructuredElementType;
    text: string;
    metadata?: {
        pageNumber?: number;
        fileName?: string;
        parentTitle?: string;
        listLevel?: number;
        language?: string;
        emphasized?: boolean;
    };
}

export interface UnstructuredPartitionOptions {
    maxChars?: number;
    maxElements?: number;
    preserveEmpty?: boolean;
    fileName?: string;
}

const MAX_CHARS_PER_ELEMENT = 4000;
const MAX_ELEMENTS = 60;

/** 将 HTML/Markdown/纯文本分区为 Unstructured 兼容元素列表 */
export function partitionText(text: string, options: UnstructuredPartitionOptions = {}): UnstructuredElement[] {
    const opts = {
        maxChars: options.maxChars || MAX_CHARS_PER_ELEMENT,
        maxElements: options.maxElements || MAX_ELEMENTS,
        fileName: options.fileName || '',
        preserveEmpty: options.preserveEmpty || false,
    };
    // 检测格式
    if (/<[a-z][\s\S]*>/i.test(text.slice(0, 500))) {
        return partitionHtml(text, opts);
    }
    if (/^#{1,6}\s|^\*{1,3}[^*]|^- |^\d+\. |^> |```/.test(text.slice(0, 500))) {
        return partitionMarkdown(text, opts);
    }
    return partitionPlainText(text, opts);
}

function partitionMarkdown(text: string, opts: Required<UnstructuredPartitionOptions>): UnstructuredElement[] {
    const lines = text.split(/\r?\n/);
    const elements: UnstructuredElement[] = [];
    let currentText = '';
    let currentType: UnstructuredElementType = 'NarrativeText';
    let parentTitle = '';
    let listLevel = 0;
    let inCodeBlock = false;
    let codeText = '';

    function flush() {
        const trimmed = currentText.trim();
        if (trimmed || opts.preserveEmpty) {
            elements.push({
                type: currentType,
                text: trimmed.slice(0, opts.maxChars),
                metadata: {
                    fileName: opts.fileName,
                    parentTitle: parentTitle || undefined,
                    listLevel: listLevel || undefined,
                },
            });
        }
        currentText = '';
    }

    for (const line of lines) {
        // Code block fence
        if (/^```/.test(line.trim())) {
            flush();
            if (inCodeBlock) {
                if (codeText.trim()) {
                    elements.push({
                        type: 'CodeBlock',
                        text: codeText.trim().slice(0, opts.maxChars),
                        metadata: { fileName: opts.fileName, parentTitle: parentTitle || undefined },
                    });
                }
                codeText = '';
            }
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) {
            codeText += line + '\n';
            continue;
        }

        // Heading
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
        if (headingMatch) {
            flush();
            parentTitle = headingMatch[2].trim();
            elements.push({
                type: 'Title',
                text: parentTitle.slice(0, opts.maxChars),
                metadata: { fileName: opts.fileName },
            });
            continue;
        }

        // List item
        const listMatch = line.match(/^(\s*)[-*+]\s+(.+)/) || line.match(/^(\s*)\d+\.\s+(.+)/);
        if (listMatch) {
            flush();
            listLevel = Math.floor(listMatch[1].length / 2) + 1;
            currentType = 'ListItem';
            currentText = listMatch[2].trim();
            flush();
            continue;
        }

        // Blockquote
        const quoteMatch = line.match(/^>\s?(.+)/);
        if (quoteMatch) {
            if (currentType !== 'NarrativeText') flush();
            currentType = 'NarrativeText';
            currentText += (currentText ? ' ' : '') + quoteMatch[1].trim();
            continue;
        }

        // Table row (minimal: pipe-delimited)
        if (/^\|.+\|$/.test(line.trim()) && !/^[\s|:-]+$/.test(line.trim())) {
            if (currentType !== 'Table') flush();
            currentType = 'Table';
            currentText += (currentText ? '\n' : '') + line.trim();
            continue;
        }

        // Empty line
        if (!line.trim()) {
            flush();
            currentType = 'NarrativeText';
            continue;
        }

        // Regular text
        if (currentType !== 'NarrativeText') flush();
        currentType = 'NarrativeText';
        currentText += (currentText ? ' ' : '') + line.trim();
    }

    flush();
    return elements.slice(0, opts.maxElements);
}

function partitionHtml(text: string, opts: Required<UnstructuredPartitionOptions>): UnstructuredElement[] {
    // 保守去标签 + 实体解码
    let cleaned = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n## $1\n')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1\n')
        .replace(/<p[^>]*>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n');
    return partitionMarkdown(cleaned, opts);
}

function partitionPlainText(text: string, opts: Required<UnstructuredPartitionOptions>): UnstructuredElement[] {
    const paragraphs = text.split(/\n{2,}/);
    const elements: UnstructuredElement[] = [];

    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;

        // 检测是否为 headline
        if (trimmed.length <= 100 && !trimmed.endsWith('.') && !trimmed.includes('\n')) {
            elements.push({
                type: 'Title',
                text: trimmed.slice(0, opts.maxChars),
                metadata: { fileName: opts.fileName },
            });
            continue;
        }

        // 检测列表
        if (/^[-*+]\s|^\d+\.\s/.test(trimmed)) {
            for (const line of trimmed.split('\n')) {
                const stripped = line.replace(/^[-*+\d.]\s+/, '').trim();
                if (stripped) {
                    elements.push({
                        type: 'ListItem',
                        text: stripped.slice(0, opts.maxChars),
                        metadata: { fileName: opts.fileName },
                    });
                }
            }
            continue;
        }

        elements.push({
            type: 'NarrativeText',
            text: trimmed.slice(0, opts.maxChars),
            metadata: { fileName: opts.fileName },
        });
    }

    return elements.slice(0, opts.maxElements);
}

/** 将 Unstructured 元素列表转为 PipelineSource[] */
export function unstructuredElementsToPipelineSources(
    elements: UnstructuredElement[],
    sourceId: string
): PipelineSource[] {
    // 按标题分组：每个 Title 之后的 NarrativeText/ListItem 归属该标题
    const sources: PipelineSource[] = [];
    let currentTitle = '';
    let chunkIndex = 0;

    for (const el of elements) {
        if (el.type === 'Title') {
            currentTitle = el.text;
            sources.push({
                id: `${sourceId}-title-${chunkIndex}`,
                type: 'source',
                sourceId,
                chunkId: `${sourceId}-title-${chunkIndex}`,
                quote: el.text.slice(0, 240),
                text: el.text,
            });
            chunkIndex++;
            continue;
        }

        const text = currentTitle
            ? `## ${currentTitle}\n\n${el.text}`
            : el.text;
        const elementType = el.type === 'CodeBlock' ? 'code' : el.type === 'Table' ? 'table' : el.type === 'ListItem' ? 'list' : 'text';
        sources.push({
            id: `${sourceId}-${chunkIndex}`,
            type: 'source',
            sourceId,
            chunkId: `${sourceId}-${chunkIndex}`,
            quote: text.slice(0, 240),
            text,
        });
        chunkIndex++;
    }

    return sources.slice(0, MAX_ELEMENTS);
}

/** 一站式：文本 → Unstructured 分区 → PipelineSource[] */
export function textToUnstructuredPipelineSources(
    text: string,
    fileName: string,
    options: UnstructuredPartitionOptions = {}
): PipelineSource[] {
    const sourceId = `unstructured-${hashText(fileName + text.slice(0, 100))}`;
    const elements = partitionText(text, { ...options, fileName });
    return unstructuredElementsToPipelineSources(elements, sourceId);
}

function hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36).slice(0, 8);
}
