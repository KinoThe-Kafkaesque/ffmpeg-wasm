#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, relative, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FATE_DIR = resolve(ROOT_DIR, "third_party/ffmpeg/tests/fate");
const DEFAULT_OUT = resolve(ROOT_DIR, "web/fate-browser-manifest.js");

const DEFAULT_FATE_FILES = [
  "aac.mak",
  "cbs.mak",
  "demux.mak",
  "flvenc.mak",
  "flac.mak",
  "h264.mak",
  "hevc.mak",
  "image.mak",
  "lavf-container.mak",
  "matroska.mak",
  "mov.mak",
  "mp3.mak",
  "mpegts.mak",
  "opus.mak",
  "seek.mak",
  "vorbis.mak",
  "vpx.mak",
  "webm-dash-manifest.mak",
];

const BROWSER_SMOKE_IDS = new Set([
  "fate-av1-annexb-demux",
  "fate-cbs-av1-av1-1-b8-05-mv",
  "fate-cbs-av1-decode_model",
  "fate-cbs-hevc-HRD_A_Fujitsu_2",
  "fate-cbs-hevc-WPP_A_ericsson_MAIN_2",
  "fate-enhanced-flv-av1",
  "fate-enhanced-flv-hevc",
  "fate-hevc-dv-rpu",
  "fate-hevc-hdr10-plus-metadata",
  "fate-matroska-h264-remux",
  "fate-matroska-dovi-write-config8",
  "fate-matroska-mpegts-remux",
  "fate-matroska-opus-remux",
  "fate-matroska-remux",
  "fate-mov-avif-demux-still-image-1-item",
  "fate-mov-displaymatrix",
  "fate-mov-frag-overlap",
  "fate-mov-heic-demux-still-image-1-item",
  "fate-mov-init-nonkeyframe",
  "fate-mov-zombie",
  "fate-seek-empty-edit-mp4",
  "fate-seek-extra-mp3",
  "fate-seek-extra-mp4",
  "fate-seek-mkv-codec-delay",
  "fate-seek-test-iibbibb-mp4",
]);

const parseArgs = (argv) => {
  const options = {
    out: DEFAULT_OUT,
    files: DEFAULT_FATE_FILES,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      options.out = resolve(ROOT_DIR, argv[++i] || "");
    } else if (arg === "--files") {
      options.files = (argv[++i] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg === "--all") {
      options.files = null;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const printHelp = () => {
  console.log("Usage:");
  console.log("  node scripts/build-browser-fate-manifest.mjs");
  console.log("  node scripts/build-browser-fate-manifest.mjs --all");
  console.log("  node scripts/build-browser-fate-manifest.mjs --files mov.mak,matroska.mak,seek.mak");
  console.log("  node scripts/build-browser-fate-manifest.mjs --out web/fate-browser-manifest.js");
};

const logicalMakefileLines = (text) => {
  const out = [];
  let current = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = current ? rawLine.trimStart() : rawLine;
    current += line;
    if (current.endsWith("\\")) {
      current = `${current.slice(0, -1)} `;
      continue;
    }
    out.push(current);
    current = "";
  }

  if (current) {
    out.push(current);
  }

  return out;
};

const extractSampleRefs = (command) => {
  const refs = [];
  const re = /\$\((?:TARGET_SAMPLES|SAMPLES)\)\/([^'"`\s)]+)/g;
  for (const match of command.matchAll(re)) {
    const sample = match[1];
    if (!sample.includes("$(") && !sample.includes("%")) {
      refs.push(sample);
    }
  }

  const lavfFateRe = /\blavf_container_fate\s+"([^"]+)"/g;
  for (const match of command.matchAll(lavfFateRe)) {
    refs.push(match[1]);
  }

  return [...new Set(refs)];
};

const detectProfile = (target, command) => {
  if (target.startsWith("fate-seek-")) {
    return "seek";
  }
  if (
    (target.includes("demux") || target.startsWith("fate-cbs-")) &&
    /\s-c(?::[vas])?\s+copy\b/.test(command)
  ) {
    return "metadata";
  }
  if (/\bffprobe\b/.test(command)) {
    return "metadata";
  }
  if (/\b(framecrc|framemd5|md5|md5pipe|transcode|stream_demux)\b/.test(command)) {
    return "decode";
  }
  return "metadata";
};

const detectFormatHint = (sample) => {
  const lower = sample.toLowerCase();
  if (lower.endsWith(".bit") || lower.endsWith(".bin") || lower.endsWith(".hevc") || lower.endsWith(".h265")) {
    return "hevc";
  }
  if (lower.endsWith(".ivf")) {
    return "ivf";
  }
  if (lower.endsWith(".obu")) {
    return "obu";
  }
  if (lower.endsWith(".mkv") || lower.endsWith(".mka") || lower.endsWith(".mks") || lower.endsWith(".webm")) {
    return "matroska";
  }
  if (lower.endsWith(".mp4") || lower.endsWith(".m4a") || lower.endsWith(".mov")) {
    return "mov";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".m2ts")) {
    return "mpegts";
  }
  if (lower.endsWith(".mp3")) {
    return "mp3";
  }
  if (lower.endsWith(".aac")) {
    return "aac";
  }
  if (lower.endsWith(".flac")) {
    return "flac";
  }
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) {
    return "ogg";
  }
  return null;
};

