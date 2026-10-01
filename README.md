# Worship Chord Companion

A Firefox extension that listens to a worship video on YouTube while it plays and shows the key,
the current and next chord, and a chart organised by sections (전주 / 절 / 후렴 / 브릿지 …).
Everything runs locally: audio is analysed in memory in the page, nothing is uploaded, no account.
See `plan.md` for the full plan and decisions.

## Try it

```sh
npm install
npm run build
npx web-ext run --source-dir dist --start-url https://www.youtube.com   # opens Firefox with the extension
```

Or load `dist/` in Firefox via `about:debugging` → *This Firefox* → *Load Temporary Add-on* → `dist/manifest.json`.

1. Open a worship video, open the sidebar (toolbar button), press **Connect**, press play.
2. Within ~20 s the key shows; chords appear live. Play the song once through to get the full chart,
   sections, tempo and 전조. Later visits load the saved chart and scroll with the video.
3. Click a chord to fix it (change, split, merge), rename/split/merge sections, loop a section,
   slow the video down, switch names ↔ numbers, transpose, simplify to triads.
4. **Lyrics** tab: Korean captions (if the video has them) with chords above the lines.
5. *Song info*: cleaned title, search links (코드 악보 / 악보 / 가사, opened in a new tab) and
   **Import chart**: paste a ChordPro/bar chart you already have; it is lined up with the audio.
6. **콘티** button: build a setlist from saved songs, set order, key and notes, export ChordPro or print (A4).

Chart format for import/testdata (lyrics optional):

```
{title: 곡명}
{key: G}
{order: 전주 1절 후렴 1절 후렴}   # optional play order when sections repeat
{section: 전주}
| G | D/F# | Em7 | C |
{section: 후렴}
| G | D | Em | C |
```

## Develop

| Command | What |
|---|---|
| `npm test` | unit tests (music theory, chords, key, beats, structure, alignment, 콘티 …) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` / `npm run lint` | bundle to `dist/` / `web-ext lint` |
| `npm run e2e` | headless Firefox end to end test (see below) |
| `npm run eval -- backup.json --log` | re-score stored analysis against `testdata/*.chordpro` |

`npm run e2e` builds a test variant (`WCC_TEST=1`) that also runs on `localhost`, plays a synthesized
G–D–Em–C song with percussion on a local page that mimics `/watch?v=…`, and drives the real sidebar
and 콘티 page through embedded frames. It needs Firefox in `/Applications` and a geckodriver binary at
`.cache/geckodriver` (see `e2e/run.mjs`). It uses its own temporary profile in `.cache/tmp`.

## Status and honest limits

All phases of `plan.md` are implemented and covered by unit and end-to-end tests on **synthetic** audio.
Not yet done: collecting the real test set (`testdata/`), scoring on real worship videos
(`docs/eval-log.md`), tuning thresholds on them, and testing on real YouTube pages (ads, navigation,
other audio extensions). Expect rough edges there. Known: the sidebar builds some HTML with
`innerHTML` (escaped), which `web-ext lint` warns about; replace before publishing on AMO.
