import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.svelte', 'utf8');
const sourceLibrary = readFileSync('src/panels/SourceLibrary.svelte', 'utf8');
const rag = readFileSync('src/panels/Rag.svelte', 'utf8');
const generate = readFileSync('src/panels/Generate.svelte', 'utf8');
const knowledge = readFileSync('src/panels/Knowledge.svelte', 'utf8');
const concepts = readFileSync('src/panels/Concepts.svelte', 'utf8');
const mindmap = readFileSync('src/panels/Mindmap.svelte', 'utf8');
const review = readFileSync('src/panels/Review.svelte', 'utf8');
const browse = readFileSync('src/panels/Browse.svelte', 'utf8');
const importPanel = readFileSync('src/panels/Import.svelte', 'utf8');
const settings = readFileSync('src/panels/Settings.svelte', 'utf8');
const indexTs = readFileSync('src/index.ts', 'utf8');
const sourceStoreTs = readFileSync('src/libs/source-store.ts', 'utf8');
const conversationStoreTs = readFileSync('src/libs/conversation-store.ts', 'utf8');
const sourceHubTs = readFileSync('src/libs/sources/source-hub.ts', 'utf8');
const sourceRefsTs = readFileSync('src/libs/source-refs.ts', 'utf8');
const conceptTs = readFileSync('src/libs/types/concept.ts', 'utf8');
const typesTs = readFileSync('src/libs/types.ts', 'utf8');
const srsTs = readFileSync('src/libs/srs.ts', 'utf8');

// ── v2.0 top-level shell contracts ──────────────────────

for (const panel of ['SourceLibrary', 'Rag', 'Generate', 'Knowledge', 'SettingsPanel']) {
  assert.match(app, new RegExp(`import ${panel}`), `App should import ${panel}`);
}
for (const tab of ['sources', 'rag', 'make', 'knowledge', 'settings']) {
  assert.match(app, new RegExp(`id: '${tab}'`), `App should expose the ${tab} primary tab`);
}
for (const subTab of ['generate', 'review', 'browse', 'import']) {
  assert.match(app, new RegExp(`id: '${subTab}'`), `Make tab should expose ${subTab} sub-tab`);
}
assert.match(app, /selectedSourceIds: \[\] as string\[\]/, 'App should own cross-tab selected source ids');
assert.match(app, /onSwitchTab: \(tab: string\) => \{ activeTab = tab; \}/, 'App should provide cross-tab navigation');
assert.match(app, /function openConceptsPanel\(\)/, 'App should expose quick-card to knowledge handoff');
assert.match(app, /<Generate[^>]+\{appStore\}[^>]+\{openConceptsPanel\}/, 'Generate should receive source selection and graph handoff props');
assert.match(app, /<Rag[^>]+bind:appStore/, 'RAG should consume cross-tab source selections');
assert.match(app, /<SourceLibrary[^>]+bind:appStore/, 'Source library should publish selected source ids');
assert.match(app, /<Knowledge[^>]+\{mindmapStore\}[^>]+bind:appStore/, 'Knowledge should receive stores and source selection');
assert.doesNotMatch(app, /Stats|SourcePicker|Notebook|Diagnostics|Models/, 'App should not import removed panels');

// ── Cross-panel wiring: host-layer handoff signals ──────

