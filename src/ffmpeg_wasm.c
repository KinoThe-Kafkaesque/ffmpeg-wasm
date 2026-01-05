#include <emscripten/emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavformat/avio.h>
#include <libavutil/avutil.h>
#include <libavutil/channel_layout.h>
#include <libavutil/dict.h>
#include <libavutil/error.h>
#include <libavutil/imgutils.h>
#include <libavutil/mem.h>
#include <libavutil/rational.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
#include <ass/ass.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct StreamBuffer {
  uint8_t *data;
  size_t size;
  size_t capacity;
  size_t start;
  size_t read_pos;
  int64_t offset;
  size_t limit;
  int keep_all;
  int eof;
  int64_t total_size;  // Known file size, -1 if unknown
} StreamBuffer;

typedef struct FFmpegWasmContext {
  StreamBuffer buffer;
  AVIOContext *avio;
  AVFormatContext *fmt;
  AVPacket *packet;

  AVCodecContext *video_codec;
  AVCodecContext *audio_codec;
  AVFrame *video_frame;
  AVFrame *audio_frame;

  struct SwsContext *sws;
  uint8_t *rgba_data[4];
  int rgba_linesize[4];
  int rgba_size;
  int rgba_width;
  int rgba_height;
  enum AVPixelFormat rgba_src_fmt;

  struct SwrContext *swr;
  uint8_t *audio_data;
  int audio_linesize;
  int audio_nb_samples;
  int audio_channels;
  int audio_sample_rate;
  double audio_pts_seconds;

  int video_stream_index;
  int audio_stream_index;
  AVRational video_time_base;
  AVRational audio_time_base;

  int audio_enabled;
  int opened;
  int draining;
  int video_eof;
  int audio_eof;
  int video_flush_sent;
  int audio_flush_sent;

  ASS_Library *ass_library;
  ASS_Renderer *ass_renderer;
  ASS_Track *ass_track;
  int subtitle_stream_index;
  AVCodecContext *subtitle_codec;
  int subtitles_enabled;
} FFmpegWasmContext;

static int ensure_capacity(StreamBuffer *buffer, size_t needed) {
  if (!buffer) {
    return AVERROR(EINVAL);
  }
  if (needed <= buffer->capacity) {
    return 0;
  }

  if (buffer->start > 0 && buffer->size > 0) {
    size_t append_len = 0;
    if (needed >= buffer->start + buffer->size) {
      append_len = needed - (buffer->start + buffer->size);
    }
    memmove(buffer->data, buffer->data + buffer->start, buffer->size);
    buffer->start = 0;
    needed = buffer->size + append_len;
  }
  if (needed <= buffer->capacity) {
    return 0;
  }

  size_t new_capacity = buffer->capacity ? buffer->capacity : 1024;
  while (new_capacity < needed) {
    if (new_capacity > SIZE_MAX / 2) {
      new_capacity = needed;
      break;
    }
    new_capacity *= 2;
  }

  uint8_t *new_data = av_realloc(buffer->data, new_capacity);
  if (!new_data) {
    return AVERROR(ENOMEM);
  }

  buffer->data = new_data;
  buffer->capacity = new_capacity;
  return 0;
}

static void compact_buffer(StreamBuffer *buffer) {
  if (!buffer || buffer->read_pos == 0) {
    return;
  }
  if (buffer->keep_all) {
    return;
  }

  const size_t keep_backlog = 4 * 1024 * 1024;
  if (buffer->read_pos <= keep_backlog) {
    return;
  }

  size_t drop = buffer->read_pos - keep_backlog;
  if (drop >= buffer->size) {
    buffer->size = 0;
    buffer->read_pos = 0;
    buffer->offset += (int64_t)drop;
    buffer->start = 0;
    return;
  }

  buffer->start += drop;
  buffer->size -= drop;
  buffer->read_pos -= drop;
  buffer->offset += (int64_t)drop;
}

static void enforce_buffer_limit(StreamBuffer *buffer) {
  if (!buffer || buffer->limit == 0 || buffer->keep_all) {
    return;
  }
  if (buffer->size <= buffer->limit) {
    return;
  }

  const size_t keep_backlog = 4 * 1024 * 1024;
  size_t safe_drop = 0;
  if (buffer->read_pos > keep_backlog) {
    safe_drop = buffer->read_pos - keep_backlog;
  }
  if (safe_drop == 0) {
    return;
  }

  size_t drop = buffer->size - buffer->limit;
  if (drop > safe_drop) {
    drop = safe_drop;
  }
  if (drop >= buffer->size) {
    buffer->size = 0;
    buffer->read_pos = 0;
    buffer->offset += (int64_t)drop;
    buffer->start = 0;
    return;
  }

  buffer->start += drop;
  buffer->size -= drop;
  buffer->read_pos -= drop;
  buffer->offset += (int64_t)drop;
}

static int read_packet(void *opaque, uint8_t *buf, int buf_size) {
  StreamBuffer *buffer = (StreamBuffer *)opaque;
  if (!buffer || buf_size <= 0) {
    return 0;
  }

  size_t available = buffer->size - buffer->read_pos;
  if (available == 0) {
    return buffer->eof ? AVERROR_EOF : AVERROR(EAGAIN);
  }

  size_t to_copy = available < (size_t)buf_size ? available : (size_t)buf_size;
  memcpy(buf, buffer->data + buffer->start + buffer->read_pos, to_copy);
  buffer->read_pos += to_copy;
  // Only compact when buffer is very large (>256MB) to prevent memory exhaustion
  // while avoiding frequent compaction that corrupts EBML parsing
  if (buffer->size > 256 * 1024 * 1024) {
    compact_buffer(buffer);
  }
  return (int)to_copy;
}

static int64_t seek_stream(void *opaque, int64_t offset, int whence) {
  StreamBuffer *buffer = (StreamBuffer *)opaque;
  if (!buffer) {
    return -1;
  }

  if (whence == AVSEEK_SIZE) {
    if (buffer->total_size > 0) {
      return buffer->total_size;  // Return known file size
    }
    return buffer->eof ? (int64_t)(buffer->offset + (int64_t)buffer->size) : -1;
  }

  int64_t new_pos = -1;
  int64_t current = buffer->offset + (int64_t)buffer->read_pos;
  switch (whence & ~AVSEEK_FORCE) {
    case SEEK_SET:
      new_pos = offset;
      break;
    case SEEK_CUR:
      new_pos = current + offset;
      break;
    case SEEK_END:
      if (!buffer->eof) {
        return -1;
      }
      new_pos = buffer->offset + (int64_t)buffer->size + offset;
      break;
    default:
      return -1;
  }

  if (new_pos < buffer->offset || new_pos > buffer->offset + (int64_t)buffer->size) {
    return -1;
  }

  buffer->read_pos = (size_t)(new_pos - buffer->offset);
  return new_pos;
}

