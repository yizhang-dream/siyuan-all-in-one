<script lang="ts">
  import { onMount } from 'svelte';
  import { showMessage, confirm, fetchSyncPost } from 'siyuan';
  import type { SourceRecord, SourceStore } from '../libs/source-store';
  import { ParserRegistry, TxtMdHtmlParser, PdfParser, PandocParser, XlsxParser, ImageOcrParser, SiyuanDocParser } from '../libs/parsers';
  import { genId } from '../libs/config';
  import { ingestDocument } from '../libs/rag/ingest';
  import { getRagEmbedderProvider } from '../libs/rag';
  import { callVisionLLM } from '../libs/llm';
  import { renderPdfPages } from '../libs/pdf-renderer';
  const fs: typeof import('fs') = eval('require')('fs');
  const os: typeof import('os') = eval('require')('os');
  const path: typeof import('path') = eval('require')('path');

  export let plugin: any;
  export let sourceStore: SourceStore;
  export let vectorStore: any;
  export let preSelectedIds: string[] = [];
  export let appStore: any;

  // ── 注册解析器 ──────────────────────────────────────
  const registry = new ParserRegistry();
  registry.register(new TxtMdHtmlParser());
  registry.register(new PdfParser());
  registry.register(new PandocParser());
  registry.register(new XlsxParser());
  registry.register(new ImageOcrParser());
  registry.register(new SiyuanDocParser());

  // ── 状态 ───────────────────────────────────────────
  let sources: SourceRecord[] = [];
  let selectedIds: string[] = [];
  let filterType = '全部';
  let searchQuery = '';
  let sortBy = 'newest';

  // 粘贴 dialog
  let showPasteDialog = false;
  let pasteText = '';

  // URL dialog
  let showUrlDialog = false;
  let urlText = '';
  let urlLoading = false;

  // 思源文档搜索 dialog
  let showDocSearch = false;
  let docQuery = '';
  let docResults: Array<{ id: string; title: string; path: string }> = [];
  let docSearching = false;
  let siyuanSearchError = '';

  // 视觉提取（公式/扫描件）设置
  let visionExtracting = new Set<string>();

  // 各扩展名文件输入框引用（每个按钮一个）
  let fileInputRefs: Record<string, HTMLInputElement> = {};

  const textFormats: Array<{ label: string; accept: string; force?: string }> = [
    { label: '.txt', accept: '.txt' },
    { label: '.md', accept: '.md,.markdown' },
    { label: '.html', accept: '.html,.htm' },
    { label: '.csv', accept: '.csv,.tsv' },
  ];

  const docFormats: Array<{ label: string; accept: string; force?: string }> = [
    { label: '.pdf', accept: '.pdf', force: 'pdf' },
    { label: '.docx', accept: '.docx,.doc' },
    { label: '.pptx', accept: '.pptx,.ppt' },
    { label: '.xlsx', accept: '.xlsx,.xls' },
    { label: '.epub', accept: '.epub' },
  ];

  onMount(() => {
    loadSources();
    // Pre-select specified IDs
    if (preSelectedIds.length > 0) {
      selectedIds = [...preSelectedIds.filter(id => sources.some(s => s.id === id))];
    }
  });

  $: filteredSources = sources.filter(s => {
    if (filterType !== '全部' && s.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!s.title.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  $: visibleSources = [...filteredSources].sort((a, b) => {
    if (sortBy === 'name') return a.title.localeCompare(b.title);
    if (sortBy === 'oldest') return a.metadata.addedAt - b.metadata.addedAt;
    return b.metadata.addedAt - a.metadata.addedAt; // newest first
  });

  $: allSelected = visibleSources.length > 0 && selectedIds.length === visibleSources.length;

  $: typeFilterOptions = (() => {
    const types = new Set(sources.map(s => s.type));
    const labels: Record<string, string> = {
      'file': '文件',
      'url': 'URL',
      'paste': '粘贴',
      'pdf': 'PDF',
      'siyuan-doc': '思源文档',
    };
    return ['全部', ...Array.from(types).map(t => labels[t] || t)];
  })();

  function loadSources() {
    sources = sourceStore.getAll();
    selectedIds = selectedIds.filter(id => sources.some(s => s.id === id));
  }

  // ── 选择 ───────────────────────────────────────────

  function toggleSelectAll() {
    if (allSelected) {
      selectedIds = [];
    } else {
      selectedIds = [...filteredSources.map(s => s.id)];
    }
  }

  function toggleSelect(id: string) {
    const idx = selectedIds.indexOf(id);
    if (idx >= 0) {
      selectedIds = [...selectedIds.slice(0, idx), ...selectedIds.slice(idx + 1)];
    } else {
      selectedIds = [...selectedIds, id];
    }
  }

  // ── 导入 ───────────────────────────────────────────

  function importUrl() {
    showUrlDialog = true;
    urlText = '';
  }

  async function confirmUrl() {
    if (!urlText.trim()) return;
    urlLoading = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch(urlText.trim(), { signal: controller.signal });
      let html = await resp.text();
      // Strip HTML tags
      html = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const title = urlText.trim().split('/').pop() || urlText.trim();
      await extractAndStore(genId(), html, 'url', title, { url: urlText.trim() });
      urlText = '';
      showUrlDialog = false;
    } catch (e: any) {
      showMessage('URL 读取失败: ' + e.message);
    } finally {
      clearTimeout(timeout);
      urlLoading = false;
    }
  }

  function importPaste() {
    showPasteDialog = true;
    pasteText = '';
  }

  async function confirmPaste() {
    if (!pasteText.trim()) return;
    await extractAndStore(genId(), pasteText.trim(), 'paste', pasteText.trim().slice(0, 80) + (pasteText.trim().length > 80 ? '…' : ''));
    pasteText = '';
    showPasteDialog = false;
  }

  function importSiyuanDoc() {
    showDocSearch = true;
    docQuery = '';
    docResults = [];
  }

  async function onFileSelected(e: Event, forceType?: string) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    await importFile(file, forceType);
    (e.target as HTMLInputElement).value = '';
  }

  async function searchDocs() {
    if (!docQuery.trim()) return;
    docSearching = true;
    siyuanSearchError = '';
    try {
      const escaped = docQuery.replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
      const resp = await fetchSyncPost('/api/query/sql', {
        stmt: `SELECT id, content as title, hpath as path FROM blocks WHERE type='d' AND content LIKE '%${escaped}%' ESCAPE '\\' LIMIT 20`,
      });
      docResults = (resp?.data || []).map((d: any) => ({
        id: d.id || '',
        title: d.title || d.path || 'Untitled',
        path: d.path || '',
      }));
    } catch (e) {
      siyuanSearchError = '搜索失败，请稍后重试';
      docResults = [];
    } finally {
      docSearching = false;
    }
  }

  async function selectDoc(doc: { id: string; title: string }) {
    showDocSearch = false;
    const id = genId();
      sourceStore.add({
        id,
        title: doc.title,
        type: 'siyuan-doc',
        content: '',
        metadata: { siyuanDocId: doc.id, addedAt: Date.now() },
        chunkStatus: 'pending',
        retryCount: 0,
      });
    try {
      const resp = await fetchSyncPost('/api/query/sql', {
        stmt: `SELECT markdown FROM blocks WHERE root_id='${doc.id.replace(/'/g, "''")}' ORDER BY sort LIMIT 500`,
      });
      const blocks = resp?.data || [];
      const text = blocks.map((b: any) => (b.markdown || '')).join('\n\n');
      const contentHash = await sha256(text);
      const existing = sourceStore.getByHash(contentHash);
      if (existing && existing.id !== id) {
        showMessage('已存在相同内容: ' + existing.title);
        sourceStore.remove(id);
        await sourceStore.save();
        loadSources();
        return;
      }
      sourceStore.update(id, {
        content: text,
        contentHash,
        chunkStatus: text ? 'done' : 'error',
        errorMessage: text ? undefined : '内容为空',
      });
      if (text) {
        await indexSource(id, text);
      }
    } catch (e: any) {
      sourceStore.update(id, { chunkStatus: 'error', errorMessage: e.message });
    }
    await sourceStore.save();
    loadSources();
  }

  // ── 文件导入逻辑 ───────────────────────────────────

  const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.html', '.htm', '.csv', '.tsv', '.log', '.xml', '.json']);
  const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);

  async function importFile(file: File, forceType?: string) {
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
    const id = genId();
    const sourceType = forceType === 'pdf' ? 'pdf' : 'file';

    sourceStore.add({
      id,
      title: file.name,
      type: sourceType,
      content: '',
      metadata: { fileName: file.name, fileSize: file.size, addedAt: Date.now(), mimeType: file.type },
      chunkStatus: 'pending',
      retryCount: 0,
    });

    try {
      let text: string;
      const isImage = IMAGE_EXTENSIONS.has(ext);
      const isPdf = sourceType === 'pdf' || ext === '.pdf';

      // ── 视觉提取 pipeline（PDF/图片） ─────────────────
      const cfg = plugin.getConfig();
      const visionType = cfg?.visionProviderType || 'off';
      if (visionType !== 'off' && (isImage || isPdf)) {
        const arrayBuffer = await file.arrayBuffer();
        visionExtracting = new Set([...visionExtracting, id]);

        // Render PDF pages to images (if PDF)
        let images: string[] = [];
        if (isPdf) {
          const pages = await renderPdfPages(arrayBuffer, { maxPages: 10 });
          images = pages.map(p => p.base64);
        } else {
          images = [Buffer.from(arrayBuffer).toString('base64')];
        }

        // Cloud vision API
        const visionImages = images.map(b64 => ({ base64: b64, mimeType: 'image/png' as const }));
        text = await callVisionLLM(
          cfg, cfg.flashcardProviderId, cfg.visionModel || 'glm-ocr',
          VISION_PROMPT,
          visionImages,
          { maxTokens: 4096 }
        );

        const nextSet = new Set(visionExtracting);
        nextSet.delete(id);
        visionExtracting = nextSet;
      } else {
        // ── 普通 parser pipeline ─────────────────────────
        const parser = registry.getParser(ext);

        if (parser) {
          const ext = file.name.split('.').pop() || 'tmp';
          const tmpPath = path.join(os.tmpdir(), `import_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
          const buf = Buffer.from(await file.arrayBuffer());
          fs.writeFileSync(tmpPath, buf);
          try {
            const result = await parser.parse(tmpPath);
            text = result.text;
          } finally {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
          }
        } else if (TEXT_EXTENSIONS.has(ext)) {
          text = await file.text();
          if (ext === '.html' || ext === '.htm') {
            text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          }
        } else if (isPdf) {
          const buffer = await file.arrayBuffer();
          try {
            const { extractPdfText } = await import('../libs/sources/pdf-extractor');
            const result = await extractPdfText(buffer, file.name);
            text = result.text;
          } catch {
            throw new Error('PDF 解析失败，请确保 pdf-extractor 可用');
          }
        } else {
          throw new Error(`不支持的文件类型: ${ext}。当前仅支持文本文件直接导入，其他格式请使用系统 Pandoc 导入。`);
        }
      }

      const contentHash = await sha256(text);
      const existing = sourceStore.getByHash(contentHash);
      if (existing && existing.id !== id) {
        showMessage('已存在相同内容: ' + existing.title);
        sourceStore.remove(id);
        await sourceStore.save();
        loadSources();
        return;
      }

      sourceStore.update(id, {
        content: text,
        contentHash,
        chunkStatus: 'done',
      });
      await indexSource(id, text);
    } catch (e: any) {
      sourceStore.update(id, { chunkStatus: 'error', errorMessage: e.message });
    }

    await sourceStore.save();
    loadSources();
  }

  // ── 视觉提取 prompt ──────────────────────────────────

  const VISION_PROMPT = '请精确提取此图片中的所有内容。普通文字保持原文，数学公式用 LaTeX 格式（行内 $...$，独立 $$...$$），表格用 Markdown。只输出提取结果，不要解释。';

  // ── 共享 dedup 辅助 ────────────────────────────────

  async function extractAndStore(id: string, text: string, type: SourceRecord['type'], title: string, extraMeta: Record<string, any> = {}) {
    sourceStore.add({
      id,
      title,
      type,
      content: '',
      metadata: { ...extraMeta, addedAt: Date.now() },
      chunkStatus: 'pending',
      retryCount: 0,
    });

    try {
      const contentHash = await sha256(text);
      const existing = sourceStore.getByHash(contentHash);
      if (existing && existing.id !== id) {
        showMessage('已存在相同内容: ' + existing.title);
        sourceStore.remove(id);
        await sourceStore.save();
        loadSources();
        return;
      }

      sourceStore.update(id, {
        content: text,
        contentHash,
        chunkStatus: 'done',
      });
      await indexSource(id, text);
    } catch (e: any) {
      sourceStore.update(id, { chunkStatus: 'error', errorMessage: e.message });
    }

    await sourceStore.save();
    loadSources();
  }

  // ── SHA-256 ──────────────────────────────────────────

  async function sha256(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── 删除 ────────────────────────────────────────────

  async function deleteItem(id: string) {
    const source = sourceStore.getById(id);
    if (!source) return;
    confirm('删除来源', `确定删除「${source.title}」？`, () => {
      sourceStore.remove(id);
      selectedIds = selectedIds.filter(sid => sid !== id);
      sourceStore.save().then(() => loadSources());
    });
  }

  async function deleteSelected() {
    const toDelete = filteredSources.filter(s => selectedIds.includes(s.id));
    if (toDelete.length === 0) return;
    confirm('删除选中', `确定删除选中的 ${toDelete.length} 项？`, () => {
      for (const s of toDelete) {
        sourceStore.remove(s.id);
      }
      selectedIds = [];
      sourceStore.save().then(() => loadSources());
    });
  }

  // ── 重试 ────────────────────────────────────────────

  async function retryImport(id: string) {
    const source = sourceStore.getById(id);
    if (!source) return;

    if (source.type === 'url' && source.metadata.url) {
      sourceStore.update(id, { chunkStatus: 'pending', errorMessage: undefined, retryCount: source.retryCount + 1 });
      sources = sourceStore.getAll();
      const urlController = new AbortController();
      const urlTimeout = setTimeout(() => urlController.abort(), 30000);
      try {
        const resp = await fetch(source.metadata.url, { signal: urlController.signal });
        let html = await resp.text();
        html = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const contentHash = await sha256(html);
        sourceStore.update(id, { content: html, contentHash, chunkStatus: 'done' });
        await indexSource(id, html);
      } catch (e: any) {
        sourceStore.update(id, { chunkStatus: 'error', errorMessage: e.message });
      } finally {
        clearTimeout(urlTimeout);
      }
      await sourceStore.save();
      loadSources();
    } else if (source.type === 'siyuan-doc' && source.metadata.siyuanDocId) {
      sourceStore.update(id, { chunkStatus: 'pending', errorMessage: undefined, retryCount: source.retryCount + 1 });
      sources = sourceStore.getAll();
      try {
        const docId = source.metadata.siyuanDocId;
        const resp = await fetchSyncPost('/api/query/sql', {
          stmt: `SELECT markdown FROM blocks WHERE root_id='${docId.replace(/'/g, "''")}' ORDER BY sort LIMIT 500`,
        });
        const blocks = resp?.data || [];
        const text = blocks.map((b: any) => (b.markdown || '')).join('\n\n');
        const contentHash = await sha256(text);
        sourceStore.update(id, { content: text, contentHash, chunkStatus: text ? 'done' : 'error', errorMessage: text ? undefined : '内容为空' });
        if (text) {
          await indexSource(id, text);
        }
      } catch (e: any) {
        sourceStore.update(id, { chunkStatus: 'error', errorMessage: e.message });
      }
      await sourceStore.save();
      loadSources();
    } else {
      // Remove old errored record first, then prompt re-upload
      sourceStore.remove(id);
      sourceStore.save();
      loadSources();
      showMessage('请重新导入文件');
    }
  }

  // ── RAG 索引 ─────────────────────────────────────────

  /**
   * Wait up to 60 s for the embedding provider to be ready.
   * Throws with a Chinese error message on failure.
   */
  async function ensureEmbedderReady(): Promise<any> {
    const embedder = await getRagEmbedderProvider(plugin);
    if (!embedder.isReady()) {
      try {
        await embedder.initialize();
      } catch (e: any) {
        throw new Error('嵌入模型初始化失败: ' + (e?.message || e));
      }
    }
    for (let i = 0; i < 120; i++) {
      if (embedder.isReady()) return embedder;
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('嵌入模型等待超时（60秒）');
  }

  /**
   * After a source is imported and its text stored, index it into the
   * vector store so RAG queries can find it. Gracefully skips if the
   * embedding provider is not yet ready (e.g. model still downloading).
   */
  async function indexSource(sourceId: string, text: string) {
    const source = sourceStore.getById(sourceId);
    if (!source) return;
    try {
      const embedder = await getRagEmbedderProvider(plugin);
      if (embedder && embedder.isReady()) {
        // Clear stale vectors for this source first
        vectorStore.removeBySourceId(sourceId);
        await ingestDocument(text, { sourceId, title: source.title }, vectorStore, embedder as any);
      } else {
        console.warn('[siyuan-all-in-one] indexSource skipped: embedder not ready');
        sourceStore.update(sourceId, {
          chunkStatus: 'error',
          errorMessage: '嵌入模型未就绪，无法建立向量索引'
        });
        await sourceStore.save();
        sources = sourceStore.getAll();
      }
    } catch (e: any) {
      console.warn('[siyuan-all-in-one] indexSource failed:', sourceId, e?.message);
      sourceStore.update(sourceId, {
        chunkStatus: 'error',
        errorMessage: '向量索引失败: ' + (e?.message || '未知错误')
      });
      await sourceStore.save();
      sources = sourceStore.getAll();
    }
  }

  /**
   * Re-index a single source, waiting up to 60 s for the embedder to
   * become ready. Used by the per-item re-index button.
   */
  async function reIndex(sourceId: string) {
    const source = sourceStore.getById(sourceId);
    if (!source || !source.content) {
      showMessage('来源内容为空，无法重建索引');
      return;
    }
    try {
      sourceStore.update(sourceId, { chunkStatus: 'pending', errorMessage: undefined });
      loadSources();

      const embedder = await ensureEmbedderReady();

      // Clear old vectors for this source
      vectorStore.removeBySourceId(sourceId);
      await vectorStore.save();

      // Re-ingest
      await ingestDocument(source.content, { sourceId, title: source.title }, vectorStore, embedder);
      await vectorStore.save();

      sourceStore.update(sourceId, { chunkStatus: 'done' });
      await sourceStore.save();
      loadSources();
      showMessage('重建索引完成');
    } catch (e: any) {
      sourceStore.update(sourceId, {
        chunkStatus: 'error',
        errorMessage: '重建索引失败: ' + (e?.message || '未知错误')
      });
      await sourceStore.save();
      loadSources();
      showMessage('重建索引失败: ' + (e?.message || e));
    }
  }

  /** Remove vectors whose sourceId does not match any known source. */
  async function cleanupOrphanedVectors() {
    const knownIds = new Set(sources.map(s => s.id));
    const allVectors = vectorStore.getAll();
    const orphaned = allVectors.filter(v => !knownIds.has(v.sourceId));
    if (orphaned.length === 0) {
      showMessage('没有发现无效向量');
      return;
    }
    for (const v of orphaned) {
      vectorStore.removeBySourceId(v.sourceId);
    }
    await vectorStore.save();
    showMessage(`已清理 ${orphaned.length} 个无效向量`);
  }

  // ── 底部操作 ────────────────────────────────────────

  function useFor(panel: 'rag' | 'generate' | 'concepts') {
    if (selectedIds.length === 0) { showMessage('请先选择来源'); return; }

    // Filter out errored items — they can't be used
    const validIds = selectedIds.filter(id => {
      const s = sourceStore.getById(id);
      return s && s.chunkStatus !== 'error';
    });
    const skipped = selectedIds.length - validIds.length;
    if (skipped > 0) {
      showMessage(`已跳过 ${skipped} 个导入失败的项目`);
    }
    if (validIds.length === 0) return;

    appStore.selectedSourceIds = validIds;
    sourceStore.save();
    if (appStore.onSwitchTab) appStore.onSwitchTab(panel);
  }

  // ── 类型标签映射 ────────────────────────────────────

  function typeLabel(type: string): string {
    const map: Record<string, string> = {
      'file': '文件',
      'url': 'URL',
      'paste': '粘贴',
      'pdf': 'PDF',
      'siyuan-doc': '思源文档',
    };
    return map[type] || type;
  }

  function typeIcon(type: string): string {
    const map: Record<string, string> = {
      'file': '#iconFile',
      'url': '#iconLink',
      'paste': '#iconEdit',
      'pdf': '#iconPDF',
      'siyuan-doc': '#iconFiles',
    };
    return map[type] || '#iconFile';
  }

  function statusLabel(s: SourceRecord): string {
    if (s.chunkStatus === 'done') return '✓ 完成';
    if (s.chunkStatus === 'error') return '✗ 错误';
    return '⏳ 处理中';
  }

  function statusClass(s: SourceRecord): string {
    if (s.chunkStatus === 'done') return 'status--done';
    if (s.chunkStatus === 'error') return 'status--error';
    return 'status--pending';
  }

  function onOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showPasteDialog = false;
      showUrlDialog = false;
      showDocSearch = false;
    }
  }
