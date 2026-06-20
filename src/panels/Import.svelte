<script lang="ts">
  import { createCard } from '../libs/srs';
  import { parseAnkiFile, calcStats } from '../libs/anki';
  import type { ParsedCard } from '../libs/anki';
  import { buildExportPayload, type ExportFormat } from '../libs/exporters';
  import { showMessage } from 'siyuan';

  export let cardStore: any;
  export let conceptStore: any;
  export let mindmapStore: any;
  export let config: any;

  let cards: ParsedCard[] = [];
  let stats = { total: 0, duplicates: 0, importable: 0 };
  let status = '';
  let isWorking = false;
  let fileName = '';
  let hideDuplicates = true;
  let exportFormat: ExportFormat = 'cards-json';

  const exportFormatOptions: Array<{ value: ExportFormat; label: string; hint: string }> = [
    { value: 'cards-json', label: '卡片 JSON', hint: '完整保留 SM-2、conceptId、sourceRefs' },
    { value: 'cards-csv', label: '卡片 CSV', hint: '适合表格软件查看和二次清洗' },
    { value: 'anki-tsv', label: 'Anki TSV', hint: '正面、背面、提示、牌组、标签' },
    { value: 'cards-markdown', label: '卡片 Markdown', hint: '适合阅读、归档或导入笔记' },
    { value: 'concepts-json', label: '概念图 JSON', hint: '概念、关系、卡片关联一起导出' },
    { value: 'mindmaps-markdown', label: '导图 Markdown', hint: '导出 markmap 兼容缩进列表' },
  ];

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleFile(file);
  }

  async function handleFile(file: File) {
    fileName = file.name;
    status = `正在解析 ${file.name}...`;
    isWorking = true;
    cards = [];

    try {
      const defaultDeck = config?.defaultDeck || 'Anki 导入';
      const parsed = await parseAnkiFile(file, defaultDeck, (q) => cardStore.isDuplicate(q));
      cards = parsed;
      stats = calcStats(parsed);
      status = `解析完成：共 ${stats.total} 张，已存在 ${stats.duplicates} 张，可导入 ${stats.importable} 张`;
    } catch (e: any) {
      status = `❌ 解析失败：${e.message}`;
      console.error('[import]', e);
    }
    isWorking = false;
  }

  function removeCard(idx: number) {
    cards = cards.filter((_, i) => i !== idx);
    stats = calcStats(cards);
  }

  function toggleDuplicate(card: ParsedCard) {
    card.duplicate = !card.duplicate;
    cards = [...cards];
    stats = calcStats(cards);
  }

  function editCard(idx: number, field: keyof ParsedCard, value: string) {
    (cards[idx] as any)[field] = value;
    cards = [...cards];
  }

  async function confirmImport() {
    const toImport = cards.filter((c) => !c.duplicate);
    if (toImport.length === 0) {
      showMessage('没有可导入的卡片');
      return;
    }

    let added = 0;
    for (const c of toImport) {
      if (!c.question || !c.answer) continue;
      const card = createCard(c.question, c.answer, c.hint, c.deck, c.tags);
      cardStore.add(card);
      added++;
    }
    await cardStore.save();
    showMessage(`成功导入 ${added} 张卡片`);
    cards = [];
    stats = { total: 0, duplicates: 0, importable: 0 };
    status = `✅ 已导入 ${added} 张卡片`;
  }

  function exportData() {
    const payload = buildExportPayload(exportFormat, {
      cards: cardStore?.getAll?.() || [],
      concepts: conceptStore?.getAll?.() || [],
      relations: conceptStore?.getRelations?.() || [],
      mindmaps: mindmapStore?.getAll?.() || [],
    });
    downloadText(payload.filename, payload.content, payload.mime);
    showMessage(`已导出 ${payload.filename}`);
  }

  function downloadText(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // 筛选展示
  $: displayCards = hideDuplicates ? cards.filter((c) => !c.duplicate) : cards;
  $: exportCounts = {
    cards: cardStore?.getAll?.().length || 0,
    concepts: conceptStore?.getAll?.().length || 0,
    relations: conceptStore?.getRelations?.().length || 0,
    mindmaps: mindmapStore?.getAll?.().length || 0,
  };
  $: selectedExportHint = exportFormatOptions.find((item) => item.value === exportFormat)?.hint || '';
</script>

<div class="import-panel">
  <div class="import-intro">
    <h2>导入与导出</h2>
    <p>导入 Anki 卡片，或把卡片、概念图谱、导图导出到常见格式，方便迁移、备份和二次加工。</p>
  </div>

  <section class="import-export-block">
    <div class="import-section-head">
      <div>
        <h3>导出</h3>
        <p>{exportCounts.cards} 张卡片 · {exportCounts.concepts} 个概念 · {exportCounts.relations} 条关系 · {exportCounts.mindmaps} 张导图</p>
      </div>
      <button class="b3-button" on:click={exportData}>导出</button>
    </div>
    <div class="export-controls">
      <label>
        <span>格式</span>
        <select class="b3-select" bind:value={exportFormat}>
          {#each exportFormatOptions as item}
            <option value={item.value}>{item.label}</option>
          {/each}
        </select>
      </label>
      <p>{selectedExportHint}</p>
    </div>
  </section>

  <section class="import-export-block">
    <div class="import-section-head">
      <div>
        <h3>从 Anki 导入</h3>
        <p>选择 Anki 导出的 <code>.apkg</code> 包或 <code>.txt/.csv</code> 文本文件。导入前可预览、去重、编辑。</p>
      </div>
    </div>
    <div class="import-tips">
      <p>📌 导出方法：</p>
      <ul>
        <li><strong>.apkg</strong>：Anki → 导出 → 勾选「支持旧版 Anki」→ 保存为 .apkg</li>
        <li><strong>.txt</strong>：Anki → 导出 → 格式选「记忆卡为纯文本」→ Tab 分隔</li>
      </ul>
    </div>

    <!-- 文件选择 -->
    <div class="import-file-area">
      <label class="b3-button b3-button--outline import-file-btn">
        选择文件 (.apkg / .txt / .csv)
        <input type="file" accept=".apkg,.txt,.csv" on:change={onFileChange} hidden />
      </label>
      {#if fileName}
        <span class="import-filename">{fileName}</span>
      {/if}
    </div>
  </section>

  {#if isWorking}
    <div class="import-status">{status}</div>
  {/if}

  {#if cards.length > 0}
    <!-- 统计 + 操作 -->
    <div class="import-summary">
      <div class="import-stats">
        <span class="import-stat">共 {stats.total} 张</span>
        <span class="import-stat import-stat--dup">已存在 {stats.duplicates} 张</span>
        <span class="import-stat import-stat--ok">可导入 {stats.importable} 张</span>
      </div>
      <div class="import-actions">
        <label class="import-check">
          <input type="checkbox" bind:checked={hideDuplicates} /> 隐藏已存在
        </label>
        <button class="b3-button b3-button--text" on:click={confirmImport} disabled={stats.importable === 0}>
          导入 {stats.importable} 张
        </button>
      </div>
    </div>

    <!-- 预览列表 -->
    <div class="import-list">
      {#each displayCards as card, idx (cards.indexOf(card))}
        <div class="import-card" class:import-card--dup={card.duplicate}>
          <div class="import-card-num">{cards.indexOf(card) + 1}</div>
          <div class="import-card-body">
            <input
              class="b3-text-field import-input"
              value={card.question}
              on:input={(e) => editCard(cards.indexOf(card), 'question', e.target.value)}
              placeholder="问题"
            />
            <textarea
              class="b3-text-field import-input"
              rows="2"
              on:input={(e) => editCard(cards.indexOf(card), 'answer', e.target.value)}>{card.answer}</textarea>
            <div class="import-card-meta">
              <span class="import-badge import-badge--deck">{card.deck}</span>
              {#if card.duplicate}
                <span class="import-badge import-badge--dup">已存在</span>
              {/if}
              {#if card.tags.length}
                {#each card.tags.slice(0, 3) as tag}
                  <span class="import-badge import-badge--tag">{tag}</span>
                {/each}
              {/if}
            </div>
          </div>
          <div class="import-card-actions">
            {#if card.duplicate}
              <button class="b3-button b3-button--small" on:click={() => toggleDuplicate(card)} title="标记为导入">↩</button>
            {:else}
              <button class="b3-button b3-button--small import-btn-skip" on:click={() => toggleDuplicate(card)} title="跳过此卡">⊘</button>
            {/if}
            <button class="b3-button b3-button--small import-btn-del" on:click={() => removeCard(cards.indexOf(card))} title="删除">✕</button>
          </div>
        </div>
      {/each}
    </div>
  {:else if !isWorking && status}
    <div class="import-status">{status}</div>
  {/if}
</div>

<style lang="scss">
  .import-panel { padding: 24px; height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }

  .import-intro {
    h2 { font-size: var(--aio-fs-lg); margin: 0 0 8px; }
    p { font-size: var(--aio-fs-base); color: var(--b3-theme-on-surface); line-height: 1.6; margin: 0 0 8px;
      code { background: var(--b3-theme-surface-lighter); padding: 1px 4px; border-radius: 3px; font-size: var(--aio-fs-xs); }
    }
  }

  .import-tips {
    font-size: var(--aio-fs-sm); color: var(--b3-theme-on-surface); line-height: 1.6;
    padding: 8px 12px; background: var(--b3-theme-surface-light); border-radius: 6px;
    p { margin: 0 0 4px; font-weight: 500; }
    ul { margin: 0; padding-left: 20px; }
    li { margin-bottom: 2px; }
  }

  .import-export-block {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    background: var(--b3-theme-background);
  }

  .import-section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;

    h3 {
      margin: 0 0 4px;
      font-size: var(--aio-fs-md);
    }

    p {
      margin: 0;
      font-size: var(--aio-fs-sm);
      color: var(--b3-theme-on-surface);
      opacity: 0.72;
    }
  }

  .export-controls {
    display: grid;
    grid-template-columns: minmax(180px, 280px) minmax(0, 1fr);
    gap: 10px;
    align-items: end;

    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    span {
      font-size: var(--aio-fs-xs);
      opacity: 0.65;
    }

    p {
      margin: 0;
      font-size: var(--aio-fs-sm);
      line-height: 1.5;
      opacity: 0.72;
    }
  }

  .import-file-area { display: flex; align-items: center; gap: 12px; }
  .import-file-btn { cursor: pointer; }
  .import-filename { font-size: var(--aio-fs-base); opacity: 0.7; }

  .import-status {
    padding: 10px; border-radius: 4px; background: var(--b3-theme-surface-lighter);
    font-size: var(--aio-fs-base); text-align: center; line-height: 1.5;
  }

  .import-summary {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 12px; background: var(--b3-theme-surface-light); border-radius: 6px; flex-wrap: wrap; gap: 8px;
  }
  .import-stats { display: flex; gap: 12px; }
  .import-stat { font-size: var(--aio-fs-base); font-weight: 500; }
  .import-stat--dup { color: var(--b3-card-warning-color); }
  .import-stat--ok { color: var(--b3-card-success-color); }
  .import-actions { display: flex; align-items: center; gap: 12px; }
  .import-check { font-size: var(--aio-fs-sm); display: flex; align-items: center; gap: 4px; }

  .import-list { display: flex; flex-direction: column; gap: 8px; }

  .import-card {
    display: flex; gap: 8px; border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px; padding: 8px; transition: opacity 0.2s;
    &.import-card--dup { opacity: 0.5; }
  }
  .import-card-num { font-size: var(--aio-fs-base); font-weight: 600; color: var(--b3-theme-primary); min-width: 24px; }
  .import-card-body { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .import-input { font-size: var(--aio-fs-base) !important; padding: 4px 8px !important; }
  .import-card-meta { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
  .import-badge {
    font-size: var(--aio-fs-xs); padding: 1px 6px; border-radius: 3px; white-space: nowrap;
    background: var(--b3-theme-surface-lighter);
  }
  .import-badge--deck { background: var(--b3-theme-surface-lighter); }
  .import-badge--dup { background: var(--b3-card-warning-background); color: var(--b3-card-warning-color); }
  .import-badge--tag { background: var(--b3-theme-surface-light); }

  .import-card-actions { display: flex; flex-direction: column; gap: 4px; }
  .import-btn-skip { opacity: 0.6; }
  .import-btn-del { color: var(--b3-card-error-color); }

  @media (max-width: 720px) {
    .import-section-head,
    .export-controls {
      grid-template-columns: 1fr;
    }

    .import-section-head {
      flex-direction: column;
    }
  }
</style>
