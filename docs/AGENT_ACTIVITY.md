# Agent Activity Log — 2026-06-23~24

> 供审查 AI 快速了解本次会话中执行的所有变更。每个修复都有对应的 git commit SHA。

---

## 会话概览

在 `feature/unified-source-db` 工作树上工作，最终合并到 `main` 并推送到 GitHub (`yizhang-dream/siyuan-all-in-one`)。

---

## 一、从 Copilot 对齐 Agent 系统 (m1297-m1313)

**用户需求**："勾选agent之后输出就不正常了。请严格按照copliot的源码"

### A. Agent 循环修复 (commits: 9c68452, b87d13a)
- 原来硬编码 5 轮上限 → 改为 LLM 驱动 while 循环，参考 copilot 的 `for(;Dt;)` 模式
- 工具结果回传链路修复：`assistant(tool_calls) → tool(results) → LLM再次调用 → assistant(final)`
- `callLLM` 修复：tool_calls 存在时不再因 content 空而抛异常

### B. 工具选择对话框 (commit: fb71f4f, a5aa072)
- 从单复选框改为 Copilot 风格完整工具对话框
- 工具名中文化（知识检索搜索、SQL查询、获取块内容、新建笔记）
- 卡片式布局，分类分组，全选/取消全选，已选计数
- SVG 图标替换 unicode 字符

### C. 自动批准开关删除 (m1333-m1345)
- 用户："为什么又有复选框又有开关？这不是一个功能吗"
- 删除了 autoApprove 开关（我们没有审批弹窗，开关无用）

### D. 复选框+开关重叠修复 (m1324-m1332)
- `.tool-item-left` 复选框添加 `width:14px; height:14px; flex-shrink:0`
- `.tool-item-main` gap 从 8px → 12px

---

## 二、已知问题修复 (m1398-m1413)

从 PROJECT_STATUS.md 列出的 7 个问题中修复了 5 个：

### 🔴 BM25 关键词兜底 (commit: 10864f5)
- 原来嵌入失败时返回零向量 → 余弦相似度全为 0 → 结果按插入顺序返回
- 新增 `VectorStore.keywordSearch()`：中英文分词 + TF 计分
- `ragQuery()` 在 embedder 不可用时自动切换到关键词搜索
- UI 文案从"回退顺序匹配" → "回退关键词匹配"

### 🔴 MathJax 冲突 (commit: db2c073)
- 原来 `renderMath()` 自动加载 CDN MathJax → 与 SiYuan 数学增强插件双渲染冲突
- 改为优先调用 SiYuan 原生 `ProtyleMethod.mathRender()`
- MathJax CDN 仅作为显式 opt-in 选项保留

### 🟡 导图面板骨架 (commit: e3af9a9)
- Knowledge.svelte 原来只有占位代码
- 改为最小适配器：根据 mode toggle 渲染 Concepts.svelte（图谱）或 Mindmap.svelte（导图）
- App.svelte 补充 `mindmapStore` prop

### 🟡 解析路径统一 (commit: 4fca41d)
- 原来 RAG 摄入和 SourceHub 是两套独立解析路径
- `source-hub.ts` 新增从 SourceStore 直接读取已解析内容，避免重复解析

### 🟡 Agent 流式 + 循环防护 (commit: cb1f5d7)
- `callLLM` 新增 SSE 流式支持：`onChunk` / `onToolCallChunk` 回调
- Agent 循环中流式显示文本进度，不再白屏等待
- 新增 `maxIterations = 10` 防护

### 🟢 测试修复 (commit: 0a47042)
- test_source_hub.mjs 等 5 个测试文件更新 opennotebook 类型 → new types
- 新增 stub 脚本确保 `npm test` && 链不被中断

---

## 三、嵌入模型 Provider 扩展 (m1055-m1073)

