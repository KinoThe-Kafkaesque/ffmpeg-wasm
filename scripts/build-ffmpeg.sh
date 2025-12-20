#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_DIR="$ROOT_DIR/third_party/emsdk"
FFMPEG_SRC="$ROOT_DIR/third_party/ffmpeg"
FFMPEG_VERSION="n7.1"
VARIANT="${FFMPEG_WASM_VARIANT:-}"

usage() {
  cat <<'EOF'
Usage: ./scripts/build-ffmpeg.sh [--variant royaltyfree|royaltyfree-lgpl|full|gpl|gpl-royaltyfree|royaltyfree-gpl|lgpl|nonfree]

Variants:
  royaltyfree  AV1/VP9/Opus only, LGPL-friendly, avoids patent-encumbered codecs.
  royaltyfree-lgpl  Alias for royaltyfree.
  full         HEVC + AV1 with common extras, LGPL-friendly but patent-encumbered.
  gpl          HEVC + AV1 with common extras, GPL build (open-source required), patent-encumbered.
  gpl-royaltyfree  Royalty-free codec set with GPL license obligations.
  royaltyfree-gpl  Alias for gpl-royaltyfree.
  lgpl         Alias for full.
  nonfree      Non-redistributable build. Unsafe for public distribution/monetization.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "--variant" ]; then
  VARIANT="${2:-}"
  shift 2
fi

case "${VARIANT:-full}" in
  royaltyfree|royaltyfree-lgpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-royaltyfree"
    LICENSE_FLAGS=()
    DECODER_FLAGS=(--disable-decoders --enable-decoder=av1,vp9,vp8,theora,dirac,ffv1,huffyuv,utvideo,mjpeg,png,rawvideo,opus,vorbis,flac,speex,wavpack,tta,pcm_s16le,pcm_s24le,pcm_f32le,pcm_s16be,pcm_u8,pcm_s8)
    PARSER_FLAGS=(--disable-parsers --enable-parser=av1,vp9,vp8,theora,dirac,ffv1,huffyuv,utvideo,mjpeg,opus,vorbis,flac,speex,wavpack,tta)
    ;;
  full|"")
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm"
    LICENSE_FLAGS=()
    DECODER_FLAGS=(--enable-decoder=hevc,av1,h264,vp8,vp9,mpeg4,mpeg2video,aac,ac3,eac3,mp3,opus,vorbis,flac,pcm_s16le,pcm_s24le,pcm_f32le)
    PARSER_FLAGS=(--enable-parser=hevc,av1,h264,vp8,vp9,mpeg4video,mpegaudio,aac,ac3,opus,vorbis,flac)
    ;;
  gpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-gpl"
    LICENSE_FLAGS=(--enable-gpl)
    DECODER_FLAGS=(--enable-decoder=hevc,av1,h264,vp8,vp9,mpeg4,mpeg2video,aac,ac3,eac3,mp3,opus,vorbis,flac,pcm_s16le,pcm_s24le,pcm_f32le)
    PARSER_FLAGS=(--enable-parser=hevc,av1,h264,vp8,vp9,mpeg4video,mpegaudio,aac,ac3,opus,vorbis,flac)
    ;;
  gpl-royaltyfree|royaltyfree-gpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-gpl-royaltyfree"
    LICENSE_FLAGS=(--enable-gpl)
    DECODER_FLAGS=(--disable-decoders --enable-decoder=av1,vp9,vp8,theora,dirac,ffv1,huffyuv,utvideo,mjpeg,png,rawvideo,opus,vorbis,flac,speex,wavpack,tta,pcm_s16le,pcm_s24le,pcm_f32le,pcm_s16be,pcm_u8,pcm_s8)
    PARSER_FLAGS=(--disable-parsers --enable-parser=av1,vp9,vp8,theora,dirac,ffv1,huffyuv,utvideo,mjpeg,opus,vorbis,flac,speex,wavpack,tta)
    ;;
  lgpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm"
    LICENSE_FLAGS=()
    DECODER_FLAGS=(--enable-decoder=hevc,av1,h264,vp8,vp9,mpeg4,mpeg2video,aac,ac3,eac3,mp3,opus,vorbis,flac,pcm_s16le,pcm_s24le,pcm_f32le)
    PARSER_FLAGS=(--enable-parser=hevc,av1,h264,vp8,vp9,mpeg4video,mpegaudio,aac,ac3,opus,vorbis,flac)
    ;;
  nonfree)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-nonfree"
    LICENSE_FLAGS=(--enable-nonfree)
    DECODER_FLAGS=(--enable-decoder=hevc,av1,h264,vp8,vp9,mpeg4,mpeg2video,aac,ac3,eac3,mp3,opus,vorbis,flac,pcm_s16le,pcm_s24le,pcm_f32le)
    PARSER_FLAGS=(--enable-parser=hevc,av1,h264,vp8,vp9,mpeg4video,mpegaudio,aac,ac3,opus,vorbis,flac)
    ;;
  *)
    echo "Unknown variant: ${VARIANT}" >&2
    usage >&2
    exit 1
    ;;
