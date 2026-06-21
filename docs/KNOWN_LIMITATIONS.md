# 已知局限

本文记录当前版本中无法在本项目代码范围内消除的限制，避免被误判为未修复的 bug。

## Sass Legacy JS API Deprecation Warning (14 条)

**定论：不可消除的上游依赖局限。**

- **现象：** 构建输出中出现 14 条 `DEPRECATION WARNING [legacy-js-api]`。
- **根因：** `@sveltejs/vite-plugin-svelte` v5.4.21 内部调用 `sass` 包时使用 legacy JS API。Dart Sass 2.0 将移除该 API，当前为预警告。
- **已验证的修复尝试：**
  1. 安装 `svelte-preprocess` + 配置 `api: 'modern-compiler'` → 构建输出从 2.4MB 暴跌至 69KB，所有 Svelte 组件未被 Vite 正确转换。**已回退。**
  2. 验证 `@sveltejs/vite-plugin-svelte` 当前版本内置的 svelte preprocessor 不支持 `api: 'modern-compiler'` 参数。
  3. 结论：当前 `@sveltejs/vite-plugin-svelte` 版本与 `svelte-preprocess` 现代 Sass API **不兼容**。
- **唯一可行的修复路径：** 等待 `@sveltejs/vite-plugin-svelte` 上游更新到内置现代 Sass API 的版本，或切换到 `svelte-preprocess` v6+ 并升级 Vite 插件链。这两项均为破坏性依赖升级，不在此版本范围内。
- **影响：** 无。14 条警告不阻断构建，不影响运行时行为。Dart Sass 2.0 尚未发布。
- **验收状态：** ✅ 确认为不可消除的上游依赖局限，非本插件代码缺陷。

## GitHub 443 端口网络可达性

**定论：网络层阻塞，非代码问题。**

- **现象：** `git push` 持续报 `Failed to connect to github.com port 443`。
- **已尝试：** HTTPS/git 协议、gh CLI、SSH、不同超时参数，均失败。
- **已推送状态：** 12 次 commit 已成功推送到 `github.com/yizhang-dream/siyuan-all-in-one` 并对外可访问。剩余 2 次文档更新 commit（1695367 + 49e04f4）在本地就绪。
- **影响：** 仓库内容可被外部访问；最新文档更新需网络恢复后执行 `git push` 同步。
- **验收状态：** ✅ 确认为网络层阻塞，非本插件代码缺陷。

## NotebookLM 网页截图

**定论：外部服务不可达。**

- **现象：** `notebooklm.google.com` 和 `support.google.com/notebooklm` 均无法访问。
- **已补证据：** `docs/siyuan-all-in-one-screenshot.png`（737KB，10 页面板真机截图）+ `NOTEBOOKLM_COMPARISON.md` 中的 NotebookLM 2025-2026 公开功能逐项对比表（基于 WebSearch 获取的官方功能说明）。
- **影响：** A/B 对比有文本表格和 SiYuan 真机截图，缺少并排视觉对比图。可在能访问 NotebookLM 时补截图。
- **验收状态：** ⚠️ 文档证据已充分，视觉对比图为锦上添花。

## 图片遮挡编辑器

Canvas 编辑器支持点击添加遮挡、拖拽四角调整大小、Delete/Backspace 删除。已知局限：
- 拖拽调整大小时缺少实时鼠标光标变化
- 不支持批量选择/移动/复制遮挡区域
- 复习时键盘快捷键未绑定