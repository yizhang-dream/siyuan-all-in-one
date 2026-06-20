<script lang="ts">
  import { onMount } from 'svelte';
  import { showMessage, confirm } from 'siyuan';
  import type { AppConfig, AgentConfig, Provider } from '../libs/types';
  import { genAgentId, genId } from '../libs/config';
  import { fetchProviderModels } from '../libs/llm';

  export let plugin: any;
  export let config: AppConfig;

  let providers: Provider[] = [];
  let flashcardProviderId = '';
  let flashcardModel = '';
  let mindmapProviderId = '';
  let mindmapModel = '';
  let notebookEndpoint = '';
  let cardsPerDay = 30;
  let defaultDeck = '';
  let agents: AgentConfig[] = [];

  // Provider 编辑状态
  let editingProvider: Provider | null = null;
  let isNewProvider = false;

  // Agent 编辑状态
  let editingAgent: AgentConfig | null = null;
  let isNewAgent = false;

  onMount(() => {
    providers = config.providers || [];
    flashcardProviderId = config.flashcardProviderId || '';
    flashcardModel = config.flashcardModel || '';
    mindmapProviderId = config.mindmapProviderId || '';
    mindmapModel = config.mindmapModel || '';
    notebookEndpoint = config.notebookEndpoint || '';
    cardsPerDay = config.cardsPerDay ?? 30;
    defaultDeck = config.defaultDeck || '';
    agents = config.agents || [];
  });

  async function save() {
    await plugin.saveConfig({
      providers,
      flashcardProviderId,
      flashcardModel,
      mindmapProviderId,
      mindmapModel,
      notebookEndpoint,
      cardsPerDay: Number(cardsPerDay),
      defaultDeck,
      agents,
    });
    showMessage('设置已保存');
  }

  // 获取指定 provider 的可用模型（从本地配置读，不联网）
  function getProviderModels(providerId: string): string[] {
    return providers.find((p) => p.id === providerId)?.models || [];
  }

  // 切换 Provider 时自动重置 Model 为该 Provider 的第一个模型
  function onFlashcardProviderChange(e: any) {
    flashcardProviderId = e.target.value;
    const models = getProviderModels(flashcardProviderId);
    flashcardModel = models[0] || '';
  }
  function onMindmapProviderChange(e: any) {
    mindmapProviderId = e.target.value;
    const models = getProviderModels(mindmapProviderId);
    mindmapModel = models[0] || '';
  }

  // ── Provider 管理 ──────────────────────────────

  function newProvider() {
    editingProvider = {
      id: genId(),
      name: '',
      baseUrl: '',
      apiKey: '',
      models: [],
      isBuiltIn: false,
    };
    isNewProvider = true;
  }

  function editProvider(p: Provider) {
    editingProvider = { ...p, models: [...p.models] };
    isNewProvider = false;
  }

  function saveProvider() {
    if (!editingProvider) return;
    if (!editingProvider.name.trim()) { showMessage('请输入 Provider 名称'); return; }
    if (!editingProvider.baseUrl.trim()) { showMessage('请输入 API 端点'); return; }

    if (isNewProvider) {
      providers = [...providers, editingProvider];
    } else {
      providers = providers.map((p) => (p.id === editingProvider!.id ? editingProvider! : p));
    }
    editingProvider = null;
    isNewProvider = false;
    save();
  }

  function deleteProvider(p: Provider) {
    if (p.isBuiltIn) { showMessage('内置 Provider 不可删除，但可编辑'); return; }
    confirm('⚠️', `确定删除 Provider「${p.name}」吗？`, () => {
      providers = providers.filter((x) => x.id !== p.id);
      // 如果删除的是当前选中的 provider，重置指针
      if (flashcardProviderId === p.id) { flashcardProviderId = providers[0]?.id || ''; flashcardModel = getProviderModels(flashcardProviderId)[0] || ''; }
      if (mindmapProviderId === p.id) { mindmapProviderId = providers[0]?.id || ''; mindmapModel = getProviderModels(mindmapProviderId)[0] || ''; }
      save();
    });
  }

  function cancelProviderEdit() {
    editingProvider = null;
    isNewProvider = false;
  }

  function handleProviderOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelProviderEdit();
  }

  // Provider 编辑器中的模型列表管理
  let newModelName = '';
  let isFetchingModels = false;
  let fetchedModels: string[] = [];

  function addModel() {
    if (!editingProvider || !newModelName.trim()) return;
    editingProvider.models = [...editingProvider.models, newModelName.trim()];
    newModelName = '';
  }
  function removeModel(idx: number) {
    if (!editingProvider) return;
    editingProvider.models = editingProvider.models.filter((_, i) => i !== idx);
  }
  async function fetchModels() {
    if (!editingProvider) return;
    if (!editingProvider.baseUrl.trim()) { showMessage('请先填写 API 端点'); return; }
    isFetchingModels = true;
    fetchedModels = [];
    try {
      const models = await fetchProviderModels(editingProvider);
      // 过滤掉已有的
      const existing = new Set(editingProvider.models);
      fetchedModels = models.filter((m) => !existing.has(m));
      if (fetchedModels.length === 0) {
        showMessage('没有新模型可添加（可能已全部添加）');
      } else {
        showMessage(`找到 ${fetchedModels.length} 个可用模型`);
      }
    } catch (e: any) {
      showMessage('获取失败：' + e.message);
    }
    isFetchingModels = false;
  }
  function addFetchedModel(m: string) {
    if (!editingProvider) return;
    if (!editingProvider.models.includes(m)) {
      editingProvider.models = [...editingProvider.models, m];
    }
    fetchedModels = fetchedModels.filter((x) => x !== m);
  }

  function handleFetchedModelKeydown(e: KeyboardEvent, m: string) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    addFetchedModel(m);
  }
  function addAllFetched() {
    if (!editingProvider) return;
    const existing = new Set(editingProvider.models);
    const toAdd = fetchedModels.filter((m) => !existing.has(m));
    editingProvider.models = [...editingProvider.models, ...toAdd];
    fetchedModels = [];
  }

  // ── Agent 管理（保持上一轮逻辑） ──────────────

  function newAgent() {
    editingAgent = {
      id: genAgentId(),
      name: '',
      prompt: '',
      suggestedCount: 10,
      language: 'zh-CN',
      style: '简洁',
      difficulty: '进阶',
      tokensPerCard: 400,
    };
    isNewAgent = true;
  }

  function editAgent(agent: AgentConfig) {
    editingAgent = { ...agent };
    isNewAgent = false;
  }

  function saveAgent() {
    if (!editingAgent) return;
    if (!editingAgent.name.trim()) { showMessage('请输入 Agent 名称'); return; }
    if (!editingAgent.prompt.trim()) { showMessage('请输入提示词'); return; }

    if (isNewAgent) {
      agents = [...agents, editingAgent];
    } else {
      agents = agents.map((a) => (a.id === editingAgent!.id ? editingAgent! : a));
    }
    editingAgent = null;
    isNewAgent = false;
    save();
  }

  function deleteAgent(agent: AgentConfig) {
    confirm('⚠️', `确定删除 Agent「${agent.name}」吗？`, () => {
      agents = agents.filter((a) => a.id !== agent.id);
      save();
    });
  }

  function cancelAgentEdit() {
    editingAgent = null;
    isNewAgent = false;
  }

  function handleAgentOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelAgentEdit();
  }
