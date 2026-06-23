<script lang="ts">
  import { onMount, onDestroy, tick, afterUpdate } from 'svelte';
  import { showMessage } from 'siyuan';
  // Use SiYuan's built-in Lute renderer (window.Lute) — no npm dependency needed
  import { VectorStore, getRagEmbedderProvider, resetEmbeddingProvider, ragQuery, ragContext, formatRagContext, buildRagConceptRequest } from '../libs/rag';
  import type { RagSearchResult, EmbeddingProvider } from '../libs/rag';
  import type { RagConceptRequest } from '../libs/rag';
  import { callLLM, resolveLLMConfig } from '../libs/llm';
  import type { ToolCall as LLMToolCall } from '../libs/llm';
  import {
    getAllTools, getEnabledTools, executeTool,
    TOOL_CATEGORIES,
    type ToolContext, type ToolDefinition, type ToolConfig, type AgentToolsConfig
  } from '../libs/tools';
  import { renderMath } from '../libs/render';
  import { getT } from '../libs/i18n';
  import { ConversationStore, type SessionIndex, type ChatMessage, type ContextDocument } from '../libs/conversation-store';

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

  // Embedder readiness status for UI display
  let embedderStatusText = '';
  $: {
    if (!embedder) {
      embedderStatusText = '加载中…';
    } else if (embedder.isReady()) {
      embedderStatusText = '向量就绪';
    } else {
      embedderStatusText = '不可用（回退关键词匹配）';
    }
  }

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

  // Tool selection
  let showToolDialog = false;
  let agentToolsConfig: AgentToolsConfig = {
    selectedTools: {},
    selectedToolsAsk: {},
  };

  async function loadAgentToolsConfig() {
    try {
      const data = await plugin.loadData('agent-tools-config');
      if (data?.selectedTools || data?.selectedToolsAsk) {
        agentToolsConfig = data;
      }
    } catch { /* ignore */ }
  }

  async function saveAgentToolsConfig() {
    await plugin.saveData('agent-tools-config', agentToolsConfig);
  }

  // Helper: get tool config for current mode
  function getCurrentToolConfig(): Record<string, ToolConfig> {
    return agentMode
      ? agentToolsConfig.selectedTools
      : agentToolsConfig.selectedToolsAsk;
  }

  // Helper: check if a tool is enabled for current mode
  function isToolEnabled(name: string): boolean {
    const cfg = getCurrentToolConfig()[name];
    return cfg === undefined || cfg.enabled;
  }

  // Helper: get tool autoApprove for current mode
  function getToolAutoApprove(name: string): boolean {
    const cfg = getCurrentToolConfig()[name];
    if (cfg !== undefined) return cfg.autoApprove;
    const allTools = getAllTools();
    const def = allTools.find(t => t.function.name === name);
    return def?.autoApprove ?? true;
  }

  // Toggle tool enabled/disabled
  function toggleTool(name: string) {
    const cfg = getCurrentToolConfig();
    const existing = cfg[name] || { enabled: true, autoApprove: true };
    cfg[name] = { ...existing, enabled: !existing.enabled };
    saveAgentToolsConfig();
  }

  // Toggle tool autoApprove
  function toggleToolAutoApprove(name: string) {
    const cfg = getCurrentToolConfig();
    const existing = cfg[name] || { enabled: true, autoApprove: true };
    cfg[name] = { ...existing, autoApprove: !existing.autoApprove };
    saveAgentToolsConfig();
  }

  // Category select-all / deselect-all
  function toggleCategory(category: string, enable: boolean) {
    const tools = TOOL_CATEGORIES[category]?.tools || [];
    const cfg = getCurrentToolConfig();
    for (const name of tools) {
      const existing = cfg[name] || { enabled: true, autoApprove: true };
      cfg[name] = { ...existing, enabled: enable };
    }
    saveAgentToolsConfig();
  }

  // Check if all tools in a category are enabled
  function isCategoryAllEnabled(category: string): boolean {
    const tools = TOOL_CATEGORIES[category]?.tools || [];
    return tools.length > 0 && tools.every(t => isToolEnabled(t));
  }

  // Check if any tool in a category is enabled
  function isCategoryAnyEnabled(category: string): boolean {
    const tools = TOOL_CATEGORIES[category]?.tools || [];
    return tools.some(t => isToolEnabled(t));
  }

  // Tool list helpers
  let expandedTools: Record<string, boolean> = {};
  let showCategoryFilter = false;
  let visibleCategories: Set<string> = new Set(Object.keys(TOOL_CATEGORIES));

  function toggleExpandTool(name: string) {
    expandedTools = { ...expandedTools, [name]: !expandedTools[name] };
  }

  function toggleVisibleCategory(catKey: string) {
    const newSet = new Set(visibleCategories);
    if (newSet.has(catKey)) newSet.delete(catKey);
    else newSet.add(catKey);
    visibleCategories = newSet;
  }

  function getAllToolNames(): string[] {
    return Object.values(TOOL_CATEGORIES).flatMap(cat => cat.tools);
  }

  function calcSelectedCount(): number {
    const cfg = getCurrentToolConfig();
    return getAllToolNames().filter(t => {
      const tc = cfg[t];
      return tc === undefined || tc.enabled;
    }).length;
  }

  function calcTotalCount(): number {
    return getAllToolNames().length;
  }

  // Select/deselect all tools
  function selectAllTools() {
    const names = getAllToolNames();
    const allSelected = names.every(t => isToolEnabled(t));
    const cfg = getCurrentToolConfig();
    for (const name of names) {
      const existing = cfg[name] || { enabled: true, autoApprove: true };
      cfg[name] = { ...existing, enabled: !allSelected };
    }
    saveAgentToolsConfig();
  }

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

    await loadAgentToolsConfig();

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

      // Build full conversation history for LLM (multi-turn)
      const llmMessages = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      let finalContent = '';
      let contextDocuments: ContextDocument[] = [];
      let localDisplayMessages: ChatMessage[] = [...messages]; // local copy for rendering

      if (agentMode) {
        // ── Agent mode: copilot-style agent loop ────────────────
        const systemPrompt = `你是一个知识助手，可以使用工具来检索信息、查询数据库和创建笔记。请始终使用 Markdown 格式回复，包括但不限于：
- 使用 **加粗** 突出重点
- 使用 \`代码块\` 展示代码
- 使用 - 或 1. 创建列表
- 使用 ### 标题组织内容
- 使用 > 引用原文

你可以使用以下工具：
1. rag_search — 搜索已导入的文档知识库
2. sql_query — 查询思源笔记数据库
3. get_block_content — 获取思源笔记块内容
4. create_note — 创建新笔记

每次调用工具后，我会把结果反馈给你。请根据结果决定下一步行动或给出最终答案。`;

        agentAbortController = new AbortController();
        const enabledTools = getEnabledTools(agentToolsConfig.selectedTools);
        let shouldContinue = true;

        // Add system message
        llmMessages.unshift({ role: 'system', content: systemPrompt });

        for (; shouldContinue; ) {
          if (agentAbortController?.signal.aborted) break;
          if (requestId !== activeRequestId) break;

          const response = await callLLM(llmMessages, llmConfig, {
            tools: enabledTools,
            abortSignal: agentAbortController!.signal,
          });

          const { content, toolCalls } = response;

          if (!toolCalls || toolCalls.length === 0) {
            // NO tool calls → agent finished, use content as final answer
            shouldContinue = false;
            finalContent = content ?? '';

            // Add assistant message to LLM history
            llmMessages.push({ role: 'assistant', content: finalContent });

            break;
          }

          // Add assistant message with tool_calls to LLM history
          llmMessages.push({
            role: 'assistant',
            content: content || '',
            tool_calls: toolCalls.map(tc => ({ ...tc, type: 'function' as const })),
          });

          // Build display message for tool calls
          const displayToolCalls = toolCalls.map(tc => ({
            ...tc,
            _expanded: false,
            _result: undefined as string | undefined,
          }));

          localDisplayMessages.push({
            id: 'a' + Date.now(),
            role: 'assistant',
            content: content || '',
            tool_calls: displayToolCalls as any,
          });
          activeMessages = [...localDisplayMessages];
          await tick();
          scrollToBottom(true);

          // Execute each tool and add results
          const toolCtx: ToolContext = { plugin, vectorStore: store, embedder };
          for (const tc of toolCalls) {
            if (agentAbortController?.signal.aborted) break;
            if (requestId !== activeRequestId) break;

            const toolResult = await executeTool(tc, toolCtx);

            // Add tool result to LLM history
            llmMessages.push({
              role: 'tool' as any,
              tool_call_id: tc.id,
              content: toolResult,
            });

            // Add tool result to local display (pair with tool call by id)
            localDisplayMessages.push({
              id: 't' + Date.now(),
              role: 'tool',
              content: toolResult,
              tool_call_id: tc.id,
              name: tc.function.name,
            });

            // Update the tool call display with result
            const lastAssistantMsg = localDisplayMessages[localDisplayMessages.length - 2];
            if (lastAssistantMsg?.tool_calls) {
              const tcd = (lastAssistantMsg.tool_calls as any[]).find(x => x.id === tc.id);
              if (tcd) tcd._result = toolResult;
            }

            // Extract context documents from rag_search results
            if (tc.function.name === 'rag_search') {
              try {
                const parsed = JSON.parse(toolResult);
                if (parsed.results) {
                  contextDocuments = parsed.results.map((r: any) => ({
                    sourceId: r.source || '',
                    title: r.source || '知识库',
                    chunkText: (r.text || '').substring(0, 80),
                    score: r.score || 0,
                  }));
                }
              } catch { /* ignore parse errors */ }
            }

            activeMessages = [...localDisplayMessages];
            await tick();
            scrollToBottom(true);
          }
        }

        // Save final assistant message with context documents.
        // Always persist even if content is empty (some APIs return content:null with finish_reason:stop),
        // so the UI always shows the final answer slot.
        await conversationStore.addMessage(activeSessionId, {
          id: 'a' + Date.now(),
          role: 'assistant',
          content: finalContent,
          contextDocuments,
        });
        // Add the persisted message to local display so tool calls remain visible
        localDisplayMessages.push({
          id: 'a-final-' + Date.now(),
          role: 'assistant',
          content: finalContent,
          contextDocuments,
        });
        activeMessages = [...localDisplayMessages];
        await tick();
        scrollToBottom(true);
      } else {
        // ── Normal (non-agent) mode ────────────────────────────
        // RAG retrieval
        const sourceIds = activeSession?.sourceIds || [];
        const results = await ragQuery(text, store, embedder, {
          topK: config?.ragTopK || 5,
          sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
        });
        if (requestId !== activeRequestId) return;
        const ctx = formatRagContext(results);

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

        llmMessages.unshift({ role: 'system', content: systemPrompt });
        const aiContent = await callLLM(llmMessages, llmConfig);
        finalContent = aiContent;

        if (requestId !== activeRequestId) return;

        contextDocuments = results.map(r => ({
          sourceId: r.chunk.sourceId,
          title: r.chunk.metadata?.fileName || r.chunk.metadata?.title || '来源',
          chunkText: r.chunk.text.substring(0, 80),
          score: r.score,
        }));

        await conversationStore.addMessage(activeSessionId, {
          id: 'a' + Date.now(),
          role: 'assistant',
          content: finalContent,
          sources: results,
          contextDocuments,
        });
      }
      if (requestId !== activeRequestId) return;

      // Auto-title: if this is the first message, generate title
      if (messages.length === 1) {
        const title = text.trim().split('\n')[0].substring(0, 30) || '新对话';
        renameSession(activeSessionId, title);
      }

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

  let agentAbortController: AbortController | null = null;

  function abortSend() {
    if (agentAbortController) {
      agentAbortController.abort();
      agentAbortController = null;
    }
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
        <span class="chat-embedder-badge" title="嵌入模型状态" class:ready={embedder?.isReady()}>
          {embedderStatusText}
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
          <button class="agent-tool-btn" title="工具选择"
                  on:click|stopPropagation={() => showToolDialog = !showToolDialog}
                  tabindex="-1">⚙️</button>
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
              {#if msg.tool_calls?.length}
                <div class="msg-tool-calls">
                  <div class="tool-calls-header">🔧 调用工具 ({msg.tool_calls.length})</div>
                  {#each msg.tool_calls as tc}
                    <div class="tool-call-item">
                      <div class="tool-call-name" on:click={() => { tc._expanded = !tc._expanded; }}
                           role="button" tabindex="0"
                           on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tc._expanded = !tc._expanded; } }}>
                        <span class="tool-call-icon">{tc._result ? '✓' : '◷'}</span>
                        {tc.function?.name || tc.name}
                      </div>
                      {#if tc._expanded}
                        <pre class="tool-call-params">{(() => { try { return JSON.stringify(JSON.parse(tc.function?.arguments || '{}'), null, 2); } catch { return tc.function?.arguments || '{}'; } })()}</pre>
                        {#if tc._result}
                          <div class="tool-call-result-label">结果</div>
                          <pre class="tool-call-result">{tc._result}</pre>
                        {/if}
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
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
            <svg class="send-icon"><use xlink:href="#iconPause"></use></svg>
          {:else}
            <svg class="send-icon"><use xlink:href="#iconUp"></use></svg>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Tool selection dialog -->
{#if showToolDialog}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="tool-dialog-overlay" on:click={() => showToolDialog = false}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="tool-dialog" on:click|stopPropagation>
      <div class="tool-dialog-header">
        <h3 class="tool-dialog-title">工具选择</h3>
        <div class="tool-dialog-header-actions">
          <button class="tool-header-btn" on:click={selectAllTools} title="刷新">
            <svg class="tool-header-icon"><use xlink:href="#iconRefresh"></use></svg>
          </button>
          <button class="tool-header-btn tool-close-btn" on:click={() => showToolDialog = false} title="关闭">
            <svg class="tool-header-icon"><use xlink:href="#iconClose"></use></svg>
          </button>
        </div>
      </div>
      <div class="tool-info-banner">
        提示：每个工具都有复杂的参数和特定的使用场景。请按需启用，避免不必要地消耗 token。
      </div>
      <div class="tool-dialog-body">
        {#each Object.entries(TOOL_CATEGORIES).filter(([k]) => visibleCategories.has(k)) as [catKey, cat]}
          <div class="tool-category">
            <div class="tool-category-header">
              <span class="tool-category-title">
                <svg class="cat-icon"><use xlink:href="#iconList"></use></svg>
                {cat.label}
                <span class="tool-category-count">({cat.tools.length})</span>
              </span>
              <button class="tool-category-select-all"
                      on:click={() => toggleCategory(catKey, !isCategoryAllEnabled(catKey))}>
                {isCategoryAllEnabled(catKey) ? '取消全选' : '全选'}
              </button>
            </div>
            <div class="tool-category-cards">
              {#each cat.tools as toolName}
                {@const allTools = getAllTools()}
                {@const def = allTools.find(t => t.function.name === toolName)}
                {#if def}
                  {@const displayName = def.function.displayName || def.function.name}
                  <div class="tool-item-card" class:tool-item-expanded={expandedTools[toolName]} class:selected={isToolEnabled(toolName)}>
                    <div class="tool-item-main">
                      <div class="tool-item-left">
                        <input type="checkbox" checked={isToolEnabled(toolName)}
                               on:change={() => toggleTool(toolName)} />
                        <div class="tool-item-info" on:click={() => toggleExpandTool(toolName)} role="button" tabindex="0"
                             on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpandTool(toolName); } }}>
                          <span class="tool-item-name">{displayName}</span>
                          <span class="tool-item-desc">{def.function.description}</span>
                        </div>
                      </div>
                      <div class="tool-item-right">
                        <label class="tool-approve-label" title="自动批准工具执行结果">
                          <span class="tool-approve-text">自动批准</span>
                          <label class="b3-switch">
                            <input type="checkbox" checked={getToolAutoApprove(toolName)}
                                   on:change={() => toggleToolAutoApprove(toolName)} />
                            <span class="b3-switch-slider"></span>
                          </label>
                        </label>
                        <span class="tool-item-arrow" class:expanded={expandedTools[toolName]}
                              on:click={() => toggleExpandTool(toolName)} role="button" tabindex="0"
                              on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpandTool(toolName); } }}>
                          <svg class="tool-arrow-icon"><use xlink:href="#iconRight"></use></svg>
                        </span>
                      </div>
                    </div>
                    {#if expandedTools[toolName]}
                      <div class="tool-item-detail">
                        <div class="tool-detail-desc">{def.function.description}</div>
                        {#if def.function.parameters?.required?.length}
                          <div class="tool-detail-label">必需参数：</div>
                          <div class="tool-detail-params">{def.function.parameters.required.join(', ')}</div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <div class="tool-dialog-footer">
        <span class="tool-footer-count">已选择: {calcSelectedCount()}/{calcTotalCount()}</span>
        <div class="tool-footer-right">
          <div class="tool-filter-wrap">
            <button class="tool-filter-btn" on:click|stopPropagation={() => showCategoryFilter = !showCategoryFilter} title="筛选分类">
              <svg class="tool-filter-icon"><use xlink:href="#iconFilter"></use></svg>
            </button>
            {#if showCategoryFilter}
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div class="tool-filter-dropdown" on:click|stopPropagation>
                {#each Object.entries(TOOL_CATEGORIES) as [catKey, cat]}
                  <label class="tool-filter-item">
                    <input type="checkbox" checked={visibleCategories.has(catKey)} on:change={() => toggleVisibleCategory(catKey)} />
                    <span>{cat.label}</span>
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

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
  .chat-embedder-badge {
    font-size: var(--aio-fs-xs); display: flex; align-items: center; gap: 3px;
    padding: 1px 6px; border-radius: 10px;
    background: var(--b3-card-warning-background, #fff3cd);
    color: var(--b3-card-warning-color, #856404);
    border: 1px solid var(--b3-card-warning-border, #ffc107);
    white-space: nowrap;
  }
  .chat-embedder-badge.ready {
    background: var(--b3-card-success-background, #d4edda);
    color: var(--b3-card-success-color, #155724);
    border-color: var(--b3-card-success-border, #c3e6cb);
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
    border-radius: 6px; border: none;
    background: var(--b3-theme-primary); color: var(--b3-theme-on-primary);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: all 0.2s ease;
  }
  .chat-send-btn:hover:not(:disabled) { transform: scale(1.05); }
  .chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .chat-send-btn.aborting { background: #ef4444; color: #fff; }
  .chat-send-btn.aborting:hover:not(:disabled) { background: #dc2626; transform: scale(1.05); }
  .send-icon { width: 16px; height: 16px; fill: currentColor; stroke: currentColor; }

  /* ── Agent tool button ─────────────────────────────── */
  .agent-tool-btn {
    background: none; border: none; cursor: pointer; font-size: 14px; line-height: 1;
    padding: 0 2px; opacity: 0.5; transition: opacity 0.2s;
  }
  .agent-tool-btn:hover { opacity: 1; }

  /* ── Tool calls in messages ────────────────────────── */
  .msg-tool-calls {
    margin: 8px 0;
    border: 1px solid var(--b3-border-color);
    border-radius: 6px;
    overflow: hidden;
    font-size: var(--aio-fs-sm);
  }
  .tool-calls-header {
    padding: 6px 10px;
    background: var(--b3-theme-surface-lighter);
    font-weight: 500;
  }
  .tool-call-item {
    border-top: 1px solid var(--b3-border-color);
  }
  .tool-call-item:first-child { border-top: none; }
  .tool-call-name {
    padding: 6px 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    user-select: none;
  }
  .tool-call-name:hover { background: var(--b3-theme-surface); }
  .tool-call-icon { font-size: 12px; width: 16px; text-align: center; }
  .tool-call-params, .tool-call-result {
    margin: 0;
    padding: 8px 12px;
    background: var(--b3-theme-background);
    font-size: 12px;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    border-top: 1px solid var(--b3-border-color);
  }
  .tool-call-params { font-family: var(--b3-font-family-code); }
  .tool-call-result-label {
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 500;
    color: var(--b3-theme-on-surface-light);
    background: var(--b3-theme-surface);
    border-top: 1px solid var(--b3-border-color);
  }

  /* ── Tool selection dialog ─────────────────────────── */
  .tool-dialog-overlay {
    position: fixed; top: 0; right: 0; bottom: 0; left: 0;
    background: rgba(0,0,0,0.3);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .tool-dialog {
    background: var(--b3-theme-background);
    border-radius: 10px;
    box-shadow: var(--b3-dialog-shadow);
    width: 520px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .tool-dialog-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--b3-border-color);
  }
  .tool-dialog-title {
    font-weight: 600;
    font-size: var(--aio-fs-base);
  }
  .tool-dialog-header-actions {
    display: flex; align-items: center; gap: 12px;
  }
  .tool-header-btn {
    background: none; border: none; cursor: pointer;
    font-size: var(--aio-fs-sm);
    color: var(--b3-theme-primary);
    padding: 4px 8px;
    border-radius: 4px;
    display: flex; align-items: center;
  }
  .tool-header-btn:hover { background: var(--b3-theme-surface-lighter); }
  .tool-close-btn { color: var(--b3-theme-on-surface); }
  .tool-header-icon { width: 16px; height: 16px; }

  /* Info banner */
  .tool-info-banner {
    padding: 8px 18px;
    background: var(--b3-theme-surface-lighter);
    border-bottom: 1px solid var(--b3-border-color);
    font-size: var(--aio-fs-xs);
    color: var(--b3-theme-on-surface-light);
    line-height: 1.5;
  }

  .tool-dialog-body {
    padding: 12px 18px;
    overflow-y: auto;
    flex: 1;
  }
  .tool-category {
    margin-bottom: 16px;
  }
  .tool-category:last-child { margin-bottom: 0; }
  .tool-category-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--b3-border-color);
  }
  .tool-category-header .tool-category-title {
    font-weight: 500;
    font-size: var(--aio-fs-sm);
    color: var(--b3-theme-on-surface);
    display: flex; align-items: center; gap: 6px;
  }
  .tool-category-title .cat-icon { width: 14px; height: 14px; flex-shrink: 0; }
  .tool-category-count {
    font-weight: 400;
    color: var(--b3-theme-on-surface-light);
    font-size: 11px;
  }
  .tool-category-select-all {
    background: none; border: none; cursor: pointer;
    font-size: var(--aio-fs-xs);
    color: var(--b3-theme-primary);
    padding: 2px 6px;
    border-radius: 3px;
  }
  .tool-category-select-all:hover { background: var(--b3-theme-surface-lighter); }

  .tool-category-cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tool-item-card {
    border: 1px solid var(--b3-border-color);
    border-radius: 8px;
    overflow: hidden;
    background: var(--b3-theme-surface);
    transition: border-color 0.15s;
  }
  .tool-item-card:hover { border-color: var(--b3-theme-primary-light); }
  .tool-item-card.tool-item-expanded { border-color: var(--b3-theme-primary-light); }
  .tool-item-card.selected { background: var(--b3-theme-primary-lightest); border-color: var(--b3-theme-primary); }

  .tool-item-main {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px;
    gap: 8px;
  }
  .tool-item-left {
    display: flex; align-items: center; gap: 10px;
    flex: 1; min-width: 0;
  }
  .tool-item-left input[type="checkbox"] { margin: 0; cursor: pointer; }
  .tool-item-info {
    display: flex; flex-direction: column;
    cursor: pointer; flex: 1; min-width: 0;
    gap: 1px;
  }
  .tool-item-name {
    font-weight: 500;
    font-size: var(--aio-fs-sm);
    white-space: nowrap;
  }
  .tool-item-desc {
    font-size: 11px;
    color: var(--b3-theme-on-surface-light);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tool-item-right {
    display: flex; align-items: center; gap: 6px;
    flex-shrink: 0;
  }
  .tool-approve-label {
    display: flex; align-items: center; gap: 4px;
    cursor: pointer; flex-shrink: 0;
    font-size: 11px;
    color: var(--b3-theme-on-surface-light);
  }
  .tool-approve-text { white-space: nowrap; }
  .tool-item-arrow {
    font-size: 10px;
    color: var(--b3-theme-on-surface-light);
    cursor: pointer;
    padding: 4px 2px;
    transition: transform 0.15s;
    user-select: none;
    display: flex;
    align-items: center;
  }
  .tool-arrow-icon { width: 14px; height: 14px; fill: currentColor; stroke: currentColor; }
  .tool-item-arrow.expanded {
    transform: rotate(90deg);
  }
  .tool-item-arrow:hover { color: var(--b3-theme-primary); }

  .tool-item-detail {
    border-top: 1px solid var(--b3-border-color);
    padding: 8px 12px;
    background: var(--b3-theme-surface-lighter);
    font-size: var(--aio-fs-xs);
  }
  .tool-detail-label {
    font-weight: 500;
    margin-bottom: 4px;
    color: var(--b3-theme-on-surface-light);
  }
  .tool-detail-desc {
    font-size: var(--aio-fs-xs);
    color: var(--b3-theme-on-surface);
    margin-bottom: 6px;
    line-height: 1.5;
  }
  .tool-detail-params {
    margin: 0;
    font-family: var(--b3-font-family-code);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 150px;
    overflow: auto;
  }

  /* Bottom bar */
  .tool-dialog-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 18px;
    border-top: 1px solid var(--b3-border-color);
    background: var(--b3-theme-surface);
  }
  .tool-footer-hint {
    font-size: var(--aio-fs-xs);
    color: var(--b3-theme-on-surface-light);
  }
  .tool-footer-count {
    font-size: var(--aio-fs-sm);
    font-weight: 500;
    color: var(--b3-theme-on-surface);
  }
  .tool-footer-right { position: relative; display: flex; align-items: center; }
  .tool-filter-wrap { position: relative; }
  .tool-filter-btn {
    background: none; border: 1px solid var(--b3-border-color);
    border-radius: 4px; cursor: pointer;
    padding: 4px; display: flex; align-items: center;
    color: var(--b3-theme-on-surface-light);
    transition: color 0.15s, border-color 0.15s;
  }
  .tool-filter-btn:hover { color: var(--b3-theme-primary); border-color: var(--b3-theme-primary); }
  .tool-filter-icon { width: 14px; height: 14px; fill: currentColor; stroke: currentColor; }
  .tool-filter-dropdown {
    position: absolute; bottom: 100%; right: 0;
    margin-bottom: 4px;
    background: var(--b3-theme-background);
    border: 1px solid var(--b3-border-color);
    border-radius: 6px;
    box-shadow: var(--b3-dialog-shadow);
    padding: 6px 0;
    z-index: 100;
    min-width: 140px;
  }
  .tool-filter-item {
    display: flex; align-items: center; gap: 6px;
    padding: 5px 12px; cursor: pointer;
    font-size: var(--aio-fs-sm);
    white-space: nowrap;
    user-select: none;
  }
  .tool-filter-item:hover { background: var(--b3-theme-surface-lighter); }
  .tool-filter-item input { margin: 0; cursor: pointer; }

  @media (max-width: 640px) {
    .chat-messages { padding: 10px; }
  }
</style>
