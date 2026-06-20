<script lang="ts">
  import { onMount, afterUpdate, tick } from 'svelte';
  import { generateMindmap, getStatusCategory, treeToIndex } from '../libs/mindmap';
  import { renderMarkmap, statusToColor, fitMarkmap } from '../libs/markmap-render';
  import { fetchContext, searchSiyuanDocs } from '../libs/sources';
  import type { SourceConfig, DocItem } from '../libs/sources';
  import { callLLM, resolveLLMConfig } from '../libs/llm';
  import { generateMindmapCardDrafts, type MindmapCardDraft } from '../libs/mindmap-cards';
  import { syncConceptMindmap } from '../libs/concept-mindmap-sync';
  import { createCard, schedule } from '../libs/srs';
  import { renderToHTML, renderMath } from '../libs/render';
  import type { Card } from '../libs/types';
  import { genMindmapId } from '../libs/mindmap-store';
  import type { SavedMindmap } from '../libs/mindmap-store';
  import { showMessage, confirm } from 'siyuan';

  export let plugin: any;
  export let cardStore: any;
  export let mindmapStore: any;
  export let conceptStore: any;
  export let config: any;
  export let jumpTarget: { mindmapId?: string } = {};

  let mode: 'cards' | 'doc' | 'concepts' = 'cards';
  let showList = false; // 导图列表展开状态

  // 基于卡片
  let decks: string[] = [];
  let selectedDeck = '';

  // 基于文档/来源
  let sourceConfig: SourceConfig = { type: 'none', siyuanDocIds: [] };
  let docQuery = '';
  let docResults: DocItem[] = [];
  let selectedDocIds = new Set<string>();

  let status = '';
  let warning = '';
  let isWorking = false;

  // markmap 渲染
  let svgEl: SVGElement;
  let mmInstance: any = null;
  let currentMarkdown = '';
  let currentCards: Card[] = [];
  let currentTree: any = null;
  let currentMindmapId = '';
  let generatedCardCount = 6;
  let isGeneratingCards = false;

  // 卡片复习浮层
  let reviewCard: Card | null = null;
  let reviewFlipped = false;
  let reviewDialogEl: HTMLElement;

  onMount(async () => {
    decks = cardStore.getDecks();
    if (decks.length > 0) {
      selectedDeck = decks[0];
      // 加载该 deck 的已保存思维导图
      await loadSavedMindmap(selectedDeck);
    }
  });

  $: deckCardCount = selectedDeck ? cardStore.getByDeck(selectedDeck).length : 0;
  $: selectedDocCount = selectedDocIds.size;
  $: conceptCount = (conceptStore?.getAll?.() || []).length;
  $: conceptRelationCount = (conceptStore?.getRelations?.() || []).length;
  $: conceptCardCount = (cardStore?.getAll?.() || []).filter((card: Card) => card.conceptId).length;
  $: _configVer = config;
  $: currentProviderName = (_configVer?.providers || []).find((x) => x.id === _configVer?.mindmapProviderId)?.name || '未配置';

  // 响应跳转：从 Browse 面板跳过来时加载指定导图
  $: if (jumpTarget?.mindmapId) {
    loadMindmapById(jumpTarget.mindmapId);
    jumpTarget = {};
  }

  /** 所有已保存的导图列表 */
  $: allMindmaps = mindmapStore?.getAll() || [];

  /** 加载指定 id 的思维导图 */
  async function loadMindmapById(id: string) {
    if (!mindmapStore) return;
    const m = mindmapStore.getById(id);
    if (!m) return;
    currentMindmapId = m.id;
    currentMarkdown = m.markdown;
    currentCards = m.cardIds?.length ? cardStore.getAll().filter((c: Card) => m.cardIds.includes(c.id)) : [];
    currentTree = null;
    if (m.deck) selectedDeck = m.deck;
    status = `已加载「${m.title}」`;
    await tick();
    await renderInPanel();
  }

  function handleMindmapListKeydown(e: KeyboardEvent, id: string) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    loadMindmapById(id);
  }

  /** 删除导图 */
  async function deleteMindmap(id: string) {
    await mindmapStore.delete(id);
    if (currentMindmapId === id) {
      currentMarkdown = '';
      currentMindmapId = '';
      status = '';
    }
    showMessage('已删除');
  }

  /** 加载该 deck 的已保存思维导图 */
  async function loadSavedMindmap(deck: string) {
    if (!mindmapStore || mode !== 'cards') return;
    const saved = mindmapStore.getByDeck(deck);
    if (saved.length > 0) {
      const m = saved[saved.length - 1]; // 取最新一个
      currentMindmapId = m.id;
      currentMarkdown = m.markdown;
      currentCards = cardStore.getByDeck(deck);
      currentTree = null;
      status = `已加载「${m.title}」（${new Date(m.modified).toLocaleDateString()} 生成）`;
      await tick();
      await renderInPanel();
    } else {
      currentMarkdown = '';
      currentMindmapId = '';
      status = '';
    }
  }

  /** 切换 deck 时自动加载 */
  async function onDeckChange(e: any) {
    selectedDeck = e.target.value;
    await loadSavedMindmap(selectedDeck);
  }

  async function searchDocs() {
    if (!docQuery.trim()) return;
    docResults = await searchSiyuanDocs(docQuery);
  }

  function toggleDoc(id: string) {
    if (selectedDocIds.has(id)) selectedDocIds.delete(id);
    else selectedDocIds.add(id);
    selectedDocIds = new Set(selectedDocIds);
  }

  /** 构建 cardId → 颜色 的映射 */
  function buildColorMap(cards: Card[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const card of cards) {
      map.set(card.id, statusToColor(getStatusCategory(card)));
    }
    return map;
  }

  async function loadConceptMindmap() {
    const concepts = conceptStore?.getAll?.() || [];
    const relations = conceptStore?.getRelations?.() || [];
    const cards = cardStore?.getAll?.() || [];
    if (concepts.length === 0) {
      showMessage('概念库还没有节点，请先在“概念”面板确认写入候选');
      return;
    }

    isWorking = true;
    warning = '';
    status = '正在从概念库生成导图...';
    try {
      const { saved, mindmap: result } = await syncConceptMindmap(conceptStore, cardStore, mindmapStore, {
        currentMindmapId,
        title: '概念图谱',
      });
      currentMarkdown = result.markdown;
      currentCards = result.cards;
      currentTree = null;

      await tick();
      await renderInPanel();

      currentMindmapId = saved.id;
      status = `已从概念库生成导图：${result.conceptCount} 个概念 / ${result.cards.length} 张卡片 / ${result.relationCount} 条关系`;
    } catch (e: any) {
      status = `生成概念导图失败：${e.message || e}`;
      console.error('[mindmap:concepts]', e);
    } finally {
      isWorking = false;
    }
  }

  async function generate() {
    if (mode === 'concepts') {
      await loadConceptMindmap();
      return;
    }

    const cfg = plugin.getConfig();
    const llmConfig = resolveLLMConfig(cfg, cfg.mindmapProviderId, cfg.mindmapModel);
    if (!llmConfig.endpoint) { showMessage('请先在设置中配置 AI Provider'); return; }

    isWorking = true;
    status = '准备中...';

    try {
      let title: string;
      let markdown: string;

      if (mode === 'cards') {
        if (deckCardCount === 0) { showMessage('该牌组没有卡片'); isWorking = false; return; }
        status = '步骤 1/3：获取卡片...';
        const cards = cardStore.getByDeck(selectedDeck);
        currentCards = cards;
        status = '步骤 2/3：AI 知识树分组...';
        warning = '';
        const result = await generateMindmap(
          selectedDeck, cards,
          llmConfig,
          (w) => { warning = w; }
        );
        title = result.title;
        markdown = result.sections.map((s: any) => s.mindmapMd).join('\n\n');
        currentTree = result.tree || null;
      } else {
        if (sourceConfig.type === 'none') { showMessage('请选择知识来源'); isWorking = false; return; }
        if (selectedDocCount === 0 && sourceConfig.type !== 'manual' && sourceConfig.type !== 'notebook') { showMessage('请选择文档'); isWorking = false; return; }
        if (sourceConfig.type === 'manual' && !sourceConfig.manualText?.trim()) { showMessage('请输入内容'); isWorking = false; return; }

        status = '步骤 1/3：获取来源内容...';
        sourceConfig.siyuanDocIds = [...selectedDocIds];
        const content = await fetchContext(sourceConfig, cfg.notebookEndpoint);
        if (!content) { showMessage('未能获取内容'); isWorking = false; return; }

        status = '步骤 2/3：AI 生成知识结构...';
        const docTitle = sourceConfig.type === 'siyuan'
          ? `${selectedDocCount} 篇文档`
          : sourceConfig.notebookQuery || '知识树';

        const md = await callLLM(
          [
            {
              role: 'system',
              content: `你是一位学科知识结构专家。将给定内容组织成层次清晰的思维导图缩进列表。

格式要求（严格遵守，参考示例）：
- 每行以 \`- \` 开头
- 用 2 个空格缩进表示层级
- 第一层：\`- 主题\`（3-6 个一级主题）
- 第二层：\`  - 子主题\`（每个主题下 2-5 个）
- 第三层：\`    - 知识点\`（简洁，不超过 15 字）
- 公式用 $...$ 格式保留
- 主题名和知识点名使用中文（如果原文是中文）

重要约束（防止幻觉）：
- 只基于提供的内容提取结构，不要编造原文中不存在的信息
- 不要使用"其他"、"综合"等泛化分类，每个主题必须有明确含义
- 叶子节点要具体，不要泛泛而谈

示例（给定一段关于牛顿定律的文本）：
- 牛顿运动定律
  - 第一定律（惯性）
    - 物体保持静止或匀速
    - 除非受外力作用
  - 第二定律
    - $F = ma$
    - 加速度与力成正比
  - 第三定律
    - 作用力与反作用力
    - 大小相等方向相反

只输出缩进列表，不要代码块标记，不要额外说明。`,
            },
            {
              role: 'user',
              content: '请将以下内容组织成思维导图缩进列表：\n\n' + content.slice(0, 8000),
            },
          ],
          { ...llmConfig, temperature: 0.3 }
        );

        title = `${docTitle} 知识树`;
        const cleanMd = md.replace(/```mindmap\n?/g, '').replace(/```\n?/g, '').replace(/^#+\s/gm, '').trim();
        markdown = cleanMd.startsWith('-') ? cleanMd : '- ' + docTitle + '\n' + cleanMd;
        currentCards = [];
      }

      status = '步骤 3/3：渲染思维导图...';
      currentMarkdown = markdown;

      // 等 Svelte 渲染 SVG 容器到 DOM（currentMarkdown 触发 {#if} 块）
      await tick();
      if (!svgEl) {
        status = '❌ SVG 容器未就绪';
        isWorking = false;
        return;
      }

      // 渲染 markmap
      await renderInPanel();

      // 自动保存到 mindmapStore（像闪卡一样持久化）
      const saved: SavedMindmap = {
        id: currentMindmapId || genMindmapId(),
        title,
        markdown,
        cardIds: currentCards.map((c) => c.id),
        deck: mode === 'cards' ? selectedDeck : undefined,
        source: mode === 'cards' ? 'cards' : 'doc',
        created: Date.now(),
        modified: Date.now(),
      };
      await mindmapStore.upsert(saved);
      currentMindmapId = saved.id;

      status = `✅ 完成！${title}（已自动保存）`;
    } catch (e: any) {
      status = `❌ 失败：${e.message}`;
      console.error('[mindmap]', e);
    }
    isWorking = false;
  }

  async function renderInPanel() {
    if (!svgEl || !currentMarkdown) return;
    const cardColors = buildColorMap(currentCards);
    mmInstance = await renderMarkmap(svgEl, currentMarkdown, {
      cardColors,
      onNodeClick: (cardId, _text) => {
        const card = cardStore.getById(cardId);
        if (card) {
          reviewCard = card;
          reviewFlipped = false;
        }
      },
      initialExpandLevel: 2,
    });
    setTimeout(() => fitMarkmap(mmInstance), 300);
  }

  async function generateCardsFromCurrentMindmap() {
    if (!currentMarkdown.trim()) {
      showMessage('请先生成或打开一张导图');
      return;
    }
    const cfg = plugin.getConfig();
    const llmConfig = resolveLLMConfig(cfg, cfg.flashcardProviderId, cfg.flashcardModel);
    if (!llmConfig.endpoint) {
      showMessage('请先在设置中配置制卡 AI Provider');
      return;
    }

    isGeneratingCards = true;
    status = '正在根据当前导图生成卡片...';
    try {
      const result = await generateMindmapCardDrafts(
        currentMarkdown,
        { ...llmConfig, maxTokens: 8000 },
        Math.max(1, Math.min(30, Number(generatedCardCount) || 6)),
        'zh-CN'
      );
      if (result.cards.length === 0) {
        showMessage('没有从当前导图生成可用卡片');
        status = result.warnings[0] || '';
        return;
      }

      const deck = selectedDeck || mindmapStore?.getById?.(currentMindmapId)?.deck || '导图制卡';
      const createdIds: string[] = [];
      for (const draft of result.cards) {
        const conceptId = findConceptIdForDraft(draft);
        const card = createCard(draft.front, draft.back, draft.hint || '', deck, ['mindmap'], undefined) as Card;
        card.cardType = 'qa';
        card.conceptId = conceptId;
        card.sourceRefs = [{
          type: 'manual',
          sourceId: currentMindmapId || 'current-mindmap',
          chunkId: draft.topicPath.join(' > ') || draft.topicTitle || 'mindmap',
          quote: draft.topicPath.join(' > ') || draft.topicTitle || draft.front,
        }];
        cardStore.add(card);
        if (conceptId) conceptStore?.attachCard?.(conceptId, card.id);
        createdIds.push(card.id);
      }

      await cardStore.save();
      await conceptStore?.save?.();
      await attachGeneratedCardsToMindmap(createdIds);
      currentCards = mergeCardsById(currentCards, cardStore.getAll().filter((card: Card) => createdIds.includes(card.id)));
      await renderInPanel();
      status = `已从导图生成 ${createdIds.length} 张卡片，并保持导图关联`;
      showMessage(`已生成 ${createdIds.length} 张卡片`);
    } catch (e: any) {
      status = `导图制卡失败：${e.message || e}`;
      console.error('[mindmap:cards]', e);
    } finally {
      isGeneratingCards = false;
    }
  }

  function findConceptIdForDraft(draft: MindmapCardDraft): string | undefined {
    const concepts = conceptStore?.getAll?.() || [];
    const keys = new Set([draft.topicTitle, ...draft.topicPath].filter(Boolean).map(normalizeConceptKey));
    const match = concepts.find((concept: any) => keys.has(normalizeConceptKey(concept.title)));
    return match?.id;
  }

  async function attachGeneratedCardsToMindmap(cardIds: string[]) {
    if (!mindmapStore || cardIds.length === 0) return;
    const now = Date.now();
    const existing = currentMindmapId ? mindmapStore.getById(currentMindmapId) : null;
    const saved: SavedMindmap = {
      id: existing?.id || currentMindmapId || genMindmapId(),
      title: existing?.title || '导图制卡',
      markdown: currentMarkdown,
      cardIds: mergeIds(existing?.cardIds || currentCards.map((card) => card.id), cardIds),
      linkedCardIds: mergeIds(existing?.linkedCardIds || [], cardIds),
      deck: existing?.deck || selectedDeck || undefined,
      source: existing?.source || mode,
      created: existing?.created || now,
      modified: now,
    };
    await mindmapStore.upsert(saved);
    currentMindmapId = saved.id;
  }

  function mergeCardsById(a: Card[], b: Card[]): Card[] {
    const byId = new Map<string, Card>();
    [...a, ...b].forEach((card) => byId.set(card.id, card));
    return [...byId.values()];
  }

  function mergeIds(a: string[] = [], b: string[] = []): string[] {
    return Array.from(new Set([...a, ...b].filter(Boolean)));
  }

  function normalizeConceptKey(value: string): string {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
  }

  function handleGrade(grade: number) {
    if (!reviewCard) return;
    const updated = schedule(grade, { ...reviewCard });
    cardStore.update(reviewCard.id, updated);
    cardStore.save();
    reviewCard = null;
    // 重新渲染导图更新颜色
    if (mode === 'concepts') {
      const ids = new Set(currentCards.map((card) => card.id));
      currentCards = cardStore.getAll().filter((card: Card) => ids.has(card.id));
    } else {
      currentCards = cardStore.getByDeck(selectedDeck);
    }
    renderInPanel();
    showMessage('已评分');
  }

  function closeReviewOverlay() {
    reviewCard = null;
  }

  function toggleReviewCard() {
    reviewFlipped = !reviewFlipped;
  }

  function handleReviewOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeReviewOverlay();
  }

  function handleReviewCardKeydown(e: KeyboardEvent) {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    toggleReviewCard();
  }

  afterUpdate(() => {
    if (reviewDialogEl) renderMath(reviewDialogEl);
  });
