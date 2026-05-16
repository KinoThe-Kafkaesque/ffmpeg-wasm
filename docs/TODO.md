# TODO / Bug Tracker

## Structural Refactor Queue

| ID | Status | Priority | Description |
|----|--------|----------|-------------|
| S001 | Done | High | Split native debug/logging into `src/ffmpeg_wasm_debug.c` and shared context declarations into `src/ffmpeg_wasm_internal.h`. |
| S002 | Done | High | Make append-mode seeking progressive-only; local seek now requires `read_at` random-access IO. |
| S003 | Done | High | Dedupe worker, Node harness, and Emscripten export bindings through `web/ffmpeg-wasm-api.js`. |
| S004 | Done | High | Add browser debug visibility: debug build mode, `av_log` bridge, native snapshot export, React debug panel, and debug message handlers. |
| S005 | Done | High | Build variant scrutiny: builds are now strict playback-only profiles; generated FFmpeg config is validated into `ffmpeg-components.json` and fails if encoders, muxers, filters, devices, programs, network, iconv, runtime CPU detection, or unexpected playback components are enabled. |
| S006 | Later | Medium | App surface cleanup: decide which of `web/app.js`, `app-v2.js`, `app-v3.js`, and `web-react/` remains the product UI; move old surfaces to labs or remove them. |
| S007 | Done | Medium | Add HTTP Range-backed `read_at` for URLs that support Range requests; keep fetch append mode for non-seekable streams; covered by `scripts/test-http-range-read-at.mjs`. |

## Bugs

| ID | Status | Description |
|----|--------|-------------|
| B001 | Done | MP4 duration/seek is fixed for local files and HTTP Range-capable URLs via `read_at`; non-Range append MP4s remain documented as progressive-only |
| B002 | Partial | Video state not tracked - React/worker state exists, but should still be centralized before extraction |
| B003 | Partial | Codec data cleanup improved via destroy/reset path; keep this open until replacement/regression tests cover it |
| B004 | Done | Choppy-audio pass completed: AudioWorklet startup now flushes queued samples before resume, overflow drops stay channel-aligned, the browser audio boundary has jitter trimming plus clock recovery, the worker receives audio-clock feedback to skip stale video frames, queue/drop/trim/underrun diagnostics are visible, and AAC/MP3/FLAC/OGG plus worklet-buffer regressions cover the fix. |
| B005 | Done | AV1 `Function not implemented` decode failure fixed by building/linking dav1d, selecting the `libdav1d` software decoder instead of FFmpeg's hardware-accel-only AV1 path, reserving an 8 MB WASM C stack for 10-bit 1080p dav1d decode, and covering it with source-FPS cadence/native real-time checks in `scripts/test-codec-regressions.mjs`. |
| B006 | Done | 4K AV1 WebM playback now has a native pthread WASM path. The single-threaded SIMD build remains below real-time, but `FFMPEG_WASM_THREADS=4` builds `build/ffmpeg-wasm-pthreads4/` with 4 decoder threads and an 8-worker browser pthread pool. `scripts/test-playback-performance.mjs` passes on `Terence Tao – How the world’s top mathematician uses AI [Q8Fkpi18QXU].webm` at 3840x2160 AV1 / 23.976 fps with ~44.4 fps decode-only and ~43.7 fps decode+RGBA throughput; headed `web/v3.html` smoke decoded the same file at 3840x2160 with audio enabled. |

## Features

| ID | Status | Priority | Description |
|----|--------|----------|-------------|
| F001 | Done | High | **Dynamic container detection** - `web/v3.html` auto-detects mp4/webm/matroska/avi/ts/audio containers from extension and local magic bytes; manual dropdown removed |
| F002 | Done | High | **Better player controls** - `web/v3.html` has seek/time/fullscreen/volume/speed/keyboard controls for the requested scope |
| F003 | Done | High | **Subtitles support** - ASS/SSA parsing/rendering, font injection, v3 subtitle track UI/debug state, and generated fixture regression coverage are in |
| F004 | Done | Medium | **Multi-track support** - v3 stream enumeration/track menus and audio/subtitle selection are wired with regression coverage |
| F005 | Partial | Medium | **Extract to Parallax** - `../parallax` now exists as a private derivative static app from `web/v3.html`, consuming ffmpeg-wasm release artifacts through its build step; remaining work is deciding what to do with old demo surfaces |
| F006 | Done | High | **Playlist support** - Implemented in `../parallax` with file/URL queueing, next/prev controls, remove/clear, and auto-advance |
| F007 | Done | Medium | **Audio file playback** - v3 accepts audio files, uses audio-only timing/placeholder behavior, and covers MP3/FLAC/OGG in regression tests |
| F008 | Done | Medium | **Enhanced video canvas UI** - v3 loading, error, source, seek, track, subtitle, and audio diagnostics are visible around the canvas |

