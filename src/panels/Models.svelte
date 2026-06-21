<script lang="ts">
  import { onMount } from 'svelte';
  import { OpenNotebookClient } from '../libs/notebook';
  import type { ONModel, DefaultModels, ModelType } from '../libs/notebook';
  import { MODEL_ROLES } from '../libs/notebook';
  import { showMessage, confirm } from 'siyuan';

  export let plugin: any;

  let client: OpenNotebookClient | null = null;
  let models: ONModel[] = [];
  let defaults: DefaultModels = {};
  let loading = true;
  let saving = '';

  // 按 4 种 type 分组
  const TYPE_LABELS: Record<ModelType, string> = {
    language: '对话模型 (Language)',
    embedding: '嵌入模型 (Embedding)',
    text_to_speech: '语音合成 (TTS)',
    speech_to_text: '语音识别 (STT)',
  };

  $: modelsByType = (Object.keys(TYPE_LABELS) as ModelType[]).map((type) => ({
    type,
    label: TYPE_LABELS[type],
    items: models.filter((m) => m.type === type),
  }));

  onMount(async () => {
    const cfg = plugin.getConfig();
    if (!cfg.notebookEndpoint) { showMessage('请先在设置中配置 Open Notebook 端点'); return; }
    client = new OpenNotebookClient(cfg.notebookEndpoint);
    await refresh();
  });

  async function refresh() {
    if (!client) return;
    loading = true;
    try {
      [models, defaults] = await Promise.all([
        client.getModels(),
        client.getDefaultModels(),
      ]);
    } catch (e: any) {
      showMessage('加载失败: ' + e.message);
    }
    loading = false;
  }

  /** 设置某个角色为指定模型 */
  async function setRole(role: keyof DefaultModels, modelId: string) {
    if (!client) return;
    saving = role as string;
    try {
      defaults = await client.updateDefaultModels({ ...defaults, [role]: modelId });
      showMessage('已设置');
    } catch { showMessage('设置失败'); }
    saving = '';
  }

  /** 清除某个角色的分配 */
  async function clearRole(role: keyof DefaultModels) {
    if (!client) return;
    saving = role as string;
    try {
      defaults = await client.updateDefaultModels({ ...defaults, [role]: '' });
      showMessage('已清除');
    } catch { showMessage('清除失败'); }
    saving = '';
  }

  async function autoAssign() {
    if (!client) return;
    saving = 'auto';
    try {
      const result = await client.autoAssignModels();
      const assignedCount = Object.keys(result.assigned || {}).length;
      showMessage(`自动分配完成：分配 ${assignedCount} 个，跳过 ${result.skipped?.length || 0} 个`);
      await refresh();
    } catch { showMessage('自动分配失败'); }
    saving = '';
  }

  async function deleteModel(id: string, name: string) {
    confirm('确认删除', `确定删除模型「${name}」？`, async () => {
      if (!client) return;
      try {
        await client.request('DELETE', `/models/${id}`);
        showMessage('已删除');
        await refresh();
      } catch { showMessage('删除失败'); }
    });
  }

  function modelName(id?: string): string {
    if (!id) return '未设置';
    return models.find((m) => m.id === id)?.name || id;
  }

  function provLabel(id: string): string {
    const map: Record<string, string> = {
      'openai_compatible': 'OpenAI 兼容', 'deepseek': 'DeepSeek', 'ollama': 'Ollama',
      'openai': 'OpenAI', 'anthropic': 'Anthropic', 'google': 'Google', 'mistral': 'Mistral',
      'groq': 'Groq', 'xai': 'xAI', 'openrouter': 'OpenRouter', 'azure': 'Azure',
    };
    return map[id] || id;
  }
</script>

<div class="mp">
  {#if !client}
    <div class="mp-empty">未配置 Open Notebook 端点</div>
  {:else if loading}
    <div class="mp-empty">加载中...</div>
  {:else}
    <!-- 角色分配总览（7 个角色，每个可下拉选择） -->
    <section>
      <div class="mp-section-header">
        <h3>模型角色分配</h3>
        <button class="b3-button b3-button--small b3-button--outline mp-icon-button" on:click={autoAssign} disabled={saving === 'auto'}>
          <svg><use xlink:href="#iconRefresh"></use></svg>
          <span>{saving === 'auto' ? '分配中...' : '自动分配'}</span>
        </button>
      </div>
      <p class="mp-hint">为每个功能角色选择模型。未设置的角色会回退到对话模型。</p>

      <div class="mp-roles">
        {#each MODEL_ROLES as role}
          <div class="mp-role-row">
            <div class="mp-role-info">
              <span class="mp-role-label">{role.label}</span>
              <span class="mp-role-hint">{role.hint}</span>
            </div>
            <div class="mp-role-actions">
              <select
                class="b3-select mp-role-select"
                value={defaults[role.key] || ''}
                on:change={(e) => e.target.value ? setRole(role.key, e.target.value) : clearRole(role.key)}
                disabled={saving === role.key}
              >
                <option value="">未设置</option>
                {#each models.filter((m) => m.type === role.type) as m}
                  <option value={m.id}>{m.name}</option>
                {/each}
              </select>
            </div>
          </div>
        {/each}
      </div>
    </section>

    <!-- 按类型分组的模型列表 -->
    {#each modelsByType as group}
      {#if group.items.length > 0}
        <section>
          <h3>{group.label} <span class="mp-count">({group.items.length})</span></h3>
          {#each group.items as m (m.id)}
            <div class="mp-card">
              <div class="mp-info">
                <span class="mp-name">{m.name}</span>
                <span class="mp-prov">{provLabel(m.provider)}</span>
              </div>
              <button class="b3-button b3-button--small mp-del" on:click={() => deleteModel(m.id, m.name)}>删除</button>
            </div>
          {/each}
        </section>
      {/if}
    {/each}
  {/if}
</div>

<style lang="scss">
  .mp { padding: 24px; height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
  .mp-empty { display: flex; align-items: center; justify-content: center; height: 100%; opacity: 0.4; }

  section { display: flex; flex-direction: column; gap: 8px; }
  section h3 { font-size: var(--aio-fs-base); margin: 0; color: var(--b3-theme-primary);
    border-bottom: 1px solid var(--b3-theme-surface-lighter); padding-bottom: 4px; }
  .mp-count { font-size: var(--aio-fs-sm); opacity: 0.5; font-weight: 400; }
  .mp-section-header { display: flex; align-items: center; justify-content: space-between; }
  .mp-icon-button { display: inline-flex; align-items: center; gap: 6px; }
  .mp-icon-button svg { width: 14px; height: 14px; }
  .mp-hint { font-size: var(--aio-fs-xs); opacity: 0.5; margin: 0; }

  /* 角色分配行 */
  .mp-roles { display: flex; flex-direction: column; gap: 6px; }
  .mp-role-row { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 8px 12px; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 6px; }
  .mp-role-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .mp-role-label { font-size: var(--aio-fs-base); font-weight: 500; }
  .mp-role-hint { font-size: var(--aio-fs-xs); opacity: 0.5; }
  .mp-role-actions { flex-shrink: 0; }
  .mp-role-select { width: 200px; }

  /* 模型卡片 */
  .mp-card { display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 6px; }
  .mp-info { display: flex; flex-direction: column; gap: 2px; }
  .mp-name { font-size: var(--aio-fs-base); font-weight: 500; }
  .mp-prov { font-size: var(--aio-fs-xs); opacity: 0.5; }
  .mp-del { color: var(--b3-card-error-color); opacity: 0.5; &:hover { opacity: 1; } }
</style>
