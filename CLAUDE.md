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
- `npm run run` builds nothing; run `npm run build` first, then `web-ext run` opens Firefox with the extension.
- `npm run eval` scores stored analysis against `testdata/` (see `docs/eval-log.md`).
