# GitHub 仓库准备清单

本文档记录公开到 GitHub 前的仓库检查、发布流程和当前状态。

## 1. 不能提交的内容

不要提交：

- `node_modules/`
- `dist/`，除非选择 release 分发策略需要保留构建产物。
- `release/`
- `.deploy-backups/`
- `_temp_*`
- 本机真实数据目录。
- 任何 API key、token、cookie。

当前 `.gitignore` 已覆盖基础项，但上 GitHub 前仍要用脚本和人工复查。

可执行检查：

```bash
npm run check:repo
```

它会检查必需仓库文件、package/plugin 元数据、git ignore 规则和明显 API key 片段。

## 2. 建议提交的内容

- `src/`
- `scripts/`
- `public/i18n/`
- `docs/`
- `package.json`
- `package-lock.json`
- `plugin.json`
- `vite.config.ts`
- `tsconfig.json`
- `svelte.config.js`
- `README.md`
- `README_zh_CN.md`
- `LICENSE`
- `icon.png`
- `.gitignore`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `.github/`

## 3. README 与安装文档

已更新：

- `README.md`
- `README_zh_CN.md`
- `docs/INSTALL.md`
- `docs/TESTING.md`
- `docs/ARCHITECTURE.md`
- `docs/PROMPT_STRATEGY.md`

当前 README 已说明：

- 项目定位：SiYuan 插件，闪卡、概念图谱、思维导图、OpenNotebook。
- 核心范式：ConceptNode 作为闪卡和导图的共享中间层。
- 安装方式：release zip / 手动构建。
- 跨系统部署：自动探测 SiYuan data 目录，也支持 `--siyuan-data` 和环境变量覆盖。
- 配置方式：OpenAI-compatible LLM provider、OpenNotebook endpoint。
- Provider Adapter：DeepSeek/OpenAI-compatible/Gemini/Anthropic/火山/智谱/本地兼容服务。
- 三条路径：一次性生成、卡制图、图制卡。
- 导入导出：Anki 导入与 JSON/CSV/TSV/Markdown/概念图/导图导出。
- 隐私说明：API key 存在 SiYuan 插件 data storage，bundle 检查不会带出已配置 secret。

## 4. GitHub Actions

已添加：

```text
.github/workflows/ci.yml
.github/workflows/release.yml
```

CI 会执行：

- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run package:release`

Release workflow 在推送 `v*` tag 时执行：

- `npm ci`
- `npm run verify`
- `npm run package:release`
- 上传 `release/*.zip` 到 GitHub Release

不要在 CI 跑 `check:live`，它依赖本机 SiYuan、OpenNotebook 和真实模型配置。

参考配置：

最小 CI：

```yaml
name: ci
on:
  push:
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

## 5. Release 包

已添加：

```bash
npm run package:release
```

当前输出：

```text
release/siyuan-all-in-one-v1.0.0.zip
```

发布 zip 时包含：

- `index.js`
- `index.css`
- `plugin.json`
- `icon.png`
- `README.md`
- `README_zh_CN.md`
- `i18n/`

## 6. 发布前本机验收

```bash
npm run verify
npm run check:repo
npm run deploy:siyuan -- --apply
npm run check:full
npm run check:live
npm run check:data
```

自定义 SiYuan 工作空间时：

```bash
npm run deploy:siyuan -- --apply --siyuan-data "/path/to/SiYuan/data"
npm run check:full -- --siyuan-data "/path/to/SiYuan/data"
```

人工再检查：

- SiYuan 插件可打开。
- Diagnostics 报告可复制且不含 API key。
- Notebook 选中 source/note 后可生成候选。
- Concepts 候选确认后能同步概念导图。
- Browse 中卡片能打开关联概念导图。
- Mindmap 中当前导图能生成新卡片并保留 `linkedCardIds`。
- Import/Export 面板能导出卡片、概念图和导图。

## 7. 当前缺口

- UI 仍缺少浏览器截图级验收，当前主要靠脚本和插件内 Diagnostics。
- GitHub 远程仓库尚未创建；创建后需要确认 `package.json` 和 `plugin.json` 中的 URL 是否为最终仓库地址。
