#include "ffmpeg_wasm_internal.h"

#include <emscripten/emscripten.h>
#include <libavutil/error.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

EM_JS(void, ffmpeg_wasm_post_ffmpeg_log, (int level, const char *message), {
  if (typeof postMessage !== "function") {
    return;
  }
  postMessage({
    type: "ffmpegLog",
    level: level,
    message: UTF8ToString(message)
  });
});

EM_JS(void, ffmpeg_wasm_post_subtitle_log, (const char *text, int start_ms, int end_ms), {
  if (typeof postMessage !== "function") {
    return;
  }
  postMessage({
    type: "subtitleLog",
    text: UTF8ToString(text),
    startMs: start_ms,
    endMs: end_ms
  });
});

EM_JS(void, ffmpeg_wasm_post_subtitle_debug, (int events_count, int first_start_ms, int first_end_ms), {
  if (typeof postMessage !== "function") {
    return;
  }
  postMessage({
    type: "subtitleDebug",
    note: "render returned null",
    nEvents: events_count,
    firstStartMs: first_start_ms,
    firstEndMs: first_end_ms
  });
});

static void ffmpeg_wasm_log_callback(void *ptr, int level, const char *fmt, va_list vl) {
  (void)ptr;
  if (level > av_log_get_level()) {
    return;
  }

  char line[1024];
  int print_prefix = 1;
  av_log_format_line(ptr, level, fmt, vl, line, sizeof(line), &print_prefix);

  size_t len = strlen(line);
  while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
    line[--len] = '\0';
  }
  if (len == 0) {
    return;
  }

  ffmpeg_wasm_post_ffmpeg_log(level, line);
}

void ffmpeg_wasm_debug_install_log_bridge(void) {
  av_log_set_callback(ffmpeg_wasm_log_callback);
}

void ffmpeg_wasm_debug_set_last_error(FFmpegWasmContext *ctx, int error_code) {
  if (ctx) {
    ctx->last_error = error_code;
  }
}

void ffmpeg_wasm_debug_post_subtitle_log(const char *text, int start_ms, int end_ms) {
  if (text) {
    ffmpeg_wasm_post_subtitle_log(text, start_ms, end_ms);
  }
}

void ffmpeg_wasm_debug_post_subtitle_render_null(int events_count, int first_start_ms, int first_end_ms) {
  ffmpeg_wasm_post_subtitle_debug(events_count, first_start_ms, first_end_ms);
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_set_log_level(int level) {
  ffmpeg_wasm_debug_install_log_bridge();
  av_log_set_level(level);
}

EMSCRIPTEN_KEEPALIVE const char *ffmpeg_wasm_error_string(int error_code) {
  static char error_buffer[AV_ERROR_MAX_STRING_SIZE];
  if (av_strerror(error_code, error_buffer, sizeof(error_buffer)) < 0) {
    snprintf(error_buffer, sizeof(error_buffer), "Unknown error %d", error_code);
  }
  return error_buffer;
}

EMSCRIPTEN_KEEPALIVE const char *ffmpeg_wasm_debug_snapshot(uintptr_t handle) {
  static char snapshot[1800];
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx) {
    snprintf(snapshot, sizeof(snapshot), "{\"valid\":false}");
    return snapshot;
  }

  double byte_pos = -1.0;
  if (ctx->io_mode == FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL) {
    byte_pos = (double)ctx->ra_pos;
  } else {
    byte_pos = (double)(ctx->buffer.offset + (int64_t)ctx->buffer.read_pos);
  }

  double avio_pos = -1.0;
  int avio_seekable = -1;
  if (ctx->avio) {
    avio_seekable = ctx->avio->seekable;
    int64_t pos = avio_tell(ctx->avio);
    if (pos >= 0) {
      avio_pos = (double)pos;
    }
  }

  double video_pts = -1.0;
  if (ctx->video_frame && ctx->video_time_base.den != 0) {
    int64_t pts = ctx->video_frame->best_effort_timestamp;
    if (pts != AV_NOPTS_VALUE) {
      video_pts = pts * av_q2d(ctx->video_time_base);
    }
  }

  int subtitle_events = 0;
  if (ctx->ass_track) {
    subtitle_events = ctx->ass_track->n_events;
  }
  int audio_bytes = 0;
  if (ctx->audio_nb_samples > 0 && ctx->audio_channels > 0) {
    audio_bytes = ctx->audio_nb_samples * ctx->audio_channels * (int)sizeof(float);
  }

  snprintf(
      snapshot,
      sizeof(snapshot),
      "{"
      "\"valid\":true,"
      "\"ioMode\":%d,"
      "\"opened\":%d,"
      "\"bytePos\":%.0f,"
      "\"avioPos\":%.0f,"
      "\"avioSeekable\":%d,"
      "\"bufferOffset\":%.0f,"
      "\"bufferReadPos\":%zu,"
      "\"bufferedBytes\":%zu,"
      "\"fileSize\":%.0f,"
      "\"raCacheStart\":%.0f,"
      "\"raCacheSize\":%zu,"
      "\"videoStream\":%d,"
      "\"audioStream\":%d,"
      "\"subtitleStream\":%d,"
      "\"lastPacketStream\":%d,"
      "\"lastPacketPts\":%.6f,"
      "\"videoPts\":%.6f,"
      "\"audioPts\":%.6f,"
      "\"audioSamples\":%d,"
      "\"audioBytes\":%d,"
      "\"subtitleEvents\":%d,"
      "\"packetsRead\":%.0f,"
      "\"subtitlePacketsRead\":%.0f,"
      "\"lastError\":%d"
      "}",
      ctx->io_mode,
      ctx->opened,
      byte_pos,
      avio_pos,
      avio_seekable,
      (double)ctx->buffer.offset,
      ctx->buffer.read_pos,
      ctx->buffer.size,
      (double)ctx->buffer.total_size,
      (double)ctx->ra_cache_start,
      ctx->ra_cache_size,
      ctx->video_stream_index,
      ctx->audio_stream_index,
      ctx->subtitle_stream_index,
      ctx->last_packet_stream_index,
      ctx->last_packet_pts_seconds,
      video_pts,
      ctx->audio_pts_seconds,
      ctx->audio_nb_samples,
      audio_bytes,
      subtitle_events,
      (double)ctx->packets_read,
      (double)ctx->subtitle_packets_read,
      ctx->last_error);
  return snapshot;
}
