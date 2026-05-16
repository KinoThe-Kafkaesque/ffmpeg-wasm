# Debug Workflow

This file is the consolidated debug runbook for the FFmpeg WASM player. Use it when native playback behavior is unclear, browser logs are missing, seeking acts wrong, or audio/video/subtitle state needs to be inspected while a file is playing.

## Fast Path

Build and copy a debug WASM into the browser demos:

```bash
./scripts/build-ffmpeg.sh --debug
./scripts/prepare-demo-assets.sh --debug
```

Run the React demo:

```bash
cd web-react
npm run dev
```

Before chasing browser timing, prove native behavior in Node:

```bash
node scripts/test-core-features.mjs /path/to/video.mkv
node scripts/test-seek-internals.mjs /path/to/video.mkv --build-dir build/ffmpeg-wasm-pthreads4
node scripts/test-v3-regressions.mjs build/ffmpeg-wasm-debug/ffmpeg_wasm.js build/ffmpeg-wasm-debug/ffmpeg_wasm.wasm
```

## Debug Build

Debug builds are separate from release builds. The default release build stays optimized with `-O3` and writes to `build/ffmpeg-wasm/`. The default debug build writes to `build/ffmpeg-wasm-debug/`.

Debug mode enables:

- `-Og`
- `-gsource-map`
- `-s ASSERTIONS=2`
- `--profiling-funcs`
- `-DFFMPEG_WASM_DEBUG=1`
- FFmpeg `--enable-debug=3`
- FFmpeg `--disable-optimizations`

Optional heap checks:

```bash
FFMPEG_WASM_SAFE_HEAP=1 ./scripts/build-ffmpeg.sh --debug
```

Variant debug builds append `-debug` to their normal output directory:

```bash
./scripts/build-ffmpeg.sh --debug --variant royaltyfree
./scripts/prepare-demo-assets.sh --debug --variant royaltyfree
```

## Switching Browser Assets

The browser demos load copied artifacts from `web/` and `web-react/public/`.

Use debug artifacts:

```bash
./scripts/prepare-demo-assets.sh --debug
```

Use release artifacts:

```bash
./scripts/prepare-demo-assets.sh --release
```

Debug asset copy includes `ffmpeg_wasm.wasm.map` so Chromium can resolve C source maps. Release asset copy removes stale source maps when no map exists.

## Native Log Bridge

Native logs are wired through FFmpeg's log callback:

- C entry: `av_log_set_callback`
- Export: `ffmpeg_wasm_set_log_level(level)`
- Worker message: `ffmpegLog`
- React display: visible log stream

The worker defaults to FFmpeg warning level:

```text
AV_LOG_WARNING = 24
```

Useful levels:

```text
8   panic
16  error
24  warning
32  info
40  verbose
48  debug
56  trace
```

In the React demo, change the log level from the Debug panel. The UI sends:

```js
worker.postMessage({ type: "setLogLevel", level });
```

The worker calls:

```js
api.setLogLevel(level);
```

## Debug Message Types

The React app should surface these worker/native message types in one visible log stream:

- `ffmpegLog`: FFmpeg `av_log` output from native code
- `subtitleLog`: subtitle text/ASS chunks accepted by native subtitle handling
- `subtitleDebug`: subtitle render misses or suspicious subtitle render state
- `debugSnapshot`: native decoder state plus worker state
- `error`: worker-level errors and native return-code context

If useful output appears in DevTools but not in the UI, check the worker `postMessage` path first, then `web-react/src/App.jsx` message handling.

## Native Snapshot

Native snapshot export:

```c
ffmpeg_wasm_debug_snapshot(uintptr_t handle)
```

Shared JS API binding:

```js
api.debugSnapshot(ctx) // returns JSON string
```

The worker polls this while playback is active, roughly every 250-500 ms, then posts `debugSnapshot`.

The native snapshot includes:

- `valid`
- `ioMode`
- `opened`
- `bytePos`
- `avioPos`
- `avioSeekable`
- `bufferOffset`
- `bufferReadPos`
- `bufferedBytes`
- `fileSize`
- `raCacheStart`
- `raCacheSize`
- `videoStream`
- `audioStream`
- `subtitleStream`
- `lastPacketStream`
- `lastPacketPts`
- `videoPts`
- `audioPts`
- `audioSamples`
- `audioBytes`
- `subtitleEvents`
- `packetsRead`
- `subtitlePacketsRead`
- `lastError`