static void free_rgba_buffers(FFmpegWasmContext *ctx) {
  if (!ctx) {
    return;
  }
  if (ctx->rgba_data[0]) {
    av_freep(&ctx->rgba_data[0]);
    ctx->rgba_data[1] = NULL;
    ctx->rgba_data[2] = NULL;
    ctx->rgba_data[3] = NULL;
  }
  ctx->rgba_size = 0;
  ctx->rgba_width = 0;
  ctx->rgba_height = 0;
  ctx->rgba_src_fmt = AV_PIX_FMT_NONE;
}

static void free_audio_buffers(FFmpegWasmContext *ctx) {
  if (!ctx) {
    return;
  }
  if (ctx->audio_data) {
    av_freep(&ctx->audio_data);
  }
  ctx->audio_linesize = 0;
  ctx->audio_nb_samples = 0;
  ctx->audio_pts_seconds = 0.0;
}

static void close_subtitle_decoder(FFmpegWasmContext *ctx) {
  if (!ctx) {
    return;
  }
  if (ctx->ass_track) {
    ass_free_track(ctx->ass_track);
    ctx->ass_track = NULL;
  }
  if (ctx->subtitle_codec) {
    avcodec_free_context(&ctx->subtitle_codec);
  }
  ctx->subtitle_stream_index = -1;
}

static void free_ass_renderer(FFmpegWasmContext *ctx) {
  if (!ctx) {
    return;
  }
  close_subtitle_decoder(ctx);
  if (ctx->ass_renderer) {
    ass_renderer_done(ctx->ass_renderer);
    ctx->ass_renderer = NULL;
  }
  if (ctx->ass_library) {
    ass_library_done(ctx->ass_library);
    ctx->ass_library = NULL;
  }
}

static int init_ass_library(FFmpegWasmContext *ctx) {
  if (!ctx) {
    return AVERROR(EINVAL);
  }
  if (ctx->ass_library) {
    return 0;
  }

  ctx->ass_library = ass_library_init();
  if (!ctx->ass_library) {
    return AVERROR(ENOMEM);
  }

  ctx->ass_renderer = ass_renderer_init(ctx->ass_library);
  if (!ctx->ass_renderer) {
    ass_library_done(ctx->ass_library);
    ctx->ass_library = NULL;
    return AVERROR(ENOMEM);
  }

  // Use embedded font only (no fontconfig); JS side injects "Inter"
  ass_set_fonts(ctx->ass_renderer, NULL, "Inter", 0, NULL, 1);
  return 0;
}

static void blend_ass_image(uint8_t *dst, int dst_stride, int dst_width, int dst_height, ASS_Image *img) {
  while (img) {
    if (img->w == 0 || img->h == 0 || !img->bitmap) {
      img = img->next;
      continue;
    }

    // libass uses AABBGGRR ordering
    uint8_t a = 255 - ((img->color >> 24) & 0xFF);
    uint8_t b = (img->color >> 16) & 0xFF;
    uint8_t g = (img->color >> 8) & 0xFF;
    uint8_t r = img->color & 0xFF;

    for (int y = 0; y < img->h; y++) {
      int dst_y = img->dst_y + y;
      if (dst_y < 0 || dst_y >= dst_height) {
        continue;
      }

      uint8_t *src_row = img->bitmap + y * img->stride;
      uint8_t *dst_row = dst + dst_y * dst_stride;

      for (int x = 0; x < img->w; x++) {
        int dst_x = img->dst_x + x;
        if (dst_x < 0 || dst_x >= dst_width) {
          continue;
        }

        uint8_t alpha = (src_row[x] * a) / 255;
        if (alpha == 0) {
          continue;
        }

        uint8_t *pixel = dst_row + dst_x * 4;
        if (alpha == 255) {
          pixel[0] = r;
          pixel[1] = g;
          pixel[2] = b;
          pixel[3] = 255;
        } else {
          pixel[0] = (pixel[0] * (255 - alpha) + r * alpha) / 255;
          pixel[1] = (pixel[1] * (255 - alpha) + g * alpha) / 255;
          pixel[2] = (pixel[2] * (255 - alpha) + b * alpha) / 255;
          pixel[3] = (pixel[3] * (255 - alpha) + 255 * alpha) / 255;
        }
      }
    }
    img = img->next;
  }
}

static void reset_decoder(FFmpegWasmContext *ctx) {
  if (!ctx) {
    return;
  }

  if (ctx->packet) {
    av_packet_free(&ctx->packet);
  }
  if (ctx->video_frame) {
    av_frame_free(&ctx->video_frame);
  }
  if (ctx->audio_frame) {
    av_frame_free(&ctx->audio_frame);
  }
  if (ctx->video_codec) {
    avcodec_free_context(&ctx->video_codec);
  }
  if (ctx->audio_codec) {
    avcodec_free_context(&ctx->audio_codec);
  }
  free_ass_renderer(ctx);
  if (ctx->fmt) {
    avformat_close_input(&ctx->fmt);
  }
  if (ctx->avio) {
    avio_context_free(&ctx->avio);
  }
  if (ctx->sws) {
    sws_freeContext(ctx->sws);
    ctx->sws = NULL;
  }
  if (ctx->swr) {
    swr_free(&ctx->swr);
  }

  free_rgba_buffers(ctx);
  free_audio_buffers(ctx);

  ctx->opened = 0;
  ctx->draining = 0;
  ctx->video_eof = 0;
  ctx->audio_eof = 0;
  ctx->video_flush_sent = 0;
  ctx->audio_flush_sent = 0;
  ctx->video_stream_index = -1;
  ctx->audio_stream_index = -1;
  ctx->subtitle_stream_index = -1;
  ctx->video_time_base = (AVRational){0, 1};
  ctx->audio_time_base = (AVRational){0, 1};
  ctx->audio_channels = 0;
  ctx->audio_sample_rate = 0;
  ctx->subtitles_enabled = 0;
}

static int setup_audio_resampler(FFmpegWasmContext *ctx) {
  if (!ctx || !ctx->audio_codec) {
    return AVERROR(EINVAL);
  }
  if (ctx->swr) {
    return 0;
  }

  if (ctx->audio_codec->ch_layout.nb_channels == 0) {
    av_channel_layout_default(&ctx->audio_codec->ch_layout, 2);
  }

  AVChannelLayout out_layout;
  av_channel_layout_default(&out_layout, 2);
  int out_channels = out_layout.nb_channels;
  const int out_rate = 48000;

  int ret = swr_alloc_set_opts2(
      &ctx->swr,
      &out_layout,
      AV_SAMPLE_FMT_FLT,
      out_rate,
      &ctx->audio_codec->ch_layout,
      ctx->audio_codec->sample_fmt,
      ctx->audio_codec->sample_rate,  // use actual input sample rate
      0,
      NULL);
  av_channel_layout_uninit(&out_layout);
  if (ret < 0) {
    return ret;
  }

  ret = swr_init(ctx->swr);
  if (ret < 0) {
    swr_free(&ctx->swr);
    return ret;
  }

  ctx->audio_channels = out_channels;
  ctx->audio_sample_rate = out_rate;
  return 0;
}

