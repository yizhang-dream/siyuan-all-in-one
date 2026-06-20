<script lang="ts">
  import { onMount } from 'svelte';
  import Review from './panels/Review.svelte';
  import Browse from './panels/Browse.svelte';
  import Generate from './panels/Generate.svelte';
  import Mindmap from './panels/Mindmap.svelte';
  import Stats from './panels/Stats.svelte';
  import Import from './panels/Import.svelte';
  import Notebook from './panels/Notebook.svelte';
  import Models from './panels/Models.svelte';
  import Concepts from './panels/Concepts.svelte';
  import Diagnostics from './panels/Diagnostics.svelte';
  import { getT } from './libs/i18n';
  import { activateSourceRef, getSourceAction } from './libs/source-actions';
  import type { NotebookConceptRequest } from './libs/notebook-bridge';
  import type { SourceRef } from './libs/types/concept';

  export let plugin: any;
  export let cardStore: any;
  export let mindmapStore: any;
  export let conceptStore: any;
  export let config: any;

  const t = getT(plugin);

  let activeTab = 'review';
  let jumpTarget: { mindmapId?: string } = {};
  let notebookTarget: Partial<SourceRef> | null = null;
  let conceptSourceTarget: NotebookConceptRequest | null = null;
  let conceptSourceTargetSeq = 0;

  /** 跳转到思维导图面板并加载指定导图 */
  function jumpToMindmap(mindmapId: string) {
    jumpTarget = { mindmapId };
    activeTab = 'mindmap';
  }

  async function openSourceRef(ref: Partial<SourceRef>) {
    const action = getSourceAction(ref);
    if (action.kind === 'open-opennotebook') {
      notebookTarget = { ...ref };
      activeTab = 'notebook';
      return true;
    }
    return activateSourceRef(ref, plugin?.app);
  }

  function openConceptsFromNotebook(request: NotebookConceptRequest) {
    conceptSourceTargetSeq += 1;
    conceptSourceTarget = { ...request, key: `${request.key}#${conceptSourceTargetSeq}` };
    activeTab = 'concepts';
  }

  const tabs = [
    { id: 'review', label: '复习', icon: 'iconRefresh' },
    { id: 'browse', label: '浏览', icon: 'iconList' },
    { id: 'generate', label: '生成', icon: 'iconAdd' },
    { id: 'import', label: '导入', icon: 'iconDownload' },
    { id: 'notebook', label: '问答', icon: 'iconBookmark' },
    { id: 'models', label: '模型', icon: 'iconSettings' },
    { id: 'concepts', label: '概念', icon: 'iconGraph' },
    { id: 'mindmap', label: '导图', icon: 'iconGraph' },
    { id: 'diagnostics', label: '诊断', icon: 'iconInfo' },
    { id: 'stats', label: '统计', icon: 'iconBarChart' },
  ];

  function switchTab(id: string) {
    activeTab = id;
  }
</script>

<div class="all-in-one-app">
  <!-- 左侧导航：纯图标按钮 + 悬停 tooltip（仿 SiYuan 侧栏） -->
  <nav class="aio-nav">
    <button
      class="aio-nav-item aio-nav-logo"
      title={t('pluginName') || '知识闪卡'}
      on:click={() => switchTab('review')}
    >
      <svg><use xlink:href="#iconList"></use></svg>
    </button>
    <div class="aio-nav-divider"></div>
    {#each tabs as tab}
      <button
        class="aio-nav-item"
        class:aio-nav-item--active={activeTab === tab.id}
        title={t(tab.id + 'Tab') || tab.label}
        on:click={() => switchTab(tab.id)}
      >
        <svg><use xlink:href="#{tab.icon}"></use></svg>
      </button>
    {/each}
    <span class="aio-nav-spacer"></span>
    <button
      class="aio-nav-item"
      title={t('settingsTab') || '设置'}
      on:click={() => plugin.openSetting()}
    >
      <svg><use xlink:href="#iconSettings"></use></svg>
    </button>
  </nav>

  <!-- 右侧内容区 -->
  <main class="aio-content">
    {#if activeTab === 'review'}
      <Review {plugin} {cardStore} />
    {:else if activeTab === 'browse'}
      <Browse {plugin} {cardStore} {mindmapStore} {conceptStore} {jumpToMindmap} {openSourceRef} />
    {:else if activeTab === 'generate'}
      <Generate {plugin} {cardStore} {config} />
    {:else if activeTab === 'import'}
      <Import {cardStore} {conceptStore} {mindmapStore} {config} />
    {:else if activeTab === 'notebook'}
      <Notebook {plugin} sourceTarget={notebookTarget} {openConceptsFromNotebook} />
    {:else if activeTab === 'models'}
      <Models {plugin} />
    {:else if activeTab === 'concepts'}
      <Concepts {plugin} {conceptStore} {cardStore} {mindmapStore} {config} {openSourceRef} {jumpToMindmap} notebookTarget={conceptSourceTarget} />
    {:else if activeTab === 'mindmap'}
      <Mindmap {plugin} {cardStore} {mindmapStore} {conceptStore} {config} {jumpTarget} />
    {:else if activeTab === 'diagnostics'}
      <Diagnostics {plugin} {cardStore} {conceptStore} {mindmapStore} {config} />
    {:else if activeTab === 'stats'}
      <Stats {cardStore} />
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

  .aio-nav-spacer { flex: 1; }

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

  .aio-nav-logo {
    color: var(--b3-theme-primary);
    margin-bottom: 2px;
    svg { width: 18px; height: 18px; }
  }

  .aio-content {
    flex: 1;
    overflow: hidden;
    min-width: 0;
  }
</style>
