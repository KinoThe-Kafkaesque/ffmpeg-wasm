# Audio Notes

## Resampling (swr_alloc_set_opts2)

FFmpeg's libswresample converts audio from source format to a consistent output format.

### Current setup (ffmpeg_wasm.c:329-338)
```c
swr_alloc_set_opts2(
    &ctx->swr,
    &out_layout,                      // OUTPUT: stereo
    AV_SAMPLE_FMT_FLT,               // OUTPUT: float32
    out_rate,                         // OUTPUT: 48000 Hz
    &ctx->audio_codec->ch_layout,    // INPUT: original channels
    ctx->audio_codec->sample_fmt,    // INPUT: original format
    ctx->audio_codec->sample_rate,   // INPUT: original sample rate
    ...
);
```

### Why resample to 48kHz?
- Web Audio API typically runs at 48000 Hz
- Normalizes all formats (int16, float, planar) to float32
- Downmixes surround (5.1, 7.1) to stereo

### Performance
- Audio resampling is ~1-2% of CPU time
- Video decoding is ~90% (the real bottleneck)
- libswresample is SIMD optimized

### Quality impact
- 44100 <-> 48000: negligible (both above human hearing limits)
- Downsampling from 96kHz: minor loss of ultra-high frequencies

### Potential optimization
Avoid resampling when source matches common rates:
```c
int out_rate = ctx->audio_codec->sample_rate;

// Only resample unusual rates
if (out_rate != 44100 && out_rate != 48000) {
    out_rate = 48000;
}
```
This skips resampling for 44.1k and 48k sources (most common cases).

## Bug fixed
Line 336 was using `out_rate` for input sample rate instead of `ctx->audio_codec->sample_rate`.
This caused incorrect resampling when source rate != 48000.
