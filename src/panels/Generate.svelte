<script lang="ts">
  import { createCard } from '../libs/srs';
  import { generateFlashcards, resolveLLMConfig } from '../libs/llm';
  import type { GeneratedCard } from '../libs/llm';
  import type { AgentConfig } from '../libs/types';
  import { getT } from '../libs/i18n';
  import { fetchContext } from '../libs/sources';
  import type { SourceConfig } from '../libs/sources';
  import SourcePicker from './SourcePicker.svelte';
  import { showMessage } from 'siyuan';

  export let plugin: any;
  export let cardStore: any;
  export let config: any;

  const t = getT(plugin);

  let mode: 'manual' | 'ai' = 'manual';

  // 手动添加
  let manualQ = '';
  let manualA = '';
  let manualHint = '';
  let manualDeck = '';
  let manualTags = '';

  // AI 生成
  let aiTopic = '';
  let selectedAgentId = '';
  let aiCount = 10;
  let aiDeck = '';
  let aiTags = '';
  let aiStatus = '';
  let isGenerating = false;
  let previewCards: GeneratedCard[] = [];

  // 来源选择
  let sourceConfig: SourceConfig = { type: 'none' };

  $: {
    if (!manualDeck) manualDeck = config?.defaultDeck || '默认';
    if (!aiDeck) aiDeck = config?.defaultDeck || '默认';
  }

  // agent 列表从 config 读取
  $: agents = (config?.agents || []) as AgentConfig[];
  $: selectedAgent = agents.find((a) => a.id === selectedAgentId);

  function onAgentChange(e: any) {
    const id = e.target.value;
    selectedAgentId = id;
    const agent = agents.find((a) => a.id === id);
    if (agent) aiCount = agent.suggestedCount;
  }

  function addManual() {
    if (!manualQ.trim() || !manualA.trim()) {
      showMessage('请输入问题和答案');
      return;
    }
    const tags = manualTags.split(',').map((s) => s.trim()).filter(Boolean);
    const card = createCard(
      manualQ.trim(), manualA.trim(), manualHint.trim(),
      manualDeck.trim() || '默认', tags
    );
    cardStore.add(card);
    cardStore.save();
    showMessage('卡片已添加');
    manualQ = ''; manualA = ''; manualHint = ''; manualTags = '';
  }

  async function generateAI() {
    if (!aiTopic.trim()) { showMessage('请输入主题'); return; }
    if (!selectedAgent) { showMessage('请选择一个 Agent（在设置中创建）'); return; }

    const cfg = plugin.getConfig();
    const llmConfig = resolveLLMConfig(cfg, cfg.flashcardProviderId, cfg.flashcardModel);
    if (!llmConfig.endpoint) { showMessage('请先在设置中配置 AI Provider'); return; }

    const stats = cardStore.getStats();
    if (stats.new + aiCount > cfg.cardsPerDay) {
      showMessage(`今日新卡片已达上限（${cfg.cardsPerDay}），当前已有 ${stats.new} 张新卡片`);
      return;
    }

    isGenerating = true;
    previewCards = [];
    aiStatus = '正在准备...';

    try {
      // 1. 从选定的来源获取上下文
      let context: string | undefined;
      if (sourceConfig.type !== 'none') {
        aiStatus = sourceConfig.type === 'notebook' ? '正在搜索知识库...' :
                   sourceConfig.type === 'siyuan' ? '正在读取文档...' : '正在准备上下文...';
        context = await fetchContext(sourceConfig, cfg.notebookEndpoint);
        if (context) {
          aiStatus = `已获取 ${context.length} 字上下文，AI 生成中...`;
        } else {
          aiStatus = '未能获取上下文，将无上下文生成...';
        }
      }

      // 2. AI 生成（传入 agent）
      aiStatus = `AI 正在生成 ${aiCount} 张卡片（${selectedAgent.name}）...`;
      const cards = await generateFlashcards(
        aiTopic.trim(), aiCount, selectedAgent,
        llmConfig,
        context
      );

      // 3. 去重
      const before = cards.length;
      previewCards = cards.filter((c) => c.question && c.answer && !cardStore.isDuplicate(c.question));
      const deduped = before - previewCards.length;

      if (previewCards.length === 0) {
        aiStatus = `❌ 全部 ${before} 张已存在（去重 ${deduped} 张）`;
      } else {
        aiStatus = `✅ 生成 ${previewCards.length} 张${deduped > 0 ? `（去重 ${deduped}）` : ''}，请审核`;
      }
    } catch (e: any) {
      aiStatus = `❌ 生成失败：${e.message}`;
    }
    isGenerating = false;
  }

  function removePreview(idx: number) {
    previewCards = previewCards.filter((_, i) => i !== idx);
  }

  function editPreview(idx: number, field: 'question' | 'answer' | 'hint', value: string) {
    previewCards[idx][field] = value;
    previewCards = [...previewCards];
  }

  function confirmAddAll() {
    const tags = aiTags.split(',').map((s) => s.trim()).filter(Boolean);
    let added = 0;
    for (const c of previewCards) {
      if (!c.question || !c.answer) continue;
      const card = createCard(c.question, c.answer, c.hint || '', aiDeck.trim() || '默认', tags, selectedAgentId);
      cardStore.add(card);
      added++;
    }
    cardStore.save();
    showMessage(`已添加 ${added} 张卡片`);
    previewCards = [];
    aiStatus = '';
  }
