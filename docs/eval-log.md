# Evaluation log

| Date | Analyzer | Set | Key | Chord seq. similarity | Notes |
|---|---|---|---|---|---|
| 2026-10-01 | 0.1.0 | synthetic unit tests | 1/1 | exact on G–D–Em–C | Real-video test set not yet collected (Phase 2) |
| 2026-10-01 | 0.2.0 | synthetic: power chords (no 3rd) in G | – | key prior: 1.00 vs 0.53 without key | Phase 5 priors, tests/priors.test.ts |
| 2026-10-01 | 0.2.0 | e2e synthetic song in Firefox | G major ✓ | live chords ≥85%, chart G-D-Em-C ≥80%, 100 BPM ✓ | `npm run e2e`; real worship videos still to be scored |
| 2026-10-02 | tempo 1.0.1 (chroma flux @10 Hz) | synthetic band (`tests/songgen.ts`, `scripts/tempo-bench.mjs`) | – | tempo within 3%: rock 18/24, acoustic 18/24, ballad 9/24, pad-only 3/24 (48/96) | baseline that confirmed "BPM looks wrong" |
| 2026-10-02 | tempo 1.0.2 (spectral flux @40 Hz + comb) | same synthetic band | – | tempo within 3%: rock 22/24, acoustic 23/24, ballad 14/24, pad-only 2/24 (61/96); all remaining errors are half-time, pads have no attacks | ÷2/×2 buttons added for the octave ambiguity; real recordings still untested |
| 2026-10-02 | tempo 1.0.2 + CCM band | synthetic CCM/piano/drums/bass (`ccm`, `ccm68`) + earlier styles, 210 songs 50–150 BPM | – | within 3%: 167/210 (ccm 33/42, ccm68 39/42, rock 35/42, acoustic 36/42, ballad 24/42); errors are octave (slow songs read ×2, fast ballads ÷2) | prior centre 100, σ 1 oct, off-beat weight 0.6 (sweep) |
| 2026-10-02 | octave rule from snare backbeat contrast (experiment, dropped) | 144 synthetic songs | – | 130/144 without it, 113 at weight 0.5, 98 at weight 1 | made things worse, not shipped |
