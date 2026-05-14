# FFmpeg WASM HEVC

Goal: build FFmpeg to WebAssembly for HEVC/AV1 playback in Chromium.

Support development: [Ko-fi](https://ko-fi.com/nyanpassu)

Status: buildable. Includes a custom AVIO decode API for streaming, a software AV1 path through dav1d, SIMD release builds, and an optional pthread WASM build for high-resolution AV1 playback. Release builds reserve an 8 MB C stack so decoder-heavy AV1 paths do not overflow the default WASM stack. FFmpeg is configured as a playback-only build: no CLI programs, network, devices, filters, encoders, muxers, iconv, or runtime CPU detection; the only enabled bitstream filter is the VP9 superframe splitter needed for WebM/Matroska playback.

## Project layout
- `scripts/` build tooling
- `web/` HTML demo UI
- `web-react/` React demo UI (Vite)
- `third_party/` emsdk + FFmpeg sources
- `build/` build outputs (ignored)

## Quick start (later)
1. `./scripts/bootstrap-emsdk.sh`
2. `./scripts/build-ffmpeg.sh` (defaults to LGPL)
3. Output: `build/ffmpeg-wasm/ffmpeg_wasm.js` + `build/ffmpeg-wasm/ffmpeg_wasm.wasm`
4. For 4K AV1 playback: `FFMPEG_WASM_THREADS=4 ./scripts/build-ffmpeg.sh --release`
5. For browser diagnostics: `./scripts/build-ffmpeg.sh --debug` then `./scripts/prepare-demo-assets.sh --debug`

## Build variants (license + patent risk)
- `royaltyfree` / `royaltyfree-lgpl`: AV1 via dav1d, VP9/VP8, Opus/Vorbis/FLAC, and other royalty-free playback codecs. LGPL-friendly, avoids patent-encumbered codecs. Output: `build/ffmpeg-wasm-royaltyfree/`.
- `full` (default): HEVC + AV1 via dav1d with common extras, LGPL-friendly but patent-encumbered. Output: `build/ffmpeg-wasm/`.
- `gpl`: HEVC + AV1 via dav1d with common extras, GPL build (open-source required), patent-encumbered. Output: `build/ffmpeg-wasm-gpl/`.
- `gpl-royaltyfree` / `royaltyfree-gpl`: royalty-free codec set with GPL obligations. Output: `build/ffmpeg-wasm-gpl-royaltyfree/`.
- `nonfree`: non-redistributable build. Unsafe to ship publicly or monetize. Output: `build/ffmpeg-wasm-nonfree/`.

Each build emits `ffmpeg-components.json` and fails if generated FFmpeg config
contains unexpected playback components or any encoder/muxer support.

Build commands:
- `./scripts/build-ffmpeg.sh --variant royaltyfree` (or `royaltyfree-lgpl`)
- `./scripts/build-ffmpeg.sh --variant full`
- `./scripts/build-ffmpeg.sh --variant gpl`
- `./scripts/build-ffmpeg.sh --variant gpl-royaltyfree` (or `royaltyfree-gpl`)
- `./scripts/build-ffmpeg.sh --variant nonfree`
- `FFMPEG_WASM_THREADS=4 ./scripts/build-ffmpeg.sh --release` for a pthread build at `build/ffmpeg-wasm-pthreads4/`. This sets 4 native decoder threads and defaults the Emscripten browser worker pool to 8 workers; override with `FFMPEG_WASM_THREAD_POOL=N` only when investigating pthread scheduling.

## Demos
Before running a demo, copy the WASM artifacts into the demo folders:
`./scripts/prepare-demo-assets.sh` (or `--variant royaltyfree|full|gpl|nonfree`)

For the pthread build, copy with the same thread count:
`FFMPEG_WASM_THREADS=4 ./scripts/prepare-demo-assets.sh --release`

Use release assets for normal playback and performance checks. Debug assets include source maps and assertions and can make 1080p HEVC/AV1 playback look choppy.

HTML demo:
- Serve `web/` with COOP/COEP headers when using pthread assets.
- Example: `node scripts/serve-web.mjs --port 8080`
- Includes Matroska-first UI, audio worklet playback, and optional WebGL rendering.

React demo:
- `cd web-react`
- `npm install`
- `npm run dev`
- Vite is configured with COOP/COEP headers so pthread WASM assets can use `SharedArrayBuffer`.

## Node Harness
Use `scripts/ffmpeg-wasm-node.mjs` to mirror wasm exports outside the browser.

Commands:
- `node scripts/ffmpeg-wasm-node.mjs list-exports`
- `node scripts/ffmpeg-wasm-node.mjs smoke /path/to/video.mkv 60`
- `node scripts/test-seek-internals.mjs /path/to/video.mkv [--build-dir build/ffmpeg-wasm-pthreads4]` (builds a test wasm against the selected FFmpeg build directory and validates internal seek behavior)
- `node scripts/test-core-features.mjs /path/to/video.mkv [wasm_js] [wasm_wasm]` (runs core decode/selection/seek checks)
- `node scripts/test-codec-regressions.mjs [wasm_js] [wasm_wasm]` (runs local HEVC read_at/seek, AV1 dav1d stack, source-FPS cadence, and native real-time throughput regressions; override fixtures with `FFMPEG_WASM_HEVC_SAMPLE` and `FFMPEG_WASM_AV1_SAMPLE`)
- `node scripts/test-playback-performance.mjs /path/to/video.webm [wasm_js] [wasm_wasm]` (measures source FPS cadence, decode-only throughput, and decode+RGBA throughput against real-time)
- `node scripts/test-http-range-read-at.mjs` (serves a late-moov MP4 through HTTP Range and validates native `read_at` open/seek)
- `node scripts/test-audio-worklet-buffer.mjs` (checks AudioWorklet queue/drop/underrun behavior)
- `node scripts/test-v3-regressions.mjs [wasm_js] [wasm_wasm]` (generates late-moov MP4, audio-only, multi-track, and subtitle fixtures)
- `node scripts/test-mkv-regressions.mjs [--vectors-dir /tmp/ffmpeg-mkv-vectors] [--ordered-chapters /path/to/ordered.mkv]` (generates and validates no-cues/sparse-cues vectors; optionally validates ordered-chapters)

The Node harness, worker, and Emscripten export list share `web/ffmpeg-wasm-api.js`.

## Browser FATE Runner
FFmpeg's upstream FATE suite is shell/make based, so the browser mapping uses the
FATE case metadata and sample corpus, then runs browser-native wasm checks:
metadata open, decode/RGBA conversion, and duration-relative seek checks.

Generate the manifest from the vendored FFmpeg tree:

```bash
node scripts/build-browser-fate-manifest.mjs
```

Sync a targeted sample set instead of the full FATE corpus:

```bash
node scripts/sync-browser-fate-samples.mjs --tag browser-smoke --samples /tmp/fate-suite
node scripts/sync-browser-fate-samples.mjs --tag av1 --samples /tmp/fate-suite
node scripts/sync-browser-fate-samples.mjs --tag hevc --samples /tmp/fate-suite
```

Serve the browser runner:

```bash
node scripts/serve-browser-fate.mjs --samples /tmp/fate-suite --port 8090
```

Open `http://127.0.0.1:8090/fate-browser.html`. The runner defaults to
`browser-smoke` and has explicit AV1 and HEVC tag filters.

As a module:
```js
import { loadWasmNode } from "./scripts/ffmpeg-wasm-node.mjs";

const wasm = await loadWasmNode();
const ctx = wasm.api.create(0);
wasm.openLocalFile(ctx, "/path/to/video.mkv"); // uses ffmpegReadAt random-access path
console.log("duration", wasm.api.duration(ctx));
wasm.clearReadAtFile();
wasm.api.destroy(ctx);
```

## Recipe
See `docs/RECIPE.md` for a step-by-step build narrative, decision rationale, and alternatives considered.

## Custom AVIO decode API
This build exposes a small API to push bytes from JS into FFmpeg and decode frames.

IO modes:
- `append` (default): push incoming chunks with `ffmpeg_wasm_append`. This is progressive-only and seeking is disabled.
- `read_at` (local files and HTTP Range-capable URLs): set `ffmpeg_wasm_set_io_mode(..., 1)` and provide `Module.ffmpegReadAt(offset, len, dstPtr)` for native demuxer seeking.

Flow:
1. Create context with a buffer size.
2. Append bytes as they arrive.
3. Call `ffmpeg_wasm_open` after you have header data.
4. Call `ffmpeg_wasm_read_frame` in a loop.
   - `1` = video frame ready
   - `2` = audio frame ready
   - `0` = need more data
   - `-1` = end of stream
5. Read video data or convert to RGBA with `ffmpeg_wasm_frame_to_rgba`.
6. For audio, read interleaved float32 stereo at 48 kHz via the audio getters.

Notes:
- For MP4 append streaming, the `moov` atom should be at the start (faststart), or probing may fail. Local files and Range-capable URLs use `read_at`, so late `moov` metadata is available.
- The buffer grows as you append; for long streams, segment or reset between items.
- Frame pointers are valid until the next decode call.

Minimal JS sketch:
```js
const Module = await FFmpegWasm();
const create = Module.cwrap("ffmpeg_wasm_create", "number", ["number"]);
const append = Module.cwrap("ffmpeg_wasm_append", "number", ["number", "number", "number"]);
const open = Module.cwrap("ffmpeg_wasm_open", "number", ["number", "string"]);
const read = Module.cwrap("ffmpeg_wasm_read_frame", "number", ["number"]);
const toRgba = Module.cwrap("ffmpeg_wasm_frame_to_rgba", "number", ["number"]);
const rgbaPtr = Module.cwrap("ffmpeg_wasm_rgba_ptr", "number", ["number"]);
const rgbaStride = Module.cwrap("ffmpeg_wasm_rgba_stride", "number", ["number"]);

const ctx = create(4 * 1024 * 1024);
// append(...) with incoming chunks, then:
open(ctx, "mov");
while (true) {
  const state = read(ctx);
  if (state === 1) {
    toRgba(ctx);
    const ptr = rgbaPtr(ctx);
    const stride = rgbaStride(ctx);
    // Read RGBA data from HEAPU8 using ptr/stride.
  } else if (state === 2) {
    // Audio available via ffmpeg_wasm_audio_*.
  } else if (state === 0) {
    break; // need more data
  } else {
    break; // EOF or error
  }
}
```

## Notes
- HEVC licensing/patents apply; verify your use case. The `royaltyfree` variant avoids HEVC.
- AV1 uses dav1d software decoding. FFmpeg's built-in AV1 decoder is not used because the WASM build has no hardware acceleration path.
- Chromium-only target for now. Single-threaded builds do not need COOP/COEP; pthread builds require `SharedArrayBuffer` and COOP/COEP headers.
- Browser-native debugging workflow: see `docs/DEBUGGING.md`.
