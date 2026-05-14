#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_DIR="$ROOT_DIR/third_party/emsdk"
FFMPEG_SRC="$ROOT_DIR/third_party/ffmpeg"
FFMPEG_VERSION="n7.1"
DAV1D_SRC="$ROOT_DIR/third_party/dav1d"
DAV1D_VERSION="1.4.3"
LIBASS_SRC="$ROOT_DIR/third_party/libass"
LIBASS_VERSION="0.12.3"
FREETYPE_SRC="$ROOT_DIR/third_party/freetype"
FREETYPE_VERSION="2.13.2"
FRIBIDI_SRC="$ROOT_DIR/third_party/fribidi"
FRIBIDI_VERSION="v1.0.13"
VARIANT="${FFMPEG_WASM_VARIANT:-}"
BUILD_MODE="${FFMPEG_WASM_BUILD_MODE:-release}"
SAFE_HEAP="${FFMPEG_WASM_SAFE_HEAP:-0}"
WASM_STACK_SIZE="${FFMPEG_WASM_STACK_SIZE:-8MB}"
WASM_SIMD="${FFMPEG_WASM_SIMD:-1}"
WASM_THREADS="${FFMPEG_WASM_THREADS:-0}"
WASM_THREAD_POOL="${FFMPEG_WASM_THREAD_POOL:-}"
WASM_CFLAGS=()
WASM_LDFLAGS=()
EMCC_THREAD_FLAGS=()
FFMPEG_THREAD_FLAGS=(--disable-pthreads)
DECODER_THREAD_COUNT=1

COMMON_DEMUXERS=(mov matroska avi mpegts mp3 ogg flac wav)
COMMON_PROTOCOLS=(file)
COMMON_BSFS=(vp9_superframe_split)
FULL_DECODERS=(
  hevc libdav1d h264 h263 vp8 vp9 mpeg4 mpeg2video
  aac aac_latm ac3 eac3 mp3 mp3float opus vorbis flac alac
  pcm_s16le pcm_s24le pcm_s32le pcm_f32le pcm_s16be pcm_u8 pcm_s8
  ass ssa subrip webvtt
)
FULL_PARSERS=(
  hevc av1 h264 h263 vp8 vp9 mpeg4video mpegvideo
  mpegaudio aac aac_latm ac3 opus vorbis flac
)
ROYALTYFREE_DECODERS=(
  libdav1d vp9 vp8 theora dirac ffv1 huffyuv utvideo mjpeg rawvideo
  opus vorbis flac speex wavpack tta
  pcm_s16le pcm_s24le pcm_s32le pcm_f32le pcm_s16be pcm_u8 pcm_s8
  ass ssa subrip webvtt
)
ROYALTYFREE_PARSERS=(av1 vp9 vp8 dirac mjpeg opus vorbis flac)
ENABLED_DECODERS=()
ENABLED_PARSERS=()

usage() {
  cat <<'EOF'
Usage: ./scripts/build-ffmpeg.sh [--debug] [--variant royaltyfree|royaltyfree-lgpl|full|gpl|gpl-royaltyfree|royaltyfree-gpl|lgpl|nonfree]

Variants:
  royaltyfree  AV1/VP9/Opus only, LGPL-friendly, avoids patent-encumbered codecs.
  royaltyfree-lgpl  Alias for royaltyfree.
  full         HEVC + AV1 with common extras, LGPL-friendly but patent-encumbered.
  gpl          HEVC + AV1 with common extras, GPL build (open-source required), patent-encumbered.
  gpl-royaltyfree  Royalty-free codec set with GPL license obligations.
  royaltyfree-gpl  Alias for gpl-royaltyfree.
  lgpl         Alias for full.
  nonfree      Non-redistributable build. Unsafe for public distribution/monetization.

Build modes:
  release      Default. Optimized with -O3.
  debug        Separate output directory, -Og, source maps, assertions, profiling names, and FFMPEG_WASM_DEBUG=1.

Environment:
  FFMPEG_WASM_STACK_SIZE  C stack size for decoder-heavy WASM paths. Defaults to 8MB.
  FFMPEG_WASM_SIMD        Enable WASM SIMD with -msimd128. Defaults to 1; set to 0 for legacy browsers.
  FFMPEG_WASM_THREADS     Native decoder thread count. Defaults to 0; set to 4+ for 4K AV1 testing.
  FFMPEG_WASM_THREAD_POOL Emscripten pthread worker pool size. Defaults to max(8, FFMPEG_WASM_THREADS * 2).
EOF
}

