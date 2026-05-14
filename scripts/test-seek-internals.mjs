#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { loadWasmNode } from "./ffmpeg-wasm-node.mjs";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const TMP_DIR = "/tmp/ffmpeg-seek-internals";
const TEST_JS = `${TMP_DIR}/ffmpeg_wasm_test.js`;
const TEST_WASM = `${TMP_DIR}/ffmpeg_wasm_test.wasm`;

const SEEK_SET = 0;
const SEEK_CUR = 1;
const SEEK_END = 2;
const AVSEEK_SIZE = 0x10000;
const FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL = 1;

const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const buildTestWasm = () => {
  mkdirSync(TMP_DIR, { recursive: true });
  const cmd = `
	set -euo pipefail
	source third_party/emsdk/emsdk_env.sh >/dev/null
	EXPORTED_FUNCTIONS="$(node scripts/print-exported-functions.mjs --include-test-only)"
	emcc -O2 -DFFMPEG_WASM_TESTING=1 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=FFmpegWasm \
  -s ENVIRONMENT='node' \
  -s FILESYSTEM=0 \
  -s INITIAL_MEMORY=64MB \
  -s ALLOW_MEMORY_GROWTH=1 \
	  -s EXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -s EXPORTED_RUNTIME_METHODS='["cwrap"]' \
  --no-entry \
  -Ibuild/ffmpeg-wasm/include \
  -Ibuild/ffmpeg-wasm/include/freetype2 \
	  -Ibuild/ffmpeg-wasm/include/fribidi \
	  -Ibuild/ffmpeg-wasm/include/ass \
	  src/ffmpeg_wasm.c \
	  src/ffmpeg_wasm_debug.c \
  -Lbuild/ffmpeg-wasm/lib \
  -Wl,--start-group \
  -lavformat -lavcodec -lswresample -lswscale -lavutil \
  -lass -lfreetype -lfribidi -ldav1d \
  -Wl,--end-group \
  -o "${TEST_JS}"
`;
  execSync(cmd, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: "/bin/bash",
  });
};

const runSeekStreamUnitCases = async (wasm) => {
  const { api, appendBytes } = wasm;
  assert(api.create && api.setFileSize && api.setBufferOffset, "missing basic API");
  assert(api.setIoMode && api.getIoMode, "missing io mode API");
  assert(api.debugSeekStream && api.debugBytePos, "missing debug seek API");

  const ctx = api.create(1024);
  try {
    api.setFileSize(ctx, 1000);
    api.setBufferOffset(ctx, 900);
    const appendRet = appendBytes(ctx, new Uint8Array(100));
    assert(appendRet > 0, `append failed in unit case: ${appendRet}`);

    const sz = api.debugSeekStream(ctx, 0, AVSEEK_SIZE);
    assert(sz === 1000, `AVSEEK_SIZE mismatch: got ${sz}, expected 1000`);

    const seekRet = api.debugSeekStream(ctx, -10, SEEK_END);
    assert(seekRet === 990, `SEEK_END(-10) mismatch: got ${seekRet}, expected 990`);

    const pos = api.debugBytePos(ctx);
    assert(pos === 990, `byte position mismatch: got ${pos}, expected 990`);

    const outOfRange = api.debugSeekStream(ctx, -200, SEEK_END);
    assert(outOfRange < 0, `expected out-of-range seek to fail, got ${outOfRange}`);

    const ioRet = api.setIoMode(ctx, FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL);
    assert(ioRet === 0, `set io mode failed: ${ioRet}`);
    const ioMode = api.getIoMode(ctx);
    assert(
      ioMode === FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL,
      `unexpected io mode: ${ioMode}`
    );

    const randomSize = api.debugSeekStream(ctx, 0, AVSEEK_SIZE);
    assert(randomSize === 1000, `random AVSEEK_SIZE mismatch: got ${randomSize}`);
    const randomEnd = api.debugSeekStream(ctx, -10, SEEK_END);
    assert(randomEnd === 990, `random SEEK_END(-10) mismatch: got ${randomEnd}`);
    const randomPos = api.debugBytePos(ctx);
    assert(randomPos === 990, `random byte position mismatch: got ${randomPos}`);
  } finally {
    api.destroy(ctx);
  }
};

const readFirstVideoPts = (api, ctx, maxReads = 4000) => {
  for (let i = 0; i < maxReads; i += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      return { ok: true, pts: api.pts(ctx), reads: i + 1 };
    }
    if (ret === 2) continue;
    if (ret <= 0) return { ok: false, ret, pts: null, reads: i + 1 };
  }
  return { ok: false, ret: 0, pts: null, reads: maxReads };
};