</script>

<div class="mindmap-panel">
  <!-- 顶部控制栏 -->
  <div class="mindmap-toolbar">
    <div class="mindmap-tabs">
      <button class="b3-button b3-button--small" class:b3-button--outline={mode !== 'cards'} on:click={() => mode = 'cards'}>基于卡片</button>
      <button class="b3-button b3-button--small" class:b3-button--outline={mode !== 'doc'} on:click={() => mode = 'doc'}>基于文档</button>
      <button class="b3-button b3-button--small" class:b3-button--outline={mode !== 'concepts'} on:click={() => mode = 'concepts'}>基于概念</button>
      <button class="b3-button b3-button--small b3-button--outline" on:click={() => showList = !showList}>
        📋 导图列表（{allMindmaps.length}）
      </button>
    </div>
    <span class="mindmap-provider">{currentProviderName}</span>
  </div>

  <!-- 导图列表（点击展开） -->
  {#if showList}
    <div class="mindmap-list">
      {#if allMindmaps.length === 0}
        <p class="mindmap-list-empty">还没有已保存的思维导图</p>
      {:else}
        {#each allMindmaps as m (m.id)}
          <div class="mindmap-list-item" class:active={currentMindmapId === m.id}>
            <div class="mindmap-list-info" on:click={() => loadMindmapById(m.id)} on:keydown={(e) => handleMindmapListKeydown(e, m.id)} role="button" tabindex="0">
              <span class="mindmap-list-title">{m.title}</span>
              <span class="mindmap-list-meta">
                {m.source === 'cards' ? '🎴' : m.source === 'doc' ? '📄' : m.source === 'concepts' ? '◎' : '📝'}
                {m.cardIds?.length || 0} 张卡片
                · {new Date(m.modified).toLocaleDateString()}
              </span>
            </div>
            <button class="b3-button b3-button--small mindmap-list-del" on:click={() => deleteMindmap(m.id)}>✕</button>
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  <!-- 配置区 -->
  <div class="mindmap-config-row">
    {#if mode === 'cards'}
      <select class="b3-select mindmap-deck-select" value={selectedDeck} on:change={onDeckChange}>
        {#each decks as deck}<option value={deck}>{deck}（{cardStore.getByDeck(deck).length}）</option>{/each}
      </select>
    {:else if mode === 'concepts'}
      <div class="concept-map-summary">
        <span>{conceptCount} 个概念</span>
        <span>{conceptRelationCount} 条关系</span>
        <span>{conceptCardCount} 张概念卡片</span>
      </div>
    {:else}
      <div class="source-tabs">
        <button class="b3-button b3-button--small" class:b3-button--outline={sourceConfig.type !== 'siyuan'} on:click={() => sourceConfig = { type: 'siyuan', siyuanDocIds: [...selectedDocIds] }}>思源文档</button>
        <button class="b3-button b3-button--small" class:b3-button--outline={sourceConfig.type !== 'notebook'} on:click={() => sourceConfig = { type: 'notebook', siyuanDocIds: [] }} disabled={!config?.notebookEndpoint}>知识库</button>
        <button class="b3-button b3-button--small" class:b3-button--outline={sourceConfig.type !== 'manual'} on:click={() => sourceConfig = { type: 'manual', siyuanDocIds: [] }}>手动输入</button>
      </div>
    {/if}
    <button class="b3-button b3-button--outline" on:click={generate} disabled={isWorking}>
      {isWorking ? '生成中...' : mode === 'concepts' ? '同步图谱' : '🔄 生成'}
    </button>
    {#if currentMarkdown}
      <div class="mindmap-cardgen">
        <input class="b3-text-field" type="number" min="1" max="30" bind:value={generatedCardCount} aria-label="导图制卡数量" />
        <button class="b3-button b3-button--outline" on:click={generateCardsFromCurrentMindmap} disabled={isGeneratingCards || isWorking}>
          {isGeneratingCards ? '制卡中...' : '图制卡'}
        </button>
      </div>
    {/if}
  </div>

  <!-- doc 模式的来源输入 -->
  {#if mode === 'doc'}
    <div class="mindmap-source-input">
      {#if sourceConfig.type === 'siyuan'}
        <div class="mindmap-row">
          <input class="b3-text-field" type="text" placeholder="搜索思源文档..." bind:value={docQuery} on:keydown={(e) => { if (e.key === 'Enter') searchDocs(); }} />
          <button class="b3-button b3-button--outline" on:click={searchDocs}>搜索</button>
        </div>
        {#if docResults.length > 0}
          <div class="doc-list">
            {#each docResults as doc (doc.id)}
              <label class="doc-item" class:selected={selectedDocIds.has(doc.id)}>
                <input type="checkbox" checked={selectedDocIds.has(doc.id)} on:change={() => toggleDoc(doc.id)} />
                <span>📄 {doc.title}</span>
              </label>
            {/each}
          </div>
        {/if}
      {:else if sourceConfig.type === 'notebook'}
        <input class="b3-text-field" type="text" placeholder="搜索关键词..." bind:value={sourceConfig.notebookQuery} />
      {:else if sourceConfig.type === 'manual'}
        <textarea class="b3-text-field" rows="3" placeholder="粘贴内容..." bind:value={sourceConfig.manualText}></textarea>
      {/if}
    </div>
  {/if}

  {#if status}<div class="mindmap-status">{status}</div>{/if}
  {#if warning}<div class="mindmap-warning">{warning}</div>{/if}

  <!-- 交互式思维导图 SVG -->
  {#if currentMarkdown}
    <div class="mindmap-canvas">
      <svg bind:this={svgEl} class="mindmap-svg"></svg>
    </div>
    <div class="mindmap-legend">
      <span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>已掌握</span>
      <span class="legend-item"><span class="legend-dot" style="background:#eab308"></span>学习中</span>
      <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>未学/薄弱</span>
      <span class="legend-item"><span class="legend-dot" style="background:#9ca3af"></span>暂埋</span>
    </div>
  {:else if !isWorking}
    <div class="mindmap-placeholder">
      <p>{mode === 'concepts' ? '从概念库同步图谱，点击卡片节点可直接复习' : '选择牌组或文档来源，点击「生成」创建交互式思维导图'}</p>
      <p class="mindmap-tip">支持缩放、折叠、点击卡片节点复习</p>
    </div>
  {/if}
</div>

<!-- 卡片复习浮层 -->
{#if reviewCard}
<div class="review-overlay" on:click|self={closeReviewOverlay} on:keydown={handleReviewOverlayKeydown} role="button" tabindex="0" aria-label="关闭复习浮层">
  <div class="review-dialog" role="dialog" aria-modal="true" aria-labelledby="mindmap-review-title" bind:this={reviewDialogEl}>
    <div id="mindmap-review-title" class="review-card-content" on:click={toggleReviewCard} on:keydown={handleReviewCardKeydown} role="button" tabindex="0">
      {#if !reviewFlipped}
        <div class="review-side">
          <span class="review-label">问题</span>
          <div class="review-text">{@html renderToHTML(reviewCard.question)}</div>
        </div>
      {:else}
        <div class="review-side">
          <span class="review-label">答案</span>
          <div class="review-text">{@html renderToHTML(reviewCard.answer)}</div>
          {#if reviewCard.hint}<div class="review-hint">💡 {@html renderToHTML(reviewCard.hint)}</div>{/if}
        </div>
      {/if}
    </div>
    {#if reviewFlipped}
      <div class="review-grades">
        <button class="review-grade-btn grade-again" on:click={() => handleGrade(0)}>再次</button>
        <button class="review-grade-btn grade-hard" on:click={() => handleGrade(1)}>困难</button>
        <button class="review-grade-btn grade-good" on:click={() => handleGrade(2)}>良好</button>
        <button class="review-grade-btn grade-easy" on:click={() => handleGrade(3)}>简单</button>
      </div>
    {:else}
      <p class="review-flip-hint">点击卡片查看答案</p>
    {/if}
  </div>
</div>
{/if}

<style lang="scss">
  .mindmap-panel { padding: 16px; height: 100%; display: flex; flex-direction: column; gap: 12px; overflow: hidden; }

  .mindmap-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; }
  .mindmap-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
  .mindmap-provider { font-size: var(--aio-fs-xs); opacity: 0.5; }

  .mindmap-config-row { display: flex; align-items: center; gap: 8px; flex-shrink: 0;
    .mindmap-deck-select { flex: 1; }
  }
  .mindmap-cardgen {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;

    .b3-text-field {
      width: 64px;
      min-width: 64px;
      text-align: center;
    }
  }
  .concept-map-summary {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    span {
      padding: 4px 8px;
      border-radius: 4px;
      background: var(--b3-theme-surface);
      font-size: var(--aio-fs-xs);
      color: var(--b3-theme-on-surface);
    }
  }
  .source-tabs { display: flex; gap: 4px; flex: 1; .b3-button { flex: 1; font-size: var(--aio-fs-sm); } }

  .mindmap-source-input { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
  .mindmap-row { display: flex; gap: 6px; .b3-text-field { flex: 1; } }
  .doc-list { max-height: 150px; overflow-y: auto; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 4px; }
  .doc-item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer; font-size: var(--aio-fs-sm); &:hover { background: var(--b3-theme-surface-light); } input { flex-shrink: 0; } }
  .selected { background: var(--b3-theme-primary-lightest); }

  .mindmap-status { padding: 8px; border-radius: 4px; background: var(--b3-theme-surface-lighter); font-size: var(--aio-fs-sm); text-align: center; flex-shrink: 0; }
  .mindmap-warning { padding: 6px 8px; border-radius: 4px; background: var(--b3-card-warning-background); color: var(--b3-card-warning-color); font-size: var(--aio-fs-xs); flex-shrink: 0; }

  /* SVG 画布 */
  .mindmap-canvas { flex: 1; min-height: 300px; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 6px; overflow: hidden; position: relative; background: var(--b3-theme-background); }

  .mindmap-list { max-height: 200px; overflow-y: auto; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 6px; flex-shrink: 0; }
  .mindmap-list-empty { text-align: center; padding: 16px; font-size: var(--aio-fs-sm); opacity: 0.4; }
  .mindmap-list-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--b3-theme-surface-lighter);
    &:last-child { border-bottom: none; }
    &.active { background: var(--b3-theme-primary-lightest); }
  }
  .mindmap-list-info { flex: 1; cursor: pointer; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .mindmap-list-title { font-size: var(--aio-fs-sm); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mindmap-list-meta { font-size: var(--aio-fs-xs); opacity: 0.5; }
  .mindmap-list-del { color: var(--b3-card-error-color); opacity: 0.5; &:hover { opacity: 1; } }
  .mindmap-svg { width: 100%; height: 100%; display: block; }

  .mindmap-legend { display: flex; gap: 12px; font-size: var(--aio-fs-xs); opacity: 0.7; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

  .mindmap-placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; opacity: 0.4;
    p { margin: 0; font-size: var(--aio-fs-base); text-align: center; }
    .mindmap-tip { font-size: var(--aio-fs-sm); }
  }

  /* 卡片复习浮层 */
  .review-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; }
  .review-dialog { background: var(--b3-theme-background); border-radius: 12px; padding: 24px; width: 500px; max-width: 90vw; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
  .review-card-content { min-height: 120px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 20px; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 8px; }
  .review-side { text-align: center; width: 100%; }
  .review-label { font-size: var(--aio-fs-xs); opacity: 0.4; text-transform: uppercase; letter-spacing: 1px; }
  .review-text { font-size: var(--aio-fs-md); line-height: 1.6; margin-top: 8px; word-break: break-word; }
  .review-hint { font-size: var(--aio-fs-sm); opacity: 0.6; margin-top: 12px; }
  .review-flip-hint { text-align: center; font-size: var(--aio-fs-xs); opacity: 0.4; }
  .review-grades { display: flex; gap: 8px; }
  .review-grade-btn { flex: 1; padding: 10px; border: none; border-radius: 6px; cursor: pointer; font-size: var(--aio-fs-sm); color: white; font-weight: 500; }
  .grade-again { background: #ef4444; }
  .grade-hard { background: #f97316; }
  .grade-good { background: #22c55e; }
  .grade-easy { background: #3b82f6; }
</style>
