# Worship Chord Companion — Project Plan

> Working title. A Firefox extension that listens to Korean CCM and worship videos on YouTube and shows the key, the chords and the song structure, so a worship band guitarist can learn songs quickly, play along, and prepare charts for the band.

**Status:** planning · **Platform:** Firefox desktop · **Last updated:** 2026-10-01

---

## 1. Problem and goal

I play electric guitar in a worship band, and we learn most songs (mostly Korean CCM) from YouTube videos. Working out the key, the chords and the form (전주, 절, 후렴, 브릿지 …) by ear takes a lot of time. Existing tools such as Note by Note, Moises and Chordify are useful but generic, and none is built around Korean worship music or the way Korean worship teams prepare a 콘티.

**Goal:** while a worship video plays on YouTube, a sidebar shows:

- the **key** (and any key change),
- the **current chord** and the **next chord**,
- a **chord chart organized by sections**,

and lets me fix mistakes, transpose, show chords as numbers, and export charts for the band.

## 2. Key decisions

1. **Local only.** Audio is analyzed in memory, in the browser, while the video plays. Nothing is uploaded; no server and no account in v1.
2. **Chord chart, not staff notation.** The output is a 코드 악보: chords and sections, later with lyrics. Melody transcription is out of scope.
3. **Analyze once, then play along.** The first playback is analyzed live. Results are saved per YouTube video ID, so later playbacks show the whole chart, including upcoming chords.
4. **Charts belong to a video, not to a song title.** Live versions often differ from the studio version in key and arrangement.
5. **User edits win.** Every chord and section can be corrected, and re-analysis never overwrites a correction.
6. **Korean CCM first.** Chord vocabulary, progression priors, section names and defaults are tuned for Korean worship music.
7. **No automatic copying of 악보 or lyrics from other websites.** Use reference links, the user's own charts and alignment instead (Phase 7).
8. **Small, testable steps.** Every phase ends with something that runs and can be measured against the test set.

## 3. Scope

**v1 = Phases 0–5:** audio access, live key and chords, test set and evaluation, play-along chart with corrections, song structure, Korean CCM tuning.

**After v1:** lyrics view (Phase 6), reference lookup and chart import (Phase 7), 콘티 builder and export (Phase 8).

**Out of scope for now:**

