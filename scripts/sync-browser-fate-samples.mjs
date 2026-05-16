#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, relative, resolve } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_MANIFEST = resolve(ROOT_DIR, "web/fate-browser-manifest.js");
const DEFAULT_DEST = process.env.FATE_SAMPLES || "/tmp/fate-suite";
const DEFAULT_SOURCE = "rsync://fate-suite.ffmpeg.org/fate-suite/";

const parseArgs = (argv) => {
  const options = {
    manifest: DEFAULT_MANIFEST,
    dest: DEFAULT_DEST,
    source: DEFAULT_SOURCE,
    tag: "browser-smoke",
    dryRun: false,
    printOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") {
      options.manifest = resolve(argv[++i] || "");
    } else if (arg === "--samples") {
      options.dest = resolve(argv[++i] || "");
    } else if (arg === "--source") {
      options.source = argv[++i] || options.source;
    } else if (arg === "--tag") {
      options.tag = argv[++i] || "";
    } else if (arg === "--all") {
      options.tag = "";
    } else if (arg === "--dry-run" || arg === "-n") {
      options.dryRun = true;
    } else if (arg === "--print") {
      options.printOnly = true;
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
  console.log("  node scripts/sync-browser-fate-samples.mjs");
  console.log("  node scripts/sync-browser-fate-samples.mjs --tag av1 --samples /tmp/fate-suite");
  console.log("  node scripts/sync-browser-fate-samples.mjs --tag hevc --samples /tmp/fate-suite");
  console.log("  node scripts/sync-browser-fate-samples.mjs --all --samples /tmp/fate-suite");
  console.log("");
  console.log("Defaults to --tag browser-smoke to avoid pulling the full FATE corpus.");
};

const loadManifest = (path) => {
  const text = readFileSync(path, "utf8");
  const match = /FATE_BROWSER_MANIFEST\s*=\s*(\{[\s\S]*?\});\n\}\)/.exec(text);
  if (!match) {
    throw new Error(`Could not parse manifest: ${path}`);
  }
  return JSON.parse(match[1]);
};

const selectSamples = (manifest, tag) => {
  const cases = tag
    ? manifest.cases.filter((testCase) => testCase.tags.includes(tag))
    : manifest.cases;
  const samples = [
    ...new Set(
      cases
        .flatMap((testCase) => testCase.samples || [testCase.sample])
        .filter(Boolean)
        .filter((sample) => !sample.includes("$(") && !sample.includes("%"))
    ),
  ].sort();

  return { cases, samples };
};

const writeRsyncFilter = (samples) => {
  const tempDir = mkdtempSync(join(tmpdir(), "browser-fate-rsync-"));
  const path = join(tempDir, "filter.rules");
  const lines = ["+ */", ...samples.map((sample) => `+ /${sample}`), "- *", ""];
  writeFileSync(path, lines.join("\n"));
  return { tempDir, path };
};

const runRsync = ({ source, dest, samples, dryRun }) => {
  mkdirSync(dest, { recursive: true });
  const filter = writeRsyncFilter(samples);
  try {
    const args = [
      "-av",
      "--prune-empty-dirs",
      `--filter=merge ${filter.path}`,
    ];
    if (dryRun) {
      args.push("--dry-run");
    }
    args.push(source, dest);

    const result = spawnSync("rsync", args, {
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`rsync exited with status ${result.status}`);
    }
  } finally {
    rmSync(filter.tempDir, { recursive: true, force: true });
  }
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const manifest = loadManifest(options.manifest);
  const { cases, samples } = selectSamples(manifest, options.tag);
  console.log(
    `Selected ${samples.length} sample files from ${cases.length} cases` +
      `${options.tag ? ` with tag "${options.tag}"` : ""}.`
  );
  console.log(`Manifest: ${relative(ROOT_DIR, options.manifest)}`);
  console.log(`Destination: ${options.dest}`);

  if (options.printOnly) {
    for (const sample of samples) {
      console.log(sample);
    }
    return;
  }

  if (samples.length === 0) {
    throw new Error("No samples selected.");
  }

  runRsync({
    source: options.source,
    dest: options.dest,
    samples,
    dryRun: options.dryRun,
  });
};

main();