The worker snapshot adds:

- `opened`
- `playing`
- `waiting`
- `streamRunning`
- `draining`
- `seeking`
- `seekTarget`
- `seekEnabled`
- `seekSlow`
- `ioMode`
- `currentTime`
- `duration`
- `frames`
- `bytes`
- `heapBytes`
- `lastDecodeResult`
- `lastOpenError`
- `lastError`
- `lastErrorText`
- `recentSeeks`
- `audioClock`
- `audioDrift`
- `audioBufferedSeconds`
- `skippedVideoFrames`

## Audio Sync Architecture

The browser audio path has four layers:

- Seekable local files and HTTP Range URLs use two native FFmpeg contexts in the worker: the main context renders video/subtitles, and a separate audio-only context decodes audio from the same `read_at` source. Append-stream sources keep the single-context path because they cannot safely rewind two demuxers.
- The worker seeks both native contexts together, throttles the audio context from UI buffer feedback, and falls back to main-context audio if the separate audio decoder fails.
- The UI thread keeps an audio jitter boundary before the AudioWorklet. It tracks queued PTS, queued end PTS, worklet buffered seconds, trim count, underruns, and the estimated audible media clock.
- The AudioWorklet owns the real ring buffer. It supports `push`, `clear`, and `trim` messages and reports buffered seconds, dropped samples, trimmed samples, underruns, and capacity.

Clock recovery uses audio as the master when audio exists:

1. The UI estimates audible media time as `lastQueuedEndPts - bufferedSeconds + audioDelay`.
2. If video is ahead and audio has buffered latency, the UI asks the worklet to trim enough buffered frames to catch up.
3. The UI posts `audioClock` feedback to the worker about every 200 ms.
4. If the worker sees a video frame older than the predicted audio clock, it skips rendering that stale frame and continues decoding toward the audible clock.

The debug snapshot exposes `separateAudio`, `audioCtx`, `audioCtxStreamIndex`, and `lastAudioDecodeResult` so native audio-context behavior is visible beside the main decoder state.

## Debug Panel

The React Debug panel shows:

- IO mode
- native byte position
- AVIO position
- AVIO seekability
- buffered bytes
- selected video/audio/subtitle streams
- last packet stream
- packet PTS
- video PTS
- audio PTS
- audio samples
- pending audio queue depth
- buffered audio seconds
- subtitle event count
- packet count
- heap size
- last error text
- recent seek events

Use this panel before stepping C code. For playback bugs, the snapshot usually answers whether the issue is native decode state, worker scheduling, audio queueing, or UI state.

## Source Maps In Chromium

To inspect C code in Chromium DevTools:

1. Build debug:

   ```bash
   ./scripts/build-ffmpeg.sh --debug
   ./scripts/prepare-demo-assets.sh --debug
   ```

2. Serve the demo over HTTP, not `file://`.

   ```bash
   cd web-react
   npm run dev
   ```

3. Open DevTools.

4. Check `Sources` for mapped files from `src/`, especially:

   - `src/ffmpeg_wasm.c`
   - `src/ffmpeg_wasm_debug.c`
   - `src/ffmpeg_wasm_internal.h`

5. Use `ffmpegLog`, `debugSnapshot`, and the Debug panel to decide where to put breakpoints.

## Node-First Native Debugging

Use Node when the question is about C behavior, FFmpeg return codes, seeking, stream selection, or packet/frame PTS. Browser debugging should come after the native path is proven.

List exported functions:

```bash
node scripts/ffmpeg-wasm-node.mjs list-exports
```

Basic smoke:

```bash
node scripts/ffmpeg-wasm-node.mjs smoke /path/to/video.mkv 60
```

Core feature harness:

```bash
node scripts/test-core-features.mjs /path/to/video.mkv
```

Seek internals harness:

```bash
node scripts/test-seek-internals.mjs /path/to/video.mkv --build-dir build/ffmpeg-wasm-pthreads4
```

Direct debug snapshot check:

```bash
node --input-type=module -e '
import { loadWasmNode } from "./scripts/ffmpeg-wasm-node.mjs";
const wasm = await loadWasmNode({
  wasmJsPath: "build/ffmpeg-wasm-debug/ffmpeg_wasm.js",
  wasmPath: "build/ffmpeg-wasm-debug/ffmpeg_wasm.wasm"
});
const ctx = wasm.api.create(0);
console.log(wasm.api.debugSnapshot(ctx));
wasm.api.destroy(ctx);
'
```