static int convert_audio_frame(FFmpegWasmContext *ctx) {
  if (!ctx || !ctx->audio_frame || !ctx->audio_codec) {
    return AVERROR(EINVAL);
  }

  int ret = setup_audio_resampler(ctx);
  if (ret < 0) {
    return ret;
  }

  int out_samples = swr_get_out_samples(ctx->swr, ctx->audio_frame->nb_samples);
  if (out_samples <= 0) {
    return AVERROR(EINVAL);
  }

  free_audio_buffers(ctx);

  ret = av_samples_alloc(
      &ctx->audio_data,
      &ctx->audio_linesize,
      ctx->audio_channels,
      out_samples,
      AV_SAMPLE_FMT_FLT,
      0);
  if (ret < 0) {
    return ret;
  }

  int converted = swr_convert(
      ctx->swr,
      &ctx->audio_data,
      out_samples,
      (const uint8_t **)ctx->audio_frame->extended_data,
      ctx->audio_frame->nb_samples);
  if (converted < 0) {
    return converted;
  }

  ctx->audio_nb_samples = converted;

  int64_t pts = ctx->audio_frame->best_effort_timestamp;
  if (pts == AV_NOPTS_VALUE || ctx->audio_time_base.den == 0) {
    ctx->audio_pts_seconds = 0.0;
  } else {
    ctx->audio_pts_seconds = pts * av_q2d(ctx->audio_time_base);
  }

  return 0;
}

static int receive_video_frame(FFmpegWasmContext *ctx) {
  if (!ctx || !ctx->video_codec || !ctx->video_frame) {
    return AVERROR(EAGAIN);
  }

  av_frame_unref(ctx->video_frame);
  int ret = avcodec_receive_frame(ctx->video_codec, ctx->video_frame);
  if (ret == 0) {
    return 1;
  }
  if (ret == AVERROR_EOF) {
    ctx->video_eof = 1;
    return AVERROR(EAGAIN);
  }
  return ret;
}

static int receive_audio_frame(FFmpegWasmContext *ctx) {
  if (!ctx || !ctx->audio_codec || !ctx->audio_frame) {
    return AVERROR(EAGAIN);
  }

  av_frame_unref(ctx->audio_frame);
  int ret = avcodec_receive_frame(ctx->audio_codec, ctx->audio_frame);
  if (ret == 0) {
    ret = convert_audio_frame(ctx);
    if (ret < 0) {
      return ret;
    }
    return 2;
  }
  if (ret == AVERROR_EOF) {
    ctx->audio_eof = 1;
    return AVERROR(EAGAIN);
  }
  return ret;
}

static int reopen_video_stream(FFmpegWasmContext *ctx, int stream_index) {
  if (!ctx || !ctx->fmt) {
    return AVERROR(EINVAL);
  }
  if (stream_index < 0 || stream_index >= (int)ctx->fmt->nb_streams) {
    return AVERROR(EINVAL);
  }

  AVStream *stream = ctx->fmt->streams[stream_index];
  if (!stream || !stream->codecpar) {
    return AVERROR(EINVAL);
  }
  if (stream->codecpar->codec_type != AVMEDIA_TYPE_VIDEO) {
    return AVERROR(EINVAL);
  }

  const AVCodec *decoder = avcodec_find_decoder(stream->codecpar->codec_id);
  if (!decoder) {
    return AVERROR_DECODER_NOT_FOUND;
  }

  AVCodecContext *codec = avcodec_alloc_context3(decoder);
  if (!codec) {
    return AVERROR(ENOMEM);
  }
  int ret = avcodec_parameters_to_context(codec, stream->codecpar);
  if (ret < 0) {
    avcodec_free_context(&codec);
    return ret;
  }
  codec->thread_count = 1;
  codec->thread_type = 0;

  ret = avcodec_open2(codec, decoder, NULL);
  if (ret < 0) {
    avcodec_free_context(&codec);
    return ret;
  }

  if (ctx->video_codec) {
    avcodec_free_context(&ctx->video_codec);
  }
  ctx->video_codec = codec;
  ctx->video_stream_index = stream_index;
  ctx->video_time_base = stream->time_base;
  ctx->video_eof = 0;
  ctx->video_flush_sent = 0;

  if (ctx->sws) {
    sws_freeContext(ctx->sws);
    ctx->sws = NULL;
  }
  free_rgba_buffers(ctx);
  return 0;
}

static void close_audio_decoder(FFmpegWasmContext *ctx) {
  if (!ctx) {
    return;
  }
  if (ctx->audio_codec) {
    avcodec_free_context(&ctx->audio_codec);
  }
  if (ctx->swr) {
    swr_free(&ctx->swr);
  }
  free_audio_buffers(ctx);
  ctx->audio_stream_index = -1;
  ctx->audio_time_base = (AVRational){0, 1};
  ctx->audio_channels = 0;
  ctx->audio_sample_rate = 0;
  ctx->audio_pts_seconds = 0.0;
  ctx->audio_nb_samples = 0;
}

static int reopen_audio_stream(FFmpegWasmContext *ctx, int stream_index) {
  if (!ctx || !ctx->fmt) {
    return AVERROR(EINVAL);
  }
  if (stream_index < 0 || stream_index >= (int)ctx->fmt->nb_streams) {
    return AVERROR(EINVAL);
  }

  AVStream *stream = ctx->fmt->streams[stream_index];
  if (!stream || !stream->codecpar) {
    return AVERROR(EINVAL);
  }
  if (stream->codecpar->codec_type != AVMEDIA_TYPE_AUDIO) {
    return AVERROR(EINVAL);
  }

  const AVCodec *decoder = avcodec_find_decoder(stream->codecpar->codec_id);
  if (!decoder) {
    return AVERROR_DECODER_NOT_FOUND;
  }

  AVCodecContext *codec = avcodec_alloc_context3(decoder);
  if (!codec) {
    return AVERROR(ENOMEM);
  }
  int ret = avcodec_parameters_to_context(codec, stream->codecpar);
  if (ret < 0) {
    avcodec_free_context(&codec);
    return ret;
  }
  codec->thread_count = 1;
  codec->thread_type = 0;

  ret = avcodec_open2(codec, decoder, NULL);
  if (ret < 0) {
    avcodec_free_context(&codec);
    return ret;
  }

  close_audio_decoder(ctx);
  ctx->audio_codec = codec;
  ctx->audio_stream_index = stream_index;
  ctx->audio_time_base = stream->time_base;
  ctx->audio_enabled = 1;
  ctx->audio_eof = 0;
  ctx->audio_flush_sent = 0;
  return 0;
}

