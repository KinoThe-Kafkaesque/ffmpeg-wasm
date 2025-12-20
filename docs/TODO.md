# TODO / Bug Tracker

## Bugs

| ID | Status | Description |
|----|--------|-------------|
| B001 | Open | MP4 duration not identified - duration shows as unknown until moov atom is parsed |
| B002 | Open | Video state not tracked - currently selected video state is lost/inconsistent |
| B003 | Open | Codec data not cleaned up - state not reset properly after video replacement, causes artifacts/crashes |
| B004 | Open | Choppy audio playback - audio stutters/skips on some files (possibly AAC related) |

## Features

| ID | Status | Priority | Description |
|----|--------|----------|-------------|
| F001 | Open | High | **Dynamic container detection** - Auto-detect mp4/webm/matroska instead of user dropdown |
| F002 | Open | High | **Better player controls** - Seek bar, time display, fullscreen, volume slider, playback speed |
| F003 | Open | High | **Subtitles support** - ASS/SSA format parsing and rendering |
| F004 | Open | Medium | **Multi-track support** - Multiple video, audio, and subtitle tracks with track switcher UI |
| F005 | Open | Medium | **Extract to kinoplayer** - Move player into standalone project |
| F006 | Open | High | **Playlist support** - Queue multiple files, video cycling, next/prev controls |
| F007 | Open | Medium | **Audio file playback** - Support playing audio-only files (mp3, flac, ogg, etc.) |
| F008 | Open | Medium | **Enhanced video canvas UI** - Better visual design, loading states, error display |

---

## Detailed Descriptions

### B001: MP4 Duration Unknown

**Problem:** When streaming MP4 files, duration shows as unknown until the moov atom is available.

**Root cause:** MP4 files store metadata (moov atom) at the end by default. For streaming, the file needs to be "faststart" encoded (moov at beginning).

**Possible solutions:**
1. Document that faststart MP4s are required for streaming
2. Buffer entire file before opening (current workaround with `keep_all`)
3. Implement moov atom relocation in JS before feeding to decoder

---

### F001: Dynamic Container Detection

**Current behavior:** User must manually select container format (mov, matroska, etc.) from dropdown.

**Desired behavior:** Player auto-detects container format from file extension or magic bytes.

**Implementation:**
- [ ] Detect from file extension (.mp4, .mkv, .webm, .avi, etc.)
- [ ] Fallback: probe magic bytes (first 4-12 bytes identify container)
- [ ] Remove format dropdown from UI
- [ ] Map extensions to FFmpeg format names:
  - `.mp4`, `.m4v`, `.mov` → `mov`
  - `.mkv` → `matroska`
  - `.webm` → `matroska` (webm is matroska subset)
  - `.avi` → `avi`
  - `.ts`, `.mts` → `mpegts`

---

### F002: Better Player Controls

**Current controls:** Basic play/pause, volume toggle

**Desired controls:**
- [ ] Seek bar with time position
- [ ] Current time / total duration display
- [ ] Volume slider (not just toggle)
- [ ] Playback speed control (0.5x, 1x, 1.5x, 2x)
- [ ] Fullscreen toggle
- [ ] Picture-in-picture support
- [ ] Keyboard shortcuts (space=pause, arrows=seek, f=fullscreen)

---

### F003: Subtitles Support (ASS/SSA)

**Scope:** Parse and render ASS/SSA subtitle format

**Implementation steps:**
- [ ] Enable ASS demuxer/decoder in FFmpeg build (`--enable-decoder=ass,ssa`)
- [ ] Extract subtitle stream alongside video/audio
- [ ] Add subtitle track to FFmpegWasmContext
- [ ] Expose subtitle data via new API functions:
  - `ffmpeg_wasm_subtitle_text()`
  - `ffmpeg_wasm_subtitle_start_time()`
  - `ffmpeg_wasm_subtitle_end_time()`
- [ ] Render subtitles in HTML overlay or canvas
- [ ] Support basic ASS styling (fonts, colors, positioning)

**ASS/SSA format notes:**
- Text-based format with timing and style info
- Common in anime fansubs
- More complex than SRT (supports positioning, effects)

---

### F004: Multi-Track Support

**Scope:** Handle files with multiple video, audio, and subtitle tracks

**Implementation steps:**
- [ ] Enumerate all streams on open:
  - `ffmpeg_wasm_stream_count(type)` → number of video/audio/sub streams
  - `ffmpeg_wasm_stream_info(type, index)` → language, codec, title
- [ ] Allow selecting active track per type:
  - `ffmpeg_wasm_select_video_track(index)`
  - `ffmpeg_wasm_select_audio_track(index)`
  - `ffmpeg_wasm_select_subtitle_track(index)`
- [ ] UI: Track selector dropdowns for each type
- [ ] Handle track switching mid-playback (flush decoders, resync)

**Use cases:**
- Multi-language audio (English, Japanese, etc.)
- Multiple subtitle languages
- Director's commentary tracks

---

### F005: Extract to kinoplayer

**Scope:** Move player UI into a standalone project

**Structure:**
```
kinoSoft/
├── ffmpeg/           # This project - WASM build only
│   ├── src/
│   ├── scripts/
│   ├── build/
│   └── docs/
└── kinoplayer/       # New project - Player UI
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
- [ ] Create kinoplayer repository
- [ ] Move `web-react/` contents to kinoplayer
- [ ] Refactor player into reusable component
- [ ] Publish as npm package (optional)
- [ ] Update ffmpeg project to only build WASM, not demos
- [ ] Document integration in kinoplayer README

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
- [ ] Log audio frame sizes and timestamps
- [ ] Check if issue is codec-specific (test AAC vs Opus vs MP3)
- [ ] Monitor AudioWorklet buffer levels
- [ ] Profile main thread for long blocking operations
- [ ] Test with larger audio buffer queue

**Potential fixes:**
- [ ] Increase AudioWorklet ring buffer size
- [ ] Pre-buffer more audio before starting playback
- [ ] Use separate decode loop for audio (Web Worker)
- [ ] Implement audio/video sync with clock recovery
- [ ] Add jitter buffer to smooth out variable decode times

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
- [ ] Playlist data structure (array of file references)
- [ ] Add files to queue (drag-drop, file picker, URLs)
- [ ] Playlist UI panel (show queue, reorder, remove)
- [ ] Next/Previous controls
- [ ] Auto-advance to next video on completion
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
- [ ] Detect audio-only files (no video stream)
- [ ] Skip video decoding/rendering when no video
- [ ] Display audio visualization or album art placeholder
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
- [ ] Loading spinner/skeleton while buffering
- [ ] Error state display (codec not supported, file corrupted, etc.)
- [ ] Buffering indicator (spinner overlay)
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
