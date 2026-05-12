#ifndef FFMPEG_WASM_INTERNAL_H
#define FFMPEG_WASM_INTERNAL_H

#include <ass/ass.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavformat/avio.h>
#include <libavutil/avutil.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
#include <stddef.h>
#include <stdint.h>

#define FFMPEG_WASM_IO_APPEND_STREAM 0
#define FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL 1
#define FFMPEG_WASM_DEFAULT_CACHE_LIMIT (384 * 1024 * 1024)
#define FFMPEG_WASM_MIN_READ_WINDOW (8 * 1024 * 1024)

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
  int64_t total_size;
} StreamBuffer;

typedef struct FFmpegWasmContext {
  StreamBuffer buffer;
  int io_mode;
  size_t cache_limit;
  uint8_t *ra_cache_data;
  size_t ra_cache_size;
  size_t ra_cache_capacity;
  int64_t ra_cache_start;
  int64_t ra_pos;
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
  int attachment_fonts_loaded;

  int last_error;
  int last_packet_stream_index;
  double last_packet_pts_seconds;
  int64_t packets_read;
  int64_t subtitle_packets_read;
} FFmpegWasmContext;

void ffmpeg_wasm_debug_install_log_bridge(void);
void ffmpeg_wasm_debug_set_last_error(FFmpegWasmContext *ctx, int error_code);
void ffmpeg_wasm_debug_post_subtitle_log(const char *text, int start_ms, int end_ms);
void ffmpeg_wasm_debug_post_subtitle_render_null(int events_count, int first_start_ms, int first_end_ms);

#endif
