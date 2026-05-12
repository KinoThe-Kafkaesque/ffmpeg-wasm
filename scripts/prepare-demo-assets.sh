#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VARIANT="${FFMPEG_WASM_VARIANT:-}"
BUILD_MODE="${FFMPEG_WASM_BUILD_MODE:-release}"
WASM_THREADS="${FFMPEG_WASM_THREADS:-0}"

usage() {
  cat <<'EOF'
Usage: ./scripts/prepare-demo-assets.sh [--debug] [--variant royaltyfree|royaltyfree-lgpl|full|gpl|gpl-royaltyfree|royaltyfree-gpl|lgpl|nonfree]

Environment:
  FFMPEG_WASM_THREADS  Match the build output suffix when copying pthread builds.
EOF
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

if ! [[ "$WASM_THREADS" =~ ^[0-9]+$ ]]; then
  echo "Invalid FFMPEG_WASM_THREADS value: $WASM_THREADS" >&2
  exit 1
fi

case "${VARIANT:-full}" in
  royaltyfree|royaltyfree-lgpl)
    SRC_DIR="$ROOT_DIR/build/ffmpeg-wasm-royaltyfree"
    ;;
  full|"")
    SRC_DIR="$ROOT_DIR/build/ffmpeg-wasm"
    ;;
  gpl)
    SRC_DIR="$ROOT_DIR/build/ffmpeg-wasm-gpl"
    ;;
  gpl-royaltyfree|royaltyfree-gpl)
    SRC_DIR="$ROOT_DIR/build/ffmpeg-wasm-gpl-royaltyfree"
    ;;
  lgpl)
    SRC_DIR="$ROOT_DIR/build/ffmpeg-wasm"
    ;;
  nonfree)
    SRC_DIR="$ROOT_DIR/build/ffmpeg-wasm-nonfree"
    ;;
  *)
    echo "Unknown variant: ${VARIANT}" >&2
    usage >&2
    exit 1
    ;;
esac

if [ "$WASM_THREADS" -gt 1 ]; then
  SRC_DIR="${SRC_DIR}-pthreads${WASM_THREADS}"
fi

case "$BUILD_MODE" in
  release)
    ;;
  debug)
    SRC_DIR="${SRC_DIR}-debug"
    ;;
  *)
    echo "Unknown build mode: $BUILD_MODE" >&2
    usage >&2
    exit 1
    ;;
esac

if [ ! -f "$SRC_DIR/ffmpeg_wasm.js" ] || [ ! -f "$SRC_DIR/ffmpeg_wasm.wasm" ]; then
  echo "Build artifacts not found in $SRC_DIR" >&2
  echo "Run ./scripts/build-ffmpeg.sh first." >&2
  exit 1
fi

copy_to() {
  local target_dir="$1"
  mkdir -p "$target_dir"
  cp "$SRC_DIR/ffmpeg_wasm.js" "$target_dir/"
  cp "$SRC_DIR/ffmpeg_wasm.wasm" "$target_dir/"
  if [ -f "$SRC_DIR/ffmpeg_wasm.worker.js" ]; then
    cp "$SRC_DIR/ffmpeg_wasm.worker.js" "$target_dir/"
  else
    rm -f "$target_dir/ffmpeg_wasm.worker.js"
  fi
  if [ -f "$SRC_DIR/ffmpeg_wasm.wasm.map" ]; then
    cp "$SRC_DIR/ffmpeg_wasm.wasm.map" "$target_dir/"
  else
    rm -f "$target_dir/ffmpeg_wasm.wasm.map"
  fi
  if [ "$target_dir" != "$ROOT_DIR/web" ]; then
    cp "$ROOT_DIR/web/ffmpeg-wasm-api.js" "$target_dir/"
  fi
}

copy_to "$ROOT_DIR/web"
copy_to "$ROOT_DIR/web-react/public"

echo "Copied $BUILD_MODE ffmpeg_wasm assets and ffmpeg-wasm-api.js into web/ and web-react/public/"
