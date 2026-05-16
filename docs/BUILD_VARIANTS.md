# Build Variants and Supported Codecs

This document lists the 4 primary build variants and the codecs supported by each.

All variants are playback-only builds. The configure profile disables FFmpeg
programs, network, devices, filters, encoders, muxers, iconv, and runtime CPU
detection, then explicitly enables only the demuxers, parsers, decoders, `file`
protocol, and VP9 superframe bitstream filter needed by the WASM API.

Each build now writes `ffmpeg_wasm.capabilities.json` beside `ffmpeg_wasm.js` and `ffmpeg_wasm.wasm`. Consumer apps should read that manifest to decide whether the release can handle a source, whether pthread headers are required, and whether browser-native fallback is acceptable. The fallback decision belongs in the consumer app, not in this WASM build repo.

Each build also writes `ffmpeg-components.json` from the generated FFmpeg
configuration. The build fails if an encoder, muxer, filter, device, program,
network path, or unexpected playback component is enabled.

## Variant Overview

| Variant | License | Patent Status | Output Directory |
|---------|---------|---------------|------------------|
| royaltyfree | LGPL | Royalty-free | `build/ffmpeg-wasm-royaltyfree/` |
| full | LGPL | Patent-encumbered | `build/ffmpeg-wasm/` |
| gpl | GPL | Patent-encumbered | `build/ffmpeg-wasm-gpl/` |
| gpl-royaltyfree | GPL | Royalty-free | `build/ffmpeg-wasm-gpl-royaltyfree/` |

Append `-pthreadsN` to the output directory by setting `FFMPEG_WASM_THREADS=N` with `N > 1`; for example, the 4-thread full build writes `build/ffmpeg-wasm-pthreads4/` and emits `ffmpeg_wasm.worker.js`. `FFMPEG_WASM_THREADS` controls native decoder threads. The browser pthread worker pool defaults to `max(8, N * 2)` so FFmpeg/libdav1d has spare workers; override it with `FFMPEG_WASM_THREAD_POOL=M` only for scheduling experiments.

---

## 1. royaltyfree (LGPL)

Strictly royalty-free codec set, avoiding patent-encumbered codecs like HEVC and H.264. LGPL-friendly license.

**Aliases:** `royaltyfree-lgpl`

### Video Decoders
- av1 via libdav1d
- vp9
- vp8
- theora
- dirac
- ffv1
- huffyuv
- utvideo
- mjpeg
- rawvideo

### Audio Decoders
- opus
- vorbis
- flac
- speex
- wavpack
- tta
- pcm_s16le
- pcm_s24le
- pcm_s32le
- pcm_f32le
- pcm_s16be
- pcm_u8
- pcm_s8

---

## 2. full (LGPL)

Default variant with common, widely-used codecs including HEVC and H.264. Patent-encumbered but LGPL-friendly license compliance.

**Aliases:** `lgpl`

### Video Decoders
- hevc
- av1 via libdav1d
- h264
- h263
- vp8
- vp9
- mpeg4
- mpeg2video

### Audio Decoders
- aac
- ac3
- eac3
- alac
- mp3
- opus
- vorbis
- flac
- pcm_s16le
- pcm_s24le
- pcm_s32le
- pcm_f32le
- pcm_s16be
- pcm_u8
- pcm_s8

---

## 3. gpl

Identical codec set to "full" variant but requires GPL compliance (open-source obligation). Patent-encumbered.

### Video Decoders
- hevc
- av1 via libdav1d
- h264
- h263
- vp8
- vp9
- mpeg4
- mpeg2video

### Audio Decoders
- aac
- ac3
- eac3
- alac
- mp3
- opus
- vorbis
- flac
- pcm_s16le
- pcm_s24le
- pcm_s32le
- pcm_f32le
- pcm_s16be
- pcm_u8
- pcm_s8

---

## 4. gpl-royaltyfree (GPL)

Royalty-free codec set with GPL license obligations (open-source required). Combines patent-free codecs with GPL compliance.

**Aliases:** `royaltyfree-gpl`

### Video Decoders
- av1 via libdav1d
- vp9
- vp8
- theora
- dirac
- ffv1
- huffyuv
- utvideo
- mjpeg
- rawvideo

### Audio Decoders
- opus
- vorbis
- flac
- speex
- wavpack
- tta
- pcm_s16le
- pcm_s24le
- pcm_s32le
- pcm_f32le
- pcm_s16be
- pcm_u8
- pcm_s8

---

## Choosing a Variant

| Use Case | Recommended Variant |
|----------|---------------------|
| Maximum compatibility, proprietary app | full |
| Open-source project, maximum compatibility | gpl |
| Patent-safe, proprietary app | royaltyfree |
| Patent-safe, open-source project | gpl-royaltyfree |

### Notes

- **Patent-encumbered** variants include H.264/HEVC/AAC/MP3 which may require patent licenses for commercial use
- **Royalty-free** variants use only codecs without known patent encumbrances (AV1 through dav1d, VP8/VP9, Opus, Vorbis, etc.)
- **AV1 in WASM** uses the external libdav1d software decoder. FFmpeg's built-in AV1 decoder expects hardware acceleration in this build shape and returns `AVERROR(ENOSYS)` when no hardware pixel format is available.
- **Encoding/transcoding is intentionally unsupported**. If a future product needs exports, add a separate encode/transcode build instead of bloating the playback build.
- **LGPL** variants can be used in proprietary applications with proper attribution
- **GPL** variants require the entire application to be open-sourced under GPL
