/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Agent tool definitions and executors.
 */

import { ragQuery, formatRagContext } from './rag/query';
import type { VectorStore } from './rag/vector-store';
import type { EmbeddingProvider } from './rag/embedder-types';

// ── Types ─────────────────────────────────────────────────

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        displayName?: string;
        description: string;
        parameters: object;  // JSON Schema
    };
    autoApprove?: boolean;  // if true, execute without asking
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export interface ToolCallResult {
    tool_call_id: string;
    content: string;  // JSON string of the result
}

/**
 * Per-tool configuration for persistence.
 */
export interface ToolConfig {
    enabled: boolean;
    autoApprove: boolean;
}

/**
 * Persisted agent tool selection config.
 */
export interface AgentToolsConfig {
    selectedTools: Record<string, ToolConfig>;     // agent mode
    selectedToolsAsk: Record<string, ToolConfig>;  // ask mode
}

/**
 * Tool categories used by the tool selection dialog.
 */
export const TOOL_CATEGORIES: Record<string, { label: string; tools: string[] }> = {
    rag: { label: '知识检索', tools: ['rag_search'] },
    siyuan: { label: '思源笔记', tools: ['sql_query', 'get_block_content'] },
    utility: { label: '其他工具', tools: ['create_note'] },
};

// ── Executor context ──────────────────────────────────────

export interface ToolContext {
    plugin: any;
    vectorStore?: VectorStore;
    embedder?: EmbeddingProvider;
}

// ── All tool definitions (master list) ────────────────────

const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'rag_search',
            displayName: '知识检索搜索',
            description: '在已导入文档的知识库中搜索相关内容',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'The search query to find relevant information in the knowledge base',
                    },
                    topK: {
                        type: 'number',
                        description: 'Number of results to return (default 5)',
                    },
                },
                required: ['query'],
            },
        },
        autoApprove: true,
    },
    {
        type: 'function',
        function: {
            name: 'sql_query',
            displayName: 'SQL查询',
            description: '对思源笔记数据库执行 SQL 查询，用于查找块、文档或元数据',
            parameters: {
                type: 'object',
                properties: {
                    stmt: {
                        type: 'string',
                        description: 'SQL statement to execute against the SiYuan database',
                    },
                },
                required: ['stmt'],
            },
        },
        autoApprove: true,
    },
    {
        type: 'function',
        function: {
            name: 'get_block_content',
            displayName: '获取块内容',
            description: '通过块 ID 获取思源笔记块的 Markdown 内容',
            parameters: {
                type: 'object',
                properties: {
                    blockId: {
                        type: 'string',
                        description: 'The block ID to retrieve content for',
                    },
                },
                required: ['blockId'],
            },
        },
        autoApprove: true,
    },
    {
        type: 'function',
        function: {
            name: 'create_note',
            displayName: '新建笔记',
            description: '在思源笔记本中创建新笔记，返回新文档 ID',
            parameters: {
                type: 'object',
                properties: {
                    notebookId: {
                        type: 'string',
                        description: 'The notebook ID where the note will be created',
                    },
                    title: {
                        type: 'string',
                        description: 'The title of the new note',
                    },
                    content: {
                        type: 'string',
                        description: 'The Markdown content of the new note',
                    },
                },
                required: ['notebookId', 'title', 'content'],
            },
        },
        autoApprove: true,
    },
];

/**
 * Return all tool definitions (unfiltered).
 */
export function getAllTools(): ToolDefinition[] {
    return ALL_TOOL_DEFINITIONS;
}

/**
 * Return tool definitions filtered by the given selection config.
 * If no config is provided, returns all tools (backward compatible).
 * The autoApprove flag is overridden by the config if present.
 */
export function getEnabledTools(selectedTools?: Record<string, ToolConfig>): ToolDefinition[] {
    if (!selectedTools) return ALL_TOOL_DEFINITIONS;
    return ALL_TOOL_DEFINITIONS.filter(t => {
        const cfg = selectedTools[t.function.name];
        return cfg === undefined || cfg.enabled;
    }).map(t => {
        const cfg = selectedTools[t.function.name];
        if (cfg && cfg.autoApprove !== undefined) {
            return { ...t, autoApprove: cfg.autoApprove };
        }
        return t;
    });
}