static int reopen_subtitle_stream(FFmpegWasmContext *ctx, int stream_index) {
  if (!ctx || !ctx->fmt) {
    return AVERROR(EINVAL);
  }
  if (stream_index < 0 || stream_index >= (int)ctx->fmt->nb_streams) {
    return AVERROR(EINVAL);
  }

  AVStream *stream = ctx->fmt->streams[stream_index];
  if (!stream || !stream->codecpar) {
    return AVERROR(EINVAL);
  }
  if (stream->codecpar->codec_type != AVMEDIA_TYPE_SUBTITLE) {
    return AVERROR(EINVAL);
  }

  int ret = init_ass_library(ctx);
  if (ret < 0) {
    return ret;
  }

  const AVCodec *decoder = avcodec_find_decoder(stream->codecpar->codec_id);
  if (!decoder) {
    return AVERROR_DECODER_NOT_FOUND;
  }

  AVCodecContext *codec = avcodec_alloc_context3(decoder);
  if (!codec) {
    return AVERROR(ENOMEM);
  }
  ret = avcodec_parameters_to_context(codec, stream->codecpar);
  if (ret < 0) {
    avcodec_free_context(&codec);
    return ret;
  }

  ret = avcodec_open2(codec, decoder, NULL);
  if (ret < 0) {
    avcodec_free_context(&codec);
    return ret;
  }

  close_subtitle_decoder(ctx);
  ctx->subtitle_codec = codec;
  ctx->subtitle_stream_index = stream_index;

  ctx->ass_track = ass_new_track(ctx->ass_library);
  if (!ctx->ass_track) {
    close_subtitle_decoder(ctx);
    return AVERROR(ENOMEM);
  }

  if (codec->subtitle_header && codec->subtitle_header_size > 0) {
    ass_process_codec_private(ctx->ass_track, (char *)codec->subtitle_header, codec->subtitle_header_size);
  }

  ctx->subtitles_enabled = 1;
  return 0;
}

static void process_subtitle_packet(FFmpegWasmContext *ctx, AVPacket *pkt) {
  if (!ctx || !ctx->subtitle_codec || !ctx->ass_track || !pkt) {
    return;
  }

  AVSubtitle sub;
  memset(&sub, 0, sizeof(sub));
  int got_sub = 0;

  int ret = avcodec_decode_subtitle2(ctx->subtitle_codec, &sub, &got_sub, pkt);
  if (ret < 0 || !got_sub) {
    return;
  }

  int64_t start_time = pkt->pts;
  if (start_time == AV_NOPTS_VALUE) {
    start_time = pkt->dts;
  }
  if (start_time == AV_NOPTS_VALUE) {
    avsubtitle_free(&sub);
    return;
  }

  AVStream *stream = ctx->fmt->streams[ctx->subtitle_stream_index];
  double start_sec = start_time * av_q2d(stream->time_base);
  double duration_sec = (double)sub.end_display_time / 1000.0;
  if (duration_sec <= 0.0) {
    // Some decoders (e.g. ASS) can emit zero durations; fall back to packet duration or a small default
    if (pkt->duration && pkt->duration != AV_NOPTS_VALUE) {
      duration_sec = pkt->duration * av_q2d(stream->time_base);
    }
    if (duration_sec <= 0.0) {
      duration_sec = 4.0;  // conservative default so text is visible
    }
  }
  double start_ms = start_sec * 1000.0;
  double end_ms = (start_sec + duration_sec) * 1000.0;

  for (unsigned int i = 0; i < sub.num_rects; i++) {
    AVSubtitleRect *rect = sub.rects[i];
    if (!rect) {
      continue;
    }

    if (rect->type == SUBTITLE_ASS && rect->ass) {
      ass_process_chunk(ctx->ass_track, rect->ass, strlen(rect->ass),
                        (long long)(start_sec * 1000), (long long)(duration_sec * 1000));

      // Emit a debug log back to JS for visibility in the UI log panel
      EM_ASM_({
        postMessage({
          type: "subtitleLog",
          text: UTF8ToString($0),
          startMs: $1,
          endMs: $2
        });
      }, rect->ass, (int)start_ms, (int)end_ms);
    } else if (rect->type == SUBTITLE_TEXT && rect->text) {
      char buf[4096];
      snprintf(buf, sizeof(buf), "Dialogue: 0,0:00:00.00,0:00:00.00,Default,,0,0,0,,%s", rect->text);
      ass_process_chunk(ctx->ass_track, buf, strlen(buf),
                        (long long)(start_sec * 1000), (long long)(duration_sec * 1000));

      EM_ASM_({
        postMessage({
          type: "subtitleLog",
          text: UTF8ToString($0),
          startMs: $1,
          endMs: $2
        });
      }, rect->text, (int)start_ms, (int)end_ms);
    }
  }

  avsubtitle_free(&sub);
}

EMSCRIPTEN_KEEPALIVE unsigned int ffmpeg_wasm_avcodec_version(void) {
  return avcodec_version();
}

EMSCRIPTEN_KEEPALIVE unsigned int ffmpeg_wasm_avformat_version(void) {
  return avformat_version();
}

