<script lang="ts">
  import { onMount } from 'svelte';

  export let plugin: any;
  export let cardStore: any;
  export let conceptStore: any;
  export let sourceStore: any;
  export let config: any;

  let mode: 'graph' | 'mindmap' = 'graph';

  onMount(() => {
    // TODO Phase 4: Load conceptStore data for graph view
    // TODO Phase 4: Load mindmap data for mindmap view
  });
</script>

<div class="knowledge-panel">
  <div class="knowledge-toolbar">
    <div class="mode-switch">
      <button class="b3-button b3-button--small" class:active={mode === 'graph'} on:click={() => mode = 'graph'}>
        图谱视图
      </button>
      <button class="b3-button b3-button--small" class:active={mode === 'mindmap'} on:click={() => mode = 'mindmap'}>
        导图视图
      </button>
    </div>
    <div class="knowledge-toolbar-spacer"></div>
  </div>

  {#if mode === 'graph'}
    <div class="knowledge-graph-view">
      <p style="padding:20px;opacity:0.5">图谱视图 — Concepts.svelte 核心逻辑迁移中（见 Phase 4）</p>
    </div>
  {:else}
    <div class="knowledge-mindmap-view">
      <p style="padding:20px;opacity:0.5">导图视图 — Mindmap.svelte 核心逻辑迁移中（见 Phase 4）</p>
    </div>
  {/if}
</div>

<style>
  .knowledge-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .knowledge-toolbar {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--b3-border-color);
  }
  .knowledge-toolbar-spacer { flex: 1; }
  .mode-switch {
    display: flex;
    gap: 4px;
  }
  .mode-switch button.active {
    background: var(--b3-theme-primary);
    color: var(--b3-theme-on-primary);
  }
  .knowledge-graph-view, .knowledge-mindmap-view {
    flex: 1;
    overflow-y: auto;
  }
</style>