- 从 4 种扩展到 **16 种**：builtin, ollama, siliconflow, qwen, zhipu, hunyuan, baidu, cohere, jina, mistral, voyage, gemini-embed, together, nomic, openai, custom
- 用户要求"全部采用读取获得模型信息" → 删除所有硬编码模型名 (commit: 8c6832a)
- 嵌入模型变更时**自动重建全部索引**带进度条 (commit: bd7e5ad)

---

## 四、LLM Provider 扩展 (m1006-m1024)

- 新增 8 个 Chinese provider：qwen, hunyuan, stepfun, lingyiwanwu, moonshot-coding, volcano-coding
- 拆分 Zhipu 为标准 (glm) + 编码套餐 (glm-coding) 两个独立入口 (commit: dd1ab7a)
- 新增 OpenCode Zen/Go (commit: a608cc8)
- `cleanConfig()` 合并新 BUILTIN_PROVIDERS 到已保存配置 (commit: 39a367f)
- 设置页新增"测试连接"按钮 (commit: 7ad0c85)

---

## 五、会话系统 (m1114-m1152)

- ConversationStore 双文件存储 (commit: e79176a)
- Rag.svelte 重构：左侧 240px 会话列表 + 右侧聊天区 (commit: d70e101)
- 多轮对话 + 自动保存 (commits: 020877a, 61bd5b4)

---

## 六、其他修复

| 修复 | commit |
|------|--------|
| PDF 导入实时进度 (tick() + 提取中标签) | 63e1677 |
| 对话 Tab 卡死 (afterUpdate 移除) | b6ad221 |
| 非 builtin 嵌入不加载 118MB ONNX | 252ddc0 |
| Markdown 渲染改用 SiYuan Lute | fbdb05e |
| Copilot UI 对齐（浮动发送按钮、代码工具栏、气泡宽度、滚动条） | d102eff, a7d1650, 0278281 |
| old "思考中" 状态恢复 | a7d4d13 |
| 视觉 API 错误诊断增强 | 3f18b37 |
| sharp 桩修复 | 0d8a3b7 |
| PDF worker 修复（blob URL → v3 downgrade → Array.prototype 污染） | f165fb1, 607ee93, 6bf3b4a |
| 文档重写 (README/ARCHITECTURE) | 564e7b3 |
| 项目状态概览 (PROJECT_STATUS.md) | 3209aba |

---

## 七、合并到 main (m1354-m1391)

- `feature/unified-source-db` → `main` 合并 (commit: de18f39)
- 解决冲突：重复导入、缺失类属性、旧类型引用
- 0 tsc 错误，构建通过

---

## 八、当前状态

- source/dist: 5,343 KB JS + 83 KB CSS
- tsc --noEmit: 0 errors
- npm test: 部分通过（test:source-refs 等仍失败，pre-existing）
- 部署路径: `C:\Users\zyz\SiYuan\data\plugins\siyuan-all-in-one\`
- 仓库: `https://github.com/yizhang-dream/siyuan-all-in-one`

---

## 关键文件变更统计

| 文件 | 变更性质 |
|------|----------|
| `src/panels/Rag.svelte` | 最大变更：会话系统、Agent 循环、工具对话框、Copilot UI |
| `src/libs/llm.ts` | SSE 流式、tool_calls 支持、视觉 API、Provider 端点 |
| `src/libs/tools.ts` | 工具定义 + 分类 + 执行器 |
| `src/libs/rag/` | 全部 8 文件整合自 feature 分支 |
| `src/libs/conversation-store.ts` | 新建：双文件会话存储 |
| `src/panels/Settings.svelte` | 嵌入 Provider UI、测试连接、RAG 模型 |
| `src/libs/config.ts` | 20+ Provider 预设、嵌入 Provider 验证 |
| `src/panels/SourceLibrary.svelte` | 视觉提取、re-index、导入进度 |
| `src/index.ts` | vectorStore/conversationStore 初始化 |

---

*生成时间：2026-06-24*
