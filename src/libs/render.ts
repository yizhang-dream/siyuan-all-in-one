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

    return escapeHTML(text).replace(/\n/g, '<br>');
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
