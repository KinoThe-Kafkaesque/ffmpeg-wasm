#!/usr/bin/env node

import { execFileSync, spawn } from "child_process";
import { mkdirSync, rmSync, statSync } from "fs";
import { once } from "events";
import { resolve } from "path";
import { loadWasmNode } from "./ffmpeg-wasm-node.mjs";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const TMP_DIR = "/tmp/ffmpeg-wasm-http-range";
const MEDIA_PATH = `${TMP_DIR}/late-moov-range.mp4`;
const FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL = 1;

const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg);
  }
};

const buildLateMoovFixture = () => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
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
      MEDIA_PATH,
    ],
    { stdio: "inherit" },
  );
};

const rangeServerSource = String.raw`
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

media_path = sys.argv[1]

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Range,Accept-Ranges,Content-Length")
        self.end_headers()

    def do_HEAD(self):
        self._send_media(head_only=True)

    def do_GET(self):
        self._send_media(head_only=False)

    def _send_media(self, head_only):
        if self.path.split("?", 1)[0] != "/media.mp4":
            self.send_response(404)
            self.end_headers()
            return

        size = os.path.getsize(media_path)
        start = 0
        end = size - 1
        status = 200
        range_header = self.headers.get("Range", "")
        if range_header:
            match = re.match(r"bytes=(\d+)-(\d*)$", range_header)
            if not match:
                self.send_response(416)
                self.end_headers()
                return
            start = int(match.group(1))
            end_text = match.group(2)
            end = int(end_text) if end_text else end
            end = min(end, size - 1)
            if start >= size or start > end:
                self.send_response(416)
                self.end_headers()
                return
            status = 206

        length = end - start + 1
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Range,Accept-Ranges,Content-Length")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head_only:
            return

        with open(media_path, "rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining:
                chunk = fh.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print(f"READY {server.server_port}", flush=True)
server.serve_forever()
`;

const startRangeServer = async () => {
  const proc = spawn("python3", ["-u", "-c", rangeServerSource, MEDIA_PATH], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let stdout = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    stdout += chunk;
  });

  while (!stdout.includes("READY ")) {
    const exit = await Promise.race([
      once(proc.stdout, "data").then(() => null),
      once(proc, "exit").then(([code]) => ({ code })),
    ]);
    if (exit?.code !== undefined) {
      throw new Error(`range server exited before ready: ${exit.code}`);
    }
  }

  const match = /READY (\d+)/.exec(stdout);
  if (!match) {
    throw new Error(`range server did not print a port: ${stdout}`);
  }
  return { proc, url: `http://127.0.0.1:${match[1]}/media.mp4` };
};

const main = async () => {
  buildLateMoovFixture();
  const size = statSync(MEDIA_PATH).size;
  const { proc, url } = await startRangeServer();
  const wasm = await loadWasmNode({
    wasmJsPath: `${ROOT_DIR}/build/ffmpeg-wasm/ffmpeg_wasm.js`,
    wasmPath: `${ROOT_DIR}/build/ffmpeg-wasm/ffmpeg_wasm.wasm`,
  });
  const { Module, api } = wasm;
  let rangeReads = 0;

  Module.ffmpegReadAt = (offset, len, dstPtr) => {
    const start = Math.max(0, Math.trunc(Number(offset) || 0));
    const want = Math.max(0, Math.trunc(Number(len) || 0));
    if (want <= 0 || start >= size) return 0;
    const end = Math.min(size - 1, start + want - 1);
    const data = execFileSync("curl", [
      "--silent",
      "--show-error",
      "--fail",
      "--range",
      `${start}-${end}`,
      url,
    ]);
    Module.HEAPU8.set(data, dstPtr >>> 0);
    rangeReads += 1;
    return data.byteLength;
  };

  const ctx = api.create(0);
  try {
    assert(api.setIoMode(ctx, FFMPEG_WASM_IO_RANDOM_ACCESS_LOCAL) === 0, "setIoMode failed");
    api.setFileSize(ctx, size);
    api.setCacheLimit(ctx, 4 * 1024 * 1024);
    const openRet = api.open(ctx, "mov");
    assert(openRet === 0, `open failed: ${openRet}`);
    const duration = api.duration(ctx);
    assert(duration >= 2.5 && duration <= 4, `duration invalid: ${duration}`);
    const seekRet = api.seek(ctx, 1.5);
    assert(seekRet === 0, `seek failed: ${seekRet}`);
    const frame = wasm.readNextVideoFrame(ctx, 3000);
    assert(frame.ret === 1, `no frame after range seek: ${JSON.stringify(frame)}`);
    assert(rangeReads > 0, "native read_at did not use HTTP Range reads");
    console.log("HTTP RANGE READ_AT PASS");
    console.log(JSON.stringify({ duration, seekRet, firstPtsAfterSeek: frame.pts, rangeReads }, null, 2));
  } finally {
    api.destroy(ctx);
    proc.kill();
  }
};

main().catch((err) => {
  console.error("HTTP RANGE READ_AT FAIL");
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
