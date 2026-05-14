#!/usr/bin/env node

import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { resolve } from "path";
import { loadWasmNode } from "./ffmpeg-wasm-node.mjs";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const TMP_DIR = "/tmp/ffmpeg-wasm-v3-regressions";
const AVMEDIA_TYPE_VIDEO = 0;
const AVMEDIA_TYPE_AUDIO = 1;
const AVMEDIA_TYPE_SUBTITLE = 3;

const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const runFfmpeg = (args) => {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit",
  });
};

const writeAssFixture = (path, { duration = 3, cues = 1 } = {}) => {
  const cueLines = [];
  for (let i = 0; i < cues; i += 1) {
    const start = i;
    const end = Math.min(duration, i + 0.85);
    cueLines.push(
      `Dialogue: 0,0:00:${start.toString().padStart(2, "0")}.00,0:00:${end
        .toString()
        .padStart(2, "0")}.00,Default,,0,0,0,,SYNC ${i.toString().padStart(2, "0")}`,
    );
  }

  writeFileSync(
    path,
    `[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,24,&H000000FF,&H000000FF,&H0000FF00,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,12,12,16,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${cueLines.join("\n")}
`,
  );
};

const buildFixtures = () => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const assPath = `${TMP_DIR}/subs.ass`;
  const syncAssPath = `${TMP_DIR}/sync-subs.ass`;
  const lateMoovMp4 = `${TMP_DIR}/late-moov.mp4`;
  const multiTrackMkv = `${TMP_DIR}/multi-track-subs.mkv`;
  const syncMkv = `${TMP_DIR}/seek-sync.mkv`;
  const mp3 = `${TMP_DIR}/audio.mp3`;
  const flac = `${TMP_DIR}/audio.flac`;
  const ogg = `${TMP_DIR}/audio.ogg`;

  writeAssFixture(assPath, { duration: 3, cues: 3 });
  writeAssFixture(syncAssPath, { duration: 12, cues: 12 });

  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=black:size=320x180:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "3",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "mpeg4",
    "-q:v",
    "6",
    "-c:a",
    "aac",
    lateMoovMp4,
  ]);

  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=12",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:sample_rate=48000",
    "-i",
    assPath,
    "-t",
    "3",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-map",
    "2:a:0",
    "-map",
    "3:s:0",
    "-c:v",
    "mpeg4",
    "-q:v",
    "6",
    "-c:a",
    "aac",
    "-c:s",
    "ass",
    "-metadata:s:a:0",
    "language=eng",
    "-metadata:s:a:1",
    "language=jpn",
    "-metadata:s:s:0",
    "language=eng",
    multiTrackMkv,
  ]);

  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=black:size=320x180:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000",
    "-i",
    syncAssPath,
    "-t",
    "12",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-map",
    "2:s:0",
    "-c:v",
    "mpeg4",
    "-g",
    "96",
    "-q:v",
    "6",
    "-c:a",
    "aac",
    "-c:s",
    "ass",
    syncMkv,
  ]);

  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "2",
    "-c:a",
    "mp3",
    mp3,
  ]);
  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "2",
    "-c:a",
    "flac",
    flac,
  ]);
  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "2",
    "-c:a",
    "libvorbis",
    ogg,
  ]);

  return { lateMoovMp4, multiTrackMkv, syncMkv, audio: { mp3, flac, ogg } };
};

const closeDecoder = (wasm, ctx) => {
  wasm.clearReadAtFile?.();
  if (ctx && wasm.api?.destroy) {
    wasm.api.destroy(ctx);
  }
};

const streamCounts = (streams) => ({
  video: streams.filter((stream) => stream.mediaType === AVMEDIA_TYPE_VIDEO).length,
  audio: streams.filter((stream) => stream.mediaType === AVMEDIA_TYPE_AUDIO).length,
  subtitle: streams.filter((stream) => stream.mediaType === AVMEDIA_TYPE_SUBTITLE).length,
});

const readAudioFrames = (api, ctx, wanted = 3, maxReads = 4000) => {
  let audio = 0;
  const pts = [];
  for (let i = 0; i < maxReads && audio < wanted; i += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 2) {
      audio += 1;
      pts.push(api.audioPts ? api.audioPts(ctx) : 0);
      assert(api.audioSamples(ctx) > 0, "decoded audio frame has no samples");
      assert(api.audioPtr(ctx) > 0, "decoded audio frame has no data pointer");
      assert(api.audioBytes(ctx) > 0, "decoded audio frame has no byte size");
      assert(api.audioSampleRate(ctx) > 0, "decoded audio frame has no sample rate");
    } else if (ret <= 0) {
      break;
    }
  }
  return { audio, pts };
};