---

## Detailed Descriptions

Some detailed sections below are historical notes. The summary tables above are the current status source until each section is reconciled against the live code.

### B001: MP4 Duration Unknown

**Problem:** When streaming MP4 files, duration shows as unknown until the moov atom is available.

**Root cause:** MP4 files store metadata (moov atom) at the end by default. For streaming, the file needs to be "faststart" encoded (moov at beginning).

**Possible solutions:**
1. Use `read_at` for local files and HTTP Range-capable URLs (implemented in v3/worker)
2. Document that faststart MP4s are required for non-Range append streaming
3. If non-Range append MP4 support becomes important, add a full-buffer open mode or moov relocation before feeding the decoder

---

### F001: Dynamic Container Detection

**Current behavior:** User must manually select container format (mov, matroska, etc.) from dropdown.

**Desired behavior:** Player auto-detects container format from file extension or magic bytes.

**Implementation:**
- [x] Detect from file extension (.mp4, .mkv, .webm, .avi, etc.)
- [x] Fallback: probe local magic bytes (first bytes identify container)
- [x] Remove format dropdown from `web/v3.html`
- [x] Map extensions to FFmpeg format names:
  - `.mp4`, `.m4v`, `.mov` → `mov`
  - `.mkv` → `matroska`
  - `.webm` → `matroska` (webm is matroska subset)
  - `.avi` → `avi`
  - `.ts`, `.mts` → `mpegts`

---

### F002: Better Player Controls

**Current controls:** Basic play/pause, volume toggle

**Desired controls:**
- [x] Seek bar with time position
- [x] Current time / total duration display
- [x] Volume slider (not just toggle)
- [x] Playback speed control (0.5x, 1x, 1.5x, 2x)
- [x] Fullscreen toggle
- [ ] Picture-in-picture support
- [x] Keyboard shortcuts (space=pause, arrows=seek, f=fullscreen)

---

### F003: Subtitles Support (ASS/SSA)

**Scope:** Parse and render ASS/SSA subtitle format

**Implementation steps:**
- [x] Enable ASS/SSA/WebVTT subtitle support in FFmpeg build variants
- [x] Extract subtitle stream alongside video/audio
- [x] Add subtitle track and libass state to `FFmpegWasmContext`
- [x] Expose subtitle/selection/debug API functions through `web/ffmpeg-wasm-api.js`
- [x] Render subtitles into the video canvas through libass
- [x] Inject a real fallback font into libass for no-filesystem WASM builds
- [x] Cover ASS fixture parsing/rendering in `scripts/test-v3-regressions.mjs`

**ASS/SSA format notes:**
- Text-based format with timing and style info
- Common in anime fansubs
- More complex than SRT (supports positioning, effects)

---

### F004: Multi-Track Support

**Scope:** Handle files with multiple video, audio, and subtitle tracks

**Implementation steps:**
- [x] Enumerate all streams on open through the shared API bindings
- [x] Allow selecting active video/audio stream pairs
- [x] Allow selecting subtitle tracks and turning subtitles off
- [x] UI: Track selector dropdowns for each type in `web/v3.html`
- [x] Cover audio track switching and subtitle selection in `scripts/test-v3-regressions.mjs`
- [ ] Broaden manual QA with real multi-language files and long playback switching

**Use cases:**
- Multi-language audio (English, Japanese, etc.)
- Multiple subtitle languages
- Director's commentary tracks

---

### F005: Extract to Parallax

**Scope:** Move player UI into a standalone project

**Structure:**
```
kinoSoft/
├── ffmpeg/           # This project - WASM build only
│   ├── src/
│   ├── scripts/
│   ├── build/
│   └── docs/
└── parallax/         # Private player UI project
    ├── src/
    │   ├── player.js
    │   ├── controls.js
    │   ├── subtitles.js
    │   └── tracks.js
    ├── styles/
    ├── public/
    │   ├── ffmpeg_wasm.js   # Copied from ffmpeg build
    │   └── ffmpeg_wasm.wasm
    └── package.json
```

**Migration steps:**
- [x] Create private Parallax repository
- [x] Create derivative `../parallax` project from `web/v3.html`
- [x] Add release-asset sync script that consumes this repo's built `ffmpeg_wasm.*` artifacts
- [x] Add build step that syncs the current pthread WASM release into Parallax
- [x] Add capability-manifest based fallback policy in Parallax
- [ ] Move or retire `web-react/` contents
- [ ] Refactor player into reusable component
- [ ] Publish as npm package (optional)
- [ ] Update ffmpeg project to only build WASM, not demos
- [x] Document integration in Parallax README

---

### B004: Choppy Audio Playback

**Problem:** Audio playback stutters or skips on some files, possibly AAC-encoded.