</script>

<div class="source-library">
  <!-- 顶部工具栏 -->
  <div class="source-toolbar">
    <!-- 导入按钮 -->
    <div class="toolbar-import-groups">
      <div class="import-group">
        <span class="import-group__label">文本格式：</span>
        <div class="import-group__buttons">
          {#each textFormats as fmt}
            <button
              class="b3-button b3-button--small import-ext-btn"
              on:click={() => fileInputRefs[fmt.label]?.click()}
              title="导入 {fmt.label} 文件"
            >
              {fmt.label}
            </button>
            <input
              type="file"
              class="import-file-input"
              bind:this={fileInputRefs[fmt.label]}
              on:change={(e) => onFileSelected(e, fmt.force)}
              accept={fmt.accept}
            />
          {/each}
        </div>
      </div>

      <div class="import-group">
        <span class="import-group__label">文档格式：</span>
        <div class="import-group__buttons">
          {#each docFormats as fmt}
            <button
              class="b3-button b3-button--small import-ext-btn"
              on:click={() => fileInputRefs[fmt.label]?.click()}
              title="导入 {fmt.label} 文件"
            >
              {fmt.label}
            </button>
            <input
              type="file"
              class="import-file-input"
              bind:this={fileInputRefs[fmt.label]}
              on:change={(e) => onFileSelected(e, fmt.force)}
              accept={fmt.accept}
            />
          {/each}
        </div>
      </div>

      <div class="import-group">
        <span class="import-group__label">其他：</span>
        <div class="import-group__buttons">
          <button class="b3-button b3-button--small import-ext-btn" on:click={importUrl} title="导入 URL">🌐 URL</button>
          <button class="b3-button b3-button--small import-ext-btn" on:click={importPaste} title="粘贴文本">📎 粘贴</button>
          <button class="b3-button b3-button--small import-ext-btn" on:click={importSiyuanDoc} title="思源文档">📑 思源</button>
        </div>
      </div>
    </div>

    <div class="toolbar-spacer"></div>

    <!-- 搜索框 -->
    <input class="b3-text-field search-input" type="text" placeholder="搜索标题…" bind:value={searchQuery} />

    <!-- 过滤器 -->
    <select class="b3-select filter-select" bind:value={filterType}>
      {#each typeFilterOptions as opt}
        <option value={opt}>{opt}</option>
      {/each}
    </select>

    <select class="b3-select" bind:value={sortBy}>
      <option value="newest">最新 ↑</option>
      <option value="oldest">最早 ↑</option>
      <option value="name">名称 ↑</option>
    </select>
  </div>

  <!-- 来源列表 -->
  <div class="source-list">
    <!-- 全选行 -->
    <div class="source-list-header">
      <label class="source-checkbox">
        <input type="checkbox" checked={allSelected} on:change={toggleSelectAll} />
        <span class="checkbox-count">{selectedIds.length > 0 ? `已选 ${selectedIds.length}` : '全选'}</span>
      </label>
    </div>

    {#if visibleSources.length === 0}
      <div class="source-empty">
        {#if sources.length === 0}
          <p>暂无来源，点击「导入」添加</p>
        {:else}
          <p>无匹配项</p>
        {/if}
      </div>
    {/if}

    {#each visibleSources as source (source.id)}
      <div
        class="source-item"
        class:source-item--error={source.chunkStatus === 'error'}
        class:source-item--selected={selectedIds.includes(source.id)}
      >
        <div class="source-item-left">
          <label class="source-checkbox">
            <input type="checkbox" bind:group={selectedIds} value={source.id} />
          </label>
          <span class="source-item-icon">
            <svg><use xlink:href={typeIcon(source.type)}></use></svg>
          </span>
          <div class="source-item-info">
            <span class="source-item-title" title={source.title}>{source.title}</span>
            <span class="source-item-meta">
              <span class="source-type-label">{typeLabel(source.type)}</span>
              <span class="source-status {statusClass(source)}" title={source.errorMessage || ''}>{statusLabel(source)}</span>
              {#if source.chunkStatus === 'error' && source.errorMessage}
                <span class="source-error-text" title={source.errorMessage}>{source.errorMessage}</span>
              {/if}
              <span>{new Date(source.metadata.addedAt).toLocaleDateString()}</span>
            </span>
          </div>
        </div>
        <div class="source-item-actions">
          {#if source.chunkStatus === 'error'}
            <button class="b3-button b3-button--small b3-button--text source-retry-btn" on:click={() => retryImport(source.id)} title="重试">
              <svg><use xlink:href="#iconRefresh"></use></svg>
            </button>
          {/if}
          <button class="b3-button b3-button--small b3-button--text source-reindex-btn" on:click={() => reIndex(source.id)} title="重建向量索引">
            <svg><use xlink:href="#iconRefresh"></use></svg>
          </button>
          <button class="b3-button b3-button--small b3-button--text source-delete-btn" on:click={() => deleteItem(source.id)} title="删除">
            <svg><use xlink:href="#iconTrash"></use></svg>
          </button>
        </div>
      </div>
    {/each}
  </div>

  <!-- 底部操作栏 -->
  <div class="source-bottom-bar">
    <span class="bottom-selected-count">已选 {selectedIds.length} 项</span>
    <div class="bottom-actions">
      <button class="b3-button b3-button--small b3-button--outline" on:click={deleteSelected} disabled={selectedIds.length === 0}>
        删除选中
      </button>
      <button class="b3-button b3-button--small b3-button--outline" on:click={cleanupOrphanedVectors}>
        清理无效向量
      </button>
      <button class="b3-button b3-button--small" on:click={() => useFor('rag')} disabled={selectedIds.length === 0}>
        用于 RAG 对话
      </button>
      <button class="b3-button b3-button--small" on:click={() => useFor('generate')} disabled={selectedIds.length === 0}>
        用于制卡
      </button>
      <button class="b3-button b3-button--small" on:click={() => useFor('concepts')} disabled={selectedIds.length === 0}>
        用于导图
      </button>
    </div>
  </div>
</div>

<!-- 粘贴 Dialog -->
{#if showPasteDialog}
<div class="overlay" on:click|self={() => { showPasteDialog = false; }} on:keydown={onOverlayKeydown} role="button" tabindex="0" aria-label="关闭粘贴对话框">
  <div class="dialog" role="dialog" aria-modal="true">
    <h3>📎 粘贴内容</h3>
    <textarea
      class="b3-text-field dialog-textarea"
      bind:value={pasteText}
      rows="8"
      placeholder="粘贴文本内容…"
    ></textarea>
    <div class="dialog-actions">
      <button class="b3-button b3-button--outline" on:click={() => { showPasteDialog = false; }}>取消</button>
      <button class="b3-button b3-button--text" on:click={confirmPaste} disabled={!pasteText.trim()}>确认</button>
    </div>
  </div>
</div>
{/if}

<!-- URL Dialog -->
{#if showUrlDialog}
<div class="overlay" on:click|self={() => { showUrlDialog = false; }} on:keydown={onOverlayKeydown} role="button" tabindex="0" aria-label="关闭 URL 对话框">
  <div class="dialog" role="dialog" aria-modal="true">
    <h3>🌐 导入 URL</h3>
    <input class="b3-text-field" type="url" bind:value={urlText} placeholder="https://example.com/article" />
    <div class="dialog-actions">
      <button class="b3-button b3-button--outline" on:click={() => { showUrlDialog = false; }}>取消</button>
      <button class="b3-button b3-button--text" on:click={confirmUrl} disabled={!urlText.trim() || urlLoading}>
        {urlLoading ? '读取中…' : '确认'}
      </button>
    </div>
  </div>
</div>
{/if}

<!-- 思源文档搜索 Dialog -->
{#if showDocSearch}
<div class="overlay" on:click|self={() => { showDocSearch = false; }} on:keydown={onOverlayKeydown} role="button" tabindex="0" aria-label="关闭思源文档搜索对话框">
  <div class="dialog dialog--wide" role="dialog" aria-modal="true">
    <h3>📑 搜索思源文档</h3>
    <div class="doc-search-row">
      <input
        class="b3-text-field"
        type="text"
        bind:value={docQuery}
        placeholder="输入关键词搜索文档…"
        on:keydown={(e) => { if (e.key === 'Enter') searchDocs(); }}
      />
      <button class="b3-button b3-button--outline" on:click={searchDocs} disabled={docSearching}>
        {docSearching ? '搜索中…' : '搜索'}
      </button>
    </div>
    {#if docSearching}
      <p class="doc-search-status">搜索中…</p>
    {/if}
    {#if siyuanSearchError}
      <p style="color: var(--b3-card-error-color)">{siyuanSearchError}</p>
    {/if}
    {#if docResults.length > 0}
      <div class="doc-result-list">
        {#each docResults as doc}
          <button class="doc-result-item" on:click={() => selectDoc(doc)}>
            <svg><use xlink:href="#iconFiles"></use></svg>
            <div class="doc-result-info">
              <span class="doc-result-title">{doc.title}</span>
              {#if doc.path}
                <span class="doc-result-path">{doc.path}</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {:else if docQuery && !docSearching}
      <p class="doc-search-status doc-search-empty">无匹配文档</p>
    {/if}
  </div>
</div>
{/if}

<style lang="scss">
  .source-library {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .source-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--b3-theme-surface-lighter);
    flex-shrink: 0;
  }

  .toolbar-import-groups {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    flex-shrink: 0;
  }

  .import-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .import-group__label {
    font-size: var(--aio-fs-xs);
    opacity: 0.6;
    white-space: nowrap;
    user-select: none;
  }

  .import-group__buttons {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }

  .import-ext-btn {
    height: 32px;
    min-width: 44px;
    padding: 0 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--aio-fs-xs);
    flex-shrink: 0;
  }

  .import-file-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }

  .toolbar-spacer {
    flex: 1;
    min-width: 0;
  }

  .filter-select {
    flex: 0 0 auto;
    min-width: 100px;
    font-size: var(--aio-fs-sm);
  }

  .search-input {
    flex: 1;
    min-width: 0;
    font-size: var(--aio-fs-sm);
  }

  .source-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .source-list-header {
    padding: 6px 12px;
    border-bottom: 1px solid var(--b3-theme-surface-lighter);
    flex-shrink: 0;
  }

  .source-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    p {
      font-size: var(--aio-fs-base);
      opacity: 0.4;
      text-align: center;
    }
  }

  .source-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-left: 3px solid transparent;
    border-bottom: 1px solid var(--b3-theme-surface-lighter);
    transition: background 0.12s;

    &:hover {
      background: var(--b3-theme-surface-light);
    }

    &.source-item--selected {
      background: var(--b3-theme-primary-lightest);
    }

    &.source-item--error {
      border-left-color: var(--b3-card-error-color);
    }
  }

  .source-item-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .source-checkbox {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    flex-shrink: 0;

    input[type="checkbox"] {
      margin: 0;
      cursor: pointer;
    }
  }

  .checkbox-count {
    font-size: var(--aio-fs-xs);
    opacity: 0.5;
    user-select: none;
  }

  .source-item-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;

    svg {
      width: 15px;
      height: 15px;
      color: var(--b3-theme-on-surface);
    }
  }

  .source-item-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .source-item-title {
    font-size: var(--aio-fs-base);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-item-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--aio-fs-xs);
  }

  .source-type-label {
    opacity: 0.5;
  }

  .source-status {
    &.status--done { color: var(--b3-card-success-color); }
    &.status--error { color: var(--b3-card-error-color); }
    &.status--pending { color: var(--b3-card-warning-color); }
  }

  .source-error-text {
    color: var(--b3-card-error-color);
    font-size: var(--aio-fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
    opacity: 0.8;
  }

  .source-item-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .source-retry-btn {
    svg {
      width: 14px;
      height: 14px;
      color: var(--b3-card-warning-color);
    }
  }

  .source-reindex-btn {
    svg {
      width: 14px;
      height: 14px;
      color: var(--b3-theme-primary);
    }
  }

  .source-delete-btn {
    svg {
      width: 14px;
      height: 14px;
      color: var(--b3-card-error-color);
    }
  }

  .source-bottom-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-top: 1px solid var(--b3-theme-surface-lighter);
    flex-shrink: 0;
    gap: 8px;
  }

  .bottom-selected-count {
    font-size: var(--aio-fs-sm);
    opacity: 0.6;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .bottom-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  // ── Dialog overlay ────────────────────────────────

  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
  }

  .dialog {
    background: var(--b3-theme-background);
    border-radius: 8px;
    padding: 20px;
    width: 480px;
    max-width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;

    h3 {
      margin: 0;
      font-size: var(--aio-fs-lg);
    }
  }

  .dialog--wide {
    width: 600px;
  }

  .dialog-textarea {
    resize: vertical;
    min-height: 120px;
    font-family: var(--b3-font-family-code, monospace);
    font-size: var(--aio-fs-sm);
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .doc-search-row {
    display: flex;
    gap: 6px;

    .b3-text-field {
      flex: 1;
    }
  }

  .doc-search-status {
    font-size: var(--aio-fs-sm);
    opacity: 0.5;
    text-align: center;
    margin: 8px 0;
  }

  .doc-search-empty {
    color: var(--b3-card-warning-color);
    opacity: 1;
  }

  .doc-result-list {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 4px;
  }

  .doc-result-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    color: var(--b3-theme-on-background);
    cursor: pointer;
    text-align: left;
    font-size: var(--aio-fs-base);

    svg {
      width: 15px;
      height: 15px;
      flex-shrink: 0;
      color: var(--b3-theme-on-surface);
    }

    &:hover {
      background: var(--b3-theme-surface-light);
    }

    & + & {
      border-top: 1px solid var(--b3-theme-surface-lighter);
    }
  }

  .doc-result-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .doc-result-title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .doc-result-path {
    font-size: var(--aio-fs-xs);
    opacity: 0.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