Direct local-file open/read smoke:

```bash
node --input-type=module -e '
import { loadWasmNode } from "./scripts/ffmpeg-wasm-node.mjs";
const wasm = await loadWasmNode({
  wasmJsPath: "build/ffmpeg-wasm/ffmpeg_wasm.js",
  wasmPath: "build/ffmpeg-wasm/ffmpeg_wasm.wasm"
});
const ctx = wasm.api.create(0);
console.log(wasm.openLocalFile(ctx, "/path/to/video.mkv"));
console.log("duration", wasm.api.duration(ctx));
console.log("frame", wasm.readNextVideoFrame(ctx, 2000));
console.log(wasm.api.debugSnapshot(ctx));
wasm.clearReadAtFile();
wasm.api.destroy(ctx);
'
```

## Seeking Debug Rules

There are two IO modes:

- `append`: progressive chunks pushed with `ffmpeg_wasm_append`
- `read_at`: random-access local-file reads or HTTP Range reads through `Module.ffmpegReadAt`

Current behavior:

- Append mode is progressive-only.
- Append mode seeking is disabled.
- Local `read_at` mode is the primary seekable path.
- HTTP Range-capable URLs use the same `read_at` path after the worker verifies `206 Partial Content` and an exposed `Content-Range` size.
- `ffmpeg_wasm_prepare_restream` is deprecated and returns unsupported.

When a seek fails, check:

- `debugSnapshot.native.ioMode`
- `debugSnapshot.worker.seekEnabled`
- `debugSnapshot.worker.seekSlow`
- `debugSnapshot.worker.recentSeeks`
- `debugSnapshot.native.avioSeekable`
- `debugSnapshot.native.avioPos`
- `debugSnapshot.native.lastError`
- worker log line with `lastErrorText`

Expected append seek failure is not a regression:

```text
append seek ret < 0
```

Expected random-access backward seek:

```text
seek ret = 0
next video frame PTS is near the requested target
```

## Error Strings

Native error string export:

```c
ffmpeg_wasm_error_string(int error_code)
```

Shared JS API binding:

```js
api.errorString(errorCode)
```

Use this for negative FFmpeg return codes in worker errors, seek failures, open failures, and decode failures.

## API Binding Dedupe

Exports are declared once in:

```text
web/ffmpeg-wasm-api.js
```

The same manifest is used by:

- browser worker
- Node harness
- Emscripten export printer

Generated export list:

```bash
node scripts/print-exported-functions.mjs
```

Include test-only exports:

```bash
node scripts/print-exported-functions.mjs --include-test-only
```

When adding a debug export, update `web/ffmpeg-wasm-api.js` first, then rebuild.

## Native Debug Files

Core native files:

- `src/ffmpeg_wasm.c`: playback, decode, IO, stream, subtitle, seek logic
- `src/ffmpeg_wasm_internal.h`: shared context declarations and debug helper prototypes
- `src/ffmpeg_wasm_debug.c`: log bridge, error strings, native snapshot export, subtitle debug post helpers

Current debug exports:

- `ffmpeg_wasm_set_log_level`
- `ffmpeg_wasm_error_string`
- `ffmpeg_wasm_debug_snapshot`

Test-only debug exports:

- `ffmpeg_wasm_debug_seek_stream`
- `ffmpeg_wasm_debug_buffer_offset`
- `ffmpeg_wasm_debug_buffer_size`
- `ffmpeg_wasm_debug_buffer_read_pos`
- `ffmpeg_wasm_debug_byte_pos`

## Browser Worker Debug Files

Worker files:

- `web/ffmpeg-worker.js`
- `web-react/public/ffmpeg-worker.js`

The public React worker copy should match `web/ffmpeg-worker.js`.

The worker owns:

- loading WASM
- binding shared API exports
- forwarding native logs
- polling debug snapshots
- reading local files with `read_at`
- reading HTTP Range-capable URLs with `read_at`
- enforcing append-mode seeking disabled
- tracking recent seeks
- adding native error text to failures

## React Debug Files

React files:

- `web-react/src/App.jsx`
- `web-react/src/App.css`

The React UI owns:

- log stream display
- handling `ffmpegLog`
- handling `subtitleLog`
- handling `subtitleDebug`
- handling `debugSnapshot`
- handling `error`
- Debug panel rendering
- log-level selector
- recent seek display

