<script lang="ts">
  import { onMount, onDestroy, tick, afterUpdate } from 'svelte';
  import { showMessage } from 'siyuan';
  // Use SiYuan's built-in Lute renderer (window.Lute) — no npm dependency needed
  import { VectorStore, getRagEmbedderProvider, resetEmbeddingProvider, ragQuery, ragContext, formatRagContext, buildRagConceptRequest } from '../libs/rag';
  import type { RagSearchResult, EmbeddingProvider } from '../libs/rag';
  import type { RagConceptRequest } from '../libs/rag';
  import { callLLM, resolveLLMConfig } from '../libs/llm';
  import type { ToolCall as LLMToolCall } from '../libs/llm';
  import { getEnabledTools, executeTool, type ToolContext } from '../libs/tools';
  import { renderMath } from '../libs/render';
  import { getT } from '../libs/i18n';
  import { ConversationStore, type SessionIndex, type ChatMessage } from '../libs/conversation-store';

  export let plugin: any;
  export let vectorStore: any;
  export let sourceStore: any = null;
  export let config: any;
  export let sourceTarget: Partial<{ type: string; sourceId?: string; chunkId?: string; quote?: string }> | null = null;
  export let openConceptsFromRag: (request: RagConceptRequest) => void = () => {};

  export let appStore: any = null;

  function mdToHtml(text: string): string {
    if (!text) return '';
    if (text.length > 10000) {
      console.warn('[all-in-one] mdToHtml: large content (' + text.length + ' chars), may block UI');
    }
    try {
      // Fix: merge list numbers split across lines (e.g., "1.\n**text**" → "1. **text**")
      const fixed = text.replace(/(^|\n)(\d+)\.\s*\n\s*(\S)/gm, '$1$2. $3');
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
      return lute.Md2HTML(fixed);
    } catch {
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  const t = getT(plugin);

  let store: VectorStore;
  let embedder: EmbeddingProvider;
  let conversationStore: ConversationStore;

  let sessions: SessionIndex[] = [];
  let activeSessionId: string | null = null;
  let activeMessages: ChatMessage[] = [];
  let inputText = '';
  let sending = false;
  let activeRequestId = 0;
  let pollTimer: any = null;
  let renamingId: string | null = null;
  let renameInput = '';
  let msgListEl: HTMLElement;
  let autoScroll = true;

  function handleMsgScroll() {
    if (!msgListEl) return;
    const threshold = 100;
    autoScroll = (msgListEl.scrollHeight - msgListEl.scrollTop - msgListEl.clientHeight) < threshold;
  }

  function scrollToBottom(force = false) {
    if (!msgListEl) return;
    tick().then(() => {
      if (force || autoScroll) msgListEl.scrollTop = msgListEl.scrollHeight;
    });
  }

  let activeSession: SessionIndex | null = null;

  // Agent mode toggle
  let agentMode = false;

  $: currentModel = plugin?.getConfig()?.ragModel || plugin?.getConfig()?.flashcardModel || '未配置模型';

  // Poll store while sending to detect background completion (survives tab switch)
  $: if (sending && activeSessionId) {
    if (!pollTimer) {
      pollTimer = setInterval(async () => {
        const msgs = await conversationStore?.getMessages(activeSessionId!);
        if (msgs && msgs.length > 0) {
          activeMessages = msgs;
          const lastMsg = msgs[msgs.length - 1];
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
    msgListEl?.removeEventListener('scroll', handleMsgScroll);
  });

  // ── Session CRUD ────────────────────────────────────────

  function createNewSession(sourceIds?: string[]) {
    const session = conversationStore.create(undefined, sourceIds);
    sessions = [session, ...sessions];
    activeSessionId = session.id;
    activeSession = session;
    activeMessages = [];
  }

  async function switchSession(id: string) {
    activeSessionId = id;
    activeSession = conversationStore.getById(id);
    activeMessages = await conversationStore.getMessages(id);
    await tick();
    if (msgListEl) {
      renderMath(msgListEl);
    }
    if (activeMessages.length > 0) {
      const lastMsg = activeMessages[activeMessages.length - 1];
      if (lastMsg?.role === 'user') sending = true;
      else sending = false;
    }
  }

  async function deleteSession(id: string) {
    await conversationStore.delete(id);
    sessions = conversationStore.getAll();
    if (activeSessionId === id) {
      activeSessionId = sessions[0]?.id || null;
      activeSession = activeSessionId ? conversationStore.getById(activeSessionId) : null;
      activeMessages = activeSessionId ? await conversationStore.getMessages(activeSessionId) : [];
      if (!activeSessionId) createNewSession();
    }
  }

  function renameSession(id: string, title: string) {
    conversationStore.rename(id, title);
    sessions = conversationStore.getAll();
  }

  // ── Inline rename ───────────────────────────────────────

  function startRename(session: SessionIndex) {
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
    const t0 = performance.now();
    console.log('[all-in-one] onMount: start');

    store = vectorStore || new VectorStore(plugin);
    if (!vectorStore) {
      console.log('[all-in-one] onMount: loading vectorStore...');
      await store.load();
      console.log('[all-in-one] onMount: vectorStore loaded in', (performance.now() - t0).toFixed(0), 'ms');
    }

    conversationStore = new ConversationStore(plugin);
    console.log('[all-in-one] onMount: loading conversationStore...');
    await conversationStore.load();
    console.log('[all-in-one] onMount: conversationStore loaded in', (performance.now() - t0).toFixed(0), 'ms');

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
    if (activeSessionId) {
      console.log('[all-in-one] onMount: loading messages for session', activeSessionId);
      activeMessages = await conversationStore.getMessages(activeSessionId);
      console.log('[all-in-one] onMount: messages loaded, count=', activeMessages.length, 'in', (performance.now() - t0).toFixed(0), 'ms');
    } else {
      activeMessages = [];
    }

    // Recover pending state — if last message is from user AND session is recent, show "thinking..."
    if (activeMessages.length > 0) {
      const lastMsg = activeMessages[activeMessages.length - 1];
      const now = Date.now();
      const sessionAge = activeSession?.updatedAt ? now - activeSession.updatedAt : Infinity;
      if (lastMsg?.role === 'user' && sessionAge < 120_000) {  // < 2 minutes
        sending = true;
      }
    }

    // Only auto-init builtin embedder (deferred, doesn't await)
    const embCfg = plugin.getConfig();
    if (embCfg?.ragEmbeddingProvider === 'builtin') {
      console.log('[all-in-one] onMount: starting builtin embedder (background)');
      getRagEmbedderProvider(plugin).then(em => {
        embedder = em;
        console.log('[all-in-one] onMount: builtin embedder ready');
      }).catch(() => {});
    } else {
      console.log('[all-in-one] onMount: skip embedder init (provider=' + embCfg?.ragEmbeddingProvider + ')');
    }

    msgListEl?.addEventListener('scroll', handleMsgScroll);
    console.log('[all-in-one] onMount: DONE in', (performance.now() - t0).toFixed(0), 'ms');
  });

  async function initEmbedder() {
    // If background init already completed, skip re-initialization
    if (embedder?.isReady()) return;
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

    const requestId = ++activeRequestId;

    const userMsg: ChatMessage = { id: 'u' + Date.now(), role: 'user', content: text };
    await conversationStore.addMessage(activeSessionId, userMsg);
    activeSession = conversationStore.getById(activeSessionId);
    activeMessages = await conversationStore.getMessages(activeSessionId);
    await tick();
    if (msgListEl) {
      renderMath(msgListEl);
    }
    inputText = '';
    sending = true;
    scrollToBottom(true);
    sessions = conversationStore.getAll();

    try {
      const messages = activeMessages;
      if (requestId !== activeRequestId) return;

      if (!embedder?.isReady()) await initEmbedder();
      if (requestId !== activeRequestId) return;

      // RAG retrieval — pass sourceIds filter so only selected sources are searched
      const sourceIds = activeSession?.sourceIds || [];
      const results = await ragQuery(text, store, embedder, {
        topK: config?.ragTopK || 5,
        sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
      });
      if (requestId !== activeRequestId) return;
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

      let finalContent = '';
      let toolLog = '';

      if (agentMode) {
        // ── Agent loop ───────────────────────────────────────────
        const tools = getEnabledTools();
        const MAX_AGENT_ITERATIONS = 5;
        let iterations = 0;
        let agentRunning = true;

        while (agentRunning && iterations < MAX_AGENT_ITERATIONS) {
          iterations++;

          const result = await callLLM(llmMessages, llmConfig, { tools });

          if (result.toolCalls && result.toolCalls.length > 0) {
            // Add assistant message with tool_calls to conversation history
            llmMessages.push({
              role: 'assistant',
              content: result.content || '',
              tool_calls: result.toolCalls,
            });

            const toolNames = result.toolCalls.map(tc => tc.function.name);
            toolLog += `\n[调用工具: ${toolNames.join(', ')}]\n`;

            // Execute each tool
            const toolCtx: ToolContext = { plugin, vectorStore, embedder };
            for (const tc of result.toolCalls) {
              const toolResult = await executeTool(tc, toolCtx);
              llmMessages.push({
                role: 'tool' as any,
                tool_call_id: tc.id,
                content: toolResult,
              });
            }
          } else if (result.content) {
            finalContent += result.content;
            agentRunning = false;
          } else {
            agentRunning = false;
          }
        }

        // Prepend tool log to final content
        if (toolLog) {
          finalContent = toolLog + '\n' + finalContent;
        }
      } else {
        // ── Normal (non-agent) mode ────────────────────────────
        const aiContent = await callLLM(llmMessages, llmConfig);
        finalContent = aiContent;
      }
      if (requestId !== activeRequestId) return;

      // Auto-title: if this is the first message, generate title
      if (messages.length === 1) {
        const title = text.trim().split('\n')[0].substring(0, 30) || '新对话';
        renameSession(activeSessionId, title);
      }

      const contextDocuments = results.map(r => ({
        sourceId: r.chunk.sourceId,
        title: r.chunk.metadata?.fileName || r.chunk.metadata?.title || '来源',
        chunkText: r.chunk.text.substring(0, 80),
        score: r.score,
      }));
      if (requestId !== activeRequestId) return;

      await conversationStore.addMessage(activeSessionId, {
        id: 'a' + Date.now(),
        role: 'assistant',
        content: finalContent,
        sources: results,
        contextDocuments,
      });
      activeSession = conversationStore.getById(activeSessionId);
      activeMessages = await conversationStore.getMessages(activeSessionId);
      await tick();
      if (msgListEl) {
        renderMath(msgListEl);
        scrollToBottom(true);
      }

      sessions = conversationStore.getAll();
    } catch (e: any) {
      if (requestId !== activeRequestId) return;
      await conversationStore.addMessage(activeSessionId, {
        id: 'e' + Date.now(),
        role: 'assistant',
        content: `错误：${e?.message || e}`,
      });
      activeSession = conversationStore.getById(activeSessionId);
      activeMessages = await conversationStore.getMessages(activeSessionId);
      await tick();
      if (msgListEl) {
        renderMath(msgListEl);
        scrollToBottom(true);
      }
      sessions = conversationStore.getAll();
    }

    sending = false;
  }

  async function clearChat() {
    if (!activeSessionId) return;
    await conversationStore.update(activeSessionId, { messages: [] });
    activeMessages = [];
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

  function abortSend() {
    activeRequestId++;
    sending = false;
    showMessage('已停止生成');
  }

  function handleSendClick() {
    if (sending) abortSend();
    else send();
  }

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function enhanceCodeBlocks(root: HTMLElement) {
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.code-block-toolbar')) return;
      const code = pre.querySelector('code');
      let lang = 'code';
      if (code) {
        const clsMatch = (code.className || '').match(/language-(\S+)/);
        if (clsMatch) {
          lang = clsMatch[1];
        } else {
          const dataLang = (code as HTMLElement).getAttribute('data-language');
          if (dataLang) lang = dataLang;
        }
      }
      const toolbar = document.createElement('div');
      toolbar.className = 'code-block-toolbar';
      toolbar.innerHTML = `<span class="code-lang-label">${escapeHtml(lang)}</span><button class="code-copy-btn" title="复制">📋</button>`;
      const copyBtn = toolbar.querySelector('.code-copy-btn') as HTMLButtonElement;
      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = code ? (code.textContent || '') : (pre.textContent || '');
        try {
          await navigator.clipboard.writeText(text);
          showMessage('已复制到剪贴板');
        } catch {
          showMessage('复制失败');
        }
      });
      pre.prepend(toolbar);
    });
  }

  afterUpdate(() => {
    if (msgListEl) enhanceCodeBlocks(msgListEl);
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
        <label class="agent-toggle" title="启用 Agent 模式（自动调用工具）">
          <input type="checkbox" bind:checked={agentMode} />
          Agent
        </label>
        <button class="b3-button b3-button--small" on:click={generateCandidates} disabled={store?.getCount() === 0}>
          <svg><use xlink:href="#iconAdd"></use></svg> 生成候选
        </button>
      </div>
    </div>

    <!-- Messages -->
    <div class="chat-messages" bind:this={msgListEl}>
      {#if activeSession}
        {#if activeMessages.length === 0}
          <div class="rag-msg-empty">
            {#if store?.getCount() > 0}
              <p>已索引 {store.getCount()} 个文本块，可以开始提问</p>
            {:else}
              <p>从来源库选择来源后开始提问</p>
            {/if}
          </div>
        {:else}
          {#each activeMessages as msg (msg.id)}
            <div class="chat-msg {msg.role}">
              {#if msg.role === 'assistant'}
                <div class="msg-header">
                  <span class="msg-role">AI</span>
                  <span class="msg-model-badge" title="模型">{currentModel}</span>
                </div>
              {:else}
                <div class="msg-role">你</div>
              {/if}
              <div class="msg-content">{@html mdToHtml(msg.content)}</div>
              {#if msg.contextDocuments?.length}
                <div class="msg-context">
                  <div class="context-label">📚 参考来源：</div>
                  {#each msg.contextDocuments as doc}
                    <div class="context-item">
                      <span class="context-title">{doc.title}</span>
                      <span class="context-score">({doc.score.toFixed(2)})</span>
                      <div class="context-preview">{doc.chunkText}...</div>
                    </div>
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
    <div class="chat-input-area">
      <div class="chat-input-wrap">
        <textarea bind:value={inputText} placeholder="输入问题... (Ctrl+Enter 发送)"
                  on:keydown={handleKeydown} rows="1"></textarea>
        <button class="chat-send-btn" class:aborting={sending} on:click={handleSendClick}
                disabled={!sending && !inputText.trim()} aria-label={sending ? '停止生成' : '发送'}>
          {#if sending}
            <span class="send-icon abort-icon">■</span>
          {:else}
            <span class="send-icon">➤</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style lang="scss">
  .rag-chat-layout {
    display: flex; position: absolute; top: 0; right: 0; bottom: 0; left: 0; overflow: hidden;
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
    flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0;
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
  .agent-toggle {
    display: flex; align-items: center; gap: 4px;
    font-size: var(--aio-fs-sm);
    cursor: pointer;
    user-select: none;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--b3-border-color);
    background: var(--b3-theme-surface);
  }
  .agent-toggle input { margin: 0; cursor: pointer; }

  .chat-messages {
    flex: 1; overflow-y: scroll; padding: 16px; min-height: 0;
  }
  .rag-msg-empty { display: flex; align-items: center; justify-content: center; flex: 1; opacity: 0.4; font-size: var(--aio-fs-sm); }
  .chat-messages::-webkit-scrollbar { width: 8px; }
  .chat-messages::-webkit-scrollbar-track { background: var(--b3-theme-surface-light, transparent); }
  .chat-messages::-webkit-scrollbar-thumb { background: var(--b3-scroll-color, var(--b3-theme-on-surface-light, #888)); border-radius: 4px; }
  .chat-messages::-webkit-scrollbar-thumb:hover { background: var(--b3-theme-on-surface, #666); }

  .chat-msg { padding: 8px 12px; border-radius: 6px; overflow: hidden; margin-bottom: 10px; }
  .chat-msg:last-child { margin-bottom: 0; }
  .chat-msg.user { align-self: flex-end; background: var(--b3-theme-primary-lightest); max-width: 80%; }
  .chat-msg.assistant { align-self: flex-start; background: var(--b3-theme-surface); border: 1px solid var(--b3-theme-surface-lighter); max-width: 92%; }
  .msg-role { font-size: var(--aio-fs-xs); font-weight: 600; margin-bottom: 4px; opacity: 0.6; }
  .msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .msg-header .msg-role { margin-bottom: 0; }
  .msg-model-badge {
    font-size: var(--aio-fs-xs);
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--b3-theme-surface-lighter);
    color: var(--b3-theme-on-surface-light);
    border: 1px solid var(--b3-border-color);
  }
  .msg-content { font-size: var(--aio-fs-base); line-height: 1.6; word-break: break-word; overflow: hidden; }
  .msg-content :global(p) { margin: 0.4em 0; }
  .msg-content :global(ol), .msg-content :global(ul) { margin: 0.4em 0; padding-left: 1.8em; }
  .msg-content :global(li) { margin: 0.2em 0; }
  .msg-content :global(pre) {
    position: relative;
    margin: 8px 0;
    padding: 0 !important;
    border-radius: 6px;
    background: var(--b3-theme-surface);
    border: 1px solid var(--b3-border-color);
    box-shadow: var(--b3-tooltips-shadow);
    max-height: 600px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .msg-content :global(pre) :global(code) {
    display: block;
    padding: 12px !important;
    margin: 0;
    overflow: auto;
    flex: 1;
    min-height: 0;
    font-family: var(--b3-font-family-code);
    font-size: 0.9em;
    line-height: 1.5;
    background: transparent !important;
  }
  .msg-content :global(pre) :global(code)::-webkit-scrollbar {
    width: 8px; height: 8px;
  }
  .msg-content :global(pre) :global(code)::-webkit-scrollbar-track {
    background: var(--b3-theme-background); border-radius: 4px;
  }
  .msg-content :global(pre) :global(code)::-webkit-scrollbar-thumb {
    background: var(--b3-scroll-color); border-radius: 4px;
  }
  .msg-content :global(code) {
    font-family: var(--b3-font-family-code);
    background: var(--b3-theme-surface-light);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .msg-content :global(.code-block-toolbar) {
    display: flex; align-items: center; justify-content: space-between;
    padding: 5px 10px;
    background: var(--b3-theme-surface-lighter);
    border-bottom: 1px solid var(--b3-border-color);
    font-size: var(--aio-fs-xs);
    color: var(--b3-theme-on-surface-light);
    user-select: none;
    animation: fadeIn 0.15s ease-out;
  }
  .msg-content :global(.code-lang-label) { text-transform: lowercase; font-weight: 500; }
  .msg-content :global(.code-copy-btn) {
    background: transparent; border: none; cursor: pointer; padding: 2px 6px;
    border-radius: 4px; transition: background 0.2s; font-size: var(--aio-fs-sm);
  }
  .msg-content :global(.code-copy-btn:hover) { background: var(--b3-theme-surface); }
  @keyframes aio-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
  .msg-content.thinking {
    display: flex; align-items: center; gap: 8px; opacity: 0.5;
  }
  .msg-content.thinking::before {
    content: '';
    display: inline-block; width: 14px; height: 14px; flex-shrink: 0;
    border: 2px solid var(--b3-theme-on-surface-light);
    border-top-color: var(--b3-theme-primary);
    border-radius: 50%;
    animation: aio-spin 1s linear infinite;
  }

  .msg-sources { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--b3-theme-surface-lighter); font-size: var(--aio-fs-xs); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .source-chip { padding: 1px 6px; border-radius: 3px; background: var(--b3-theme-surface-lighter); cursor: default; }

  .msg-context {
    margin-top: 8px;
    padding: 8px;
    background: var(--b3-theme-surface-light);
    border-radius: 6px;
    font-size: var(--aio-fs-xs);
    overflow: hidden;
    max-width: 100%;
    animation: fadeIn 0.15s ease-out;
  }
  .context-label {
    font-weight: 600;
    margin-bottom: 4px;
    color: var(--b3-theme-on-surface-light);
  }
  .context-item {
    padding: 4px 0;
    border-top: 1px solid var(--b3-border-color);
  }
  .context-item:first-child { border-top: none; }
  .context-title {
    font-weight: 500;
  }
  .context-score {
    color: var(--b3-theme-on-surface-light);
    margin-left: 6px;
  }
  .context-preview {
    color: var(--b3-theme-on-surface-light);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chat-input-area {
    padding: 12px 16px;
    border-top: 1px solid var(--b3-border-color);
    background: var(--b3-theme-background);
    flex-shrink: 0;
  }
  .chat-input-wrap {
    position: relative;
    display: flex;
    align-items: flex-end;
  }
  .chat-input-wrap textarea {
    width: 100%; resize: none; min-height: 48px; max-height: 200px;
    border: 1px solid var(--b3-border-color); border-radius: 12px;
    padding: 10px 46px 10px 12px; font-size: var(--aio-fs-base); line-height: 1.5;
    background: var(--b3-theme-surface); color: var(--b3-theme-on-surface);
    font-family: inherit;
  }
  .chat-input-wrap textarea:focus {
    outline: none;
    border-color: var(--b3-theme-primary);
  }
  .chat-send-btn {
    position: absolute; right: 6px; bottom: 6px; width: 36px; height: 36px;
    border-radius: 50%; border: none;
    background: var(--b3-theme-primary); color: var(--b3-theme-on-primary);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.2s ease;
  }
  .chat-send-btn:hover:not(:disabled) { transform: scale(1.05); }
  .chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .chat-send-btn.aborting { background: #ef4444; color: #fff; }
  .chat-send-btn.aborting:hover:not(:disabled) { background: #dc2626; transform: scale(1.05); }
  .send-icon { font-size: 14px; line-height: 1; }
  .abort-icon { font-size: 12px; }

  @media (max-width: 640px) {
    .chat-messages { padding: 10px; }
  }
</style>
