<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { getT } from '../libs/i18n';
  import type { Card } from '../libs/types';
  import { syncConceptMindmap } from '../libs/concept-mindmap-sync';
  import { renderToHTML, renderMath } from '../libs/render';
  import { activateSourceRef, formatSourceLabel, formatSourceText, getSourceAction } from '../libs/source-actions';
  import { showMessage, confirm } from 'siyuan';

  export let plugin: any;
  export let cardStore: any;
  export let mindmapStore: any;
  export let conceptStore: any;
  export let jumpToMindmap: (mindmapId: string) => void = () => {};
  export let openSourceRef: (ref: any) => Promise<boolean> = (ref) => activateSourceRef(ref);
  export let startFilteredReview: (ids: string[], title?: string) => void = () => {};

  const t = getT(plugin);

  let cards: Card[] = [];
  let searchQuery = '';
  let selectedDeck = '';
  let selectedTag = '';
  let decks: string[] = [];
  let tags: string[] = [];
  let expandedId: string | null = null;
  let selectedIds = new Set<string>();
  let syncingConceptMapForCardId = '';

  // 编辑 Dialog
  let editing: Card | null = null;
  let editQ = '';
  let editA = '';
  let editHint = '';
  let editDeck = '';
  let editTags = '';

  onMount(() => refresh());

  function refresh() {
    cards = cardStore.getAll();
    decks = cardStore.getDecks();
    tags = cardStore.getAllTags();
    expandedId = null;
    selectedIds = new Set();
  }

  $: filtered = cards.filter((c) => {
    if (selectedDeck && c.deck !== selectedDeck) return false;
    if (selectedTag && !c.tags.includes(selectedTag)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const conceptText = getCardConcepts(c)
        .map((concept: any) => `${concept.title || ''} ${concept.summary || ''} ${(concept.tags || []).join(' ')}`)
        .join(' ')
        .toLowerCase();
      return (
        c.question?.toLowerCase().includes(q) ||
        c.answer?.toLowerCase().includes(q) ||
        c.hint?.toLowerCase().includes(q) ||
        conceptText.includes(q)
      );
    }
    return true;
  });

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  function handleExpandKeydown(e: KeyboardEvent, id: string) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    toggleExpand(id);
  }

  function toggleSelect(id: string) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    selectedIds = new Set(selectedIds);
  }

  function deleteCard(id: string) {
    confirm('确认删除', '确定删除这张卡片吗？', () => {
      cardStore.delete(id);
      cardStore.save();
      refresh();
      showMessage('已删除');
    });
  }

  function batchDelete() {
    if (selectedIds.size === 0) return;
    confirm('确认删除', `确定删除选中的 ${selectedIds.size} 张卡片吗？`, () => {
      cardStore.deleteMany([...selectedIds]);
      cardStore.save();
      refresh();
      showMessage(`已删除 ${selectedIds.size} 张`);
    });
  }

  function reviewFilteredCards() {
    const ids = selectedIds.size > 0 ? [...selectedIds] : filtered.map((card) => card.id);
    if (ids.length === 0) {
      showMessage('没有可复习的卡片');
      return;
    }
    const title = selectedIds.size > 0
      ? `选中 ${selectedIds.size} 张`
      : buildFilteredReviewTitle(ids.length);
    startFilteredReview(ids, title);
  }

  function buildFilteredReviewTitle(count: number): string {
    const parts = [
      selectedDeck ? `牌组 ${selectedDeck}` : '',
      selectedTag ? `标签 ${selectedTag}` : '',
      searchQuery.trim() ? `搜索 ${searchQuery.trim()}` : '',
    ].filter(Boolean);
    return parts.length > 0 ? `${parts.join(' · ')} · ${count} 张` : `全部筛选 · ${count} 张`;
  }

  function startEdit(card: Card) {
    editing = { ...card };
    editQ = card.question;
    editA = card.answer;
    editHint = card.hint;
    editDeck = card.deck;
    editTags = card.tags.join(', ');
  }

  function saveEdit() {
    if (!editing) return;
    if (!editQ.trim() || !editA.trim()) {
      showMessage('问题和答案不能为空');
      return;
    }
    cardStore.update(editing.id, {
      question: editQ.trim(),
      answer: editA.trim(),
      hint: editHint.trim(),
      deck: editDeck.trim() || '默认',
      tags: editTags.split(',').map((s) => s.trim()).filter(Boolean),
    });
    cardStore.save();
    editing = null;
    refresh();
    showMessage('已保存');
  }

  function closeEdit() {
    editing = null;
  }

  function handleEditOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeEdit();
  }

  function getNextReview(status: string, due: number): string {
    if (status === 'new') return '立即';
    if (status === 'drill') return '机械练习';
    if (status === 'relearning') return '重新学习';
    const diff = due - Date.now();
    if (diff <= 0) return '逾期';
    const h = Math.round(diff / 3600000);
    if (h < 24) return `${h} 小时后`;
    return `${Math.round(h / 24)} 天后`;
  }

  function getCardConcepts(card: any): any[] {
    if (!conceptStore) return [];
    if (card.conceptId && conceptStore.getById?.(card.conceptId)) {
      return [conceptStore.getById(card.conceptId)];
    }
    return conceptStore.getByCardId?.(card.id) || [];
  }

  function sourceLabel(ref: any): string {
    return formatSourceLabel(ref);
  }

  function sourceText(ref: any): string {
    return formatSourceText(ref);
  }

  function sourceActionLabel(ref: any): string {
    return getSourceAction(ref).label || '查看来源';
  }

  async function openSource(ref: any) {
    const opened = await openSourceRef(ref);
    if (!opened) showMessage('没有可打开的来源定位');
  }

  function getLinkedMindmaps(card: Card): any[] {
    return mindmapStore?.getByCardId?.(card.id) || [];
  }

  async function openConceptMindmapForCard(card: Card) {
    if (!mindmapStore || !conceptStore) return;
    const linked = getLinkedMindmaps(card);
    if (linked.length > 0) {
      jumpToMindmap(linked[linked.length - 1].id);
      return;
    }
    if (getCardConcepts(card).length === 0) {
      showMessage('这张卡片还没有关联概念');
      return;
    }
    syncingConceptMapForCardId = card.id;
    try {
      const { saved } = await syncConceptMindmap(conceptStore, cardStore, mindmapStore, { title: '概念图谱' });
      refresh();
      jumpToMindmap(saved.id);
    } catch (error: any) {
      showMessage(`同步概念导图失败：${error?.message || error}`);
    } finally {
      syncingConceptMapForCardId = '';
    }
  }

  let listEl: HTMLElement;
  afterUpdate(() => {
    if (listEl) renderMath(listEl);
  });
