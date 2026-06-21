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
 * 与 getStatusCategory 对齐，但返回颜色值供 markmap color 回调使用。
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
    /** 导图体量画像；传入后会自动启用大图降压渲染策略 */
    sizeProfile?: MindmapSizeProfile;
}

export interface MindmapSizeProfile {
    nodeCount: number;
    maxDepth: number;
    cardNodeCount: number;
    initialExpandLevel: number;
    sizeClass: 'small' | 'medium' | 'large' | 'huge';
}

export interface MindmapRenderTuning {
    animationDuration: number;
    clickBindChunkSize: number;
    clickBindDelay: number;
    fitDelay: number;
    chunkedClickBinding: boolean;
}

export interface MindmapSearchMatch {
    index: number;
    node: INode;
    text: string;
    path: string[];
    depth: number;
    cardId: string | null;
    ancestors: INode[];
}

export interface MindmapSearchResult {
    query: string;
    matches: MindmapSearchMatch[];
    activeIndex: number;
    activeMatch: MindmapSearchMatch | null;
}

export type MindmapMarkdownViewMode = 'all' | 'cards' | 'gaps' | 'focus';

export interface MindmapMarkdownViewStats {
    totalNodes: number;
    visibleNodes: number;
    cardNodes: number;
    gapLeaves: number;
    mode: MindmapMarkdownViewMode;
    query: string;
}

export interface MindmapMarkdownView {
    markdown: string;
    stats: MindmapMarkdownViewStats;
}

export function profileMindmapMarkdown(markdown: string): MindmapSizeProfile {
    let nodeCount = 0;
    let maxDepth = 0;
    let cardNodeCount = 0;

    for (const line of markdown.split(/\r?\n/)) {
        const match = line.match(/^(\s*)-\s+(.+)$/);
        if (!match) continue;
        nodeCount += 1;
        const depth = Math.floor(match[1].replace(/\t/g, '  ').length / 2) + 1;
        maxDepth = Math.max(maxDepth, depth);
        if (extractCardIdFromText(match[2])) cardNodeCount += 1;
    }

    const sizeClass =
        nodeCount >= 700 ? 'huge' :
        nodeCount >= 240 ? 'large' :
        nodeCount >= 90 ? 'medium' :
        'small';
    const initialExpandLevel =
        sizeClass === 'huge' ? 1 :
        sizeClass === 'large' ? 1 :
        sizeClass === 'medium' ? 2 :
        3;

    return { nodeCount, maxDepth, cardNodeCount, initialExpandLevel, sizeClass };
}

export function filterMindmapMarkdown(
    markdown: string,
    mode: MindmapMarkdownViewMode = 'all',
    rawQuery = ''
): MindmapMarkdownView {
    const nodes = parseMarkdownNodes(markdown);
    const query = normalizeSearchText(rawQuery);
    const cardNodes = nodes.filter((node) => node.cardId).length;
    const gapLeaves = nodes.filter((node) => isLeafNode(node) && !node.cardId).length;
    const statsBase = { totalNodes: nodes.length, cardNodes, gapLeaves, mode, query };
    if (mode === 'all' || nodes.length === 0) {
        return {
            markdown,
            stats: { ...statsBase, visibleNodes: nodes.length },
        };
    }

    const included = new Set<MindmapMarkdownNode>();
    const includeAncestors = (node: MindmapMarkdownNode) => {
        let current: MindmapMarkdownNode | undefined = node;
        while (current) {
            included.add(current);
            current = current.parent;
        }
    };
    const includeChildren = (node: MindmapMarkdownNode) => {
        for (const child of node.children) included.add(child);
    };

    for (const node of nodes) {
        if (mode === 'cards' && node.cardId) {
            includeAncestors(node);
        } else if (mode === 'gaps' && isLeafNode(node) && !node.cardId) {
            includeAncestors(node);
        } else if (mode === 'focus' && query && node.searchable.includes(query)) {
            includeAncestors(node);
            includeChildren(node);
        }
    }

    const visibleNodes = nodes.filter((node) => included.has(node));
    return {
        markdown: renderMarkdownNodes(visibleNodes) || '- 无匹配节点',
        stats: { ...statsBase, visibleNodes: visibleNodes.length },
    };
}

export function extractCardIdsFromMindmapMarkdown(markdown: string): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const line of markdown.split(/\r?\n/)) {
        const match = line.match(/^(\s*)-\s+(.+)$/);
        if (!match) continue;
        const cardId = extractCardIdFromText(match[2]);
        if (!cardId || seen.has(cardId)) continue;
        seen.add(cardId);
        ids.push(cardId);
    }
    return ids;
}