clean_in_source_autotools_config() {
  local src_dir="$1"
  local name="$2"

  if [ ! -f "$src_dir/config.status" ]; then
    return
  fi

  echo "Cleaning stale in-source $name configure state..."
  pushd "$src_dir" >/dev/null
  if [ -f Makefile ]; then
    make distclean >/dev/null 2>&1 || true
  fi
  rm -f config.status config.log config.cache
  popd >/dev/null
}

strip_generated_js_trailing_whitespace() {
  local js_file="$1"

  if command -v perl >/dev/null 2>&1; then
    perl -0pi -e 's/[ \t]+$//gm' "$js_file"
  else
    sed -i 's/[[:blank:]]\+$//' "$js_file"
  fi
}

component_csv() {
  local IFS=,
  echo "$*"
}

write_dav1d_cross_file() {
  local cross_file="$1"
  cat >"$cross_file" <<'EOF'
[binaries]
c = 'emcc'
cpp = 'em++'
ar = 'emar'
strip = 'llvm-strip'
pkg-config = 'pkg-config'

[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'

[properties]
needs_exe_wrapper = true
EOF

  if [ "${#WASM_CFLAGS[@]}" -gt 0 ]; then
    cat >>"$cross_file" <<EOF

[built-in options]
c_args = [$(printf "'%s'," "${WASM_CFLAGS[@]}" | sed 's/,$//')]
c_link_args = [$(printf "'%s'," "${WASM_LDFLAGS[@]}" | sed 's/,$//')]
EOF
  fi
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --variant)
      VARIANT="${2:-}"
      shift 2
      ;;
    --debug)
      BUILD_MODE="debug"
      shift
      ;;
    --release)
      BUILD_MODE="release"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$WASM_SIMD" in
  1|true|yes|on)
    WASM_CFLAGS+=(-msimd128)
    WASM_LDFLAGS+=(-msimd128)
    ;;
  0|false|no|off)
    ;;
  *)
    echo "Invalid FFMPEG_WASM_SIMD value: $WASM_SIMD" >&2
    exit 1
    ;;
esac

if ! [[ "$WASM_THREADS" =~ ^[0-9]+$ ]]; then
  echo "Invalid FFMPEG_WASM_THREADS value: $WASM_THREADS" >&2
  exit 1
fi

if [ "$WASM_THREADS" -gt 1 ]; then
  if [ -z "$WASM_THREAD_POOL" ]; then
    WASM_THREAD_POOL=$((WASM_THREADS * 2))
    if [ "$WASM_THREAD_POOL" -lt 8 ]; then
      WASM_THREAD_POOL=8
    fi
  fi
  if ! [[ "$WASM_THREAD_POOL" =~ ^[0-9]+$ ]] || [ "$WASM_THREAD_POOL" -lt "$WASM_THREADS" ]; then
    echo "Invalid FFMPEG_WASM_THREAD_POOL value: $WASM_THREAD_POOL" >&2
    exit 1
  fi
  WASM_CFLAGS+=(-pthread)
  WASM_LDFLAGS+=(-pthread)
  EMCC_THREAD_FLAGS=(-s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE="$WASM_THREAD_POOL")
  FFMPEG_THREAD_FLAGS=(--enable-pthreads)
  DECODER_THREAD_COUNT="$WASM_THREADS"
fi

if [ ! -d "$FREETYPE_SRC" ]; then
  mkdir -p "$(dirname "$FREETYPE_SRC")"
  curl -L "https://download.savannah.gnu.org/releases/freetype/freetype-${FREETYPE_VERSION}.tar.xz" | tar -xJ -C "$(dirname "$FREETYPE_SRC")"
  mv "$(dirname "$FREETYPE_SRC")/freetype-${FREETYPE_VERSION}" "$FREETYPE_SRC"
fi

if [ ! -d "$DAV1D_SRC" ]; then
  git clone --depth 1 --branch "$DAV1D_VERSION" https://code.videolan.org/videolan/dav1d.git "$DAV1D_SRC"
