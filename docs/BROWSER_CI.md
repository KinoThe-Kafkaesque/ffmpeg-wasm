# Local Browser CI

This repository has a local Playwright suite for browser compatibility checks on this machine. It is intentionally local-first: no BrowserStack, no Sauce Labs, no external video URLs, and no cross-origin sample dependency.

## Setup

```bash
npm install
npm run test:browser:install
```

`test:browser:install` downloads Playwright-managed Chromium, Firefox, and WebKit. The `chrome` project uses the system Chrome channel when available.

## Run

```bash
npm run ci:browser
```

The suite starts `scripts/serve-web.mjs` with COOP/COEP headers, writes generated test media to `web/__test-fixtures__/`, and stores reports under `output/playwright*`.

## Browser Matrix

The default matrix is:

- `chromium`
- `chrome`
- `firefox`
- `webkit`
- `mobile-chromium`
- `mobile-webkit`

The mobile projects are Playwright device profiles, not real phones. They are useful for layout and browser-engine checks on this machine, but they do not replace real iOS/Android device testing before a public compatibility claim.

## Coverage

`tests/browser/player-v3.spec.mjs` covers the product player surface:

- COOP/COEP headers needed by pthread WASM.
- Browser capability detection for `SharedArrayBuffer`, workers, WebAssembly, and OffscreenCanvas transfer.
- `ffmpeg_wasm.capabilities.json` and `ffmpeg-components.json` release policy, including playback-only FFmpeg components.
- Removal of the manual format dropdown.
- Clean visible error handling for a missing URL source.
- Local MKV upload through `read_at`, video decode, audio decode, track counts, subtitle stream selection, and seek.
- Audio-only MP3 playback surface.
- Responsive menu/control/video-container sizing on each active viewport.

`tests/browser/fate-browser.spec.mjs` covers the browser-native FFmpeg/WASM harness:

- `fate-browser.html` loads the generated FATE manifest.
- `FateBrowserRunner` can run local synthetic metadata, decode, and seek profiles.
- Decode checks verify stream enumeration, audio/video frame decode, RGBA conversion, and seek output.

## Interpreting Results

A green run means the checked behavior works across the local Playwright browser engines on this machine with the current bundled WASM assets. It does not prove every codec, every real mobile browser, or every network host works.

Failures should be triaged by project:

- Chromium/Chrome failures are release blockers for the current pthread demo.
- Firefox/WebKit failures may be browser-support issues or app regressions; inspect the captured report before deciding.
- Mobile project failures usually mean responsive layout or viewport interaction regressions.

When debugging a failure, start with:

```bash
npx playwright show-report output/playwright-report
```

Then reproduce a single project:

```bash
npx playwright test --project=chromium tests/browser/player-v3.spec.mjs
```