export interface MindmapGapNode {
    title: string;
    cleanTitle: string;
    pathText: string;
    depth: number;
    cardId: string | null;
}

/** 从导图 markdown 中提取叶子节点中还没有卡片 ID 的节点（缺卡节点）。 */
export function extractGapNodes(markdown: string): MindmapGapNode[] {
    const nodes = parseMarkdownNodes(markdown);
    return nodes
        .filter((node) => isLeafNode(node) && !node.cardId)
        .map((node) => ({
            title: node.text,
            cleanTitle: node.cleanText,
            pathText: node.path.join(' / '),
            depth: node.depth,
            cardId: node.cardId,
        }));
}

/** 将一组缺卡节点拼接成适合 AI 管线输入的文本块。 */
export function gapNodesToSourceText(gaps: MindmapGapNode[]): string {
    return gaps
        .map((gap) => {
            const header = `## ${gap.cleanTitle}`;
            const context = gap.pathText !== gap.cleanTitle ? `路径: ${gap.pathText}` : '';
            return [header, context].filter(Boolean).join('\n');
        })
        .join('\n\n');
}

interface MindmapMarkdownNode {
    text: string;
    cleanText: string;
    depth: number;
    cardId: string | null;
    parent?: MindmapMarkdownNode;
    children: MindmapMarkdownNode[];
    path: string[];
    searchable: string;
}

function parseMarkdownNodes(markdown: string): MindmapMarkdownNode[] {
    const nodes: MindmapMarkdownNode[] = [];
    const stack: MindmapMarkdownNode[] = [];
    for (const line of markdown.split(/\r?\n/)) {
        const match = line.match(/^(\s*)-\s+(.+)$/);
        if (!match) continue;
        const depth = Math.floor(match[1].replace(/\t/g, '  ').length / 2) + 1;
        const text = match[2].trim();
        const cardId = extractCardIdFromText(text);
        const cleanText = stripCardIdFromText(text);
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
        const parent = stack[stack.length - 1];
        const path = parent ? [...parent.path, cleanText] : [cleanText];
        const node: MindmapMarkdownNode = {
            text,
            cleanText,
            depth,
            cardId,
            parent,
            children: [],
            path,
            searchable: normalizeSearchText(`${path.join(' / ')} ${cardId || ''}`),
        };
        if (parent) parent.children.push(node);
        stack.push(node);
        nodes.push(node);
    }
    return nodes;
}

function renderMarkdownNodes(nodes: MindmapMarkdownNode[]): string {
    return nodes
        .map((node) => `${'  '.repeat(Math.max(0, node.path.length - 1))}- ${node.text}`)
        .join('\n');
}

function isLeafNode(node: MindmapMarkdownNode): boolean {
    return node.children.length === 0;
}

export function searchMindmapNodes(
    mm: Markmap | null | undefined,
    rawQuery: string,
    activeIndex = 0
): MindmapSearchResult {
    const query = normalizeSearchText(rawQuery);
    const root = mm?.state?.data;
    if (!root || !query) {
        return { query, matches: [], activeIndex: 0, activeMatch: null };
    }

    const matches: MindmapSearchMatch[] = [];
    walkMindmapNodes(root, [], (node, ancestors) => {
        const text = getNodePlainText(node);
        if (!text) return;
        const path = [...ancestors.map(getNodePlainText).filter(Boolean), text];
        const cleanPath = path.map((item) => stripCardIdFromText(item));
        const cardId = extractCardIdFromText(text);
        const searchable = normalizeSearchText(`${cleanPath.join(' / ')} ${cardId || ''}`);
        if (!searchable.includes(query)) return;
        matches.push({
            index: matches.length,
            node,
            text: stripCardIdFromText(text),
            path,
            depth: node.state?.depth ?? ancestors.length,
            cardId,
            ancestors,
        });
    });

    const normalizedActiveIndex = matches.length ? modulo(activeIndex, matches.length) : 0;
    return {
        query,
        matches,
        activeIndex: normalizedActiveIndex,
        activeMatch: matches[normalizedActiveIndex] || null,
    };
}

export async function focusMindmapSearchMatch(mm: Markmap, match: MindmapSearchMatch | null): Promise<void> {
    if (!match) {
        await clearMindmapSearchFocus(mm);
        return;
    }

    for (const ancestor of match.ancestors) {
        if (ancestor.payload?.fold) ancestor.payload.fold = 0;
    }

    await mm.renderData();
    await mm.setHighlight(match.node);
    await mm.ensureVisible(match.node, { left: 96, right: 96, top: 72, bottom: 72 });
}

