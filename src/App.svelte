<script lang="ts">
  import { onMount } from 'svelte';
  // New panels
  import SourceLibrary from './panels/SourceLibrary.svelte';
  import Knowledge from './panels/Knowledge.svelte';
  import SettingsPanel from './panels/Settings.svelte';
  // Keep: legacy panels
  import Review from './panels/Review.svelte';
  import Browse from './panels/Browse.svelte';
  import Generate from './panels/Generate.svelte';
  import Import from './panels/Import.svelte';
  import Rag from './panels/Rag.svelte';

  export let plugin: any;
  export let cardStore: any;
  export let mindmapStore: any;
  export let conceptStore: any;
  export let sourceStore: any;
  export let config: any;

  import { VectorStore } from './libs/rag';
  import type { RagConceptRequest } from './libs/rag';
  let vectorStore = new VectorStore(plugin);

  let activeTab = 'sources';
  let activeSubTab = 'generate';

  // ── Cross-panel handoff signals ──

  // Filtered review queue (Browse/Mindmap → Review)
  let reviewQueue: { ids: string[]; title: string; key: number } | null = null;
  let reviewQueueKey = 0;
  function startFilteredReview(ids: string[], title?: string) {
    reviewQueueKey++;
    reviewQueue = { ids, title: title || '筛选复习', key: reviewQueueKey };
    activeTab = 'make';
    activeSubTab = 'review';
  }

  // Mindmap jump (Browse/Concepts → Knowledge/mindmap mode)
  let mindmapJumpTarget: { mindmapId?: string } = {};
  let mindmapJumpKey = 0;
  function jumpToMindmap(id: string) {
    mindmapJumpKey++;
    mindmapJumpTarget = { mindmapId: id };
    activeTab = 'knowledge';
  }

  // Mindmap gap → Concepts handoff (Mindmap → Knowledge/graph mode)
  let mindmapGapTarget: { manualText: string; label: string; key: number } | null = null;
  let mindmapGapKey = 0;
  function openConceptsFromMindmapGaps(gapSourceText: string, label: string) {
    mindmapGapKey++;
    mindmapGapTarget = { manualText: gapSourceText, label, key: mindmapGapKey };
    activeTab = 'knowledge';
  }

  // RAG → Concepts handoff
  let ragConceptTarget: RagConceptRequest | null = null;
  function openConceptsFromRag(request: RagConceptRequest) {
    ragConceptTarget = request;
    activeTab = 'knowledge';
  }

  const tabs = [
    { id: 'sources',  label: '来源库',   icon: 'iconAioLibrary' },
    { id: 'rag',      label: 'RAG 对话',  icon: 'iconAioSearch' },
    { id: 'make',     label: '制卡',      icon: 'iconAioSparkles' },
    { id: 'knowledge',label: '导图',      icon: 'iconAioGraph' },
    { id: 'settings', label: '设置',      icon: 'iconAioSettings' },
  ];

  const makeSubTabs = [
    { id: 'generate', label: '制卡' },
    { id: 'review',   label: '复习' },
    { id: 'browse',   label: '浏览' },
    { id: 'import',   label: '导入' },
  ];

  let appStore = {
    selectedSourceIds: [] as string[],
    onSwitchTab: (tab: string) => { activeTab = tab; },
  };

  onMount(async () => {
    await vectorStore.load();
  });

  function switchTab(id: string) {
    if (id === 'make') {
      activeTab = id;
    } else {
      activeTab = id;
    }
  }

  function openConceptsPanel() {
    activeTab = 'knowledge';
  }
</script>

