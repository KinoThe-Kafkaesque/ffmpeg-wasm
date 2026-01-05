#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_DIR="$ROOT_DIR/third_party/emsdk"
FFMPEG_SRC="$ROOT_DIR/third_party/ffmpeg"
FFMPEG_VERSION="n7.1"
LIBASS_SRC="$ROOT_DIR/third_party/libass"
LIBASS_VERSION="0.12.3"
FREETYPE_SRC="$ROOT_DIR/third_party/freetype"
FREETYPE_VERSION="2.13.2"
FRIBIDI_SRC="$ROOT_DIR/third_party/fribidi"
FRIBIDI_VERSION="v1.0.13"
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

if [ ! -d "$FREETYPE_SRC" ]; then
  mkdir -p "$(dirname "$FREETYPE_SRC")"
  curl -L "https://download.savannah.gnu.org/releases/freetype/freetype-${FREETYPE_VERSION}.tar.xz" | tar -xJ -C "$(dirname "$FREETYPE_SRC")"
  mv "$(dirname "$FREETYPE_SRC")/freetype-${FREETYPE_VERSION}" "$FREETYPE_SRC"
fi

if [ ! -d "$LIBASS_SRC" ]; then
  git clone --depth 1 --branch "$LIBASS_VERSION" https://github.com/libass/libass.git "$LIBASS_SRC"
else
  pushd "$LIBASS_SRC" >/dev/null
  CURRENT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "")
  if [ "$CURRENT_TAG" != "$LIBASS_VERSION" ]; then
    git fetch --depth 1 origin "refs/tags/$LIBASS_VERSION:refs/tags/$LIBASS_VERSION" 2>/dev/null || true
    git checkout "$LIBASS_VERSION"
  fi
  popd >/dev/null
fi

if [ ! -d "$FRIBIDI_SRC" ]; then
  git clone --depth 1 --branch "$FRIBIDI_VERSION" https://github.com/fribidi/fribidi.git "$FRIBIDI_SRC"
else
  pushd "$FRIBIDI_SRC" >/dev/null
  CURRENT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "")
  if [ "$CURRENT_TAG" != "$FRIBIDI_VERSION" ]; then
    git fetch --depth 1 origin "refs/tags/$FRIBIDI_VERSION:refs/tags/$FRIBIDI_VERSION" 2>/dev/null || true
    git checkout "$FRIBIDI_VERSION"
  fi
  popd >/dev/null
fi

if [ "${1:-}" = "--variant" ]; then
  VARIANT="${2:-}"
  shift 2
fi

