/*
 * Copyright (c) 2026 siyuan-all-in-one
 * MIT License
 *
 * Open Notebook 完整 API 客户端。
 * 端口 5055，77 个端点全部在 /api 下。
 */

// ─── 类型定义 ─────────────────────────────────────────────

export interface Notebook {
    id: string;
    name: string;
    description: string;
    archived: boolean;
    source_count: number;
    note_count: number;
    created: string;
    updated: string;
}

export interface Source {
    id: string;
    title: string;
    topics: string[];
    embedded: boolean;
    embedded_chunks: number;
    insights_count: number;
    file_available: boolean;
    status: string;
    created: string;
    updated: string;
}

export interface SourceDetail extends Source {
    full_text?: string;
    notebooks?: string[];
}

export interface SearchResult {
    id: string;
    title: string;
    content: string;
    relevance?: number;
    score?: number;
    parentId?: string;
    sourceId?: string;
    chunkId?: string;
    url?: string;
    page?: number;
    metadata?: Record<string, any>;
    [key: string]: any;
}

export type ModelType = 'language' | 'embedding' | 'text_to_speech' | 'speech_to_text';

export interface ONModel {
    id: string;
    name: string;
    provider: string;
    type: ModelType;
}

/**
 * Open Notebook 默认模型角色（7 个槽位）。
 * 注意 large_context_model 无 default_ 前缀（历史命名）。
 * transformation/tools 未设置时回退到 default_chat_model。
 */
export interface DefaultModels {
    default_chat_model?: string;
    default_transformation_model?: string;
    large_context_model?: string;
    default_tools_model?: string;
    default_embedding_model?: string;
    default_text_to_speech_model?: string;
    default_speech_to_text_model?: string;
    [key: string]: string | undefined;
}

/** 模型角色的中文描述（供 UI 展示） */
export const MODEL_ROLES: Array<{ key: keyof DefaultModels; label: string; hint: string; type: ModelType }> = [
    { key: 'default_chat_model', label: '对话', hint: '聊天对话', type: 'language' },
    { key: 'default_transformation_model', label: '转换', hint: '摘要/洞察/文本转换（回退到对话）', type: 'language' },
    { key: 'default_tools_model', label: '工具', hint: '函数调用（回退到对话）', type: 'language' },
    { key: 'large_context_model', label: '长上下文', hint: '处理大文档（推荐 Gemini）', type: 'language' },
    { key: 'default_embedding_model', label: '嵌入', hint: '语义搜索和向量嵌入', type: 'embedding' },
    { key: 'default_text_to_speech_model', label: '语音合成', hint: '播客生成', type: 'text_to_speech' },
    { key: 'default_speech_to_text_model', label: '语音识别', hint: '音频转录', type: 'speech_to_text' },
];

export class NotebookError extends Error {
    status: number;
    constructor(message: string, status = 0) {
        super(message);
        this.name = 'NotebookError';
        this.status = status;
    }
}

// ─── 客户端 ───────────────────────────────────────────────

export class OpenNotebookClient {
    private baseUrl: string;
    private timeout: number;

