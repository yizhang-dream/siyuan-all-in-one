# Contributing

Thanks for helping improve SiYuan All-in-One Flashcards.

## Development

```bash
npm install
npm run verify
```

For local SiYuan deployment:

```bash
npm run deploy:siyuan -- --apply
npm run check:full
```

For custom SiYuan workspaces:

```bash
npm run deploy:siyuan -- --apply --siyuan-data "/path/to/SiYuan/data"
npm run check:full -- --siyuan-data "/path/to/SiYuan/data"
```

## Before Opening a PR

- Keep changes focused.
- Do not commit `dist/`, `release/`, `.deploy-backups/`, `.env`, real plugin data, or API keys.
- Add or update tests when changing data models, prompts, rendering, source adapters, or deployment scripts.
- If a change touches OpenNotebook or LLM behavior, run `npm run check:live` when you have a configured local environment.

## Areas That Need Extra Care

- LLM JSON parsing and repair.
- Source references and evidence grounding.
- Formula rendering in cards, chat, candidates, and mindmaps.
- Cross-platform SiYuan data path handling.
- Backward compatibility for existing `saveData` files.

