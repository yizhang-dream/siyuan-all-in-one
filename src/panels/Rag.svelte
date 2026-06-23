<script lang="ts">
  import { onMount, onDestroy, afterUpdate } from 'svelte';
  import { showMessage } from 'siyuan';
  // Use SiYuan's built-in Lute renderer (window.Lute) — no npm dependency needed
  import { VectorStore, getRagEmbedderProvider, resetEmbeddingProvider, ragQuery, ragContext, formatRagContext, buildRagConceptRequest } from '../libs/rag';
  import type { RagSearchResult, EmbeddingProvider } from '../libs/rag';
  import type { RagConceptRequest } from '../libs/rag';
  import { callLLM, resolveLLMConfig } from '../libs/llm';
  import { renderMath } from '../libs/render';
  import { getT } from '../libs/i18n';
  import { ConversationStore, type ConversationSession, type ChatMessage } from '../libs/conversation-store';

  export let plugin: any;
  export let vectorStore: any;
  export let sourceStore: any = null;
  export let config: any;
  export let sourceTarget: Partial<{ type: string; sourceId?: string; chunkId?: string; quote?: string }> | null = null;
  export let openConceptsFromRag: (request: RagConceptRequest) => void = () => {};

  export let appStore: any = null;

  function mdToHtml(text: string): string {
    if (!text) return '';
    try {
      const lute = (window as any).Lute.New();
      lute.SetInlineMath(true);
      lute.SetInlineMathAllowDigitAfterOpenMarker(true);
      lute.SetGFMStrikethrough(true);
      lute.SetMark(true);
      lute.SetSup(true);
      lute.SetSub(true);
      lute.SetCallout(true);
      lute.SetSuperBlock(true);
      lute.SetSanitize(true);
      return lute.Md2HTML(text);
    } catch {
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  const t = getT(plugin);

  let store: VectorStore;
  let embedder: EmbeddingProvider;
  let conversationStore: ConversationStore;

  let sessions: ConversationSession[] = [];
  let activeSessionId: string | null = null;
  let inputText = '';
  let sending = false;
  let pollTimer: any = null;
  let renamingId: string | null = null;
  let renameInput = '';
  let msgListEl: HTMLElement;
  let activeSession: ConversationSession | null = null;

  // Poll store while sending to detect background completion (survives tab switch)
  $: if (sending && activeSessionId) {
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        const fresh = conversationStore?.getById(activeSessionId);
        if (fresh) {
          activeSession = fresh;
          const lastMsg = fresh.messages[fresh.messages.length - 1];
          if (lastMsg?.role === 'assistant') {
            sending = false;
          }
        }
      }, 500);
    }
  } else if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  onDestroy(() => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  });

  // ── Session CRUD ────────────────────────────────────────

  function createNewSession(sourceIds?: string[]) {
    const session = conversationStore.create(undefined, sourceIds);
    sessions = [session, ...sessions];
    activeSessionId = session.id;
    activeSession = session;
  }

  function switchSession(id: string) {
    activeSessionId = id;
    activeSession = conversationStore.getById(id);
    if (activeSession) {
      const lastMsg = activeSession.messages[activeSession.messages.length - 1];
      if (lastMsg?.role === 'user') sending = true;
      else sending = false;
    }
  }

  function deleteSession(id: string) {
    conversationStore.delete(id);
    sessions = conversationStore.getAll();
    if (activeSessionId === id) {
      activeSessionId = sessions[0]?.id || null;
      if (!activeSessionId) createNewSession();
    }
  }

  function renameSession(id: string, title: string) {
    conversationStore.update(id, { title });
    sessions = conversationStore.getAll();
  }

  // ── Inline rename ───────────────────────────────────────

  function startRename(session: ConversationSession) {
    renamingId = session.id;
    renameInput = session.title;
  }

  function commitRename(id: string) {
    if (renameInput.trim()) {
      conversationStore.rename(id, renameInput.trim());
      sessions = conversationStore.getAll();
    }
    renamingId = null;
  }

  function handleRenameKeydown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') {
      commitRename(id);
    } else if (e.key === 'Escape') {
      renamingId = null;
    }
  }

  // ── Lifecycle ───────────────────────────────────────────

  onMount(async () => {
    store = vectorStore || new VectorStore(plugin);
    if (!vectorStore) await store.load();

    conversationStore = new ConversationStore(plugin);
    await conversationStore.load();
    sessions = conversationStore.getAll();

    // Pre-fill from sourceTarget
    if (sourceTarget?.quote) {
      inputText = sourceTarget.quote;
    }

    // Consume cross-tab source selection from appStore
    if (appStore?.selectedSourceIds?.length) {
      const sourceIds = [...appStore.selectedSourceIds];
      appStore.selectedSourceIds = [];
      createNewSession(sourceIds);
    } else if (!activeSessionId && sessions.length === 0) {
      createNewSession();
    } else if (!activeSessionId) {
      activeSessionId = sessions[0].id;
    }

    activeSession = activeSessionId ? conversationStore.getById(activeSessionId) : null;
    // Recover pending state — if last message is from user, show "thinking..."
    if (activeSession) {
      const lastMsg = activeSession.messages[activeSession.messages.length - 1];
      if (lastMsg?.role === 'user') sending = true;
    }

    // Auto-initialize embedder on page load (silent)
    try {
      resetEmbeddingProvider();
      embedder = await getRagEmbedderProvider(plugin);
    } catch {
      // silent
    }
  });

  async function initEmbedder() {
    try {
      resetEmbeddingProvider();
      embedder = await getRagEmbedderProvider(plugin);
      if (embedder.isReady()) showMessage('嵌入模型已就绪');
    } catch (e: any) {
      showMessage(`嵌入模型加载失败：${e?.message || e}`);
    }
  }

  // ── Chat ────────────────────────────────────────────────

  async function send() {
    const text = inputText.trim();
    if (!text || sending) return;
    if (!activeSessionId) return;
    if (store.getCount() === 0) {
      showMessage('请先上传文档或粘贴文本');
      return;
    }

    const userMsg: ChatMessage = { id: 'u' + Date.now(), role: 'user', content: text };
    conversationStore.addMessage(activeSessionId, userMsg);
    activeSession = conversationStore.getById(activeSessionId);
    inputText = '';
    sending = true;
    sessions = conversationStore.getAll();

    try {
      const session = conversationStore.getById(activeSessionId);
      const messages = session?.messages || [];

      if (!embedder?.isReady()) await initEmbedder();

      // RAG retrieval — pass sourceIds filter so only selected sources are searched
      const sourceIds = session?.sourceIds || [];
      const results = await ragQuery(text, store, embedder, {
        topK: config?.ragTopK || 5,
        sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
      });
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
        ? `你是一个知识助手。请始终使用 Markdown 格式回复，包括但不限于：
- 使用 **加粗** 突出重点
- 使用 \`代码块\` 展示代码
- 使用 - 或 1. 创建列表
- 使用 ### 标题组织内容
- 使用 > 引用原文

以下是用户导入的文档中检索到的相关内容，你已经拥有这些信息，可以直接引用其中的数据、公式和结论来回答问题。

当用户问"你能看见文件吗"或类似问题时，请明确告知：你已经获得了文档的内容（见下方），可以基于这些内容回答。

如果下方内容不足以回答问题，请如实说明缺失了哪些信息。

以下是检索到的文档内容：
${ctx}`
        : `你是一个知识助手。请始终使用 Markdown 格式回复，包括但不限于：
- 使用 **加粗** 突出重点
- 使用 \`代码块\` 展示代码
- 使用 - 或 1. 创建列表
- 使用 ### 标题组织内容
- 使用 > 引用原文

用户尚未导入任何文档。如果需要基于具体文档回答，请提示用户先在"来源库"导入文件。`;

      // Build full conversation history for LLM (multi-turn)
      const llmMessages = messages.map(m => ({
        role: m.role,
        content: m.content
      }));
      // Add system message at the beginning
      llmMessages.unshift({ role: 'system', content: systemPrompt });

      const aiContent = await callLLM(llmMessages, llmConfig);

      // Auto-title: if this is the first message, generate title
      if (messages.length === 1) {
        const title = text.trim().split('\n')[0].substring(0, 30) || '新对话';
        renameSession(activeSessionId, title);
      }

      conversationStore.addMessage(activeSessionId, {
        id: 'a' + Date.now(),
        role: 'assistant',
        content: aiContent,
        sources: results,
      });
      activeSession = conversationStore.getById(activeSessionId);

      sessions = conversationStore.getAll();
    } catch (e: any) {
      conversationStore.addMessage(activeSessionId, {
        id: 'e' + Date.now(),
        role: 'assistant',
        content: `错误：${e?.message || e}`,
      });
      activeSession = conversationStore.getById(activeSessionId);
      sessions = conversationStore.getAll();
    }

    sending = false;
  }

  function clearChat() {
    if (!activeSessionId) return;
    conversationStore.update(activeSessionId, { messages: [] });
    sessions = conversationStore.getAll();
  }

  function newSession() {
    createNewSession();
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
      if (!embedder?.isReady()) await initEmbedder();
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

  afterUpdate(() => {
    if (msgListEl) renderMath(msgListEl);
  });
</script>

<div class="rag-chat-layout">
  <!-- LEFT SIDEBAR: Conversation List -->
  <div class="rag-sidebar">
    <div class="sidebar-header">
      <button class="b3-button b3-button--outline" on:click={createNewSession}>
        + 新对话
      </button>
    </div>
    <div class="session-list">
      {#each sessions as session (session.id)}
        <div class="session-item"
             class:active={session.id === activeSessionId}
             role="button"
             tabindex="0"
             on:click={() => switchSession(session.id)}
             on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchSession(session.id); } }}>
          {#if renamingId === session.id}
            <input class="session-rename-input"
                   bind:value={renameInput}
                   on:keydown={(e) => handleRenameKeydown(e, session.id)}
                   on:blur={() => commitRename(session.id)}
                   autofocus />
          {:else}
            <span class="session-title"
                  on:dblclick={() => startRename(session)}
                  title="双击重命名">
              {session.title}
            </span>
          {/if}
          <span class="session-time">{new Date(session.updatedAt).toLocaleDateString()}</span>
          <button class="session-delete" on:click|stopPropagation={() => deleteSession(session.id)}>×</button>
        </div>
      {/each}
      {#if sessions.length === 0}
        <div class="session-empty">暂无对话</div>
      {/if}
    </div>
  </div>

  <!-- RIGHT: Chat Area -->
  <div class="rag-chat-main">
    <!-- Toolbar: title + source scope -->
    <div class="chat-toolbar">
      <div class="chat-toolbar-left">
        <div class="chat-title">
          {activeSession?.title || '新对话'}
        </div>
        <span class="chat-model-badge" title="RAG 对话模型">
          <svg><use xlink:href="#iconSettings"></use></svg>
          {plugin.getConfig().ragModel || plugin.getConfig().flashcardModel || '未配置模型'}
        </span>
      </div>
      <div class="chat-toolbar-right">
        <div class="chat-source-scope">
          {#if activeSession?.sourceIds?.length}
            已选 {activeSession.sourceIds.length} 个来源
          {:else}
            全部来源
          {/if}
          <button class="b3-button b3-button--small" on:click={() => appStore?.onSwitchTab?.('sources')}>
            选择来源
          </button>
        </div>
        <button class="b3-button b3-button--small" on:click={generateCandidates} disabled={store?.getCount() === 0}>
          <svg><use xlink:href="#iconAdd"></use></svg> 生成候选
        </button>
      </div>
    </div>

    <!-- Messages -->
    <div class="chat-messages" bind:this={msgListEl}>
      {#if activeSession}
        {#if activeSession.messages.length === 0}
          <div class="rag-msg-empty">
            {#if store?.getCount() > 0}
              <p>已索引 {store.getCount()} 个文本块，可以开始提问</p>
            {:else}
              <p>从来源库选择来源后开始提问</p>
            {/if}
          </div>
        {:else}
          {#each activeSession.messages as msg (msg.id)}
            <div class="chat-msg {msg.role}">
              <div class="msg-role">{msg.role === 'user' ? '你' : 'AI'}</div>
              <div class="msg-content">{@html mdToHtml(msg.content)}</div>
              {#if msg.sources?.length}
                <div class="msg-sources">
                  {#each msg.sources.slice(0, 3) as src}
                    <span class="source-chip" title={src.chunk.text.substring(0, 200)}>
                      {src.chunk.metadata?.fileName || src.chunk.metadata?.title || '来源'} ({src.score.toFixed(2)})
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      {/if}
      {#if sending}
        <div class="chat-msg assistant">
          <div class="msg-role">AI</div>
          <div class="msg-content thinking">思考中...</div>
        </div>
      {/if}
    </div>

    <!-- Input Bar -->
    <div class="chat-input-bar">
      <textarea bind:value={inputText} placeholder="输入问题... (Ctrl+Enter 发送)"
                on:keydown={handleKeydown} rows="2"></textarea>
      <button class="b3-button" on:click={send} disabled={sending || !inputText.trim()}>
        发送
      </button>
    </div>
  </div>
</div>

<style lang="scss">
  .rag-chat-layout {
    display: flex; height: 100%; overflow: hidden;
  }
  .rag-sidebar {
    width: 240px; flex-shrink: 0;
    display: flex; flex-direction: column;
    border-right: 1px solid var(--b3-border-color);
    background: var(--b3-theme-surface);
  }
  .sidebar-header {
    padding: 12px;
    border-bottom: 1px solid var(--b3-border-color);
  }
  .session-list {
    flex: 1; overflow-y: auto; padding: 4px;
  }
  .session-item {
    padding: 8px 12px; border-radius: 6px; cursor: pointer;
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 2px;
  }
  .session-item:hover { background: var(--b3-theme-surface-lighter); }
  .session-item.active { background: var(--b3-theme-primary-lightest); }
  .session-title { flex: 1; font-size: var(--aio-fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session-time { font-size: 11px; color: var(--b3-theme-on-surface-light); }
  .session-rename-input {
    flex: 1;
    border: 1px solid var(--b3-theme-primary);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: var(--aio-fs-sm);
    background: var(--b3-theme-background);
    color: var(--b3-theme-on-background);
    outline: none;
  }
  .session-delete { opacity: 0; background: none; border: none; cursor: pointer; color: var(--b3-theme-error); }
  .session-item:hover .session-delete { opacity: 1; }
  .session-empty { padding: 16px; text-align: center; opacity: 0.5; font-size: var(--aio-fs-sm); }

  .rag-chat-main {
    flex: 1; display: flex; flex-direction: column; min-width: 0;
  }
  .chat-toolbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px; border-bottom: 1px solid var(--b3-border-color);
    background: var(--b3-theme-background);
    flex-shrink: 0; gap: 12px;
  }
  .chat-toolbar-left {
    display: flex; align-items: center; gap: 10px; min-width: 0;
  }
  .chat-toolbar-right {
    display: flex; align-items: center; gap: 10px; flex-shrink: 0;
  }
  .chat-title { font-weight: 600; font-size: var(--aio-fs-base); white-space: nowrap; }
  .chat-model-badge {
    font-size: var(--aio-fs-xs); opacity: 0.5; display: flex; align-items: center; gap: 3px;
    svg { width: 10px; height: 10px; }
  }
  .chat-source-scope {
    display: flex; align-items: center; gap: 8px;
    font-size: var(--aio-fs-sm);
  }

  .chat-messages {
    flex: 1; overflow-y: auto; padding: 16px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .rag-msg-empty { display: flex; align-items: center; justify-content: center; flex: 1; opacity: 0.4; font-size: var(--aio-fs-sm); }

  .chat-msg { padding: 8px 12px; border-radius: 6px; max-width: 85%; }
  .chat-msg.user { align-self: flex-end; background: var(--b3-theme-primary-lightest); }
  .chat-msg.assistant { align-self: flex-start; background: var(--b3-theme-surface); border: 1px solid var(--b3-theme-surface-lighter); }
  .msg-role { font-size: var(--aio-fs-xs); font-weight: 600; margin-bottom: 4px; opacity: 0.6; }
  .msg-content { font-size: var(--aio-fs-base); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
  .msg-content.thinking { opacity: 0.5; font-style: italic; }

  .msg-sources { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--b3-theme-surface-lighter); font-size: var(--aio-fs-xs); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .source-chip { padding: 1px 6px; border-radius: 3px; background: var(--b3-theme-surface-lighter); cursor: default; }

  .chat-input-bar {
    display: flex; gap: 8px; padding: 12px 16px;
    border-top: 1px solid var(--b3-border-color);
    background: var(--b3-theme-background);
    flex-shrink: 0;
  }
  .chat-input-bar textarea {
    flex: 1; resize: none;
    border: 1px solid var(--b3-border-color); border-radius: 6px;
    padding: 8px 12px; font-size: var(--aio-fs-base);
    background: var(--b3-theme-surface); color: var(--b3-theme-on-surface);
  }
</style>
