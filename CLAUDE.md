# Worship Chord Companion

Firefox (MV3) extension: while a worship video plays on YouTube, a sidebar shows key, chords and song structure. Local only — audio is analysed in memory, nothing is uploaded.

Read `plan.md` before starting work. Current phase: see Status at the bottom of `plan.md`.

## Conventions
- TypeScript strict; music/analysis logic is pure and lives in `src/music`, `src/analysis` with Vitest tests in `tests/`.
- YouTube-specific code only in `src/content/youtube.ts`.
- The content script owns the live `SongSession`; the sidebar sends edit commands, the background script owns IndexedDB.
- Small commits. Re-analysis only replaces `detected` items; `user`/`imported` are kept (`src/analysis/merge.ts`).

## Commands
- `npm run build` → `dist/` · `npm test` · `npm run typecheck` · `npm run lint` (web-ext lint)
- `npm run e2e` runs the headless Firefox end-to-end test (needs `.cache/geckodriver`; never touch the user's own Firefox profile).
- Run Firefox for the extension with `npm run build && npx web-ext run --source-dir dist`.
- `npm run eval` scores stored analysis against `testdata/` (see `docs/eval-log.md`).

All phases (0–8) are implemented; next work is scoring on real videos (see README “Status and honest limits”).