## Asset Sync Checks

After changing worker/API/demo artifacts:

```bash
node -e '
const fs = require("fs");
const pairs = [
  ["web/audio-worklet.js", "web-react/public/audio-worklet.js"],
  ["web/ffmpeg-worker.js", "web-react/public/ffmpeg-worker.js"],
  ["web/ffmpeg-wasm-api.js", "web-react/public/ffmpeg-wasm-api.js"],
  ["web/ffmpeg_wasm.js", "web-react/public/ffmpeg_wasm.js"],
  ["web/ffmpeg_wasm.wasm", "web-react/public/ffmpeg_wasm.wasm"],
  ["web/Inter-Regular.ttf", "web-react/public/Inter-Regular.ttf"]
];
let failed = false;
for (const [a, b] of pairs) {
  if (!fs.readFileSync(a).equals(fs.readFileSync(b))) {
    console.error(`${a} != ${b}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("asset sync OK");
'
```

For debug assets, also compare:

```text
web/ffmpeg_wasm.wasm.map
web-react/public/ffmpeg_wasm.wasm.map
```

## Verification Checklist

After debug-related edits, run:

```bash
bash -n scripts/build-ffmpeg.sh scripts/prepare-demo-assets.sh
node --check scripts/ffmpeg-wasm-node.mjs
node --check scripts/test-http-range-read-at.mjs
node --check scripts/test-audio-worklet-buffer.mjs
node --check web/ffmpeg-worker.js
node --check web/ffmpeg-wasm-api.js
cd web-react && npm run lint && npm run build
```

Native syntax check:

```bash
EMSDK_QUIET=1 source third_party/emsdk/emsdk_env.sh >/dev/null
emcc -fsyntax-only \
  -DFFMPEG_WASM_TESTING=1 \
  -Ibuild/ffmpeg-wasm/include \
  -Ibuild/ffmpeg-wasm/include/freetype2 \
  -Ibuild/ffmpeg-wasm/include/fribidi \
  -Ibuild/ffmpeg-wasm/include/ass \
  src/ffmpeg_wasm.c \
  src/ffmpeg_wasm_debug.c
```

Release build:

```bash
./scripts/build-ffmpeg.sh --release
```

Debug build:

```bash
./scripts/build-ffmpeg.sh --debug
./scripts/prepare-demo-assets.sh --debug
```

Seek regression:

```bash
node scripts/test-seek-internals.mjs /path/to/video.mkv
```

V3 generated-fixture regression:

```bash
node scripts/test-http-range-read-at.mjs
node scripts/test-audio-worklet-buffer.mjs
node scripts/test-v3-regressions.mjs build/ffmpeg-wasm/ffmpeg_wasm.js build/ffmpeg-wasm/ffmpeg_wasm.wasm
node scripts/test-v3-regressions.mjs build/ffmpeg-wasm-debug/ffmpeg_wasm.js build/ffmpeg-wasm-debug/ffmpeg_wasm.wasm
```

This covers HTTP Range-backed `read_at`, AudioWorklet overflow/underrun accounting, late-moov MP4 duration/seek, MP3/FLAC/OGG audio-only decode, AAC multi-track selection, and ASS subtitle render/font injection.

Whitespace check:

```bash
git diff --check
```

## Troubleshooting Map

Use this order when debugging playback:

1. Reproduce in Node if possible.
2. Check native return code and `api.errorString(ret)`.
3. Check `debugSnapshot.native.lastError`.
4. Check IO mode and seekability.
5. Check packet/video/audio PTS progression.
6. Check worker state: playing, waiting, draining, seeking.
7. Check audio queue depth and buffered seconds.
8. Check dropped frames/audio samples in UI state.
9. Move to browser DevTools and C source maps only after the above points to a native path.

Common signs:

- `ioMode = 0`: append mode; no real seeking.
- `ioMode = 1`: random-access mode; seek should be available.
- `avioSeekable = 0`: FFmpeg sees the IO as non-seekable.
- `lastPacketPts` moves but `videoPts` does not: decode/conversion/render path issue.
- `videoPts` moves but canvas does not: UI render path issue.
- `audioSamples` moves but audio stutters: AudioWorklet queue/scheduling issue.
- `audioBufferedSeconds` near zero: underrun risk.
- `subtitleEvents = 0`: subtitle extraction/track selection issue.
