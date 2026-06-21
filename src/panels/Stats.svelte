<script lang="ts">
  import { onMount } from 'svelte';

  export let cardStore: any;
  export let openImportPanel: () => void = () => {};

  let stats = { total: 0, new: 0, due: 0, learning: 0, reviewing: 0, decks: [] as any[] };

  onMount(() => refresh());

  function refresh() {
    stats = cardStore.getStats();
  }
</script>

<div class="stats-panel">
  <h2>学习统计</h2>

  <!-- 数字概览 -->
  <div class="stats-grid">
    <div class="stat-card"><span class="stat-num">{stats.total}</span><span class="stat-label">总卡片</span></div>
    <div class="stat-card stat-new"><span class="stat-num">{stats.new}</span><span class="stat-label">新卡片</span></div>
    <div class="stat-card stat-due"><span class="stat-num">{stats.due}</span><span class="stat-label">待复习</span></div>
    <div class="stat-card stat-learning"><span class="stat-num">{stats.learning}</span><span class="stat-label">学习中</span></div>
    <div class="stat-card stat-review"><span class="stat-num">{stats.reviewing}</span><span class="stat-label">复习中</span></div>
  </div>

  <!-- 牌组分布 -->
  <h3>牌组分布</h3>
  {#if stats.decks.length === 0}
    <p class="stats-empty">暂无卡片</p>
  {:else}
    <div class="deck-list">
      {#each stats.decks as deck}
        <div class="deck-row">
          <span class="deck-name">{deck.name}</span>
          <div class="deck-bar-bg">
            <div class="deck-bar-fill" style="width: {stats.total > 0 ? (deck.count / stats.total) * 100 : 0}%"></div>
          </div>
          <span class="deck-count">{deck.count}</span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- 数据管理 -->
  <h3>数据管理</h3>
  <div class="stats-data-panel">
    <div>
      <strong>备份、迁移与恢复</strong>
      <p>统一在导入与导出面板处理卡片、概念图和导图关联，避免只迁移卡片造成链接丢失。</p>
    </div>
    <button class="b3-button b3-button--outline stats-link-button" on:click={openImportPanel}>
      <svg><use xlink:href="#iconDownload"></use></svg>
      打开导入导出
    </button>
  </div>
</div>

<style lang="scss">
  .stats-panel { padding: 24px; height: 100%; overflow-y: auto;
    display: flex; flex-direction: column; gap: 16px;
    h2 { font-size: var(--aio-fs-lg); margin: 0; }
    h3 { font-size: var(--aio-fs-base); margin: 8px 0 0; padding-bottom: 4px; border-bottom: 1px solid var(--b3-theme-surface-lighter); color: var(--b3-theme-primary); }
  }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; }

  .stat-card {
    display: flex; flex-direction: column; align-items: center; padding: 12px 8px;
    border: 1px solid var(--b3-theme-surface-lighter); border-radius: 8px;
    background: var(--b3-theme-surface);
    &.stat-new { background: var(--b3-card-info-background); color: var(--b3-card-info-color); }
    &.stat-due { background: var(--b3-card-warning-background); color: var(--b3-card-warning-color); }
    &.stat-learning { background: var(--b3-card-warning-background); color: var(--b3-card-warning-color); }
    &.stat-review { background: var(--b3-card-success-background); color: var(--b3-card-success-color); }
  }

  .stat-num { font-size: var(--aio-fs-xl); font-weight: 700; line-height: 1.2; }
  .stat-label { font-size: var(--aio-fs-xs); opacity: 0.7; }

  .stats-empty { opacity: 0.4; font-size: var(--aio-fs-base); }
  .deck-list { display: flex; flex-direction: column; gap: 6px; }
  .deck-row { display: flex; align-items: center; gap: 8px; }
  .deck-name { font-size: var(--aio-fs-base); width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
  .deck-bar-bg { flex: 1; height: 8px; background: var(--b3-theme-surface-lighter); border-radius: 4px; overflow: hidden; }
  .deck-bar-fill { height: 100%; background: var(--b3-theme-primary); border-radius: 4px; transition: width 0.3s; }
  .deck-count { font-size: var(--aio-fs-sm); width: 30px; text-align: right; flex-shrink: 0; }

  .stats-data-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    background: var(--b3-theme-background);

    strong {
      display: block;
      font-size: var(--aio-fs-base);
      margin-bottom: 4px;
    }

    p {
      margin: 0;
      font-size: var(--aio-fs-sm);
      line-height: 1.5;
      color: var(--b3-theme-on-surface);
      opacity: 0.72;
    }
  }

  .stats-link-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;

    svg { width: 14px; height: 14px; }
  }

  @media (max-width: 720px) {
    .stats-data-panel {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
