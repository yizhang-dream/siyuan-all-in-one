/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * SiYuan HTTP API 封装。全部走 fetchSyncPost（SiYuan 内核 API）。
 * 公式转换逻辑移植自 backup_to_siyuan.py。
 */

import { fetchSyncPost, openTab } from 'siyuan';

/**
 * 安全的 SiYuan API 调用：优先用 fetchSyncPost，如果它被其他插件劫持返回 null/异常，
 * 回退到原生 fetch 直接调内核 API。
 */
async function safeApi(endpoint: string, payload: any): Promise<any> {
    try {
        const resp = await fetchSyncPost(endpoint, payload);
        if (resp != null) return resp;
    } catch (e) {
        console.warn(`[siyuan] fetchSyncPost 失败，回退到 fetch: ${endpoint}`, e);
    }
    // 兜底：原生 fetch
    const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return await r.json();
}

/**
 * 创建文档，返回文档 block id。
 * createDocWithMd 返回的是文档路径，需要再查 SQL 拿到 block id。
 */
export async function createDoc(notebookId: string, title: string): Promise<string> {
    // 确保标题有效，防止创建空标题文档
    const safeTitle = title?.trim() || '知识闪卡';
    // 用 createDocWithMd 创建，path 参数决定文档标题
    const resp = await safeApi('/api/filetree/createDocWithMd', {
        notebook: notebookId,
        path: `/${safeTitle}`,
        markdown: `# ${safeTitle}\n`,
    });

    // 响应中 data 通常是文档路径，如 "/20260618120000-abc123"
    const docPath = resp?.data || resp;

    // 通过路径查 HPath → 拿到 block id
    // createDocWithMd 的 data 是路径字符串
    let docId = '';

    if (typeof docPath === 'string') {
        // 路径格式 /20260618120000-abc123，提取 id 部分
        const match = docPath.match(/(\d{14}-[a-z0-9]+)/i);
        if (match) {
            docId = match[1];
        }
    }

    // 如果没提取到，用 SQL 兜底查最新文档
    if (!docId) {
        const sqlResp = await safeApi('/api/query/sql', {
            stmt: `SELECT id FROM blocks WHERE box='${notebookId}' AND type='d' ORDER BY id DESC LIMIT 1`,
        });
        const rows = sqlResp?.data || [];
        docId = rows[0]?.id || '';
    }

    return docId;
}

/** 获取或创建笔记本，返回 notebook id。 */
export async function ensureNotebook(name: string = '知识闪卡'): Promise<string> {
    const resp = await safeApi('/api/notebook/lsNotebooks', {});
    const notebooks = resp?.data?.notebooks || [];
    const existing = notebooks.find((nb: any) => nb.name === name);
    if (existing) return existing.id;

    const createResp = await safeApi('/api/notebook/createNotebook', { name });
    const nbData = createResp?.data?.notebook || createResp?.data;
    return nbData?.id || '';
}

/**
 * 在文档中插入块（markdown 格式），返回新块 id。
 * parentID 指定父块，previousID 指定前一个兄弟块。
 */
export async function insertBlock(
    parentId: string,
    markdown: string,
    previousId?: string
): Promise<string> {
    const resp = await safeApi('/api/block/insertBlock', {
        dataType: 'markdown',
        data: markdown,
        previousID: previousId || '',
        parentID: previousId ? '' : parentId,
    });

    // insertBlock 返回 { code: 0, data: { operations: [{ id: "xxx" }] } }
    // 或某些版本直接返回 operations 数组
    const ops = resp?.data?.operations || resp?.data?.[0]?.doOperations || [];
    return ops[0]?.id || '';
}

/**
 * 获取文档最后一个子块 id（用于链式追加）。
 */
export async function getLastBlockId(docId: string): Promise<string> {
    const resp = await safeApi('/api/query/sql', {
        stmt: `SELECT id FROM blocks WHERE root_id='${docId}' AND type!='d' ORDER BY sort ASC, id DESC LIMIT 1`,
    });
    const rows = resp?.data || [];
    return rows[0]?.id || docId;
}

/**
 * 写入 SiYuan 思维导图代码块到指定文档，并自动设置合适的块高度。
 * SiYuan 默认代码块高度固定，大思维导图会被截断，需设置块属性调整高度。
 */
