<script lang="ts">
  import Concepts from './Concepts.svelte';
  import Mindmap from './Mindmap.svelte';

  export let plugin: any;
  export let cardStore: any;
  export let conceptStore: any;
  export let sourceStore: any;
  export let config: any;
  export let appStore: any = null;
  export let mindmapStore: any = null;

  let mode: 'graph' | 'mindmap' = 'graph';
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
  </div>

  {#if mode === 'graph'}
    <div class="knowledge-graph-view">
      <Concepts {plugin} {cardStore} {conceptStore} {mindmapStore} {config} {sourceStore} {appStore} />
    </div>
  {:else}
    <div class="knowledge-mindmap-view">
      <Mindmap {plugin} {cardStore} {conceptStore} {mindmapStore} {config} />
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
