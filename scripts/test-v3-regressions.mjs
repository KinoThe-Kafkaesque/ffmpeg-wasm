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

const writeAssFixture = (path) => {
  writeFileSync(
    path,
    `[Script Info]
ScriptType: v4.00+
PlayResX: 160
PlayResY: 90

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,14,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,1,0,2,8,8,8,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,Subtitle regression line
`,
  );
};

const buildFixtures = () => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const assPath = `${TMP_DIR}/subs.ass`;
  const lateMoovMp4 = `${TMP_DIR}/late-moov.mp4`;
  const multiTrackMkv = `${TMP_DIR}/multi-track-subs.mkv`;
  const mp3 = `${TMP_DIR}/audio.mp3`;
  const flac = `${TMP_DIR}/audio.flac`;
  const ogg = `${TMP_DIR}/audio.ogg`;

  writeAssFixture(assPath);

  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=12",
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

  return { lateMoovMp4, multiTrackMkv, audio: { mp3, flac, ogg } };
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

    let sawVideo = false;
    for (let i = 0; i < 4000; i += 1) {
      const frameRet = api.readFrame(ctx);
      if (frameRet === 1) {
        sawVideo = true;
        if (api.toRgba(ctx) > 0 && api.subtitleEventsCount(ctx) > 0) {
          break;
        }
      } else if (frameRet < 0) {
        throw new Error(`decode failed while waiting for subtitles: ${frameRet}`);
      }
    }

    assert(sawVideo, "no video frame decoded in subtitle fixture");
    const events = api.subtitleEventsCount(ctx);
    assert(events > 0, "subtitle packets did not produce libass events");
    const renderRet = api.renderSubtitles(ctx, 1.0);
    assert(renderRet === 1, `subtitle render did not draw at 1s: ${renderRet}`);

    return {
      streams: counts,
      selectedAudio: api.selectedAudioStream(ctx),
      selectedSubtitle: api.selectedSubtitleStream(ctx),
      subtitleEvents: events,
      renderRet,
    };
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

  console.log("V3 REGRESSIONS PASS");
  console.log(
    JSON.stringify(
      {
        lateMoovMp4,
        audioOnly,
        subtitlesAndTracks,
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
