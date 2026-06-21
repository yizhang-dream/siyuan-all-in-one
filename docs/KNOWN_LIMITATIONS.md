# 已知局限

本文记录当前版本中无法在本项目内消除的限制，避免被误判为未修复的 bug。

## Sass Legacy JS API Deprecation Warning (14 条)

**现象：** 构建输出中出现 14 条 `DEPRECATION WARNING [legacy-js-api]`。

**根因：** `@sveltejs/vite-plugin-svelte` v5.4.21 内部调用 `sass` 包时使用 legacy JS API。Dart Sass 2.0 将移除该 API，当前为预警告。

**已尝试的修复：**
- `svelte-preprocess` + `api: 'modern-compiler'` → 构建输出从 2.4MB 暴跌至 69KB，所有 Svelte 组件未被 Vite 正确转换。已回退。
- 结论：当前 `@sveltejs/vite-plugin-svelte` 版本与 `svelte-preprocess` 的现代 Sass API 不兼容。

**预期修复时间：** 等待 `@sveltejs/vite-plugin-svelte` 上游更新内置 `svelte-preprocess` 到支持现代 API 的版本，或切换到 `sass-embedded` 包。

**影响：** 无。14 条警告不阻断构建，不影响运行时行为。Dart Sass 2.0 尚未发布。

## GitHub 网络可达性

本机 `github.com:443` 偶尔不可达。代码提交和部署不受影响，推送（`git push`）可能需等待网络恢复后重试。

## 图片遮挡编辑器

Canvas 编辑器支持点击添加遮挡、拖拽四角调整大小、Delete/Backspace 删除。已知局限：
- 拖拽调整大小时缺少实时鼠标光标变化（仍为 crosshair）
- 不支持批量选择/移动/复制遮挡区域
- 复习时键盘快捷键未绑定（需点击）