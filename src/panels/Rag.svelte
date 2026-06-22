<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { showMessage } from 'siyuan';
  import { VectorStore, getRagEmbedderProvider, resetEmbeddingProvider, ragQuery, ragContext, formatRagContext, buildRagConceptRequest } from '../libs/rag';
  import type { RagSearchResult, EmbeddingProvider } from '../libs/rag';
  import type { RagConceptRequest } from '../libs/rag';
  import { callLLM, resolveLLMConfig } from '../libs/llm';
  import { renderMath } from '../libs/render';
  import { getT } from '../libs/i18n';

  export let plugin: any;
  export let vectorStore: any;
  export let config: any;
  export let sourceTarget: Partial<{ type: string; sourceId?: string; chunkId?: string; quote?: string }> | null = null;
  export let openConceptsFromRag: (request: RagConceptRequest) => void = () => {};

  export let appStore: any = null;

  const t = getT(plugin);

  let store: VectorStore;
  let selectedSourceIds: string[] = [];
  let embedder: EmbeddingProvider;
  let embedderReady = false;
  let embedderError = '';
  let embedderLoading = false;

  // Reactively sync displayed status when embedder changes
  $: if (embedder) {
    embedderReady = embedder.isReady();
    embedderError = embedder.getError();
  }

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


  onMount(async () => {
    store = vectorStore || new VectorStore(plugin);
    if (!vectorStore) await store.load();

    // Reset singleton so provider config is re-read on every tab re-entry
    resetEmbeddingProvider();

    // Auto-initialize embedder on page load
    embedderLoading = true;
    try {
      embedder = await getRagEmbedderProvider(plugin);
      embedderReady = embedder.isReady();
      embedderError = embedder.getError();
    } catch (e: any) {
      embedderError = e?.message || String(e);
      embedderReady = false;
    } finally {
      embedderLoading = false;
    }

    // Pre-fill from sourceTarget
    if (sourceTarget?.quote) {
      inputText = sourceTarget.quote;
    }

    // Read pre-selected source IDs from appStore
    if (appStore?.selectedSourceIds?.length) {
      selectedSourceIds = [...appStore.selectedSourceIds];
      appStore.selectedSourceIds = [];
    }
  });

  async function initEmbedder() {
    embedderLoading = true;
    embedderError = '';
    try {
      resetEmbeddingProvider();
      embedder = await getRagEmbedderProvider(plugin);
      embedderReady = embedder.isReady();
      embedderError = embedder.getError();
      if (embedderReady) showMessage('嵌入模型已就绪');
    } catch (e: any) {
      embedderError = e?.message || String(e);
      embedderReady = false;
    } finally {
      embedderLoading = false;
    }
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
      let results = await ragQuery(text, store, embedder, { topK: config?.ragTopK || 5 });
      // Filter by selected sources if any
      if (selectedSourceIds.length > 0) {
        results = results.filter((r: any) => selectedSourceIds.includes(r.entry?.sourceId || r.sourceId));
      }
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

      const llmConfig = resolveLLMConfig(cfg, providerId, model);

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
    <!-- Left sidebar: embedder status only (Phase 4: removed import UI) -->
    <div class="rag-left">
      <div class="rag-section">
        <h4 class="rag-section-title">嵌入模型</h4>
        <div class="rag-model-status" class:rag-model-ok={embedderReady} class:rag-model-err={!!embedderError}>
          {#if embedderLoading}
            <svg><use xlink:href="#iconRefresh"></use></svg>
            <span>加载中...</span>
          {:else if embedderReady}
            <svg><use xlink:href="#iconCheck"></use></svg>
            <span>已就绪 ({embedder.getModelName().split('/').pop()})</span>
          {:else if embedderError}
            <svg><use xlink:href="#iconInfo"></use></svg>
            <span title={embedderError}>不可用：{embedderError}</span>
            <button class="b3-button b3-button--small" on:click={initEmbedder}>重试</button>
          {:else}
            <svg><use xlink:href="#iconRefresh"></use></svg>
            <span>未加载</span>
            <button class="b3-button b3-button--small" on:click={initEmbedder}>加载</button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Right panel: chat -->
    <div class="rag-right">
      <!-- Source scope selector (Phase 4) -->
      <div class="source-scope">
        <span class="source-scope-label">对话范围:</span>
        {#if !selectedSourceIds || selectedSourceIds.length === 0}
          <span class="source-scope-all">全部来源</span>
        {:else}
          <span class="source-scope-count">{selectedSourceIds.length} 个来源</span>
        {/if}
        <button class="b3-button b3-button--small" on:click={() => appStore?.onSwitchTab?.('sources')}>
          选择来源
        </button>
      </div>

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
              <p>从来源库选择来源后开始提问</p>
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

  /* Source scope selector (Phase 4) */
  .source-scope {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: var(--aio-fs-sm);
    border-bottom: 1px solid var(--b3-border-color-light, rgba(0,0,0,.06));
  }
  .source-scope-label { opacity: 0.6; }
  .source-scope-all { opacity: 0.5; font-style: italic; }
  .source-scope-count { font-weight: 500; }

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


</style>
