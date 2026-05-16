#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argValue = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
};

const normalizeVariant = (variant) => {
  switch ((variant || "full").toLowerCase()) {
    case "":
    case "full":
    case "lgpl":
      return "full";
    case "royaltyfree":
    case "royaltyfree-lgpl":
      return "royaltyfree";
    case "gpl":
      return "gpl";
    case "gpl-royaltyfree":
    case "royaltyfree-gpl":
      return "gpl-royaltyfree";
    case "nonfree":
      return "nonfree";
    default:
      return variant || "full";
  }
};

const unique = (items) => [...new Set(items)].sort();

const variant = normalizeVariant(argValue("--variant", process.env.FFMPEG_WASM_VARIANT || "full"));
const buildMode = argValue("--mode", process.env.FFMPEG_WASM_BUILD_MODE || "release");
const decoderThreads = Number.parseInt(argValue("--decoder-threads", "1"), 10) || 1;
const pthreadPool = Number.parseInt(argValue("--pthread-pool", "0"), 10) || 0;
const simd = argValue("--simd", process.env.FFMPEG_WASM_SIMD || "1");
const stackSize = argValue("--stack-size", process.env.FFMPEG_WASM_STACK_SIZE || "8MB");
const safeHeap = argValue("--safe-heap", process.env.FFMPEG_WASM_SAFE_HEAP || "0");
const out = resolve(argValue("--out", "ffmpeg_wasm.capabilities.json"));

const base = {
  schemaVersion: 1,
  packageName: "ffmpeg-wasm",
  variant,
  buildMode,
  generatedAt: new Date().toISOString(),
  wasm: {
    simd: !["0", "false", "no", "off"].includes(String(simd).toLowerCase()),
    pthreads: decoderThreads > 1,
    decoderThreads,
    pthreadPool,
    stackSize,
    safeHeap: ["1", "true", "yes", "on"].includes(String(safeHeap).toLowerCase()),
  },
  io: {
    appendStream: true,
    localReadAt: true,
    httpRangeReadAt: true,
  },
  buildProfile: {
    purpose: "decode-playback",
    ffmpegPrograms: false,
    network: false,
    encoders: false,
    muxers: false,
    filters: false,
    bitstreamFilters: ["vp9_superframe_split"],
    devices: false,
    iconv: false,
    runtimeCpuDetect: false,
  },
  demuxers: ["avi", "flac", "matroska", "mov", "mp3", "mpegts", "ogg", "wav"],
  protocols: ["file"],
  extensions: [
    "3g2",
    "3gp",
    "avi",
    "flac",
    "m2ts",
    "m4a",
    "m4v",
    "mkv",
    "mov",
    "mp3",
    "mp4",
    "mts",
    "oga",
    "ogg",
    "opus",
    "ts",
    "wav",
    "webm",
  ],
  subtitles: {
    ass: true,
    ssa: true,
    srt: true,
    webvtt: true,
    bitmapSubtitles: false,
    embeddedFonts: true,
  },
};

const fullVideo = ["av1", "h263", "h264", "hevc", "mpeg2video", "mpeg4", "vp8", "vp9"];
const royaltyFreeVideo = [
  "av1",
  "dirac",
  "ffv1",
  "huffyuv",
  "mjpeg",
  "rawvideo",
  "theora",
  "utvideo",
  "vp8",
  "vp9",
];
const fullAudio = [
  "aac",
  "ac3",
  "alac",
  "eac3",
  "flac",
  "mp3",
  "opus",
  "pcm_f32le",
  "pcm_s16be",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_s8",
  "pcm_u8",
  "vorbis",
];
const royaltyFreeAudio = [
  "flac",
  "opus",
  "pcm_f32le",
  "pcm_s16be",
  "pcm_s16le",
  "pcm_s24le",
  "pcm_s32le",
  "pcm_s8",
  "pcm_u8",
  "speex",
  "tta",
  "vorbis",
  "wavpack",
];

const royaltyFree = variant === "royaltyfree" || variant === "gpl-royaltyfree";
const gpl = variant === "gpl" || variant === "gpl-royaltyfree";
const nonfree = variant === "nonfree";

const manifest = {
  ...base,
  licenseProfile: {
    gpl,
    nonfree,
    patentEncumberedCodecs: !royaltyFree,
  },
  codecs: {
    video: unique(royaltyFree ? royaltyFreeVideo : fullVideo),
    audio: unique(royaltyFree ? royaltyFreeAudio : fullAudio),
    subtitle: ["ass", "ssa", "subrip", "webvtt"],
  },
  browserFallback: {
    shouldLiveInConsumerApp: true,
    reason: "The WASM release declares support; UI products decide when native browser playback is an acceptable fallback.",
  },
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
