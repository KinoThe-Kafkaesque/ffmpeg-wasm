#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { performance } from "perf_hooks";
import { loadWasmNode } from "./ffmpeg-wasm-node.mjs";

const AVMEDIA_TYPE_VIDEO = 0;
const AVMEDIA_TYPE_AUDIO = 1;
const AVMEDIA_TYPE_SUBTITLE = 3;

const DEFAULT_HEVC_SAMPLE =
  "/home/nyanpasu/Desktop/animus/[ASW] Yuusha Party wo Oidasareta Kiyoubinbou - 08 [1080p HEVC][940054DD].mkv";
const DEFAULT_AV1_SAMPLE =
  "/home/nyanpasu/Desktop/animus/[Ironclad] Tatsuki Fujimoto 17-26 [1080p.AV1]/[Ironclad] Tatsuki Fujimoto 17-26 - S01E02 [1080p.AV1].mkv";
const DEFAULT_SAMPLE_ROOT = "/home/nyanpasu/Desktop/animus";
const FPS_TOLERANCE = Number.parseFloat(process.env.FFMPEG_WASM_FPS_TOLERANCE || "0.6");
const REALTIME_HEADROOM = Number.parseFloat(process.env.FFMPEG_WASM_REALTIME_HEADROOM || "1.0");
const REQUIRE_REALTIME = process.env.FFMPEG_WASM_REQUIRE_REALTIME !== "0";

const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const pathExists = (path) => path && existsSync(path);

const findFirstMedia = (root, predicate, maxEntries = 8000) => {
  if (!pathExists(root)) {
    return null;
  }

  const stack = [root];
  let seen = 0;
  while (stack.length > 0 && seen < maxEntries) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      seen += 1;
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile() && predicate(path)) {
        return path;
      }
      if (seen >= maxEntries) {
        break;
      }
    }
  }
  return null;
};

const resolveSample = ({ envName, fallbackPath, sampleRoot, predicate }) => {
  const envPath = process.env[envName];
  if (pathExists(envPath)) {
    return envPath;
  }
  if (pathExists(fallbackPath)) {
    return fallbackPath;
  }
  return findFirstMedia(sampleRoot, predicate);
};

const closeDecoder = (wasm, ctx) => {
  wasm.clearReadAtFile?.();
  if (ctx && wasm.api?.destroy) {
    wasm.api.destroy(ctx);
  }
};

