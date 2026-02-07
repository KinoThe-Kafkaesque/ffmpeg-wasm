# MKV Feature Roadmap

Last updated: 2026-02-07

## Priority Queue

1. HTTP range-backed `read_at` for remote sources (`in_progress` after local read_at landing)
2. Cue/index observability + fallback indexing (`planned`)
3. Chapters + ordered chapter support (`in_progress`)
4. Rich track semantics and disposition policy (`planned`)
5. Attachment pipeline for subtitles/fonts (`in_progress`)
6. Timing fidelity test suite (`in_progress`)
7. Explicit unsupported encryption/content-encoding handling (`planned`)

## Current Sprint: 3 + 5 + 6

### 3) Chapters + Ordered Chapters
- Add chapter APIs to wasm:
  - chapter count
  - start/end timestamps
  - title
  - chapter seek helper
- Expose chapter metadata through worker payloads for UI and diagnostics.
- Add initial ordered-chapter readiness note:
  - treat ordered edition semantics as follow-up once demuxer-visible metadata is confirmed end-to-end.

### 5) Attachment Pipeline
- Add attachment APIs to wasm:
  - attachment count
  - attachment name / mime
  - size / data pointer
- Auto-load font attachments into libass when subtitle renderer initializes.
- Expose attachment metadata through worker payloads so UI can show what was discovered.

### 6) Timing Fidelity Tests
- Expand core tests with:
  - monotonic video PTS checks across decode windows
  - seek-after-seek stability checks (forward/backward)
  - chapter timestamp sanity checks (if chapters present)
  - attachment metadata sanity checks (if attachments present)

## Follow-up
- Add UI chapter menu + chapter jump interactions.
- Add attachment inspector panel for debugging (name, mime, bytes, font-loaded state).
- Add MKV-specific regression vectors:
  - no cues
  - sparse cues
  - ordered chapters
  - ASS with external/attached fonts.

## Implemented This Iteration
- Chapter menu + chapter jump messaging (`seekChapter`) wired in `web/v3.html`, `web/app-v3.js`, and `web-react/src/App.jsx`.
- Attachment inspector panel added in both demo UIs (vanilla + React).
- Added regression harness `scripts/test-mkv-regressions.mjs`:
  - auto-generates `no-cues` and `sparse-cues` vectors
  - optionally validates `ordered-chapters` when a fixture is provided.
