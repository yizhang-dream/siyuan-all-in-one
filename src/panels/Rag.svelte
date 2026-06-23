<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { showMessage } from 'siyuan';
  import { VectorStore, getRagEmbedder, ingestFile, ragQuery, ragContext, formatRagContext, buildRagConceptRequest } from '../libs/rag';
  import type { RagChunkMetadata, RagSearchResult, IngestedDocRecord } from '../libs/rag';
  import type { RagConceptRequest } from '../libs/rag';
  import { callLLM } from '../libs/llm';
  import type { LLMConfig } from '../libs/llm';
  import { renderMath } from '../libs/render';
  import { fetchWebPage } from '../libs/sources/web-fetcher';
  import { getT } from '../libs/i18n';

  export let plugin: any;
  export let vectorStore: any;
  export let config: any;
  export let sourceTarget: Partial<{ type: string; sourceId?: string; chunkId?: string; quote?: string }> | null = null;
  export let openConceptsFromRag: (request: RagConceptRequest) => void = () => {};

  const t = getT(plugin);

  let store: VectorStore;
  let embedder = getRagEmbedder();
  let embedderReady = false;
  let embedderError = '';

  // Document list
  let documents: IngestedDocRecord[] = [];
  let uploading = false;

  // Chat state
  interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: RagSearchResult[];
  }
  let messages: ChatMessage[] = [];
  let inputText = '';
  let sending = false;

  // Text paste modal
  let showPasteModal = false;
  let pasteText = '';
  let pasteTitle = '';

  // URL fetch
  let urlInput = '';
  let urlFetching = false;

  onMount(async () => {
    store = vectorStore || new VectorStore(plugin);
    if (!vectorStore) await store.load();

    // Check embedder
    embedderReady = embedder.isReady();
    embedderError = embedder.getError();

    // Load document list from store
    refreshDocs();

    // Pre-fill from sourceTarget
    if (sourceTarget?.quote) {
      inputText = sourceTarget.quote;
    }
  });

  function refreshDocs() {
    const seen = new Map<string, IngestedDocRecord>();
    for (const entry of store.getAll()) {
      if (!seen.has(entry.sourceId)) {
        seen.set(entry.sourceId, {
          sourceId: entry.sourceId,
          fileName: entry.metadata.fileName || entry.metadata.title,
          ingestedAt: 0,
          chunkCount: 0,
        });
      }
      const doc = seen.get(entry.sourceId)!;
      doc.chunkCount++;
    }
    documents = [...seen.values()];
  }

  async function initEmbedder() {
    try {
      embedderError = '';
      await embedder.initialize();
      embedderReady = embedder.isReady();
      embedderError = embedder.getError();
      if (embedderReady) showMessage('嵌入模型已就绪');
    } catch (e: any) {
      embedderError = e?.message || String(e);
    }
  }

  // ── File upload ─────────────────────────────────────────

  async function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;
    uploading = true;

    try {
      if (!embedderReady) await initEmbedder();
      for (const file of Array.from(files)) {
        await ingestFile(file, store, embedder, {
          chunkSize: config?.ragChunkSize || 500,
          chunkOverlap: config?.ragChunkOverlap ?? 0.1,
        });
      }
      refreshDocs();
      showMessage(`已索引 ${files.length} 个文件`);
    } catch (e: any) {
      showMessage(`文件索引失败：${e?.message || e}`);
    }

    uploading = false;
    target.value = '';
  }

  // ── Text paste ──────────────────────────────────────────

  function openPasteModal() {
    pasteText = '';
    pasteTitle = '';
    showPasteModal = true;
  }

  async function confirmPaste() {
    if (!pasteText.trim()) return;
    uploading = true;
    showPasteModal = false;

    try {
      if (!embedderReady) await initEmbedder();
      const { ingestDocument } = await import('../libs/rag');
      await ingestDocument(pasteText, {
        title: pasteTitle || '粘贴文本',
        mimeType: 'text/plain',
      }, store, embedder, {
        chunkSize: config?.ragChunkSize || 500,
        chunkOverlap: config?.ragChunkOverlap ?? 0.1,
      });
      refreshDocs();
      showMessage('文本已索引');
    } catch (e: any) {
      showMessage(`文本索引失败：${e?.message || e}`);
    }

    uploading = false;
  }

  // ── URL fetch ───────────────────────────────────────────

  async function fetchUrl() {
    const url = urlInput.trim();
    if (!url) return;
    urlFetching = true;

    try {
      const result = await fetchWebPage(url);
      if (!result.text) {
        showMessage('未能获取网页内容');
        urlFetching = false;
        return;
      }
      if (!embedderReady) await initEmbedder();
      const { ingestDocument } = await import('../libs/rag');
      const metadata: RagChunkMetadata = {
        url,
        title: result.title || url,
        mimeType: 'text/html',
      };
      await ingestDocument(result.text, metadata, store, embedder, {
        chunkSize: config?.ragChunkSize || 500,
        chunkOverlap: config?.ragChunkOverlap ?? 0.1,
      });
      refreshDocs();
      showMessage('网页已索引');
    } catch (e: any) {
      showMessage(`网页索引失败：${e?.message || e}`);
    }

    urlInput = '';
    urlFetching = false;
  }

  // ── Chat ────────────────────────────────────────────────

  async function send() {
    const text = inputText.trim();
    if (!text || sending) return;
    if (store.getCount() === 0) {
      showMessage('请先上传文档或粘贴文本');
      return;
    }

    const userMsg: ChatMessage = { id: 'u' + Date.now(), role: 'user', content: text };
    messages = [...messages, userMsg];
    inputText = '';
    sending = true;

    try {
      if (!embedderReady) await initEmbedder();

      // RAG retrieval
      const results = await ragQuery(text, store, embedder, { topK: config?.ragTopK || 5 });
      const ctx = formatRagContext(results);

      // LLM call
      const cfg = plugin.getConfig();
      const providerId = cfg.ragProviderId || cfg.flashcardProviderId;
      const model = cfg.ragModel || cfg.flashcardModel;

      if (!providerId) {
        showMessage('请先在设置中配置 AI Provider');
        sending = false;
        return;
      }
      if (!model) {
        showMessage('请先在设置中为 RAG 对话选择模型');
        sending = false;
        return;
      }

      const llmConfig: LLMConfig = {
        providerId,
        model,
        providers: cfg.providers || [],
      };

      const systemPrompt = ctx
        ? `你是一个知识助手。根据提供的上下文回答问题。如果上下文不包含足够信息，请如实说明。\n\n上下文：\n${ctx}`
        : '你是一个知识助手。';

      const aiContent = await callLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ], llmConfig);

      const aiMsg: ChatMessage = {
        id: 'a' + Date.now(),
        role: 'assistant',
        content: aiContent,
        sources: results,
      };
      messages = [...messages, aiMsg];
    } catch (e: any) {
      const errMsg: ChatMessage = {
        id: 'e' + Date.now(),
        role: 'assistant',
        content: `错误：${e?.message || e}`,
      };
      messages = [...messages, errMsg];
    }

    sending = false;
  }

  function clearChat() {
    messages = [];
  }

  function newSession() {
    messages = [];
    showMessage('已创建新会话');
  }

  // ── Generate candidates bridge ──────────────────────────

  async function generateCandidates() {
    if (store.getCount() === 0) {
      showMessage('请先上传文档或粘贴文本');
      return;
    }
    const query = inputText.trim() || '基于所有文档生成卡片';
    let context = '';
    try {
      if (!embedderReady) await initEmbedder();
      context = await ragContext(query, store, embedder, { topK: 10 });
    } catch {
      // continue with empty context
    }

    const request = buildRagConceptRequest({
      question: query,
      context,
      autoRun: true,
    });
    if (request) openConceptsFromRag(request);
  }

  // ── Delete document ─────────────────────────────────────

  async function deleteDoc(sourceId: string) {
    const removed = store.removeBySourceId(sourceId);
    await store.save();
    refreshDocs();
    showMessage(`已删除 ${removed} 个分块`);
  }

  // ── Keyboard ────────────────────────────────────────────

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      send();
    }
  }

  let msgListEl: HTMLElement;
  afterUpdate(() => {
    if (msgListEl) renderMath(msgListEl);
  });
