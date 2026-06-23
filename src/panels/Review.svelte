<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { scheduleCard } from '../libs/srs';
  import { renderToHTML, renderMath } from '../libs/render';
  import { drawOcclusionReview, hitTestOcclusion, loadImage, allRevealed } from '../libs/image-occlusion-render';
  import type { Card } from '../libs/types';

  export let plugin: any;
  export let cardStore: any;
  export let queue: { ids: string[]; title: string; key: number } | null = null;

  // 牌组选择
  let allDecks: string[] = [];
  let selectedDeck = '';
  // 每日复习上限
  let dailyLimit = 30;
  let limitInput = 30;

  let dueCards: any[] = [];
  let currentIndex = 0;
  let flipped = false;
  let appliedQueueKey = 0;
  let dismissedQueueKey = 0;
  let activeQueueTitle = '';

  // 图片遮挡复习状态
  let occlusionRevealedIds = new Set<string>();
  let occlusionReviewImage: HTMLImageElement | null = null;
  let occlusionReviewCanvas: HTMLCanvasElement;
  $: occlusionRevealedCount = occlusionRevealedIds.size;
  $: currentCard = dueCards[currentIndex] as Card | undefined;

  function renderOcclusionReview() {
    if (!occlusionReviewCanvas || !occlusionReviewImage || !currentCard?.occlusion) return;
    const w = occlusionReviewCanvas.width;
    const h = occlusionReviewCanvas.height;
    if (w === 0 || h === 0) {
      occlusionReviewCanvas.width = Math.min(600, occlusionReviewImage.naturalWidth);
      occlusionReviewCanvas.height = Math.min(400, occlusionReviewImage.naturalHeight);
    }
    const ctx = occlusionReviewCanvas.getContext('2d');
    if (!ctx) return;
    drawOcclusionReview(ctx, occlusionReviewImage, currentCard.occlusion.regions, occlusionRevealedIds);
  }

  function handleOcclusionReviewClick(event: MouseEvent) {
    if (!occlusionReviewCanvas || !currentCard?.occlusion) return;
    const rect = occlusionReviewCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = hitTestOcclusion(x, y, occlusionReviewCanvas.width, occlusionReviewCanvas.height, currentCard.occlusion.regions);
    if (hit) {
      occlusionRevealedIds = new Set([...occlusionRevealedIds, hit]);
      renderOcclusionReview();
    }
  }

  onMount(() => {
    // 加载配置
    const cfg = plugin.getConfig();
    dailyLimit = cfg.cardsPerDay || 30;
    limitInput = dailyLimit;
    refresh();
  });

  function refresh() {
    if (queue?.key && queue.key !== appliedQueueKey && queue.key !== dismissedQueueKey) {
      appliedQueueKey = queue.key;
      activeQueueTitle = queue.title || '筛选复习';
      const idSet = new Set(queue.ids || []);
      dueCards = cardStore.getAll().filter((card: any) => idSet.has(card.id));
      currentIndex = 0;
      flipped = false;
      allDecks = cardStore.getDecks();
      return;
    }

    // 获取全部到期卡片
    activeQueueTitle = '';
    allDecks = cardStore.getDecks();
    const allDue = cardStore.getDue();

    // 按牌组过滤
    const filtered = selectedDeck ? allDue.filter((c: any) => c.deck === selectedDeck) : allDue;

    // 按上限截断
    dueCards = filtered.slice(0, dailyLimit);
    currentIndex = 0;
    flipped = false;
  }

  function flip() {
    flipped = true;
    if (dueCards[currentIndex]?.cardType === 'image-occlusion' && dueCards[currentIndex]?.occlusion) {
      occlusionRevealedIds = new Set();
      loadImage(dueCards[currentIndex].occlusion.imageDataUrl).then((img) => {
        occlusionReviewImage = img;
        renderOcclusionReview();
      });
    }
  }

  function handleGrade(g: number) {
    const card = dueCards[currentIndex];
    if (!card) return;
    const cfg = plugin.getConfig();
    scheduleCard(g, card, cfg.scheduler || 'sm2');
    plugin.saveCards();
    currentIndex++;
    flipped = false;
    occlusionRevealedIds = new Set();
    occlusionReviewImage = null;
  }

  function changeDeck() {
    appliedQueueKey = 0;
    activeQueueTitle = '';
    refresh();
  }

  function updateLimit() {
    const val = parseInt(String(limitInput), 10);
    if (val > 0 && val <= 999) {
      dailyLimit = val;
      // 同步到插件配置
      const cfg = plugin.getConfig();
      cfg.cardsPerDay = val;
      plugin.saveConfig(cfg);
      refresh();
    }
  }

  const gradeLabels = ['再次', '困难', '良好', '简单'];
  const gradeClasses = ['grade-again', 'grade-hard', 'grade-good', 'grade-easy'];

  $: currentCard = dueCards[currentIndex];
  $: hasMore = currentIndex < dueCards.length;
  $: remainingToday = dailyLimit - currentIndex;
  $: totalFiltered = dueCards.length;
  $: drillCount = dueCards.filter((card) => card?.status === 'drill').length;
  $: isDrillCard = currentCard?.status === 'drill';
  $: if (queue?.key && queue.key !== appliedQueueKey && queue.key !== dismissedQueueKey) refresh();

  function exitFilteredQueue() {
    dismissedQueueKey = appliedQueueKey;
    appliedQueueKey = 0;
    activeQueueTitle = '';
    refresh();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!hasMore) return;
    const target = e.target as HTMLElement;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
    }
    if (!flipped && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      flip();
    } else if (flipped) {
      const map: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3 };
      if (map[e.key] !== undefined) {
        e.preventDefault();
        handleGrade(map[e.key]);
      }
    }
  }

  function handleReviewCardKeydown(e: KeyboardEvent) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    if (!flipped) flip();
  }

  let reviewCardEl: HTMLElement;
  afterUpdate(() => {
    if (reviewCardEl) renderMath(reviewCardEl);
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="review-panel">
  <!-- 设置栏 -->
  <div class="review-settings">
    <div class="review-setting">
      <label for="review-deck">牌组</label>
      <select id="review-deck" class="b3-select" bind:value={selectedDeck} on:change={changeDeck} disabled={Boolean(activeQueueTitle)}>
        <option value="">全部牌组</option>
        {#each allDecks as deck}
          <option value={deck}>{deck}</option>
        {/each}
      </select>
    </div>
    <div class="review-setting">
      <label for="review-daily-limit">每日上限</label>
      <div class="review-limit-row">
        <input id="review-daily-limit" class="b3-text-field review-limit-input" type="number" value={limitInput} on:blur={updateLimit} on:keydown={(e) => { if (e.key === 'Enter') updateLimit(); }} />
        <button class="b3-button b3-button--small b3-button--outline" on:click={updateLimit}>设置</button>
      </div>
    </div>
  </div>

  {#if dueCards.length === 0}
    <div class="review-empty">
      <svg class="review-empty-icon"><use xlink:href="#iconInfo"></use></svg>
      <p class="review-empty-text">暂无待复习的卡片</p>
      <p class="review-empty-hint">去「生成」页面创建新卡片</p>
    </div>
  {:else if !hasMore}
    <div class="review-empty">
      <svg class="review-empty-icon"><use xlink:href="#iconCheck"></use></svg>
      <p class="review-empty-text">本轮复习完成</p>
      {#if totalFiltered === dailyLimit}
        <p class="review-empty-hint">已达每日上限 {dailyLimit} 张，明天再来</p>
      {/if}
      <button class="b3-button b3-button--outline" on:click={refresh}>刷新</button>
    </div>
  {:else}
    {#if activeQueueTitle}
      <div class="review-queue-banner">
        <span>{activeQueueTitle}</span>
        <button class="b3-button b3-button--small b3-button--outline" on:click={exitFilteredQueue}>返回到期复习</button>
      </div>
    {/if}
    <div class="review-progress">
      <span>{currentIndex + 1} / {dueCards.length}{activeQueueTitle ? '' : `（今日剩余 ${remainingToday}）`}</span>
      <div class="review-bar">
        <div class="review-bar-fill" style="width: {((currentIndex + 1) / dueCards.length) * 100}%"></div>
      </div>
      {#if drillCount > 0}
        <span class="review-drill-badge" title="连续 2 次遗忘进入机械练习">
          <svg><use xlink:href="#iconRefresh"></use></svg>
          {drillCount} 张机械练习
        </span>
      {/if}
    </div>

    <div class="review-card" class:flipped on:click={() => !flipped && flip()} on:keydown={handleReviewCardKeydown} role="button" tabindex="0" bind:this={reviewCardEl}>
      <div class="review-card-inner">
        <div class="review-card-front">
          <div class="review-card-label">问题{#if isDrillCard} <span class="review-drill-chip">机械练习</span>{/if}</div>
          <div class="review-card-text">{@html renderToHTML(currentCard.question)}</div>
          {#if currentCard.hint}
            <div class="review-card-hint review-card-hint--front">
              <span class="review-card-label">提示</span>
              {@html renderToHTML(currentCard.hint)}
            </div>
          {/if}
        </div>
        <div class="review-card-back">
          <div class="review-card-label">答案</div>
          {#if currentCard.cardType === 'image-occlusion' && currentCard.occlusion}
            <div class="review-occlusion-wrap">
              <canvas
                bind:this={occlusionReviewCanvas}
                on:click={handleOcclusionReviewClick}
                class="review-occlusion-canvas"
              ></canvas>
              <p class="review-occlusion-status">{occlusionRevealedCount} / {currentCard.occlusion.regions.length} 已揭示</p>
            </div>
          {:else}
            <div class="review-card-text">{@html renderToHTML(currentCard.answer)}</div>
          {/if}
          {#if currentCard.hint}
            <div class="review-card-hint">
              <span class="review-card-label">提示</span>
              {@html renderToHTML(currentCard.hint)}
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if !flipped}
      <button class="b3-button b3-button--text review-flip-btn" on:click={flip}>
        点击显示答案 <span class="review-kbd">(空格)</span>
      </button>
    {:else}
      <div class="review-grades">
        {#each [0, 1, 2, 3] as g}
          <button class="b3-button review-grade-btn {gradeClasses[g]}" on:click={() => handleGrade(g)}>
            {gradeLabels[g]}
            <span class="review-kbd">({g + 1})</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="review-deck">{currentCard.deck || ''}</div>
  {/if}
</div>

<style lang="scss">
  .review-panel {
    display: flex; flex-direction: column; align-items: center; padding: 24px; height: 100%; gap: 12px; overflow-y: auto; box-sizing: border-box;
  }

  .review-settings {
    display: flex; gap: 12px; width: 100%; max-width: 720px; flex-wrap: wrap;
    .review-setting {
      display: flex; flex-direction: column; gap: 2px;
      label { font-size: var(--aio-fs-xs); font-weight: 500; opacity: 0.6; }
      &:first-child { flex: 1; min-width: 150px; }
      &:last-child { width: 160px; }
    }
    .review-limit-row {
      display: flex; gap: 4px;
      .review-limit-input { width: 70px !important; }
    }
  }

  .review-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: var(--b3-theme-on-surface); gap: 8px;
    .review-empty-icon { width: 48px; height: 48px; opacity: 0.4; }
    .review-empty-text { font-size: var(--aio-fs-md); line-height: 1.3; font-weight: 500; }
    .review-empty-hint { font-size: var(--aio-fs-base); opacity: 0.6; }
  }

  .review-queue-banner {
    width: 100%;
    max-width: 720px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--b3-theme-primary-light);
    border-radius: 4px;
    background: var(--b3-theme-primary-lightest);
    color: var(--b3-theme-on-surface);
    font-size: var(--aio-fs-sm);

    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .review-progress {
    width: 100%; max-width: 720px; display: flex; align-items: center; gap: 8px; font-size: var(--aio-fs-sm); color: var(--b3-theme-on-surface);
    .review-bar { flex: 1; height: 4px; background: var(--b3-theme-surface-lighter); border-radius: 2px; overflow: hidden; }
    .review-bar-fill { height: 100%; background: var(--b3-theme-primary); border-radius: 2px; transition: width 0.3s; }
  }
  .review-drill-badge {
    display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;
    padding: 2px 8px; border-radius: 4px;
    background: var(--b3-theme-warning-lightest); color: var(--b3-theme-warning);
    font-size: var(--aio-fs-xs); white-space: nowrap;
    svg { width: 12px; height: 12px; }
  }
  .review-drill-chip {
    padding: 2px 8px; border-radius: 4px;
    background: var(--b3-theme-warning); color: var(--b3-theme-on-warning);
    font-size: var(--aio-fs-xs); vertical-align: middle;
  }

  .review-card {
    flex: 1; width: 100%; max-width: 720px; perspective: 1000px; cursor: pointer; min-height: 200px;
  }

  .review-card-inner {
    position: relative; width: 100%; height: 100%; min-height: 200px;
    transition: transform 0.4s ease; transform-style: preserve-3d;
  }

  .flipped .review-card-inner { transform: rotateY(180deg); }

  .review-card-front, .review-card-back {
    position: absolute; inset: 0; backface-visibility: hidden; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 24px;
    border: 1px solid var(--b3-theme-surface-lighter); border-radius: 8px; background: var(--b3-theme-surface); overflow-y: auto;
  }
  .review-card-back { transform: rotateY(180deg); }

  .review-card-label { font-size: var(--aio-fs-xs); text-transform: uppercase; letter-spacing: 1px; color: var(--b3-theme-primary); margin-bottom: 8px; font-weight: 600; }
  .review-card-text { font-size: var(--aio-fs-md); line-height: 1.7; text-align: center; word-break: break-word; white-space: pre-wrap; }
  .review-occlusion-wrap { text-align: center; }
  .review-occlusion-canvas { max-width: 100%; cursor: pointer; border-radius: 6px; border: 1px solid var(--b3-theme-surface-lighter); }
  .review-occlusion-status { font-size: var(--aio-fs-sm); margin-top: 8px; opacity: 0.6; }
  .review-card-hint { margin-top: 12px; font-size: var(--aio-fs-base); opacity: 0.7; text-align: center; padding-top: 8px; border-top: 1px solid var(--b3-theme-surface-lighter); width: 100%; }
  .review-card-hint--front {
    max-width: 92%;
    padding: 8px 10px 0;
  }

  .review-flip-btn { width: 100%; max-width: 720px; padding: 10px; }
  .review-grades { display: flex; gap: 8px; width: 100%; max-width: 720px; }
  .review-grade-btn { flex: 1; padding: 10px 4px; font-size: var(--aio-fs-base); border-radius: 4px;
    &.grade-again { background: var(--b3-card-error-background); color: var(--b3-card-error-color); }
    &.grade-hard { background: var(--b3-card-warning-background); color: var(--b3-card-warning-color); }
    &.grade-good { background: var(--b3-card-info-background); color: var(--b3-card-info-color); }
    &.grade-easy { background: var(--b3-card-success-background); color: var(--b3-card-success-color); }
  }
  .review-kbd { font-size: var(--aio-fs-xs); opacity: 0.6; }
  .review-deck { font-size: var(--aio-fs-sm); opacity: 0.4; }
</style>
