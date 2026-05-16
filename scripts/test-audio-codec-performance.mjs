#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { performance } from "perf_hooks";
import { loadWasmNode } from "./ffmpeg-wasm-node.mjs";

const AVMEDIA_TYPE_AUDIO = 1;
const TARGET_SECONDS = Number.parseFloat(process.env.FFMPEG_WASM_AUDIO_PERF_SECONDS || "4.5");
const MIN_REALTIME = Number.parseFloat(process.env.FFMPEG_WASM_AUDIO_REALTIME_HEADROOM || "1.0");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const probeAudio = (mediaPath) => {
  const output = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,sample_rate,channels",
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
  assert(stream, "ffprobe found no audio stream");
  return {
    codec: stream.codec_name,
    sampleRate: Number.parseInt(stream.sample_rate || "0", 10),
    channels: Number.parseInt(stream.channels || "0", 10),
    duration: Number.parseFloat(data.format?.duration || "0"),
    sizeBytes: Number.parseInt(data.format?.size || "0", 10),
    formatName: data.format?.format_name || "",
  };
};

const usage = () => {
  console.error("Usage: node scripts/test-audio-codec-performance.mjs <media> [wasm_js] [wasm_wasm]");
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

  const audioMeta = probeAudio(mediaPath);
  const wasm = await loadWasmNode({ wasmJsPath, wasmPath });
  const { api } = wasm;
  const ctx = api.create(0);

  try {
    wasm.openLocalFile(ctx, mediaPath, { cacheLimit: 16 * 1024 * 1024 });
    const streams = wasm.getStreams(ctx);
    const audio = streams.find((stream) => stream.mediaType === AVMEDIA_TYPE_AUDIO);
    assert(audio, "WASM open found no audio stream");

    if (api.selectStreams) {
      const ret = api.selectStreams(ctx, -2, audio.index);
      assert(ret === 0, `audio-only stream selection failed: ${ret}`);
    }

    let decodedFrames = 0;
    let decodedMediaSeconds = 0;
    let outputSampleRate = 0;
    let outputChannels = 0;
    const startedAt = performance.now();

    for (let reads = 0; decodedMediaSeconds < TARGET_SECONDS && reads < 20000; reads += 1) {
      const ret = api.readFrame(ctx);
      if (ret === 2) {
        decodedFrames += 1;
        const samples = api.audioSamples(ctx);
        outputSampleRate = api.audioSampleRate(ctx);
        outputChannels = api.audioChannels(ctx);
        assert(samples > 0, "audio frame has no samples");
        assert(outputSampleRate > 0, "audio frame has no sample rate");
        assert(outputChannels > 0, "audio frame has no channels");
        assert(api.audioPtr(ctx) > 0, "audio frame has no data pointer");
        assert(api.audioBytes(ctx) > 0, "audio frame has no byte size");
        decodedMediaSeconds += samples / outputSampleRate;
        continue;
      }
      if (ret === 1) continue;
      const detail = api.errorString ? api.errorString(ret) : "";
      throw new Error(`decode stopped at ret=${ret}${detail ? ` (${detail})` : ""}`);
    }

    assert(decodedMediaSeconds >= Math.min(1, TARGET_SECONDS), "decoded too little audio");
    const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
    const realtimeFactor = decodedMediaSeconds / elapsedSeconds;
    const result = {
      mediaPath,
      audio: audioMeta,
      streamCodec: audio.codecName,
      decodedFrames,
      decodedMediaSeconds,
      elapsedSeconds,
      realtimeFactor,
      outputSampleRate,
      outputChannels,
      requiredRealtimeFactor: MIN_REALTIME,
      pass: realtimeFactor >= MIN_REALTIME,
    };

    console.log(result.pass ? "AUDIO CODEC PERFORMANCE PASS" : "AUDIO CODEC PERFORMANCE FAIL");
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) process.exit(1);
  } finally {
    wasm.clearReadAtFile?.();
    if (api.destroy) api.destroy(ctx);
  }
};

main().catch((err) => {
  console.error("AUDIO CODEC PERFORMANCE ERROR");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