// ── Tool executors ────────────────────────────────────────

export type ToolExecutor = (call: ToolCall, ctx: ToolContext) => Promise<string>;

export async function executeTool(
    call: ToolCall,
    ctx: ToolContext
): Promise<string> {
    const name = call.function.name;
    let args: any;
    try {
        args = JSON.parse(call.function.arguments);
    } catch {
        return JSON.stringify({ error: `Failed to parse arguments for tool "${name}": ${call.function.arguments}` });
    }

    switch (name) {
        case 'rag_search':
            return executeRagSearch(args, ctx);
        case 'sql_query':
            return executeSqlQuery(args, ctx);
        case 'get_block_content':
            return executeGetBlockContent(args, ctx);
        case 'create_note':
            return executeCreateNote(args, ctx);
        default:
            return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
}

async function executeRagSearch(
    args: { query: string; topK?: number },
    ctx: ToolContext
): Promise<string> {
    const { query, topK = 5 } = args;
    if (!ctx.vectorStore || !ctx.embedder) {
        return JSON.stringify({ error: 'RAG vector store or embedder not available' });
    }
    try {
        const results = await ragQuery(query, ctx.vectorStore, ctx.embedder, { topK });
        const context = formatRagContext(results);
        return JSON.stringify({
            success: true,
            resultCount: results.length,
            context,
            results: results.map(r => ({
                score: r.score,
                text: r.chunk.text.substring(0, 500),
                source: r.chunk.metadata.fileName || r.chunk.metadata.title || r.chunk.sourceId,
            })),
        });
    } catch (e: any) {
        return JSON.stringify({ error: `rag_search failed: ${e.message}` });
    }
}

async function executeSqlQuery(
    args: { stmt: string },
    ctx: ToolContext
): Promise<string> {
    const { stmt } = args;
    try {
        const resp = await fetch(`${getApiBase(ctx.plugin)}/api/query/sql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stmt }),
        });
        const json = await resp.json();
        if (json.code === 0) {
            return JSON.stringify({ success: true, data: json.data });
        }
        return JSON.stringify({ error: `SQL query failed: ${json.msg || JSON.stringify(json)}` });
    } catch (e: any) {
        return JSON.stringify({ error: `sql_query failed: ${e.message}` });
    }
}

async function executeGetBlockContent(
    args: { blockId: string },
    ctx: ToolContext
): Promise<string> {
    const { blockId } = args;
    try {
        const resp = await fetch(`${getApiBase(ctx.plugin)}/api/block/getBlockKramdown`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: blockId }),
        });
        const json = await resp.json();
        if (json.code === 0) {
            return JSON.stringify({
                success: true,
                blockId,
                markdown: json.data?.kramdown || json.data?.content || '',
            });
        }
        return JSON.stringify({ error: `getBlockKramdown failed: ${json.msg || JSON.stringify(json)}` });
    } catch (e: any) {
        return JSON.stringify({ error: `get_block_content failed: ${e.message}` });
    }
}

async function executeCreateNote(
    args: { notebookId: string; title: string; content: string },
    ctx: ToolContext
): Promise<string> {
    const { notebookId, title, content } = args;
    try {
        const resp = await fetch(`${getApiBase(ctx.plugin)}/api/filetree/createDocWithMd`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                notebook: notebookId,
                path: `/${title}`,
                markdown: content,
            }),
        });
        const json = await resp.json();
        if (json.code === 0) {
            // Extract doc ID from the returned path
            const docPath = json.data || '';
            let docId = '';
            const match = String(docPath).match(/(\d{14}-[a-z0-9]+)/i);
            if (match) {
                docId = match[1];
            }
            return JSON.stringify({ success: true, docId, path: docPath });
        }
        return JSON.stringify({ error: `createDocWithMd failed: ${json.msg || JSON.stringify(json)}` });
    } catch (e: any) {
        return JSON.stringify({ error: `create_note failed: ${e.message}` });
    }
}

function getApiBase(plugin: any): string {
    try {
        return plugin?.app?.kernel?.origin || 'http://127.0.0.1:6806';
    } catch {
        return 'http://127.0.0.1:6806';
    }
}