</script>

<div class="rag-panel">
  <div class="rag-layout">
    <!-- Left sidebar: document management -->
    <div class="rag-left">
      <div class="rag-section">
        <h4 class="rag-section-title">嵌入模型</h4>
        <div class="rag-model-status" class:rag-model-ok={embedderReady} class:rag-model-err={!!embedderError}>
          {#if embedderReady}
            <svg><use xlink:href="#iconCheck"></use></svg>
            <span>已就绪 ({embedder.getModelName().split('/').pop()})</span>
          {:else if embedderError}
            <svg><use xlink:href="#iconInfo"></use></svg>
            <span>不可用（回退顺序匹配）</span>
          {:else}
            <svg><use xlink:href="#iconRefresh"></use></svg>
            <span>未加载</span>
            <button class="b3-button b3-button--small" on:click={initEmbedder}>加载</button>
          {/if}
        </div>
      </div>

      <div class="rag-section">
        <h4 class="rag-section-title">文档</h4>
        <div class="rag-doc-actions">
          <label class="b3-button b3-button--small b3-button--outline rag-upload-btn">
            <svg><use xlink:href="#iconAdd"></use></svg> 上传文件
            <input type="file" accept=".txt,.md,.markdown,.html,.htm" multiple on:change={handleFileUpload} hidden />
          </label>
          <button class="b3-button b3-button--small b3-button--outline" on:click={openPasteModal}>
            <svg><use xlink:href="#iconPaste"></use></svg> 粘贴
          </button>
        </div>
        <div class="rag-url-row">
          <input class="b3-text-field" type="text" placeholder="网页 URL..." bind:value={urlInput} on:keydown={(e) => { if (e.key === 'Enter') fetchUrl(); }} />
          <button class="b3-button b3-button--small" on:click={fetchUrl} disabled={urlFetching}>
            {urlFetching ? '...' : '抓取'}
          </button>
        </div>
      </div>

      <div class="rag-doc-list">
        {#if documents.length === 0}
          <p class="rag-doc-empty">暂无文档，上传文件、粘贴文本或抓取网页开始</p>
        {:else}
          {#each documents as doc (doc.sourceId)}
            <div class="rag-doc-item">
              <div class="rag-doc-info">
                <span class="rag-doc-name">{doc.fileName || doc.sourceId}</span>
                <span class="rag-doc-meta">{doc.chunkCount} 块</span>
              </div>
              <button class="rag-doc-del" on:click={() => deleteDoc(doc.sourceId)} title="删除">
                <svg><use xlink:href="#iconClose"></use></svg>
              </button>
            </div>
          {/each}
        {/if}
      </div>

      <div class="rag-stats">
        <span>{store?.getCount() || 0} 块 · {documents.length} 个文档</span>
      </div>
    </div>

    <!-- Right panel: chat -->
    <div class="rag-right">
      <div class="rag-chat-toolbar">
        <span class="rag-model-badge" title="RAG 对话模型">
          <svg><use xlink:href="#iconSettings"></use></svg>
          {plugin.getConfig().ragModel || plugin.getConfig().flashcardModel || '未配置模型'}
        </span>
        <button class="b3-button b3-button--small b3-button--outline" on:click={newSession}>新会话</button>
        <button class="b3-button b3-button--small" on:click={generateCandidates} disabled={store?.getCount() === 0}>
          <svg><use xlink:href="#iconAdd"></use></svg> 生成候选
        </button>
      </div>

      <div class="rag-msg-list" bind:this={msgListEl}>
        {#if messages.length === 0}
          <div class="rag-msg-empty">
            {#if store?.getCount() > 0}
              <p>已索引 {store.getCount()} 个文本块，可以开始提问</p>
            {:else}
              <p>上传文档或粘贴文本后开始提问</p>
            {/if}
          </div>
        {:else}
          {#each messages as msg (msg.id)}
            <div class="rag-msg" class:rag-msg-user={msg.role === 'user'} class:rag-msg-ai={msg.role === 'assistant'}>
              <div class="rag-msg-role">{msg.role === 'user' ? '你' : 'AI'}</div>
              <div class="rag-msg-content">{@html msg.content}</div>
              {#if msg.sources && msg.sources.length > 0}
                <div class="rag-msg-sources">
                  <span class="rag-msg-sources-label">来源：</span>
                  {#each msg.sources.slice(0, 3) as src (src.chunk.id)}
                    <span class="rag-msg-source" title={src.chunk.text.slice(0, 200)}>
                      {src.chunk.metadata.fileName || src.chunk.metadata.title || src.chunk.sourceId}
                      ({src.score.toFixed(2)})
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
        {#if sending}
          <div class="rag-msg rag-msg-ai">
            <div class="rag-msg-role">AI</div>
            <div class="rag-msg-content rag-loading">思考中...</div>
          </div>
        {/if}
      </div>

      <div class="rag-input-row">
        <textarea
          class="b3-text-field rag-input"
          rows="3"
          placeholder="输入问题... (Ctrl+Enter 发送)"
          bind:value={inputText}
          on:keydown={handleKeydown}
          disabled={sending}
        ></textarea>
        <button class="b3-button rag-send-btn" on:click={send} disabled={sending || !inputText.trim()}>
          发送
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Paste modal -->
{#if showPasteModal}
  <div class="rag-overlay" on:click={() => showPasteModal = false} on:keydown={(e) => { if (e.key === 'Escape') showPasteModal = false; }}>
    <div class="rag-modal" on:click|stopPropagation>
      <h4>粘贴文本</h4>
      <input class="b3-text-field" type="text" placeholder="标题（可选）" bind:value={pasteTitle} />
      <textarea class="b3-text-field" rows="8" placeholder="粘贴文本内容..." bind:value={pasteText}></textarea>
      <div class="rag-modal-actions">
        <button class="b3-button b3-button--outline" on:click={() => showPasteModal = false}>取消</button>
        <button class="b3-button" on:click={confirmPaste} disabled={!pasteText.trim() || uploading}>
          {uploading ? '索引中...' : '确认'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  .rag-panel { height: 100%; overflow: hidden; }
  .rag-layout { display: flex; height: 100%; }

  .rag-left {
    width: 260px; flex-shrink: 0; display: flex; flex-direction: column;
    border-right: 1px solid var(--b3-theme-surface-lighter);
    padding: 12px; gap: 10px; overflow-y: auto;
  }

  .rag-section { display: flex; flex-direction: column; gap: 6px; }
  .rag-section-title { font-size: var(--aio-fs-sm); font-weight: 600; margin: 0; opacity: 0.7; }

  .rag-model-status {
    display: flex; align-items: center; gap: 4px; font-size: var(--aio-fs-xs); padding: 4px 8px;
    border-radius: 4px; background: var(--b3-theme-surface-lighter);
    svg { width: 12px; height: 12px; }
    &.rag-model-ok { background: var(--b3-card-success-background); color: var(--b3-card-success-color); }
    &.rag-model-err { background: var(--b3-card-warning-background); color: var(--b3-card-warning-color); }
  }

  .rag-doc-actions { display: flex; gap: 4px; }
  .rag-upload-btn { position: relative; cursor: pointer; }
  .rag-url-row { display: flex; gap: 4px; .b3-text-field { flex: 1; font-size: var(--aio-fs-xs); } }

  .rag-doc-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .rag-doc-empty { font-size: var(--aio-fs-xs); opacity: 0.5; text-align: center; padding: 16px 0; }
  .rag-doc-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 8px; border-radius: 4px; font-size: var(--aio-fs-xs);
    &:hover { background: var(--b3-theme-surface-light); }
  }
  .rag-doc-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rag-doc-meta { opacity: 0.5; flex-shrink: 0; margin-left: 4px; }
  .rag-doc-del {
    border: none; background: none; cursor: pointer; opacity: 0.3; padding: 2px;
    svg { width: 12px; height: 12px; }
    &:hover { opacity: 0.7; color: var(--b3-card-error-color); }
  }

  .rag-stats { font-size: var(--aio-fs-xs); opacity: 0.4; text-align: center; padding: 4px 0; }

  /* Right: chat */
  .rag-right { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .rag-chat-toolbar {
    display: flex; align-items: center; justify-content: space-between; padding: 8px 12px;
    border-bottom: 1px solid var(--b3-theme-surface-lighter); flex-shrink: 0; gap: 8px;
  }
  .rag-model-badge {
    font-size: var(--aio-fs-xs); opacity: 0.5; display: flex; align-items: center; gap: 3px;
    svg { width: 10px; height: 10px; }
  }

  .rag-msg-list { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .rag-msg-empty { display: flex; align-items: center; justify-content: center; flex: 1; opacity: 0.4; font-size: var(--aio-fs-sm); }

  .rag-msg { padding: 8px 12px; border-radius: 6px; max-width: 85%; }
  .rag-msg-user { align-self: flex-end; background: var(--b3-theme-primary-lightest); }
  .rag-msg-ai { align-self: flex-start; background: var(--b3-theme-surface); border: 1px solid var(--b3-theme-surface-lighter); }
  .rag-msg-role { font-size: var(--aio-fs-xs); font-weight: 600; margin-bottom: 4px; opacity: 0.6; }
  .rag-msg-content { font-size: var(--aio-fs-base); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
  .rag-loading { opacity: 0.5; font-style: italic; }

  .rag-msg-sources { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--b3-theme-surface-lighter); font-size: var(--aio-fs-xs); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .rag-msg-sources-label { opacity: 0.5; }
  .rag-msg-source { padding: 1px 6px; border-radius: 3px; background: var(--b3-theme-surface-lighter); cursor: default; }

  .rag-input-row { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--b3-theme-surface-lighter); flex-shrink: 0; }
  .rag-input { flex: 1; resize: none; font-size: var(--aio-fs-base); }
  .rag-send-btn { flex-shrink: 0; align-self: flex-end; }

  /* Modal */
  .rag-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .rag-modal {
    background: var(--b3-theme-background); border-radius: 8px; padding: 20px; width: 500px; max-width: 90vw;
    display: flex; flex-direction: column; gap: 10px;
    h4 { margin: 0; }
  }
  .rag-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