EMSCRIPTEN_KEEPALIVE unsigned int ffmpeg_wasm_avutil_version(void) {
  return avutil_version();
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_has_hevc_av1(void) {
  const AVCodec *hevc = avcodec_find_decoder(AV_CODEC_ID_HEVC);
  const AVCodec *av1 = avcodec_find_decoder(AV_CODEC_ID_AV1);
  return (hevc != NULL) && (av1 != NULL);
}

EMSCRIPTEN_KEEPALIVE uintptr_t ffmpeg_wasm_create(int initial_capacity) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)calloc(1, sizeof(FFmpegWasmContext));
  if (!ctx) {
    return 0;
  }

  if (initial_capacity > 0) {
    ctx->buffer.capacity = (size_t)initial_capacity;
    ctx->buffer.data = av_malloc(ctx->buffer.capacity);
    if (!ctx->buffer.data) {
      free(ctx);
      return 0;
    }
  }

  ctx->video_stream_index = -1;
  ctx->audio_stream_index = -1;
  ctx->subtitle_stream_index = -1;
  ctx->rgba_src_fmt = AV_PIX_FMT_NONE;
  ctx->video_time_base = (AVRational){0, 1};
  ctx->audio_time_base = (AVRational){0, 1};
  ctx->audio_enabled = 1;
  ctx->subtitles_enabled = 0;
  ctx->buffer.start = 0;
  ctx->buffer.limit = 0;
  ctx->buffer.keep_all = 1;  // Keep all data until open succeeds
  ctx->buffer.total_size = -1;
  av_log_set_level(AV_LOG_ERROR);
  return (uintptr_t)ctx;
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_destroy(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx) {
    return;
  }

  reset_decoder(ctx);
  if (ctx->buffer.data) {
    av_freep(&ctx->buffer.data);
  }
  free(ctx);
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_append(uintptr_t handle, const uint8_t *data, int len) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx) {
    av_log(NULL, AV_LOG_ERROR, "append: ctx is NULL\n");
    return AVERROR(EINVAL);
  }
  if (!data) {
    av_log(NULL, AV_LOG_ERROR, "append: data is NULL\n");
    return AVERROR(EINVAL);
  }
  if (len < 0) {
    av_log(NULL, AV_LOG_ERROR, "append: len is negative (%d)\n", len);
    return AVERROR(EINVAL);
  }
  if (len == 0) {
    return 0;
  }

  size_t needed = ctx->buffer.start + ctx->buffer.size + (size_t)len;
  int ret = ensure_capacity(&ctx->buffer, needed);
  if (ret < 0) {
    av_log(NULL, AV_LOG_ERROR, "append: ensure_capacity failed (%d), needed=%zu, start=%zu, size=%zu\n",
           ret, needed, ctx->buffer.start, ctx->buffer.size);
    return ret;
  }

  memcpy(ctx->buffer.data + ctx->buffer.start + ctx->buffer.size, data, (size_t)len);
  ctx->buffer.size += (size_t)len;
  enforce_buffer_limit(&ctx->buffer);
  if (ctx->avio) {
    ctx->avio->eof_reached = 0;
    ctx->avio->error = 0;
  }
  return len;
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_set_eof(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (ctx) {
    ctx->buffer.eof = 1;
    if (ctx->avio) {
      ctx->avio->eof_reached = 0;
      ctx->avio->error = 0;
    }
  }
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_set_keep_all(uintptr_t handle, int enabled) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (ctx) {
    ctx->buffer.keep_all = enabled ? 1 : 0;
  }
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_set_buffer_limit(uintptr_t handle, int limit_bytes) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx) {
    return;
  }
  if (limit_bytes <= 0) {
    ctx->buffer.limit = 0;
  } else {
    ctx->buffer.limit = (size_t)limit_bytes;
  }
  enforce_buffer_limit(&ctx->buffer);
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_set_file_size(uintptr_t handle, double size) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (ctx) {
    ctx->buffer.total_size = (int64_t)size;
  }
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_set_buffer_offset(uintptr_t handle, double offset) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (ctx) {
    ctx->buffer.offset = (int64_t)offset;
  }
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_set_audio_enabled(uintptr_t handle, int enabled) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx) {
    return;
  }
  ctx->audio_enabled = enabled ? 1 : 0;
  if (!ctx->audio_enabled) {
    free_audio_buffers(ctx);
    ctx->audio_eof = 1;
    ctx->audio_flush_sent = 1;
    if (ctx->audio_codec) {
      avcodec_flush_buffers(ctx->audio_codec);
    }
  } else {
    ctx->audio_eof = 0;
    ctx->audio_flush_sent = 0;
    if (ctx->audio_codec) {
      avcodec_flush_buffers(ctx->audio_codec);
    }
  }
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_open(uintptr_t handle, const char *format_name) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx) {
    return AVERROR(EINVAL);
  }
  if (ctx->opened) {
    return 0;
  }

  ctx->buffer.read_pos = 0;

  const int avio_buffer_size = 32 * 1024;
  uint8_t *avio_buffer = av_malloc(avio_buffer_size);
  if (!avio_buffer) {
    return AVERROR(ENOMEM);
  }

  ctx->avio = avio_alloc_context(
      avio_buffer,
      avio_buffer_size,
      0,
      &ctx->buffer,
      read_packet,
      NULL,
      seek_stream);
  if (!ctx->avio) {
    av_free(avio_buffer);
    return AVERROR(ENOMEM);
  }
  // Disable seeking during open to prevent FFmpeg from seeking to find
  // container metadata that isn't buffered yet. We'll enable it later
  // once the file is opened and we can handle seek failures gracefully.
  ctx->avio->seekable = 0;

  ctx->fmt = avformat_alloc_context();
  if (!ctx->fmt) {
    reset_decoder(ctx);
    return AVERROR(ENOMEM);
  }

  ctx->fmt->pb = ctx->avio;
  ctx->fmt->flags |= AVFMT_FLAG_CUSTOM_IO;
  ctx->fmt->flags |= AVFMT_FLAG_NONBLOCK;

  const AVInputFormat *input_format = NULL;
  if (format_name && format_name[0]) {
    input_format = av_find_input_format(format_name);
  }

  int ret = avformat_open_input(&ctx->fmt, NULL, input_format, NULL);
  if (ret < 0) {
    reset_decoder(ctx);
    return ret;
  }

  const AVCodec *video_decoder = NULL;
  ret = av_find_best_stream(ctx->fmt, AVMEDIA_TYPE_VIDEO, -1, -1, &video_decoder, 0);
  if (ret < 0 || !video_decoder) {
    reset_decoder(ctx);
    return ret < 0 ? ret : AVERROR_DECODER_NOT_FOUND;
  }

  ctx->video_stream_index = ret;
  AVStream *video_stream = ctx->fmt->streams[ctx->video_stream_index];
  ctx->video_time_base = video_stream->time_base;

  ctx->video_codec = avcodec_alloc_context3(video_decoder);
  if (!ctx->video_codec) {
    reset_decoder(ctx);
    return AVERROR(ENOMEM);
  }

  ret = avcodec_parameters_to_context(ctx->video_codec, video_stream->codecpar);
  if (ret < 0) {
    reset_decoder(ctx);
    return ret;
  }

  ctx->video_codec->thread_count = 1;
  ctx->video_codec->thread_type = 0;

  ret = avcodec_open2(ctx->video_codec, video_decoder, NULL);
  if (ret < 0) {
    reset_decoder(ctx);
    return ret;
  }

  const AVCodec *audio_decoder = NULL;
  ret = av_find_best_stream(ctx->fmt, AVMEDIA_TYPE_AUDIO, -1, -1, &audio_decoder, 0);
  if (ret >= 0 && audio_decoder) {
    ctx->audio_stream_index = ret;
    AVStream *audio_stream = ctx->fmt->streams[ctx->audio_stream_index];
    ctx->audio_time_base = audio_stream->time_base;

    ctx->audio_codec = avcodec_alloc_context3(audio_decoder);
    if (!ctx->audio_codec) {
      reset_decoder(ctx);
      return AVERROR(ENOMEM);
    }

    ret = avcodec_parameters_to_context(ctx->audio_codec, audio_stream->codecpar);
    if (ret < 0) {
      reset_decoder(ctx);
      return ret;
    }

    ctx->audio_codec->thread_count = 1;
    ctx->audio_codec->thread_type = 0;

    ret = avcodec_open2(ctx->audio_codec, audio_decoder, NULL);
    if (ret < 0) {
      reset_decoder(ctx);
      return ret;
    }
  }

  ctx->packet = av_packet_alloc();
  ctx->video_frame = av_frame_alloc();
  ctx->audio_frame = av_frame_alloc();
  if (!ctx->packet || !ctx->video_frame || !ctx->audio_frame) {
    reset_decoder(ctx);
    return AVERROR(ENOMEM);
  }

  ctx->opened = 1;
  ctx->draining = 0;
  ctx->video_eof = 0;
  ctx->audio_eof = 0;
  ctx->video_flush_sent = 0;
  ctx->audio_flush_sent = 0;

  // Now that file is opened, enable seeking for playback
  // seek_stream will return -1 if position is outside buffered range
  if (ctx->avio) {
    ctx->avio->seekable = AVIO_SEEKABLE_NORMAL;
  }

  // Allow buffer compaction now that open succeeded
  ctx->buffer.keep_all = 0;

  return 0;
}