const parseFrameRate = (value) => {
  if (!value || value === "0/0") {
    return null;
  }
  if (value.includes("/")) {
    const [numerator, denominator] = value.split("/").map(Number);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
      return numerator / denominator;
    }
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const probeVideoFrameRate = (mediaPath) => {
  try {
    const output = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate,r_frame_rate",
        "-of",
        "json",
        mediaPath,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const stream = JSON.parse(output).streams?.[0];
    if (!stream) {
      return null;
    }
    const avg = parseFrameRate(stream.avg_frame_rate);
    if (avg) {
      return { fps: avg, source: "ffprobe.avg_frame_rate", raw: stream.avg_frame_rate };
    }
    const reported = parseFrameRate(stream.r_frame_rate);
    return reported
      ? { fps: reported, source: "ffprobe.r_frame_rate", raw: stream.r_frame_rate }
      : null;
  } catch {
    return null;
  }
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const checkFrameCadence = (ptsList, expected, { label, nodeFps }) => {
  assert(ptsList.length >= 30, `${label} cadence needs at least 30 video PTS samples`);

  const finitePts = ptsList.filter((pts) => Number.isFinite(pts));
  assert(finitePts.length >= 30, `${label} cadence has too few finite PTS samples`);

  const deltas = [];
  let monotonicViolations = 0;
  for (let i = 1; i < finitePts.length; i += 1) {
    const previous = finitePts[i - 1];
    const current = finitePts[i];
    const delta = current - previous;
    if (delta <= 0) {
      monotonicViolations += 1;
    } else {
      deltas.push(delta);
    }
  }

  assert(monotonicViolations === 0, `${label} PTS is not monotonic (${monotonicViolations} violations)`);
  assert(deltas.length >= 29, `${label} cadence has too few valid frame deltas`);

  const medianDelta = median(deltas);
  const measuredMedianFps = 1 / medianDelta;
  const spanSeconds = finitePts.at(-1) - finitePts[0];
  assert(spanSeconds > 0, `${label} PTS span did not advance`);
  const measuredSpanFps = (finitePts.length - 1) / spanSeconds;
  const expectedFps = expected?.fps || measuredSpanFps;
  const expectedSource = expected?.source || "decoded_pts_inferred";
  const fpsDiff = Math.abs(measuredSpanFps - expectedFps);
  const tolerance = Math.max(FPS_TOLERANCE, expectedFps * 0.01);
  const expectedDelta = 1 / expectedFps;
  const largeGapThreshold = expectedDelta * 1.75;
  const largeGaps = deltas.filter((delta) => delta > largeGapThreshold).length;
  const largeGapLimit = Math.max(1, Math.floor(deltas.length * 0.01));

  assert(
    fpsDiff <= tolerance,
    `${label} FPS ${measuredSpanFps.toFixed(3)} differs from expected ${expectedFps.toFixed(3)} by ${fpsDiff.toFixed(3)}`,
  );
  assert(
    largeGaps <= largeGapLimit,
    `${label} has ${largeGaps} large frame gaps over ${largeGapThreshold.toFixed(4)}s`,
  );

  const realtimeFactor = nodeFps / expectedFps;
  if (REQUIRE_REALTIME) {
    assert(
      realtimeFactor >= REALTIME_HEADROOM,
      `${label} native decode throughput ${nodeFps.toFixed(2)} fps is below expected ${expectedFps.toFixed(2)} fps`,
    );
  }

  return {
    expectedFps,
    expectedSource,
    measuredFps: measuredSpanFps,
    measuredMedianFps,
    fpsDiff,
    spanSeconds,
    medianDelta,
    monotonicViolations,
    largeGaps,
    nativeDecodeFps: nodeFps,
    realtimeFactor,
    realtimeRequired: REQUIRE_REALTIME,
  };
};

const readVideoFrames = (api, ctx, wanted, { rgbaCount = 0, maxReads = 60000 } = {}) => {
  const startedAt = performance.now();
  let decodedVideo = 0;
  let decodedAudio = 0;
  let lastPts = null;
  const ptsList = [];

  for (let reads = 0; reads < maxReads; reads += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      decodedVideo += 1;
      lastPts = api.pts(ctx);
      ptsList.push(lastPts);
      if (decodedVideo <= rgbaCount) {
        const rgbaRet = api.toRgba(ctx);
        assert(rgbaRet > 0, `RGBA conversion failed with ${rgbaRet}`);
        assert(api.rgbaPtr(ctx) > 0, "RGBA pointer is zero");
        assert(api.rgbaStride(ctx) > 0, "RGBA stride is zero");
      }
      if (decodedVideo >= wanted) {
        const elapsed = Math.max(0.001, (performance.now() - startedAt) / 1000);
        return {
          decodedVideo,
          decodedAudio,
          lastPts,
          ptsList,
          nodeFps: decodedVideo / elapsed,
        };
      }
      continue;
    }
    if (ret === 2) {
      decodedAudio += 1;
      continue;
    }
    const detail = api.errorString ? api.errorString(ret) : "";
    throw new Error(`decode stopped at ret=${ret}${detail ? ` (${detail})` : ""}`);
  }

  throw new Error(`decode reached maxReads=${maxReads} before ${wanted} video frames`);
};

const firstVideoAfterSeek = (api, ctx, maxReads = 16000) => {
  for (let reads = 0; reads < maxReads; reads += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      return { ret, pts: api.pts(ctx), reads };
    }
    if (ret === 2) {
      continue;
    }
    const detail = api.errorString ? api.errorString(ret) : "";
    throw new Error(`seek decode stopped at ret=${ret}${detail ? ` (${detail})` : ""}`);
  }
  throw new Error(`seek decode reached maxReads=${maxReads} without a video frame`);
};

const selectVideoOnly = (api, ctx, videoStreamIndex) => {
  if (api.selectStreams) {
    const ret = api.selectStreams(ctx, videoStreamIndex, -2);
    assert(ret === 0, `video-only stream selection failed: ${ret}`);
  }
  if (api.selectSubtitleStream) {
    const ret = api.selectSubtitleStream(ctx, -2);
    assert(ret === 0, `subtitle disable failed: ${ret}`);
  }
};