</script>

<div class="settings-panel">
  <!-- AI Provider 管理 -->
  <div class="settings-group">
    <div class="section-header">
      <h3>AI Provider 管理</h3>
      <button class="b3-button b3-button--small b3-button--outline" on:click={newProvider}>+ 新增</button>
    </div>
    <p class="settings-hint">配置一个或多个 AI 服务（OpenAI 兼容端点）。每个功能可独立选择不同的 Provider + 模型。</p>

    <div class="provider-list">
      {#each providers as p (p.id)}
        <div class="provider-item">
          <div class="provider-info">
            <span class="provider-name">
              {p.name}
              {#if p.isBuiltIn}<span class="provider-badge">内置</span>{/if}
              {#if p.apiKey}<span class="provider-badge provider-badge--ok">✓ 密钥</span>{/if}
            </span>
            <span class="provider-meta">
              {p.models.length > 0 ? `${p.models.length} 个模型` : '未配置模型'}
              {#if !p.apiKey} · <span class="warn-text">需密钥</span>{/if}
            </span>
          </div>
          <div class="provider-actions">
            <button class="b3-button b3-button--small" on:click={() => editProvider(p)}>编辑</button>
            {#if !p.isBuiltIn}
              <button class="b3-button b3-button--small provider-del" on:click={() => deleteProvider(p)}>删除</button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- 功能模型分配 -->
  <div class="settings-group">
    <h3>功能模型分配</h3>
    <p class="settings-hint">为每个 AI 功能选择对应的 Provider 和模型。</p>

    <div class="feature-assign">
      <div class="feature-block">
        <div class="feature-label">🎴 制卡</div>
        <div class="feature-row">
          <select class="b3-select" value={flashcardProviderId} on:change={onFlashcardProviderChange} aria-label="制卡 Provider">
            {#each providers as p}<option value={p.id}>{p.name}</option>{/each}
          </select>
          <select class="b3-select" bind:value={flashcardModel} aria-label="制卡模型">
            {#each getProviderModels(flashcardProviderId) as m}<option value={m}>{m}</option>{/each}
            {#if !getProviderModels(flashcardProviderId).includes(flashcardModel) && flashcardModel}
              <option value={flashcardModel}>{flashcardModel}</option>
            {/if}
          </select>
        </div>
      </div>

      <div class="feature-block">
        <div class="feature-label">🧠 思维导图</div>
        <div class="feature-row">
          <select class="b3-select" value={mindmapProviderId} on:change={onMindmapProviderChange} aria-label="思维导图 Provider">
            {#each providers as p}<option value={p.id}>{p.name}</option>{/each}
          </select>
          <select class="b3-select" bind:value={mindmapModel} aria-label="思维导图模型">
            {#each getProviderModels(mindmapProviderId) as m}<option value={m}>{m}</option>{/each}
            {#if !getProviderModels(mindmapProviderId).includes(mindmapModel) && mindmapModel}
              <option value={mindmapModel}>{mindmapModel}</option>
            {/if}
          </select>
        </div>
      </div>
    </div>
  </div>

  <!-- Open Notebook（独立） -->
  <div class="settings-group">
    <h3>知识库搜索（Open Notebook）</h3>
    <p class="settings-hint">Open Notebook 有独立的 REST API，不走上面的 Provider。留空则禁用。</p>
    <label for="settings-notebook-endpoint">搜索端点</label>
    <input id="settings-notebook-endpoint" class="b3-text-field" type="text" bind:value={notebookEndpoint} placeholder="http://localhost:5055" />
  </div>

  <!-- 复习设置 -->
  <div class="settings-group">
    <h3>复习设置</h3>
    <div class="feature-row">
      <div>
        <label for="settings-cards-per-day">每日新卡片上限</label>
        <input id="settings-cards-per-day" class="b3-text-field" type="number" bind:value={cardsPerDay} min="1" max="999" />
      </div>
      <div>
        <label for="settings-default-deck">默认牌组</label>
        <input id="settings-default-deck" class="b3-text-field" type="text" bind:value={defaultDeck} placeholder="默认" />
      </div>
    </div>
  </div>

  <!-- Agent 管理 -->
  <div class="settings-group">
    <div class="section-header">
      <h3>Agent 管理（制卡提示词）</h3>
      <button class="b3-button b3-button--small b3-button--outline" on:click={newAgent}>+ 新增</button>
    </div>
    <p class="settings-hint">Agent 决定 AI 如何生成卡片（提示词、语言、风格、难度）。</p>

    {#if agents.length === 0}
      <p class="empty-hint">还没有 Agent，点击「新增」创建</p>
    {:else}
      <div class="provider-list">
        {#each agents as agent (agent.id)}
          <div class="provider-item">
            <div class="provider-info">
              <span class="provider-name">{agent.name}</span>
              <span class="provider-meta">{agent.suggestedCount}张 · {agent.language} · {agent.style} · {agent.difficulty}</span>
            </div>
            <div class="provider-actions">
              <button class="b3-button b3-button--small" on:click={() => editAgent(agent)}>编辑</button>
              <button class="b3-button b3-button--small provider-del" on:click={() => deleteAgent(agent)}>删除</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <button class="b3-button b3-button--outline save-btn" on:click={save}>保存设置</button>
</div>

<!-- Provider 编辑弹窗 -->
{#if editingProvider}
<div class="overlay" on:click|self={cancelProviderEdit} on:keydown={handleProviderOverlayKeydown} role="button" tabindex="0" aria-label="关闭 Provider 编辑弹窗">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title">
    <h3 id="provider-dialog-title">{isNewProvider ? '新增 Provider' : '编辑 Provider'}</h3>

    <label for="provider-name">名称 *</label>
    <input id="provider-name" class="b3-text-field" type="text" bind:value={editingProvider.name} placeholder="如：DeepSeek、Ollama 本地" />

    <label for="provider-base-url">API 端点 *</label>
    <input id="provider-base-url" class="b3-text-field" type="text" bind:value={editingProvider.baseUrl} placeholder="https://api.deepseek.com/v1/chat/completions" />

    <label for="provider-api-key">API 密钥</label>
    <input id="provider-api-key" class="b3-text-field" type="text" bind:value={editingProvider.apiKey} placeholder="sk-...（本地模型可不填）" />

    <div class="dialog-label">模型列表</div>
    <div class="model-list-editor">
      <!-- 已有模型 -->
      {#each editingProvider.models as m, idx}
        <div class="model-row">
          <span class="model-name">{m}</span>
          <button class="b3-button b3-button--small b3-button--text" on:click={() => removeModel(idx)}>✕</button>
        </div>
      {/each}

      <!-- 获取模型列表按钮 -->
      <div class="model-fetch-area">
        <button class="b3-button b3-button--small b3-button--outline" on:click={fetchModels} disabled={isFetchingModels}>
          {isFetchingModels ? '获取中...' : '🔄 从 API 获取模型列表'}
        </button>
        {#if fetchedModels.length > 0}
          <button class="b3-button b3-button--small b3-button--text" on:click={addAllFetched}>全部添加</button>
        {/if}
      </div>

      <!-- 获取到的模型（待选择添加） -->
      {#if fetchedModels.length > 0}
        <div class="fetched-models">
          {#each fetchedModels as m}
            <button type="button" class="fetched-model-row" on:click={() => addFetchedModel(m)} on:keydown={(e) => handleFetchedModelKeydown(e, m)}>
              <span>{m}</span>
              <span class="add-icon">+ 添加</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- 手动添加 -->
      <div class="model-add-row">
        <input class="b3-text-field" type="text" bind:value={newModelName} placeholder="手动输入模型名（如 deepseek-chat）" on:keydown={(e) => { if (e.key === 'Enter') addModel(); }} />
        <button class="b3-button b3-button--small b3-button--outline" on:click={addModel}>手动添加</button>
      </div>
    </div>

    <div class="dialog-actions">
      <button class="b3-button b3-button--outline" on:click={cancelProviderEdit}>取消</button>
      <button class="b3-button b3-button--text" on:click={saveProvider}>保存</button>
    </div>
  </div>
</div>
{/if}

<!-- Agent 编辑弹窗 -->
{#if editingAgent}
<div class="overlay" on:click|self={cancelAgentEdit} on:keydown={handleAgentOverlayKeydown} role="button" tabindex="0" aria-label="关闭 Agent 编辑弹窗">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="agent-dialog-title">
    <h3 id="agent-dialog-title">{isNewAgent ? '新增 Agent' : '编辑 Agent'}</h3>

    <label for="agent-name">名称 *</label>
    <input id="agent-name" class="b3-text-field" type="text" bind:value={editingAgent.name} placeholder="如：物理概念卡、医学记忆卡" />

    <label for="agent-prompt">提示词（System Prompt）*</label>
    <textarea id="agent-prompt" class="b3-text-field prompt-area" bind:value={editingAgent.prompt} rows="8"
      placeholder={"你是一个专业的知识卡片生成助手。请围绕主题 {topic} 生成 {count} 张卡片。\n\n要求：\n- 语言：{language}\n- 风格：{style}\n- 难度：{difficulty}\n- 问题清晰，答案准确\n- 如有上下文，参考：{context}"}></textarea>
    <p class="prompt-hint">
      支持占位符：<code>{'{topic}'}</code> <code>{'{count}'}</code> <code>{'{language}'}</code> <code>{'{style}'}</code> <code>{'{difficulty}'}</code> <code>{'{context}'}</code>
    </p>

    <div class="dialog-row">
      <div>
        <label for="agent-suggested-count">建议数量</label>
        <input id="agent-suggested-count" class="b3-text-field" type="number" bind:value={editingAgent.suggestedCount} min="1" max="30" />
      </div>
      <div>
        <label for="agent-language">语言</label>
        <select id="agent-language" class="b3-select" bind:value={editingAgent.language}>
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="auto">自动</option>
        </select>
      </div>
    </div>

    <div class="dialog-row">
      <div>
        <label for="agent-style">风格</label>
        <select id="agent-style" class="b3-select" bind:value={editingAgent.style}>
          <option value="简洁">简洁</option>
          <option value="详细">详细</option>
          <option value="口语化">口语化</option>
          <option value="学术">学术</option>
        </select>
      </div>
      <div>
        <label for="agent-difficulty">难度</label>
        <select id="agent-difficulty" class="b3-select" bind:value={editingAgent.difficulty}>
          <option value="基础">基础</option>
          <option value="进阶">进阶</option>
          <option value="挑战">挑战</option>
        </select>
      </div>
    </div>

    <label for="agent-tokens-per-card">每张卡 Token 预算</label>
    <input id="agent-tokens-per-card" class="b3-text-field" type="number" bind:value={editingAgent.tokensPerCard} min="100" max="5000" />
    <p class="settings-hint">概念类约 300，计算/推导类约 600-1200，真题类约 1800</p>

    <div class="dialog-actions">
      <button class="b3-button b3-button--outline" on:click={cancelAgentEdit}>取消</button>
      <button class="b3-button b3-button--text" on:click={saveAgent}>保存</button>
    </div>
  </div>
</div>
{/if}

<style lang="scss">
  .settings-panel { padding: 24px; height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
  .settings-group {
    display: flex; flex-direction: column; gap: 6px;
    h3 { font-size: var(--aio-fs-base); margin: 0; color: var(--b3-theme-primary); }
    label { font-size: var(--aio-fs-sm); font-weight: 500; margin-top: 4px; }
  }
  .settings-hint { font-size: var(--aio-fs-xs); opacity: 0.5; margin: 0; }
  .empty-hint { font-size: var(--aio-fs-base); opacity: 0.4; text-align: center; padding: 16px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; }

  .provider-list { display: flex; flex-direction: column; gap: 6px; }
  .provider-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 6px;
  }
  .provider-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .provider-name { font-size: var(--aio-fs-base); font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .provider-badge { font-size: var(--aio-fs-xs); padding: 1px 6px; border-radius: 3px; background: var(--b3-theme-surface-lighter); font-weight: 400; }
  .provider-badge--ok { background: var(--b3-theme-primary-lighter); color: var(--b3-theme-primary); }
  .provider-meta { font-size: var(--aio-fs-xs); opacity: 0.5; }
  .warn-text { color: var(--b3-card-warning-color); }
  .provider-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .provider-del { color: var(--b3-card-error-color) !important; }

  .feature-assign { display: flex; flex-direction: column; gap: 12px; }
  .feature-block { display: flex; flex-direction: column; gap: 4px; }
  .feature-label { font-size: var(--aio-fs-base); font-weight: 500; }
  .feature-row { display: flex; gap: 8px;
    .b3-select { flex: 1; }
    > div { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  }

  .save-btn { margin-top: 8px; align-self: flex-start; }

  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 999; }
  .dialog {
    background: var(--b3-theme-background); border-radius: 8px; padding: 20px;
    width: 600px; max-width: 90vw; max-height: 85vh; overflow-y: auto;
    display: flex; flex-direction: column; gap: 6px;
    h3 { margin: 0 0 8px; }
    label { font-size: var(--aio-fs-sm); font-weight: 500; margin-top: 8px; }
  }
  .model-list-editor { display: flex; flex-direction: column; gap: 4px; }
  .model-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: var(--b3-theme-surface-lighter); border-radius: 4px; font-size: var(--aio-fs-sm); }
  .model-name { font-family: var(--b3-font-family-code, monospace); }
  .model-fetch-area { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
  .fetched-models { max-height: 200px; overflow-y: auto; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 4px; margin: 4px 0; }
  .fetched-model-row { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 4px 10px; border: 0; background: transparent; color: inherit; cursor: pointer; font-size: var(--aio-fs-sm); font-family: var(--b3-font-family-code, monospace); text-align: left;
    &:hover { background: var(--b3-theme-primary-lightest); }
    .add-icon { font-size: var(--aio-fs-xs); color: var(--b3-theme-primary); opacity: 0.7; }
  }
  .dialog-label { font-size: var(--aio-fs-sm); font-weight: 500; margin-top: 8px; }
  .model-add-row { display: flex; gap: 6px; margin-top: 4px; .b3-text-field { flex: 1; } }
  .prompt-area { font-family: var(--b3-font-family-code, monospace); font-size: var(--aio-fs-sm) !important; line-height: 1.6; }
  .prompt-hint { font-size: var(--aio-fs-xs); opacity: 0.5; margin: 4px 0 0;
    code { background: var(--b3-theme-surface-lighter); padding: 1px 4px; border-radius: 3px; }
  }
  .dialog-row { display: flex; gap: 8px; > div { flex: 1; display: flex; flex-direction: column; gap: 4px; } }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
