#!/usr/bin/env node
// Run: node test-node.mjs <video-file> [seek-percent]

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FFmpegWasm = require("./ffmpeg_wasm.js");

// const file = process.argv[2];
// const seekPercent = parseInt(process.argv[3]) || 50;
const file = "/home/nyanpasu/Desktop/animus/test.mkv";
const seekPercent = 60;

if (!file) {
  console.log("Usage: node test-node.mjs <video-file> [seek-percent]");
  process.exit(1);
}

console.log(`Loading ${file}...`);
const data = readFileSync(file);
console.log(`File size: ${(data.length / 1024 / 1024).toFixed(1)}MB`);

// Load WASM binary manually for Node.js
const wasmBinary = readFileSync(join(__dirname, "ffmpeg_wasm.wasm"));
const Module = await FFmpegWasm({ wasmBinary });
console.log("WASM loaded\n");

const api = {
  create: Module.cwrap("ffmpeg_wasm_create", "number", ["number"]),
  destroy: Module.cwrap("ffmpeg_wasm_destroy", null, ["number"]),
  append: Module.cwrap("ffmpeg_wasm_append", "number", [
    "number",
    "number",
    "number",
  ]),
  setEof: Module.cwrap("ffmpeg_wasm_set_eof", null, ["number"]),
  open: Module.cwrap("ffmpeg_wasm_open", "number", ["number", "string"]),
  setFileSize: Module.cwrap("ffmpeg_wasm_set_file_size", null, [
    "number",
    "number",
  ]),
  bufferedBytes: Module.cwrap("ffmpeg_wasm_buffered_bytes", "number", [
    "number",
  ]),
  duration: Module.cwrap("ffmpeg_wasm_duration_seconds", "number", ["number"]),
  readFrame: Module.cwrap("ffmpeg_wasm_read_frame", "number", ["number"]),
  pts: Module.cwrap("ffmpeg_wasm_frame_pts_seconds", "number", ["number"]),
  width: Module.cwrap("ffmpeg_wasm_video_width", "number", ["number"]),
  height: Module.cwrap("ffmpeg_wasm_video_height", "number", ["number"]),
  seek: Module.cwrap("ffmpeg_wasm_seek_seconds", "number", [
    "number",
    "number",
  ]),
};

const append = (ctx, chunk) => {
  const ptr = Module._malloc(chunk.length);
  Module.HEAPU8.set(chunk, ptr);
  const ret = api.append(ctx, ptr, chunk.length);
  Module._free(ptr);
  return ret;
};

// Test 1: Full file open
console.log("=== TEST: Open full file ===");
const ctx = api.create(0);
api.setFileSize(ctx, data.length);
append(ctx, data);
api.setEof(ctx);

const openRet = api.open(ctx, null);
if (openRet !== 0) {
  console.log(`Open failed: ${openRet}`);
  process.exit(1);
}

const duration = api.duration(ctx);
const w = api.width(ctx);
const h = api.height(ctx);
console.log(`Opened: ${w}x${h}, duration: ${duration.toFixed(2)}s\n`);

// Decode first few frames
console.log("=== First 3 frames ===");
for (let i = 0; i < 30; i++) {
  const ret = api.readFrame(ctx);
  if (ret === 1) {
    console.log(`Frame PTS: ${api.pts(ctx).toFixed(3)}s`);
    if (i >= 2) break;
  }
}

// Test 2: Seek
const targetTime = (seekPercent / 100) * duration;
console.log(`\n=== SEEK to ${targetTime.toFixed(2)}s (${seekPercent}%) ===`);

const seekRet = api.seek(ctx, targetTime);
console.log(`seek() returned: ${seekRet}`);

if (seekRet >= 0) {
  console.log("\nFrames after seek:");
  for (let i = 0; i < 50; i++) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      const pts = api.pts(ctx);
      console.log(`Frame PTS: ${pts.toFixed(3)}s`);
      if (pts >= targetTime) {
        console.log(`\n✓ Reached target in ${i + 1} frames`);
        break;
      }
    } else if (ret === 0) {
      console.log("Need more data (shouldn't happen with full file)");
      break;
    } else if (ret < 0) {
      console.log(`Decode error/EOF: ${ret}`);
      break;
    }
  }
} else {
  console.log("Seek failed");
}

api.destroy(ctx);
console.log("\nDone");
