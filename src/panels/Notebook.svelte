<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { OpenNotebookClient } from '../libs/notebook';
  import type { Notebook, Source, ONModel } from '../libs/notebook';
  import { renderToHTML, renderMath } from '../libs/render';
  import { saveToSiyuan, openDoc } from '../libs/siyuan';
  import { buildNotebookConceptRequest, type NotebookConceptRequest } from '../libs/notebook-bridge';
  import type { SourceRef } from '../libs/types/concept';
  import { buildOpenNotebookLocator, sourceLocatorText } from '../libs/source-refs';
  import type { OpenNotebookLocator } from '../libs/source-refs';
  import { showMessage } from 'siyuan';

  export let plugin: any;
  export let sourceTarget: Partial<SourceRef> | null = null;
  export let openConceptsFromNotebook: (request: NotebookConceptRequest) => void = () => {};

  type ContextMode = 'off' | 'insights' | 'full';

  let client: OpenNotebookClient | null = null;
  let notebooks: Notebook[] = [];
  let selectedNbId = '';
  let sources: Source[] = [];
  let notes: any[] = [];
  let sourceModes: Record<string, ContextMode> = {};
  let noteModes: Record<string, string> = {};
  let loading = false;

  let models: ONModel[] = [];
  let selectedModel = '';

  let sessions: any[] = [];
  let currentSessionId = '';
  let messages: any[] = [];
  let inputText = '';
  let sending = false;
  let tokenCount = 0;
  let charCount = 0;
  let appliedSourceTargetKey = '';
  let activeSourceLocator: OpenNotebookLocator | null = null;

  onMount(async () => {
    const cfg = plugin.getConfig();
    if (!cfg.notebookEndpoint) { showMessage('请先配置 Open Notebook 端点'); return; }
    client = new OpenNotebookClient(cfg.notebookEndpoint);
    try {
      const [nbs, allModels] = await Promise.all([
        client.listNotebooks(),
        client.getModels(),
      ]);
      notebooks = nbs;
      // 只保留 language 类型模型（过滤 embedding）
      models = allModels.filter((m: any) => m.type === 'language');
      // 默认选 default_chat_model
      try {
        const defs = await client.getDefaultModels();
        const defaultId = defs.default_chat_model;
        if (models.find((m: any) => m.id === defaultId)) selectedModel = defaultId;
        else if (models.length > 0) selectedModel = models[0].id;
      } catch {
        if (models.length > 0) selectedModel = models[0].id;
      }
      const nb = notebooks.find(n => n.source_count > 0) || notebooks[0];
      if (nb) { selectedNbId = nb.id; await loadAll(); }
    } catch (e: any) { showMessage('连接失败: ' + e.message); }
  });

  async function loadAll() {
    if (!client || !selectedNbId) return;
    loading = true;
    sourceModes = {}; noteModes = {}; messages = [];
    try {
      const [srcs, nts, sess] = await Promise.all([
        client.listSources(selectedNbId),
        client.listNotes(selectedNbId),
        client.listSessions(selectedNbId),
      ]);
      sources = srcs; notes = nts; sessions = sess;
      if (sess.length > 0) selectSession(sess[0].id);
    } catch { sources = []; notes = []; sessions = []; }
    loading = false;
  }

  async function onNbChange(e: Event) {
    selectedNbId = (e.target as HTMLSelectElement).value;
    currentSessionId = '';
    await loadAll();
  }

  function cycleMode(id: string) {
    const cur = sourceModes[id] || 'off';
    const next: ContextMode = cur === 'off' ? 'full' : cur === 'full' ? 'insights' : 'off';
    sourceModes[id] = next;
    sourceModes = Object.assign({}, sourceModes);
  }

  function modeLabel(m: ContextMode): string {
    return m === 'full' ? '全文' : m === 'insights' ? '摘要' : '关';
  }

  function modeClass(m: ContextMode): string {
    return m === 'full' ? 'm-full' : m === 'insights' ? 'm-insights' : 'm-off';
  }

  function setAll(mode: ContextMode) {
    const sm: Record<string, ContextMode> = {};
    sources.forEach(s => sm[s.id] = mode);
    sourceModes = sm;
  }

  function toggleNote(noteId: string) {
    noteModes[noteId] = noteModes[noteId] === 'full' ? 'off' : 'full';
    noteModes = Object.assign({}, noteModes);
  }

  async function selectSession(id: string) {
    currentSessionId = id;
    if (!client) return;
    try {
      const sess = await client.getSession(id);
      messages = sess.messages || [];
      // 同步该会话的模型覆写，没有则回默认
      if (sess.model_override && models.find((m: any) => m.id === sess.model_override)) {
        selectedModel = sess.model_override;
      } else if (models.length > 0) {
        selectedModel = models[0].id;
      }
    } catch { messages = []; }
  }

  async function newSession() {
    if (!client) return;
    try {
      const s = await client.createSession(selectedNbId, undefined, selectedModel);
      sessions = [s, ...sessions];
      currentSessionId = s.id;
      messages = [];
    } catch (e: any) { showMessage('创建失败'); }
  }

  async function renameSession(id: string) {
    const title = prompt('新名称');
    if (!title || !client) return;
    try {
      await client.request('PUT', '/chat/sessions/' + id, { title });
      sessions = sessions.map(s => s.id === id ? { ...s, title } : s);
    } catch { showMessage('重命名失败'); }
  }

  function delSession(id: string) {
    if (!client) return;
    client.deleteSession(id).then(() => {
      sessions = sessions.filter(s => s.id !== id);
      if (currentSessionId === id) { currentSessionId = ''; messages = []; }
    });
  }

  function copyText(content: string) {
    navigator.clipboard.writeText(content).then(() => showMessage('已复制'));
  }

  function clearSourceLocator() {
    activeSourceLocator = null;
  }

  function generateCandidatesFromContext() {
    const request = buildNotebookConceptRequest({
      inputText,
      activeLocator: activeSourceLocator,
      sourceModes,
      noteModes,
      autoRun: true,
    });
    if (!request) {
      showMessage('请先选择来源或输入一个问题');
      return;
    }
    openConceptsFromNotebook(request);
  }

  async function saveNote(content: string) {
    try {
      const docId = await saveToSiyuan(content);
      if (docId) {
        showMessage('已保存到思源');
        openDoc(docId, plugin.app);
      }
    } catch (e: any) { showMessage('保存失败: ' + e.message); }
  }

  async function regenerate() {
    const rev = [...messages].reverse();
    const lastHuman = rev.find(m => m.type === 'human');
    if (!lastHuman || !client || !currentSessionId) return;
    sending = true;
    try {
      const ctx = await buildCtx();
      const resp = await client.sendMessage(currentSessionId, lastHuman.content, ctx, selectedModel);
      messages = resp.messages || [];
    } catch (e: any) { showMessage('重试失败'); }
    sending = false;
  }

  async function buildCtx() {
    if (!client) return {};
    const srcIds = Object.entries(sourceModes).filter(([,m]) => m !== 'off').map(([id]) => id);
    const noteIds = Object.entries(noteModes).filter(([,m]) => m === 'full').map(([id]) => id);
    if (srcIds.length === 0 && noteIds.length === 0) return {};
    const result = await client.buildContext(selectedNbId, srcIds, {
      sourceModes,
      noteIds,
      noteModes,
    });
    tokenCount = result.tokenCount; charCount = result.charCount;
    return result.context;
  }

  async function send() {
    if (!inputText.trim() || !client || sending) return;
    sending = true;
    const text = inputText.trim();
    inputText = '';
    messages = [...messages, { id: 'u' + Date.now(), type: 'human', content: text }];
    try {
      let sid = currentSessionId;
      if (!sid) {
        const s = await client.createSession(selectedNbId, text.slice(0, 50), selectedModel);
        sessions = [s, ...sessions];
        sid = s.id;
        currentSessionId = sid;
      }
      const ctx = await buildCtx();
      const resp = await client.sendMessage(sid, text, ctx, selectedModel);
      messages = resp.messages || messages;
    } catch (e: any) { showMessage('发送失败: ' + e.message); }
    sending = false;
  }

  function keydown(e: KeyboardEvent) {
    // Ctrl+Enter 或 Cmd+Enter 发送
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  }

  // 自动滚动
  let msgListEl: HTMLElement;
  afterUpdate(() => {
    if (msgListEl) {
      msgListEl.scrollTop = msgListEl.scrollHeight;
      renderMath(msgListEl);
    }
  });

  $: srcStats = sources.reduce((a, s) => {
    const m = sourceModes[s.id] || 'off';
    if (m !== 'off') { a.count++; if (m === 'full') a.full++; else a.insights++; }
    return a;
  }, { count: 0, full: 0, insights: 0 });
  $: noteStats = Object.values(noteModes).filter(m => m === 'full').length;
  $: hasCtx = srcStats.count > 0 || noteStats > 0;
  $: {
    sources;
    applyIncomingSourceTarget(sourceTarget);
  }

  function applyIncomingSourceTarget(target: Partial<SourceRef> | null) {
    const openNotebookLocator = buildOpenNotebookLocator(target || {});
    if (target && openNotebookLocator) {
      if (
        target.sourceId &&
        sources.some((source) => source.id === target.sourceId) &&
        sourceModes[target.sourceId] !== 'full'
      ) {
        sourceModes = { ...sourceModes, [target.sourceId]: 'full' };
      }
      if (openNotebookLocator.key !== appliedSourceTargetKey || !activeSourceLocator) {
        appliedSourceTargetKey = openNotebookLocator.key;
        activeSourceLocator = openNotebookLocator;
        inputText = openNotebookLocator.prompt;
        showMessage('已定位到 OpenNotebook 来源');
      }
      return;
    }
    if (!target) return;
  }
