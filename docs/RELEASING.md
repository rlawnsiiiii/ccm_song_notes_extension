# Releasing

1. Bump `version` in `static/manifest.json` and `package.json`; update `CHANGELOG.md`.
2. `npm test && npm run typecheck && npm run build && npm run lint && npm run e2e`
3. `npm run package` → `web-ext-artifacts/worship_chord_companion-<version>.zip`
   and `npm run package:source` → `web-ext-artifacts/source.zip` (AMO asks for sources because the code is bundled).
4. Tag and release: `git tag v<version> && git push --tags`, attach the zip to a GitHub release.
5. Submit at https://addons.mozilla.org/developers/ (Submit a New Add-on):
   - **On this site** = listed on addons.mozilla.org (public, reviewed); **On your own** = signed `.xpi` you host/install yourself.
   - Upload the zip; when asked for source code upload `source.zip` and say: `npm install && npm run build`, Node 18+,
     output in `dist/`.
   - Data collection: none (declared in the manifest).
   - Permissions to explain: `storage`/`unlimitedStorage` (saved charts and analysis frames, local only),
     `*://www.youtube.com/*` (read the video's audio and captions list).
