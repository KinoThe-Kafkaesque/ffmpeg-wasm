#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { performance } from "perf_hooks";
import { loadWasmNode } from "./ffmpeg-wasm-node.mjs";

const AVMEDIA_TYPE_VIDEO = 0;

const DEFAULT_FRAMES = Number.parseInt(process.env.FFMPEG_WASM_PERF_FRAMES || "120", 10);
const FPS_TOLERANCE = Number.parseFloat(process.env.FFMPEG_WASM_FPS_TOLERANCE || "0.6");
const REALTIME_HEADROOM = Number.parseFloat(process.env.FFMPEG_WASM_REALTIME_HEADROOM || "1.0");
const REPORT_ONLY = process.env.FFMPEG_WASM_PERF_REPORT_ONLY === "1";

const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const parseFrameRate = (value) => {
  if (!value || value === "0/0") {
    return null;
  }
  if (value.includes("/")) {
    const [numerator, denominator] = value.split("/").map(Number);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator
      : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const probeVideo = (mediaPath) => {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,avg_frame_rate,r_frame_rate",
      "-show_entries",
      "format=duration,size,format_name",
      "-of",
      "json",
      mediaPath,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const data = JSON.parse(output);
  const stream = data.streams?.[0];
  assert(stream, "ffprobe found no video stream");
  const avgFps = parseFrameRate(stream.avg_frame_rate);
  const reportedFps = parseFrameRate(stream.r_frame_rate);
  const fps = avgFps || reportedFps;
  assert(fps, "ffprobe did not report a usable video frame rate");
  return {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    expectedFps: fps,
    expectedFpsSource: avgFps ? "ffprobe.avg_frame_rate" : "ffprobe.r_frame_rate",
    rawFrameRate: avgFps ? stream.avg_frame_rate : stream.r_frame_rate,
    duration: Number.parseFloat(data.format?.duration || "0"),
    sizeBytes: Number.parseInt(data.format?.size || "0", 10),
    formatName: data.format?.format_name || "",
  };
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const checkCadence = (ptsList, expectedFps) => {
  const finitePts = ptsList.filter((pts) => Number.isFinite(pts));
  assert(finitePts.length >= 30, "cadence check needs at least 30 finite PTS values");

  const deltas = [];
  let monotonicViolations = 0;
  for (let i = 1; i < finitePts.length; i += 1) {
    const delta = finitePts[i] - finitePts[i - 1];
    if (delta <= 0) {
      monotonicViolations += 1;
    } else {
      deltas.push(delta);
    }
  }
  assert(monotonicViolations === 0, `PTS is not monotonic (${monotonicViolations} violations)`);
  assert(deltas.length >= 29, "cadence check has too few valid frame deltas");

  const spanSeconds = finitePts.at(-1) - finitePts[0];
  assert(spanSeconds > 0, "PTS span did not advance");
  const measuredFps = (finitePts.length - 1) / spanSeconds;
  const medianDelta = median(deltas);
  const measuredMedianFps = 1 / medianDelta;
  const fpsDiff = Math.abs(measuredFps - expectedFps);
  const tolerance = Math.max(FPS_TOLERANCE, expectedFps * 0.01);
  const expectedDelta = 1 / expectedFps;
  const largeGapThreshold = expectedDelta * 1.75;
  const largeGaps = deltas.filter((delta) => delta > largeGapThreshold).length;
  const largeGapLimit = Math.max(1, Math.floor(deltas.length * 0.01));

  assert(
    fpsDiff <= tolerance,
    `decoded PTS FPS ${measuredFps.toFixed(3)} differs from expected ${expectedFps.toFixed(3)} by ${fpsDiff.toFixed(3)}`,
  );
  assert(largeGaps <= largeGapLimit, `detected ${largeGaps} large frame gaps`);

  return {
    measuredFps,
    measuredMedianFps,
    fpsDiff,
    spanSeconds,
    medianDelta,
    monotonicViolations,
    largeGaps,
  };
};

const closeDecoder = (wasm, ctx) => {
  wasm.clearReadAtFile?.();
  if (ctx && wasm.api?.destroy) {
    wasm.api.destroy(ctx);
  }
};

const runPlaybackPass = async (wasm, mediaPath, videoMeta, { convertRgba }) => {
  const { api } = wasm;
  const ctx = api.create(0);
  try {
    const opened = wasm.openLocalFile(ctx, mediaPath, { cacheLimit: 64 * 1024 * 1024 });
    assert(opened.ioMode === 1, `expected read_at IO mode, got ${opened.ioMode}`);

    const streams = wasm.getStreams(ctx);
    const video = streams.find((stream) => stream.mediaType === AVMEDIA_TYPE_VIDEO);
    assert(video, "WASM open found no video stream");
    if (api.selectStreams) {
      const ret = api.selectStreams(ctx, video.index, -2);
      assert(ret === 0, `video-only stream selection failed: ${ret}`);
    }
    if (api.selectSubtitleStream) {
      const ret = api.selectSubtitleStream(ctx, -2);
      assert(ret === 0, `subtitle disable failed: ${ret}`);
    }

    const ptsList = [];
    let decodedVideo = 0;
    const startedAt = performance.now();
    for (let reads = 0; decodedVideo < DEFAULT_FRAMES && reads < DEFAULT_FRAMES * 800; reads += 1) {
      const ret = api.readFrame(ctx);
      if (ret === 1) {
        if (convertRgba) {
          const rgbaRet = api.toRgba(ctx);
          assert(rgbaRet > 0, `RGBA conversion failed: ${rgbaRet}`);
          assert(api.rgbaPtr(ctx) > 0, "RGBA pointer is zero");
          assert(api.rgbaStride(ctx) > 0, "RGBA stride is zero");
        }
        decodedVideo += 1;
        ptsList.push(api.pts(ctx));
        continue;
      }
      if (ret === 2) {
        continue;
      }
      const detail = api.errorString ? api.errorString(ret) : "";
      throw new Error(`decode stopped at ret=${ret}${detail ? ` (${detail})` : ""}`);
    }
    assert(decodedVideo >= DEFAULT_FRAMES, `decoded ${decodedVideo} frames, expected ${DEFAULT_FRAMES}`);

    const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
    const throughputFps = decodedVideo / elapsedSeconds;
    const cadence = checkCadence(ptsList, videoMeta.expectedFps);
    const realtimeFactor = throughputFps / videoMeta.expectedFps;

    return {
      decodedVideo,
      convertRgba,
      elapsedSeconds,
      throughputFps,
      realtimeFactor,
      cadence,
    };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const usage = () => {
  console.error(
    "Usage: node scripts/test-playback-performance.mjs <media> [wasm_js] [wasm_wasm]\n" +
      "Set FFMPEG_WASM_PERF_FRAMES, FFMPEG_WASM_REALTIME_HEADROOM, or FFMPEG_WASM_PERF_REPORT_ONLY=1 to tune the run.",
  );
};

const main = async () => {
  const mediaPath = process.argv[2] ? resolve(process.argv[2]) : "";
  const wasmJsPath = resolve(process.argv[3] || "build/ffmpeg-wasm/ffmpeg_wasm.js");
  const wasmPath = resolve(process.argv[4] || "build/ffmpeg-wasm/ffmpeg_wasm.wasm");

  if (!mediaPath) {
    usage();
    process.exit(2);
  }
  assert(existsSync(mediaPath), `media file not found: ${mediaPath}`);
  assert(existsSync(wasmJsPath), `WASM JS not found: ${wasmJsPath}`);
  assert(existsSync(wasmPath), `WASM binary not found: ${wasmPath}`);

  const videoMeta = probeVideo(mediaPath);
  const wasm = await loadWasmNode({ wasmJsPath, wasmPath });
  const decodeOnly = await runPlaybackPass(wasm, mediaPath, videoMeta, { convertRgba: false });
  const decodeRgba = await runPlaybackPass(wasm, mediaPath, videoMeta, { convertRgba: true });
  const requiredFps = videoMeta.expectedFps * REALTIME_HEADROOM;
  const failures = [];
  if (decodeOnly.throughputFps < requiredFps) {
    failures.push(
      `decode-only throughput ${decodeOnly.throughputFps.toFixed(2)} fps is below required ${requiredFps.toFixed(2)} fps`,
    );
  }
  if (decodeRgba.throughputFps < requiredFps) {
    failures.push(
      `decode+RGBA throughput ${decodeRgba.throughputFps.toFixed(2)} fps is below required ${requiredFps.toFixed(2)} fps`,
    );
  }

  const result = {
    mediaPath,
    video: videoMeta,
    frames: DEFAULT_FRAMES,
    requiredFps,
    decodeOnly,
    decodeRgba,
    pass: failures.length === 0,
    failures,
    reportOnly: REPORT_ONLY,
  };

  console.log(result.pass ? "PLAYBACK PERFORMANCE PASS" : "PLAYBACK PERFORMANCE FAIL");
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass && !REPORT_ONLY) {
    process.exit(1);
  }
};

main().catch((err) => {
  console.error("PLAYBACK PERFORMANCE ERROR");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