    constructor(baseUrl: string = 'http://localhost:5055', timeout = 30_000) {
        // 允许用户填写根地址或复制带 /api 的地址。
        this.baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/api$/i, '');
        this.timeout = timeout;
    }

    public async request(method: string, path: string, body?: any): Promise<any> {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        const url = `${this.baseUrl}/api${normalizedPath}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!resp.ok) {
                const errBody = await resp.text().catch(() => '');
                throw new NotebookError(
                    `Open Notebook API ${resp.status}: ${errBody.slice(0, 200)}`,
                    resp.status
                );
            }

            const text = await resp.text();
            if (!text.trim()) return {};
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        } catch (err: any) {
            if (err instanceof NotebookError) throw err;
            if (err.name === 'AbortError') throw new NotebookError('请求超时', 0);
            throw new NotebookError(`请求失败: ${err.message}`, 0);
        }
    }

    // ── 笔记本 ──────────────────────────────────────────

    async listNotebooks(): Promise<Notebook[]> {
        const data = await this.request('GET', '/notebooks');
        return unwrapOpenNotebookArray(data) as Notebook[];
    }

    async getNotebook(id: string): Promise<Notebook> {
        return await this.request('GET', `/notebooks/${id}`);
    }

    // ── 来源 ────────────────────────────────────────────

    async listSources(notebookId?: string, limit = 100): Promise<Source[]> {
        const safeLimit = clampInteger(limit, 1, 100);
        const basePath = `/sources?limit=${safeLimit}`;
        if (!notebookId) {
            const data = await this.request('GET', basePath);
            return unwrapOpenNotebookArray(data) as Source[];
        }

        const encoded = encodeURIComponent(notebookId);
        const fallbackNotebookId = notebookId.startsWith('notebook:')
            ? notebookId.slice('notebook:'.length)
            : '';
        const candidatePaths = [
            `${basePath}&notebook_id=${encoded}`,
            fallbackNotebookId ? `${basePath}&notebook_id=${encodeURIComponent(fallbackNotebookId)}` : '',
            `${basePath}&notebook=${encoded}`,
            `${basePath}&notebookId=${encoded}`,
        ].filter(Boolean);

        const failures: string[] = [];
        for (const path of candidatePaths) {
            try {
                const data = await this.request('GET', path);
                return unwrapOpenNotebookArray(data) as Source[];
            } catch (err: any) {
                if (!isRetryableCompatibilityError(err)) throw err;
                failures.push(err.message || String(err));
            }
        }

        try {
            const data = await this.request('GET', basePath);
            const allSources = unwrapOpenNotebookArray(data) as Source[];
            const filtered = filterSourcesByNotebook(allSources, notebookId);
            return filtered.length > 0 ? filtered : allSources;
        } catch (err: any) {
            if (failures.length > 0) {
                throw new NotebookError(
                    `Open Notebook 来源列表请求失败: ${failures[0]}`,
                    err?.status || 0
                );
            }
            throw err;
        }
    }

    async getSource(id: string): Promise<SourceDetail> {
        return await this.request('GET', `/sources/${id}`);
    }

    // ── 搜索 ────────────────────────────────────────────

    async search(
        query: string,
        opts?: {
            type?: 'text' | 'vector';
            limit?: number;
            searchSources?: boolean;
            searchNotes?: boolean;
            minimumScore?: number;
        }
    ): Promise<SearchResult[]> {
        const requestedType = opts?.type || 'text';
        const limit = clampInteger(opts?.limit || 20, 1, 1000);
        const minimumScore = clampNumber(opts?.minimumScore ?? 0.2, 0, 1);
        const baseBody = {
            query,
            limit,
            search_sources: opts?.searchSources ?? true,
            search_notes: opts?.searchNotes ?? true,
        };
        const candidateBodies = buildSearchRequestBodies(baseBody, requestedType, minimumScore);
        const failures: string[] = [];
        let data: any = null;

        for (const body of candidateBodies) {
            try {
                data = await this.request('POST', '/search', body);
                break;
            } catch (err: any) {
                if (!isRetryableCompatibilityError(err)) throw err;
                failures.push(err.message || String(err));
            }
        }

        if (data === null) {
            throw new NotebookError(
                `Open Notebook 搜索失败: ${failures[0] || '所有兼容请求均失败'}`,
                0
            );
        }

        const results = normalizeOpenNotebookSearchResults(data);

        // text 搜索不返回 content，需要补全
        if (requestedType === 'text' || data?.search_type === 'text') {
            // 对每个命中结果，尝试获取来源全文（限制数量避免过多请求）
            const top = results.slice(0, 5);
            await Promise.all(
                top.map(async (r: SearchResult) => {
                    if (!r.content && (r.parentId || r.sourceId)) {
                        try {
                            const detail = await this.getSource(String(r.parentId || r.sourceId));
                            r.content = detail.full_text?.slice(0, 2000) || '';
                        } catch {}
                    }
                })
            );
        }

        return results;
    }

    /**
     * 在指定来源范围内搜索。
     * Open Notebook 搜索不支持来源过滤，所以先全库搜再客户端筛选。
     */
    async searchInSources(
        query: string,
        sourceIds: string[],
        opts?: { type?: 'text' | 'vector'; limit?: number }
    ): Promise<SearchResult[]> {
        const all = await this.search(query, { ...opts, limit: (opts?.limit || 20) * 3 });
        // 按 parent/source/chunk id 过滤，兼容不同 OpenNotebook 版本的字段名。
        const idSet = new Set(sourceIds);
        return all.filter((r) =>
            [r.parentId, r.sourceId, r.id].filter(Boolean).some((id) => idSet.has(String(id)))
        );
    }

    // ── 问答 ────────────────────────────────────────────

    async getDefaultModels(): Promise<DefaultModels> {
        return await this.request('GET', '/models/defaults');
    }

    /** 更新默认模型角色分配（PUT /models/defaults） */
    async updateDefaultModels(defaults: DefaultModels): Promise<DefaultModels> {
        return await this.request('PUT', '/models/defaults', defaults);
    }

    /** 自动分配空缺的默认模型槽位（POST /models/auto-assign） */
    async autoAssignModels(): Promise<{ assigned: Record<string, string>; skipped: string[]; missing: string[] }> {
        return await this.request('POST', '/models/auto-assign', {});
    }

    async ask(
        question: string,
        models?: { strategy?: string; answer?: string; finalAnswer?: string }
    ): Promise<string> {
        // 自动取默认模型
        let m = models;
        if (!m?.strategy || !m?.answer || !m?.finalAnswer) {
            const defaults = await this.getDefaultModels();
            const chatModel = defaults.default_chat_model;
            m = {
                strategy: m?.strategy || chatModel,
                answer: m?.answer || chatModel,
                finalAnswer: m?.finalAnswer || chatModel,
            };
        }

        const data = await this.request('POST', '/search/ask/simple', {
            question,
            strategy_model: m.strategy,
            answer_model: m.answer,
            final_answer_model: m.finalAnswer,
        });
        return data?.answer || '';
    }

    // ── 笔记本聊天（完全对标 Open Notebook Chat API） ─────

    /**
     * 构建聊天上下文。POST /chat/context
     */
    async buildContext(
        notebookId: string,
        sourceIds: string[],
        options: {
            sourceModes?: Record<string, string>;
            noteIds?: string[];
            noteModes?: Record<string, string>;
        } = {}
    ): Promise<{ context: any; tokenCount: number; charCount: number }> {
        const contextConfig: Record<string, Record<string, string>> = {
            sources: {},
            notes: {},
        };
        for (const sid of sourceIds) {
            contextConfig.sources[sid] = contextModeValue(options.sourceModes?.[sid] || 'full');
        }
        for (const noteId of options.noteIds || []) {
            contextConfig.notes[noteId] = contextModeValue(options.noteModes?.[noteId] || 'full');
        }
        const data = await this.request('POST', '/chat/context', {
            notebook_id: notebookId,
            context_config: contextConfig,
        });
        return {
            context: data?.context || {},
            tokenCount: data?.token_count || 0,
            charCount: data?.char_count || 0,
        };
    }

    /** 列出会话。GET /chat/sessions?notebook_id= */
    async listSessions(notebookId: string): Promise<any[]> {
        const data = await this.request('GET', `/chat/sessions?notebook_id=${encodeURIComponent(notebookId)}`);
        return unwrapOpenNotebookArray(data);
    }

    /** 创建会话。POST /chat/sessions */
    async createSession(
        notebookId: string,
        title?: string,
        modelOverride?: string
    ): Promise<any> {
        return await this.request('POST', '/chat/sessions', {
            notebook_id: notebookId,
            title: title || undefined,
            model_override: modelOverride || undefined,
        });
    }

    /** 删除会话。DELETE /chat/sessions/{id} */
    async deleteSession(sessionId: string): Promise<void> {
        await this.request('DELETE', `/chat/sessions/${sessionId}`);
    }

    /** 获取会话详情（含消息）。GET /chat/sessions/{id} */
    async getSession(sessionId: string): Promise<any> {
        return await this.request('GET', `/chat/sessions/${sessionId}`);
    }

    /** 列出笔记。GET /notes?notebook_id= */
    async listNotes(notebookId: string): Promise<any[]> {
        const data = await this.request('GET', `/notes?notebook_id=${encodeURIComponent(notebookId)}`);
        return unwrapOpenNotebookArray(data);
    }

    /** 获取笔记详情。不同 OpenNotebook 版本字段不完全一致，由调用方做归一化。 */
    async getNote(noteId: string): Promise<any> {
        return await this.request('GET', `/notes/${encodeURIComponent(noteId)}`);
    }

    /** 发送消息。POST /chat/execute */
    async sendMessage(
        sessionId: string,
        message: string,
        context: any,
        modelOverride?: string
    ): Promise<{ sessionId: string; messages: Array<{ id: string; type: string; content: string; timestamp?: string }> }> {
        const body: any = {
            session_id: sessionId,
            message,
            context,
        };
        if (modelOverride) body.model_override = modelOverride;
        const data = await this.request('POST', '/chat/execute', body);
        return {
            sessionId: data?.session_id || sessionId,
            messages: data?.messages || [],
        };
    }

    // ── 模型 ────────────────────────────────────────────

    async getModels(type?: string): Promise<ONModel[]> {
        let path = '/models';
        if (type) path += `?type=${encodeURIComponent(type)}`;
        const data = await this.request('GET', path);
        return unwrapOpenNotebookArray(data) as ONModel[];
    }
}

function buildSearchRequestBodies(
    baseBody: Record<string, any>,
    requestedType: 'text' | 'vector',
    minimumScore: number
): Array<Record<string, any>> {
    const textBody = { ...baseBody, type: 'text' };
    const minimalTextBody = {
        query: baseBody.query,
        type: 'text',
        limit: baseBody.limit,
    };
    if (requestedType === 'vector') {
        return [
            { ...baseBody, type: 'vector', minimum_score: minimumScore },
            textBody,
            minimalTextBody,
        ];
    }
    return [
        textBody,
        minimalTextBody,
    ];
}

function filterSourcesByNotebook(sources: Source[], notebookId: string): Source[] {
    const targetIds = new Set([
        notebookId,
        notebookId.startsWith('notebook:') ? notebookId.slice('notebook:'.length) : `notebook:${notebookId}`,
    ]);
    return sources.filter((source: any) => {
        const candidates = [
            source.notebook_id,
            source.notebookId,
            source.notebook,
            source.metadata?.notebook_id,
            source.metadata?.notebookId,
        ];
        if (Array.isArray(source.notebooks)) candidates.push(...source.notebooks);
        if (Array.isArray(source.notebook_ids)) candidates.push(...source.notebook_ids);
        if (Array.isArray(source.notebookIds)) candidates.push(...source.notebookIds);
        return candidates
            .filter((value) => value !== undefined && value !== null)
            .some((value) => targetIds.has(String(value)));
    });
}

function isRetryableCompatibilityError(err: any): boolean {
    return err instanceof NotebookError && [400, 404, 422, 500].includes(err.status);
}

function clampInteger(value: number, min: number, max: number): number {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function clampNumber(value: number, min: number, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function contextModeValue(mode: string): string {
    if (mode === 'insights') return 'insights';
    return 'full content';
}

function unwrapOpenNotebookArray(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['items', 'results', 'data', 'records', 'notebooks', 'sources', 'models', 'notes', 'sessions']) {
        const value = data[key];
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
            const nested = unwrapOpenNotebookArray(value);
            if (nested.length > 0) return nested;
        }
    }
    return [];
}

export function normalizeOpenNotebookSearchResults(data: any): SearchResult[] {
    return unwrapSearchResultArray(data)
        .map(normalizeOpenNotebookSearchResult)
        .filter((result) => result.id || result.content || result.title !== 'Untitled');
}

function normalizeOpenNotebookSearchResult(r: any): SearchResult {
    const metadata = objectValue(r?.metadata) || objectValue(r?.meta) || {};
    const source = objectValue(r?.source) || {};
    const document = objectValue(r?.document) || objectValue(r?.doc) || {};
    const chunk = objectValue(r?.chunk) || {};
    const id = stringValue(
        r?.id || r?.chunk_id || r?.chunkId || r?.node_id || r?.nodeId ||
        chunk.id || metadata.chunk_id || metadata.chunkId || metadata.id
    );
    const parentId = stringValue(
        r?.parent_id || r?.parentId || r?.source_id || r?.sourceId ||
        source.id || document.source_id || metadata.parent_id || metadata.parentId ||
        metadata.source_id || metadata.sourceId
    ) || undefined;
    const sourceId = stringValue(
        r?.source_id || r?.sourceId || source.id || parentId ||
        metadata.source_id || metadata.sourceId || metadata.parent_id
    ) || undefined;
    const chunkId = stringValue(
        r?.chunk_id || r?.chunkId || chunk.id || id || metadata.chunk_id || metadata.chunkId
    ) || undefined;
    const title = stringValue(
        r?.title || r?.source_title || r?.sourceTitle || r?.document_title || r?.documentTitle ||
        source.title || source.name || document.title || metadata.title || metadata.source_title
    ) || 'Untitled';
    const content = stringValue(
        r?.content || r?.text || r?.chunk_text || r?.chunkText || r?.snippet || r?.summary ||
        r?.excerpt || r?.page_content || r?.pageContent || chunk.text || chunk.content ||
        document.content || metadata.content || metadata.text || metadata.chunk_text ||
        metadata.page_content
    );
    return {
        ...r,
        id,
        title,
        content,
        relevance: optionalNumber(r?.relevance ?? r?.similarity ?? metadata.relevance),
        score: optionalNumber(r?.score ?? r?.distance_score ?? r?.similarity_score ?? metadata.score),
        parentId,
        sourceId,
        chunkId,
        url: stringValue(r?.url || source.url || document.url || metadata.url) || undefined,
        page: optionalNumber(r?.page ?? r?.page_number ?? r?.pageNumber ?? metadata.page ?? metadata.page_number),
        metadata,
    };
}

function unwrapSearchResultArray(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['results', 'data', 'items', 'matches', 'documents', 'chunks', 'records']) {
        const value = data[key];
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
            const nested = unwrapSearchResultArray(value);
            if (nested.length > 0) return nested;
        }
    }
    return [];
}

function objectValue(value: any): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function optionalNumber(value: any): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function stringValue(value: any): string {
    if (value === undefined || value === null) return '';
    return String(value);
}