const inspectRgba = (wasm, ctx) => {
  const { api, Module } = wasm;
  const ptr = api.rgbaPtr(ctx);
  const stride = api.rgbaStride(ctx);
  const width = api.width(ctx);
  const height = api.height(ctx);
  assert(ptr > 0 && stride > 0 && width > 0 && height > 0, "RGBA frame is not available");

  let redPixels = 0;
  let greenPixels = 0;
  let tintedPixels = 0;
  let maxR = 0;
  let maxG = 0;
  let maxB = 0;

  for (let y = 0; y < height; y += 1) {
    const row = ptr + y * stride;
    for (let x = 0; x < width; x += 1) {
      const offset = row + x * 4;
      const r = Module.HEAPU8[offset];
      const g = Module.HEAPU8[offset + 1];
      const b = Module.HEAPU8[offset + 2];
      maxR = Math.max(maxR, r);
      maxG = Math.max(maxG, g);
      maxB = Math.max(maxB, b);
      if (r > 120 || g > 120 || b > 120) {
        tintedPixels += 1;
      }
      if (r > 150 && r > g * 1.4 && r > b * 1.4) {
        redPixels += 1;
      }
      if (g > 120 && g > r * 1.15 && g > b * 1.15) {
        greenPixels += 1;
      }
    }
  }

  return { width, height, tintedPixels, redPixels, greenPixels, maxR, maxG, maxB };
};

const renderSubtitleAt = (wasm, ctx, targetPts, maxReads = 16000) => {
  const { api } = wasm;
  for (let i = 0; i < maxReads; i += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      const pts = api.pts(ctx);
      const rgbaRet = api.toRgba(ctx);
      assert(rgbaRet > 0, `RGBA conversion failed while rendering subtitles: ${rgbaRet}`);
      if (api.subtitleEventsCount(ctx) > 0 && pts >= targetPts) {
        const renderRet = api.renderSubtitles(ctx, pts);
        return {
          ok: renderRet === 1,
          renderRet,
          pts,
          events: api.subtitleEventsCount(ctx),
          pixels: inspectRgba(wasm, ctx),
        };
      }
    } else if (ret < 0) {
      throw new Error(`decode failed while rendering subtitles: ${ret}`);
    }
  }
  return { ok: false, renderRet: 0, pts: null, events: api.subtitleEventsCount(ctx) };
};

