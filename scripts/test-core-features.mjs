#!/usr/bin/env node

import { existsSync } from "fs";
import { loadWasmNode } from "./ffmpeg-wasm-node.mjs";

const AVMEDIA_TYPE_VIDEO = 0;
const AVMEDIA_TYPE_AUDIO = 1;
const AVMEDIA_TYPE_SUBTITLE = 3;
const RANDOM_ACCESS_IO_MODE = 1;

const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const openDecoder = async (wasm, mediaPath, preferredMode = "auto") => {
  const { api } = wasm;
  assert(api.create && api.open, "missing required create/open API");

  const ctx = api.create(0);
  assert(ctx, "failed to create decoder context");

  const canReadAt = Boolean(api.setIoMode && wasm.openLocalFile);
  const mode =
    preferredMode === "append"
      ? "append"
      : preferredMode === "read_at"
        ? "read_at"
        : canReadAt
          ? "read_at"
          : "append";

  if (mode === "read_at") {
    const opened = wasm.openLocalFile(ctx, mediaPath, {
      cacheLimit: 64 * 1024 * 1024,
    });
    if (opened.ioMode !== null) {
      assert(
        opened.ioMode === RANDOM_ACCESS_IO_MODE,
        `unexpected io mode ${opened.ioMode} in read_at path`
      );
    }
    return { ctx, mode };
  }

  await wasm.appendFile(ctx, mediaPath, { chunkSize: 512 * 1024 });
  const openRet = api.open(ctx, null);
  assert(openRet === 0, `append-mode open failed: ${openRet}`);
  return { ctx, mode };
};

const closeDecoder = (wasm, ctx) => {
  wasm.clearReadAtFile?.();
  if (ctx && wasm.api?.destroy) {
    wasm.api.destroy(ctx);
  }
};

const readFrames = (api, ctx, { wantVideo = 3, wantAudio = 1, maxReads = 24000 } = {}) => {
  let video = 0;
  let audio = 0;
  let lastPts = null;

  for (let i = 0; i < maxReads; i += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      video += 1;
      lastPts = api.pts ? api.pts(ctx) : null;
      continue;
    }
    if (ret === 2) {
      audio += 1;
      continue;
    }
    if (ret <= 0) {
      break;
    }
  }

  return { video, audio, lastPts };
};

const firstVideoPts = (api, ctx, maxReads = 6000) => {
  for (let i = 0; i < maxReads; i += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      return { ok: true, pts: api.pts(ctx), reads: i + 1 };
    }
    if (ret === 2) continue;
    if (ret <= 0) return { ok: false, ret, reads: i + 1 };
  }
  return { ok: false, ret: 0, reads: maxReads };
};

const collectVideoPts = (api, ctx, wanted = 180, maxReads = 48000) => {
  const ptsList = [];
  for (let i = 0; i < maxReads; i += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      const pts = api.pts(ctx);
      if (Number.isFinite(pts)) {
        ptsList.push(pts);
      }
      if (ptsList.length >= wanted) {
        return { ok: true, ptsList, reads: i + 1 };
      }
      continue;
    }
    if (ret === 2) continue;
    if (ret <= 0) {
      return { ok: ptsList.length > 0, ret, ptsList, reads: i + 1 };
    }
  }
  return { ok: ptsList.length > 0, ret: 0, ptsList, reads: maxReads };
};

