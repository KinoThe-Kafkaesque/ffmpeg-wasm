# Setup Guide

This guide walks you through setting up the FFmpeg WASM build environment from scratch.

## Pinned Versions

| Dependency | Version |
|------------|---------|
| Emscripten | 3.1.50 |
| FFmpeg | n7.1 |
| dav1d | 1.4.3 |

These versions are pinned in the build scripts for reproducibility.

## Prerequisites

Ensure you have the following installed:

- **Git** - for cloning repositories
- **Python 3** - required by Emscripten
- **Node.js** (v16+) - required by Emscripten
- **CMake** - required by Emscripten
- **Make** - for building FFmpeg
- **Meson + Ninja + pkg-config** - for building the software AV1 decoder (`dav1d`)

### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install git python3 nodejs npm cmake make meson ninja-build pkg-config
```

### Linux (Arch)

```bash
sudo pacman -S git python nodejs npm cmake make meson ninja pkgconf
```

### macOS

```bash
brew install git python3 node cmake make meson ninja pkg-config
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
│   ├── ffmpeg/           # FFmpeg source (cloned by build)
│   └── dav1d/            # Software AV1 decoder (cloned by build)
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

By default this builds the `full` variant (LGPL, with HEVC/H.264/AAC support and AV1 through dav1d).

For browser debugging, build a separate debug artifact:

```bash
./scripts/build-ffmpeg.sh --debug
./scripts/prepare-demo-assets.sh --debug
```

Debug builds append `-debug` to the normal output directory and enable source maps, Emscripten assertions, profiling function names, and `FFMPEG_WASM_DEBUG=1`. They are much slower than release builds and should only be copied into `web/` while actively debugging.

The build reserves an 8 MB C stack by default. This matters for decoder-heavy paths such as 10-bit 1080p AV1 through dav1d. Override it only when testing memory pressure:

```bash
FFMPEG_WASM_STACK_SIZE=12MB ./scripts/build-ffmpeg.sh --release
```

Release builds enable WASM SIMD by default. Disable it only for legacy-browser experiments:

```bash
FFMPEG_WASM_SIMD=0 ./scripts/build-ffmpeg.sh --release
```

For high-resolution AV1, build the pthread variant in the WASM layer:

```bash
FFMPEG_WASM_THREADS=4 ./scripts/build-ffmpeg.sh --release
FFMPEG_WASM_THREADS=4 ./scripts/prepare-demo-assets.sh --release
```

This writes `build/ffmpeg-wasm-pthreads4/` and adds `ffmpeg_wasm.worker.js`. `FFMPEG_WASM_THREADS=4` sets 4 native decoder threads; the Emscripten pthread worker pool defaults to 8 browser workers to avoid starving libdav1d/FFmpeg. Browser pthread builds require `SharedArrayBuffer`, so serve the demo with COOP/COEP headers.

### Build Variants

Choose a variant based on your licensing and patent requirements:

```bash
# Royalty-free codecs only (AV1 via dav1d, VP8/9, Opus, Vorbis)
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

Debug builds use the same names with `-debug` appended, for example `build/ffmpeg-wasm-debug/`.

Each directory contains:
- `ffmpeg_wasm.js` - JavaScript loader/glue code
- `ffmpeg_wasm.wasm` - WebAssembly binary; size varies by variant and build mode
- `ffmpeg_wasm.wasm.map` - Debug builds only, copied into demo folders by `prepare-demo-assets.sh --debug`

## Step 4: Run the Demo

### Prepare Demo Assets

Copy the built WASM files into the demo directories:

```bash
./scripts/prepare-demo-assets.sh

# Or for a specific variant:
./scripts/prepare-demo-assets.sh --variant royaltyfree

# Or for a debug build:
./scripts/prepare-demo-assets.sh --debug
```

Use `./scripts/prepare-demo-assets.sh --release` before performance testing or normal playback. A debug WASM can decode much slower and make otherwise supported HEVC/AV1 files look choppy.

### HTML Demo

Serve the `web/` directory with the project server. It sets the COOP/COEP headers required by pthread WASM builds:

```bash
node scripts/serve-web.mjs --port 8080
```

Open http://127.0.0.1:8080/v3.html in your browser.

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
- Ensure `ffmpeg_wasm.js`, `ffmpeg_wasm.wasm`, and `ffmpeg-wasm-api.js` are in the same directory
- If using a pthread build, also ensure `ffmpeg_wasm.worker.js` is present and the page is served with COOP/COEP headers

### "SharedArrayBuffer is not defined"

Single-threaded builds do not require `SharedArrayBuffer`. Pthread builds do require it, plus COOP/COEP headers. Use `node scripts/serve-web.mjs --port 8080` for `web/v3.html`; Python's plain `http.server` is not enough for pthread assets.

## Integration

To use the built WASM in your own project, copy these files:

```
build/ffmpeg-wasm/ffmpeg_wasm.js
build/ffmpeg-wasm/ffmpeg_wasm.wasm
```

Pthread builds also need:

```
build/ffmpeg-wasm-pthreads4/ffmpeg_wasm.worker.js
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