case "${VARIANT:-full}" in
  royaltyfree|royaltyfree-lgpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-royaltyfree"
    LICENSE_FLAGS=()
    DECODER_FLAGS=(--disable-decoders --enable-decoder=av1,vp9,vp8,theora,dirac,ffv1,huffyuv,utvideo,mjpeg,png,rawvideo,opus,vorbis,flac,speex,wavpack,tta,pcm_s16le,pcm_s24le,pcm_f32le,pcm_s16be,pcm_u8,pcm_s8,ass,ssa,subrip,webvtt)
    PARSER_FLAGS=(--disable-parsers --enable-parser=av1,vp9,vp8,theora,dirac,ffv1,huffyuv,utvideo,mjpeg,opus,vorbis,flac,speex,wavpack,tta)
    ;;
  full|"")
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm"
    LICENSE_FLAGS=()
    DECODER_FLAGS=(--enable-decoder=hevc,av1,h264,vp8,vp9,mpeg4,mpeg2video,aac,ac3,eac3,mp3,opus,vorbis,flac,pcm_s16le,pcm_s24le,pcm_f32le,ass,ssa,subrip,webvtt)
    PARSER_FLAGS=(--enable-parser=hevc,av1,h264,vp8,vp9,mpeg4video,mpegaudio,aac,ac3,opus,vorbis,flac)
    ;;
  gpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-gpl"
    LICENSE_FLAGS=(--enable-gpl)
    DECODER_FLAGS=(--enable-decoder=hevc,av1,h264,vp8,vp9,mpeg4,mpeg2video,aac,ac3,eac3,mp3,opus,vorbis,flac,pcm_s16le,pcm_s24le,pcm_f32le,ass,ssa,subrip,webvtt)
    PARSER_FLAGS=(--enable-parser=hevc,av1,h264,vp8,vp9,mpeg4video,mpegaudio,aac,ac3,opus,vorbis,flac)
    ;;
  gpl-royaltyfree|royaltyfree-gpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-gpl-royaltyfree"
    LICENSE_FLAGS=(--enable-gpl)
    DECODER_FLAGS=(--disable-decoders --enable-decoder=av1,vp9,vp8,theora,dirac,ffv1,huffyuv,utvideo,mjpeg,png,rawvideo,opus,vorbis,flac,speex,wavpack,tta,pcm_s16le,pcm_s24le,pcm_f32le,pcm_s16be,pcm_u8,pcm_s8,ass,ssa,subrip,webvtt)
    PARSER_FLAGS=(--disable-parsers --enable-parser=av1,vp9,vp8,theora,dirac,ffv1,huffyuv,utvideo,mjpeg,opus,vorbis,flac,speex,wavpack,tta)
    ;;
  lgpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm"
    LICENSE_FLAGS=()
    DECODER_FLAGS=(--enable-decoder=hevc,av1,h264,vp8,vp9,mpeg4,mpeg2video,aac,ac3,eac3,mp3,opus,vorbis,flac,pcm_s16le,pcm_s24le,pcm_f32le,ass,ssa,subrip,webvtt)
    PARSER_FLAGS=(--enable-parser=hevc,av1,h264,vp8,vp9,mpeg4video,mpegaudio,aac,ac3,opus,vorbis,flac)
    ;;
  nonfree)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-nonfree"
    LICENSE_FLAGS=(--enable-nonfree)
    DECODER_FLAGS=(--enable-decoder=hevc,av1,h264,vp8,vp9,mpeg4,mpeg2video,aac,ac3,eac3,mp3,opus,vorbis,flac,pcm_s16le,pcm_s24le,pcm_f32le,ass,ssa,subrip,webvtt)
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

if [ ! -f "$FRIBIDI_SRC/configure" ]; then
  pushd "$FRIBIDI_SRC" >/dev/null
  ./autogen.sh
  popd >/dev/null
fi

mkdir -p "$OUT_DIR/build-fribidi"
pushd "$OUT_DIR/build-fribidi" >/dev/null
PKG_CONFIG_PATH="$PREFIX_DIR/lib/pkgconfig" \
emconfigure "$FRIBIDI_SRC/configure" \
  --prefix="$PREFIX_DIR" \
  --disable-shared \
  --enable-static
sed -i 's/SUBDIRS = gen.tab lib bin doc test/SUBDIRS = gen.tab lib bin/' Makefile
emmake make -j"$(nproc)"
emmake make install
popd >/dev/null

mkdir -p "$OUT_DIR/build-freetype"
pushd "$OUT_DIR/build-freetype" >/dev/null
emcmake cmake "$FREETYPE_SRC" \
  -DCMAKE_INSTALL_PREFIX="$PREFIX_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DFT_DISABLE_ZLIB=ON \
  -DFT_DISABLE_BZIP2=ON \
  -DFT_DISABLE_PNG=ON \
  -DFT_DISABLE_HARFBUZZ=ON \
  -DFT_DISABLE_BROTLI=ON
emmake make -j"$(nproc)"
emmake make install
popd >/dev/null

if [ ! -f "$LIBASS_SRC/configure" ]; then
  pushd "$LIBASS_SRC" >/dev/null
  ./autogen.sh
  popd >/dev/null
fi

mkdir -p "$OUT_DIR/build-libass"
pushd "$OUT_DIR/build-libass" >/dev/null
FREETYPE_CFLAGS="-I$PREFIX_DIR/include/freetype2" \
FREETYPE_LIBS="-L$PREFIX_DIR/lib -lfreetype" \
FRIBIDI_CFLAGS="-I$PREFIX_DIR/include/fribidi" \
FRIBIDI_LIBS="-L$PREFIX_DIR/lib -lfribidi" \
emconfigure "$LIBASS_SRC/configure" \
  --prefix="$PREFIX_DIR" \
  --disable-shared \
  --enable-static \
  --disable-fontconfig \
  --disable-harfbuzz \
  --disable-enca \
  --disable-asm