assert.match(app, /let reviewQueue:/, 'App should hold a temporary filtered review queue');
assert.match(app, /function startFilteredReview\(ids: string\[\]/, 'App should expose filtered review handoff');
assert.match(app, /<Review[^>]+queue=\{reviewQueue\}/, 'App should pass reviewQueue to Review panel');
assert.match(app, /function jumpToMindmap\(/, 'App should expose mindmap jump handoff');
assert.match(app, /let mindmapJumpTarget:/, 'App should hold mindmap jump target state');
assert.match(app, /function openConceptsFromMindmapGaps\(/, 'App should expose gap-to-concepts handoff');
assert.match(app, /let mindmapGapTarget:/, 'App should hold mindmap gap target state');
assert.match(app, /function openConceptsFromRag\(/, 'App should expose rag-to-concepts handoff');
assert.match(app, /let ragConceptTarget:/, 'App should hold rag concept target state');
assert.match(app, /<Browse[^>]+\{mindmapStore\}/, 'App should pass mindmapStore to Browse panel');
assert.match(app, /<Browse[^>]+\{jumpToMindmap\}/, 'App should pass jumpToMindmap to Browse panel');
assert.match(app, /<Browse[^>]+\{startFilteredReview\}/, 'App should pass startFilteredReview to Browse panel');
assert.match(app, /<Rag[^>]+openConceptsFromRag/, 'App should pass openConceptsFromRag to Rag panel');
assert.match(app, /<Knowledge[^>]+\{jumpToMindmap\}/, 'App should pass jumpToMindmap to Knowledge panel');
assert.match(app, /<Knowledge[^>]+\{startFilteredReview\}/, 'App should pass startFilteredReview to Knowledge panel');
assert.match(app, /<Knowledge[^>]+\{openConceptsFromMindmapGaps\}/, 'App should pass openConceptsFromMindmapGaps to Knowledge panel');
assert.match(app, /<Knowledge[^>]+\{mindmapJumpTarget\}/, 'App should pass mindmapJumpTarget to Knowledge panel');
assert.match(app, /<Knowledge[^>]+\{mindmapGapTarget\}/, 'App should pass mindmapGapTarget to Knowledge panel');
assert.match(app, /<Knowledge[^>]+\{ragConceptTarget\}/, 'App should pass ragConceptTarget to Knowledge panel');

// ── Knowledge panel: mode switching & pass-through wiring ──

assert.match(knowledge, /export let jumpToMindmap/, 'Knowledge should receive jumpToMindmap');
assert.match(knowledge, /export let startFilteredReview/, 'Knowledge should receive startFilteredReview');
assert.match(knowledge, /export let openConceptsFromMindmapGaps/, 'Knowledge should receive openConceptsFromMindmapGaps');
assert.match(knowledge, /export let mindmapJumpTarget/, 'Knowledge should receive mindmapJumpTarget');
assert.match(knowledge, /export let mindmapGapTarget/, 'Knowledge should receive mindmapGapTarget');
assert.match(knowledge, /export let ragConceptTarget/, 'Knowledge should receive ragConceptTarget');
assert.match(knowledge, /\$: if \(mindmapJumpTarget\?\.mindmapId\)/, 'Knowledge should switch to mindmap mode on jump signal');
assert.match(knowledge, /\$: if \(mindmapGapTarget\)/, 'Knowledge should switch to graph mode on gap signal');
assert.match(knowledge, /\$: if \(ragConceptTarget\)/, 'Knowledge should switch to graph mode on RAG signal');
assert.match(knowledge, /<Mindmap[^>]+jumpTarget/, 'Knowledge should pass jumpTarget to Mindmap');
assert.match(knowledge, /<Mindmap[^>]+\{startFilteredReview\}/, 'Knowledge should pass startFilteredReview to Mindmap');
assert.match(knowledge, /<Mindmap[^>]+\{openConceptsFromMindmapGaps\}/, 'Knowledge should pass openConceptsFromMindmapGaps to Mindmap');
assert.match(knowledge, /<Concepts[^>]+\{jumpToMindmap\}/, 'Knowledge should pass jumpToMindmap to Concepts');
assert.match(knowledge, /<Concepts[^>]+mindmapGapTarget/, 'Knowledge should pass mindmapGapTarget to Concepts');
assert.match(knowledge, /<Concepts[^>]+ragConceptTarget/, 'Knowledge should pass ragConceptTarget to Concepts');

// ── Plugin lifecycle and stores ──

assert.match(indexTs, /new SourceStore\(this\)/, 'Plugin should initialize SourceStore');
assert.match(indexTs, /new ConversationStore\(this\)/, 'Plugin should initialize ConversationStore');
assert.match(indexTs, /sourceStore: plugin\.sourceStore/, 'App should receive SourceStore');
assert.match(indexTs, /migrateRef/, 'Plugin should keep legacy SourceRef migration for old data');
assert.match(sourceStoreTs, /loadData\('sources'\)/, 'SourceStore should persist sources with saveData/loadData');
assert.match(sourceStoreTs, /SourceRecordType = 'file' \| 'url' \| 'paste' \| 'pdf' \| 'siyuan-doc'/, 'SourceStore should use the current source type set');
assert.match(conversationStoreTs, /chat-sessions\.json/, 'ConversationStore should keep a lightweight session index');
assert.match(conversationStoreTs, /sessions\//, 'ConversationStore should store full histories under sessions/');

// ── Source library and unified ingestion ──

assert.match(sourceLibrary, /ParserRegistry/, 'SourceLibrary should route imports through parser registry');
assert.match(sourceLibrary, /TxtMdHtmlParser/, 'SourceLibrary should support text and markdown/html files');
assert.match(sourceLibrary, /PdfParser/, 'SourceLibrary should support PDF parsing');
assert.match(sourceLibrary, /PandocParser/, 'SourceLibrary should support document formats through Pandoc');
assert.match(sourceLibrary, /ImageOcrParser/, 'SourceLibrary should support vision/OCR extraction');
assert.match(sourceLibrary, /SiyuanDocParser/, 'SourceLibrary should support SiYuan document imports');
assert.match(sourceLibrary, /ingestDocument/, 'SourceLibrary should index parsed sources into vectors');
assert.match(sourceLibrary, /getRagEmbedderProvider/, 'SourceLibrary should use configured embedding providers');
assert.match(sourceLibrary, /autoReindexAll/, 'SourceLibrary should reindex when embedding config changes');
assert.match(sourceLibrary, /appStore\.selectedSourceIds/, 'SourceLibrary should publish selected sources to other tabs');
assert.match(sourceLibrary, /function useFor\(panel: 'rag' \| 'make' \| 'knowledge'\)/, 'SourceLibrary should route selected sources to current top-level tabs');
assert.match(sourceLibrary, /useFor\('rag'\)/, 'SourceLibrary should hand selected sources to RAG');
assert.match(sourceLibrary, /useFor\('make'\)/, 'SourceLibrary should hand selected sources to quick card generation');
assert.match(sourceLibrary, /useFor\('knowledge'\)/, 'SourceLibrary should hand selected sources to graph or mindmap workflows');
assert.match(sourceLibrary, /appStore\.onSwitchTab\) appStore\.onSwitchTab\(panel\)/, 'SourceLibrary should switch to the requested tab after selecting sources');

// ── RAG, conversation, and agent contracts ──

assert.match(rag, /ConversationStore/, 'RAG should persist conversations');
assert.match(rag, /getAllTools|getEnabledTools|executeTool/, 'RAG should load and execute agent tools');
assert.match(rag, /maxIterations = 10/, 'Agent loop should have an iteration guard');
assert.match(rag, /onChunk: \(delta: string\)/, 'RAG should stream assistant text');
assert.match(rag, /tool_calls/, 'RAG should display and persist tool calls');
assert.match(rag, /appStore\.selectedSourceIds/, 'RAG should consume selected source ids from SourceLibrary');
assert.match(rag, /const sourceIds = activeSession\?\.sourceIds \|\| \[\]/, 'RAG should read selected sources from the active session');
assert.match(rag, /await ragQuery\(text, store, embedder, \{/, 'RAG should query the vector store');
assert.match(rag, /sourceIds: sourceIds\.length > 0 \? sourceIds : undefined/, 'RAG should constrain retrieval to selected sources');
assert.match(rag, /appStore\?\.onSwitchTab\?\.\('sources'\)/, 'RAG should provide a route back to the source library');

// ── Generation and concept graph workflow ──

assert.match(generate, /openConceptsPanel/, 'Generate should link quick cards to the source-to-graph workflow');
assert.match(generate, /appStore\?\.selectedSourceIds/, 'Generate should use selected source context');
assert.match(generate, /sourceStore\.getById/, 'Generate should read selected sources from SourceStore');
assert.match(generate, /来源制卡与图谱/, 'Generate should clearly separate quick cards from graph-linked generation');
assert.match(knowledge, /<Concepts[^>]+\{sourceStore\}[^>]+\{appStore\}/, 'Knowledge graph mode should pass source store and selection to Concepts');
assert.match(concepts, /collectPipelineSources/, 'Concepts should collect sources through SourceHub');
assert.match(concepts, /selectedSourceIds: appStore\?\.selectedSourceIds/, 'Concepts should use selected SourceStore records');
assert.match(concepts, /confirmPipelineResult/, 'Concepts should confirm candidates into stores');
assert.match(concepts, /syncConceptMindmap/, 'Concept confirmation should sync a concept mindmap');
assert.match(concepts, /bind:value=\{concept\.title\}/, 'Concept candidates should be editable');
assert.match(concepts, /bind:value=\{card\.front\}/, 'Card candidates should be editable');
assert.match(sourceHubTs, /sourceStore\?: SourceStore/, 'SourceHub should accept SourceStore');
assert.match(sourceHubTs, /selectedSourceIds\?: string\[\]/, 'SourceHub should accept selected source ids');
assert.match(sourceHubTs, /type: 'source'/, 'SourceHub should emit unified source refs');

// ── Mindmap panel contracts (restored) ──

assert.match(mindmap, /mode: 'cards' \| 'doc' \| 'concepts'/, 'Mindmap should keep cards/doc/concepts modes');
assert.match(mindmap, /generateCardsFromCurrentMindmap/, 'Mindmap should generate flashcards from the current map');
assert.match(mindmap, /filterMindmapMarkdown/, 'Mindmap should support large-map filtering');
assert.match(mindmap, /loadConceptMindmap/, 'Mindmap should generate from concept graph');
assert.match(mindmap, /linkedCardIds/, 'Mindmap-generated cards should be linked back to the map');
assert.match(mindmap, /卡片 → 导图/, 'Mindmap should label the cards-to-map path explicitly');
assert.match(mindmap, /来源 → 导图/, 'Mindmap should label the source-to-map path explicitly');
assert.match(mindmap, /图谱 → 导图/, 'Mindmap should label the graph-to-map path explicitly');
assert.match(mindmap, /导图 → 卡片/, 'Mindmap should label the map-to-cards path explicitly');
assert.match(mindmap, /renderMath\(reviewDialogEl\)/, 'Mindmap review overlay should render math formulas');
assert.match(mindmap, /import \{ createCard, scheduleCard \} from '..\/libs\/srs';/, 'Mindmap should use the scheduler facade');
assert.match(mindmap, /scheduleCard\(grade, \{ \.\.\.reviewCard \}, cfg\.scheduler \|\| 'sm2'\)/, 'Mindmap grading should honor the configured scheduler');
assert.match(mindmap, /getMindmapSourceMeta/, 'Mindmap saved-list entries should expose source type labels');
assert.match(mindmap, /mindmap-icon-button/, 'Mindmap toolbar actions should use SiYuan-style icon buttons');
assert.match(mindmap, /#iconFiles/, 'Mindmap document rows should use SiYuan file icon');
assert.match(mindmap, /fitMarkmapWithProfile/, 'Mindmap should fit large maps using profile-aware tuning');
assert.match(mindmap, /sizeProfile: currentProfile/, 'Mindmap renderer should receive the size profile');
assert.match(mindmap, /mindmap-canvas--large/, 'Mindmap canvas should expose a large-map class');
assert.match(mindmap, /searchMindmapNodes/, 'Mindmap should search nodes through the markmap data tree');
assert.match(mindmap, /focusMindmapSearchMatch/, 'Mindmap search should focus matches through markmap APIs');
assert.match(mindmap, /mindmap-searchbar/, 'Mindmap should expose a compact node search bar');
assert.match(mindmap, /查找节点、路径或卡片 ID/, 'Mindmap search should support node, path and card id queries');
assert.match(mindmap, /mindmapViewMode/, 'Mindmap should keep a view mode for large-map filtering');
assert.match(mindmap, /全部[\s\S]*有卡[\s\S]*缺卡[\s\S]*邻域/, 'Mindmap should expose all/card/gap/neighborhood views');
assert.match(mindmap, /显示 \{currentViewStats\.visibleNodes\} \/ \{currentViewStats\.totalNodes\} 个节点/, 'Mindmap filtered views should show visible node counts');
assert.match(mindmap, /generateCardsFromGaps/, 'Mindmap should generate candidate cards from gap leaf nodes');
assert.match(mindmap, /gapNodesToSourceText/, 'Mindmap should convert gap nodes to pipeline source text');
assert.match(mindmap, /从缺卡生成候选/, 'Mindmap gap view should expose a generate-cards-from-gaps button');
assert.match(mindmap, /openConceptsFromMindmapGaps/, 'Mindmap should receive the gap-to-concepts handoff callback');
assert.match(mindmap, /export let jumpTarget/, 'Mindmap should accept external jump targets');
assert.match(mindmap, /export let startFilteredReview/, 'Mindmap should accept filtered review handoff');
assert.match(mindmap, /export let openConceptsFromMindmapGaps/, 'Mindmap should accept gap-to-concepts handoff callback');

// ── Browse & Review contracts (restored) ──

assert.match(review, /scheduleCard\(g, card, cfg\.scheduler \|\| 'sm2'\)/, 'Review grading should honor configured scheduler');
assert.match(review, /review-card-hint--front/, 'Review should keep hint visible on the question side');
assert.match(browse, /reviewFilteredCards/, 'Browse should start filtered review');
assert.match(browse, /openConceptMindmapForCard/, 'Browse should let a card open or create its concept mindmap');
assert.match(browse, /getLinkedMindmaps/, 'Browse should list mindmaps linked to a card');
assert.match(browse, /syncConceptMindmap/, 'Browse card details should be able to sync a concept mindmap');
assert.match(browse, /browse-linked-map-button/, 'Browse should render linked mindmap buttons');
assert.match(browse, /复习筛选/, 'Browse should expose a filtered review action');
assert.match(browse, /复习选中/, 'Browse should expose a selected-card review action');
assert.match(browse, /browse-review-button[\s\S]*#iconRefresh/, 'Browse filtered review should use a SiYuan refresh icon');

// ── Concepts panel contracts (restored) ──

assert.match(concepts, /applyMindmapGapTarget\(mindmapGapTarget\)/, 'Concepts should react to mindmap gap targets');
assert.match(concepts, /applyRagTarget\(ragConceptTarget\)/, 'Concepts should react to RAG targets');
assert.match(concepts, /cdfMode/, 'Concepts should support CDF descriptor-based card generation');
assert.match(concepts, /CDF 维度制卡/, 'Concepts CDF toggle should have a visible label');
assert.match(concepts, /export let ragConceptTarget/, 'Concepts should accept ragConceptTarget prop');

// ── Import/export and settings contracts ──

assert.match(importPanel, /buildExportPayload/, 'Import panel should use shared export builder');
assert.match(importPanel, /syncCardsToSiyuanRiff/, 'Import panel should sync to SiYuan native flashcards');
assert.match(settings, /ragEmbeddingProvider/, 'Settings should expose embedding provider selection');
assert.match(settings, /getProviderCapabilities/, 'Settings should show structured output capabilities');

// ── SourceRef and SRS type-level contracts ──

assert.match(conceptTs, /type: 'siyuan-doc' \| 'manual' \| 'source'/, 'SourceRef should use the simplified type set');
assert.match(sourceRefsTs, /'siyuan-doc': '思源文档'/, 'SourceRef labels should include SiYuan docs');
assert.match(sourceRefsTs, /source: '来源库'/, 'SourceRef labels should include SourceStore records');
assert.match(typesTs, /drill/, 'CardStatus should include drill status');
assert.match(srsTs, /consecutiveLapses/, 'SRS should track consecutive lapses for drill entry');
assert.match(srsTs, /status = 'drill'/, 'SRS should enter drill after repeated failures');

// ── General code quality checks ──

assert.doesNotMatch(mindmap, /📋|🎴|📄|📝|🔄|💡|❌|✅|⚠️/, 'Mindmap panel should avoid emoji controls and status text');

const responsivePanels = [sourceLibrary, rag, generate, concepts, mindmap, importPanel, settings]
  .filter((panelText) => /@media/.test(panelText));
assert.ok(responsivePanels.length >= 4, `At least 4 panels should have responsive breakpoints; found ${responsivePanels.length}`);

const panelsWithMinWidthZero = [sourceLibrary, rag, generate, concepts, mindmap, browse, importPanel, settings]
  .filter((panelText) => /min-width:\s*0/.test(panelText));
assert.ok(panelsWithMinWidthZero.length >= 5, `${panelsWithMinWidthZero.length} panels should use min-width: 0 to prevent overflow`);

console.log(JSON.stringify({
  appTabs: 5,
  makeSubTabs: 4,
  wiringContracts: 24,
  knowledgeContracts: 15,
  mindmapContracts: 29,
  browseContracts: 10,
  conceptContracts: 14,
  sourceLibraryContracts: 10,
  ragAgentContracts: 8,
}, null, 2));