</script>

<div class="gen-panel">
  <div class="gen-tabs">
    <button class="b3-button" class:b3-button--outline={mode !== 'manual'} on:click={() => mode = 'manual'}>手动添加</button>
    <button class="b3-button" class:b3-button--outline={mode !== 'ai'} on:click={() => mode = 'ai'}>AI 生成</button>
  </div>

  <!-- 手动添加 -->
  {#if mode === 'manual'}
    <div class="gen-form">
      <label for="manual-question">问题 *</label>
      <textarea id="manual-question" class="b3-text-field" bind:value={manualQ} rows="3" placeholder="输入问题..."></textarea>
      <label for="manual-answer">答案 *</label>
      <textarea id="manual-answer" class="b3-text-field" bind:value={manualA} rows="5" placeholder="输入答案... 公式用 $...$"></textarea>
      <label for="manual-hint">提示</label>
      <input id="manual-hint" class="b3-text-field" type="text" bind:value={manualHint} />
      <div class="gen-row">
        <div class="gen-field">
          <label for="manual-deck">牌组</label>
          <input id="manual-deck" class="b3-text-field" type="text" bind:value={manualDeck} />
        </div>
      </div>
      <label for="manual-tags">标签（逗号分隔）</label>
      <input id="manual-tags" class="b3-text-field" type="text" bind:value={manualTags} placeholder="物理, 力学" />
      <button class="b3-button b3-button--outline" on:click={addManual}>添加卡片</button>
    </div>
  {/if}

  <!-- AI 生成 -->
  {#if mode === 'ai'}
    <div class="gen-form">
      {#if agents.length === 0}
        <div class="gen-empty-agent">
          <p>📝 还没有创建任何 Agent</p>
          <p class="gen-empty-hint">Agent 是可自定义的制卡提示词模板。请先在「设置 → Agent 管理」中创建。</p>
          <button class="b3-button b3-button--outline" on:click={() => plugin.openSetting()}>前往设置</button>
        </div>
      {:else}
        <label for="ai-topic">主题 *</label>
        <textarea id="ai-topic" class="b3-text-field" bind:value={aiTopic} rows="2" placeholder="例如：牛顿运动定律"></textarea>

        <div class="gen-row">
          <div class="gen-field">
            <label for="ai-agent">Agent</label>
            <select id="ai-agent" class="b3-select" value={selectedAgentId} on:change={onAgentChange}>
              <option value="">请选择...</option>
              {#each agents as agent (agent.id)}
                <option value={agent.id}>{agent.name}</option>
              {/each}
            </select>
          </div>
          <div class="gen-field">
            <label for="ai-count">数量</label>
            <input id="ai-count" class="b3-text-field" type="number" bind:value={aiCount} min="1" max="30" />
          </div>
        </div>

        <!-- Agent 元信息预览 -->
        {#if selectedAgent}
          <div class="gen-agent-meta">
            <span class="gen-meta-badge">🌐 {selectedAgent.language}</span>
            <span class="gen-meta-badge">✏️ {selectedAgent.style}</span>
            <span class="gen-meta-badge">🎯 {selectedAgent.difficulty}</span>
          </div>
        {/if}

        <div class="gen-row">
          <div class="gen-field">
            <label for="ai-deck">牌组</label>
            <input id="ai-deck" class="b3-text-field" type="text" bind:value={aiDeck} />
          </div>
          <div class="gen-field">
            <label for="ai-tags">标签</label>
            <input id="ai-tags" class="b3-text-field" type="text" bind:value={aiTags} />
          </div>
        </div>

        <!-- 来源选择 -->
        <SourcePicker bind:config={sourceConfig} notebookEndpoint={config?.notebookEndpoint || ''} />

        <button class="b3-button b3-button--outline" on:click={generateAI} disabled={isGenerating || !selectedAgent}>
          {isGenerating ? '生成中...' : 'AI 生成'}
        </button>

        {#if aiStatus}<div class="gen-status">{aiStatus}</div>{/if}

        <!-- 预览审核 -->
        {#if previewCards.length > 0}
          <div class="gen-preview-header">
            预览（{previewCards.length} 张）
            <button class="b3-button b3-button--small b3-button--text" on:click={confirmAddAll}>全部添加</button>
          </div>
          <div class="gen-preview-list">
            {#each previewCards as card, idx}
              <div class="gen-preview-card">
                <div class="gen-preview-num">{idx + 1}</div>
                <div class="gen-preview-body">
                  <input class="b3-text-field gen-preview-input" value={card.question} on:input={(e) => editPreview(idx, 'question', e.target.value)} placeholder="问题" />
                  <textarea class="b3-text-field gen-preview-input" rows="2" on:input={(e) => editPreview(idx, 'answer', e.target.value)}>{card.answer}</textarea>
                  <input class="b3-text-field gen-preview-input" value={card.hint} on:input={(e) => editPreview(idx, 'hint', e.target.value)} placeholder="提示" />
                </div>
                <button class="b3-button b3-button--small gen-preview-del" on:click={() => removePreview(idx)}>✕</button>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  .gen-panel { padding: 24px; height: 100%; overflow-y: auto; }
  .gen-tabs { display: flex; gap: 6px; margin-bottom: 16px;
    .b3-button { flex: 1; }
  }
  .gen-form { display: flex; flex-direction: column; gap: 6px; }
  .gen-form label { font-size: var(--aio-fs-base); font-weight: 500; margin-top: 6px; }
  .gen-row { display: flex; gap: 8px; }
  .gen-field { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .gen-status { padding: 8px; border-radius: 4px; background: var(--b3-theme-surface-lighter); font-size: var(--aio-fs-base); text-align: center; }
  .gen-agent-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .gen-meta-badge { font-size: var(--aio-fs-xs); padding: 2px 8px; border-radius: 3px; background: var(--b3-theme-surface-lighter); }
  .gen-empty-agent { text-align: center; padding: 24px;
    p { margin: 0 0 8px; font-size: var(--aio-fs-base); }
    .gen-empty-hint { font-size: var(--aio-fs-sm); opacity: 0.6; line-height: 1.6; margin-bottom: 12px; }
  }
  .gen-preview-header { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; font-weight: 600; font-size: var(--aio-fs-base); }
  .gen-preview-list { display: flex; flex-direction: column; gap: 8px; }
  .gen-preview-card { display: flex; gap: 8px; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 6px; padding: 8px; }
  .gen-preview-num { font-size: var(--aio-fs-base); font-weight: 600; color: var(--b3-theme-primary); min-width: 20px; }
  .gen-preview-body { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .gen-preview-input { font-size: var(--aio-fs-base) !important; padding: 4px 8px !important; }
  .gen-preview-del { align-self: flex-start; color: var(--b3-card-error-color); }
</style>
