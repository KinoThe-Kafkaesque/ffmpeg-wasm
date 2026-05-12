# FFmpeg WASM HEVC/AV1 Build + Demo Recipe

This is a chronological record of the steps taken, plus the reasoning and alternatives behind the technical decisions.

## Steps Taken
1. Created the base project folders: `scripts/`, `web/`, `docs/`, `third_party/`, `build/`.
2. Added `.gitignore` to exclude emsdk caches, build outputs, and Node artifacts.
3. Added `README.md` with goal, layout, and initial notes.
4. Added `scripts/bootstrap-emsdk.sh` to clone/activate emsdk 3.1.50.
5. Added `scripts/build-ffmpeg.sh` to configure and build FFmpeg for wasm (single-threaded by default, no programs).
6. Added initial `web/` scaffold with HTML/CSS/JS placeholders.
7. Added `src/ffmpeg_wasm.c` with minimal exports and a wasm link step in `scripts/build-ffmpeg.sh`.
8. Ran `./scripts/bootstrap-emsdk.sh` to install the toolchain locally.
9. Ran `./scripts/build-ffmpeg.sh` to produce the first wasm artifacts.
10. Added `ffmpeg_wasm_has_hevc_av1()` and enabled HEVC plus initial AV1 decoders/parsers in `scripts/build-ffmpeg.sh`.
11. Fixed wasm link errors by linking `-lswresample` and `-lswscale`.
12. Implemented a custom AVIO streaming decode API in `src/ffmpeg_wasm.c`.
13. Exported the new API functions and enabled `-s ALLOW_MEMORY_GROWTH=1` in `scripts/build-ffmpeg.sh`.
14. Updated `README.md` with the custom AVIO API usage notes.
15. Cleaned up const correctness in `src/ffmpeg_wasm.c` and rebuilt.
16. Reset `buffer.read_pos` in decoder reset to allow reopen after failed probes.
17. Rebuilt wasm to ensure the custom AVIO API is present.
18. Replaced `web/` with a working HTML demo that streams bytes and renders to canvas.
19. Scaffolded a React demo using Vite in `web-react/`.
20. Implemented a React version of the player in `web-react/src/App.jsx`.
21. Added `scripts/prepare-demo-assets.sh` to copy wasm artifacts into demo folders.
22. Copied `ffmpeg_wasm.js` and `ffmpeg_wasm.wasm` into `web/` and `web-react/public/`.
23. Updated `README.md` with demo instructions.
24. Updated `.gitignore` to ignore `web-react` build/cache outputs.
25. Added unified audio/video decode via `ffmpeg_wasm_read_frame` plus audio getters in `src/ffmpeg_wasm.c`.
26. Standardized audio output to stereo float32 @ 48 kHz for worklet playback.
27. Built a Matroska-focused HTML demo with audio worklet playback, volume control, and optional WebGL rendering.
28. Added `audio-worklet.js` assets for both HTML and React demos.
29. Updated the React demo UI and logic to match the Matroska player features.
30. Exported the new audio APIs in the wasm build step.
31. Added royalty-free/full/GPL/GPL-royaltyfree/nonfree build variants and variant-aware demo asset copying.
32. Replaced FFmpeg's built-in AV1 decoder selection with dav1d software decoding for WASM, because the built-in AV1 path expects hardware acceleration and returns `AVERROR(ENOSYS)` without it.
33. Added WASM SIMD by default and a separate `FFMPEG_WASM_THREADS=4` pthread build for native-layer 4K AV1 performance.
34. Split decoder thread count from the browser pthread worker pool. A 4-thread decoder build now defaults to an 8-worker Emscripten pool so browser libdav1d decode does not stall at the first frame.

## Decisions & Reasoning
- Single-threaded default build: avoids COOP/COEP requirements and keeps the basic browser setup simple.
- Pthread performance build: keeps the 4K AV1 fix in the WASM/native layer, at the cost of requiring `SharedArrayBuffer` and COOP/COEP headers.
- Larger browser pthread pool: decoder threads are not the same thing as available Emscripten workers; the pool must leave headroom for FFmpeg/libdav1d scheduling.
- Custom AVIO pipeline: enables streaming/range-style feeding from JS without relying on FFmpeg network protocols in wasm.
- `FILESYSTEM=0`: reduces runtime footprint because the demos use custom IO, not a virtual FS.
- `ALLOW_MEMORY_GROWTH=1`: necessary for streaming buffers that can exceed the initial heap size.
- Canvas RGBA rendering: simplest path to display decoded frames without a WebGL shader stack.
- AudioWorklet playback: stable, low-glitch streaming without the deprecated ScriptProcessorNode.
- Fixed 48 kHz stereo output: simplifies AudioContext configuration for Chromium-only playback.
- Optional WebGL path: provides a GPU rendering option without forcing extra complexity on the default flow.
- Keep FFmpeg "normal" (no `--disable-everything`): aligns with the request to keep a full-ish build while ensuring HEVC/AV1 are present.
- Vite for React: minimal boilerplate, fast dev loop, straightforward static asset handling via `public/`.
- License variants: provide a royalty-free build, a patent-encumbered full build, an open-source-required build, a GPL royalty-free build, and a non-redistributable build.
- dav1d for AV1: keeps AV1 usable in the browser without requiring unavailable hardware acceleration from the WASM module.
- Project static server: provides the COOP/COEP headers needed for pthread artifacts while still serving `web/v3.html` as a simple local page.

## Alternatives Considered
- **Pthreads + SIMD**: now implemented as an explicit performance build because single-threaded 4K AV1 stayed below real-time.
- **JS demuxer (mp4box.js) + libavcodec only**: simpler streaming control, but deviates from a full FFmpeg pipeline.
- **FFmpeg network protocols in wasm**: would allow HLS/DASH in native FFmpeg, but adds complexity and browser networking constraints.
- **WebGL/YUV rendering**: faster than RGBA+Canvas, but more boilerplate and shader code.
- **ScriptProcessorNode for audio**: deprecated and more glitch-prone; AudioWorklet is the modern option.
- **AudioContext with stream sample rate**: could avoid resampling, but can run into autoplay policies and inconsistent hardware rates.
- **Fixed wasm heap**: more predictable memory, but fragile for larger streams.
- **Disabling most FFmpeg components**: smaller wasm size, but contradicts the "normal FFmpeg" requirement.
- **Single build only**: simpler, but does not map to the three requested licensing buckets.

## Commands Used
- `./scripts/bootstrap-emsdk.sh`
- `./scripts/build-ffmpeg.sh`
- `./scripts/prepare-demo-assets.sh`
- `FFMPEG_WASM_THREADS=4 ./scripts/build-ffmpeg.sh --release`
- `FFMPEG_WASM_THREADS=4 ./scripts/prepare-demo-assets.sh --release`
- `node scripts/serve-web.mjs --port 8080`