const testBasics = async (wasm, mediaPath) => {
  const { api } = wasm;
  const { ctx, mode } = await openDecoder(wasm, mediaPath, "auto");
  try {
    assert(api.duration, "duration API missing");
    const duration = api.duration(ctx);
    assert(duration > 0, `invalid duration: ${duration}`);

    const streams = wasm.getStreams(ctx);
    assert(streams.length > 0, "no streams detected");
    const hasVideo = streams.some((s) => s.mediaType === AVMEDIA_TYPE_VIDEO);
    assert(hasVideo, "no video stream found");

    const hasAudio = streams.some((s) => s.mediaType === AVMEDIA_TYPE_AUDIO);
    const sample = readFrames(api, ctx, {
      wantVideo: 4,
      wantAudio: hasAudio ? 1 : 0,
      maxReads: 20000,
    });
    assert(sample.video >= 1, "failed to decode any video frame");
    if (hasAudio) {
      assert(sample.audio >= 1, "failed to decode any audio frame");
    }

    if (api.width && api.height) {
      assert(api.width(ctx) > 0, "video width not set");
      assert(api.height(ctx) > 0, "video height not set");
    }

    if (api.toRgba && api.rgbaPtr && api.rgbaStride) {
      const rgbaRet = api.toRgba(ctx);
      assert(rgbaRet > 0, `RGBA conversion failed: ${rgbaRet}`);
      assert(api.rgbaPtr(ctx) > 0, "RGBA pointer is zero");
      assert(api.rgbaStride(ctx) > 0, "RGBA stride is zero");
    }

    return {
      mode,
      duration,
      streams: streams.length,
      decodedVideo: sample.video,
      decodedAudio: sample.audio,
    };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const testSelections = async (wasm, mediaPath) => {
  const { api } = wasm;
  const { ctx, mode } = await openDecoder(wasm, mediaPath, "auto");
  try {
    const streams = wasm.getStreams(ctx);
    const videoStream = streams.find((s) => s.mediaType === AVMEDIA_TYPE_VIDEO);
    const audioStream = streams.find((s) => s.mediaType === AVMEDIA_TYPE_AUDIO);
    const subtitleStream = streams.find((s) => s.mediaType === AVMEDIA_TYPE_SUBTITLE);

    let audioDisabled = null;
    if (api.selectStreams && videoStream) {
      const disableRet = api.selectStreams(ctx, videoStream.index, -2);
      assert(disableRet === 0, `disabling audio failed: ${disableRet}`);
      if (api.audioIsEnabled) {
        audioDisabled = api.audioIsEnabled(ctx) === 0;
        assert(audioDisabled, "audioIsEnabled did not toggle off");
      }

      const restoreRet = api.selectStreams(
        ctx,
        videoStream.index,
        audioStream ? audioStream.index : -2
      );
      assert(restoreRet === 0, `restoring streams failed: ${restoreRet}`);
    }

    let subtitleSelected = null;
    if (api.selectSubtitleStream && subtitleStream) {
      const subRet = api.selectSubtitleStream(ctx, subtitleStream.index);
      assert(subRet === 0, `subtitle select failed: ${subRet}`);
      if (api.selectedSubtitleStream) {
        subtitleSelected = api.selectedSubtitleStream(ctx);
        assert(
          subtitleSelected === subtitleStream.index,
          `unexpected subtitle stream selected: ${subtitleSelected}`
        );
      }
    }

    return {
      mode,
      audioDisabled,
      subtitleSelected,
    };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const testSeek = async (wasm, mediaPath) => {
  const { api } = wasm;
  assert(api.seek, "seek API missing");

  const readAtCapable = Boolean(api.setIoMode && wasm.openLocalFile);
  if (!readAtCapable) {
    return {
      skipped: true,
      reason: "read_at io mode exports are not available in this wasm artifact",
    };
  }

  const { ctx } = await openDecoder(wasm, mediaPath, "read_at");
  try {
    const duration = api.duration(ctx);
    assert(duration > 0, `invalid duration for seek test: ${duration}`);

    const forwardTarget = Math.max(30, duration * 0.55);
    const backTarget = Math.max(5, duration * 0.08);

    const fwdRet = api.seek(ctx, forwardTarget);
    assert(fwdRet === 0, `forward seek failed: ${fwdRet}`);
    const fwdFrame = firstVideoPts(api, ctx);
    assert(fwdFrame.ok, `no frame after forward seek: ${JSON.stringify(fwdFrame)}`);
    assert(
      fwdFrame.pts <= forwardTarget + 25,
      `forward seek overshot too far: target=${forwardTarget}, got=${fwdFrame.pts}`
    );

    const backRet = api.seek(ctx, backTarget);
    assert(backRet === 0, `backward seek failed: ${backRet}`);
    const backFrame = firstVideoPts(api, ctx);
    assert(backFrame.ok, `no frame after backward seek: ${JSON.stringify(backFrame)}`);
    assert(
      backFrame.pts <= backTarget + 20,
      `backward seek overshot too far: target=${backTarget}, got=${backFrame.pts}`
    );

    return {
      duration,
      forwardTarget,
      forwardFirstPts: fwdFrame.pts,
      backwardTarget: backTarget,
      backwardFirstPts: backFrame.pts,
    };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const testContainerMetadata = async (wasm, mediaPath) => {
  const { api } = wasm;
  const { ctx, mode } = await openDecoder(wasm, mediaPath, "auto");
  try {
    const chapters = wasm.getChapters ? wasm.getChapters(ctx) : [];
    const attachments = wasm.getAttachments ? wasm.getAttachments(ctx) : [];
    const hasOrderedChapters = api.hasOrderedChapters
      ? Boolean(api.hasOrderedChapters(ctx))
      : false;

    if (chapters.length > 0) {
      let prevStart = -Infinity;
      for (const chapter of chapters) {
        assert(
          Number.isFinite(chapter.startSeconds) && chapter.startSeconds >= 0,
          `invalid chapter start: ${JSON.stringify(chapter)}`
        );
        assert(
          chapter.startSeconds + 1e-6 >= prevStart,
          `chapters not monotonic at index ${chapter.index}`
        );
        prevStart = chapter.startSeconds;
      }

      if (api.seekChapter) {
        const targetChapter = chapters[Math.floor(chapters.length / 2)];
        const seekRet = api.seekChapter(ctx, targetChapter.index);
        assert(seekRet === 0, `seekChapter failed: ${seekRet}`);
        const frame = firstVideoPts(api, ctx, 8000);
        assert(
          frame.ok,
          `no frame after seekChapter ${targetChapter.index}: ${JSON.stringify(frame)}`
        );
        assert(
          frame.pts <= targetChapter.startSeconds + 25,
          `seekChapter overshot too far: target=${targetChapter.startSeconds}, got=${frame.pts}`
        );
      }
    }

    let fontLikeAttachments = 0;
    for (const attachment of attachments) {
      assert(
        Number.isFinite(attachment.size) && attachment.size >= 0,
        `invalid attachment size: ${JSON.stringify(attachment)}`
      );
      const mime = (attachment.mimeType || "").toLowerCase();
      const name = (attachment.name || "").toLowerCase();
      if (
        mime.startsWith("font/") ||
        name.endsWith(".ttf") ||
        name.endsWith(".otf") ||
        name.endsWith(".ttc") ||
        name.endsWith(".woff") ||
        name.endsWith(".woff2")
      ) {
        fontLikeAttachments += 1;
      }
    }

    return {
      mode,
      chaptersCount: chapters.length,
      hasOrderedChapters,
      attachmentsCount: attachments.length,
      fontLikeAttachments,
    };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const testTimingFidelity = async (wasm, mediaPath) => {
  const { api } = wasm;
  const readAtCapable = Boolean(api.setIoMode && wasm.openLocalFile);
  const { ctx, mode } = await openDecoder(
    wasm,
    mediaPath,
    readAtCapable ? "read_at" : "append"
  );
  try {
    const sample = collectVideoPts(api, ctx, 220, 50000);
    assert(
      sample.ok && sample.ptsList.length >= 30,
      `insufficient video pts sample: ${JSON.stringify(sample)}`
    );

    let monotonicViolations = 0;
    const deltas = [];
    for (let i = 1; i < sample.ptsList.length; i += 1) {
      const prev = sample.ptsList[i - 1];
      const next = sample.ptsList[i];
      const delta = next - prev;
      if (delta < -1e-5) {
        monotonicViolations += 1;
      } else if (delta > 1e-6) {
        deltas.push(delta);
      }
    }
    assert(monotonicViolations === 0, `video pts monotonic violations: ${monotonicViolations}`);
    assert(deltas.length > 0, "video pts deltas did not advance");

    const sortedDeltas = [...deltas].sort((a, b) => a - b);
    const medianDelta = sortedDeltas[Math.floor(sortedDeltas.length / 2)];
    assert(
      medianDelta > 0 && medianDelta < 1.5,
      `unexpected median frame delta: ${medianDelta}`
    );

    const seekResults = [];
    if (readAtCapable && api.seek && api.duration) {
      const duration = api.duration(ctx);
      const targets = [
        Math.max(5, duration * 0.1),
        Math.max(10, duration * 0.55),
        Math.max(8, duration * 0.22),
        Math.max(15, duration * 0.8),
      ];
      for (const target of targets) {
        const ret = api.seek(ctx, target);
        assert(ret === 0, `timing seek failed at ${target}: ${ret}`);
        const frame = firstVideoPts(api, ctx, 10000);
        assert(frame.ok, `timing seek produced no frame at ${target}`);
        assert(
          frame.pts <= target + 25,
          `timing seek overshot too far: target=${target}, got=${frame.pts}`
        );
        seekResults.push({
          target,
          firstPts: frame.pts,
        });
      }
    }

    return {
      mode,
      sampledFrames: sample.ptsList.length,
      medianDelta,
      monotonicViolations,
      seekResults,
    };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const main = async () => {
  const mediaPath = process.argv[2] || "/home/nyanpasu/Desktop/animus/test.mkv";
  if (!existsSync(mediaPath)) {
    throw new Error(`media file not found: ${mediaPath}`);
  }

  const wasmJsPath = process.argv[3];
  const wasmPath = process.argv[4];
  const wasm = await loadWasmNode({
    ...(wasmJsPath ? { wasmJsPath } : {}),
    ...(wasmPath ? { wasmPath } : {}),
  });

  const basics = await testBasics(wasm, mediaPath);
  const selections = await testSelections(wasm, mediaPath);
  const seek = await testSeek(wasm, mediaPath);
  const metadata = await testContainerMetadata(wasm, mediaPath);
  const timing = await testTimingFidelity(wasm, mediaPath);

  console.log("CORE FEATURES PASS");
  console.log(
    JSON.stringify(
      {
        basics,
        selections,
        seek,
        metadata,
        timing,
      },
      null,
      2
    )
  );
};

main().catch((err) => {
  console.error("CORE FEATURES FAIL");
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