else
  pushd "$DAV1D_SRC" >/dev/null
  CURRENT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "")
  if [ "$CURRENT_TAG" != "$DAV1D_VERSION" ]; then
    git fetch --depth 1 origin "refs/tags/$DAV1D_VERSION:refs/tags/$DAV1D_VERSION" 2>/dev/null || true
    git checkout "$DAV1D_VERSION"
  fi
  popd >/dev/null
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

case "${VARIANT:-full}" in
  royaltyfree|royaltyfree-lgpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-royaltyfree"
    LICENSE_FLAGS=()
    ENABLED_DECODERS=("${ROYALTYFREE_DECODERS[@]}")
    ENABLED_PARSERS=("${ROYALTYFREE_PARSERS[@]}")
    ;;
  full|"")
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm"
    LICENSE_FLAGS=()
    ENABLED_DECODERS=("${FULL_DECODERS[@]}")
    ENABLED_PARSERS=("${FULL_PARSERS[@]}")
    ;;
  gpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-gpl"
    LICENSE_FLAGS=(--enable-gpl)
    ENABLED_DECODERS=("${FULL_DECODERS[@]}")
    ENABLED_PARSERS=("${FULL_PARSERS[@]}")
    ;;
  gpl-royaltyfree|royaltyfree-gpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-gpl-royaltyfree"
    LICENSE_FLAGS=(--enable-gpl)
    ENABLED_DECODERS=("${ROYALTYFREE_DECODERS[@]}")
    ENABLED_PARSERS=("${ROYALTYFREE_PARSERS[@]}")
    ;;
  lgpl)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm"
    LICENSE_FLAGS=()
    ENABLED_DECODERS=("${FULL_DECODERS[@]}")
    ENABLED_PARSERS=("${FULL_PARSERS[@]}")
    ;;
  nonfree)
    OUT_DIR="$ROOT_DIR/build/ffmpeg-wasm-nonfree"
    LICENSE_FLAGS=(--enable-nonfree)
    ENABLED_DECODERS=("${FULL_DECODERS[@]}")
    ENABLED_PARSERS=("${FULL_PARSERS[@]}")
    ;;
  *)
    echo "Unknown variant: ${VARIANT}" >&2
    usage >&2
    exit 1
    ;;
esac

DECODER_FLAGS=(--disable-decoders "--enable-decoder=$(component_csv "${ENABLED_DECODERS[@]}")")
PARSER_FLAGS=(--disable-parsers "--enable-parser=$(component_csv "${ENABLED_PARSERS[@]}")")
DEMUXER_FLAGS=(--disable-demuxers "--enable-demuxer=$(component_csv "${COMMON_DEMUXERS[@]}")")
PROTOCOL_FLAGS=(--disable-protocols "--enable-protocol=$(component_csv "${COMMON_PROTOCOLS[@]}")")
BSF_FLAGS=(--disable-bsfs "--enable-bsf=$(component_csv "${COMMON_BSFS[@]}")")

if [ "$WASM_THREADS" -gt 1 ]; then
  OUT_DIR="${OUT_DIR}-pthreads${WASM_THREADS}"
fi

case "$BUILD_MODE" in
  release)
    FFMPEG_DEBUG_FLAGS=(--disable-debug)
    EMCC_OPT_FLAGS=(-O3)
    EMCC_DEBUG_FLAGS=()
    C_DEBUG_FLAGS=()
    ;;
  debug)
    OUT_DIR="${OUT_DIR}-debug"
    FFMPEG_DEBUG_FLAGS=(--enable-debug=3 --disable-optimizations)
    EMCC_OPT_FLAGS=(-Og)
    EMCC_DEBUG_FLAGS=(-gsource-map -s ASSERTIONS=2 --profiling-funcs)
    C_DEBUG_FLAGS=(-DFFMPEG_WASM_DEBUG=1)
    if [ "$SAFE_HEAP" = "1" ] || [ "$SAFE_HEAP" = "true" ]; then
      EMCC_DEBUG_FLAGS+=(-s SAFE_HEAP=1)
    fi
    ;;
  *)
    echo "Unknown build mode: $BUILD_MODE" >&2
    usage >&2
    exit 1
    ;;
esac