esac

PREFIX_DIR="$OUT_DIR"
OUT_JS="$OUT_DIR/ffmpeg_wasm.js"

if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  echo "emsdk not found. Run ./scripts/bootstrap-emsdk.sh first." >&2
  exit 1
fi

if [ ! -d "$FFMPEG_SRC" ]; then
  git clone --depth 1 --branch "$FFMPEG_VERSION" https://github.com/FFmpeg/FFmpeg.git "$FFMPEG_SRC"
else
  # Ensure correct version is checked out
  pushd "$FFMPEG_SRC" >/dev/null
  CURRENT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "")
  if [ "$CURRENT_TAG" != "$FFMPEG_VERSION" ]; then
    echo "FFmpeg version mismatch. Current: ${CURRENT_TAG:-unknown}, Expected: $FFMPEG_VERSION"
    echo "Fetching and checking out $FFMPEG_VERSION..."
    git fetch --depth 1 origin "refs/tags/$FFMPEG_VERSION:refs/tags/$FFMPEG_VERSION" 2>/dev/null || true
    git checkout "$FFMPEG_VERSION"
  fi
  popd >/dev/null
fi

source "$EMSDK_DIR/emsdk_env.sh"

pushd "$FFMPEG_SRC" >/dev/null

emconfigure ./configure \
  --prefix="$PREFIX_DIR" \
  --cc=emcc \
  --cxx=em++ \
  --ar=emar \
  --ranlib=emranlib \
  --nm=emnm \
  --target-os=none \
  --arch=x86_32 \
  --enable-cross-compile \
  --disable-asm \
  --disable-pthreads \
  --disable-stripping \
  --disable-programs \
  --disable-doc \
  --disable-debug \
  --disable-network \
  --enable-protocol=file \
  --enable-demuxer=mov,matroska,avi,mpegts,mp3,ogg,flac,wav \
  --enable-muxer=mp4,matroska \
  "${DECODER_FLAGS[@]}" \
  "${PARSER_FLAGS[@]}" \
  "${LICENSE_FLAGS[@]}"

emmake make -j"$(nproc)"
emmake make install

popd >/dev/null

mkdir -p "$OUT_DIR"

emcc -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=FFmpegWasm \
  -s ENVIRONMENT='web' \
  -s FILESYSTEM=0 \
  -s INITIAL_MEMORY=64MB \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_ffmpeg_wasm_avcodec_version","_ffmpeg_wasm_avformat_version","_ffmpeg_wasm_avutil_version","_ffmpeg_wasm_has_hevc_av1","_ffmpeg_wasm_create","_ffmpeg_wasm_destroy","_ffmpeg_wasm_append","_ffmpeg_wasm_set_eof","_ffmpeg_wasm_set_keep_all","_ffmpeg_wasm_set_buffer_limit","_ffmpeg_wasm_set_file_size","_ffmpeg_wasm_set_audio_enabled","_ffmpeg_wasm_open","_ffmpeg_wasm_duration_seconds","_ffmpeg_wasm_seek_seconds","_ffmpeg_wasm_read_frame","_ffmpeg_wasm_read_video_frame","_ffmpeg_wasm_video_width","_ffmpeg_wasm_video_height","_ffmpeg_wasm_frame_format","_ffmpeg_wasm_frame_data_ptr","_ffmpeg_wasm_frame_linesize","_ffmpeg_wasm_frame_pts_seconds","_ffmpeg_wasm_frame_to_rgba","_ffmpeg_wasm_rgba_ptr","_ffmpeg_wasm_rgba_stride","_ffmpeg_wasm_rgba_size","_ffmpeg_wasm_audio_channels","_ffmpeg_wasm_audio_sample_rate","_ffmpeg_wasm_audio_nb_samples","_ffmpeg_wasm_audio_ptr","_ffmpeg_wasm_audio_bytes","_ffmpeg_wasm_audio_pts_seconds","_ffmpeg_wasm_buffered_bytes","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap"]' \
  --no-entry \
  -I"$PREFIX_DIR/include" \
  "$ROOT_DIR/src/ffmpeg_wasm.c" \
  -L"$PREFIX_DIR/lib" \
  -Wl,--start-group \
  -lavformat -lavcodec -lswresample -lswscale -lavutil \
  -Wl,--end-group \
  -o "$OUT_JS"

echo "Built to $OUT_DIR"