export async function clearMindmapSearchFocus(mm: Markmap | null | undefined): Promise<void> {
    if (!mm) return;
    await mm.setHighlight(null);
}

export function syncMindmapSearchHighlights(
    svgEl: SVGElement | null | undefined,
    result: MindmapSearchResult
): void {
    if (!svgEl) return;
    const matchIds = new Set(result.matches.map((match) => match.node.state?.id).filter((id) => id !== undefined));
    const activeId = result.activeMatch?.node.state?.id;
    for (const nodeEl of Array.from(svgEl.querySelectorAll('.markmap-node'))) {
        const data = (nodeEl as any).__data__ as INode | undefined;
        const id = data?.state?.id;
        nodeEl.classList.toggle('aio-mindmap-search-match', id !== undefined && matchIds.has(id));
        nodeEl.classList.toggle('aio-mindmap-search-active', id !== undefined && id === activeId);
    }
}

function walkMindmapNodes(
    node: INode,
    ancestors: INode[],
    visit: (node: INode, ancestors: INode[]) => void
): void {
    visit(node, ancestors);
    for (const child of node.children || []) {
        walkMindmapNodes(child, [...ancestors, node], visit);
    }
}

function getNodePlainText(node: INode): string {
    return stripHtml(String(node.content || '')).replace(/\s+/g, ' ').trim();
}

function normalizeSearchText(value: string): string {
    return stripCardIdFromText(String(value || ''))
        .replace(/[/>\\|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function modulo(value: number, length: number): number {
    return ((value % length) + length) % length;
}

export function getMindmapRenderTuning(profile: MindmapSizeProfile): MindmapRenderTuning {
    switch (profile.sizeClass) {
        case 'huge':
            return { animationDuration: 0, clickBindChunkSize: 80, clickBindDelay: 500, fitDelay: 650, chunkedClickBinding: true };
        case 'large':
            return { animationDuration: 0, clickBindChunkSize: 160, clickBindDelay: 300, fitDelay: 450, chunkedClickBinding: true };
        case 'medium':
            return { animationDuration: 180, clickBindChunkSize: 320, clickBindDelay: 220, fitDelay: 350, chunkedClickBinding: true };
        case 'small':
        default:
            return { animationDuration: 300, clickBindChunkSize: 1000, clickBindDelay: 200, fitDelay: 300, chunkedClickBinding: false };
    }
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
    const sizeProfile = options.sizeProfile || profileMindmapMarkdown(markdown);
    const tuning = getMindmapRenderTuning(sizeProfile);

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
        duration: tuning.animationDuration,
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
        setTimeout(() => bindNodeClickHandlers(svgEl, onNodeClick, tuning), tuning.clickBindDelay);
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
    fitMarkmapWithProfile(mm);
}

export function fitMarkmapWithProfile(mm: Markmap, profile?: MindmapSizeProfile): void {
    const tuning = getMindmapRenderTuning(profile || { nodeCount: 0, maxDepth: 0, cardNodeCount: 0, initialExpandLevel: 2, sizeClass: 'small' });
    try {
        setTimeout(() => mm.fit(), tuning.fitDelay);
    } catch {
        // markmap-view 的 fit 可能需要延迟
        setTimeout(() => mm.fit(), tuning.fitDelay + 200);
    }
}

function bindNodeClickHandlers(
    svgEl: SVGElement,
    onNodeClick: (cardId: string, nodeText: string) => void,
    tuning: MindmapRenderTuning
): void {
    const nodes = Array.from(svgEl.querySelectorAll('.markmap-node'));
    let index = 0;

    const bindBatch = () => {
        const end = Math.min(nodes.length, index + tuning.clickBindChunkSize);
        for (; index < end; index++) {
            bindNodeClickHandler(nodes[index], onNodeClick);
        }
        if (index < nodes.length) {
            setTimeout(bindBatch, tuning.chunkedClickBinding ? 16 : 0);
        }
    };

    bindBatch();
}

function bindNodeClickHandler(
    nodeEl: Element,
    onNodeClick: (cardId: string, nodeText: string) => void
): void {
    const firstText = nodeEl.querySelector('foreignObject span, foreignObject div, tspan');
    const rawText = firstText?.textContent?.trim() || '';
    const fullText = stripHtml(nodeEl.innerHTML || '');
    const cardId = extractCardIdFromText(rawText) || extractCardIdFromText(fullText);
    if (!cardId) return;

    (nodeEl as HTMLElement).style.cursor = 'pointer';
    nodeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        onNodeClick(cardId, stripCardIdFromText(rawText || fullText));
    });
}
