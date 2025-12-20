# Setup Guide

This guide walks you through setting up the FFmpeg WASM build environment from scratch.

## Pinned Versions

| Dependency | Version |
|------------|---------|
| Emscripten | 3.1.50 |
| FFmpeg | n7.1 |

These versions are pinned in the build scripts for reproducibility.

## Prerequisites

Ensure you have the following installed:

- **Git** - for cloning repositories
- **Python 3** - required by Emscripten
- **Node.js** (v16+) - required by Emscripten
- **CMake** - required by Emscripten
- **Make** - for building FFmpeg

### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install git python3 nodejs npm cmake make
```

### Linux (Arch)

```bash
sudo pacman -S git python nodejs npm cmake make
```

### macOS

```bash
brew install git python3 node cmake make
```

### Windows

Use WSL2 with Ubuntu, then follow the Linux instructions above.

## Project Structure

```
.
├── scripts/              # Build scripts
│   ├── bootstrap-emsdk.sh
│   ├── build-ffmpeg.sh
│   └── prepare-demo-assets.sh
├── src/                  # Custom WASM wrapper code
│   └── ffmpeg_wasm.c
├── third_party/          # External dependencies (auto-populated)
│   ├── emsdk/            # Emscripten SDK (cloned by bootstrap)
│   └── ffmpeg/           # FFmpeg source (cloned by build)
├── build/                # Build outputs (generated)
├── web/                  # HTML demo
├── web-react/            # React demo (Vite)
└── docs/                 # Documentation
```

## Step 1: Clone the Repository

```bash
git clone <your-repo-url>
cd ffmpeg
```

## Step 2: Install Emscripten SDK

Run the bootstrap script to install the Emscripten toolchain:

```bash
./scripts/bootstrap-emsdk.sh
```

This will:
- Clone the Emscripten SDK to `third_party/emsdk/`
- Install Emscripten version 3.1.50
- Activate the toolchain

**Note:** This may take 5-10 minutes on first run.

## Step 3: Build FFmpeg WASM

Build the WebAssembly binary:

```bash
./scripts/build-ffmpeg.sh
```

By default this builds the `full` variant (LGPL, with HEVC/H.264/AAC support).

### Build Variants

Choose a variant based on your licensing and patent requirements:

```bash
# Royalty-free codecs only (AV1, VP8/9, Opus, Vorbis)
./scripts/build-ffmpeg.sh --variant royaltyfree

# Full codec set (default) - HEVC, H.264, AAC, etc.
./scripts/build-ffmpeg.sh --variant full

# GPL build - same codecs, GPL license
./scripts/build-ffmpeg.sh --variant gpl

# GPL + royalty-free codecs only
./scripts/build-ffmpeg.sh --variant gpl-royaltyfree
```

See `docs/BUILD_VARIANTS.md` for detailed codec lists.

### Build Output

After building, artifacts are in:

| Variant | Output Directory |
|---------|------------------|
| royaltyfree | `build/ffmpeg-wasm-royaltyfree/` |
| full | `build/ffmpeg-wasm/` |
| gpl | `build/ffmpeg-wasm-gpl/` |
| gpl-royaltyfree | `build/ffmpeg-wasm-gpl-royaltyfree/` |

Each directory contains:
- `ffmpeg_wasm.js` - JavaScript loader/glue code
- `ffmpeg_wasm.wasm` - WebAssembly binary (~3-5 MB)

## Step 4: Run the Demo

### Prepare Demo Assets

Copy the built WASM files into the demo directories:

```bash
./scripts/prepare-demo-assets.sh

# Or for a specific variant:
./scripts/prepare-demo-assets.sh --variant royaltyfree
```

### HTML Demo

Serve the `web/` directory with any static file server:

```bash
python3 -m http.server --directory web 8080
```

Open http://localhost:8080 in your browser.

### React Demo

```bash
cd web-react
npm install
npm run dev
```

Open the URL shown in the terminal (usually http://localhost:5173).

## Rebuilding

To rebuild after making changes to `src/ffmpeg_wasm.c`:

```bash
./scripts/build-ffmpeg.sh --variant <your-variant>
./scripts/prepare-demo-assets.sh --variant <your-variant>
```

The build script will reuse the existing FFmpeg configuration and only recompile changed files.

## Updating Dependency Versions

### FFmpeg

Edit `FFMPEG_VERSION` in `scripts/build-ffmpeg.sh`:

```bash
FFMPEG_VERSION="n7.1"  # Change to desired tag
```

Available tags: https://github.com/FFmpeg/FFmpeg/tags

Then rebuild:

```bash
rm -rf third_party/ffmpeg
./scripts/build-ffmpeg.sh --variant <your-variant>
```

### Emscripten

Edit `EMSDK_VERSION` in `scripts/bootstrap-emsdk.sh`:

```bash
EMSDK_VERSION="3.1.50"  # Change to desired version
```

Available versions: https://github.com/emscripten-core/emsdk/releases

Then reinstall:

```bash
rm -rf third_party/emsdk
./scripts/bootstrap-emsdk.sh
./scripts/build-ffmpeg.sh --variant <your-variant>
```

## Troubleshooting

### "emsdk not found"

Run the bootstrap script first:

```bash
./scripts/bootstrap-emsdk.sh
```

### Build fails with memory errors

Emscripten builds can be memory-intensive. Ensure you have at least 4GB of free RAM.

### WASM won't load in browser

- WASM files must be served over HTTP, not `file://`
- Check browser console for errors
- Ensure both `.js` and `.wasm` files are in the same directory

### "SharedArrayBuffer is not defined"

This project is single-threaded and does NOT require SharedArrayBuffer or COOP/COEP headers. If you see this error, you may be loading a different WASM build.

## Integration

To use the built WASM in your own project, copy these files:

```
build/ffmpeg-wasm/ffmpeg_wasm.js
build/ffmpeg-wasm/ffmpeg_wasm.wasm
```

Basic usage:

```javascript
const Module = await FFmpegWasm();

const create = Module.cwrap("ffmpeg_wasm_create", "number", ["number"]);
const append = Module.cwrap("ffmpeg_wasm_append", "number", ["number", "number", "number"]);
const open = Module.cwrap("ffmpeg_wasm_open", "number", ["number", "string"]);
const read = Module.cwrap("ffmpeg_wasm_read_frame", "number", ["number"]);

// Create context with 4MB buffer
const ctx = create(4 * 1024 * 1024);

// Append video data
const data = new Uint8Array([...]); // Your video bytes
const ptr = Module._malloc(data.length);
Module.HEAPU8.set(data, ptr);
append(ctx, ptr, data.length);
Module._free(ptr);

// Open and decode
open(ctx, "mov");  // or "matroska", "mpegts", etc.
while (read(ctx) >= 0) {
  // Process frames...
}
```

See `README.md` for the full API reference.
