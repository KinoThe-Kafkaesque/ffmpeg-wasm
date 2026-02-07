#!/usr/bin/env node

import { execFileSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { loadWasmNode } from "./ffmpeg-wasm-node.mjs";

const DEFAULT_VECTORS_DIR = "/tmp/ffmpeg-mkv-vectors";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    vectorsDir: DEFAULT_VECTORS_DIR,
    orderedChaptersPath: null,
    generate: true,
    wasmJsPath: null,
    wasmWasmPath: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--vectors-dir") {
      options.vectorsDir = resolve(args[++i]);
      continue;
    }
    if (arg === "--ordered-chapters") {
      options.orderedChaptersPath = resolve(args[++i]);
      continue;
    }
    if (arg === "--no-generate") {
      options.generate = false;
      continue;
    }
    if (arg === "--wasm-js") {
      options.wasmJsPath = resolve(args[++i]);
      continue;
    }
    if (arg === "--wasm-wasm") {
      options.wasmWasmPath = resolve(args[++i]);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
};

const runFfmpeg = (args) => {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    stdio: "inherit",
  });
};

const generateNoCuesVector = (path) => {
  runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=960x540:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000",
    "-t",
    "50",
    "-shortest",
    "-c:v",
    "mpeg4",
    "-q:v",
    "4",
    "-g",
    "48",
    "-c:a",
    "aac",
    "-f",
    "matroska",
    "-live",
    "1",
    path,
  ]);
};

const generateSparseCuesVector = (path) => {
  runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=960x540:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000",
    "-t",
    "80",
    "-shortest",
    "-c:v",
    "mpeg4",
    "-q:v",
    "4",
    "-g",
    "240",
    "-c:a",
    "aac",
    "-cluster_time_limit",
    "30000",
    "-f",
    "matroska",
    path,
  ]);
};

const ensureVectors = ({ vectorsDir, generate, orderedChaptersPath }) => {
  mkdirSync(vectorsDir, { recursive: true });

  const noCuesPath = resolve(vectorsDir, "no-cues.mkv");
  const sparseCuesPath = resolve(vectorsDir, "sparse-cues.mkv");
  const orderedPath = orderedChaptersPath ? resolve(orderedChaptersPath) : null;

  if (!existsSync(noCuesPath)) {
    if (!generate) {
      throw new Error(`Missing vector: ${noCuesPath}`);
    }
    generateNoCuesVector(noCuesPath);
  }

  if (!existsSync(sparseCuesPath)) {
    if (!generate) {
      throw new Error(`Missing vector: ${sparseCuesPath}`);
    }
    generateSparseCuesVector(sparseCuesPath);
  }

  return {
    noCuesPath,
    sparseCuesPath,
    orderedPath: orderedPath && existsSync(orderedPath) ? orderedPath : null,
  };
};

const readFirstVideoAfterSeek = (wasm, ctx, target, maxReads = 30000) => {
  const { api } = wasm;
  const ret = api.seek(ctx, target);
  if (ret < 0) {
    return { ok: false, ret, target, frame: null };
  }
  const frame = wasm.readUntilPts(ctx, target, maxReads);
  return { ok: frame.ok, ret, target, frame };
};

const runSeekVector = (wasm, mediaPath, overshootLimitSec) => {
  const { api } = wasm;
  const ctx = api.create(0);
  assert(ctx, `create failed for vector ${mediaPath}`);

  try {
    wasm.openLocalFile(ctx, mediaPath);
    const duration = api.duration ? api.duration(ctx) : 0;
    const chapters = wasm.getChapters ? wasm.getChapters(ctx) : [];
    const hasOrderedChapters = api.hasOrderedChapters
      ? Boolean(api.hasOrderedChapters(ctx))
      : false;

    const targets = [];
    if (duration > 0) {
      targets.push(Math.max(2, duration * 0.2));
      targets.push(Math.max(4, duration * 0.75));
    } else {
      targets.push(5, 20);
    }

    const seekResults = targets.map((target) =>
      readFirstVideoAfterSeek(wasm, ctx, target)
    );

    for (const result of seekResults) {
      assert(result.ret === 0, `seek failed on ${mediaPath}: ${result.ret}`);
      assert(result.ok, `seek produced no frame on ${mediaPath} target=${result.target}`);
      assert(
        result.frame.pts <= result.target + overshootLimitSec,
        `seek overshoot too large on ${mediaPath}: target=${result.target}, got=${result.frame.pts}`
      );
    }

    return {
      vector: mediaPath,
      duration,
      chaptersCount: chapters.length,
      hasOrderedChapters,
      seekResults: seekResults.map((item) => ({
        target: item.target,
        firstPts: item.frame?.pts ?? null,
      })),
    };
  } finally {
    wasm.clearReadAtFile?.();
    api.destroy?.(ctx);
  }
};

const runOrderedVector = (wasm, mediaPath) => {
  const { api } = wasm;
  const ctx = api.create(0);
  assert(ctx, `create failed for ordered vector ${mediaPath}`);

  try {
    wasm.openLocalFile(ctx, mediaPath);
    const chapters = wasm.getChapters ? wasm.getChapters(ctx) : [];
    const hasOrdered = api.hasOrderedChapters
      ? Boolean(api.hasOrderedChapters(ctx))
      : false;

    assert(chapters.length > 0, "ordered vector has no chapters");
    assert(hasOrdered, "ordered vector not detected as ordered chapters");
    assert(api.seekChapter, "seekChapter API unavailable in wasm build");

    const middle = chapters[Math.floor(chapters.length / 2)];
    const seekRet = api.seekChapter(ctx, middle.index);
    assert(seekRet === 0, `seekChapter failed on ordered vector: ${seekRet}`);

    const frame = wasm.readUntilPts(ctx, middle.startSeconds, 30000);
    assert(frame.ok, "ordered vector seekChapter produced no video frame");
    assert(
      frame.pts <= middle.startSeconds + 12,
      `ordered chapter seek overshoot too large: target=${middle.startSeconds}, got=${frame.pts}`
    );

    return {
      vector: mediaPath,
      chaptersCount: chapters.length,
      hasOrderedChapters: hasOrdered,
      seekChapterTarget: middle.startSeconds,
      seekChapterFirstPts: frame.pts,
    };
  } finally {
    wasm.clearReadAtFile?.();
    api.destroy?.(ctx);
  }
};

const main = async () => {
  const options = parseArgs();
  const vectors = ensureVectors(options);

  const wasm = await loadWasmNode({
    wasmJsPath: options.wasmJsPath || undefined,
    wasmPath: options.wasmWasmPath || undefined,
  });

  const results = {
    generated: {
      noCues: vectors.noCuesPath,
      sparseCues: vectors.sparseCuesPath,
      orderedChapters: vectors.orderedPath,
    },
    vectors: {},
    skipped: [],
  };

  results.vectors.noCues = runSeekVector(wasm, vectors.noCuesPath, 18);
  results.vectors.sparseCues = runSeekVector(wasm, vectors.sparseCuesPath, 28);

  if (vectors.orderedPath) {
    results.vectors.orderedChapters = runOrderedVector(wasm, vectors.orderedPath);
  } else {
    results.skipped.push(
      "ordered-chapters vector not provided. Use --ordered-chapters /path/to/ordered-chapters.mkv"
    );
  }

  console.log("MKV REGRESSION VECTORS PASS");
  console.log(JSON.stringify(results, null, 2));
};

main().catch((err) => {
  console.error("MKV REGRESSION VECTORS FAIL");
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});
