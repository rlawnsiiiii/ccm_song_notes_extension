# Evaluation log

| Date | Analyzer | Set | Key | Chord seq. similarity | Notes |
|---|---|---|---|---|---|
| 2026-10-01 | 0.1.0 | synthetic unit tests | 1/1 | exact on G–D–Em–C | Real-video test set not yet collected (Phase 2) |
| 2026-10-01 | 0.2.0 | synthetic: power chords (no 3rd) in G | – | key prior: 1.00 vs 0.53 without key | Phase 5 priors, tests/priors.test.ts |
| 2026-10-01 | 0.2.0 | e2e synthetic song in Firefox | G major ✓ | live chords ≥85%, chart G-D-Em-C ≥80%, 100 BPM ✓ | `npm run e2e`; real worship videos still to be scored |