</script>

<div class="browse-panel">
  <!-- 工具栏 -->
  <div class="browse-toolbar">
    <input class="b3-text-field" type="text" placeholder="搜索..." bind:value={searchQuery} />
    <select class="b3-select" bind:value={selectedDeck}>
      <option value="">全部牌组</option>
      {#each decks as deck}<option value={deck}>{deck}</option>{/each}
    </select>
    {#if tags.length > 0}
      <select class="b3-select" bind:value={selectedTag}>
        <option value="">全部标签</option>
        {#each tags as tag}<option value={tag}>{tag}</option>{/each}
      </select>
    {/if}
    {#if selectedIds.size > 0}
      <button class="b3-button b3-button--outline browse-btn-danger" on:click={batchDelete}>
        删除选中 ({selectedIds.size})
      </button>
    {/if}
    <button class="b3-button b3-button--outline browse-review-button" on:click={reviewFilteredCards} disabled={filtered.length === 0}>
      <svg><use xlink:href="#iconRefresh"></use></svg>
      <span>{selectedIds.size > 0 ? `复习选中 (${selectedIds.size})` : '复习筛选'}</span>
    </button>
  </div>

  <div class="browse-count">共 {filtered.length} 张</div>

  <!-- 卡片列表 -->
  <div class="browse-list" bind:this={listEl}>
    {#if filtered.length === 0}
      <div class="browse-empty">没有找到卡片</div>
    {:else}
      {#each filtered as card (card.id)}
        <div class="browse-item" class:expanded={expandedId === card.id}>
          <div class="browse-item-row">
            <input type="checkbox" checked={selectedIds.has(card.id)} on:change={() => toggleSelect(card.id)} />
            <div class="browse-item-main" on:click={() => toggleExpand(card.id)} on:keydown={(e) => handleExpandKeydown(e, card.id)} role="button" tabindex="0">
              <span class="browse-q">{@html renderToHTML(card.question)}</span>
              <div class="browse-meta">
                <span class="badge badge-deck">{card.deck}</span>
                <span class="badge badge-status-{card.status}">{getNextReview(card.status, card.due)}</span>
              </div>
            </div>
          </div>

          {#if expandedId === card.id}
            <div class="browse-detail">
              <div class="browse-detail-row"><strong>答案</strong><div class="browse-detail-content">{@html renderToHTML(card.answer)}</div></div>
              {#if card.hint}<div class="browse-detail-row"><strong>提示</strong><div class="browse-detail-content">{@html renderToHTML(card.hint)}</div></div>{/if}
              {#if card.tags.length}
                <div class="browse-detail-row"><strong>标签</strong>
                  <div class="browse-tags">{#each card.tags as tag}<span class="badge badge-tag">{tag}</span>{/each}</div>
                </div>
              {/if}
              {#if getCardConcepts(card).length > 0}
                <div class="browse-detail-row">
                  <strong>关联概念</strong>
                  <div class="browse-concepts">
                    {#each getCardConcepts(card) as concept}
                      <span class="badge badge-concept">{concept.title}</span>
                    {/each}
                    <button
                      class="b3-button b3-button--small b3-button--outline browse-concept-map-btn"
                      on:click={() => openConceptMindmapForCard(card)}
                      disabled={syncingConceptMapForCardId === card.id}
                    >
                      {syncingConceptMapForCardId === card.id ? '同步中...' : getLinkedMindmaps(card).length > 0 ? '打开概念导图' : '同步概念导图'}
                    </button>
                  </div>
                </div>
              {/if}
              {#if card.sourceRefs?.length}
                <div class="browse-detail-row">
                  <strong>证据来源</strong>
                  <div class="browse-evidence-list">
                    {#each card.sourceRefs.slice(0, 3) as ref}
                      <button
                        type="button"
                        class="browse-evidence"
                        title={sourceActionLabel(ref)}
                        on:click={() => openSource(ref)}
                      >
                        <span>{sourceLabel(ref)}</span>
                        {#if sourceText(ref)}
                          <q>{sourceText(ref)}</q>
                        {/if}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
              <div class="browse-detail-stats">
                <span>间隔 {card.interval}d</span>
                <span>难度 {Math.round(card.ease * 100)}%</span>
                <span>复习 {card.reps} 次</span>
              </div>
              {#if getLinkedMindmaps(card).length > 0}
                <div class="browse-detail-row">
                  <strong>关联导图</strong>
                  <div class="browse-linked-maps">
                    {#each getLinkedMindmaps(card) as lm}
                      <button class="b3-button b3-button--small b3-button--text browse-linked-map-button" on:click={() => jumpToMindmap(lm.id)}>
                        <svg><use xlink:href="#iconGraph"></use></svg>
                        <span>{lm.title}</span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
              <div class="browse-detail-actions">
                <button class="b3-button b3-button--small b3-button--outline" on:click={() => startEdit(card)}>编辑</button>
                <button class="b3-button b3-button--small b3-button--outline browse-btn-danger" on:click={() => deleteCard(card.id)}>删除</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<!-- 编辑弹窗 -->
{#if editing}
<div class="edit-overlay" on:click|self={closeEdit} on:keydown={handleEditOverlayKeydown} role="button" tabindex="0" aria-label="关闭编辑弹窗">
  <div class="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-card-title">
    <h3 id="edit-card-title">编辑卡片</h3>
    <label for="edit-card-question">问题</label>
    <textarea id="edit-card-question" class="b3-text-field" bind:value={editQ} rows="3"></textarea>
    <label for="edit-card-answer">答案</label>
    <textarea id="edit-card-answer" class="b3-text-field" bind:value={editA} rows="5"></textarea>
    <label for="edit-card-hint">提示</label>
    <input id="edit-card-hint" class="b3-text-field" type="text" bind:value={editHint} />
    <div class="edit-row">
      <div>
        <label for="edit-card-deck">牌组</label>
        <input id="edit-card-deck" class="b3-text-field" type="text" bind:value={editDeck} />
      </div>
    </div>
    <label for="edit-card-tags">标签（逗号分隔）</label>
    <input id="edit-card-tags" class="b3-text-field" type="text" bind:value={editTags} />
    <div class="edit-actions">
      <button class="b3-button b3-button--outline" on:click={closeEdit}>取消</button>
      <button class="b3-button b3-button--text" on:click={saveEdit}>保存</button>
    </div>
  </div>
</div>
{/if}

<style lang="scss">
  .browse-panel { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  .browse-toolbar {
    display: flex; gap: 8px; padding: 24px 24px 12px; flex-shrink: 0;
    .b3-text-field { flex: 1; min-width: 0; }
    .b3-select { width: auto; min-width: 90px; }
  }

  .browse-count { padding: 0 24px 4px; font-size: var(--aio-fs-sm); opacity: 0.6; flex-shrink: 0; }
  .browse-review-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    svg { width: 14px; height: 14px; }
  }
  .browse-list { flex: 1; overflow-y: auto; padding: 0 24px 24px; box-sizing: border-box; }
  .browse-empty { text-align: center; padding: 32px; opacity: 0.4; }

  .browse-item {
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    margin-bottom: 6px;
    overflow: hidden;
    &.expanded { border-color: var(--b3-theme-primary); }
  }

  .browse-item-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; }
  .browse-item-main { flex: 1; cursor: pointer; min-width: 0; }
  .browse-q {
    font-size: var(--aio-fs-base); display: block;
    overflow: hidden; max-height: 3em; line-height: 1.5;
    word-break: break-word; overflow-wrap: break-word;
  }
  .browse-meta { display: flex; gap: 4px; margin-top: 4px; }

  .badge {
    font-size: var(--aio-fs-xs); padding: 1px 6px; border-radius: 3px; white-space: nowrap;
    background: var(--b3-theme-surface-lighter);
  }
  .badge-deck { background: var(--b3-theme-surface-lighter); }
  .badge-type { background: var(--b3-card-info-background); color: var(--b3-card-info-color); }
  .badge-status-new { background: var(--b3-card-info-background); color: var(--b3-card-info-color); }
  .badge-status-learning { background: var(--b3-card-warning-background); color: var(--b3-card-warning-color); }
  .badge-status-review { background: var(--b3-card-success-background); color: var(--b3-card-success-color); }
  .badge-status-buried { background: var(--b3-card-error-background); color: var(--b3-card-error-color); }
  .badge-status-drill { background: var(--b3-theme-warning-lightest); color: var(--b3-theme-warning); }
  .badge-status-relearning { background: var(--b3-card-warning-background); color: var(--b3-card-warning-color); }
  .badge-tag { background: var(--b3-theme-surface-lighter); }
  .badge-concept { background: var(--b3-theme-primary-lightest); color: var(--b3-theme-primary); }

  .browse-detail {
    padding: 10px; border-top: 1px solid var(--b3-theme-surface-lighter);
    background: var(--b3-theme-background);
  }
  .browse-detail-row { margin-bottom: 8px;
    strong { font-size: var(--aio-fs-sm); color: var(--b3-theme-primary); display: block; margin-bottom: 4px; }
  }
  .browse-detail-content {
    font-size: var(--aio-fs-base); line-height: 1.7; word-break: break-word;
    :global(p) { margin: 0 0 4px; }
  }
  .browse-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .browse-concepts { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .browse-concept-map-btn { margin-left: 2px; }
  .browse-evidence-list { display: flex; flex-direction: column; gap: 5px; }
  .browse-evidence {
    display: flex; flex-direction: column; gap: 2px;
    width: 100%;
    padding: 6px 8px; border-left: 2px solid var(--b3-theme-primary-light);
    border-top: 0; border-right: 0; border-bottom: 0;
    border-radius: 4px; background: var(--b3-theme-surface);
    color: inherit; cursor: pointer; font: inherit; text-align: left;
    span { font-size: var(--aio-fs-xs); color: var(--b3-theme-primary); opacity: 0.85; word-break: break-word; }
    q { font-size: var(--aio-fs-xs); line-height: 1.45; opacity: 0.72; quotes: none; word-break: break-word; }
    &:hover { background: var(--b3-theme-surface-light); }
  }
  .browse-detail-stats { display: flex; gap: 12px; font-size: var(--aio-fs-xs); opacity: 0.5; margin-bottom: 8px; }
  .browse-linked-maps { display: flex; flex-wrap: wrap; gap: 4px; }
  .browse-linked-map-button { display: inline-flex; align-items: center; gap: 4px; }
  .browse-linked-map-button svg { width: 14px; height: 14px; }
  .browse-detail-actions { display: flex; gap: 6px; }
  .browse-btn-danger { color: var(--b3-card-error-color) !important; }

  .edit-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center; z-index: 999;
  }
  .edit-dialog {
    background: var(--b3-theme-background); border-radius: 8px; padding: 20px;
    width: 500px; max-height: 80vh; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
    h3 { margin: 0 0 8px; }
    label { font-size: var(--aio-fs-sm); font-weight: 500; margin-top: 4px; }
  }
  .edit-row { display: flex; gap: 8px;
    > div { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  }
  .edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
</style>
