#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VARIANT="${FFMPEG_WASM_VARIANT:-}"

usage() {
  cat <<'EOF'
Usage: ./scripts/prepare-demo-assets.sh [--variant royaltyfree|royaltyfree-lgpl|full|gpl|gpl-royaltyfree|royaltyfree-gpl|lgpl|nonfree]
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
}

copy_to "$ROOT_DIR/web"
copy_to "$ROOT_DIR/web-react/public"

echo "Copied ffmpeg_wasm.js/.wasm into web/ and web-react/public/"