const testLateMoovMp4 = async (wasm, mediaPath) => {
  const { api } = wasm;
  const ctx = api.create(0);
  try {
    const opened = wasm.openLocalFile(ctx, mediaPath, { formatName: "mov" });
    assert(opened.size > 0, "late-moov MP4 open did not report file size");
    const duration = api.duration(ctx);
    assert(duration >= 2.5 && duration <= 4, `late-moov MP4 duration invalid: ${duration}`);
    const seekRet = api.seek(ctx, 1.5);
    assert(seekRet === 0, `late-moov MP4 seek failed: ${seekRet}`);
    const frame = wasm.readNextVideoFrame(ctx, 3000);
    assert(frame.ret === 1, `late-moov MP4 produced no video frame: ${JSON.stringify(frame)}`);
    return { duration, seekRet, firstPtsAfterSeek: frame.pts };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const testAudioOnly = async (wasm, audioFiles) => {
  const results = {};
  for (const [formatName, mediaPath] of Object.entries(audioFiles)) {
    const { api } = wasm;
    const ctx = api.create(0);
    try {
      wasm.openLocalFile(ctx, mediaPath, { formatName });
      const streams = wasm.getStreams(ctx);
      const counts = streamCounts(streams);
      assert(counts.video === 0, `${formatName} unexpectedly exposed a video stream`);
      assert(counts.audio >= 1, `${formatName} exposed no audio stream`);
      assert(api.selectedVideoStream(ctx) < 0, `${formatName} selected a video stream`);
      assert(api.selectedAudioStream(ctx) >= 0, `${formatName} selected no audio stream`);
      const decoded = readAudioFrames(api, ctx, 3);
      assert(decoded.audio >= 3, `${formatName} decoded too few audio frames`);
      results[formatName] = {
        streams: counts,
        decodedAudio: decoded.audio,
        lastPts: decoded.pts.at(-1),
      };
    } finally {
      closeDecoder(wasm, ctx);
    }
  }
  return results;
};

const testSubtitlesAndTracks = async (wasm, mediaPath) => {
  const { api } = wasm;
  const ctx = api.create(0);
  try {
    wasm.openLocalFile(ctx, mediaPath, { formatName: "matroska" });
    const streams = wasm.getStreams(ctx);
    const counts = streamCounts(streams);
    assert(counts.video === 1, `expected 1 video stream, got ${counts.video}`);
    assert(counts.audio === 2, `expected 2 audio streams, got ${counts.audio}`);
    assert(counts.subtitle >= 1, `expected subtitle stream, got ${counts.subtitle}`);

    const video = streams.find((stream) => stream.mediaType === AVMEDIA_TYPE_VIDEO);
    const audio = streams.filter((stream) => stream.mediaType === AVMEDIA_TYPE_AUDIO);
    const subtitle = streams.find((stream) => stream.mediaType === AVMEDIA_TYPE_SUBTITLE);
    assert(video, "missing video stream after open");
    assert(audio.length >= 2, "missing second audio stream after open");
    assert(subtitle, "missing subtitle stream after open");

    let ret = api.selectStreams(ctx, video.index, audio[1].index);
    assert(ret === 0, `selecting second audio stream failed: ${ret}`);
    assert(
      api.selectedAudioStream(ctx) === audio[1].index,
      `second audio stream not selected: ${api.selectedAudioStream(ctx)}`,
    );
    assert(readAudioFrames(api, ctx, 1, 2000).audio >= 1, "second audio stream produced no audio");

    ret = api.selectStreams(ctx, video.index, audio[0].index);
    assert(ret === 0, `switching back to first audio stream failed: ${ret}`);
    assert(
      api.selectedAudioStream(ctx) === audio[0].index,
      `first audio stream not selected: ${api.selectedAudioStream(ctx)}`,
    );

    ret = api.selectSubtitleStream(ctx, subtitle.index);
    assert(ret === 0, `selecting subtitle stream failed: ${ret}`);
    assert(api.selectedSubtitleStream(ctx) === subtitle.index, "subtitle stream selection not reflected");
    assert(api.subtitlesEnabled(ctx) === 1, "subtitles did not enable after selecting stream");

    const fontPath = `${ROOT_DIR}/web/Inter-Regular.ttf`;
    if (existsSync(fontPath)) {
      const font = readFileSync(fontPath);
      const addFontRet = wasm.addFontBytes(ctx, "NotoSans-Regular.ttf", font);
      assert(addFontRet === 0, `adding subtitle font failed: ${addFontRet}`);
    }

    const rendered = renderSubtitleAt(wasm, ctx, 1.0);
    assert(rendered.ok, `subtitle render did not draw near 1s: ${JSON.stringify(rendered)}`);
    assert(rendered.events > 0, "subtitle packets did not produce libass events");
    assert(
      rendered.pixels.redPixels >= 16,
      `subtitle fill did not render as red: ${JSON.stringify(rendered.pixels)}`,
    );
    assert(
      rendered.pixels.greenPixels >= 8,
      `subtitle outline did not render as green: ${JSON.stringify(rendered.pixels)}`,
    );

    return {
      streams: counts,
      selectedAudio: api.selectedAudioStream(ctx),
      selectedSubtitle: api.selectedSubtitleStream(ctx),
      subtitleEvents: rendered.events,
      rendered,
    };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const collectSeekSyncSample = (wasm, ctx, target) => {
  const { api } = wasm;
  const seekRet = api.seek(ctx, target);
  assert(seekRet === 0, `seek to ${target}s failed: ${seekRet}`);

  let firstVideoPts = null;
  let firstAudioPts = null;
  let subtitleRender = null;
  const audioPts = [];
  const maxReads = 32000;

  for (let i = 0; i < maxReads; i += 1) {
    const ret = api.readFrame(ctx);
    if (ret === 1) {
      const pts = api.pts(ctx);
      if (pts >= target - 0.08 && firstVideoPts === null) {
        firstVideoPts = pts;
        const rgbaRet = api.toRgba(ctx);
        assert(rgbaRet > 0, `RGBA conversion failed after seek ${target}: ${rgbaRet}`);
        if (api.subtitleEventsCount(ctx) > 0) {
          const renderRet = api.renderSubtitles(ctx, pts);
          subtitleRender = {
            renderRet,
            events: api.subtitleEventsCount(ctx),
            pixels: inspectRgba(wasm, ctx),
          };
        }
      }
    } else if (ret === 2) {
      const pts = api.audioPts(ctx);
      if (Number.isFinite(pts) && pts >= target - 0.08) {
        audioPts.push(pts);
        if (firstAudioPts === null) firstAudioPts = pts;
      }
    } else if (ret < 0) {
      throw new Error(`decode failed after seek ${target}: ${ret}`);
    }

    if (firstVideoPts !== null && firstAudioPts !== null && subtitleRender) {
      break;
    }
  }

  assert(firstVideoPts !== null, `no video frame near seek target ${target}`);
  assert(firstAudioPts !== null, `no audio frame near seek target ${target}`);
  assert(subtitleRender, `no subtitle render sample near seek target ${target}`);
  const avDelta = Math.abs(firstAudioPts - firstVideoPts);
  assert(
    avDelta <= 0.25,
    `A/V PTS drift after seek ${target}s is too high: video=${firstVideoPts}, audio=${firstAudioPts}`,
  );
  assert(
    subtitleRender.renderRet === 1 &&
      subtitleRender.pixels.redPixels >= 16 &&
      subtitleRender.pixels.greenPixels >= 8,
    `subtitle render/color failed after seek ${target}s: ${JSON.stringify(subtitleRender)}`,
  );

  return { target, firstVideoPts, firstAudioPts, avDelta, subtitleRender };
};

const testSeekSync = async (wasm, mediaPath) => {
  const { api } = wasm;
  const ctx = api.create(0);
  try {
    wasm.openLocalFile(ctx, mediaPath, { formatName: "matroska" });
    const streams = wasm.getStreams(ctx);
    const subtitle = streams.find((stream) => stream.mediaType === AVMEDIA_TYPE_SUBTITLE);
    assert(subtitle, "sync fixture has no subtitle stream");
    const subRet = api.selectSubtitleStream(ctx, subtitle.index);
    assert(subRet === 0, `selecting sync subtitle stream failed: ${subRet}`);

    const fontPath = `${ROOT_DIR}/web/Inter-Regular.ttf`;
    if (existsSync(fontPath)) {
      const font = readFileSync(fontPath);
      const addFontRet = wasm.addFontBytes(ctx, "NotoSans-Regular.ttf", font);
      assert(addFontRet === 0, `adding sync subtitle font failed: ${addFontRet}`);
    }

    const duration = api.duration(ctx);
    assert(duration >= 10, `sync fixture duration too short: ${duration}`);
    const samples = [
      collectSeekSyncSample(wasm, ctx, 2.2),
      collectSeekSyncSample(wasm, ctx, 8.2),
      collectSeekSyncSample(wasm, ctx, 4.2),
    ];

    const prolonged = [];
    for (let i = 0; i < 50000 && prolonged.length < 90; i += 1) {
      const ret = api.readFrame(ctx);
      if (ret === 1) {
        prolonged.push(api.pts(ctx));
      } else if (ret < 0) {
        break;
      }
    }
    assert(prolonged.length >= 60, `prolonged playback sample too short: ${prolonged.length}`);
    for (let i = 1; i < prolonged.length; i += 1) {
      assert(
        prolonged[i] + 1e-6 >= prolonged[i - 1],
        `video PTS regressed during prolonged playback at sample ${i}`,
      );
    }

    return { duration, samples, prolongedFrames: prolonged.length };
  } finally {
    closeDecoder(wasm, ctx);
  }
};

const main = async () => {
  const wasmJsPath = process.argv[2];
  const wasmPath = process.argv[3];
  const fixtures = buildFixtures();
  const wasm = await loadWasmNode({
    ...(wasmJsPath ? { wasmJsPath } : {}),
    ...(wasmPath ? { wasmPath } : {}),
  });

  const lateMoovMp4 = await testLateMoovMp4(wasm, fixtures.lateMoovMp4);
  const audioOnly = await testAudioOnly(wasm, fixtures.audio);
  const subtitlesAndTracks = await testSubtitlesAndTracks(wasm, fixtures.multiTrackMkv);
  const seekSync = await testSeekSync(wasm, fixtures.syncMkv);

  console.log("V3 REGRESSIONS PASS");
  console.log(
    JSON.stringify(
      {
        lateMoovMp4,
        audioOnly,
        subtitlesAndTracks,
        seekSync,
      },
      null,
      2,
    ),
  );
};

main().catch((err) => {
  console.error("V3 REGRESSIONS FAIL");
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
