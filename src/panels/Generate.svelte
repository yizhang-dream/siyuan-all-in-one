<script lang="ts">
  import { createCard } from '../libs/srs';
  import { generateFlashcards, resolveLLMConfig } from '../libs/llm';
  import type { GeneratedCard } from '../libs/llm';
  import type { AgentConfig } from '../libs/types';
  import { getT } from '../libs/i18n';
  // SourcePicker removed — using SourceStore via appStore/sourceStore
  import { showMessage } from 'siyuan';
  import { parseSymbolCards, type ParsedSymbolCard } from '../libs/symbol-cards';
  import { addOcclusionRegion, drawOcclusionEditor, fileToDataUrl, fitImageToCanvas, hitTestOcclusion, isNearEdge, loadImage, resizeOcclusionRegion } from '../libs/image-occlusion-render';
  import type { ImageOcclusionRegion } from '../libs/types';

  export let plugin: any;
  export let cardStore: any;
  export let config: any;
  export let openConceptsPanel: () => void = () => {};
  export let sourceStore: any = null;
  export let appStore: any = null;

  const t = getT(plugin);

  let mode: 'manual' | 'ai' | 'occlusion' = 'manual';

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
  let aiStatusKind: 'info' | 'success' | 'warn' | 'error' = 'info';
  let isGenerating = false;
  let previewCards: GeneratedCard[] = [];

  $: symbolCards = parseSymbolCards(manualQ);
  $: hasSymbolCards = symbolCards.length > 0;

  // 图片遮挡
  let occlusionImage: HTMLImageElement | null = null;
  let occlusionImageDataUrl = '';
  let occlusionCanvasEl: HTMLCanvasElement;
  let occlusionRegions: ImageOcclusionRegion[] = [];
  let occlusionSelectedId = '';
  let occlusionDeck = '';
  let occlusionTags = '';
  let occlusionDragCorner: 'nw' | 'ne' | 'sw' | 'se' | null = null;
  let occlusionDragRegionId = '';

  async function loadOcclusionImage(file: File) {
    occlusionImageDataUrl = await fileToDataUrl(file);
    occlusionImage = await loadImage(occlusionImageDataUrl);
    occlusionRegions = [];
    occlusionSelectedId = '';
    renderOcclusionCanvas();
  }

  function renderOcclusionCanvas() {
    if (!occlusionCanvasEl || !occlusionImage) return;
    const fit = fitImageToCanvas(occlusionImage.naturalWidth, occlusionImage.naturalHeight, 600, 400);
    occlusionCanvasEl.width = fit.width;
    occlusionCanvasEl.height = fit.height;
    const ctx = occlusionCanvasEl.getContext('2d');
    if (!ctx) return;
    drawOcclusionEditor(ctx, occlusionImage, occlusionRegions, occlusionSelectedId);
  }

  function handleOcclusionClick(event: MouseEvent) {
    if (!occlusionCanvasEl || !occlusionImage) return;
    const rect = occlusionCanvasEl.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // 优先检测是否在已有的遮挡区域边缘（resize）
    for (const region of occlusionRegions) {
      const corner = isNearEdge(x, y, occlusionCanvasEl.width, occlusionCanvasEl.height, region);
      if (corner) {
        occlusionDragCorner = corner;
        occlusionDragRegionId = region.id;
        occlusionSelectedId = region.id;
        return;
      }
    }

    // 检测是否在已有区域内（选中）
    const hit = hitTestOcclusion(x, y, occlusionCanvasEl.width, occlusionCanvasEl.height, occlusionRegions);
    if (hit) {
      occlusionSelectedId = hit;
      occlusionDragCorner = null;
      renderOcclusionCanvas();
      return;
    }

    // 空白区：新增
    const region = addOcclusionRegion(x, y, occlusionCanvasEl.width, occlusionCanvasEl.height, occlusionRegions);
    occlusionRegions = [...occlusionRegions, region];
    occlusionSelectedId = region.id;
    occlusionDragCorner = null;
    renderOcclusionCanvas();
  }

  function handleOcclusionMouseMove(event: MouseEvent) {
    if (!occlusionDragCorner || !occlusionDragRegionId || !occlusionCanvasEl) return;
    const rect = occlusionCanvasEl.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const idx = occlusionRegions.findIndex((r) => r.id === occlusionDragRegionId);
    if (idx === -1) return;
    occlusionRegions[idx] = resizeOcclusionRegion(
      occlusionRegions[idx], occlusionDragCorner!, x, y,
      occlusionCanvasEl.width, occlusionCanvasEl.height
    );
    occlusionRegions = [...occlusionRegions];
    renderOcclusionCanvas();
  }

  function handleOcclusionMouseUp() {
    occlusionDragCorner = null;
    occlusionDragRegionId = '';
  }

  function handleOcclusionKeyDown(event: KeyboardEvent) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (occlusionSelectedId) {
        removeOcclusionRegion();
        event.preventDefault();
      }
    }
  }

  function removeOcclusionRegion() {
    if (!occlusionSelectedId) return;
    occlusionRegions = occlusionRegions.filter((r) => r.id !== occlusionSelectedId);
    occlusionSelectedId = '';
    renderOcclusionCanvas();
  }

  function saveOcclusionCard() {
    if (!occlusionImageDataUrl || occlusionRegions.length === 0) return;
    const deck = occlusionDeck || config?.defaultDeck || '默认';
    const tags = occlusionTags ? occlusionTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [];
    const card = createCard('图片遮挡 · 被遮挡区域', '图片遮挡 · 被遮挡区域', '', deck, tags);
    card.cardType = 'image-occlusion';
    card.occlusion = {
      imageDataUrl: occlusionImageDataUrl,
      imageWidth: occlusionImage?.naturalWidth || 800,
      imageHeight: occlusionImage?.naturalHeight || 600,
      regions: occlusionRegions,
      cardId: card.id,
    };
    cardStore?.add?.(card);
    showMessage(`已创建遮挡卡（${occlusionRegions.length} 个遮挡区域）`);
    occlusionImage = null;
    occlusionImageDataUrl = '';
    occlusionRegions = [];
    occlusionSelectedId = '';
  }

  function handleOcclusionFileChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) loadOcclusionImage(file);
  }

  function createSymbolCards() {
    if (symbolCards.length === 0) return;
    const deck = manualDeck || config?.defaultDeck || '默认';
    const tags = manualTags ? manualTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean) : [];
    for (const parsed of symbolCards) {
      const card = createCard(
        parsed.cardType === 'reverse' ? parsed.back : parsed.front,
        parsed.cardType === 'reverse' ? parsed.front : parsed.back,
        parsed.hint || '',
        deck,
        tags,
      );
      card.cardType = parsed.cardType;
      cardStore?.add?.(card);
    }
    showMessage(`已从快速语法创建 ${symbolCards.length} 张卡片`);
    manualQ = '';
  }

  // 来源选择 — now via SourceStore
  let selectedSourceIds: string[] = [];

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
    aiStatusKind = 'info';

    try {
      // 1. 从 SourceStore 获取上下文
      let context: string | undefined;
      if (appStore?.selectedSourceIds?.length && sourceStore) {
        aiStatus = '正在读取来源...';
        const parts: string[] = [];
        for (const id of appStore.selectedSourceIds) {
          const record = sourceStore.getById(id);
          if (record?.content) {
            parts.push(record.content);
          }
        }
        if (parts.length > 0) {
          context = parts.join('\n\n---\n\n');
          aiStatus = `已从 ${parts.length} 个来源获取 ${context.length} 字上下文，AI 生成中...`;
          aiStatusKind = 'info';
          appStore.selectedSourceIds = [];
        } else {
          aiStatus = '未能获取来源内容，将无上下文生成...';
          aiStatusKind = 'warn';
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
        aiStatus = `全部 ${before} 张已存在（去重 ${deduped} 张）`;
        aiStatusKind = 'warn';
      } else {
        aiStatus = `生成 ${previewCards.length} 张${deduped > 0 ? `（去重 ${deduped}）` : ''}，请审核`;
        aiStatusKind = 'success';
      }
    } catch (e: any) {
      aiStatus = `生成失败：${e.message}`;
      aiStatusKind = 'error';
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
  <div class="gen-workflow-note">
    <div class="gen-workflow-text">
      <strong>快速制卡</strong>
      <p>这里适合手动添加或用 Agent 生成独立卡片；需要保留概念、关系和导图联动时，进入来源制卡与图谱。</p>
    </div>
    <button class="b3-button b3-button--outline gen-workflow-button" on:click={openConceptsPanel}>
      <svg><use xlink:href="#iconGraph"></use></svg>
      来源制卡与图谱
    </button>
  </div>

  <div class="gen-tabs">
    <button class="b3-button" class:b3-button--outline={mode !== 'manual'} on:click={() => mode = 'manual'}>手动添加</button>
    <button class="b3-button" class:b3-button--outline={mode !== 'ai'} on:click={() => mode = 'ai'}>AI 生成</button>
    <button class="b3-button" class:b3-button--outline={mode !== 'occlusion'} on:click={() => mode = 'occlusion'}>图片遮挡</button>
  </div>

  <!-- 手动添加 -->
  {#if mode === 'manual'}
    <div class="gen-form">
      <label for="manual-question">问题 *</label>
      <textarea id="manual-question" class="b3-text-field" bind:value={manualQ} rows="3" placeholder="输入问题... 或用快速语法：问题 >> 答案、概念 << 定义"></textarea>
      {#if hasSymbolCards}
        <div class="gen-symbol-hint">
          <svg><use xlink:href="#iconInfo"></use></svg>
          <span>检测到 {symbolCards.length} 张快速卡片（{symbolCards.map((c) => ({ qa: '>>', reverse: '<<', cloze: '<>' })[c.cardType]).filter(Boolean).join(' ')}）</span>
          <button class="b3-button b3-button--small b3-button--primary" on:click={createSymbolCards}>
            <svg><use xlink:href="#iconAdd"></use></svg>
            一键创建 {symbolCards.length} 张
          </button>
        </div>
      {/if}
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
          <svg class="gen-empty-icon"><use xlink:href="#iconSettings"></use></svg>
          <p>还没有创建任何 Agent</p>
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
            <span class="gen-meta-badge">语言：{selectedAgent.language}</span>
            <span class="gen-meta-badge">风格：{selectedAgent.style}</span>
            <span class="gen-meta-badge">难度：{selectedAgent.difficulty}</span>
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

        <!-- 来源选择 — now via SourceStore -->
        <button class="b3-button b3-button--small" on:click={() => appStore?.onSwitchTab?.('sources')}>
          从来源库选取
        </button>

        <button class="b3-button b3-button--outline" on:click={generateAI} disabled={isGenerating || !selectedAgent}>
          {isGenerating ? '生成中...' : 'AI 生成'}
        </button>

        {#if aiStatus}<div class="gen-status gen-status--{aiStatusKind}">{aiStatus}</div>{/if}

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
                <button class="b3-button b3-button--small gen-preview-del" on:click={() => removePreview(idx)} aria-label="删除预览卡片" title="删除">
                  <svg><use xlink:href="#iconClose"></use></svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- 图片遮挡编辑器 -->
  {#if mode === 'occlusion'}
    <div class="gen-form">
      <label>上传图片</label>
      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" on:change={handleOcclusionFileChange} />
      {#if occlusionImage}
        <div class="occlusion-canvas-wrap">
          <canvas bind:this={occlusionCanvasEl} on:click={handleOcclusionClick} on:mousemove={handleOcclusionMouseMove} on:mouseup={handleOcclusionMouseUp} on:keydown={handleOcclusionKeyDown} tabindex="0" class="occlusion-canvas"></canvas>
        </div>
        <p class="gen-symbol-hint">{occlusionRegions.length} 个遮挡区域 · 点击画布添加 · 拖拽四角调整大小 · 选中后按 Delete 删除</p>
        <div class="gen-row">
          <button class="b3-button b3-button--small b3-button--outline" on:click={removeOcclusionRegion} disabled={!occlusionSelectedId}>删除选中</button>
          <button class="b3-button b3-button--small b3-button--primary" on:click={saveOcclusionCard} disabled={occlusionRegions.length === 0}>保存遮挡卡</button>
        </div>
        <label for="occl-deck">牌组</label>
        <input id="occl-deck" class="b3-text-field" type="text" bind:value={occlusionDeck} placeholder={config?.defaultDeck || '默认'} />
        <label for="occl-tags">标签</label>
        <input id="occl-tags" class="b3-text-field" type="text" bind:value={occlusionTags} placeholder="逗号分隔" />
      {/if}
    </div>
  {/if}
</div>

<style lang="scss">
  .gen-panel { padding: 24px; height: 100%; overflow-y: auto; box-sizing: border-box; }
  .gen-workflow-note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    margin-bottom: 14px;
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    background: var(--b3-theme-background);

    strong {
      display: block;
      margin: 0;
      font-size: var(--aio-fs-base);
      line-height: 1.4;
    }

    p {
      margin: 0;
      color: var(--b3-theme-on-surface);
      font-size: var(--aio-fs-sm);
      line-height: 1.5;
      opacity: 0.72;
      word-break: break-word;
    }
  }

  .gen-workflow-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .gen-workflow-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;

    svg { width: 14px; height: 14px; }
  }

  .gen-tabs { display: flex; gap: 6px; margin-bottom: 16px;
    .b3-button { flex: 1; }
  }
  .gen-form { display: flex; flex-direction: column; gap: 6px; }
  .gen-form label { font-size: var(--aio-fs-base); font-weight: 500; margin-top: 6px; }
  .gen-row { display: flex; gap: 8px; }
  .gen-symbol-hint { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; background: var(--b3-theme-primary-lightest); font-size: var(--aio-fs-sm); margin-top: 4px; }
  .gen-symbol-hint svg { width: 14px; height: 14px; color: var(--b3-theme-primary); flex-shrink: 0; }
  .gen-symbol-hint span { flex: 1; }
  .occlusion-canvas-wrap { border: 1px solid var(--b3-theme-surface-lighter); border-radius: 6px; overflow: hidden; background: var(--b3-theme-background); }
  .occlusion-canvas { display: block; cursor: crosshair; max-width: 100%; }
  .gen-field { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .gen-status {
    padding: 8px 10px;
    border-radius: 4px;
    border: 1px solid var(--b3-theme-surface-lighter);
    background: var(--b3-theme-surface);
    color: var(--b3-theme-on-background);
    font-size: var(--aio-fs-base);
    text-align: center;
  }
  .gen-status--success {
    color: var(--b3-card-success-color);
    background: var(--b3-card-success-background);
    border-color: var(--b3-card-success-color);
  }
  .gen-status--warn {
    color: var(--b3-card-warning-color);
    background: var(--b3-card-warning-background);
    border-color: var(--b3-card-warning-color);
  }
  .gen-status--error {
    color: var(--b3-card-error-color);
    background: var(--b3-card-error-background);
    border-color: var(--b3-card-error-color);
  }
  .gen-agent-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .gen-meta-badge { font-size: var(--aio-fs-xs); padding: 2px 8px; border-radius: 3px; background: var(--b3-theme-surface-lighter); }
  .gen-empty-agent { text-align: center; padding: 24px;
    .gen-empty-icon { width: 24px; height: 24px; color: var(--b3-theme-primary); margin-bottom: 8px; }
    p { margin: 0 0 8px; font-size: var(--aio-fs-base); }
    .gen-empty-hint { font-size: var(--aio-fs-sm); opacity: 0.6; line-height: 1.6; margin-bottom: 12px; }
  }
  .gen-preview-header { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; font-weight: 600; font-size: var(--aio-fs-base); }
  .gen-preview-list { display: flex; flex-direction: column; gap: 8px; }
  .gen-preview-card { display: flex; gap: 8px; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 6px; padding: 8px; }
  .gen-preview-num { font-size: var(--aio-fs-base); font-weight: 600; color: var(--b3-theme-primary); min-width: 20px; }
  .gen-preview-body { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .gen-preview-input { font-size: var(--aio-fs-base) !important; padding: 4px 8px !important; }
  .gen-preview-del {
    align-self: flex-start;
    color: var(--b3-card-error-color);
    display: inline-flex;
    align-items: center;
    justify-content: center;

    svg { width: 14px; height: 14px; }
  }

  @media (max-width: 720px) {
    .gen-workflow-note {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