</script>

<div class="nb-panel">
  {#if !client}
    <div class="nb-empty">未配置 Open Notebook 端点</div>
  {:else}
    <div class="nb-layout">
      <!-- 左栏 -->
      <div class="nb-left">
        <div class="nb-section">
          <div class="nb-label">笔记本</div>
          <select class="b3-select" value={selectedNbId} aria-label="笔记本" on:change={onNbChange}>
            {#each notebooks as nb (nb.id)}
              <option value={nb.id}>{nb.name} ({nb.source_count})</option>
            {/each}
          </select>
        </div>

        <div class="nb-section">
          <div class="nb-src-header">
            <div class="nb-label">来源 ({sources.length})</div>
            <div class="nb-src-actions">
              <button class="nb-link" on:click={() => setAll('full')}>全开</button>
              <button class="nb-link" on:click={() => setAll('off')}>全关</button>
            </div>
          </div>
          {#if loading}
            <div class="nb-hint">加载中...</div>
          {:else if sources.length === 0}
            <div class="nb-hint">暂无来源</div>
          {:else}
            <div class="nb-src-list">
              {#each sources as src (src.id)}
                <div class="nb-src-row" class:nb-src-row--located={activeSourceLocator?.sourceId === src.id}>
                  <span class="nb-src-name">{src.title}</span>
                  <button class="nb-mode-btn {modeClass(sourceModes[src.id] || 'off')}" on:click={() => cycleMode(src.id)}>
                    {modeLabel(sourceModes[src.id] || 'off')}
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if hasCtx}
          <div class="nb-stats">
            来源: {srcStats.count} (全文{srcStats.full} 摘要{srcStats.insights})
            {#if noteStats > 0} 笔记: {noteStats}{/if}
            {#if tokenCount > 0} Token: {tokenCount}{/if}
          </div>
        {/if}

        {#if notes.length > 0}
          <div class="nb-section">
            <div class="nb-label">笔记 ({notes.length})</div>
            <div class="nb-src-list">
              {#each notes as note (note.id)}
                <div class="nb-src-row">
                  <span class="nb-src-name">{note.title || '未命名'}</span>
                  <button class="nb-mode-btn {noteModes[note.id] === 'full' ? 'm-full' : 'm-off'}" on:click={() => toggleNote(note.id)}>
                    {noteModes[note.id] === 'full' ? '全文' : '关'}
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <!-- 右栏：聊天 -->
      <div class="nb-chat">
        <div class="nb-chat-top">
          <select class="b3-select nb-select-sm" bind:value={selectedModel} aria-label="聊天模型">
            <option value="">默认模型</option>
            {#each models as m (m.id)}<option value={m.id}>{m.name || m.id}</option>{/each}
          </select>
          <div class="nb-chat-top-actions">
            <button class="b3-button b3-button--small b3-button--text" on:click={generateCandidatesFromContext}>生成候选</button>
            <button class="b3-button b3-button--small b3-button--text" on:click={newSession}>+ 新会话</button>
          </div>
        </div>

        {#if sessions.length > 0}
          <div class="nb-sessions">
            {#each sessions as s (s.id)}
              <div class="nb-session" class:active-session={currentSessionId === s.id}>
                <button class="nb-session-title" type="button" on:click={() => selectSession(s.id)} on:dblclick={() => renameSession(s.id)}>{s.title || '未命名'}</button>
                <button class="nb-session-del" type="button" title="删除会话" on:click={() => delSession(s.id)}>×</button>
              </div>
            {/each}
          </div>
        {/if}

        {#if activeSourceLocator}
          <div class="nb-locator">
            <div class="nb-locator-main">
              <span class="nb-locator-kicker">OpenNotebook source</span>
              <span class="nb-locator-label">{activeSourceLocator.label}</span>
              {#if activeSourceLocator.quote}
                <q>{activeSourceLocator.quote}</q>
              {/if}
            </div>
            <div class="nb-locator-actions">
              <button class="nb-link" on:click={() => copyText(sourceLocatorText(sourceTarget || {}))}>复制</button>
              <button class="nb-link" on:click={clearSourceLocator}>关闭</button>
            </div>
          </div>
        {/if}

        <div class="nb-msg-list" bind:this={msgListEl}>
          {#if messages.length === 0 && !sending}
            <div class="nb-chat-empty">{hasCtx ? '已选 ' + srcStats.count + ' 个来源，开始提问' : '选择来源后开始对话'}</div>
          {/if}
          {#each messages as msg (msg.id)}
            <div class="nb-msg" class:nb-msg-ai={msg.type === 'ai'} class:nb-msg-human={msg.type === 'human'}>
              <div class="nb-msg-role">{msg.type === 'ai' ? 'AI' : '你'}</div>
              <div class="nb-msg-content">{@html renderToHTML(msg.content)}</div>
              {#if msg.type === 'ai'}
                <div class="nb-msg-actions">
                  <button class="nb-link" on:click={() => copyText(msg.content)}>复制</button>
                  <button class="nb-link" on:click={regenerate}>重新生成</button>
                  <button class="nb-link" on:click={() => saveNote(msg.content)}>保存到思源</button>
                </div>
              {/if}
            </div>
          {/each}
          {#if sending}
            <div class="nb-msg nb-msg-ai">
              <div class="nb-msg-role">AI</div>
              <div class="nb-msg-content nb-loading">思考中...</div>
            </div>
          {/if}
        </div>

        <!-- 上下文指示器 -->
        {#if hasCtx}
          <div class="nb-ctx-bar">
            <span>📄 {srcStats.count} 来源</span>
            {#if srcStats.insights > 0}<span>💡 {srcStats.insights} 摘要</span>{/if}
            {#if tokenCount > 0}<span>🔤 {tokenCount} token</span>{/if}
          </div>
        {/if}

        <div class="nb-input-area">
          <textarea class="b3-text-field" placeholder="Ctrl+Enter 发送" bind:value={inputText} rows="2" aria-label="聊天输入" on:keydown={keydown}></textarea>
          <button class="b3-button b3-button--outline" on:click={send} disabled={sending}>发送</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .nb-panel { height: 100%; overflow: hidden; }
  .nb-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--b3-theme-on-surface); font-size: var(--aio-fs-base); }
  .nb-layout { display: flex; height: 100%; }
  .nb-left { width: 250px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--b3-theme-surface-lighter); padding: 8px; gap: 8px; overflow-y: auto; }
  .nb-section { display: flex; flex-direction: column; gap: 4px; }
  .nb-label { font-size: var(--aio-fs-xs); font-weight: 600; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; }
  .nb-src-header { display: flex; justify-content: space-between; align-items: center; }
  .nb-src-actions { display: flex; gap: 6px; }
  .nb-link { font-size: var(--aio-fs-xs); border: none; background: none; color: var(--b3-theme-primary); cursor: pointer; }
  .nb-src-list { display: flex; flex-direction: column; gap: 2px; max-height: 250px; overflow-y: auto; }
  .nb-src-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 4px; border-radius: 4px; }
  .nb-src-row:hover { background: var(--b3-theme-surface-light); }
  .nb-src-row--located { background: var(--b3-theme-primary-lightest); outline: 1px solid var(--b3-theme-primary-light); }
  .nb-src-name { font-size: var(--aio-fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .nb-mode-btn { font-size: var(--aio-fs-xs); padding: 1px 6px; border-radius: 8px; border: 1px solid var(--b3-theme-surface-lighter); cursor: pointer; background: var(--b3-theme-surface); color: var(--b3-theme-on-surface); white-space: nowrap; }
  .m-full { background: var(--b3-card-success-background); color: var(--b3-card-success-color); border-color: var(--b3-card-success-border); }
  .m-insights { background: var(--b3-card-info-background); color: var(--b3-card-info-color); border-color: var(--b3-card-info-border); }
  .m-off { opacity: 0.4; }
  .nb-hint { font-size: var(--aio-fs-sm); opacity: 0.4; padding: 8px 0; text-align: center; }
  .nb-stats { display: flex; gap: 8px; flex-wrap: wrap; font-size: var(--aio-fs-xs); opacity: 0.5; padding: 4px 0; }
  .nb-chat { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .nb-chat-top { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--b3-theme-surface-lighter); gap: 8px; }
  .nb-chat-top-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .nb-select-sm { font-size: var(--aio-fs-sm) !important; padding: 2px 6px !important; }
  .nb-sessions { display: flex; gap: 4px; padding: 4px 10px; overflow-x: auto; border-bottom: 1px solid var(--b3-theme-surface-lighter); flex-shrink: 0; }
  .nb-session { display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 12px; border: 1px solid var(--b3-theme-surface-lighter); font-size: var(--aio-fs-xs); white-space: nowrap; background: none; color: var(--b3-theme-on-surface); }
  .nb-session:hover { background: var(--b3-theme-surface-light); }
  .active-session { background: var(--b3-theme-primary-lightest); border-color: var(--b3-theme-primary); }
  .nb-session-title { max-width: 120px; overflow: hidden; text-overflow: ellipsis; border: none; background: none; color: inherit; cursor: pointer; padding: 0; font: inherit; }
  .nb-session-del { border: none; background: none; color: inherit; cursor: pointer; padding: 0 2px; font: inherit; opacity: 0.6; }
  .nb-session-del:hover { opacity: 1; color: var(--b3-theme-error); }
  .nb-locator { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--b3-theme-surface-lighter); background: var(--b3-theme-primary-lightest); }
  .nb-locator-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--aio-fs-xs); }
  .nb-locator-kicker { color: var(--b3-theme-primary); font-weight: 600; }
  .nb-locator-label { color: var(--b3-theme-on-surface); word-break: break-all; }
  .nb-locator q { opacity: 0.72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .nb-locator-actions { display: flex; gap: 6px; flex-shrink: 0; }
  .nb-msg-list { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 12px; }
  .nb-chat-empty { text-align: center; padding: 40px 20px; font-size: var(--aio-fs-base); opacity: 0.4; }
  .nb-msg { max-width: 90%; }
  .nb-msg-human { align-self: flex-end; }
  .nb-msg-human .nb-msg-content { background: var(--b3-theme-primary-light); color: var(--b3-theme-primary); border-radius: 12px 12px 4px 12px; }
  .nb-msg-human .nb-msg-role { text-align: right; }
  .nb-msg-ai { align-self: flex-start; }
  .nb-msg-ai .nb-msg-content { background: var(--b3-theme-surface); border: 1px solid var(--b3-theme-surface-lighter); border-radius: 12px 12px 12px 4px; }
  .nb-msg-role { font-size: var(--aio-fs-xs); opacity: 0.4; margin-bottom: 2px; }
  .nb-msg-content { padding: 10px 14px; font-size: var(--aio-fs-base); line-height: 1.7; word-break: break-word; }
  .nb-msg-actions { display: flex; gap: 8px; margin-top: 4px; }
  .nb-loading { opacity: 0.5; }
  .nb-input-area { display: flex; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--b3-theme-surface-lighter); }
  .nb-input-area textarea { flex: 1; resize: none; }
  .nb-input-area button { flex-shrink: 0; }
</style>
