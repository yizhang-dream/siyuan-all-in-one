import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.svelte', 'utf8');
const browse = readFileSync('src/panels/Browse.svelte', 'utf8');
const concepts = readFileSync('src/panels/Concepts.svelte', 'utf8');
const importPanel = readFileSync('src/panels/Import.svelte', 'utf8');
const notebook = readFileSync('src/panels/Notebook.svelte', 'utf8');
const mindmap = readFileSync('src/panels/Mindmap.svelte', 'utf8');
const diagnostics = readFileSync('src/panels/Diagnostics.svelte', 'utf8');

assert.match(app, /let conceptSourceTargetSeq = 0;/, 'Notebook to Concepts handoff should have an activation sequence');
assert.match(app, /conceptSourceTargetSeq \+= 1;/, 'Notebook to Concepts handoff should increment activation sequence');
assert.match(app, /key: `\$\{request\.key\}#\$\{conceptSourceTargetSeq\}`/, 'Repeated same-source handoffs should create a fresh target key');
assert.match(app, /<Notebook[^>]+sourceTarget=\{notebookTarget\}[^>]+openConceptsFromNotebook/, 'Notebook panel should receive source handoff callbacks');
assert.match(app, /<Concepts[^>]+notebookTarget=\{conceptSourceTarget\}/, 'Concepts panel should receive Notebook concept targets');
assert.match(app, /<Mindmap[^>]+\{jumpTarget\}/, 'Mindmap panel should receive jump targets');
assert.match(app, /<Diagnostics[^>]+\{conceptStore\}[^>]+\{mindmapStore\}/, 'Diagnostics panel should receive concept and mindmap stores');
assert.match(app, /<Import[^>]+\{cardStore\}[^>]+\{conceptStore\}[^>]+\{mindmapStore\}/, 'Import panel should receive stores for compatible export');

assert.match(notebook, /openConceptsFromNotebook/, 'Notebook should expose a send-to-concepts action');
assert.match(notebook, /buildNotebookConceptRequest/, 'Notebook should build scoped concept requests');
assert.match(notebook, /noteIds/, 'Notebook chat context should include selected notes');
assert.match(notebook, /noteModes/, 'Notebook concept handoff should include selected notes');
assert.match(notebook, /sourceModes/, 'Notebook chat context should preserve selected source modes');
assert.match(notebook, /renderMath\(msgListEl\)/, 'Notebook chat should render math formulas in messages');
assert.match(concepts, /applyNotebookTarget\(notebookTarget\)/, 'Concepts should react to Notebook targets');
assert.match(concepts, /fetchOpenNotebookPipelineSources/, 'Concepts should support OpenNotebook sources');
assert.match(concepts, /sourceMode: 'manual' \| 'opennotebook' \| 'mixed'/, 'Concepts should support mixed source mode');
assert.match(concepts, /searchSiyuanDocs/, 'Concepts should search SiYuan docs for mixed sources');
assert.match(concepts, /readSiyuanDocsAsPipelineSources/, 'Concepts should convert selected SiYuan docs into pipeline sources');
assert.match(concepts, /buildPipelineSources/, 'Concepts should merge selected source types before running the pipeline');
assert.match(concepts, /bind:value=\{concept\.title\}/, 'Concept candidates should be editable before confirmation');
assert.match(concepts, /bind:value=\{relation\.fromTempId\}/, 'Relation endpoints should be editable before confirmation');
assert.match(concepts, /bind:value=\{card\.conceptTempId\}/, 'Card-to-concept assignment should be editable before confirmation');
assert.match(concepts, /bind:value=\{card\.front\}/, 'Card fronts should be editable before confirmation');
assert.match(concepts, /notebookNoteIds/, 'Concepts should preserve Notebook note scope');
assert.match(concepts, /noteIds: notebookNoteIds/, 'Concepts should pass note scope into OpenNotebook pipeline sources');
assert.match(concepts, /confirmPipelineResult/, 'Concepts should confirm candidates into stores');
assert.match(concepts, /syncConceptMindmap/, 'Concept confirmation should sync a concept mindmap');
assert.match(concepts, /renderMath\(candidateReviewEl\)/, 'Concept candidates should render math formulas before confirmation');
assert.match(browse, /openConceptMindmapForCard/, 'Browse should let a card open or create its concept mindmap');
assert.match(browse, /syncConceptMindmap/, 'Browse card details should be able to sync a concept mindmap');
assert.match(browse, /getLinkedMindmaps/, 'Browse should list mindmaps linked to a card');
assert.match(mindmap, /mode: 'cards' \| 'doc' \| 'concepts'/, 'Mindmap should keep cards/doc/concepts modes');
assert.match(mindmap, /loadConceptMindmap/, 'Mindmap should generate from concept graph');
assert.match(mindmap, /generateCardsFromCurrentMindmap/, 'Mindmap should generate flashcards from the current map');
assert.match(mindmap, /linkedCardIds/, 'Mindmap-generated cards should be linked back to the map');
assert.match(mindmap, /renderMath\(reviewDialogEl\)/, 'Mindmap review overlay should render math formulas');
assert.match(importPanel, /buildExportPayload/, 'Import panel should use the shared export payload builder');
assert.match(importPanel, /conceptStore\?\.getAll/, 'Export should include concept graph nodes');
assert.match(importPanel, /mindmapStore\?\.getAll/, 'Export should include saved mindmaps');
assert.match(diagnostics, /siyuan-all-in-one-diagnostics/, 'Diagnostics should produce structured reports');
assert.match(diagnostics, /copy-diagnostic-report/, 'Diagnostics should expose copyable reports');
assert.doesNotMatch(diagnostics, /apiKey["']?\s*:/, 'Diagnostics reports must not serialize API keys');
assert.match(diagnostics, /apiKeySet/, 'Diagnostics reports should only expose whether an API key is set');

console.log(JSON.stringify({
  appContracts: 8,
  panelContracts: 32,
  repeatedNotebookHandoff: true,
  mixedSources: true,
  diagnosticsSecretsRedacted: true,
}, null, 2));
