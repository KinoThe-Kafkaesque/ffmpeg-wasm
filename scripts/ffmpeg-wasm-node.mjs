#!/usr/bin/env node

import { closeSync, createReadStream, openSync, readFileSync, readSync, statSync } from "fs";
import { resolve } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_JS_PATH = resolve(ROOT_DIR, "web/ffmpeg_wasm.js");
const DEFAULT_WASM_PATH = resolve(ROOT_DIR, "web/ffmpeg_wasm.wasm");
const { createFfmpegWasmApi } = require(resolve(
  ROOT_DIR,
  "web/ffmpeg-wasm-api.js",
));
const FFMPEG_WASM_IO_APPEND_STREAM = 0;
const FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL = 1;

const toUint8Array = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Expected Uint8Array, Buffer, ArrayBuffer, or TypedArray");
};

const createRawApi = (Module) => {
  const raw = {};
  for (const key of Object.keys(Module)) {
    if (!key.startsWith("_ffmpeg_wasm_")) continue;
    const name = key.slice(1);
    raw[name] = Module[key];
  }
  return raw;
};

export const loadWasmNode = async (options = {}) => {
  const wasmJsPath = resolve(options.wasmJsPath || DEFAULT_JS_PATH);
  const wasmPath = resolve(options.wasmPath || DEFAULT_WASM_PATH);

  const wasmBinary = readFileSync(wasmPath);
  const FFmpegWasm = require(wasmJsPath);

  const Module = await FFmpegWasm({
    wasmBinary,
    print: options.print || (() => {}),
    printErr: options.printErr || (() => {}),
  });

  const api = createFfmpegWasmApi(Module);
  const raw = createRawApi(Module);
  let readAtFd = null;
  let readAtSize = -1;
  let readAtPath = null;

  Module.ffmpegReadAt = (offset, len, dstPtr) => {
    if (readAtFd === null) {
      return -38; // ENOSYS
    }

    const start = Math.max(0, Math.trunc(Number(offset) || 0));
    const want = Math.max(0, Math.trunc(Number(len) || 0));
    if (want <= 0) {
      return 0;
    }
    if (readAtSize >= 0 && start >= readAtSize) {
      return 0;
    }

    const maxRead = readAtSize >= 0 ? Math.min(want, Math.max(0, readAtSize - start)) : want;
    if (maxRead <= 0) {
      return 0;
    }

    try {
      const tmp = Buffer.allocUnsafe(maxRead);
      const read = readSync(readAtFd, tmp, 0, maxRead, start);
      if (read <= 0) {
        return 0;
      }
      Module.HEAPU8.set(tmp.subarray(0, read), dstPtr >>> 0);
      return read;
    } catch (err) {
      return -5; // EIO
    }
  };

  const clearReadAtFile = () => {
    if (readAtFd !== null) {
      closeSync(readAtFd);
      readAtFd = null;
      readAtSize = -1;
      readAtPath = null;
    }
  };

  const installReadAtFile = (filePath) => {
    clearReadAtFile();
    const info = statSync(filePath);
    readAtFd = openSync(filePath, "r");
    readAtSize = info.size;
    readAtPath = filePath;
    return info.size;
  };

  const appendBytes = (ctx, bytes) => {
    if (!api.append) {
      throw new Error("append export is unavailable in this wasm build");
    }
    const chunk = toUint8Array(bytes);
    const ptr = Module._malloc(chunk.byteLength);
    if (!ptr) {
      return -12; // AVERROR(ENOMEM)
    }
    Module.HEAPU8.set(chunk, ptr);
    const ret = api.append(ctx, ptr, chunk.byteLength);
    Module._free(ptr);
    return ret;
  };

  const addFontBytes = (ctx, fontName, bytes) => {
    if (!api.addFont) {
      throw new Error("addFont export is unavailable in this wasm build");
    }
    const data = toUint8Array(bytes);
    const ptr = Module._malloc(data.byteLength);
    if (!ptr) {
      return -12;
    }
    Module.HEAPU8.set(data, ptr);
    const ret = api.addFont(ctx, fontName, ptr, data.byteLength);
    Module._free(ptr);
    return ret;
  };

  const appendFile = async (
    ctx,
    filePath,
    { chunkSize = 256 * 1024, setFileSize = true, setEof = true } = {}
  ) => {
    const info = statSync(filePath);
    if (setFileSize && api.setFileSize) {
      api.setFileSize(ctx, info.size);
    }
    let total = 0;
    const stream = createReadStream(filePath, { highWaterMark: chunkSize });
    for await (const chunk of stream) {
      const ret = appendBytes(ctx, chunk);
      if (ret < 0) {
        throw new Error(`append failed with code ${ret} at byte ${total}`);
      }
      total += chunk.length;
    }
    if (setEof && api.setEof) {
      api.setEof(ctx);
    }
    return total;
  };

  const openLocalFile = (
    ctx,
    filePath,
    { formatName = null, cacheLimit = null } = {}
  ) => {
    if (!api.open) {
      throw new Error("open export is unavailable in this wasm build");
    }

    const size = installReadAtFile(filePath);
    try {
      if (api.setFileSize) {
        api.setFileSize(ctx, size);
      }
      if (api.setIoMode) {
        const ret = api.setIoMode(ctx, FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL);
        if (ret < 0) {
          throw new Error(`setIoMode(random-access) failed: ${ret}`);
        }
      }
      if (cacheLimit && api.setCacheLimit) {
        api.setCacheLimit(ctx, cacheLimit);
      }

      const openRet = api.open(ctx, formatName);
      if (openRet < 0) {
        throw new Error(`open failed in read_at mode: ${openRet}`);
      }
      return { size, ioMode: api.getIoMode ? api.getIoMode(ctx) : null, readAtPath };
    } catch (err) {
      clearReadAtFile();
      throw err;
    }
  };

  const readNextVideoFrame = (ctx, maxReads = 1000) => {
    if (!api.readFrame || !api.pts) {
      throw new Error("readFrame/pts export is unavailable in this wasm build");
    }
    for (let i = 0; i < maxReads; i += 1) {
      const ret = api.readFrame(ctx);
      if (ret === 1) {
        return { ret, pts: api.pts(ctx), reads: i + 1 };
      }
      if (ret <= 0) {
        return { ret, pts: null, reads: i + 1 };
      }
    }
    return { ret: 0, pts: null, reads: maxReads, reason: "max_reads" };
  };

  const readUntilPts = (ctx, targetPts, maxReads = 50000) => {
    if (!api.readFrame || !api.pts) {
      throw new Error("readFrame/pts export is unavailable in this wasm build");
    }
    let lastPts = null;
    for (let i = 0; i < maxReads; i += 1) {
      const ret = api.readFrame(ctx);
      if (ret === 1) {
        const pts = api.pts(ctx);
        lastPts = pts;
        if (pts >= targetPts) {
          return { ok: true, ret, pts, reads: i + 1 };
        }
        continue;
      }
      if (ret === 2) continue;
      if (ret <= 0) {
        return { ok: false, ret, pts: lastPts, reads: i + 1 };
      }
    }
    return { ok: false, ret: 0, pts: lastPts, reads: maxReads, reason: "max_reads" };
  };

  const getStreams = (ctx) => {
    if (!api.streamsCount || !api.streamMediaType) return [];
    const count = api.streamsCount(ctx);
    const streams = [];
    for (let i = 0; i < count; i += 1) {
      streams.push({
        index: i,
        mediaType: api.streamMediaType ? api.streamMediaType(ctx, i) : null,
        codecId: api.streamCodecId ? api.streamCodecId(ctx, i) : null,
        codecName: api.streamCodecName ? api.streamCodecName(ctx, i) : null,
        language: api.streamLanguage ? api.streamLanguage(ctx, i) : null,
        title: api.streamTitle ? api.streamTitle(ctx, i) : null,
        isDefault: api.streamIsDefault ? Boolean(api.streamIsDefault(ctx, i)) : false,
      });
    }
    return streams;
  };

  const getChapters = (ctx) => {
    if (!api.chaptersCount || !api.chapterStartSeconds) return [];
    const count = api.chaptersCount(ctx);
    const chapters = [];
    for (let i = 0; i < count; i += 1) {
      chapters.push({
        index: i,
        id: api.chapterId ? api.chapterId(ctx, i) : i,
        title: api.chapterTitle ? api.chapterTitle(ctx, i) : null,
        startSeconds: api.chapterStartSeconds(ctx, i),
        endSeconds: api.chapterEndSeconds ? api.chapterEndSeconds(ctx, i) : -1,
      });
    }
    return chapters;
  };

  const getAttachments = (ctx) => {
    if (!api.attachmentsCount) return [];
    const count = api.attachmentsCount(ctx);
    const attachments = [];
    for (let i = 0; i < count; i += 1) {
      attachments.push({
        index: i,
        name: api.attachmentName ? api.attachmentName(ctx, i) : null,
        mimeType: api.attachmentMimeType ? api.attachmentMimeType(ctx, i) : null,
        size: api.attachmentSize ? api.attachmentSize(ctx, i) : 0,
      });
    }
    return attachments;
  };

  return {
    Module,
    raw,
    api,
    appendBytes,
    addFontBytes,
    appendFile,
    installReadAtFile,
    clearReadAtFile,
    openLocalFile,
    readNextVideoFrame,
    readUntilPts,
    getStreams,
    getChapters,
    getAttachments,
  };
};

