#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argValue = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
};

const csvSet = (value) =>
  new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

const configPath = resolve(argValue("--config"));
const configHPath = resolve(argValue("--config-h"));
const outPath = resolve(argValue("--out", "ffmpeg-components.json"));
const variant = argValue("--variant", "full");

const allow = {
  decoder: csvSet(argValue("--allow-decoder")),
  parser: csvSet(argValue("--allow-parser")),
  demuxer: csvSet(argValue("--allow-demuxer")),
  protocol: csvSet(argValue("--allow-protocol")),
  bsf: csvSet(argValue("--allow-bsf")),
  encoder: new Set(),
  muxer: new Set(),
  filter: new Set(),
  indev: new Set(),
  outdev: new Set(),
};

const enabled = Object.fromEntries(Object.keys(allow).map((key) => [key, []]));
const componentSource = readFileSync(configPath, "utf8");
const componentPattern =
  /^#define CONFIG_(.+)_(DECODER|ENCODER|DEMUXER|MUXER|PARSER|PROTOCOL|FILTER|BSF|INDEV|OUTDEV) 1$/gm;

for (const match of componentSource.matchAll(componentPattern)) {
  const name = match[1].toLowerCase();
  const kind = match[2].toLowerCase();
  enabled[kind].push(name);
}

for (const values of Object.values(enabled)) {
  values.sort();
}

const configH = readFileSync(configHPath, "utf8");
const configValue = (name) => {
  const match = configH.match(new RegExp(`^#define CONFIG_${name} ([01])$`, "m"));
  return match ? match[1] : null;
};

const errors = [];
const addUnexpected = (kind) => {
  const unexpected = enabled[kind].filter((name) => !allow[kind].has(name));
  if (unexpected.length > 0) {
    errors.push(`unexpected ${kind}s enabled: ${unexpected.join(", ")}`);
  }
};
const addMissing = (kind) => {
  const actual = new Set(enabled[kind]);
  const missing = [...allow[kind]].filter((name) => !actual.has(name)).sort();
  if (missing.length > 0) {
    errors.push(`required ${kind}s missing: ${missing.join(", ")}`);
  }
};

for (const kind of ["decoder", "parser", "demuxer", "protocol", "bsf"]) {
  addUnexpected(kind);
  addMissing(kind);
}
for (const kind of ["encoder", "muxer", "filter", "indev", "outdev"]) {
  addUnexpected(kind);
}

for (const name of [
  "AVDEVICE",
  "AVFILTER",
  "POSTPROC",
  "NETWORK",
  "FFMPEG",
  "FFPLAY",
  "FFPROBE",
  "ICONV",
  "RUNTIME_CPUDETECT",
]) {
  if (configValue(name) === "1") {
    errors.push(`CONFIG_${name} is enabled`);
  }
}

const report = {
  schemaVersion: 1,
  variant,
  generatedAt: new Date().toISOString(),
  policy: {
    playbackOnly: true,
    encoders: false,
    muxers: false,
    filters: false,
    bitstreamFilters: [...allow.bsf].sort(),
    devices: false,
    network: false,
    programs: false,
    iconv: false,
    runtimeCpuDetect: false,
  },
  enabled,
  errors,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`FFmpeg component policy violation: ${error}`);
  }
  process.exit(1);
}
