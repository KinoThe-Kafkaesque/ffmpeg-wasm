# Browser Debugging

This project now has a separate debug build path and a native-to-browser debug channel.

## Build A Debug WASM

```bash
./scripts/build-ffmpeg.sh --debug
./scripts/prepare-demo-assets.sh --debug
```

The debug build writes to `build/ffmpeg-wasm-debug/` for the default `full` variant. Other variants append `-debug` to their normal output directory. `prepare-demo-assets.sh --debug` also copies `ffmpeg_wasm.wasm.map` beside the demo WASM so Chromium can resolve the source map.

Do not use debug assets for playback quality checks. They are intentionally slower; switch the demo back with `./scripts/prepare-demo-assets.sh --release` before testing 1080p HEVC, AV1, audio sync, or dropped-frame behavior.

For 4K AV1 performance checks, use the pthread release build instead of the single-threaded artifact:

```bash
FFMPEG_WASM_THREADS=4 ./scripts/build-ffmpeg.sh --release
FFMPEG_WASM_THREADS=4 ./scripts/prepare-demo-assets.sh --release
node scripts/serve-web.mjs --port 8080
```

Pthread browser builds require `SharedArrayBuffer` and COOP/COEP headers; `scripts/serve-web.mjs` provides those headers for `web/v3.html`. A 4-thread decoder build defaults to an 8-worker Emscripten pthread pool. If the browser opens a file but remains at `Playing` with `0` frames, verify that the copied `ffmpeg_wasm.js` contains the larger `pthreadPoolSize` and that `ffmpeg_wasm.worker.js` is served with the same COOP/COEP headers.

Debug mode uses:

- `-Og`
- `-gsource-map`
- `-s ASSERTIONS=2`
- `--profiling-funcs`
- `-DFFMPEG_WASM_DEBUG=1`

Optional heap checks:

```bash
FFMPEG_WASM_SAFE_HEAP=1 ./scripts/build-ffmpeg.sh --debug
```

## Browser Visibility

The React demo listens for these worker/native message types:

- `ffmpegLog`: FFmpeg `av_log` output forwarded by `av_log_set_callback`
- `subtitleLog`: subtitle chunks accepted by libass
- `subtitleDebug`: subtitle render misses
- `debugSnapshot`: native decoder state plus worker state
- `error`: worker-level errors

The debug panel shows IO mode, byte positions, selected streams, packet/video/audio PTS, subtitle counts, heap size, last error, and recent seeks. Change the FFmpeg log level from the panel when you need more native output.

## Native Snapshot

The native snapshot is exposed as:

```js
api.debugSnapshot(ctx) // JSON string
```

It is backed by `ffmpeg_wasm_debug_snapshot()` and is intended for UI polling every 250-500 ms while playback is active.

## Source Maps

For C source visibility in Chromium DevTools:

1. Build with `./scripts/build-ffmpeg.sh --debug`.
2. Serve the demo over HTTP, not `file://`.
3. Open DevTools, then check Sources for the generated WASM source map.
4. Use the debug panel and logs first. C stepping is useful, but structured snapshots are usually faster for playback state bugs.

## Node First

Before debugging browser timing, prove the native behavior in Node:

```bash
node scripts/test-core-features.mjs /path/to/video.mkv
node scripts/test-codec-regressions.mjs
node scripts/test-playback-performance.mjs /path/to/video.webm
node scripts/test-seek-internals.mjs /path/to/video.mkv
node scripts/test-v3-regressions.mjs build/ffmpeg-wasm-debug/ffmpeg_wasm.js build/ffmpeg-wasm-debug/ffmpeg_wasm.wasm
```

The Node harness and browser worker both bind through `web/ffmpeg-wasm-api.js`, so an export added there is available to both surfaces.

`test-codec-regressions.mjs` auto-detects local AV1/HEVC samples under `/home/nyanpasu/Desktop/animus`. It uses `ffprobe` frame-rate metadata when available, checks decoded PTS cadence against that FPS, and asserts native decode throughput is at least real-time. Set `FFMPEG_WASM_AV1_SAMPLE`, `FFMPEG_WASM_HEVC_SAMPLE`, or `FFMPEG_WASM_SAMPLE_ROOT` when testing another machine or fixture folder. Use `FFMPEG_WASM_FPS_TOLERANCE`, `FFMPEG_WASM_REALTIME_HEADROOM`, or `FFMPEG_WASM_REQUIRE_REALTIME=0` only for explicit perf experiments.

`test-playback-performance.mjs` is the generic perf gate for a named file. It runs two passes: decode-only and decode+RGBA conversion. The second pass is closer to browser canvas playback cost. Use `FFMPEG_WASM_PERF_REPORT_ONLY=1` when you want measurements without failing the command.

For the 4K AV1 Terence Tao WebM fixture, the single-threaded SIMD build reports correct 23.976 PTS cadence but remains below real-time. The pthread build passes:

```bash
node scripts/test-playback-performance.mjs "/home/nyanpasu/Desktop/videos/Terence Tao – How the world’s top mathematician uses AI [Q8Fkpi18QXU].webm" build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.js build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.wasm
```

Latest local result with `FFMPEG_WASM_THREADS=4` and the default 8-worker pthread pool: 3840x2160 AV1, source FPS `24000/1001`, decode-only ~44.4 fps, decode+RGBA ~43.7 fps, decoded PTS cadence ~23.977 fps, no monotonic violations, no large frame gaps. Headed browser smoke through `web/v3.html` decoded the same file at 3840x2160 with audio enabled and reported 832 frames plus a 0.60s audio queue after the smoke window.

## Codec Failures

If AV1 logs include `Your platform doesn't support hardware accelerated AV1 decoding` followed by `Function not implemented`, the build is using FFmpeg's built-in AV1 decoder instead of the dav1d software decoder. Rebuild a current variant with `./scripts/build-ffmpeg.sh --release`; the configure output should include `--enable-libdav1d` and the decoder list should use `libdav1d`.

If AV1 opens and decodes the first frame, then crashes with a raw WASM `memory access out of bounds`, check the C stack size. Current builds pass `-s STACK_SIZE=8MB`; older/default-stack artifacts can overflow on 10-bit 1080p dav1d decode.
