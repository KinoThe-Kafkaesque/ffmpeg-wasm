# FFmpeg WASM HEVC

Goal: build FFmpeg to WebAssembly for HEVC playback in Chromium. Single-threaded proof first.

Status: buildable. Includes a custom AVIO decode API for streaming.

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

## Build variants (license + patent risk)
- `royaltyfree` / `royaltyfree-lgpl`: AV1/VP9/Opus only, LGPL-friendly, avoids patent-encumbered codecs. Output: `build/ffmpeg-wasm-royaltyfree/`.
- `full` (default): HEVC + AV1 with common extras, LGPL-friendly but patent-encumbered. Output: `build/ffmpeg-wasm/`.
- `gpl`: HEVC + AV1 with common extras, GPL build (open-source required), patent-encumbered. Output: `build/ffmpeg-wasm-gpl/`.
- `gpl-royaltyfree` / `royaltyfree-gpl`: royalty-free codec set with GPL obligations. Output: `build/ffmpeg-wasm-gpl-royaltyfree/`.
- `nonfree`: non-redistributable build. Unsafe to ship publicly or monetize. Output: `build/ffmpeg-wasm-nonfree/`.

Build commands:
- `./scripts/build-ffmpeg.sh --variant royaltyfree` (or `royaltyfree-lgpl`)
- `./scripts/build-ffmpeg.sh --variant full`
- `./scripts/build-ffmpeg.sh --variant gpl`
- `./scripts/build-ffmpeg.sh --variant gpl-royaltyfree` (or `royaltyfree-gpl`)
- `./scripts/build-ffmpeg.sh --variant nonfree`

## Demos
Before running a demo, copy the WASM artifacts into the demo folders:
`./scripts/prepare-demo-assets.sh` (or `--variant royaltyfree|full|gpl|nonfree`)

HTML demo:
- Serve `web/` with a static server (file:// will not load WASM).
- Example: `python3 -m http.server --directory web 8080`
- Includes Matroska-first UI, audio worklet playback, and optional WebGL rendering.

React demo:
- `cd web-react`
- `npm install`
- `npm run dev`

## Recipe
See `docs/RECIPE.md` for a step-by-step build narrative, decision rationale, and alternatives considered.

## Custom AVIO decode API
This build exposes a small API to push bytes from JS into FFmpeg and decode frames.

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
- For MP4 streaming, the `moov` atom should be at the start (faststart), or probing may fail.
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
- Chromium-only target for now; no COOP/COEP required since we're single-threaded.
