/**
 * 内置网页抓取器 — 不依赖外部后端。
 * 通过 fetch 获取 URL，去标签/脚本/样式后转为纯文本，再经 Unstructured 分区器切块。
 */

import type { PipelineSource } from '../ai/pipeline';
import { textToUnstructuredPipelineSources } from './unstructured-partitioner';

export interface WebFetchResult {
    url: string;
    title: string;
    text: string;
    status: number;
    error?: string;
}

/** 从 URL 抓取网页内容并转为纯文本 */
export async function fetchWebPage(url: string, signal?: AbortSignal): Promise<WebFetchResult> {
    const normalized = normalizeUrl(url);
    try {
        const response = await fetch(normalized, {
            signal,
            headers: { 'Accept': 'text/html,text/plain' },
        });
        if (!response.ok) {
            return { url: normalized, title: '', text: '', status: response.status, error: `HTTP ${response.status}` };
        }
        const contentType = response.headers.get('content-type') || '';
        const html = await response.text();

        if (contentType.includes('text/plain')) {
            return { url: normalized, title: '', text: cleanText(html), status: response.status };
        }

        const title = extractTitle(html);
        const text = cleanHtml(html);
        return { url: normalized, title, text, status: response.status };
    } catch (err: any) {
        if (err.name === 'AbortError') {
            return { url: normalized, title: '', text: '', status: 0, error: '请求超时' };
        }
        return { url: normalized, title: '', text: '', status: 0, error: err?.message || String(err) };
    }
}

/** 将抓取结果转为 PipelineSource[] */
export function webPageToPipelineSources(result: WebFetchResult, maxSources = 12): PipelineSource[] {
    if (!result.text.trim()) return [];
    const enriched = result.title
        ? `# ${result.title}\n\n${result.text}`
        : result.text;
    return textToUnstructuredPipelineSources(enriched, result.url, { maxElements: maxSources }).map((s) => ({ ...s, type: 'source' as const }));
}

function normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
}

function extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? cleanText(match[1]) : '';
}

function cleanHtml(html: string): string {
    return cleanText(
        html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/h[1-6]>/gi, '\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
    );
}

function cleanText(text: string): string {
    return text
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
