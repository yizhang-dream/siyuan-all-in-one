# Changelog

## [1.0.0] — 2026-06-18

### Breaking Changes

- Renamed from `siyuan-flashcards` to `siyuan-all-in-one`
- Replaced dock panel with center Tab (`addTab` + `openTab`)
- Removed Anki integration entirely (self-contained)

### Added

- 5 card types: concept, derivation, calculation, comparison, real-exam
- AI generation preview & review before adding
- Card deduplication (normalized question comparison)
- Knowledge tree mindmap generation (GLM 2-level tree → SiYuan mindmap block)
- Card editing (question/answer/hint/deck/tags/type)
- Batch card selection and deletion
- Tag input and tag filtering in browser
- `cardsPerDay` limit enforcement during generation
- `defaultDeck` config used by manual add
- Math delimiter conversion (`\[\]`/`\(\)` → `$$`/`$`)
- Bracket-matching JSON extractor (replaces fragile regex)
- Dynamic `maxTokens` based on card type and count

### Fixed

- Keyboard conflict: input/textarea no longer triggers review shortcuts
- `cleanConfig` uses `??` instead of `||` (allows empty endpoints to disable features)
- Open Notebook default port corrected from 8765 to 5055
- `importCards` validates card structure (prevents crash on malformed data)
- `card.hint` optional chaining (prevents crash on undefined)
- `getDue()` and `getStats().due` use unified `isDue()` logic
- Card ID uses `crypto.randomUUID()` (collision-free)
- `app.$destroy()` guarded against double-call
- Svelte config propagation via `$set` after `saveConfig`

### Removed

- Anki/AnkiConnect integration
- MCP dependency (uses SiYuan HTTP API directly)
- Dead code: `dueCards()`, `newCards()`, `searchContext()` re-export, `generateMindmap()` old stub
