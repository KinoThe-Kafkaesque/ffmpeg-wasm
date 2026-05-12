# First Alpha Release Candidate

Date: 2026-05-12

This release candidate is a developer-preview release of the FFmpeg WASM player stack. It is viable for a first alpha, not a stable 1.0 consumer-player release.

## Release Position

This build is ready to ship as:

- Chromium-focused.
- Local-file first.
- WASM/native decode first.
- HEVC and AV1 capable.
- Pthread performance build for heavy AV1 playback.
- Debuggable with native logs, debug snapshots, and Node/browser regression harnesses.

This build should not yet be presented as:

- Cross-browser stable.
- Mobile-ready.
- A polished consumer player.
- Fully automated across every browser playback edge case.

## Primary Playback Surface

Use `web/v3.html` as the release surface for this candidate.

The older demo surfaces still exist for now, but `web/v3.html` is the playback surface with the current controls, diagnostics, stream selection, subtitles, Range-backed `read_at`, and pthread-compatible serving path.

## Build Artifacts

The release artifacts are the default `full` variant with pthreads enabled:

```bash
FFMPEG_WASM_THREADS=4 ./scripts/build-ffmpeg.sh --release
FFMPEG_WASM_THREADS=4 ./scripts/prepare-demo-assets.sh --release
```

Output:

- `build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.js`
- `build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.wasm`
- `build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.worker.js`

The copied browser assets live in:

- `web/`
- `web-react/public/`

The pthread artifact uses:

- WASM SIMD enabled by default.
- 4 native decoder threads.
- 8 Emscripten pthread workers by default.
- `libdav1d` for AV1 software decoding.
- FFmpeg built-in AV1 decoder disabled for this WASM path.

## Serving Requirements

Pthread WASM requires `SharedArrayBuffer`, so the player must be served with COOP/COEP headers.

Use the project static server:

```bash
node scripts/serve-web.mjs --port 8080
```

Then open:

```text
http://127.0.0.1:8080/v3.html
```

Do not use Python's plain `http.server` for pthread assets.

## What Changed

- Added a real software AV1 path through `libdav1d`.
- Disabled the broken hardware-oriented built-in AV1 decoder path for WASM.
- Added SIMD release builds.
- Added a pthread performance build for 4K AV1.
- Split decoder thread count from Emscripten worker pool size.
- Added COOP/COEP local server support.
- Added native debug/log snapshot support.
- Added shared JS bindings for Node, workers, and export generation.
- Added HTTP Range-backed `read_at` for seekable URLs.
- Added v3 player controls, diagnostics, subtitles, tracks, audio-only handling, and better canvas states.
- Added regression/performance harnesses for codecs, seeking, Range IO, AudioWorklet behavior, and v3 features.

## Codec Snapshot

Tested with the `full` pthread build on this machine.

### Video

| Codec | Container | Status | Perf Snapshot |
|---|---|---:|---:|
| AV1 4K real sample | WebM | Works | 44.37 decode+RGBA fps |
| HEVC 1080 real sample | MKV | Works | 105.74 decode+RGBA fps |
| H.264 | MP4 | Works | 2697 decode+RGBA fps |
| HEVC | MP4 | Works | 1527 decode+RGBA fps |
| HEVC Main10 | MKV | Works | 820 decode+RGBA fps |
| AV1 | WebM | Works | 967 decode+RGBA fps |
| VP9 | WebM | Works | 909 decode+RGBA fps |
| VP8 | WebM | Works | 1675 decode+RGBA fps |
| MPEG-4 Part 2 | AVI | Works | 3208 decode+RGBA fps |
| MPEG-2 | TS | Works | 1955 decode+RGBA fps |
| Theora | OGG | Works | 3208 decode+RGBA fps |
| ProRes | MOV | Works | 796 decode+RGBA fps |
| WMV2 | AVI | Works | 2132 decode+RGBA fps |

Generated fixtures were small 640x360 clips, so those high fps values prove compatibility, not real playback stress. The important stress results are the real 4K AV1 and 1080p HEVC samples.

### Audio

| Codec | Container | Status | Perf Snapshot |
|---|---|---:|---:|
| AAC | M4A | Works | 433x realtime |
| MP3 | MP3 | Works | 379x realtime |
| Opus | OGG | Works | 364x realtime |
| Vorbis | OGG | Works | 238x realtime |
| FLAC | FLAC | Works | 429x realtime |
| AC3 | AC3 | Works | 815x realtime |
| EAC3 | EAC3 | Works | 695x realtime |
| PCM s16le | WAV | Works | 612x realtime |
| PCM s24le | WAV | Works | 610x realtime |
| PCM f32le | WAV | Works | 597x realtime |
| ALAC | M4A | Works | 326x realtime |
| DTS | DTS | Works | 443x realtime |

The wrapper outputs audio to 48 kHz stereo float32 for the browser worklet path.

## Verification

Commands run for this release candidate:

```bash
bash -n scripts/build-ffmpeg.sh scripts/prepare-demo-assets.sh
node --check scripts/serve-web.mjs
node --check scripts/test-playback-performance.mjs
node --check scripts/test-audio-codec-performance.mjs
npm --prefix web-react run build
node scripts/test-codec-regressions.mjs build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.js build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.wasm
node scripts/test-playback-performance.mjs "/home/nyanpasu/Desktop/videos/Terence Tao – How the world’s top mathematician uses AI [Q8Fkpi18QXU].webm" build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.js build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.wasm
```

Browser smoke:

- `web/v3.html` loaded with `crossOriginIsolated === true`.
- `SharedArrayBuffer` available.
- 1080p AV1 decoded and reported frames/resolution.
- 4K AV1 WebM decoded at `3840 x 2160`.
- 4K AV1 smoke with audio enabled reported advancing frames and an audio queue.

## Known Limits

- Chromium is the only release target for now.
- Pthread build requires COOP/COEP and `SharedArrayBuffer`.
- Browser regression automation is still thinner than the Node harness.
- Long-play smoothness still needs 5-10 minute soak tests.
- Track and subtitle switching need more real-world QA.
- Multiple app/demo surfaces still exist; `web/v3.html` is the current release surface.
- Generated codec fixtures prove codec compatibility, not production playback stress.
- Unsupported profiles should fail visibly, but the unsupported-profile matrix is not complete yet.

## Release Gates Before Stable

Track these in `checklist.md`:

- Browser pthread regression tests with frame-count assertions.
- Long-play smoothness soak.
- Seek while playing across AV1, HEVC, MKV, MP4, and HTTP Range.
- Audio sync checks across common codecs.
- Real subtitle and multi-track switching QA.
- Cleanup/replacement stress test.
- Unsupported codec/profile failure UX.

## Rollback

If the pthread build causes deployment issues, roll browser assets back to the single-threaded release build:

```bash
./scripts/build-ffmpeg.sh --release
./scripts/prepare-demo-assets.sh --release
```

This keeps broad codec compatibility but 4K AV1 may fall below realtime.
