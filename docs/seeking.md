If you’re using MKV and feeding FFmpeg (or another demuxer) via **chunked/custom I/O**, “seeking” has two parts:

1. **Byte-level seeking in the input** (jump to an offset in the file/stream)
2. **Timestamp seeking in the container** (jump to ~time T using cues/index)

MKV seeking is *very* dependent on being able to do (1), because the demuxer often needs to jump around (sometimes even to the end to read Cues).

---

## The simplest answer

### If the file is local on disk

Don’t implement chunked I/O at all. Let FFmpeg read the file directly and you get seeking “for free”:

* open: `avformat_open_input(&fmt, "test.mkv", NULL, NULL)`
* seek: `avformat_seek_file()` or `av_seek_frame()`

Chunked reading is mainly for **network/custom storage**, not local files.

---

## If you must keep chunked/custom I/O

You need to implement a **seek callback** in your custom IO layer.

### In FFmpeg terms (libavformat)

You create an `AVIOContext` with:

* `read_packet` callback (you already have)
* **`seek` callback** (this is what you’re missing)

And you must mark it seekable:

* `avio_ctx->seekable = AVIO_SEEKABLE_NORMAL;`

### What the seek callback must do

Your seek callback must support:

* `whence == SEEK_SET / SEEK_CUR / SEEK_END` (depending on your needs)
* `whence == AVSEEK_SIZE` → return the total file size (very important)

**Why AVSEEK_SIZE matters:** demuxers use it to know the file length and may seek to the end to find indexes/cues. If you return “unknown size”, seeking often becomes unreliable or disabled.

### Pseudocode skeleton (C/C++)

```c
static int read_packet(void *opaque, uint8_t *buf, int buf_size) {
    MyIO *io = (MyIO*)opaque;
    // read sequential bytes from current io->pos
    // return number of bytes read, or AVERROR_EOF
}

static int64_t seek(void *opaque, int64_t offset, int whence) {
    MyIO *io = (MyIO*)opaque;

    if (whence == AVSEEK_SIZE) {
        return io->size;               // MUST be correct
    }

    int64_t newpos;
    switch (whence & ~AVSEEK_FORCE) {
        case SEEK_SET: newpos = offset; break;
        case SEEK_CUR: newpos = io->pos + offset; break;
        case SEEK_END: newpos = io->size + offset; break;
        default: return AVERROR(EINVAL);
    }

    if (newpos < 0 || newpos > io->size) return AVERROR(EINVAL);

    io->pos = newpos;
    return newpos;
}
```

Then:

```c
avio = avio_alloc_context(buffer, buffer_size,
                          0, myio, read_packet, NULL, seek);
avio->seekable = AVIO_SEEKABLE_NORMAL;

fmt->pb = avio;
fmt->flags |= AVFMT_FLAG_CUSTOM_IO;

avformat_open_input(&fmt, NULL, NULL, NULL);
```

---

## Implementing “seek to time”

Once byte-seeking works, time-seeking is straightforward:

### Use `avformat_seek_file` (most robust)

```c
int64_t ts = seconds * AV_TIME_BASE;   // if stream_index = -1 (global time base)
avformat_seek_file(fmt, -1, INT64_MIN, ts, INT64_MAX, 0);
```

Or per-stream:

```c
int stream = video_stream_index;
int64_t ts = av_rescale_q(seconds, (AVRational){1,1}, fmt->streams[stream]->time_base);
avformat_seek_file(fmt, stream, INT64_MIN, ts, INT64_MAX, 0);
```

### After seeking you must flush decoders

* `avcodec_flush_buffers(video_dec_ctx);`
* and for newer APIs you may also need to reset frame reordering state depending on how you decode.

Then start reading packets/frames again.

---

## The big gotchas (these bite MKV hard)

### 1) If your “stream” isn’t truly random-access, seeking will be limited

If your source is HTTP or remote storage, implement **Range requests** so your seek callback can fetch bytes at `offset`.

### 2) If the file is still being written (growing file)

Reliable seeking is often **not possible** until:

* the MKV has valid **Cues/index**
* the file size stabilizes

Workarounds:

* Don’t offer seeking until recording finishes, **or**
* switch to a streaming-friendly format (TS, fMP4), **or**
* record MKV with settings that write cues more progressively (depends on muxer; many don’t).

### 3) Don’t reopen per chunk

Open demuxer once; seeking is repositioning the same logical stream, not reinitializing from arbitrary chunks.

---

## Quick recommendation

* **Local file**: stop chunking, open by filename, use `avformat_seek_file`.
* **Remote file**: implement Range-backed seek callback + AVSEEK_SIZE.
* **Growing file**: either disable seeking or change container.

If you tell me what stack you’re using (FFmpeg AVIOContext? GStreamer? Android extractor? something else) and whether the file is **fully written** or **still being produced**, I can give a concrete “drop-in” implementation pattern for that stack.
