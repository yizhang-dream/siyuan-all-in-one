<script lang="ts">
  import { searchSiyuanDocs } from '../libs/sources';
  import type { SourceConfig, DocItem } from '../libs/sources';

  export let config: SourceConfig;

  let docQuery = '';
  let docResults: DocItem[] = [];
  let searching = false;

  function setType(type: any) {
    config = { ...config, type };
    config = config; // 触发响应式
  }

  async function searchDocs() {
    if (!docQuery.trim()) return;
    searching = true;
    docResults = await searchSiyuanDocs(docQuery);
    searching = false;
  }

  function selectDoc(doc: DocItem) {
    const ids = config.siyuanDocIds || [];
    const idx = ids.indexOf(doc.id);
    if (idx >= 0) {
      config = { ...config, siyuanDocIds: ids.filter((id) => id !== doc.id) };
    } else {
      config = { ...config, siyuanDocIds: [...ids, doc.id] };
    }
    config = config;
  }
</script>

<div class="source-picker">
  <div class="source-label">知识来源</div>
  <div class="source-tabs">
    <button class="b3-button b3-button--small" class:b3-button--outline={config.type !== 'none'} on:click={() => setType('none')}>无</button>
    <button class="b3-button b3-button--small" class:b3-button--outline={config.type !== 'siyuan'} on:click={() => setType('siyuan')}>思源文档</button>
    <button class="b3-button b3-button--small" class:b3-button--outline={config.type !== 'manual'} on:click={() => setType('manual')}>手动输入</button>
  </div>

  {#if config.type === 'siyuan'}
    <div class="source-row">
      <input
        class="b3-text-field"
        type="text"
        placeholder="搜索思源文档..."
        bind:value={docQuery}
        on:keydown={(e) => { if (e.key === 'Enter') searchDocs(); }}
      />
      <button class="b3-button b3-button--outline" on:click={searchDocs} disabled={searching}>
        {searching ? '...' : '搜索'}
      </button>
    </div>
    {#if docResults.length > 0}
      <div class="source-doc-list">
        {#each docResults.slice(0, 10) as doc}
          <button
            class="source-doc-item"
            class:selected={(config.siyuanDocIds || []).includes(doc.id)}
            on:click={() => selectDoc(doc)}
          >
            <svg><use xlink:href="#iconFiles"></use></svg>
            <span>{doc.title}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if config.siyuanDocIds?.length > 0}
      <p class="source-hint source-hint--ok">
        <svg><use xlink:href="#iconCheck"></use></svg>
        <span>已选择文档</span>
      </p>
    {/if}
  {/if}

  {#if config.type === 'manual'}
    <textarea
      class="b3-text-field"
      rows="4"
      placeholder="粘贴或输入参考内容..."
      bind:value={config.manualText}
    ></textarea>
  {/if}
</div>

<style lang="scss">
  .source-picker {
    display: flex; flex-direction: column; gap: 6px;
    .source-label { font-size: var(--aio-fs-base); font-weight: 500; margin-top: 6px; }
  }
  .source-tabs {
    display: flex; gap: 4px;
    .b3-button { flex: 1; font-size: var(--aio-fs-sm); }
  }
  .source-row {
    display: flex; gap: 6px;
    .b3-text-field { flex: 1; }
  }
  .source-doc-list {
    max-height: 200px; overflow-y: auto;
    border: 1px solid var(--b3-theme-surface-lighter); border-radius: 4px;
  }
  .source-doc-item {
    display: flex; align-items: center; gap: 6px; width: 100%; text-align: left;
    padding: 6px 10px; border: none; background: none; cursor: pointer;
    font-size: var(--aio-fs-base); color: var(--b3-theme-on-background);
    svg { width: 14px; height: 14px; flex: 0 0 14px; color: var(--b3-theme-on-surface); }
    span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    &:hover { background: var(--b3-theme-surface-light); }
    &.selected { background: var(--b3-theme-primary-lightest); color: var(--b3-theme-primary); }
    &.selected svg { color: var(--b3-theme-primary); }
  }
  .source-hint {
    display: flex; align-items: center; gap: 4px;
    font-size: var(--aio-fs-sm); opacity: 0.7; margin: 0;
    svg { width: 14px; height: 14px; flex: 0 0 14px; }
    &.source-hint--ok { color: var(--b3-card-success-color); opacity: 1; }
  }
</style>