<div class="all-in-one-app">
  <!-- 左侧导航 -->
  <nav class="aio-nav">
    <button
      class="aio-nav-item aio-nav-logo"
      title="知识闪卡"
      on:click={() => switchTab('sources')}
    >
      <svg><use xlink:href="#iconList"></use></svg>
    </button>
    <div class="aio-nav-divider"></div>
    {#each tabs as tab}
      <button
        class="aio-nav-item"
        class:aio-nav-item--active={activeTab === tab.id}
        title={tab.label}
        on:click={() => switchTab(tab.id)}
      >
        <svg><use xlink:href="#{tab.icon}"></use></svg>
      </button>
    {/each}
  </nav>

  <!-- 右侧内容区 -->
  <main class="aio-content">
    {#if activeTab === 'make'}
      <div class="aio-subtabs">
        {#each makeSubTabs as sub}
          <button class="aio-subtab" class:aio-subtab--active={activeSubTab === sub.id} on:click={() => activeSubTab = sub.id}>
            {sub.label}
          </button>
        {/each}
      </div>
    {/if}

    {#if activeTab === 'make' && activeSubTab === 'generate'}
      <Generate {plugin} {cardStore} {conceptStore} {sourceStore} {config} {appStore} {openConceptsPanel} />
    {:else if activeTab === 'make' && activeSubTab === 'review'}
      <Review {plugin} {cardStore} {config} queue={reviewQueue} />
    {:else if activeTab === 'make' && activeSubTab === 'browse'}
      <Browse {plugin} {cardStore} {conceptStore} {mindmapStore} {config} {jumpToMindmap} {startFilteredReview} />
    {:else if activeTab === 'make' && activeSubTab === 'import'}
      <Import {plugin} {cardStore} {conceptStore} {mindmapStore} />
    {:else if activeTab === 'rag'}
      <Rag {plugin} {cardStore} {vectorStore} {sourceStore} {config} bind:appStore openConceptsFromRag={openConceptsFromRag} />
    {:else if activeTab === 'sources'}
      <SourceLibrary {plugin} {sourceStore} {vectorStore} bind:appStore />
    {:else if activeTab === 'knowledge'}
      <Knowledge {plugin} {cardStore} {conceptStore} {sourceStore} {config} {mindmapStore} bind:appStore {jumpToMindmap} {startFilteredReview} {openConceptsFromMindmapGaps} {mindmapJumpTarget} {mindmapGapTarget} {ragConceptTarget} />
    {:else if activeTab === 'settings'}
      <SettingsPanel showAsTab={true} {plugin} {config} />
    {/if}
  </main>
</div>

<style lang="scss">
  .all-in-one-app {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  /* 导航栏：固定尺寸，不继承 --aio-fs-* 变量 */
  .aio-nav {
    width: 40px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 0;
    gap: 2px;
    border-right: 1px solid var(--b3-theme-surface-lighter);
    background: var(--b3-theme-background);
    /* 关键：固定字号，不受内容区字号缩放影响 */
    font-size: 14px;
    line-height: 1;
  }

  .aio-nav-divider {
    width: 24px; height: 1px;
    background: var(--b3-theme-surface-lighter);
    margin: 2px 0;
  }

  .aio-nav-item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px; height: 32px;
    border: none;
    background: none;
    color: var(--b3-theme-on-surface);
    cursor: pointer;
    border-radius: 4px;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;

    svg { width: 16px; height: 16px; }

    &:hover {
      background: var(--b3-theme-surface-light);
      color: var(--b3-theme-on-background);
    }

    &.aio-nav-item--active {
      background: var(--b3-theme-primary-lightest);
      color: var(--b3-theme-primary);
    }
  }

  .aio-content {
    flex: 1;
    overflow: hidden;
    min-width: 0;
  }

  .aio-subtabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--b3-border-color);
  }
  .aio-subtab {
    padding: 6px 16px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: var(--aio-fs-sm);
    color: var(--b3-theme-on-surface);
    opacity: 0.7;
    border-bottom: 2px solid transparent;
  }
  .aio-subtab:hover { opacity: 1; }
  .aio-subtab--active {
    opacity: 1;
    color: var(--b3-theme-primary);
    border-bottom-color: var(--b3-theme-primary);
  }
</style>