const detectSkipReason = (target, command) => {
  if (command.includes("-decryption_key") || target.includes("encrypted")) {
    return "requires CLI decryption options not exposed by the browser wasm API";
  }
  if (command.includes("tools/qt-faststart")) {
    return "requires FFmpeg native helper tools";
  }
  if (command.includes("cache:pipe:")) {
    return "requires shell pipe protocol setup";
  }
  return null;
};

const makeTags = (sourceFile, profile, testCase) => {
  const tags = new Set(["fate", profile, basename(sourceFile, ".mak")]);
  const codecProbe = `${testCase.id} ${testCase.sample || ""} ${testCase.command || ""}`.toLowerCase();
  if (codecProbe.includes("av1") || codecProbe.includes("avif") || codecProbe.includes(".obu")) {
    tags.add("av1");
  }
  if (
    codecProbe.includes("hevc") ||
    codecProbe.includes("h265") ||
    codecProbe.includes("h.265") ||
    codecProbe.includes("heif") ||
    codecProbe.includes("heic")
  ) {
    tags.add("hevc");
  }
  if (BROWSER_SMOKE_IDS.has(testCase.id)) {
    tags.add("browser-smoke");
  }
  if (testCase.skipReason) {
    tags.add("mapped-skip");
  }
  if (testCase.sample) {
    const top = testCase.sample.split("/")[0];
    if (top) {
      tags.add(top);
    }
  }
  return [...tags].sort();
};