PREFIX_DIR="$OUT_DIR"
OUT_JS="$OUT_DIR/ffmpeg_wasm.js"
EXPORTED_FUNCTIONS="$(node "$ROOT_DIR/scripts/print-exported-functions.mjs")"
C_BUILD_FLAGS=(-DFFMPEG_WASM_DECODER_THREADS="$DECODER_THREAD_COUNT")
FFMPEG_EXTRA_CFLAGS="-I$PREFIX_DIR/include -I$PREFIX_DIR/include/freetype2 -I$PREFIX_DIR/include/fribidi -I$PREFIX_DIR/include/ass"
FFMPEG_EXTRA_LDFLAGS="-L$PREFIX_DIR/lib"
if [ "${#WASM_CFLAGS[@]}" -gt 0 ]; then
  FFMPEG_EXTRA_CFLAGS="${WASM_CFLAGS[*]} $FFMPEG_EXTRA_CFLAGS"
fi
if [ "${#WASM_LDFLAGS[@]}" -gt 0 ]; then
  FFMPEG_EXTRA_LDFLAGS="${WASM_LDFLAGS[*]} $FFMPEG_EXTRA_LDFLAGS"
fi

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

for required_tool in meson ninja pkg-config; do
  if ! command -v "$required_tool" >/dev/null 2>&1; then
    echo "$required_tool not found. Install Meson/Ninja/pkg-config before building dav1d." >&2
    echo "Debian/Ubuntu: sudo apt install meson ninja-build pkg-config" >&2
    echo "Python fallback: python3 -m pip install --user meson ninja" >&2
    exit 1
  fi
done

DAV1D_BUILDTYPE="release"
if [ "$BUILD_MODE" = "debug" ]; then
  DAV1D_BUILDTYPE="debugoptimized"
fi

mkdir -p "$OUT_DIR"
DAV1D_CROSS_FILE="$OUT_DIR/dav1d-emscripten.cross"
write_dav1d_cross_file "$DAV1D_CROSS_FILE"
rm -rf "$OUT_DIR/build-dav1d"
meson setup "$OUT_DIR/build-dav1d" "$DAV1D_SRC" \
  --cross-file "$DAV1D_CROSS_FILE" \
  --prefix="$PREFIX_DIR" \
  --libdir=lib \
  --default-library=static \
  --buildtype="$DAV1D_BUILDTYPE" \
  -Denable_tools=false \
  -Denable_tests=false \
  -Denable_examples=false \
  -Denable_docs=false \
  -Denable_asm=false \
  -Dbitdepths=8,16
meson compile -C "$OUT_DIR/build-dav1d"
meson install -C "$OUT_DIR/build-dav1d"

if [ ! -f "$FRIBIDI_SRC/configure" ]; then
  pushd "$FRIBIDI_SRC" >/dev/null
  ./autogen.sh
  popd >/dev/null
fi
clean_in_source_autotools_config "$FRIBIDI_SRC" "FriBidi"

mkdir -p "$OUT_DIR/build-fribidi"
pushd "$OUT_DIR/build-fribidi" >/dev/null
PKG_CONFIG_PATH="$PREFIX_DIR/lib/pkgconfig" \
CFLAGS="${WASM_CFLAGS[*]}" \
LDFLAGS="${WASM_LDFLAGS[*]}" \
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
  -DCMAKE_C_FLAGS="${WASM_CFLAGS[*]}" \
  -DCMAKE_EXE_LINKER_FLAGS="${WASM_LDFLAGS[*]}" \
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
clean_in_source_autotools_config "$LIBASS_SRC" "libass"

mkdir -p "$OUT_DIR/build-libass"
pushd "$OUT_DIR/build-libass" >/dev/null
FREETYPE_CFLAGS="-I$PREFIX_DIR/include/freetype2" \
FREETYPE_LIBS="-L$PREFIX_DIR/lib -lfreetype" \
FRIBIDI_CFLAGS="-I$PREFIX_DIR/include/fribidi" \
FRIBIDI_LIBS="-L$PREFIX_DIR/lib -lfribidi" \
CFLAGS="${WASM_CFLAGS[*]}" \
LDFLAGS="${WASM_LDFLAGS[*]}" \
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

if [ -f config.mak ]; then
  echo "Cleaning stale FFmpeg object archives before strict component configure..."
  make clean >/dev/null 2>&1 || true
fi

