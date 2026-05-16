# Playback Edge Case Checklist

Use this as the test backlog for the player after the pthread AV1 fix.

## Browser Pthread Regression

- [ ] Load 1080p AV1 in `web/v3.html` and assert frames advance.
- [ ] Load 4K AV1 in `web/v3.html` and assert frames advance.
- [ ] Assert `crossOriginIsolated === true`.
- [ ] Assert `typeof SharedArrayBuffer === "function"`.
- [ ] Assert resolution is reported after decode starts.
- [ ] Assert worker status reaches `Playing` without worker errors.
- [ ] Test missing COOP/COEP headers and confirm the UI reports a useful failure.
- [ ] Test missing `ffmpeg_wasm.worker.js` and confirm the UI reports a useful failure.
- [ ] Test pthread pool smaller than decoder thread count and confirm the failure is visible.

## Long-Play Smoothness

- [ ] Run 5-10 minutes on 23.976 fps AV1 and track decoded-frame cadence.
- [ ] Run 5-10 minutes on HEVC and track decoded-frame cadence.
- [ ] Track PTS drift against expected source FPS.
- [ ] Track heap growth over time.
- [ ] Track audio queue depth.
- [ ] Track audio underruns.
- [ ] Track dropped audio samples.
- [ ] Track dropped or skipped video frames.

## Seek While Playing

- [ ] Forward seek while playing.
- [ ] Backward seek while playing.
- [ ] Rapid scrub across the timeline.
- [ ] Seek near `0`.
- [ ] Seek near EOF.
- [ ] Repeat seek checks on HEVC.
- [ ] Repeat seek checks on AV1.
- [ ] Repeat seek checks on late-moov MP4.
- [ ] Repeat seek checks on no-cues MKV.
- [ ] Repeat seek checks on HTTP Range-backed URL.

## Audio Sync

- [ ] Test Opus in WebM.
- [ ] Test AAC in MP4.
- [ ] Test AC3 in MKV.
- [ ] Test EAC3 in MKV.
- [ ] Test MP3 audio-only.
- [ ] Test FLAC audio-only.
- [ ] Test OGG audio-only.
- [ ] Test 44.1 kHz source resampling to 48 kHz output.
- [ ] Test variable AAC frame sizes.
- [ ] Confirm audio queue recovers after pause/resume.
- [ ] Confirm audio queue recovers after seek.

## Subtitles

- [ ] Test ASS subtitles with styling.
- [ ] Test ASS subtitles with positioning/effects.
- [ ] Test embedded fonts.
- [ ] Test SRT subtitles.
- [ ] Test WebVTT subtitles.
- [ ] Test subtitle delay.
- [ ] Test subtitle switching while playing.
- [ ] Test subtitle switching after seek.
- [ ] Verify subtitle render after resolution changes.
- [ ] Verify subtitle render after stream switch.

## Track Switching

- [ ] Switch audio tracks while playing.
- [ ] Switch audio tracks after seek.
- [ ] Switch subtitle tracks while playing.
- [ ] Switch subtitle tracks after seek.
- [ ] Switch video tracks if a multi-video fixture is available.
- [ ] Confirm audio queues clear on track switch.
- [ ] Confirm selected stream ids match native debug snapshot.

## Container And Index Weirdness

- [ ] MKV with no cues.
- [ ] MKV with sparse cues.
- [ ] MKV with ordered chapters.
- [ ] MP4 faststart local file.
- [ ] MP4 late-moov local file.
- [ ] MP4 late-moov over HTTP Range.
- [ ] HTTP URL with no `Accept-Ranges`.
- [ ] HTTP URL with missing exposed `Content-Range`.
- [ ] HTTP URL returning wrong `206` response.
- [ ] HTTP URL returning `416 Range Not Satisfiable`.

## Cleanup And Replacement

- [ ] Open file A, stop, open file B.
- [ ] Repeat replacement 20-50 times.
- [ ] Watch heap for growth after destroy/reset.
- [ ] Check for stale PTS.
- [ ] Check for stale subtitles.
- [ ] Check for stale audio queue.
- [ ] Check for stale track menu state.

## Codec And Profile Matrix

- [ ] HEVC Main.
- [ ] HEVC Main10.
- [ ] AV1 8-bit.
- [ ] AV1 10-bit.
- [ ] HDR metadata.
- [ ] H.264.
- [ ] VP9.
- [ ] Unusual pixel formats.
- [ ] Confirm unsupported profiles fail cleanly with visible errors.
