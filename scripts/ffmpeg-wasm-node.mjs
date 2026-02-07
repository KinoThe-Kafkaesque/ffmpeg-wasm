#!/usr/bin/env node

import { closeSync, createReadStream, openSync, readFileSync, readSync, statSync } from "fs";
import { resolve } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_JS_PATH = resolve(ROOT_DIR, "web/ffmpeg_wasm.js");
const DEFAULT_WASM_PATH = resolve(ROOT_DIR, "web/ffmpeg_wasm.wasm");
const FFMPEG_WASM_IO_APPEND_STREAM = 0;
const FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL = 1;

const API_SPEC = {
  avcodecVersion: ["ffmpeg_wasm_avcodec_version", "number", []],
  avformatVersion: ["ffmpeg_wasm_avformat_version", "number", []],
  avutilVersion: ["ffmpeg_wasm_avutil_version", "number", []],
  hasHevcAv1: ["ffmpeg_wasm_has_hevc_av1", "number", []],

  create: ["ffmpeg_wasm_create", "number", ["number"]],
  destroy: ["ffmpeg_wasm_destroy", null, ["number"]],
  append: ["ffmpeg_wasm_append", "number", ["number", "number", "number"]],
  setEof: ["ffmpeg_wasm_set_eof", null, ["number"]],
  setKeepAll: ["ffmpeg_wasm_set_keep_all", null, ["number", "number"]],
  setBufferLimit: ["ffmpeg_wasm_set_buffer_limit", null, ["number", "number"]],
  setFileSize: ["ffmpeg_wasm_set_file_size", null, ["number", "number"]],
  setBufferOffset: ["ffmpeg_wasm_set_buffer_offset", null, ["number", "number"]],
  setIoMode: ["ffmpeg_wasm_set_io_mode", "number", ["number", "number"]],
  getIoMode: ["ffmpeg_wasm_get_io_mode", "number", ["number"]],
  setCacheLimit: ["ffmpeg_wasm_set_cache_limit", null, ["number", "number"]],
  setAudioEnabled: ["ffmpeg_wasm_set_audio_enabled", null, ["number", "number"]],

  open: ["ffmpeg_wasm_open", "number", ["number", "string"]],
  duration: ["ffmpeg_wasm_duration_seconds", "number", ["number"]],
  seek: ["ffmpeg_wasm_seek_seconds", "number", ["number", "number"]],
  chaptersCount: ["ffmpeg_wasm_chapters_count", "number", ["number"]],
  hasOrderedChapters: ["ffmpeg_wasm_has_ordered_chapters", "number", ["number"]],
  chapterStartSeconds: [
    "ffmpeg_wasm_chapter_start_seconds",
    "number",
    ["number", "number"],
  ],
  chapterEndSeconds: [
    "ffmpeg_wasm_chapter_end_seconds",
    "number",
    ["number", "number"],
  ],
  chapterTitle: ["ffmpeg_wasm_chapter_title", "string", ["number", "number"]],
  chapterId: ["ffmpeg_wasm_chapter_id", "number", ["number", "number"]],
  seekChapter: ["ffmpeg_wasm_seek_chapter", "number", ["number", "number"]],
  prepareRestream: [
    "ffmpeg_wasm_prepare_restream",
    "number",
    ["number", "number"],
  ],
  readFrame: ["ffmpeg_wasm_read_frame", "number", ["number"]],
  readVideoFrame: ["ffmpeg_wasm_read_video_frame", "number", ["number"]],

  width: ["ffmpeg_wasm_video_width", "number", ["number"]],
  height: ["ffmpeg_wasm_video_height", "number", ["number"]],
  frameFormat: ["ffmpeg_wasm_frame_format", "number", ["number"]],
  frameDataPtr: ["ffmpeg_wasm_frame_data_ptr", "number", ["number", "number"]],
  frameLinesize: [
    "ffmpeg_wasm_frame_linesize",
    "number",
    ["number", "number"],
  ],
  pts: ["ffmpeg_wasm_frame_pts_seconds", "number", ["number"]],

  toRgba: ["ffmpeg_wasm_frame_to_rgba", "number", ["number"]],
  rgbaPtr: ["ffmpeg_wasm_rgba_ptr", "number", ["number"]],
  rgbaStride: ["ffmpeg_wasm_rgba_stride", "number", ["number"]],
  rgbaSize: ["ffmpeg_wasm_rgba_size", "number", ["number"]],

  audioChannels: ["ffmpeg_wasm_audio_channels", "number", ["number"]],
  audioSampleRate: ["ffmpeg_wasm_audio_sample_rate", "number", ["number"]],
  audioSamples: ["ffmpeg_wasm_audio_nb_samples", "number", ["number"]],
  audioPtr: ["ffmpeg_wasm_audio_ptr", "number", ["number"]],
  audioBytes: ["ffmpeg_wasm_audio_bytes", "number", ["number"]],
  audioPts: ["ffmpeg_wasm_audio_pts_seconds", "number", ["number"]],

  bufferedBytes: ["ffmpeg_wasm_buffered_bytes", "number", ["number"]],
  compactBuffer: ["ffmpeg_wasm_compact_buffer", null, ["number"]],

  streamsCount: ["ffmpeg_wasm_streams_count", "number", ["number"]],
  streamMediaType: [
    "ffmpeg_wasm_stream_media_type",
    "number",
    ["number", "number"],
  ],
  streamCodecId: ["ffmpeg_wasm_stream_codec_id", "number", ["number", "number"]],
  streamCodecName: [
    "ffmpeg_wasm_stream_codec_name",
    "string",
    ["number", "number"],
  ],
  streamLanguage: ["ffmpeg_wasm_stream_language", "string", ["number", "number"]],
  streamTitle: ["ffmpeg_wasm_stream_title", "string", ["number", "number"]],
  streamIsDefault: [
    "ffmpeg_wasm_stream_is_default",
    "number",
    ["number", "number"],
  ],
  attachmentsCount: ["ffmpeg_wasm_attachments_count", "number", ["number"]],
  attachmentName: ["ffmpeg_wasm_attachment_name", "string", ["number", "number"]],
  attachmentMimeType: [
    "ffmpeg_wasm_attachment_mime_type",
    "string",
    ["number", "number"],
  ],
  attachmentSize: ["ffmpeg_wasm_attachment_size", "number", ["number", "number"]],
  attachmentDataPtr: [
    "ffmpeg_wasm_attachment_data_ptr",
    "number",
    ["number", "number"],
  ],

  selectedVideoStream: [
    "ffmpeg_wasm_selected_video_stream",
    "number",
    ["number"],
  ],
  selectedAudioStream: [
    "ffmpeg_wasm_selected_audio_stream",
    "number",
    ["number"],
  ],
  audioIsEnabled: ["ffmpeg_wasm_audio_is_enabled", "number", ["number"]],
  selectStreams: [
    "ffmpeg_wasm_select_streams",
    "number",
    ["number", "number", "number"],
  ],

  selectedSubtitleStream: [
    "ffmpeg_wasm_selected_subtitle_stream",
    "number",
    ["number"],
  ],
  subtitlesEnabled: ["ffmpeg_wasm_subtitles_enabled", "number", ["number"]],
  selectSubtitleStream: [
    "ffmpeg_wasm_select_subtitle_stream",
    "number",
    ["number", "number"],
  ],
  addFont: ["ffmpeg_wasm_add_font", "number", ["number", "string", "number", "number"]],
  renderSubtitles: ["ffmpeg_wasm_render_subtitles", "number", ["number", "number"]],
  subtitleEventsCount: ["ffmpeg_wasm_subtitle_events_count", "number", ["number"]],
  subtitleFirstStartMs: [
    "ffmpeg_wasm_subtitle_first_start_ms",
    "number",
    ["number"],
  ],
  subtitleFirstEndMs: ["ffmpeg_wasm_subtitle_first_end_ms", "number", ["number"]],
  clearSubtitleTrack: ["ffmpeg_wasm_clear_subtitle_track", null, ["number"]],

  // Test-only debug exports (available when built with FFMPEG_WASM_TESTING=1)
  debugSeekStream: [
    "ffmpeg_wasm_debug_seek_stream",
    "number",
    ["number", "number", "number"],
  ],
  debugBufferOffset: [
    "ffmpeg_wasm_debug_buffer_offset",
    "number",
    ["number"],
  ],
  debugBufferSize: ["ffmpeg_wasm_debug_buffer_size", "number", ["number"]],
  debugBufferReadPos: [
    "ffmpeg_wasm_debug_buffer_read_pos",
    "number",
    ["number"],
  ],
  debugBytePos: ["ffmpeg_wasm_debug_byte_pos", "number", ["number"]],
};

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

const hasExport = (Module, name) => typeof Module[`_${name}`] === "function";

const cwrapMaybe = (Module, name, returnType, argTypes) =>
  hasExport(Module, name) ? Module.cwrap(name, returnType, argTypes) : null;

const createRawApi = (Module) => {
  const raw = {};
  for (const key of Object.keys(Module)) {
    if (!key.startsWith("_ffmpeg_wasm_")) continue;
    const name = key.slice(1);
    raw[name] = Module[key];
  }
  return raw;
};

const createApi = (Module) => {
  const api = {};
  for (const [method, [cName, returnType, argTypes]] of Object.entries(API_SPEC)) {
    api[method] = cwrapMaybe(Module, cName, returnType, argTypes);
  }
  return api;
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

  const api = createApi(Module);
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