EM_PKG_CONFIG_PATH="$PREFIX_DIR/lib/pkgconfig" \
PKG_CONFIG_PATH="$PREFIX_DIR/lib/pkgconfig" \
emconfigure ./configure \
  --pkg-config-flags="--static" \
  --extra-cflags="$FFMPEG_EXTRA_CFLAGS" \
  --extra-ldflags="$FFMPEG_EXTRA_LDFLAGS" \
  --prefix="$PREFIX_DIR" \
  --cc=emcc \
  --cxx=em++ \
  --ar=emar \
  --ranlib=emranlib \
  --nm=emnm \
  --target-os=none \
  --arch=x86_32 \
  --enable-cross-compile \
  --disable-everything \
  --disable-autodetect \
  --disable-asm \
  --disable-iconv \
  --disable-runtime-cpudetect \
  --disable-avdevice \
  --disable-avfilter \
  --disable-postproc \
  --disable-devices \
  --disable-filters \
  --disable-encoders \
  --disable-muxers \
  --disable-hwaccels \
  --disable-decoder=av1 \
  --disable-stripping \
  --disable-programs \
  --disable-doc \
  "${FFMPEG_THREAD_FLAGS[@]}" \
  "${FFMPEG_DEBUG_FLAGS[@]}" \
  --disable-network \
  --enable-libdav1d \
  "${BSF_FLAGS[@]}" \
  "${PROTOCOL_FLAGS[@]}" \
  "${DEMUXER_FLAGS[@]}" \
  "${DECODER_FLAGS[@]}" \
  "${PARSER_FLAGS[@]}" \
  "${LICENSE_FLAGS[@]}"

node "$ROOT_DIR/scripts/validate-ffmpeg-components.mjs" \
  --config "$FFMPEG_SRC/config_components.h" \
  --config-h "$FFMPEG_SRC/config.h" \
  --out "$OUT_DIR/ffmpeg-components.json" \
  --variant "${VARIANT:-full}" \
  --allow-demuxer "$(component_csv "${COMMON_DEMUXERS[@]}")" \
  --allow-protocol "$(component_csv "${COMMON_PROTOCOLS[@]}")" \
  --allow-bsf "$(component_csv "${COMMON_BSFS[@]}")" \
  --allow-decoder "$(component_csv "${ENABLED_DECODERS[@]}")" \
  --allow-parser "$(component_csv "${ENABLED_PARSERS[@]}")"

emmake make -j"$(nproc)"
emmake make install

popd >/dev/null

mkdir -p "$OUT_DIR"

emcc "${EMCC_OPT_FLAGS[@]}" \
  "${EMCC_DEBUG_FLAGS[@]}" \
  "${C_DEBUG_FLAGS[@]}" \
  "${C_BUILD_FLAGS[@]}" \
  "${WASM_CFLAGS[@]}" \
  "${WASM_LDFLAGS[@]}" \
  "${EMCC_THREAD_FLAGS[@]}" \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=FFmpegWasm \
  -s ENVIRONMENT='web,worker,node' \
  -s FILESYSTEM=0 \
  -s INITIAL_MEMORY=64MB \
  -s STACK_SIZE="$WASM_STACK_SIZE" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -s EXPORTED_RUNTIME_METHODS='["cwrap"]' \
  --no-entry \
  -I"$PREFIX_DIR/include" \
  "$ROOT_DIR/src/ffmpeg_wasm.c" \
  "$ROOT_DIR/src/ffmpeg_wasm_debug.c" \
  -L"$PREFIX_DIR/lib" \
  -Wl,--start-group \
  -lavformat -lavcodec -lswresample -lswscale -lavutil \
  -ldav1d \
  -lass -lfreetype -lfribidi \
  -Wl,--end-group \
  -o "$OUT_JS"

strip_generated_js_trailing_whitespace "$OUT_JS"

node "$ROOT_DIR/scripts/write-build-manifest.mjs" \
  --out "$OUT_DIR/ffmpeg_wasm.capabilities.json" \
  --variant "${VARIANT:-full}" \
  --mode "$BUILD_MODE" \
  --decoder-threads "$DECODER_THREAD_COUNT" \
  --pthread-pool "${WASM_THREAD_POOL:-0}" \
  --simd "$WASM_SIMD" \
  --stack-size "$WASM_STACK_SIZE" \
  --safe-heap "$SAFE_HEAP"

echo "Built $BUILD_MODE variant to $OUT_DIR"