const testAv1Dav1dStack = async (wasm, mediaPath) => {
  const { api } = wasm;
  assert(api.hasHevcAv1 && api.hasHevcAv1() === 1, "build does not report HEVC + libdav1d support");

  const ctx = api.create(0);
  try {
    const opened = wasm.openLocalFile(ctx, mediaPath, { cacheLimit: 64 * 1024 * 1024 });
    assert(opened.ioMode === 1, `AV1 sample did not open through read_at mode: ${opened.ioMode}`);

    const streams = wasm.getStreams(ctx);
    const video = streams.find(
      (stream) =>
        stream.mediaType === AVMEDIA_TYPE_VIDEO &&
        String(stream.codecName || "").toLowerCase() === "av1",
    );
    assert(video, "AV1 sample did not expose an AV1 video stream");
    selectVideoOnly(api, ctx, video.index);

    const expectedFrameRate = probeVideoFrameRate(mediaPath);
    const decoded = readVideoFrames(api, ctx, 120, { rgbaCount: 12 });
    const cadence = checkFrameCadence(decoded.ptsList, expectedFrameRate, {
      label: "AV1",
      nodeFps: decoded.nodeFps,
    });
    assert(api.width(ctx) > 0 && api.height(ctx) > 0, "AV1 sample reported an invalid decoded size");
    assert(decoded.lastPts > 4.5, `AV1 PTS did not advance far enough: ${decoded.lastPts}`);

    return {
      sample: mediaPath,
      stream: video.index,
      width: api.width(ctx),
      height: api.height(ctx),
      decodedVideo: decoded.decodedVideo,
      rgbaConversions: 12,
      lastPts: decoded.lastPts,
      cadence,
      nodeFps: decoded.nodeFps,
    };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const testHevcReadAtSeek = async (wasm, mediaPath) => {
  const { api } = wasm;
  const ctx = api.create(0);
  try {
    const opened = wasm.openLocalFile(ctx, mediaPath, { cacheLimit: 64 * 1024 * 1024 });
    assert(opened.ioMode === 1, `HEVC sample did not open through read_at mode: ${opened.ioMode}`);

    const duration = api.duration(ctx);
    assert(duration > 0, `HEVC duration looks invalid: ${duration}`);

    const streams = wasm.getStreams(ctx);
    const video = streams.find(
      (stream) =>
        stream.mediaType === AVMEDIA_TYPE_VIDEO &&
        String(stream.codecName || "").toLowerCase() === "hevc",
    );
    const audio = streams.find((stream) => stream.mediaType === AVMEDIA_TYPE_AUDIO);
    const subtitles = streams.filter((stream) => stream.mediaType === AVMEDIA_TYPE_SUBTITLE);
    assert(video, "HEVC sample did not expose a HEVC video stream");
    assert(audio, "HEVC sample did not expose an audio stream");

    const expectedFrameRate = probeVideoFrameRate(mediaPath);
    const decoded = readVideoFrames(api, ctx, 220, { rgbaCount: 1 });
    const cadence = checkFrameCadence(decoded.ptsList, expectedFrameRate, {
      label: "HEVC",
      nodeFps: decoded.nodeFps,
    });
    assert(decoded.decodedAudio > 0, "HEVC sample decoded no audio while reading video");

    const target = duration * 0.55;
    const seekRet = api.seek(ctx, target);
    assert(seekRet === 0, `HEVC seek failed: ${seekRet}`);
    const afterSeek = firstVideoAfterSeek(api, ctx);
    assert(afterSeek.pts >= target - 15, `HEVC seek landed too far before target: ${afterSeek.pts} < ${target}`);
    assert(afterSeek.pts <= target + 3, `HEVC seek landed after target unexpectedly: ${afterSeek.pts} > ${target}`);

    return {
      sample: mediaPath,
      duration,
      stream: video.index,
      audioStream: audio.index,
      subtitleStreams: subtitles.length,
      decodedVideo: decoded.decodedVideo,
      decodedAudio: decoded.decodedAudio,
      cadence,
      seekTarget: target,
      firstPtsAfterSeek: afterSeek.pts,
      nodeFps: decoded.nodeFps,
    };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const main = async () => {
  const wasmJsPath = resolve(process.argv[2] || "build/ffmpeg-wasm/ffmpeg_wasm.js");
  const wasmPath = resolve(process.argv[3] || "build/ffmpeg-wasm/ffmpeg_wasm.wasm");
  const sampleRoot = process.env.FFMPEG_WASM_SAMPLE_ROOT || DEFAULT_SAMPLE_ROOT;
  const av1Sample = resolveSample({
    envName: "FFMPEG_WASM_AV1_SAMPLE",
    fallbackPath: DEFAULT_AV1_SAMPLE,
    sampleRoot,
    predicate: (path) => /\.mkv$/i.test(path) && /av1/i.test(path),
  });
  const hevcSample = resolveSample({
    envName: "FFMPEG_WASM_HEVC_SAMPLE",
    fallbackPath: DEFAULT_HEVC_SAMPLE,
    sampleRoot,
    predicate: (path) => /\.mkv$/i.test(path) && /hevc/i.test(path),
  });

  assert(pathExists(wasmJsPath), `WASM JS not found: ${wasmJsPath}`);
  assert(pathExists(wasmPath), `WASM binary not found: ${wasmPath}`);
  assert(av1Sample || hevcSample, `No AV1/HEVC samples found under ${sampleRoot}`);

  const wasm = await loadWasmNode({ wasmJsPath, wasmPath });
  const results = {};

  if (av1Sample) {
    results.av1Dav1dStack = await testAv1Dav1dStack(wasm, av1Sample);
  } else {
    results.av1Dav1dStack = { skipped: true, reason: "missing AV1 sample" };
  }

  if (hevcSample) {
    results.hevcReadAtSeek = await testHevcReadAtSeek(wasm, hevcSample);
  } else {
    results.hevcReadAtSeek = { skipped: true, reason: "missing HEVC sample" };
  }

  console.log("CODEC REGRESSIONS PASS");
  console.log(JSON.stringify(results, null, 2));
};

main().catch((err) => {
  console.error("CODEC REGRESSIONS FAIL");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