EMSCRIPTEN_KEEPALIVE double ffmpeg_wasm_duration_seconds(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt) {
    return 0.0;
  }
  if (ctx->fmt->duration != AV_NOPTS_VALUE && ctx->fmt->duration > 0) {
    return ctx->fmt->duration / (double)AV_TIME_BASE;
  }

  double best = 0.0;
  for (unsigned int i = 0; i < ctx->fmt->nb_streams; i++) {
    AVStream *stream = ctx->fmt->streams[i];
    if (!stream) {
      continue;
    }
    if (stream->duration == AV_NOPTS_VALUE || stream->duration <= 0) {
      continue;
    }
    double seconds = stream->duration * av_q2d(stream->time_base);
    if (seconds > best) {
      best = seconds;
    }
  }
  return best;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_seek_seconds(uintptr_t handle, double seconds) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt || !ctx->opened) {
    return AVERROR(EINVAL);
  }

  if (seconds < 0.0) {
    seconds = 0.0;
  }
  int64_t target = (int64_t)(seconds * AV_TIME_BASE);
  // Allow seeking to a keyframe before or at the target, but not after.
  // This ensures we don't overshoot and end up at a random future position.
  int ret = avformat_seek_file(ctx->fmt, -1, INT64_MIN, target, target, 0);
  if (ret < 0) {
    return ret;
  }

  if (ctx->video_codec) {
    avcodec_flush_buffers(ctx->video_codec);
  }
  if (ctx->audio_codec) {
    avcodec_flush_buffers(ctx->audio_codec);
  }

  ctx->draining = 0;
  ctx->video_eof = 0;
  ctx->audio_eof = 0;
  ctx->video_flush_sent = 0;
  ctx->audio_flush_sent = 0;
  return 0;
}

