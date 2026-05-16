#!/usr/bin/env node

import { createRequire } from "module";
import { resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const { ffmpegWasmExportedFunctions } = require(resolve(
  ROOT_DIR,
  "web/ffmpeg-wasm-api.js",
));

const includeTestOnly = process.argv.includes("--include-test-only");
process.stdout.write(
  JSON.stringify(ffmpegWasmExportedFunctions({ includeTestOnly })),
);