**Symptoms:**
- Audio cuts in and out
- Stuttering/crackling sounds
- Audio falls behind video (desync)
- Worse on certain codecs (AAC suspected)

**Possible causes:**
1. AudioWorklet buffer underrun (not enough samples queued)
2. Sample rate mismatch (source vs 48kHz output)
3. AAC decoder producing variable frame sizes
4. Resampler (swr) latency or dropped samples
5. Main thread blocking starving the worklet
6. GC pauses causing audio gaps

**Investigation steps:**
- [x] Log audio frame sizes/timestamps via worker stats and debug snapshots
- [x] Check if issue is codec-specific with generated AAC/MP3/FLAC/OGG fixtures
- [x] Monitor AudioWorklet buffer levels
- [x] Add enough queue/drop/underrun telemetry to decide if future reports need main-thread profiling
- [x] Test with larger audio buffer queue

**Potential fixes:**
- [x] Increase AudioWorklet ring buffer size
- [x] Keep a larger pending audio queue before AudioWorklet initialization completes
- [x] Flush pending audio into the Worklet before resuming the AudioContext to avoid startup underruns
- [x] Keep AudioWorklet overflow drops channel-aligned
- [x] Keep demux/decode in the worker but split the browser audio boundary into explicit queueing, jitter trimming, and feedback messages
- [x] Use a separate native FFmpeg audio context for seekable `read_at` sources, with append-stream sources retaining the single-context path
- [x] Implement audio/video sync with clock recovery
- [x] Add jitter buffer to smooth out variable decode times

---

### B002: Video State Not Tracked

**Problem:** Currently selected video state is lost or becomes inconsistent during playback.

**Symptoms:**
- Play/pause state desyncs from actual playback
- Progress position lost on certain actions
- UI doesn't reflect actual player state

**Fix requirements:**
- [ ] Centralize player state management
- [ ] Track: playing/paused, current time, duration, buffered ranges
- [ ] Sync UI state with actual decoder state
- [ ] Handle edge cases: seeking while paused, buffering states

---

### B003: Codec Data Not Cleaned Up

**Problem:** When replacing a video with another, codec state is not properly reset.

**Symptoms:**
- Visual artifacts from previous video
- Audio glitches or wrong sample rate
- Crashes on certain video transitions
- Memory leaks from unreleased buffers

**Fix requirements:**
- [ ] Call `ffmpeg_wasm_destroy()` before loading new video
- [ ] Reset all JS-side state (canvas, audio context, buffers)
- [ ] Clear AudioWorklet buffer queue
- [ ] Reinitialize sws/swr contexts for new video parameters
- [ ] Add explicit `reset()` API function

---

### F006: Playlist Support

**Scope:** Queue multiple files and cycle through them

**Implementation:**
- [x] Playlist data structure (array of file references)
- [x] Add files to queue (drag-drop, file picker, URLs)
- [x] Playlist UI panel (show queue, remove, clear)
- [x] Next/Previous controls
- [x] Auto-advance to next video on completion
- [ ] Loop modes: none, single, all
- [ ] Shuffle mode
- [ ] Persist playlist in localStorage (optional)

**UI elements:**
- Playlist sidebar/drawer
- Current item highlight
- Drag handles for reordering
- Next/Prev buttons in controls

---

### F007: Audio File Playback

**Scope:** Support audio-only files without video stream

**Supported formats:**
- MP3, FLAC, OGG, WAV, AAC, Opus

**Implementation:**
- [x] Detect audio-only files (no video stream)
- [x] Skip video timing dependence when no video stream exists
- [x] Display audio-only placeholder
- [x] Cover MP3/FLAC/OGG audio-only decode in `scripts/test-v3-regressions.mjs`
- [ ] Show waveform or spectrum analyzer (optional)
- [ ] Handle metadata (title, artist, album from tags)

**UI for audio mode:**
- Album art or default audio icon
- Waveform visualization (canvas)
- Spectrum analyzer (optional)
- Metadata display (artist - title)

---

### F008: Enhanced Video Canvas UI

**Scope:** Improve visual design and user experience of the player

**Improvements:**
- [x] Loading/source overlay while opening
- [x] Error state display (codec not supported, file corrupted, etc.)
- [x] Buffering/opening indicator overlay
- [ ] Fade-in/out for controls overlay
- [ ] Responsive sizing (fit container, maintain aspect ratio)
- [ ] Dark/light theme support
- [ ] Poster frame / thumbnail before play
- [ ] Double-click to fullscreen
- [ ] Hover to show controls, auto-hide after delay

**Visual polish:**
- Rounded corners on canvas container
- Drop shadow / subtle border
- Smooth transitions and animations
- Consistent icon set for controls
- Progress bar with buffer visualization

---

## Completed

| ID | Completed | Description |
|----|-----------|-------------|
| - | - | - |
