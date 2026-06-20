<script lang="ts">
  import { onMount } from 'svelte';
  import { showMessage, confirm } from 'siyuan';

  export let cardStore: any;

  let stats = { total: 0, new: 0, due: 0, learning: 0, reviewing: 0, decks: [] as any[] };

  onMount(() => refresh());

  function refresh() {
    stats = cardStore.getStats();
  }

  async function exportCards() {
    const data = cardStore.exportCards();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flashcards-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showMessage(`已导出 ${data.length} 张卡片`);
  }

  async function importCards() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data)) { showMessage('无效文件：需要 JSON 数组'); return; }
        const result = cardStore.importCards(data);
        await cardStore.save();
        refresh();
        showMessage(`导入完成：新增 ${result.added}，更新 ${result.updated}`);
      } catch (err: any) { showMessage(`导入失败：${err.message}`); }
    };
    input.click();
  }

  function clearAll() {
    confirm('⚠️', '确定删除所有卡片吗？此操作不可撤销。', () => {
      cardStore.clear();
      cardStore.save();
      refresh();
      showMessage('已清空');
    });
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
  <div class="stats-actions">
    <button class="b3-button b3-button--outline" on:click={exportCards}>导出</button>
    <button class="b3-button b3-button--outline" on:click={importCards}>导入</button>
    <button class="b3-button b3-button--outline stats-danger" on:click={clearAll}>清空全部</button>
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

  .stats-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .stats-danger { color: var(--b3-card-error-color) !important; }
</style>
