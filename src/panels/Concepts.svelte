<script lang="ts">
  import { afterUpdate } from 'svelte';
  import { showMessage } from 'siyuan';
  import { confirmPipelineResult, runPromptPipeline, type PipelineSource, type PipelineStep } from '../libs/ai';
  import { buildConfirmationOptions, createCandidateSelection, trimSelectionForAcceptedConcepts } from '../libs/ai/selection';
  import { syncConceptMindmap } from '../libs/concept-mindmap-sync';
  import { resolveLLMConfig } from '../libs/llm';
  import type { NotebookConceptRequest } from '../libs/notebook-bridge';
  import { buildConceptGraph, type ConceptGraphNode } from '../libs/render/concept-graph';
  import { renderToHTML, renderMath } from '../libs/render';
  import { activateSourceRef, formatSourceLabel, formatSourceText, getSourceAction } from '../libs/source-actions';
  import { CARD_TYPE_LABELS, type PipelineResult, type RelationType, type SourceRef } from '../libs/types/concept';

  export let plugin: any;
  export let conceptStore: any;
  export let cardStore: any;
  export let mindmapStore: any;
  export let config: any;
  export let openSourceRef: (ref: Partial<SourceRef>) => Promise<boolean> = (ref) => activateSourceRef(ref);
  export let jumpToMindmap: (mindmapId: string) => void = () => {};
  export let notebookTarget: NotebookConceptRequest | null = null;
  export let mindmapGapTarget: { manualText: string; label: string; key: number } | null = null;
  export let appStore: any = null;
  export let sourceStore: any = null;

  let query = '';
  let refreshKey = 0;
  let sourceText = '';
  let appliedNotebookTargetKey = '';
  let appliedMindmapGapTargetKey = 0;
  let targetCardCount = 8;
  let cdfMode = false;
  let deck = config?.defaultDeck || '默认';
  let tagsText = 'pipeline';
  let isRunning = false;
  let isConfirming = false;
  let status = '';
  let result: PipelineResult | null = null;
  let libraryView: 'list' | 'graph' = 'list';
  let selectedGraphNodeId = '';
  let selectedConceptTempIds = new Set<string>();
  let selectedRelationIndexes = new Set<number>();
  let selectedCardIndexes = new Set<number>();
  let candidateReviewEl: HTMLElement;

  const relationLabels: Record<RelationType, string> = {
    parent_child: '父子',
    prerequisite: '前置',
    contrast: '对比',
    cause_effect: '因果',
    sequence: '顺序',
    related: '相关',
  };

  const stepLabels: Record<PipelineStep, string> = {
    'extract-concepts': '提取概念候选',
    'infer-relations': '推断概念关系',
    'generate-cards': '生成闪卡候选',
    'assign-cards': '分配卡片',
  };

  $: concepts = refreshKey >= 0 ? (conceptStore?.getAll?.() || []) : [];
  $: relations = refreshKey >= 0 ? (conceptStore?.getRelations?.() || []) : [];
  $: cards = refreshKey >= 0 ? (cardStore?.getAll?.() || []) : [];
  $: filtered = concepts.filter((concept: any) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      String(concept.title || '').toLowerCase().includes(q) ||
      String(concept.summary || '').toLowerCase().includes(q) ||
      (concept.tags || []).some((tag: string) => String(tag).toLowerCase().includes(q))
    );
  });
  $: candidateStats = result
    ? `${result.concepts.length} 个概念 / ${result.relations.length} 条关系 / ${result.cards.length} 张卡片`
    : '';
  $: selectedStats = result
    ? `${selectedConceptTempIds.size} 个概念 / ${selectedRelationIndexes.size} 条关系 / ${selectedCardIndexes.size} 张卡片`
    : '';
  $: conceptGraph = buildConceptGraph(filtered, relations, cards);
  $: graphNodeIds = new Set(conceptGraph.nodes.map((node) => node.id));
  $: if (selectedGraphNodeId && !graphNodeIds.has(selectedGraphNodeId)) selectedGraphNodeId = '';
  $: selectedGraphNode = conceptGraph.nodes.find((node) => node.id === selectedGraphNodeId) || null;
  $: applyNotebookTarget(notebookTarget);
  $: applyMindmapGapTarget(mindmapGapTarget);

  afterUpdate(() => {
    if (candidateReviewEl) renderMath(candidateReviewEl);
  });

  async function reload() {
    await conceptStore?.load?.();
    refreshKey += 1;
  }

  async function save() {
    await plugin?.saveConcepts?.();
    refreshKey += 1;
  }

  async function runPipeline() {
    const text = sourceText.trim();
    if (!text && !appStore?.selectedSourceIds?.length) {
      showMessage('请粘贴一段来源文本，或先从来源库选取来源');
      return;
    }

    const cfg = plugin?.getConfig?.() || config || {};
    const llmConfig = resolveLLMConfig(cfg, cfg.flashcardProviderId, cfg.flashcardModel);
    if (!llmConfig.endpoint) {
      showMessage('请先在设置中配置制卡 AI Provider');
      return;
    }

    isRunning = true;
    status = '准备调用模型...';
    result = null;
    try {
      const sources = await buildPipelineSources(cfg);

      if (sources.length === 0) {
        showMessage('没有可用来源内容');
        status = '';
        return;
      }

      const next = await runPromptPipeline(
        sources,
        {
          llmConfig: { ...llmConfig, maxTokens: 12000 },
          targetCardCount: Math.max(1, Math.min(50, Number(targetCardCount) || 8)),
          cdfMode,
          language: 'zh-CN',
          onStep: (step) => {
            status = stepLabels[step] || step;
          },
        }
      );

      result = next;
      const selection = createCandidateSelection(next);
      selectedConceptTempIds = selection.conceptTempIds;
      selectedRelationIndexes = selection.relationIndexes;
      selectedCardIndexes = selection.cardIndexes;
      status = `已生成候选：${candidateStats || `${next.concepts.length} 个概念 / ${next.relations.length} 条关系 / ${next.cards.length} 张卡片`}；来源 ${sources.length} 段`;
      showMessage('候选已生成，请检查后确认写入');
    } catch (err: any) {
      status = '';
      showMessage('生成失败：' + (err?.message || err));
    } finally {
      isRunning = false;
    }
  }

  function applyNotebookTarget(target: NotebookConceptRequest | null) {
    if (!target || target.key === appliedNotebookTargetKey) return;
    appliedNotebookTargetKey = target.key;
    sourceText = target.query || sourceText;
    status = target.sourceLabel ? `已接收 Notebook 来源：${target.sourceLabel}` : '已接收 Notebook 来源';
    if (target.autoRun) {
      setTimeout(() => {
        if (!isRunning && appliedNotebookTargetKey === target.key) runPipeline();
      }, 0);
    }
  }

  function applyMindmapGapTarget(target: { manualText: string; label: string; key: number } | null) {
    if (!target || target.key === appliedMindmapGapTargetKey) return;
    appliedMindmapGapTargetKey = target.key;
    sourceText = target.manualText;
    status = target.label || '已接收导图缺卡节点';
    setTimeout(() => {
      if (!isRunning && appliedMindmapGapTargetKey === target.key) runPipeline();
    }, 0);
  }

  function buildPipelineSources(cfg: any): PipelineSource[] {
    const sources: PipelineSource[] = [];

    // Read from SourceStore if sources were pre-selected
    if (appStore?.selectedSourceIds?.length && sourceStore) {
      for (const id of appStore.selectedSourceIds) {
        const record = sourceStore.getById(id);
        if (record?.content) {
          sources.push({
            id: record.id,
            text: record.content,
            type: 'source',
            sourceId: record.id,
          });
        }
      }
      appStore.selectedSourceIds = [];
    }

    // Keep manual text source mode if user typed text
    const text = sourceText.trim();
    if (text) {
      sources.push({ id: 'manual', text, type: 'manual' });
    }

    return sources;
  }

  // Phase 4: Removed independent source selection (OpenNotebook, SiYuan docs, local files, URLs, PDFs)

  async function confirmCandidates() {
    if (!result) return;
    if (selectedConceptTempIds.size === 0 && selectedCardIndexes.size === 0) {
      showMessage('请至少选择一个概念或一张卡片');
      return;
    }

    isConfirming = true;
    try {
      const tags = tagsText.split(',').map((tag) => tag.trim()).filter(Boolean);
      const summary = await confirmPipelineResult(
        result,
        conceptStore,
        cardStore,
        buildConfirmationOptions(
          {
            conceptTempIds: selectedConceptTempIds,
            relationIndexes: selectedRelationIndexes,
            cardIndexes: selectedCardIndexes,
          },
          {
            deck: deck.trim() || config?.defaultDeck || '默认',
            tags,
            save: true,
          }
        )
      );
      refreshKey += 1;
      showMessage(`已写入：${summary.createdConcepts.length} 个概念、${summary.createdRelations.length} 条关系、${summary.createdCards.length} 张卡片`);
      if (mindmapStore && (summary.createdConcepts.length || summary.createdRelations.length || summary.createdCards.length)) {
        try {
          const { saved } = await syncConceptMindmap(conceptStore, cardStore, mindmapStore, { title: '概念图谱' });
          jumpToMindmap(saved.id);
        } catch (err: any) {
          showMessage('概念导图同步失败：' + (err?.message || err));
        }
      }
      if (summary.skippedCards.length || summary.warnings.length) {
        status = [
          summary.skippedCards.length ? `跳过 ${summary.skippedCards.length} 张卡片` : '',
          summary.warnings.length ? `警告 ${summary.warnings.length} 条` : '',
        ].filter(Boolean).join('，');
      } else {
        status = '确认写入完成';
      }
    } catch (err: any) {
      showMessage('写入失败：' + (err?.message || err));
    } finally {
      isConfirming = false;
    }
  }

  function resetCandidates() {
    result = null;
    selectedConceptTempIds = new Set();
    selectedRelationIndexes = new Set();
    selectedCardIndexes = new Set();
    status = '';
  }

  function toggleConcept(tempId: string) {
    const next = new Set(selectedConceptTempIds);
    if (next.has(tempId)) next.delete(tempId);
    else next.add(tempId);
    selectedConceptTempIds = next;
    trimSelectionsForConcepts();
  }

  function toggleRelation(index: number) {
    const next = new Set(selectedRelationIndexes);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    selectedRelationIndexes = next;
  }

  function toggleCard(index: number) {
    const next = new Set(selectedCardIndexes);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    selectedCardIndexes = next;
  }

  function selectAllCandidates() {
    if (!result) return;
    selectedConceptTempIds = new Set(result.concepts.map((concept) => concept.tempId));
    selectedRelationIndexes = new Set(result.relations.map((_, index) => index));
    selectedCardIndexes = new Set(result.cards.map((_, index) => index));
  }

  function selectRecommendedCandidates() {
    if (!result) return;
    const selection = createCandidateSelection(result);
    selectedConceptTempIds = selection.conceptTempIds;
    selectedRelationIndexes = selection.relationIndexes;
    selectedCardIndexes = selection.cardIndexes;
  }

  function clearCandidateSelection() {
    selectedConceptTempIds = new Set();
    selectedRelationIndexes = new Set();
    selectedCardIndexes = new Set();
  }

  function trimSelectionsForConcepts() {
    if (!result) return;
    const trimmed = trimSelectionForAcceptedConcepts(result, {
      conceptTempIds: selectedConceptTempIds,
      relationIndexes: selectedRelationIndexes,
      cardIndexes: selectedCardIndexes,
    });
    selectedConceptTempIds = trimmed.conceptTempIds;
    selectedRelationIndexes = trimmed.relationIndexes;
    selectedCardIndexes = trimmed.cardIndexes;
  }

  function conceptTitle(tempId?: string): string {
    if (!tempId || !result) return '未绑定概念';
    return result.concepts.find((concept) => concept.tempId === tempId)?.title || tempId;
  }

  function sourceLabel(ref: SourceRef): string {
    return formatSourceLabel(ref);
  }

  function evidenceText(ref: SourceRef): string {
    return formatSourceText(ref);
  }

  function firstEvidence(refs: SourceRef[] = []): SourceRef | null {
    return refs.find((ref) => evidenceText(ref)) || refs[0] || null;
  }

  function firstEvidenceLabel(refs: SourceRef[] = []): string {
    const ref = firstEvidence(refs);
    return ref ? sourceLabel(ref) : '';
  }

  function firstEvidenceText(refs: SourceRef[] = []): string {
    const ref = firstEvidence(refs);
    return ref ? evidenceText(ref) : '';
  }

  function firstEvidenceActionLabel(refs: SourceRef[] = []): string {
    const ref = firstEvidence(refs);
    return ref ? getSourceAction(ref).label || '查看来源' : '查看来源';
  }

  async function openFirstEvidence(refs: SourceRef[] = []) {
    const ref = firstEvidence(refs);
    if (!ref) return;
    const opened = await openSourceRef(ref);
    if (!opened) showMessage('没有可打开的来源定位');
  }

  function getConceptCards(concept: any): any[] {
    const ids = new Set(concept?.cardIds || []);
    return cards.filter((card: any) => ids.has(card.id) || card.conceptId === concept?.id);
  }

  function getConceptById(id: string): any | null {
    return concepts.find((concept: any) => concept.id === id) || null;
  }

  function selectGraphNode(node: ConceptGraphNode) {
    selectedGraphNodeId = selectedGraphNodeId === node.id ? '' : node.id;
  }

  function handleGraphNodeKeydown(event: KeyboardEvent, node: ConceptGraphNode) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectGraphNode(node);
    }
  }

  function getGraphNodeCards(node: ConceptGraphNode | null): any[] {
    const concept = node ? getConceptById(node.id) : null;
    return concept ? getConceptCards(concept) : [];
  }

  function getGraphNodeConcept(node: ConceptGraphNode | null): any | null {
    return node ? getConceptById(node.id) : null;
  }

  function getGraphNodeSourceRefs(node: ConceptGraphNode | null): SourceRef[] {
    return getGraphNodeConcept(node)?.sourceRefs || [];
  }

  function getGraphNodeRelations(node: ConceptGraphNode | null): any[] {
    if (!node) return [];
    return relations.filter((relation: any) => relation.fromId === node.id || relation.toId === node.id);
  }

  function shortTitle(text = '', max = 10): string {
    const value = String(text);
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }
</script>

