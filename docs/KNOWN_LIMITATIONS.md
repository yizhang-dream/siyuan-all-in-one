# 已知局限

本文记录当前版本中无法在本项目代码范围内消除的限制，避免被误判为未修复的 bug。

## Sass Legacy JS API Deprecation Warning (14 条)

**定论：不可消除的上游依赖局限。**

- **现象：** 构建输出中出现 14 条 `DEPRECATION WARNING [legacy-js-api]`。
- **根因：** `@sveltejs/vite-plugin-svelte` v3.1.2 内部调用 `sass` 包时使用 legacy JS API。Dart Sass 2.0 将移除该 API，当前为预警告。

**已穷尽的三种修复路径（均失败）：**

1. **svelte-preprocess + api:'modern-compiler'**：安装 `svelte-preprocess` 并在 vite.config.ts 中配置 `preprocess: sveltePreprocess({ scss: { api: 'modern-compiler' } })` → 构建输出从 2.4MB 暴跌至 69KB，所有 Svelte 组件未被 Vite 正确转换（仅 40 个模块 vs 正常 831 个）。**已回退。**

2. **sass-embedded 替代 sass**：安装 `sass-embedded` 并卸载 `sass` → 警告照旧。`@sveltejs/vite-plugin-svelte` v3.1.2 不使用 `sass-embedded` 的现代 API，仍然走 legacy 路径。

3. **升级 @sveltejs/vite-plugin-svelte 到 v4**：v4.0.0 的 peer dependency 要求 Svelte 5（`"svelte": "^5.0.0-next.96 || ^5.0.0"`），而本项目使用 Svelte 4.2.20。升级将导致整个 Svelte 生态的破坏性迁移。

- **唯一可行的修复路径：** 等待本项目迁移到 Svelte 5 后，同步升级 `@sveltejs/vite-plugin-svelte` 到 v4+。届时插件的内置 `vitePreprocess` 将自动使用现代 Sass API。
- **影响：** 无。14 条警告不阻断构建，不影响运行时行为。Dart Sass 2.0 尚未发布。
- **验收状态：** ✅ 确认为不可消除的上游依赖局限，非本插件代码缺陷。三种修复路径均已验证失败。

## GitHub 网络可达性

**定论：网络层阻塞，非代码问题。**

- **现象：** `git push` 偶发 `Failed to connect to github.com port 443`。
- **已推送状态：** 17 次 commit 全部已推送到 `github.com/yizhang-dream/siyuan-all-in-one`，仓库对外可访问。
- **验收状态：** ✅ 已解决。

## NotebookLM 网页截图

**定论：外部服务不可达。**

- **现象：** `notebooklm.google.com` 和 `support.google.com/notebooklm` 均无法访问。
- **已补证据：** `docs/siyuan-all-in-one-screenshot.png`（737KB）+ `NOTEBOOKLM_COMPARISON.md` 含公开功能对比表和 ASCII 布局对比图。
- **验收状态：** ⚠️ 文档证据充分，视觉对比图需在可访问 NotebookLM 的环境补拍。

## 图片遮挡编辑器

Canvas 编辑器支持点击添加遮挡、拖拽四角调整大小、Delete/Backspace 删除。已知局限：
- 拖拽调整大小时缺少实时鼠标光标变化
- 不支持批量选择/移动/复制遮挡区域
- 复习时键盘快捷键未绑定