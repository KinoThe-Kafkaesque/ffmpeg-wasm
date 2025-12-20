# Build Variants and Supported Codecs

This document lists the 4 primary build variants and the codecs supported by each.

## Variant Overview

| Variant | License | Patent Status | Output Directory |
|---------|---------|---------------|------------------|
| royaltyfree | LGPL | Royalty-free | `build/ffmpeg-wasm-royaltyfree/` |
| full | LGPL | Patent-encumbered | `build/ffmpeg-wasm/` |
| gpl | GPL | Patent-encumbered | `build/ffmpeg-wasm-gpl/` |
| gpl-royaltyfree | GPL | Royalty-free | `build/ffmpeg-wasm-gpl-royaltyfree/` |

---

## 1. royaltyfree (LGPL)

Strictly royalty-free codec set, avoiding patent-encumbered codecs like HEVC and H.264. LGPL-friendly license.

**Aliases:** `royaltyfree-lgpl`

### Video Decoders
- av1
- vp9
- vp8
- theora
- dirac
- ffv1
- huffyuv
- utvideo
- mjpeg
- png
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
- av1
- h264
- vp8
- vp9
- mpeg4
- mpeg2video

### Audio Decoders
- aac
- ac3
- eac3
- mp3
- opus
- vorbis
- flac
- pcm_s16le
- pcm_s24le
- pcm_f32le

---

## 3. gpl

Identical codec set to "full" variant but requires GPL compliance (open-source obligation). Patent-encumbered.

### Video Decoders
- hevc
- av1
- h264
- vp8
- vp9
- mpeg4
- mpeg2video

### Audio Decoders
- aac
- ac3
- eac3
- mp3
- opus
- vorbis
- flac
- pcm_s16le
- pcm_s24le
- pcm_f32le

---

## 4. gpl-royaltyfree (GPL)

Royalty-free codec set with GPL license obligations (open-source required). Combines patent-free codecs with GPL compliance.

**Aliases:** `royaltyfree-gpl`

### Video Decoders
- av1
- vp9
- vp8
- theora
- dirac
- ffv1
- huffyuv
- utvideo
- mjpeg
- png
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
- **Royalty-free** variants use only codecs without known patent encumbrances (AV1, VP8/VP9, Opus, Vorbis, etc.)
- **LGPL** variants can be used in proprietary applications with proper attribution
- **GPL** variants require the entire application to be open-sourced under GPL
