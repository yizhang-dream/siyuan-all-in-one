/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Markmap 交互式思维导图渲染封装。
 * 基于 markmap-lib（Markdown→树）+ markmap-view（树→SVG）+ d3。
 *
 * 功能：渲染交互式 SVG 导图，支持折叠/缩放/平移/节点着色/节点点击。
 */

import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import type { INode } from 'markmap-common';
import type { CSSItem, JSItem } from 'markmap-common';
import { extractCardIdFromText, stripCardIdFromText } from './card-id';

let transformer: Transformer | null = null;

function getTransformer(): Transformer {
    if (!transformer) transformer = new Transformer();
    return transformer;
}

/** 注入 markmap 渲染所需的 CSS（katex 等），只在首次调用时注入一次 */
let assetsInjected = false;
function injectAssets(result: { features?: Record<string, boolean> }) {
    if (assetsInjected) return;
    const assets = getTransformer().getUsedAssets(result.features || {});
    if (assets.styles) {
        for (const style of assets.styles) {
            injectStyle(style);
        }
    }
    if (assets.scripts) {
        for (const script of assets.scripts) {
            injectScript(script);
        }
    }
    assetsInjected = true;
}

function injectStyle(style: CSSItem) {
    if (style.type === 'style') {
        const el = document.createElement('style');
        el.textContent = style.data;
        document.head.appendChild(el);
        return;
    }

    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = style.data.href;
    document.head.appendChild(el);
}

function injectScript(script: JSItem) {
    if (script.type === 'iife') {
        script.data.fn(...(script.data.getParams?.(undefined) || []));
        return;
    }

    const el = document.createElement('script');
    if (script.data.src) el.src = script.data.src;
    if (script.data.textContent) el.textContent = script.data.textContent;
    el.async = script.data.async ?? true;
    el.defer = script.data.defer ?? false;
    document.head.appendChild(el);
}

/**
 * 卡片复习状态对应的颜色（hex）。
 * 与 getStatusEmoji 对齐，但返回颜色值供 markmap color 回调使用。
 */
export function statusToColor(status: 'mastered' | 'learning' | 'weak' | 'buried'): string {
    switch (status) {
        case 'mastered': return '#22c55e'; // 绿
        case 'learning': return '#eab308'; // 黄
        case 'weak': return '#ef4444';     // 红
        case 'buried': return '#9ca3af';   // 灰
    }
}

export interface RenderOptions {
    /** 卡片 id → 颜色的映射，用于节点着色 */
    cardColors?: Map<string, string>;
    /** 节点点击回调（参数为卡片 id，非卡片节点为空字符串） */
    onNodeClick?: (cardId: string, nodeText: string) => void;
    /** 初始展开层级（默认 2，只展开到知识点层） */
    initialExpandLevel?: number;
}

/**
 * 渲染交互式思维导图到指定 SVG 元素。
 * @param svgEl 目标 <svg> 元素
 * @param markdown 思维导图的 Markdown 缩进列表
 * @param options 渲染选项
 * @returns Markmap 实例（可调用 fit() 等方法）
 */
export async function renderMarkmap(
    svgEl: SVGElement,
    markdown: string,
    options: RenderOptions = {}
): Promise<Markmap> {
    const { cardColors, onNodeClick, initialExpandLevel = 2 } = options;

    // 1. Markdown → 节点树
    const transformer = getTransformer();
    const { root, features } = transformer.transform(markdown);

    // 注入 katex 等 CSS/JS 资源（首次）
    injectAssets({ features });

    // 2. 清空旧内容
    svgEl.innerHTML = '';

    // 3. 渲染 SVG 导图
    const mm = Markmap.create(svgEl, {
        initialExpandLevel,
        zoom: true,
        pan: true,
        duration: 300,
        // 自定义节点颜色：从 cardColors 映射中查找
        color: (node: INode) => {
            const cardId = extractCardId(node);
            if (cardId && cardColors?.has(cardId)) {
                return cardColors.get(cardId)!;
            }
            return undefined; // undefined 让 markmap 用默认色
        },
    }, root);

    // 4. 挂载节点点击事件（遍历 markmap 节点，匹配 cardId）
    if (onNodeClick) {
        setTimeout(() => {
            const nodes = svgEl.querySelectorAll('.markmap-node');
            nodes.forEach((nodeEl) => {
                // 只取该节点自己的文本（不包含子节点）
                const firstText = nodeEl.querySelector('foreignObject span, foreignObject div, tspan');
                const rawText = firstText?.textContent?.trim() || '';
                // 也检查整个节点的文本（兜底）
                const fullText = stripHtml(nodeEl.innerHTML || '');
                const cardId = extractCardIdFromText(rawText) || extractCardIdFromText(fullText);
                if (cardId) {
                    (nodeEl as HTMLElement).style.cursor = 'pointer';
                    nodeEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        onNodeClick(cardId, stripCardIdFromText(rawText));
                    });
                }
            });
        }, 200); // 等 markmap 完全渲染
    }

    return mm;
}

/**
 * 从 INode 中提取卡片 id。
 * 叶子节点 content 可能是 HTML（markmap 渲染后），需要先提取纯文本。
 */
function extractCardId(node: INode): string | null {
    if (!node) return null;
    // content 可能是纯文本或 HTML，先去标签
    const text = stripHtml(String(node.content || ''));
    return extractCardIdFromText(text);
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').trim();
}

/** 自适应缩放，让导图完整显示在容器内 */
export function fitMarkmap(mm: Markmap): void {
    try {
        mm.fit();
    } catch {
        // markmap-view 的 fit 可能需要延迟
        setTimeout(() => mm.fit(), 200);
    }
}