const runSmoke = async (filePath, seekPercent = 60) => {
  const wasm = await loadWasmNode();
  const { api } = wasm;
  if (!api.create || !api.open || !api.duration || !api.seek) {
    throw new Error("Required exports are unavailable for smoke test");
  }

  const ctx = api.create(0);
  try {
    let openRet = 0;
    let ioPath = "append";

    if (wasm.openLocalFile && api.setIoMode) {
      const opened = wasm.openLocalFile(ctx, filePath);
      ioPath = "read_at";
      openRet = 0;
      if (opened.ioMode !== null && opened.ioMode !== FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL) {
        throw new Error(`unexpected io mode after open: ${opened.ioMode}`);
      }
    } else {
      await wasm.appendFile(ctx, filePath);
      openRet = api.open(ctx, null);
      if (openRet !== 0) {
        throw new Error(`open failed: ${openRet}`);
      }
    }

    const duration = api.duration(ctx);
    const target = (Math.max(1, Math.min(99, seekPercent)) / 100) * duration;
    const seekRet = api.seek(ctx, target);
    if (seekRet < 0) {
      throw new Error(`seek failed: ${seekRet}`);
    }

    const probe = wasm.readUntilPts(ctx, target, 20000);
    return {
      ioPath,
      openRet,
      duration,
      target,
      seekRet,
      probe,
      streams: wasm.getStreams(ctx),
      chapters: wasm.getChapters(ctx),
      attachments: wasm.getAttachments(ctx),
    };
  } finally {
    wasm.clearReadAtFile?.();
    if (api.destroy) {
      api.destroy(ctx);
    }
  }
};

const printUsage = () => {
  console.log("Usage:");
  console.log("  node scripts/ffmpeg-wasm-node.mjs list-exports");
  console.log("  node scripts/ffmpeg-wasm-node.mjs smoke <media-file> [seek-percent]");
};

const main = async () => {
  const cmd = process.argv[2];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    printUsage();
    return;
  }

  if (cmd === "list-exports") {
    const wasm = await loadWasmNode();
    const names = Object.keys(wasm.raw).sort();
    console.log(JSON.stringify(names, null, 2));
    return;
  }

  if (cmd === "smoke") {
    const filePath = process.argv[3];
    if (!filePath) {
      throw new Error("Missing media file path for smoke command");
    }
    const seekPercent = process.argv[4] ? Number(process.argv[4]) : 60;
    const result = await runSmoke(filePath, seekPercent);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
