<script lang="ts">
  import { showMessage } from 'siyuan';
  import { fetchOpenNotebookPipelineSources, runPromptPipeline } from '../libs/ai';
  import { resolveLLMConfig } from '../libs/llm';
  import { OpenNotebookClient } from '../libs/notebook';

  export let plugin: any;
  export let cardStore: any;
  export let conceptStore: any;
  export let mindmapStore: any;
  export let config: any;

  type CheckState = 'idle' | 'running' | 'pass' | 'warn' | 'fail';

  interface CheckItem {
    id: string;
    label: string;
    state: CheckState;
    detail: string;
  }

  interface DiagnosticReport {
    reportKind: 'siyuan-all-in-one-diagnostics';
    generatedAt: string;
    query: string;
    checks: CheckItem[];
    stores?: {
      cards: number;
      concepts: number;
      relations: number;
      mindmaps: number;
    };
    model?: {
      providerId: string | null;
      model: string | null;
      apiKeySet: boolean;
      baseUrlSet: boolean;
      notebookEndpointSet: boolean;
    };
    openNotebook?: {
      endpointSet: boolean;
      notebooks: number | null;
      sources: number | null;
      error?: string;
    };
    aiDryRun?: {
      concepts: number | null;
      relations: number | null;
      cards: number | null;
      uncertain: number | null;
      warnings: string[];
      error?: string;
    };
  }

  const defaultQuery = 'impulse momentum';

  let query = defaultQuery;
  let running = false;
  let runningAi = false;
  let copying = false;
  let lastReport: DiagnosticReport | null = null;
  let storesReport: DiagnosticReport['stores'];
  let modelReport: DiagnosticReport['model'];
  let openNotebookReport: DiagnosticReport['openNotebook'];
  let aiDryRunReport: DiagnosticReport['aiDryRun'];
  let checks: CheckItem[] = [
    { id: 'stores', label: '本地数据', state: 'idle', detail: '等待检查' },
    { id: 'config', label: '模型配置', state: 'idle', detail: '等待检查' },
    { id: 'opennotebook', label: 'OpenNotebook', state: 'idle', detail: '等待检查' },
    { id: 'ai', label: 'AI 干跑', state: 'idle', detail: '可选：真实调用模型，只生成候选不保存' },
  ];

  function setCheck(id: string, state: CheckState, detail: string) {
    checks = checks.map((item) => item.id === id ? { ...item, state, detail } : item);
    refreshReport();
  }

  function cfg() {
    return plugin?.getConfig?.() || config || {};
  }

  function refreshReport() {
    lastReport = {
      reportKind: 'siyuan-all-in-one-diagnostics',
      generatedAt: new Date().toISOString(),
      query: query.trim() || defaultQuery,
      checks,
      stores: storesReport,
      model: modelReport,
      openNotebook: openNotebookReport,
      aiDryRun: aiDryRunReport,
    };
  }

  async function runBasicChecks() {
    running = true;
    try {
      const cards = cardStore?.getAll?.() || [];
      const concepts = conceptStore?.getAll?.() || [];
      const relations = conceptStore?.getRelations?.() || [];
      const mindmaps = mindmapStore?.getAll?.() || [];
      storesReport = {
        cards: cards.length,
        concepts: concepts.length,
        relations: relations.length,
        mindmaps: mindmaps.length,
      };
      setCheck(
        'stores',
        cards.length > 0 ? 'pass' : 'warn',
        `${cards.length} 张卡片，${concepts.length} 个概念，${relations.length} 条关系，${mindmaps.length} 张导图`
      );

      const currentConfig = cfg();
      const provider = currentConfig.providers?.find((item: any) => item.id === currentConfig.flashcardProviderId);
      const model = currentConfig.flashcardModel || provider?.models?.[0] || '';
      modelReport = {
        providerId: provider?.id || null,
        model: model || null,
        apiKeySet: Boolean(provider?.apiKey),
        baseUrlSet: Boolean(provider?.baseUrl),
        notebookEndpointSet: Boolean(currentConfig.notebookEndpoint),
      };
      if (!provider) {
        setCheck('config', 'fail', '未找到制卡 Provider');
      } else if (!model) {
        setCheck('config', 'fail', `Provider ${provider.id} 未配置模型`);
      } else if (!provider.apiKey && !String(provider.baseUrl || '').includes('localhost') && !String(provider.baseUrl || '').includes('127.0.0.1')) {
        setCheck('config', 'warn', `${provider.id} / ${model} 未配置 API Key`);
      } else {
        setCheck('config', 'pass', `${provider.id} / ${model}`);
      }

      await checkOpenNotebook();
    } catch (error: any) {
      showMessage(`诊断失败：${error?.message || error}`);
    } finally {
      running = false;
      refreshReport();
    }
  }

  async function checkOpenNotebook() {
    const currentConfig = cfg();
    if (!currentConfig.notebookEndpoint) {
      openNotebookReport = { endpointSet: false, notebooks: null, sources: null };
      setCheck('opennotebook', 'fail', '未配置 OpenNotebook 端点');
      return [];
    }
    setCheck('opennotebook', 'running', '正在连接和检索');
    try {
      const client = new OpenNotebookClient(currentConfig.notebookEndpoint, 10_000);
      const notebooks = await client.listNotebooks();
      const sources = await fetchOpenNotebookPipelineSources({
        endpoint: currentConfig.notebookEndpoint,
        query: query.trim() || defaultQuery,
        limit: 3,
        maxCharsPerSource: 1200,
      });
      openNotebookReport = {
        endpointSet: true,
        notebooks: notebooks.length,
        sources: sources.length,
      };
      if (sources.length === 0) {
        setCheck('opennotebook', 'warn', `${notebooks.length} 个 notebook，但当前查询没有可用片段`);
      } else {
        setCheck('opennotebook', 'pass', `${notebooks.length} 个 notebook，检索到 ${sources.length} 个可用于制卡/导图的片段`);
      }
      return sources;
    } catch (error: any) {
      openNotebookReport = {
        endpointSet: true,
        notebooks: null,
        sources: null,
        error: diagnosticText(error?.message || String(error)),
      };
      setCheck('opennotebook', 'fail', error?.message || String(error));
      return [];
    }
  }

  async function runAiDryRun() {
    runningAi = true;
    setCheck('ai', 'running', '正在真实调用模型，只生成候选，不保存数据');
    try {
      const currentConfig = cfg();
      const provider = currentConfig.providers?.find((item: any) => item.id === currentConfig.flashcardProviderId);
      if (!provider) throw new Error('未找到制卡 Provider');
      const model = currentConfig.flashcardModel || provider.models?.[0] || '';
      if (!model) throw new Error('未配置制卡模型');
      const sources = await checkOpenNotebook();
      if (sources.length === 0) throw new Error('没有可用于 AI 干跑的 OpenNotebook 片段');

      const llmConfig = resolveLLMConfig(currentConfig, currentConfig.flashcardProviderId, model);
      llmConfig.timeout = 90_000;
      llmConfig.maxTokens = 2500;
      llmConfig.temperature = 0.1;

      const result = await runPromptPipeline(sources, {
        llmConfig,
        targetCardCount: 1,
        temperature: 0.1,
        language: 'zh-CN',
      });
      aiDryRunReport = {
        concepts: result.concepts.length,
        relations: result.relations.length,
        cards: result.cards.length,
        uncertain: result.uncertain.length,
        warnings: diagnosticWarnings(result.warnings),
      };
      if (result.concepts.length === 0 || result.cards.length === 0) {
        setCheck('ai', 'warn', `候选不足：${result.concepts.length} 个概念，${result.cards.length} 张卡。${result.warnings.join('；')}`);
      } else {
        setCheck('ai', 'pass', `${result.concepts.length} 个概念，${result.relations.length} 条关系，${result.cards.length} 张卡，${result.uncertain.length} 个不确定项`);
      }
    } catch (error: any) {
      aiDryRunReport = {
        concepts: null,
        relations: null,
        cards: null,
        uncertain: null,
        warnings: [],
        error: diagnosticText(error?.message || String(error)),
      };
      setCheck('ai', 'fail', error?.message || String(error));
    } finally {
      runningAi = false;
      refreshReport();
    }
  }

  async function copyDiagnosticReport() {
    copying = true;
    try {
      refreshReport();
      const report = JSON.stringify(lastReport, null, 2);
      await copyText(report);
      showMessage('已复制诊断结果');
    } catch (error: any) {
      showMessage(`复制失败：${error?.message || error}`);
    } finally {
      copying = false;
    }
  }

  async function copyText(text: string): Promise<void> {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function diagnosticWarnings(warnings: string[]) {
    return warnings.slice(0, 10).map((warning) => diagnosticText(warning, 500));
  }

  function diagnosticText(value: any, limit = 800) {
    const text = String(value || '');
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function stateText(state: CheckState) {
    return {
      idle: '待检查',
      running: '检查中',
      pass: '通过',
      warn: '注意',
      fail: '失败',
    }[state];
  }
</script>

<div class="diag-panel">
  <div class="diag-head">
    <div>
      <h2>诊断</h2>
      <p>检查插件数据、OpenNotebook、模型与候选生成链路。</p>
    </div>
    <button class="b3-button" on:click={runBasicChecks} disabled={running || runningAi}>
      {running ? '检查中...' : '运行检查'}
    </button>
  </div>

  <div class="diag-query">
    <label for="diag-query">检索问题</label>
    <input id="diag-query" class="b3-text-field" bind:value={query} placeholder={defaultQuery} />
  </div>

  <div class="diag-list">
    {#each checks as check}
      <section class="diag-item diag-{check.state}">
        <div class="diag-status">
          <span>{check.label}</span>
          <strong>{stateText(check.state)}</strong>
        </div>
        <p>{check.detail}</p>
      </section>
    {/each}
  </div>

  <div class="diag-actions">
    <button class="b3-button b3-button--outline" on:click={runAiDryRun} disabled={running || runningAi}>
      {runningAi ? 'AI 干跑中...' : '运行 AI 干跑'}
    </button>
    <button
      class="b3-button b3-button--outline"
      aria-label="copy-diagnostic-report"
      on:click={copyDiagnosticReport}
      disabled={running || runningAi || copying}
    >
      {copying ? '复制中...' : '复制诊断结果'}
    </button>
  </div>
</div>

<style lang="scss">
  .diag-panel {
    height: 100%;
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .diag-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;

    h2 { margin: 0; font-size: var(--aio-fs-lg); }
    p { margin: 4px 0 0; color: var(--b3-theme-on-surface); font-size: var(--aio-fs-sm); }
  }

  .diag-query {
    display: flex;
    flex-direction: column;
    gap: 6px;

    label { font-size: var(--aio-fs-sm); color: var(--b3-theme-on-surface); }
  }

  .diag-list {
    display: grid;
    gap: 8px;
  }

  .diag-item {
    border: 1px solid var(--b3-theme-surface-lighter);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--b3-theme-surface);

    p {
      margin: 6px 0 0;
      font-size: var(--aio-fs-sm);
      color: var(--b3-theme-on-surface);
    }
  }

  .diag-status {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: var(--aio-fs-base);

    strong { font-size: var(--aio-fs-sm); }
  }

  .diag-pass { border-color: var(--b3-card-success-color); }
  .diag-warn { border-color: var(--b3-card-warning-color); }
  .diag-fail { border-color: var(--b3-card-error-color); }
  .diag-running { border-color: var(--b3-theme-primary); }

  .diag-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