const parseMakeListVariable = (lines, name) => {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:+?]?=\\s*(.*)$`);
  const line = lines.find((item) => re.test(item.trim()));
  if (!line) {
    return [];
  }

  const value = line.trim().replace(re, "$1");
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.includes("$(") && !item.includes(")") && !item.includes(","));
};

const syntheticCase = ({
  id,
  source,
  sample,
  profile = "decode",
  formatHint = detectFormatHint(sample),
  command,
}) => {
  const testCase = {
    id,
    source,
    sample,
    samples: [sample],
    profile,
    formatHint,
    command,
    synthetic: true,
    skipReason: null,
  };
  testCase.tags = makeTags(source, profile, testCase);
  return testCase;
};

const syntheticHevcCases = (filePath, lines) => {
  if (basename(filePath) !== "hevc.mak") {
    return [];
  }

  const source = relative(ROOT_DIR, filePath);
  const vars = parseMakeListVariable(lines, "FATE_HEVC_VARS");
  const cases = [];

  for (const variant of vars) {
    const samples = parseMakeListVariable(lines, `HEVC_SAMPLES_${variant}`);
    const extension = variant === "422_10BIN" ? "bin" : "bit";
    for (const name of samples) {
      cases.push(
        syntheticCase({
          id: `fate-hevc-conformance-${name}`,
          source,
          sample: `hevc-conformance/${name}.${extension}`,
          command: `synthetic: framecrc -i $(TARGET_SAMPLES)/hevc-conformance/${name}.${extension}`,
        })
      );
    }
  }

  return cases;
};

const syntheticCbsCodecCases = (filePath, lines) => {
  if (basename(filePath) !== "cbs.mak") {
    return [];
  }

  const source = relative(ROOT_DIR, filePath);
  const cases = [];

  for (const sample of parseMakeListVariable(lines, "FATE_CBS_AV1_CONFORMANCE_SAMPLES")) {
    const idName = sample.replace(/\.[^.]+$/, "");
    cases.push(
      syntheticCase({
        id: `fate-cbs-av1-${idName}`,
        source,
        sample: `av1-test-vectors/${sample}`,
        profile: "metadata",
        command: `synthetic: cbs av1 read/write over $(TARGET_SAMPLES)/av1-test-vectors/${sample}`,
      })
    );
  }

  for (const sample of parseMakeListVariable(lines, "FATE_CBS_AV1_SAMPLES")) {
    const idName = sample.replace(/\.[^.]+$/, "");
    cases.push(
      syntheticCase({
        id: `fate-cbs-av1-${idName}`,
        source,
        sample: `av1/${sample}`,
        profile: "metadata",
        command: `synthetic: cbs av1 read/write over $(TARGET_SAMPLES)/av1/${sample}`,
      })
    );
  }

  for (const sample of parseMakeListVariable(lines, "FATE_CBS_HEVC_SAMPLES")) {
    const idName = sample.replace(/\.[^.]+$/, "");
    cases.push(
      syntheticCase({
        id: `fate-cbs-hevc-${idName}`,
        source,
        sample: `hevc-conformance/${sample}`,
        profile: "metadata",
        command: `synthetic: cbs hevc read/write over $(TARGET_SAMPLES)/hevc-conformance/${sample}`,
      })
    );
  }

  return cases;
};

const syntheticCasesForFile = (filePath, lines) => [
  ...syntheticHevcCases(filePath, lines),
  ...syntheticCbsCodecCases(filePath, lines),
];

const parseFateFile = (filePath) => {
  const rel = relative(ROOT_DIR, filePath);
  const lines = logicalMakefileLines(readFileSync(filePath, "utf8"));
  const cases = syntheticCasesForFile(filePath, lines);

  for (const line of lines) {
    const match = /^(fate-[A-Za-z0-9_.+-]+)\s*:\s*CMD\s*=\s*(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const [, id, command] = match;
    const samples = extractSampleRefs(command);
    if (samples.length === 0) {
      continue;
    }

    const profile = detectProfile(id, command);
    const testCase = {
      id,
      source: rel,
      sample: samples[0],
      samples,
      profile,
      formatHint: detectFormatHint(samples[0]),
      command: command.replace(/\s+/g, " ").trim(),
      skipReason: detectSkipReason(id, command),
    };
    testCase.tags = makeTags(filePath, profile, testCase);
    cases.push(testCase);
  }

  return cases;
};

const allFateFiles = () =>
  DEFAULT_FATE_FILES
    .map((name) => resolve(FATE_DIR, name))
    .filter((path) => existsSync(path));

const selectedFateFiles = (files) => {
  if (!files) {
    return allFateFiles();
  }
  return files
    .map((name) => resolve(FATE_DIR, name))
    .filter((path) => existsSync(path));
};

const buildManifest = (files) => {
  const casesById = new Map();
  for (const filePath of selectedFateFiles(files)) {
    for (const testCase of parseFateFile(filePath)) {
      if (!casesById.has(testCase.id)) {
        casesById.set(testCase.id, testCase);
      }
    }
  }

  const cases = [...casesById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const profiles = [...new Set(cases.map((testCase) => testCase.profile))].sort();
  const tags = [...new Set(cases.flatMap((testCase) => testCase.tags))].sort();

  return {
    generatedAt: new Date().toISOString(),
    source: "third_party/ffmpeg/tests/fate",
    sampleBaseDefault: "/fate-suite/",
    mapping: {
      metadata: "Open the sample in wasm read_at mode and verify streams/duration metadata.",
      decode: "Open the sample, decode frames through ffmpeg_wasm_read_frame, and convert the first video frame to RGBA when present.",
      seek: "Open the sample in read_at mode, seek to a few duration-relative points, and verify decoded frames continue after each seek.",
    },
    profiles,
    tags,
    cases,
  };
};

const renderManifest = (manifest) => `/* Generated by scripts/build-browser-fate-manifest.mjs. */
(function attachFateBrowserManifest(root) {
  root.FATE_BROWSER_MANIFEST = ${JSON.stringify(manifest, null, 2)};
})(typeof globalThis !== "undefined" ? globalThis : self);
`;

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const manifest = buildManifest(options.files);
  writeFileSync(options.out, renderManifest(manifest));
  console.log(
    `Wrote ${relative(ROOT_DIR, options.out)} with ${manifest.cases.length} browser-mapped FATE cases.`
  );
};

main();