export async function writeMindmapBlock(
    docId: string,
    title: string,
    mindmapMarkdown: string
): Promise<void> {
    const codeBlock = '```mindmap\n' + mindmapMarkdown + '\n```';

    // 1. 插入代码块，获取块 ID
    const resp = await safeApi('/api/block/insertBlock', {
        dataType: 'markdown',
        data: codeBlock,
        parentID: docId,
    });
    const ops = resp?.data?.operations || resp?.data?.[0]?.doOperations || [];
    const blockId = ops[0]?.id || '';

    // 2. 根据内容估算合适的画布高度
    if (blockId) {
        const numLines = mindmapMarkdown.split('\n').length;
        // 思维导图树形布局：每个节点约 55px 垂直空间 + 顶部留白
        // 树形展开需要比纯列表更多的空间
        const estimatedHeight = Math.max(400, Math.min(3000, numLines * 55 + 100));
        // SiYuan 块通过 style 属性控制高度（与用户拖拽调整大小相同机制）
        await safeApi('/api/attr/setBlockAttrs', {
            id: blockId,
            attrs: {
                style: `height: ${estimatedHeight}px; overflow-y: auto;`,
            },
        });
    }
}

/**
 * 写入多个思维导图块到指定文档（总览 + 每主题一个小图）。
 * 每个段前面加一个标题块（## heading），后面跟 mindmap 代码块。
 */
export async function writeMindmapSections(
    docId: string,
    sections: Array<{ heading: string; mindmapMd: string }>
): Promise<void> {
    for (const section of sections) {
        // 写标题块
        await safeApi('/api/block/insertBlock', {
            dataType: 'markdown',
            data: `## ${section.heading}`,
            parentID: docId,
        });
        // 写思维导图代码块（复用高度估算逻辑）
        await writeMindmapBlock(docId, section.heading, section.mindmapMd);
    }
}

/**
 * 在思维导图文档中追加卡片索引列表块。
 * 包含每张卡片的复习状态 emoji + 卡片 id + 问题文本，实现与闪卡的联动。
 */
export async function writeCardIndex(
    docId: string,
    indexMarkdown: string
): Promise<void> {
    await safeApi('/api/block/insertBlock', {
        dataType: 'markdown',
        data: indexMarkdown,
        parentID: docId,
    });
}

/**
 * 在 SiYuan 标签页中打开指定文档。
 */
export function openDoc(docId: string, app: any): void {
    if (!app) { console.error('[siyuan] openDoc: app 实例未传入'); return; }
    openTab({ app, doc: { id: docId } });
}

/**
 * 保存文本内容到思源文档。
 * 在「知识闪卡」笔记本下创建文档，标题取内容前 50 字。
 * @returns 文档 block id
 */
export async function saveToSiyuan(content: string, title?: string): Promise<string> {
    if (!content.trim()) return '';

    const docTitle = title || stripMath(content).replace(/[#*`\n\r\$\$]/g, '').slice(0, 50).trim() || '知识闪卡';
    const notebookId = await ensureNotebook('知识闪卡');
    const docId = await createDoc(notebookId, docTitle);

    if (docId) {
        // 插入正文内容
        await insertBlock(docId, content);
    }

    return docId;
}

// ─── 公式转换（移植自 backup_to_siyuan.py） ──────────────

/**
 * 将 Anki 风格定界符转换为 SiYuan 风格。
 * \[...\] → 独占行的 $$...$$
 * \(...\) → $...$
 */
export function toSiyuanMath(text: string): string {
    if (!text) return '';
    let result = text;

    // \[...\] → 独占行的 $$...$$
    result = result.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => {
        return '\n$$' + inner.trim() + '$$\n';
    });

    // \(...\) → $...$
    result = result.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => '$' + inner.trim() + '$');

    // 清理多余空行
    result = result.replace(/\n{3,}/g, '\n\n').trim();

    return result;
}

/**
 * 剥离所有数学定界符，返回纯文本（用于思维导图窄节点）。
 * 移植自 flashcard_mindmap.py 的 anki_to_plaintext。
 */
export function stripMath(text: string): string {
    if (!text) return '';
    return text
        .replace(/\$\$[\s\S]*?\$\$/g, '[公式]')
        .replace(/\$[^$\n]+\$/g, '[公式]')
        .replace(/\\\[([\s\S]*?)\\\]/g, '[公式]')
        .replace(/\\\(([\s\S]*?)\\\)/g, '[公式]')
        .trim();
}