emmake make -j"$(nproc)"
emmake make install
popd >/dev/null

pushd "$FFMPEG_SRC" >/dev/null

EM_PKG_CONFIG_PATH="$PREFIX_DIR/lib/pkgconfig" \
emconfigure ./configure \
  --pkg-config-flags="--static" \
  --extra-cflags="-I$PREFIX_DIR/include -I$PREFIX_DIR/include/freetype2 -I$PREFIX_DIR/include/fribidi -I$PREFIX_DIR/include/ass" \
  --extra-ldflags="-L$PREFIX_DIR/lib" \
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
  --enable-libass \
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
  -s EXPORTED_FUNCTIONS='["_ffmpeg_wasm_avcodec_version","_ffmpeg_wasm_avformat_version","_ffmpeg_wasm_avutil_version","_ffmpeg_wasm_has_hevc_av1","_ffmpeg_wasm_create","_ffmpeg_wasm_destroy","_ffmpeg_wasm_append","_ffmpeg_wasm_set_eof","_ffmpeg_wasm_set_keep_all","_ffmpeg_wasm_set_buffer_limit","_ffmpeg_wasm_set_file_size","_ffmpeg_wasm_set_audio_enabled","_ffmpeg_wasm_open","_ffmpeg_wasm_duration_seconds","_ffmpeg_wasm_seek_seconds","_ffmpeg_wasm_read_frame","_ffmpeg_wasm_read_video_frame","_ffmpeg_wasm_video_width","_ffmpeg_wasm_video_height","_ffmpeg_wasm_frame_format","_ffmpeg_wasm_frame_data_ptr","_ffmpeg_wasm_frame_linesize","_ffmpeg_wasm_frame_pts_seconds","_ffmpeg_wasm_frame_to_rgba","_ffmpeg_wasm_rgba_ptr","_ffmpeg_wasm_rgba_stride","_ffmpeg_wasm_rgba_size","_ffmpeg_wasm_audio_channels","_ffmpeg_wasm_audio_sample_rate","_ffmpeg_wasm_audio_nb_samples","_ffmpeg_wasm_audio_ptr","_ffmpeg_wasm_audio_bytes","_ffmpeg_wasm_audio_pts_seconds","_ffmpeg_wasm_buffered_bytes","_ffmpeg_wasm_compact_buffer","_ffmpeg_wasm_streams_count","_ffmpeg_wasm_stream_media_type","_ffmpeg_wasm_stream_codec_id","_ffmpeg_wasm_stream_codec_name","_ffmpeg_wasm_stream_language","_ffmpeg_wasm_stream_title","_ffmpeg_wasm_stream_is_default","_ffmpeg_wasm_selected_video_stream","_ffmpeg_wasm_selected_audio_stream","_ffmpeg_wasm_audio_is_enabled","_ffmpeg_wasm_select_streams","_ffmpeg_wasm_selected_subtitle_stream","_ffmpeg_wasm_subtitles_enabled","_ffmpeg_wasm_select_subtitle_stream","_ffmpeg_wasm_render_subtitles","_ffmpeg_wasm_clear_subtitle_track","_ffmpeg_wasm_add_font","_ffmpeg_wasm_subtitle_events_count","_ffmpeg_wasm_subtitle_first_start_ms","_ffmpeg_wasm_subtitle_first_end_ms","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap"]' \
  --no-entry \
  -I"$PREFIX_DIR/include" \
  "$ROOT_DIR/src/ffmpeg_wasm.c" \
  -L"$PREFIX_DIR/lib" \
  -Wl,--start-group \
  -lavformat -lavcodec -lswresample -lswscale -lavutil \
  -lass -lfreetype -lfribidi \
  -Wl,--end-group \
  -o "$OUT_JS"

echo "Built to $OUT_DIR"
