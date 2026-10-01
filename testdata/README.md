# Test set

One `.chordpro` reference chart per song (type it yourself; lyrics not needed).
See `testdata/example.chordpro` for the format. `{video: ID}` ties it to a YouTube video.

Workflow:
1. Play each video once with the sidebar connected (so frames are stored).
2. Sidebar → Export → save the backup JSON (it includes feature frames).
3. `npm run eval -- backup.json --log` re-runs the current analyzer and appends scores to `docs/eval-log.md`.
