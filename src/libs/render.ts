/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Markdown + math rendering helpers.
 *
 * In SiYuan, prefer the built-in Lute Markdown renderer and SiYuan math renderer.
 * Outside SiYuan, keep a conservative escaped fallback so card text and formulas
 * remain readable instead of becoming unsafe HTML.
 */

let mathJaxLoaded = false;

async function ensureMathJax(): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    if ((window as any).MathJax?.typesetPromise) {
        mathJaxLoaded = true;
        return;
    }
    if (mathJaxLoaded) return;

    return new Promise((resolve) => {
        (window as any).MathJax = {
            tex: {
                inlineMath: [
                    ['$', '$'],
                    ['\\(', '\\)'],
                ],
                displayMath: [
                    ['$$', '$$'],
                    ['\\[', '\\]'],
                ],
            },
            svg: { fontCache: 'global' },
            startup: {
                typeset: false,
                ready: () => {
                    const MJ = (window as any).MathJax;
                    MJ.startup.defaultReady();
                    MJ.startup.promise.then(() => {
                        mathJaxLoaded = true;
                        resolve();
                    });
                },
            },
        };
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
        script.async = true;
        script.onerror = () => resolve();
        script.onload = () => resolve();
        document.head.appendChild(script);
    });
}

export function renderToHTML(text: string): string {
    if (!text) return '';

    const Lute = typeof window !== 'undefined' ? (window as any).Lute : undefined;
    if (Lute?.Md2HTMLDOM) {
        try {
            const html = Lute.Md2HTMLDOM(text);
            if (html) return html;
        } catch {}
    }

    return fallbackMarkdownToHTML(text);
}

export function escapeHTML(text: string): string {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function toInlineMathText(text: string): string {
    return String(text || '')
        .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `$${String(inner).trim()}$`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${String(inner).trim()}$`)
        .replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => `$${String(inner).trim()}$`)
        .replace(/\s+/g, ' ')
        .trim();
}

function fallbackMarkdownToHTML(text: string): string {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let paragraph: string[] = [];
    let listOpen = false;
    let codeOpen = false;
    let codeLines: string[] = [];

    const flushParagraph = () => {
        if (paragraph.length === 0) return;
        out.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
        paragraph = [];
    };
    const closeList = () => {
        if (!listOpen) return;
        out.push('</ul>');
        listOpen = false;
    };

    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, '');
        if (/^```/.test(line.trim())) {
            if (codeOpen) {
                out.push(`<pre><code>${escapeHTML(codeLines.join('\n'))}</code></pre>`);
                codeLines = [];
                codeOpen = false;
            } else {
                flushParagraph();
                closeList();
                codeOpen = true;
            }
            continue;
        }
        if (codeOpen) {
            codeLines.push(rawLine);
            continue;
        }
        if (!line.trim()) {
            flushParagraph();
            closeList();
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            closeList();
            const level = heading[1].length;
            out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }

        const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
        if (bullet) {
            flushParagraph();
            if (!listOpen) {
                out.push('<ul>');
                listOpen = true;
            }
            out.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
            continue;
        }

        paragraph.push(line.trim());
    }

    if (codeOpen) out.push(`<pre><code>${escapeHTML(codeLines.join('\n'))}</code></pre>`);
    flushParagraph();
    closeList();
    return out.join('\n');
}

function renderInlineMarkdown(text: string): string {
    const codeSpans: string[] = [];
    let html = escapeHTML(text).replace(/`([^`]+)`/g, (_m, code) => {
        const token = `\u0000CODE${codeSpans.length}\u0000`;
        codeSpans.push(`<code>${code}</code>`);
        return token;
    });

    html = html
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

    codeSpans.forEach((value, index) => {
        html = html.replace(`\u0000CODE${index}\u0000`, value);
    });
    return html;
}

export async function renderMath(element: HTMLElement): Promise<void> {
    if (!element) return;
    if (typeof window === 'undefined') return;

    const siyuan = (window as any).siyuan;
    if (typeof siyuan?.mathRender === 'function') {
        try {
            siyuan.mathRender(element);
            return;
        } catch {}
    }

    await ensureMathJax();
    const MJ = (window as any).MathJax;
    if (MJ?.typesetPromise) {
        try {
            await MJ.typesetPromise([element]);
        } catch (error) {
            console.warn('[render] MathJax render failed', error);
        }
    }
}
