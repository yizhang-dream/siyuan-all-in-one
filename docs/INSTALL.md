# 快速部署指南

本文档面向不同系统和不同 SiYuan 工作空间路径的用户。

## 1. 普通用户安装

1. 下载 release 包：`siyuan-all-in-one-v1.0.0.zip`。
2. 在 SiYuan 中进入 `设置 -> 集市/社区 -> 插件`。
3. 选择导入插件 zip。
4. 启用插件并重载 SiYuan。

## 2. 模型配置

插件使用 Provider Adapter 层统一不同模型服务。设置页可以分别选择“闪卡模型”和“导图模型”，也可以添加自定义 provider。

常见配置项：

- provider base URL
- model name
- API key
- flashcard provider/model
- mindmap provider/model
- review scheduler：默认使用 SM-2 兼容旧卡片；在 `设置 -> 复习设置` 中可以切换到 FSRS（实验），新复习记录会保留 `fsrs` 状态，同时继续同步旧的 `due/interval/status` 字段。

内置 provider 分两类：

| Provider | 协议 | base URL 示例 | 说明 |
| --- | --- | --- | --- |
| DeepSeek | OpenAI-compatible | `https://api.deepseek.com` | 自动使用 `/v1/chat/completions`，并对 `deepseek-*` 模型禁用 thinking，降低非标准响应概率。 |
| OpenAI / Moonshot / SiliconFlow / MiniMax | OpenAI-compatible | `https://api.openai.com` | 自动拼接 `/v1/chat/completions`。 |
| 智谱 GLM | OpenAI-compatible 变体 | `https://open.bigmodel.cn/api/paas/v4` | 自动拼接 `/chat/completions`。 |
| 火山引擎 | OpenAI-compatible 变体 | `https://ark.cn-beijing.volces.com` | 自动拼接 `/api/v3/chat/completions`。 |
| Google Gemini | Gemini native | `https://generativelanguage.googleapis.com` | 使用 `generateContent` 请求体和 `x-goog-api-key`。 |
| Anthropic Claude | Anthropic native | `https://api.anthropic.com` | 使用 `/v1/messages`、`x-api-key` 和 `anthropic-version`。 |

本地或自建 OpenAI-compatible 服务（例如 Ollama、LM Studio、one-api、LiteLLM）建议添加自定义 provider：

```text
name: Local Ollama
base URL: http://localhost:11434
model: qwen2.5
api key: 留空
```

如果你的 base URL 已经包含完整聊天端点，例如 `https://host/v1/chat/completions`，插件会直接使用该端点。如果希望强制原样使用一个特殊 URL，可以在设置里把 base URL 末尾加 `#`，例如：

```text
https://example.com/custom/chat#
```

Diagnostics 面板会显示当前 provider 的结构化输出策略，例如 `JSON 原生`、`JSON mode + 回退` 或 `JSON 提示词`，用于排查不同 provider 的 JSON 稳定性问题。Diagnostics 和 `check:bundle` 不会导出真实 API key，只检查 `apiKeySet` 或 bundle 中是否误带 secret。

## 4. 开发者本地部署

```bash
npm install
npm run verify
npm run deploy:siyuan -- --apply
```

脚本会自动探测常见 SiYuan data 目录，例如：

- Windows: `~/SiYuan/data`
- macOS: `~/SiYuan/data` 或 `~/Documents/SiYuan/data`
- Linux: `~/SiYuan/data`、`~/Documents/SiYuan/data` 或 `~/.local/share/SiYuan/data`

如果你的 SiYuan 工作空间不在这些位置，显式指定：

```bash
npm run deploy:siyuan -- --apply --siyuan-data "/path/to/SiYuan/data"
```

或者使用环境变量：

```bash
SIYUAN_DATA_DIR=/path/to/SiYuan/data
SIYUAN_PLUGIN_DIR=/path/to/SiYuan/data/plugins/siyuan-all-in-one
SIYUAN_PLUGIN_DATA_DIR=/path/to/SiYuan/data/storage/petal/siyuan-all-in-one
SIYUAN_KERNEL_ENDPOINT=http://127.0.0.1:6806
```

Windows PowerShell 示例：

```powershell
$env:SIYUAN_DATA_DIR="D:\SiYuan\data"
npm run deploy:siyuan -- --apply
npm run check:full
```

macOS/Linux 示例：

```bash
SIYUAN_DATA_DIR="$HOME/SiYuan/data" npm run deploy:siyuan -- --apply
SIYUAN_DATA_DIR="$HOME/SiYuan/data" npm run check:full
```

## 5. 验证

部署后运行：

```bash
npm run check:full
```

如果 OpenNotebook 和模型都已配置，可运行真实链路检查：

```bash
npm run check:live
```

`check:live` 会调用真实 OpenNotebook 和 LLM，但使用内存 store 与内容哈希检查，设计上不修改真实插件数据。

## 6. 备份与恢复

`导入导出` 面板支持 Anki 导入，也支持恢复插件原生备份：

- `cards-json`：恢复卡片。
- `concepts-json`：恢复概念、关系和关联卡片。
- `mindmaps-markdown`：恢复导图 Markdown，并通过元数据注释恢复 `cardIds` 与 `linkedCardIds`。

建议公开发布或大重构前导出一次卡片、概念图和导图；恢复导入会按现有 id 合并，适合迁移工作空间或回滚误操作。

## 7. Release 打包

```bash
npm run build
npm run package:release
```

输出：

```text
release/siyuan-all-in-one-v1.0.0.zip
```

zip 内容：

- `index.js`
- `index.css`
- `plugin.json`
- `icon.png`
- `README.md`
- `README_zh_CN.md`
- `i18n/`