const readUntilPts = (api, ctx, targetPts, maxReads) => {
  let lastPts = -1;
  for (let i = 0; i < maxReads; i += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      const pts = api.pts(ctx);
      lastPts = pts;
      if (pts >= targetPts) {
        return { ok: true, pts, reads: i + 1 };
      }
      continue;
    }
    if (ret === 2) continue;
    if (ret < 0) return { ok: false, ret, pts: lastPts, reads: i + 1 };
  }
  return { ok: false, ret: 0, pts: lastPts, reads: maxReads };
};

const runSeekRegressionCase = async (wasm, mediaPath) => {
  if (!existsSync(mediaPath)) {
    throw new Error(`media file not found: ${mediaPath}`);
  }
  const { api, appendFile } = wasm;
  assert(api.create && api.open && api.seek, "missing decode API");

  const ctx = api.create(0);
  try {
    await appendFile(ctx, mediaPath, { chunkSize: 512 * 1024 });

    const openRet = api.open(ctx, null);
    assert(openRet === 0, `open failed: ${openRet}`);

    const duration = api.duration(ctx);
    assert(duration > 0, `invalid duration: ${duration}`);

    const seekFwd = api.seek(ctx, 800);
    assert(
      seekFwd < 0,
      `append-stream timestamp seek should be disabled, got ${seekFwd}`
    );

    return {
      duration,
      appendSeekRet: seekFwd,
      bufferedAfterOpen: api.bufferedBytes(ctx),
    };
  } finally {
    api.destroy(ctx);
  }
};

const runRandomAccessSeekCase = async (wasm, mediaPath) => {
  if (!existsSync(mediaPath)) {
    throw new Error(`media file not found: ${mediaPath}`);
  }
  const { api, openLocalFile, clearReadAtFile } = wasm;
  assert(api.create && api.open && api.seek, "missing decode API");
  assert(openLocalFile, "missing openLocalFile helper");

  const ctx = api.create(0);
  try {
    const opened = openLocalFile(ctx, mediaPath, {
      cacheLimit: 64 * 1024 * 1024,
    });
    if (opened.ioMode !== null) {
      assert(
        opened.ioMode === FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL,
        `expected random-access io mode, got ${opened.ioMode}`
      );
    }

    const duration = api.duration(ctx);
    assert(duration > 0, `invalid duration in random-access mode: ${duration}`);

    const seekFwd = api.seek(ctx, 800);
    assert(seekFwd === 0, `random-access forward seek failed: ${seekFwd}`);
    const fwdFirst = readFirstVideoPts(api, ctx, 4000);
    assert(fwdFirst.ok, `no video frame after forward seek: ${JSON.stringify(fwdFirst)}`);
    assert(
      fwdFirst.pts <= 820,
      `forward seek overshot target too far: first pts=${fwdFirst.pts}`
    );

    const burn = readUntilPts(api, ctx, 1100, 32000);
    assert(burn.ok, `failed burn decode to 1100s in random-access mode: ${JSON.stringify(burn)}`);

    const backSeek = api.seek(ctx, 100);
    assert(backSeek === 0, `random-access backward seek failed: ${backSeek}`);
    const backFirst = readFirstVideoPts(api, ctx, 4000);
    assert(backFirst.ok, `no video frame after backward seek: ${JSON.stringify(backFirst)}`);
    assert(
      backFirst.pts <= 120,
      `backward seek overshot target too far: first pts=${backFirst.pts}`
    );

    return {
      duration,
      forwardFirstPts: fwdFirst.pts,
      burnPts: burn.pts,
      backwardSeekRet: backSeek,
      backwardFirstPts: backFirst.pts,
      bufferedAfterSeek: api.bufferedBytes(ctx),
    };
  } finally {
    clearReadAtFile?.();
    api.destroy(ctx);
  }
};

const main = async () => {
  const mediaPath =
    process.argv[2] || "/home/nyanpasu/Desktop/animus/test.mkv";

  buildTestWasm();

  const wasm = await loadWasmNode({
    wasmJsPath: TEST_JS,
    wasmPath: TEST_WASM,
  });

  await runSeekStreamUnitCases(wasm);
  const appendRegression = await runSeekRegressionCase(wasm, mediaPath);
  const randomAccessRegression = await runRandomAccessSeekCase(wasm, mediaPath);

  console.log("SEEK INTERNALS PASS");
  console.log(
    JSON.stringify(
      {
        appendRegression,
        randomAccessRegression,
      },
      null,
      2
    )
  );
};

main().catch((err) => {
  console.error("SEEK INTERNALS FAIL");
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
