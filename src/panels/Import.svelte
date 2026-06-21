<script lang="ts">
  import { onMount } from 'svelte';
  import { createCard } from '../libs/srs';
  import { parseAnkiFile, calcStats } from '../libs/anki';
  import type { ParsedCard } from '../libs/anki';
  import { buildExportPayload, exportPayloadToSiyuanMarkdown, type ExportFormat } from '../libs/exporters';
  import { parsePluginImport, type PluginImportPayload } from '../libs/importers';
  import { auditRiffSyncProjection, cleanRiffSyncState, syncCardsToSiyuanRiff, type RiffProjectionAudit } from '../libs/riff-sync';
  import { saveToSiyuan, openDoc } from '../libs/siyuan';
  import { showMessage, confirm } from 'siyuan';

  export let plugin: any;
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
  let exportIncludeCards = true;
  let exportIncludeConcepts = true;
  let exportIncludeRelations = true;
  let exportIncludeMindmaps = true;
  let restorePayload: PluginImportPayload | null = null;
  let riffSyncing = false;
  let riffSyncStatus = '';
  let riffDeckName = '知识闪卡 All-in-One';
  let riffMaxCards = 200;
  let riffSyncRecordCount = 0;
  let riffAudit: RiffProjectionAudit | null = null;

  onMount(() => {
    refreshRiffSyncStatus();
  });

  const exportFormatOptions: Array<{ value: ExportFormat; label: string; hint: string }> = [
    { value: 'cards-json', label: '卡片 JSON', hint: '完整保留 SM-2/FSRS、conceptId、sourceRefs' },
    { value: 'cards-csv', label: '卡片 CSV', hint: '适合表格软件查看和二次清洗' },
    { value: 'anki-tsv', label: 'Anki TSV', hint: '正面、背面、提示、牌组、标签' },
    { value: 'cards-markdown', label: '卡片 Markdown', hint: '适合阅读、归档或导入笔记' },
    { value: 'concepts-json', label: '概念图 JSON', hint: '概念、关系、卡片关联一起导出' },
    { value: 'mindmaps-markdown', label: '导图 Markdown', hint: '导出 markmap 兼容缩进列表和关联元数据' },
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
    stats = { total: 0, duplicates: 0, importable: 0 };
    restorePayload = null;

    try {
      if (isPluginBackupFile(file)) {
        const text = await file.text();
        const parsed = parsePluginImport(text, file.name);
        if (hasImportablePluginPayload(parsed)) {
          restorePayload = parsed;
          status = `解析完成：识别到 ${formatPluginImportSummary(parsed)}`;
          isWorking = false;
          return;
        }
        throw new Error(parsed.warnings.join('；') || '未识别为插件备份文件');
      }
      const defaultDeck = config?.defaultDeck || 'Anki 导入';
      const parsed = await parseAnkiFile(file, defaultDeck, (q) => cardStore.isDuplicate(q));
      cards = parsed;
      stats = calcStats(parsed);
      status = `解析完成：共 ${stats.total} 张，已存在 ${stats.duplicates} 张，可导入 ${stats.importable} 张`;
    } catch (e: any) {
      status = `解析失败：${e.message}`;
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
    status = `已导入 ${added} 张卡片`;
  }

  async function confirmPluginImport() {
    if (!restorePayload || !hasImportablePluginPayload(restorePayload)) {
      showMessage('没有可恢复的插件数据');
      return;
    }

    let cardResult = { added: 0, updated: 0 };
    let conceptResult = { conceptsAdded: 0, conceptsUpdated: 0, relationsAdded: 0, relationsUpdated: 0, relationsSkipped: 0 };
    let mindmapResult = { added: 0, updated: 0 };

    if (restorePayload.cards.length) {
      cardResult = cardStore.importCards(restorePayload.cards);
      await cardStore.save();
    }
    if (restorePayload.concepts.length || restorePayload.relations.length) {
      conceptResult = conceptStore.importGraph(restorePayload.concepts, restorePayload.relations);
      await conceptStore.save();
    }
    if (restorePayload.mindmaps.length) {
      mindmapResult = mindmapStore.importMindmaps(restorePayload.mindmaps);
      await mindmapStore.save();
    }

    const summary = [
      `卡片新增 ${cardResult.added}/更新 ${cardResult.updated}`,
      `概念新增 ${conceptResult.conceptsAdded}/更新 ${conceptResult.conceptsUpdated}`,
      `关系新增 ${conceptResult.relationsAdded}/更新 ${conceptResult.relationsUpdated}`,
      `导图新增 ${mindmapResult.added}/更新 ${mindmapResult.updated}`,
    ];
    if (conceptResult.relationsSkipped) summary.push(`跳过关系 ${conceptResult.relationsSkipped}`);
    status = `恢复完成：${summary.join('；')}`;
    showMessage(status);
    restorePayload = null;
  }

  function exportData() {
    const payload = buildExportPayload(exportFormat, buildExportSnapshot());
    downloadText(payload.filename, payload.content, payload.mime);
    showMessage(`已导出 ${payload.filename}`);
  }

  async function exportDataToSiyuan() {
    const payload = buildExportPayload(exportFormat, buildExportSnapshot());
    const markdown = exportPayloadToSiyuanMarkdown(payload.filename, payload.content);
    try {
      const docId = await saveToSiyuan(markdown, payload.filename.replace(/\.[^.]+$/, ''));
      if (docId) {
        showMessage('已导出到思源文档');
        const app = pluginApp();
        if (app) openDoc(docId, app);
      }
    } catch (e: any) {
      showMessage('导出到思源失败：' + (e?.message || e));
    }
  }

  async function syncToSiyuanRiff() {
    const allCards = cardStore?.getAll?.() || [];
    const eligibleCount = allCards.filter((card: any) => card.question?.trim() && card.answer?.trim()).length;
    const maxCards = Math.max(1, Math.min(500, Number(riffMaxCards) || 200));
    if (eligibleCount === 0) {
      showMessage('没有可同步的卡片');
      return;
    }
    const syncState = await loadRiffSyncState();
    const targetDeckName = riffDeckName || '知识闪卡 All-in-One';
    const alreadySyncedCount = syncState.records.filter((record) => sameDeckName(record.deckName, targetDeckName)).length;
    confirm(
      '同步到思源闪卡',
      `将创建思源文档块，并把最多 ${Math.min(eligibleCount, maxCards)} 张未同步卡片加入卡包「${targetDeckName}」。已记录同步 ${alreadySyncedCount} 张会自动跳过。确定继续吗？`,
      async () => {
        riffSyncing = true;
        riffSyncStatus = '正在同步到思源闪卡...';
        try {
          const result = await syncCardsToSiyuanRiff(allCards, {
            deckName: targetDeckName,
            maxCards,
            existingRecords: syncState.records,
          });
          await saveRiffSyncState(result.nextRecords);
          riffSyncRecordCount = result.nextRecords.length;
          await refreshRiffSyncStatus();
          const deckLabel = result.deck?.name || targetDeckName;
          const changedCount = result.blockIds.length + result.updatedBlockIds.length;
          riffSyncStatus = changedCount > 0
            ? `同步完成：新增 ${result.blockIds.length} 个块，更新 ${result.updatedBlockIds.length} 个块，跳过 ${result.skippedCardIds.length} 张已同步卡片；卡包「${deckLabel}」`
            : `没有新的卡片需要同步，已跳过 ${result.skippedCardIds.length} 张`;
          showMessage(riffSyncStatus);
          const app = pluginApp();
          if (app && result.docId) openDoc(result.docId, app);
        } catch (e: any) {
          riffSyncStatus = '同步到思源闪卡失败：' + (e?.message || e);
          showMessage(riffSyncStatus);
        } finally {
          riffSyncing = false;
        }
      }
    );
  }

  async function resetRiffSyncState() {
    const syncState = await loadRiffSyncState();
    if (syncState.records.length === 0) {
      showMessage('没有可重置的同步记录');
      return;
    }
    confirm(
      '重置同步状态',
      `将清除 ${syncState.records.length} 条本机同步记录。不会删除思源文档块或卡包中的闪卡；下次同步会重新创建块。确定继续吗？`,
      async () => {
        await saveRiffSyncState([]);
        riffSyncRecordCount = 0;
        await refreshRiffSyncStatus();
        riffSyncStatus = '已重置本机同步状态';
        showMessage(riffSyncStatus);
      }
    );
  }

  async function refreshRiffSyncStatus() {
    const syncState = await loadRiffSyncState();
    riffSyncRecordCount = syncState.records.length;
    riffAudit = auditRiffSyncProjection(cardStore?.getAll?.() || [], syncState.records, riffDeckName || '知识闪卡 All-in-One');
  }

  async function loadRiffSyncState() {
    try {
      return cleanRiffSyncState(await plugin?.loadData?.('riff-sync'));
    } catch {
      return cleanRiffSyncState(null);
    }
  }

  async function saveRiffSyncState(records: any[]) {
    await plugin?.saveData?.('riff-sync', { version: 1, records });
  }

  function sameDeckName(a: string, b: string): boolean {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function riffAuditPreview() {
    return (riffAudit?.entries || [])
      .filter((entry) => entry.status !== 'fresh')
      .slice(0, 8);
  }

  function riffStatusLabel(status: string): string {
    if (status === 'fresh') return '已同步';
    if (status === 'stale') return '需更新';
    if (status === 'unsynced') return '未同步';
    if (status === 'orphan') return '孤儿记录';
    return status;
  }

  function buildExportSnapshot() {
    return {
      cards: exportIncludeCards ? (cardStore?.getAll?.() || []) : [],
      concepts: exportIncludeConcepts ? (conceptStore?.getAll?.() || []) : [],
      relations: exportIncludeRelations ? (conceptStore?.getRelations?.() || []) : [],
      mindmaps: exportIncludeMindmaps ? (mindmapStore?.getAll?.() || []) : [],
    };
  }

  function pluginApp() {
    return plugin?.app;
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

  function isPluginBackupFile(file: File): boolean {
    return /\.(json|md|markdown)$/i.test(file.name);
  }

  function hasImportablePluginPayload(payload: PluginImportPayload): boolean {
    return payload.cards.length + payload.concepts.length + payload.relations.length + payload.mindmaps.length > 0;
  }

  function formatPluginImportSummary(payload: PluginImportPayload): string {
    return [
      payload.cards.length ? `${payload.cards.length} 张卡片` : '',
      payload.concepts.length ? `${payload.concepts.length} 个概念` : '',
      payload.relations.length ? `${payload.relations.length} 条关系` : '',
      payload.mindmaps.length ? `${payload.mindmaps.length} 张导图` : '',
    ].filter(Boolean).join(' · ');
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
  $: selectedExportCounts = buildExportSnapshot();
  $: exportDisabled =
    selectedExportCounts.cards.length +
    selectedExportCounts.concepts.length +
    selectedExportCounts.relations.length +
    selectedExportCounts.mindmaps.length === 0;
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
      <div class="export-actions">
        <button class="b3-button b3-button--outline" on:click={exportDataToSiyuan} disabled={exportDisabled}>
          <svg><use xlink:href="#iconUpload"></use></svg>
          导出到思源
        </button>
        <button class="b3-button" on:click={exportData} disabled={exportDisabled}>导出文件</button>
      </div>
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
    <div class="export-scope" role="group" aria-label="导出内容">
      <label><input type="checkbox" bind:checked={exportIncludeCards} /> 卡片</label>
      <label><input type="checkbox" bind:checked={exportIncludeConcepts} /> 概念</label>
      <label><input type="checkbox" bind:checked={exportIncludeRelations} /> 关系</label>
      <label><input type="checkbox" bind:checked={exportIncludeMindmaps} /> 导图</label>
    </div>
  </section>

  <section class="import-export-block">
    <div class="import-section-head">
      <div>
        <h3>思源闪卡</h3>
        <p>写入思源文档块，并保留卡片、概念和来源属性；本机已记录 {riffSyncRecordCount} 张。</p>
      </div>
      <div class="riff-sync-actions">
        <button class="b3-button b3-button--outline riff-sync-button" on:click={refreshRiffSyncStatus} disabled={riffSyncing} title="刷新同步状态">
          <svg><use xlink:href="#iconRefresh"></use></svg>
          刷新
        </button>
        <button class="b3-button b3-button--outline riff-sync-button" on:click={resetRiffSyncState} disabled={riffSyncRecordCount === 0 || riffSyncing}>
          清除记录
        </button>
        <button class="b3-button b3-button--outline riff-sync-button" on:click={syncToSiyuanRiff} disabled={exportCounts.cards === 0 || riffSyncing}>
          <svg><use xlink:href="#iconRefresh"></use></svg>
          {riffSyncing ? '同步中' : '同步到卡包'}
        </button>
      </div>
    </div>
    <div class="riff-sync-controls">
      <label>
        <span>卡包</span>
        <input class="b3-text-field" bind:value={riffDeckName} aria-label="思源闪卡卡包" on:change={refreshRiffSyncStatus} />
      </label>
      <label>
        <span>数量</span>
        <input class="b3-text-field" type="number" min="1" max="500" bind:value={riffMaxCards} aria-label="思源闪卡同步数量" />
      </label>
    </div>
    {#if riffAudit}
      <div class="riff-audit">
        <div class="riff-audit-stats" aria-label="思源闪卡同步审计">
          <span>可同步 {riffAudit.eligibleCards}</span>
          <span>已同步 {riffAudit.fresh}</span>
          <span>需更新 {riffAudit.stale}</span>
          <span>未同步 {riffAudit.unsynced}</span>
          <span>孤儿记录 {riffAudit.orphanRecords}</span>
        </div>
        {#if riffAuditPreview().length > 0}
          <div class="riff-audit-list">
            {#each riffAuditPreview() as entry (`${entry.status}-${entry.cardId}-${entry.blockId}`)}
              <div class="riff-audit-row" class:riff-audit-row--stale={entry.status === 'stale'} class:riff-audit-row--orphan={entry.status === 'orphan'}>
                <span>{riffStatusLabel(entry.status)}</span>
                <strong>{entry.question || entry.cardId}</strong>
                {#if entry.blockId}<em>{entry.blockId}</em>{/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    {#if riffSyncStatus}
      <div class="riff-sync-status">{riffSyncStatus}</div>
    {/if}
  </section>

  <section class="import-export-block">
    <div class="import-section-head">
      <div>
        <h3>从 Anki 导入</h3>
        <p>选择 Anki 导出的 <code>.apkg</code> 包、<code>.txt/.csv</code> 文本文件，或本插件导出的 <code>.json/.md</code> 备份文件。</p>
      </div>
    </div>
    <div class="import-tips">
      <p>可识别格式</p>
      <ul>
        <li><strong>.apkg</strong>：Anki → 导出 → 勾选「支持旧版 Anki」→ 保存为 .apkg</li>
        <li><strong>.txt</strong>：Anki → 导出 → 格式选「记忆卡为纯文本」→ Tab 分隔</li>
        <li><strong>.json/.md</strong>：本插件导出的卡片、概念图或导图备份</li>
      </ul>
    </div>

    <!-- 文件选择 -->
    <div class="import-file-area">
      <label class="b3-button b3-button--outline import-file-btn">
        <svg><use xlink:href="#iconDownload"></use></svg>
        选择文件
        <input type="file" accept=".apkg,.txt,.csv,.json,.md,.markdown" on:change={onFileChange} hidden />
      </label>
      {#if fileName}
        <span class="import-filename">{fileName}</span>
      {/if}
    </div>
  </section>

  {#if isWorking}
    <div class="import-status">{status}</div>
  {/if}

  {#if restorePayload}
    <div class="import-summary">
      <div class="import-stats">
        <span class="import-stat">卡片 {restorePayload.cards.length}</span>
        <span class="import-stat">概念 {restorePayload.concepts.length}</span>
        <span class="import-stat">关系 {restorePayload.relations.length}</span>
        <span class="import-stat">导图 {restorePayload.mindmaps.length}</span>
      </div>
      <div class="import-actions">
        <button class="b3-button b3-button--text" on:click={() => restorePayload = null}>取消</button>
        <button class="b3-button" on:click={confirmPluginImport}>
          <svg><use xlink:href="#iconDownload"></use></svg>
          恢复导入
        </button>
      </div>
    </div>
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
              <button class="b3-button b3-button--small" on:click={() => toggleDuplicate(card)} title="标记为导入">
                <svg><use xlink:href="#iconRefresh"></use></svg>
              </button>
            {:else}
              <button class="b3-button b3-button--small import-btn-skip" on:click={() => toggleDuplicate(card)} title="跳过此卡">
                <svg><use xlink:href="#iconClose"></use></svg>
              </button>
            {/if}
            <button class="b3-button b3-button--small import-btn-del" on:click={() => removeCard(cards.indexOf(card))} title="删除">
              <svg><use xlink:href="#iconClose"></use></svg>
            </button>
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

  .export-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;

    .b3-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    svg {
      width: 14px;
      height: 14px;
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

  .export-scope {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--b3-theme-surface-light);

    label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--aio-fs-sm);
      color: var(--b3-theme-on-surface);
    }
  }

  .riff-sync-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }

  .riff-sync-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;

    svg {
      width: 14px;
      height: 14px;
    }
  }

  .riff-sync-controls {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) 120px;
    gap: 10px;

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
  }

  .riff-sync-status {
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--b3-theme-surface-light);
    font-size: var(--aio-fs-sm);
    line-height: 1.5;
  }

  .riff-audit {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .riff-audit-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    span {
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--b3-theme-surface-light);
      color: var(--b3-theme-on-surface);
      font-size: var(--aio-fs-xs);
    }
  }

  .riff-audit-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
  }

  .riff-audit-row {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) minmax(120px, auto);
    gap: 8px;
    align-items: center;
    padding: 5px 7px;
    border-radius: 4px;
    background: var(--b3-theme-surface);
    border: 1px solid var(--b3-theme-surface-lighter);
    font-size: var(--aio-fs-xs);

    span {
      color: var(--b3-theme-primary);
      white-space: nowrap;
    }

    strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }

    em {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-style: normal;
      opacity: 0.62;
    }
  }

  .riff-audit-row--stale span {
    color: var(--b3-card-warning-color);
  }

  .riff-audit-row--orphan span {
    color: var(--b3-card-error-color);
  }

  .import-file-area { display: flex; align-items: center; gap: 12px; }
  .import-file-btn { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
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
  .import-actions .b3-button,
  .import-card-actions .b3-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .import-file-btn svg,
  .import-actions svg,
  .import-card-actions svg {
    width: 14px;
    height: 14px;
  }
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
    .export-controls,
    .riff-sync-controls {
      grid-template-columns: 1fr;
    }

    .import-section-head {
      flex-direction: column;
    }

    .riff-sync-actions {
      justify-content: flex-start;
    }

    .riff-audit-row {
      grid-template-columns: 1fr;
      gap: 3px;
    }
  }
</style>