- Melody or staff notation (오선보)
- Downloading audio or video from YouTube (not allowed by YouTube's terms); the extension only listens while the video plays
- Scraping or storing 악보 images or lyrics from other websites
- Chrome, mobile, user accounts, servers, sharing between users

## 4. Glossary (Korean worship terms)

| Term | Meaning |
|---|---|
| 악보 | Sheet music |
| 코드 악보 | Chord chart: lyrics with chords above them |
| 오선보 | Staff notation |
| 콘티 | Setlist for a service, with a chart for each song in the chosen key |
| 인도자 | Worship leader, who often decides the key |
| 전조 | Key change, often up a half or whole step before the last chorus |
| 전주 / 간주 / 후주 | Intro / instrumental interlude / outro |
| 절 (1절, 2절) | Verse (verse 1, verse 2) |
| 프리코러스 | Pre-chorus |
| 후렴 | Chorus |
| 브릿지 | Bridge. Some musicians also use it for the pre-chorus, so every label must be renamable. |
| 엔딩 | Ending |

## 5. User stories

- I open a worship video, press **Connect** in the sidebar, and see the key within about 20 seconds.
- While the video plays, I see the current chord in large type and the next chord, with less than about 1 second of lag.
- After one full playback, I see the whole song as sections with chords per bar. On replay, the chart scrolls with the video.
- I can click a wrong chord to fix it, and rename, split or merge sections.
- I can switch between chord names (G, D/F#) and numbers (1, 5/7), and transpose to the key our 인도자 chooses.
- I can loop a section and slow it down to practice a part.
- If the video has Korean subtitles, I see the chords above the lyric lines.
- I can paste in a chart I already have, and the tool lines it up with the video.
- I can collect songs into a 콘티, set each song's key and order, and export it to print or send to the band.

## 6. Architecture (first draft)

```text
youtube.com/watch page
└─ Content script (all YouTube-specific code lives here)
   ├─ finds the <video> element, video ID, title, currentTime,
   │  play / pause / seek / playback rate / ad state
   ├─ taps the audio with the Web Audio API
   │  (MediaElementAudioSourceNode → analysis AND speakers)
   └─ Phase 6: reads the Korean subtitle track, if there is one
        │  audio frames + video timestamps
        ▼
Analysis (AudioWorklet and/or Web Worker, so the video never stutters)
   ├─ features: chroma (12 pitch classes), bass chroma, energy, onsets, beats
   ├─ key detection, including key changes
   ├─ chord candidates with confidence
   └─ smoothing: key-aware HMM / Viterbi with worship-progression priors
        │  chords, key, beats
        ▼
Song store (IndexedDB, one record per video ID)
   ├─ stored feature frames (not audio), so analysis can be re-run without replaying
   ├─ structure analysis after a full pass (repetition → sections)
   └─ user corrections on top of detected data
        │
        ▼
Sidebar UI (Firefox sidebar_action)
   ├─ now / next chord, key, chord names ↔ numbers, transpose
   ├─ chart view (sections × bars), later a lyrics view
   └─ correct, loop, import, 콘티, export
```

To settle in Phase 0: where the analysis runs (content script, AudioWorklet, worker or background script), and how the content script and the sidebar talk to each other (runtime messages or ports).

## 7. Data model (first draft)

```ts
type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11; // C = 0
type Mode = "major" | "minor";
type ChordQuality =
  | "maj" | "min" | "7" | "maj7" | "m7"
  | "sus4" | "sus2" | "add9" | "dim" | "aug";
type Source = "detected" | "user" | "imported";

interface ChordEvent {
  startSec: number;
  endSec: number;
  root: PitchClass | null;      // null = no chord (N.C.)
  quality: ChordQuality | null;
  bass?: PitchClass;            // slash chords, e.g. D/F#
  confidence: number;           // 0..1
  source: Source;
}

interface Section {
  startSec: number;
  endSec: number;
  group: string;                // "A", "B", ... repeated parts share a group
  label: string;                // "전주", "1절", "후렴", ... renamable
  source: Source;
}

interface SongRecord {
  videoId: string;
  rawTitle: string;             // YouTube title as shown
  title: string;                // cleaned up, editable
  artist?: string;
  durationSec: number;
  analyzerVersion: string;      // re-analyze when the algorithm improves
  analyzedRanges: [number, number][]; // parts of the video actually heard
  key: { tonic: PitchClass; mode: Mode; confidence: number };
  keyChanges: { atSec: number; tonic: PitchClass; mode: Mode }[];
  tempoBpm?: number;
  beats?: number[];             // seconds
  chords: ChordEvent[];
  sections: Section[];
  lyrics?: { startSec: number; endSec: number; text: string }[]; // Phase 6
  transpose: number;            // semitones, display only
  notes?: string;
  updatedAt: string;            // ISO date
}
```

Notes:

- Re-analysis replaces only `detected` items; `user` and `imported` items are kept.
- Feature frames (for example chroma per frame) live in a separate IndexedDB store, keyed by video ID and feature-extractor version.
- Note names are spelled at display time from the key (F# vs Gb), never stored as text.
- ChordPro is the import/export format for charts.

## 8. Phases

Each phase has a goal, tasks and a **Done when** check. Targets are first guesses; adjust them once there are real measurements.

### Phase 0 — Setup and audio spike

**Goal:** prove that the extension can listen to a YouTube video's audio in Firefox without breaking playback.

- Set up the project: git, TypeScript, a bundler, `web-ext` (run, lint, build) and unit tests.
- Minimal extension: a content script on `youtube.com` and a Firefox sidebar panel. Check the current MDN docs for Firefox's Manifest V3 details.
- A **Connect** button in the sidebar. Browsers may keep a new AudioContext suspended until the user interacts, so make sure it starts reliably.
- Tap the video's audio and show a live level meter and a 12-bar chroma display in the sidebar.
- Playback must sound normal: once audio is routed through Web Audio, the graph also has to connect to the speakers.
- A media element can only have one MediaElementAudioSourceNode, so reuse it when the sidebar is closed and reopened.
- Handle YouTube switching videos without a page reload, pause and seek, playback-rate changes, and ads (pause analysis while an ad plays).

**Done when:** the meter and chroma react to the music on several different videos, playback sounds normal, and moving to another video works without reloading the page.

### Phase 1 — Live key and chords (baseline)

**Goal:** a first working version of the main idea.

- Compute chroma per frame. Try Meyda (MIT) and Essentia.js (AGPL-3.0, WebAssembly) and pick one; check which key and chord algorithms Essentia.js actually exposes.
- Key detection from accumulated chroma (key profiles), updated as more audio arrives, with a confidence value.
- Chord detection by template matching: major and minor first, then 7, maj7, m7, sus4 and add9. Bass note from low-frequency chroma, for slash chords.
- Simple smoothing so the display doesn't flicker (for example a minimum chord length).
- Sidebar: large current chord, key with confidence, and a strip of recent chords.

**Done when:** key and chords appear live on the test videos with less than about 1 second of lag, and the video never stutters.

### Phase 2 — Test set and evaluation

**Goal:** measure whether each change makes detection better or worse.

- Save the analysis result and the feature frames for each video ID in IndexedDB after playback.
- Pick 10–20 songs the band knows well. Mix tempos, studio and live videos, songs with a 전조, songs with and without Korean subtitles, and simple and colorful harmony.
- For each song: the YouTube video ID and a reference chart I type myself (sections and chords per bar, ChordPro style, no lyrics needed). Store them in `testdata/`.
- An **evaluation mode** that compares stored results with the reference: key right or wrong, chord-sequence similarity per section (sequence alignment, so exact timings don't need to be typed), and later section labels.
- Because feature frames are stored, key, chord and structure algorithms can be re-run and re-scored without replaying the videos. Only changes to feature extraction need a replay.
- Optional: a Node script that runs the same analysis code on audio files I own (bought tracks or our own band recordings). Never use files downloaded from YouTube.
- Log every evaluation run in `docs/eval-log.md`: date, analyzer version, scores.

**Done when:** one action produces a score table for the whole test set, and the Phase 1 baseline is recorded. Starting targets for the next phases: key right on at least 8 of 10 songs, and main chords mostly right on simple songs.

### Phase 3 — Analyze once, play along

**Goal:** a chart I can actually play along with.

- When a known video opens, load its saved analysis; keep analyzing the parts that haven't been heard yet.
- Beat and bar tracking; snap chord changes to beats.
- Chart view: bars in rows, the current bar highlighted, upcoming chords visible, auto-scroll.
- Click a chord to correct it.
- Loop a section (A–B repeat) and change playback speed through the video element.
- A re-analyze button, and export/import of all data as a JSON backup.

**Done when:** on the second playback of a test song the full chart stays in sync with the video, and corrections survive a browser restart.

### Phase 4 — Song structure

**Goal:** sections such as 전주, 절, 후렴 and 브릿지 without manual work.

- After a full pass, find repeated parts using the self-similarity of chroma and of the chord sequence, and group them (A, B, C …).
- Name the groups with heuristics, for example: the most repeated and usually loudest group → 후렴; the group right before it → 프리코러스; a group that appears once, late in the song → 브릿지; instrumental parts → 전주, 간주, 후주.
- Detect a 전조 (usually before the last 후렴) and show both keys.
- Manual editing: rename, split, merge, move boundaries.

**Done when:** sections roughly match the reference charts on most test songs, and fixing the rest takes under a minute per song.

### Phase 5 — Korean CCM tuning

**Goal:** better accuracy on the chords worship songs actually use.

- Full chord vocabulary: maj, min, 7, maj7, m7, sus4, sus2/add9, dim, and slash chords for moving bass lines.
- Key-aware HMM / Viterbi smoothing with transition priors for common worship moves, written in numbers, for example:
  - `1 – 5/7 – 6m – 4` (descending bass)
  - `4 – 5 – 3m – 6m`
  - `2m7 – 4/5 – 1`
  - `4/5` leading into a new section
  - `sus4` resolving to the plain chord
- The priors come from general music theory and progressions I write down myself, not from scraped charts.
- Number display (1, 4, 5, 6m, 5/7) with correct spelling for each key.
- Transpose to any key, and a "simplify chords" toggle (triads only).

**Done when:** chord scores on the test set are clearly better than the Phase 2 baseline, with the numbers recorded in `docs/eval-log.md`.

### Phase 6 — Korean lyrics view

- If the video has Korean subtitles (ideally uploaded by the channel rather than auto-generated), read the timed lines.
- Place chords above the lyric lines by time to build a 코드 악보 view. Subtitle timing is per line, not per syllable, so chord positions within a line are approximate and can be nudged by hand.
- Use repeated lyric lines to improve chorus detection.
- Lyrics are shown and stored locally only, never published.

**Done when:** for test songs with subtitles, the lyrics view is readable and the chords appear on the right lines.

### Phase 7 — Reference lookup and chart import

- Clean the YouTube title into song title and artist. Korean worship titles are messy (`[팀명] 곡명 (인도자) | Official Live …`), so the result stays editable.
- Reference panel: buttons that open a web search (for example `<title> 코드 악보`) in a new tab, plus metadata such as writer or original key from sources that allow it. Check each source's terms before automating any requests.
- Import a chart I already have: paste ChordPro or simple text (later perhaps a photo or PDF of our own 악보, read with OCR).
- Align the imported chord sequence to the stored analysis. Matching a known chord list is much more accurate than detecting chords from scratch, so imported charts should sync almost perfectly.
- Treat outside information as a hint only: the original key may differ from a live version's key.

**Done when:** importing a typed chart for a test song gives a synced chart that needs almost no corrections.

### Phase 8 — 콘티 builder and export

- Pick saved songs and set their order, the key for each song and notes (for example "후렴 2번 반복").
- Export as ChordPro text and as a printable view (A4, one song per page), with a numbers-only option.
- Back up and restore everything.

**Done when:** a 콘티 of 4–5 songs can be exported and printed for practice.

### Later ideas

- A neural chord model (for example run with ONNX Runtime Web) if template matching plus HMM stops improving.
- Sharing charts with bandmates (chords and sections only, without lyrics).
- A Chrome version, a Korean UI, guitar voicing suggestions.

## 9. Tech stack (proposal)

Claude Code may suggest alternatives; record any change in the decision log.

- Firefox WebExtension, Manifest V3, sidebar via `sidebar_action`
- TypeScript (strict), a bundler (Vite or esbuild), `web-ext` to run, lint and package
- Web Audio API: MediaElementAudioSourceNode, AudioWorklet and/or AnalyserNode
- Feature extraction: Meyda (MIT) or Essentia.js (AGPL-3.0: publishing the extension with it would mean releasing its source under the AGPL)
- Storage: IndexedDB
- UI: plain TypeScript or a small framework (Preact or Svelte), kept light
- Tests: Vitest for the music logic (chords, keys, numbers, transposition, ChordPro, structure heuristics)

## 10. Risks

| Risk | How to handle it |
|---|---|
| sus4, add9 and slash chords are often wrong | Confidence display, quick corrections, worship-progression priors, chart import with alignment |
| Sections can't be known live | Analyze once, label after a full pass, show the map on replay |
| YouTube changes its page and breaks the content script | Keep YouTube-specific code in one module; fail with a clear message |
| Other audio extensions (equalizers, volume boosters) conflict with the audio tap | Detect it and show a clear message; test early in Phase 0 |
| Live versions differ from studio versions | Charts are stored per video, not per title |
| High CPU use makes the video stutter | Analysis in an AudioWorklet or worker; measure CPU; lower the analysis rate if needed |
| Scope creep | v1 is Phases 0–5; everything else waits |
| Copyright and site terms | Local only, no downloading, no scraping of 악보 or lyrics, lyrics never published |

## 11. Legal and licensing notes

Not legal advice. Check these before publishing anything.

- YouTube: the extension only analyzes audio while the video plays and never downloads it. Read YouTube's terms and Mozilla's add-on policies before publishing on addons.mozilla.org.
- Lyrics and 악보 belong to their writers and publishers. Keep imported charts and lyrics private.
- Library licenses: Essentia.js is AGPL-3.0, Meyda is MIT.

## 12. Working with Claude Code

- Keep this file as `plan.md` in the repository root. Add a short `CLAUDE.md` with a 2–3 line project summary, "Read plan.md before starting work", conventions (TypeScript strict, tests for music logic, small commits), how to run the extension (`web-ext run`) and the current phase.
- Work on one phase at a time. Start each phase in plan mode: ask Claude Code to read `plan.md` and propose how to implement the phase before it writes any code.
- After each phase: test in Firefox, run the evaluation, update `docs/eval-log.md` and the Status section below, then commit.
- When something breaks, describe what you did, what you expected and what happened, and paste any error messages from the browser console.
- Record important choices in the decision log.

## 13. Open questions

- Project name? UI language: Korean, English or both?
- Default display: chord names, numbers or both?
- Which songs go into the test set?
- Personal use only, or publish on addons.mozilla.org later? This affects library and licensing choices.
- Should bandmates be able to use it later?

## 14. Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-01 | Firefox desktop, local only, chord charts instead of staff notation | Simplest path to a useful tool; staff notation from a full band mix is unreliable |
| 2026-10-01 | No automatic 악보 scraping; reference links, chart import and alignment instead | Copyright and site terms; online 악보 are mostly images; live versions differ from published sheets |

## 15. Status

- [~] Phase 0 — Setup and audio spike (code done; needs manual Firefox check)
- [~] Phase 1 — Live key and chords (baseline) (code done; needs manual Firefox check)
- [~] Phase 2 — Test set and evaluation (tooling done; real test set to be collected)
- [~] Phase 3 — Analyze once, play along (beats, bar chart, editor, loop done; needs Firefox check)
- [~] Phase 4 — Song structure (sections, labels, key changes, editing done; needs real-song tuning)
- [~] Phase 5 — Korean CCM tuning (vocabulary, key and progression priors, numbers, transpose, simplify done; needs real-song scoring)
- [ ] Phase 6 — Korean lyrics view
- [ ] Phase 7 — Reference lookup and chart import
- [ ] Phase 8 — 콘티 builder and export

| 2026-10-01 | Own chroma/key/chord code instead of Meyda/Essentia.js | No licence issue (Essentia is AGPL), runs identically in Node for evaluation, small |
| 2026-10-01 | Content script owns the live SongSession; background owns IndexedDB; sidebar sends edit commands | One writer per piece of state; sidebar can be closed without losing analysis |
| 2026-10-01 | Beat tracking from chroma flux + energy rise at 10 Hz with a tempo prior, half-time accepted | Cheap, no extra audio features needed; fast songs may read as half tempo |
