import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ensureBrowserFixtures } from "./fixtures.mjs";

const ROOT_DIR = resolve(new URL("../..", import.meta.url).pathname);

export default async function globalSetup() {
  for (const relative of [
    "web/ffmpeg_wasm.js",
    "web/ffmpeg_wasm.wasm",
    "web/ffmpeg_wasm.worker.js",
    "web/ffmpeg_wasm.capabilities.json",
    "web/ffmpeg-components.json",
  ]) {
    const path = resolve(ROOT_DIR, relative);
    if (!existsSync(path)) {
      throw new Error(
        `Missing browser test asset: ${relative}. Run ./scripts/prepare-demo-assets.sh --release first.`,
      );
    }
  }

  ensureBrowserFixtures();
}