<div class="concept-panel">
  <section class="concept-candidates">
    <div class="concept-toolbar">
      <div>
        <div class="concept-title">来源制卡与图谱</div>
        <div class="concept-subtitle">来源 → 概念/关系 → 闪卡/导图；确认后写入</div>
      </div>
      <div class="concept-actions">
        <button class="b3-button b3-button--small b3-button--outline" on:click={resetCandidates} disabled={isRunning || isConfirming || !result}>清空候选</button>
        <button class="b3-button b3-button--small" on:click={runPipeline} disabled={isRunning || isConfirming}>
          {isRunning ? '生成中...' : '生成候选'}
        </button>
      </div>
    </div>

    <div class="concept-actions-row">
      <button class="b3-button b3-button--small" on:click={() => appStore?.onSwitchTab?.('sources')}>
        从来源库选取来源
      </button>
    </div>

    <textarea
      class="b3-text-field source-input"
      bind:value={sourceText}
      rows="5"
      placeholder="粘贴一段笔记、教材摘录、网页内容或任意来源文本（可选）"
    ></textarea>

    <div class="candidate-settings">
      <label>
        <span>目标卡片数</span>
        <input class="b3-text-field" type="number" min="1" max="50" bind:value={targetCardCount} />
      </label>
      <label>
        <span>写入牌组</span>
        <input class="b3-text-field" type="text" bind:value={deck} />
      </label>
      <label>
        <span>卡片标签</span>
        <input class="b3-text-field" type="text" bind:value={tagsText} placeholder="逗号分隔" />
      </label>
      <label class="candidate-cdf-toggle" title="CDF：按描述维度（定义/公式/过程/对比/应用等）分维度生成卡片，避免所有卡片都是纯定义卡">
        <input type="checkbox" bind:checked={cdfMode} />
        <span>CDF 维度制卡</span>
      </label>
    </div>

    {#if status}
      <div class="pipeline-status">{status}</div>
    {/if}

    {#if result}
      <div class="candidate-review" bind:this={candidateReviewEl}>
        <div class="candidate-review-head">
          <div>
            <strong>{candidateStats}</strong>
            <span>已选 {selectedStats}</span>
          </div>
          <div class="concept-actions">
            <button class="b3-button b3-button--small b3-button--outline" on:click={selectRecommendedCandidates}>推荐</button>
            <button class="b3-button b3-button--small b3-button--outline" on:click={selectAllCandidates}>全选</button>
            <button class="b3-button b3-button--small b3-button--outline" on:click={clearCandidateSelection}>全不选</button>
            <button class="b3-button b3-button--small" on:click={confirmCandidates} disabled={isConfirming}>
              {isConfirming ? '写入中...' : '确认写入'}
            </button>
          </div>
        </div>

        <div class="candidate-columns">
          <div class="candidate-column">
            <h3>概念</h3>
            {#each result.concepts as concept}
              <label class="candidate-item">
                <input type="checkbox" checked={selectedConceptTempIds.has(concept.tempId)} on:change={() => toggleConcept(concept.tempId)} />
                <span class="candidate-main">
                  <span class="candidate-line">
                    <input
                      class="b3-text-field candidate-edit"
                      bind:value={concept.title}
                      aria-label="概念标题"
                      on:click|stopPropagation
                    />
                    <em>{Math.round(concept.confidence * 100)}%</em>
                  </span>
                  <textarea
                    class="b3-text-field candidate-textarea"
                    bind:value={concept.summary}
                    rows="2"
                    aria-label="概念摘要"
                    placeholder="概念摘要"
                    on:click|stopPropagation
                  ></textarea>
                  {#if firstEvidence(concept.sourceRefs)}
                    <button
                      type="button"
                      class="candidate-evidence"
                      title={firstEvidenceActionLabel(concept.sourceRefs)}
                      on:click|stopPropagation|preventDefault={() => openFirstEvidence(concept.sourceRefs)}
                    >
                      <span>{firstEvidenceLabel(concept.sourceRefs)}</span>
                      <q>{firstEvidenceText(concept.sourceRefs)}</q>
                    </button>
                  {/if}
                </span>
              </label>
            {/each}
          </div>

          <div class="candidate-column">
            <h3>关系</h3>
            {#each result.relations as relation, index}
              <label class="candidate-item" class:disabled-item={!selectedConceptTempIds.has(relation.fromTempId) || !selectedConceptTempIds.has(relation.toTempId)}>
                <input
                  type="checkbox"
                  checked={selectedRelationIndexes.has(index)}
                  disabled={!selectedConceptTempIds.has(relation.fromTempId) || !selectedConceptTempIds.has(relation.toTempId)}
                  on:change={() => toggleRelation(index)}
                />
                <span class="candidate-main">
                  <div class="candidate-relation-row">
                    <select class="b3-select" bind:value={relation.fromTempId} aria-label="关系起点" on:click|stopPropagation>
                      {#each result.concepts as concept}
                        <option value={concept.tempId}>{concept.title || concept.tempId}</option>
                      {/each}
                    </select>
                    <select class="b3-select" bind:value={relation.type} aria-label="关系类型" on:click|stopPropagation>
                      {#each Object.entries(relationLabels) as [type, label]}
                        <option value={type}>{label}</option>
                      {/each}
                    </select>
                    <select class="b3-select" bind:value={relation.toTempId} aria-label="关系终点" on:click|stopPropagation>
                      {#each result.concepts as concept}
                        <option value={concept.tempId}>{concept.title || concept.tempId}</option>
                      {/each}
                    </select>
                    <em>{Math.round(relation.confidence * 100)}%</em>
                  </div>
                  {#if firstEvidence(relation.sourceRefs)}
                    <button
                      type="button"
                      class="candidate-evidence"
                      title={firstEvidenceActionLabel(relation.sourceRefs)}
                      on:click|stopPropagation|preventDefault={() => openFirstEvidence(relation.sourceRefs)}
                    >
                      <span>{firstEvidenceLabel(relation.sourceRefs)}</span>
                      <q>{firstEvidenceText(relation.sourceRefs)}</q>
                    </button>
                  {/if}
                </span>
              </label>
            {/each}
          </div>

          <div class="candidate-column">
            <h3>闪卡</h3>
            {#each result.cards as card, index}
              <label class="candidate-item" class:disabled-item={card.conceptTempId && !selectedConceptTempIds.has(card.conceptTempId)}>
                <input
                  type="checkbox"
                  checked={selectedCardIndexes.has(index)}
                  disabled={card.conceptTempId && !selectedConceptTempIds.has(card.conceptTempId)}
                  on:change={() => toggleCard(index)}
                />
                <span class="candidate-main">
                  <span class="candidate-line">
                    <textarea
                      class="b3-text-field candidate-textarea"
                      bind:value={card.front}
                      rows="2"
                      aria-label="卡片正面"
                      on:click|stopPropagation
                    ></textarea>
                    <em>{CARD_TYPE_LABELS[card.cardType]} · {Math.round(card.confidence * 100)}%</em>
                  </span>
                  <textarea
                    class="b3-text-field candidate-textarea"
                    bind:value={card.back}
                    rows="3"
                    aria-label="卡片背面"
                    on:click|stopPropagation
                  ></textarea>
                  <div class="candidate-card-meta">
                    <select class="b3-select" bind:value={card.cardType} aria-label="卡片类型" on:click|stopPropagation>
                      {#each Object.entries(CARD_TYPE_LABELS) as [type, label]}
                        <option value={type}>{label}</option>
                      {/each}
                    </select>
                    <select class="b3-select" bind:value={card.conceptTempId} aria-label="关联概念" on:click|stopPropagation>
                      <option value="">未绑定概念</option>
                      {#each result.concepts as concept}
                        <option value={concept.tempId}>{concept.title || concept.tempId}</option>
                      {/each}
                    </select>
                  </div>
                  <input
                    class="b3-text-field candidate-edit"
                    bind:value={card.hint}
                    aria-label="卡片提示"
                    placeholder="提示（可选）"
                    on:click|stopPropagation
                  />
                  {#if firstEvidence(card.sourceRefs)}
                    <button
                      type="button"
                      class="candidate-evidence"
                      title={firstEvidenceActionLabel(card.sourceRefs)}
                      on:click|stopPropagation|preventDefault={() => openFirstEvidence(card.sourceRefs)}
                    >
                      <span>{firstEvidenceLabel(card.sourceRefs)}</span>
                      <q>{firstEvidenceText(card.sourceRefs)}</q>
                    </button>
                  {/if}
                </span>
              </label>
            {/each}
          </div>
        </div>

        {#if result.warnings.length || result.uncertain.length}
          <div class="candidate-warnings">
            {#each result.warnings as warning}
              <span>{warning}</span>
            {/each}
            {#each result.uncertain as item}
              <span>{item.content || item.reason}</span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </section>

  <section class="concept-library">
    <div class="concept-toolbar">
      <div>
        <div class="concept-title">概念图谱</div>
        <div class="concept-subtitle">{concepts.length} 个概念 · {relations.length} 条关系</div>
      </div>
      <div class="concept-actions">
        <div class="view-toggle" role="group" aria-label="概念库视图">
          <button class="b3-button b3-button--small" class:b3-button--outline={libraryView !== 'list'} on:click={() => (libraryView = 'list')}>列表</button>
          <button class="b3-button b3-button--small" class:b3-button--outline={libraryView !== 'graph'} on:click={() => (libraryView = 'graph')}>图谱</button>
        </div>
        <button class="b3-button b3-button--small b3-button--outline" on:click={reload}>刷新</button>
        <button class="b3-button b3-button--small b3-button--outline" on:click={save}>保存</button>
      </div>
    </div>

    <input class="b3-text-field concept-search" bind:value={query} placeholder="搜索概念、摘要或标签" />

    {#if filtered.length === 0}
      <div class="concept-empty">
        <p>还没有概念节点</p>
        <p>从上方候选区确认后，概念、关系和卡片会写入这里。</p>
      </div>
    {:else if libraryView === 'graph'}
      <div class="concept-graph-view">
        <div class="concept-graph-canvas">
          <svg
            class="concept-graph-svg"
            viewBox={`0 0 ${conceptGraph.width} ${conceptGraph.height}`}
            role="img"
            aria-label="概念关系图谱"
          >
            <g class="graph-edges">
              {#each conceptGraph.edges as edge (edge.id)}
                <line
                  class:secondary-edge={edge.type !== 'parent_child'}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                />
              {/each}
            </g>
            <g class="graph-nodes">
              {#each conceptGraph.nodes as node (node.id)}
                <g
                  class="graph-node"
                  class:selected-node={selectedGraphNodeId === node.id}
                  class:root-node={node.isRoot}
                  transform={`translate(${node.x}, ${node.y})`}
                  role="button"
                  tabindex="0"
                  on:click={() => selectGraphNode(node)}
                  on:keydown={(event) => handleGraphNodeKeydown(event, node)}
                >
                  <title>{node.title}</title>
                  <circle r={node.isRoot ? 34 : 28} />
                  <text class="graph-node-title" y="-4">{shortTitle(node.title)}</text>
                  <text class="graph-node-meta" y="14">{node.cardCount} 卡 · {node.sourceCount} 源</text>
                </g>
              {/each}
            </g>
          </svg>
        </div>

        <aside class="graph-detail">
          {#if selectedGraphNode}
            <div class="graph-detail-title">{selectedGraphNode.title}</div>
            {#if selectedGraphNode.summary}
              <p>{selectedGraphNode.summary}</p>
            {/if}
            <div class="graph-detail-meta">
              <span>层级 {selectedGraphNode.depth}</span>
              <span>{selectedGraphNode.cardCount} 张卡片</span>
              <span>{selectedGraphNode.sourceCount} 个来源</span>
            </div>

            {#if getGraphNodeSourceRefs(selectedGraphNode).length}
              <div class="graph-detail-block">
                <strong>证据来源</strong>
                {#each getGraphNodeSourceRefs(selectedGraphNode).slice(0, 4) as ref}
                  <button
                    type="button"
                    class="graph-source-button"
                    title={getSourceAction(ref).label || '查看来源'}
                    on:click={() => openSourceRef(ref)}
                  >
                    <span>{sourceLabel(ref)}</span>
                    {#if evidenceText(ref)}<em>{evidenceText(ref)}</em>{/if}
                  </button>
                {/each}
              </div>
            {/if}

            {#if getGraphNodeCards(selectedGraphNode).length}
              <div class="graph-detail-block">
                <strong>关联卡片</strong>
                {#each getGraphNodeCards(selectedGraphNode).slice(0, 5) as card}
                  <span>{card.question}</span>
                {/each}
              </div>
            {/if}

            {#if getGraphNodeRelations(selectedGraphNode).length}
              <div class="graph-detail-block">
                <strong>关联关系</strong>
                {#each getGraphNodeRelations(selectedGraphNode).slice(0, 6) as relation}
                  <span>
                    {getConceptById(relation.fromId)?.title || relation.fromId}
                    →
                    {getConceptById(relation.toId)?.title || relation.toId}
                    · {relationLabels[relation.type] || relation.type}
                  </span>
                {/each}
              </div>
            {/if}
          {:else}
            <div class="graph-detail-empty">选择一个概念节点查看卡片、来源和关系</div>
          {/if}
        </aside>
      </div>
    {:else}
      <div class="concept-list">
        {#each filtered as concept (concept.id)}
          <section class="concept-item">
            <div class="concept-item-header">
              <span class="concept-name">{concept.title}</span>
              {#if concept.confidence !== undefined}
                <span class="concept-confidence">{Math.round(concept.confidence * 100)}%</span>
              {/if}
            </div>
            {#if concept.summary}
              <p class="concept-summary">{concept.summary}</p>
            {/if}
            <div class="concept-meta">
              <span>{concept.cardIds?.length || 0} 张卡片</span>
              <span>{concept.childIds?.length || 0} 个子概念</span>
              <span>{concept.sourceRefs?.length || 0} 个来源</span>
            </div>
            {#if concept.tags?.length}
              <div class="concept-tags">
                {#each concept.tags as tag}
                  <span>{tag}</span>
                {/each}
              </div>
            {/if}
            {#if getConceptCards(concept).length > 0}
              <div class="concept-card-links">
                {#each getConceptCards(concept).slice(0, 3) as card}
                  <span>{card.question}</span>
                {/each}
                {#if getConceptCards(concept).length > 3}
                  <em>+{getConceptCards(concept).length - 3}</em>
                {/if}
              </div>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style lang="scss">
  .concept-panel {
    height: 100%;
    padding: 16px;
    display: grid;
    grid-template-rows: auto minmax(360px, 1fr);
    gap: 14px;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .concept-candidates,
  .concept-library {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .concept-library {
    min-height: 360px;
    overflow: hidden;
  }

  .concept-toolbar {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    flex-shrink: 0;
  }

  .concept-title {
    font-size: var(--aio-fs-md);
    font-weight: 600;
  }

  .concept-subtitle {
    margin-top: 2px;
    font-size: var(--aio-fs-xs);
    opacity: 0.6;
  }

  .concept-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .source-input {
    min-height: 86px;
    resize: vertical;
  }

  .concept-actions-row {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-shrink: 0;
  }

  .candidate-settings {
    display: grid;
    grid-template-columns: 120px minmax(120px, 180px) minmax(160px, 1fr);
    gap: 8px;

    label {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    span {
      font-size: var(--aio-fs-xs);
      opacity: 0.65;
    }
  }

  .pipeline-status {
    padding: 6px 8px;
    border-radius: 4px;
    font-size: var(--aio-fs-sm);
    color: var(--b3-card-info-color);
    background: var(--b3-card-info-background);
  }

  .candidate-review {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    padding: 10px;
    overflow: hidden;
  }

  .candidate-review-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;

    > div:first-child {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    strong {
      font-size: var(--aio-fs-base);
    }

    span {
      font-size: var(--aio-fs-xs);
      opacity: 0.6;
    }
  }

  .candidate-columns {
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    overflow: hidden;
  }

  .candidate-column {
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;

    h3 {
      margin: 0;
      padding-bottom: 4px;
      font-size: var(--aio-fs-sm);
      color: var(--b3-theme-primary);
      border-bottom: 1px solid var(--b3-theme-surface-lighter);
    }
  }

  .candidate-item {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 7px;
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    cursor: pointer;
  }

  .disabled-item {
    opacity: 0.45;
  }

  .candidate-main {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .candidate-line {
    display: flex;
    justify-content: space-between;
    gap: 8px;

    em {
      flex-shrink: 0;
      font-size: var(--aio-fs-xs);
      font-style: normal;
      opacity: 0.55;
    }
  }

  .candidate-edit,
  .candidate-textarea,
  .candidate-relation-row .b3-select,
  .candidate-card-meta .b3-select {
    min-width: 0;
    width: 100%;
    font-size: var(--aio-fs-xs);
  }

  .candidate-textarea {
    resize: vertical;
    line-height: 1.45;
  }

  .candidate-relation-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 84px minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;

    em {
      flex-shrink: 0;
      font-size: var(--aio-fs-xs);
      font-style: normal;
      opacity: 0.55;
    }
  }

  .candidate-card-meta {
    display: grid;
    grid-template-columns: minmax(86px, 140px) minmax(0, 1fr);
    gap: 6px;
  }

  .candidate-evidence {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 2px;
    padding: 5px 6px;
    width: 100%;
    border: 0;
    border-left: 2px solid var(--b3-theme-primary-light);
    border-radius: 3px;
    background: var(--b3-theme-surface);
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;

    span {
      font-size: var(--aio-fs-xs);
      color: var(--b3-theme-primary);
      opacity: 0.85;
      word-break: break-word;
    }

    q {
      font-size: var(--aio-fs-xs);
      line-height: 1.45;
      opacity: 0.72;
      quotes: none;
      word-break: break-word;
    }

    &:hover {
      background: var(--b3-theme-surface-light);
    }
  }

  .candidate-warnings {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    font-size: var(--aio-fs-xs);

    span {
      padding: 2px 6px;
      border-radius: 3px;
      color: var(--b3-card-warning-color);
      background: var(--b3-card-warning-background);
    }
  }

  .concept-search {
    flex-shrink: 0;
  }

  .concept-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    opacity: 0.55;

    p {
      margin: 4px 0;
      font-size: var(--aio-fs-base);
    }
  }

  .concept-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .view-toggle {
    display: flex;
    gap: 4px;
    margin-right: 4px;
  }

  .concept-graph-view {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 10px;
    overflow: hidden;
  }

  .concept-graph-canvas {
    min-width: 0;
    min-height: 260px;
    overflow: auto;
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    background: var(--b3-theme-background);
  }

  .concept-graph-svg {
    display: block;
    width: 100%;
    min-width: 760px;
    height: 100%;
    min-height: 420px;
  }

  .graph-edges line {
    stroke: var(--b3-theme-primary-light);
    stroke-width: 2;
    opacity: 0.62;
  }

  .graph-edges .secondary-edge {
    stroke: var(--b3-theme-on-surface-light);
    stroke-dasharray: 6 5;
    opacity: 0.42;
  }

  .graph-node {
    cursor: pointer;
    outline: none;

    circle {
      fill: var(--b3-theme-background);
      stroke: var(--b3-theme-primary-light);
      stroke-width: 2;
      filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.08));
    }

    text {
      pointer-events: none;
      text-anchor: middle;
      dominant-baseline: middle;
    }

    &:hover circle,
    &:focus circle,
    &.selected-node circle {
      stroke: var(--b3-theme-primary);
      stroke-width: 3;
    }

    &.root-node circle {
      fill: var(--b3-theme-primary-lightest);
    }
  }

  .graph-node-title {
    font-size: 13px;
    font-weight: 600;
    fill: var(--b3-theme-on-background);
  }

  .graph-node-meta {
    font-size: 10px;
    fill: var(--b3-theme-on-surface-light);
  }

  .graph-detail {
    min-width: 0;
    overflow-y: auto;
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    padding: 10px;
    background: var(--b3-theme-background);
  }

  .graph-detail-title {
    font-size: var(--aio-fs-base);
    font-weight: 600;
    word-break: break-word;
  }

  .graph-detail p {
    margin: 6px 0 0;
    font-size: var(--aio-fs-sm);
    line-height: 1.55;
    opacity: 0.78;
  }

  .graph-detail-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 8px;

    span {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: var(--aio-fs-xs);
      background: var(--b3-theme-surface);
      opacity: 0.76;
    }
  }

  .graph-detail-block {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 12px;

    strong {
      font-size: var(--aio-fs-xs);
      color: var(--b3-theme-primary);
    }

    span {
      padding: 6px 7px;
      border-radius: 4px;
      background: var(--b3-theme-surface);
      font-size: var(--aio-fs-xs);
      line-height: 1.4;
      word-break: break-word;
    }
  }

  .graph-source-button {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 6px 7px;
    border: 0;
    border-left: 2px solid var(--b3-theme-primary-light);
    border-radius: 4px;
    background: var(--b3-theme-surface);
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;

    span,
    em {
      padding: 0;
      background: none;
      font-size: var(--aio-fs-xs);
      line-height: 1.4;
      word-break: break-word;
      font-style: normal;
    }

    span {
      color: var(--b3-theme-primary);
    }

    em {
      opacity: 0.72;
    }

    &:hover {
      background: var(--b3-theme-surface-light);
    }
  }

  .graph-detail-empty {
    height: 100%;
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: var(--aio-fs-sm);
    opacity: 0.55;
  }

  .concept-item {
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--b3-theme-background);
  }

  .concept-item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .concept-name {
    font-size: var(--aio-fs-base);
    font-weight: 600;
  }

  .concept-confidence {
    flex-shrink: 0;
    font-size: var(--aio-fs-xs);
    padding: 1px 6px;
    border-radius: 3px;
    color: var(--b3-theme-primary);
    background: var(--b3-theme-primary-lightest);
  }

  .concept-summary {
    margin: 6px 0 0;
    line-height: 1.55;
    font-size: var(--aio-fs-sm);
    opacity: 0.85;
  }

  .concept-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
    font-size: var(--aio-fs-xs);
    opacity: 0.55;
  }

  .concept-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;

    span {
      font-size: var(--aio-fs-xs);
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--b3-theme-surface-lighter);
    }
  }

  .concept-card-links {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;

    span,
    em {
      padding: 5px 7px;
      border-radius: 4px;
      background: var(--b3-theme-surface);
      font-size: var(--aio-fs-xs);
      line-height: 1.4;
      word-break: break-word;
      font-style: normal;
      opacity: 0.78;
    }

    em {
      color: var(--b3-theme-primary);
      opacity: 0.9;
    }
  }

  @media (max-width: 1200px) {
    .concept-panel {
      overflow-y: auto;
      grid-template-rows: auto auto;
    }

    .candidate-settings,
    .candidate-columns {
      grid-template-columns: 1fr;
    }

    .candidate-column {
      max-height: 260px;
    }

    .candidate-relation-row {
      grid-template-columns: minmax(0, 1fr) minmax(84px, 120px);
    }

    .candidate-relation-row em {
      text-align: right;
    }

    .concept-graph-view {
      grid-template-columns: 1fr;
      overflow: visible;
    }

    .concept-graph-canvas {
      min-height: 320px;
    }

    .concept-graph-svg {
      min-width: 680px;
      min-height: 360px;
    }
  }

  @media (max-width: 900px) {
    .concept-panel {
      padding: 12px;
    }

    .concept-toolbar,
    .candidate-review-head {
      align-items: stretch;
      flex-direction: column;
    }

    .candidate-review {
      overflow: visible;
    }

    .candidate-column {
      max-height: none;
      overflow: visible;
    }

    .candidate-line {
      flex-direction: column;
    }

    .candidate-card-meta {
      grid-template-columns: 1fr;
    }
  }
</style>