// Prepare for re-streaming from a new byte offset.
// Keeps format context and codecs intact, just flushes buffers and resets stream position.
// JS should call this, then stream new data from file.slice(new_offset).
EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_prepare_restream(uintptr_t handle, double new_byte_offset) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt || !ctx->opened) {
    return AVERROR(EINVAL);
  }

  int64_t byte_pos = (int64_t)new_byte_offset;

  // Flush codec buffers
  if (ctx->video_codec) {
    avcodec_flush_buffers(ctx->video_codec);
  }
  if (ctx->audio_codec) {
    avcodec_flush_buffers(ctx->audio_codec);
  }

  // Clear stream buffer but keep it allocated
  ctx->buffer.start = 0;
  ctx->buffer.size = 0;
  ctx->buffer.read_pos = 0;
  ctx->buffer.eof = 0;
  ctx->buffer.offset = byte_pos;

  // Reset EOF/draining state
  ctx->draining = 0;
  ctx->video_eof = 0;
  ctx->audio_eof = 0;
  ctx->video_flush_sent = 0;
  ctx->audio_flush_sent = 0;

  // Tell FFmpeg's AVIO layer about the new position
  // This is critical - without this, FFmpeg will try to read from the old position
  if (ctx->avio) {
    ctx->avio->pos = byte_pos;
    // Clear any internal AVIO buffer
    ctx->avio->buf_ptr = ctx->avio->buffer;
    ctx->avio->buf_end = ctx->avio->buffer;
  }

  return 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_read_frame(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->opened || !ctx->video_codec || !ctx->fmt) {
    return AVERROR(EINVAL);
  }

  int ret = AVERROR(EAGAIN);
  if (ctx->audio_enabled && ctx->audio_codec) {
    ret = receive_audio_frame(ctx);
    if (ret == 2) {
      return 2;
    }
    if (ret < 0 && ret != AVERROR(EAGAIN)) {
      return ret;
    }
  }

  ret = receive_video_frame(ctx);
  if (ret == 1) {
    return 1;
  }
  if (ret < 0 && ret != AVERROR(EAGAIN)) {
    return ret;
  }

  if (ctx->draining && (ctx->video_eof || !ctx->video_codec) &&
      (ctx->audio_eof || !ctx->audio_codec || !ctx->audio_enabled)) {
    return -1;
  }

  for (;;) {
    ret = av_read_frame(ctx->fmt, ctx->packet);
    if (ret == AVERROR_EOF) {
      ctx->draining = 1;
      if (ctx->video_codec && !ctx->video_flush_sent) {
        ctx->video_flush_sent = 1;
        avcodec_send_packet(ctx->video_codec, NULL);
      }
      if (ctx->audio_enabled && ctx->audio_codec && !ctx->audio_flush_sent) {
        ctx->audio_flush_sent = 1;
        avcodec_send_packet(ctx->audio_codec, NULL);
      }
      continue;
    }
    if (ret == AVERROR(EAGAIN)) {
      return 0;
    }
    if (ret < 0) {
      return ret;
    }

    if (ctx->packet->stream_index == ctx->video_stream_index) {
      ret = avcodec_send_packet(ctx->video_codec, ctx->packet);
      av_packet_unref(ctx->packet);
      if (ret == AVERROR(EAGAIN)) {
        ret = receive_video_frame(ctx);
        if (ret == 1) {
          return 1;
        }
        if (ret < 0 && ret != AVERROR(EAGAIN)) {
          return ret;
        }
      } else if (ret < 0) {
        return ret;
      }
    } else if (ctx->packet->stream_index == ctx->audio_stream_index) {
      if (ctx->audio_enabled && ctx->audio_codec) {
        ret = avcodec_send_packet(ctx->audio_codec, ctx->packet);
        av_packet_unref(ctx->packet);
        if (ret == AVERROR(EAGAIN)) {
          ret = receive_audio_frame(ctx);
          if (ret == 2) {
            return 2;
          }
          if (ret < 0 && ret != AVERROR(EAGAIN)) {
            return ret;
          }
        } else if (ret < 0) {
          return ret;
        }
      } else {
        av_packet_unref(ctx->packet);
      }
    } else if (ctx->packet->stream_index == ctx->subtitle_stream_index) {
      if (ctx->subtitles_enabled && ctx->subtitle_codec) {
        process_subtitle_packet(ctx, ctx->packet);
      }
      av_packet_unref(ctx->packet);
    } else {
      av_packet_unref(ctx->packet);
    }

    if (ctx->audio_enabled && ctx->audio_codec) {
      ret = receive_audio_frame(ctx);
      if (ret == 2) {
        return 2;
      }
      if (ret < 0 && ret != AVERROR(EAGAIN)) {
        return ret;
      }
    }

    ret = receive_video_frame(ctx);
    if (ret == 1) {
      return 1;
    }
    if (ret < 0 && ret != AVERROR(EAGAIN)) {
      return ret;
    }

    if (ctx->draining && (ctx->video_eof || !ctx->video_codec) &&
        (ctx->audio_eof || !ctx->audio_codec || !ctx->audio_enabled)) {
      return -1;
    }
  }
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_read_video_frame(uintptr_t handle) {
  for (;;) {
    int ret = ffmpeg_wasm_read_frame(handle);
    if (ret == 1 || ret <= 0) {
      return ret;
    }
  }
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_video_width(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return (ctx && ctx->video_codec) ? ctx->video_codec->width : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_video_height(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return (ctx && ctx->video_codec) ? ctx->video_codec->height : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_frame_format(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return (ctx && ctx->video_frame) ? ctx->video_frame->format : AV_PIX_FMT_NONE;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_frame_data_ptr(uintptr_t handle, int plane) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->video_frame || plane < 0 || plane >= 4) {
    return 0;
  }
  return (int)(uintptr_t)ctx->video_frame->data[plane];
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_frame_linesize(uintptr_t handle, int plane) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->video_frame || plane < 0 || plane >= 4) {
    return 0;
  }
  return ctx->video_frame->linesize[plane];
}

EMSCRIPTEN_KEEPALIVE double ffmpeg_wasm_frame_pts_seconds(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->video_frame || ctx->video_time_base.den == 0) {
    return 0.0;
  }
  int64_t pts = ctx->video_frame->best_effort_timestamp;
  if (pts == AV_NOPTS_VALUE) {
    return 0.0;
  }
  return pts * av_q2d(ctx->video_time_base);
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_frame_to_rgba(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->video_frame || ctx->video_frame->width <= 0 ||
      ctx->video_frame->height <= 0) {
    return AVERROR(EINVAL);
  }

  if (!ctx->sws || ctx->rgba_width != ctx->video_frame->width ||
      ctx->rgba_height != ctx->video_frame->height ||
      ctx->rgba_src_fmt != ctx->video_frame->format) {
    if (ctx->sws) {
      sws_freeContext(ctx->sws);
      ctx->sws = NULL;
    }
    free_rgba_buffers(ctx);

    ctx->sws = sws_getContext(
        ctx->video_frame->width,
        ctx->video_frame->height,
        (enum AVPixelFormat)ctx->video_frame->format,
        ctx->video_frame->width,
        ctx->video_frame->height,
        AV_PIX_FMT_RGBA,
        SWS_BILINEAR,
        NULL,
        NULL,
        NULL);
    if (!ctx->sws) {
      return AVERROR(ENOMEM);
    }

    ctx->rgba_size = av_image_alloc(
        ctx->rgba_data,
        ctx->rgba_linesize,
        ctx->video_frame->width,
        ctx->video_frame->height,
        AV_PIX_FMT_RGBA,
        1);
    if (ctx->rgba_size < 0) {
      free_rgba_buffers(ctx);
      return ctx->rgba_size;
    }

    ctx->rgba_width = ctx->video_frame->width;
    ctx->rgba_height = ctx->video_frame->height;
    ctx->rgba_src_fmt = (enum AVPixelFormat)ctx->video_frame->format;
  }

  int lines = sws_scale(
      ctx->sws,
      (const uint8_t *const *)ctx->video_frame->data,
      ctx->video_frame->linesize,
      0,
      ctx->video_frame->height,
      ctx->rgba_data,
      ctx->rgba_linesize);
  if (lines <= 0) {
    return AVERROR(EINVAL);
  }

  return 1;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_rgba_ptr(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return (ctx && ctx->rgba_data[0]) ? (int)(uintptr_t)ctx->rgba_data[0] : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_rgba_stride(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return (ctx && ctx->rgba_data[0]) ? ctx->rgba_linesize[0] : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_rgba_size(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->rgba_size : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_audio_channels(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->audio_channels : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_audio_sample_rate(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->audio_sample_rate : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_audio_nb_samples(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->audio_nb_samples : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_audio_ptr(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return (ctx && ctx->audio_data) ? (int)(uintptr_t)ctx->audio_data : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_audio_bytes(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->audio_data) {
    return 0;
  }
  return ctx->audio_nb_samples * ctx->audio_channels * (int)sizeof(float);
}

EMSCRIPTEN_KEEPALIVE double ffmpeg_wasm_audio_pts_seconds(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->audio_pts_seconds : 0.0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_buffered_bytes(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx) {
    return 0;
  }
  if (ctx->buffer.size < ctx->buffer.read_pos) {
    return 0;
  }
  size_t buffered = ctx->buffer.size - ctx->buffer.read_pos;
  if (buffered > INT_MAX) {
    return INT_MAX;
  }
  return (int)buffered;
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_compact_buffer(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx) {
    return;
  }
  compact_buffer(&ctx->buffer);
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_streams_count(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt) {
    return 0;
  }
  if (ctx->fmt->nb_streams > INT_MAX) {
    return INT_MAX;
  }
  return (int)ctx->fmt->nb_streams;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_stream_media_type(uintptr_t handle, int stream_index) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt || stream_index < 0 || stream_index >= (int)ctx->fmt->nb_streams) {
    return AVMEDIA_TYPE_UNKNOWN;
  }
  AVStream *stream = ctx->fmt->streams[stream_index];
  if (!stream || !stream->codecpar) {
    return AVMEDIA_TYPE_UNKNOWN;
  }
  return stream->codecpar->codec_type;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_stream_codec_id(uintptr_t handle, int stream_index) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt || stream_index < 0 || stream_index >= (int)ctx->fmt->nb_streams) {
    return AV_CODEC_ID_NONE;
  }
  AVStream *stream = ctx->fmt->streams[stream_index];
  if (!stream || !stream->codecpar) {
    return AV_CODEC_ID_NONE;
  }
  return stream->codecpar->codec_id;
}

EMSCRIPTEN_KEEPALIVE const char *ffmpeg_wasm_stream_codec_name(uintptr_t handle, int stream_index) {
  int codec_id = ffmpeg_wasm_stream_codec_id(handle, stream_index);
  if (codec_id == AV_CODEC_ID_NONE) {
    return NULL;
  }
  return avcodec_get_name((enum AVCodecID)codec_id);
}

EMSCRIPTEN_KEEPALIVE const char *ffmpeg_wasm_stream_language(uintptr_t handle, int stream_index) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt || stream_index < 0 || stream_index >= (int)ctx->fmt->nb_streams) {
    return NULL;
  }
  AVStream *stream = ctx->fmt->streams[stream_index];
  if (!stream) {
    return NULL;
  }
  AVDictionaryEntry *tag = av_dict_get(stream->metadata, "language", NULL, 0);
  return tag ? tag->value : NULL;
}

EMSCRIPTEN_KEEPALIVE const char *ffmpeg_wasm_stream_title(uintptr_t handle, int stream_index) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt || stream_index < 0 || stream_index >= (int)ctx->fmt->nb_streams) {
    return NULL;
  }
  AVStream *stream = ctx->fmt->streams[stream_index];
  if (!stream) {
    return NULL;
  }
  AVDictionaryEntry *tag = av_dict_get(stream->metadata, "title", NULL, 0);
  return tag ? tag->value : NULL;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_stream_is_default(uintptr_t handle, int stream_index) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt || stream_index < 0 || stream_index >= (int)ctx->fmt->nb_streams) {
    return 0;
  }
  AVStream *stream = ctx->fmt->streams[stream_index];
  if (!stream) {
    return 0;
  }
  return (stream->disposition & AV_DISPOSITION_DEFAULT) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_selected_video_stream(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->video_stream_index : -1;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_selected_audio_stream(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->audio_stream_index : -1;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_audio_is_enabled(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->audio_enabled : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_select_streams(uintptr_t handle, int video_stream_index, int audio_stream_index) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt || !ctx->opened) {
    return AVERROR(EINVAL);
  }

  int v_index = video_stream_index;
  if (v_index == -1) {
    const AVCodec *decoder = NULL;
    int ret = av_find_best_stream(ctx->fmt, AVMEDIA_TYPE_VIDEO, -1, -1, &decoder, 0);
    if (ret < 0) {
      return ret;
    }
    v_index = ret;
  }
  if (v_index < 0) {
    return AVERROR(EINVAL);
  }

  int ret = reopen_video_stream(ctx, v_index);
  if (ret < 0) {
    return ret;
  }

  if (audio_stream_index == -2) {
    close_audio_decoder(ctx);
    ctx->audio_enabled = 0;
    ctx->audio_eof = 1;
    ctx->audio_flush_sent = 1;
    return 0;
  }

  int a_index = audio_stream_index;
  if (a_index == -1) {
    const AVCodec *decoder = NULL;
    int best = av_find_best_stream(ctx->fmt, AVMEDIA_TYPE_AUDIO, -1, -1, &decoder, 0);
    if (best < 0) {
      close_audio_decoder(ctx);
      ctx->audio_enabled = 0;
      ctx->audio_eof = 1;
      ctx->audio_flush_sent = 1;
      return 0;
    }
    a_index = best;
  }

  if (a_index < 0) {
    close_audio_decoder(ctx);
    ctx->audio_enabled = 0;
    ctx->audio_eof = 1;
    ctx->audio_flush_sent = 1;
    return 0;
  }

  ret = reopen_audio_stream(ctx, a_index);
  if (ret < 0) {
    return ret;
  }
  return 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_selected_subtitle_stream(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->subtitle_stream_index : -1;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_subtitles_enabled(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  return ctx ? ctx->subtitles_enabled : 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_select_subtitle_stream(uintptr_t handle, int stream_index) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->fmt || !ctx->opened) {
    return AVERROR(EINVAL);
  }

  if (stream_index == -2) {
    close_subtitle_decoder(ctx);
    ctx->subtitles_enabled = 0;
    return 0;
  }

  if (stream_index == -1) {
    int best = av_find_best_stream(ctx->fmt, AVMEDIA_TYPE_SUBTITLE, -1, -1, NULL, 0);
    if (best < 0) {
      close_subtitle_decoder(ctx);
      ctx->subtitles_enabled = 0;
      return 0;
    }
    stream_index = best;
  }

  return reopen_subtitle_stream(ctx, stream_index);
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_add_font(uintptr_t handle, const char *name, const uint8_t *data, int len) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->ass_library || !data || len <= 0) {
    return AVERROR(EINVAL);
  }
  ass_add_font(ctx->ass_library, name, (char *)data, len);
  return 0;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_render_subtitles(uintptr_t handle, double pts_seconds) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->subtitles_enabled || !ctx->ass_renderer || !ctx->ass_track) {
    return 0;
  }
  if (!ctx->rgba_data[0] || ctx->rgba_width <= 0 || ctx->rgba_height <= 0) {
    return 0;
  }

  ass_set_frame_size(ctx->ass_renderer, ctx->rgba_width, ctx->rgba_height);

  int changed = 0;
  ASS_Image *img = ass_render_frame(ctx->ass_renderer, ctx->ass_track,
                                    (long long)(pts_seconds * 1000), &changed);
  if (!img) {
    int n = ctx->ass_track ? ctx->ass_track->n_events : 0;
    long long first_start = -1;
    long long first_end = -1;
    if (ctx->ass_track && n > 0) {
      ASS_Event *ev = &ctx->ass_track->events[0];
      first_start = ev->Start;
      first_end = ev->Start + ev->Duration;
    }
    EM_ASM_({
      postMessage({
        type: "subtitleDebug",
        note: "render returned null",
        nEvents: $0,
        firstStartMs: $1,
        firstEndMs: $2
      });
    }, n, (int)first_start, (int)first_end);
    return 0;
  }

  blend_ass_image(ctx->rgba_data[0], ctx->rgba_linesize[0],
                  ctx->rgba_width, ctx->rgba_height, img);
  return 1;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_subtitle_events_count(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->ass_track) {
    return 0;
  }
  return ctx->ass_track->n_events;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_subtitle_first_start_ms(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->ass_track || ctx->ass_track->n_events <= 0) {
    return -1;
  }
  ASS_Event *ev = &ctx->ass_track->events[0];
  return (int)ev->Start;
}

EMSCRIPTEN_KEEPALIVE int ffmpeg_wasm_subtitle_first_end_ms(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->ass_track || ctx->ass_track->n_events <= 0) {
    return -1;
  }
  ASS_Event *ev = &ctx->ass_track->events[0];
  return (int)(ev->Start + ev->Duration);
}

EMSCRIPTEN_KEEPALIVE void ffmpeg_wasm_clear_subtitle_track(uintptr_t handle) {
  FFmpegWasmContext *ctx = (FFmpegWasmContext *)handle;
  if (!ctx || !ctx->ass_library) {
    return;
  }
  if (ctx->ass_track) {
    ass_free_track(ctx->ass_track);
    ctx->ass_track = ass_new_track(ctx->ass_library);
    if (ctx->ass_track && ctx->subtitle_codec &&
        ctx->subtitle_codec->subtitle_header && ctx->subtitle_codec->subtitle_header_size > 0) {
      ass_process_codec_private(ctx->ass_track, (char *)ctx->subtitle_codec->subtitle_header,
                                ctx->subtitle_codec->subtitle_header_size);
    }
  }
}
