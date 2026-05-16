#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from "fs";
import { createServer } from "http";
import { extname, join, normalize, relative, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB_DIR = resolve(ROOT_DIR, "web");

const MIME_TYPES = {
  ".aac": "audio/aac",
  ".css": "text/css; charset=utf-8",
  ".flac": "audio/flac",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".ts": "video/mp2t",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};

const parseArgs = (argv) => {
  const options = {
    host: "127.0.0.1",
    port: 8090,
    samples: process.env.FATE_SAMPLES || "/tmp/fate-suite",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") {
      options.host = argv[++i] || options.host;
    } else if (arg === "--port") {
      options.port = Number(argv[++i] || options.port);
    } else if (arg === "--samples") {
      options.samples = resolve(argv[++i] || options.samples);
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
  console.log("  node scripts/serve-browser-fate.mjs --samples /tmp/fate-suite --port 8090");
  console.log("");
  console.log("Before running the browser suite, fetch a targeted sample set with:");
  console.log("  node scripts/sync-browser-fate-samples.mjs --tag browser-smoke --samples /tmp/fate-suite");
  console.log("  node scripts/sync-browser-fate-samples.mjs --tag av1 --samples /tmp/fate-suite");
  console.log("  node scripts/sync-browser-fate-samples.mjs --tag hevc --samples /tmp/fate-suite");
};

const safeJoin = (baseDir, urlPath) => {
  const decoded = decodeURIComponent(urlPath);
  const target = resolve(baseDir, normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, ""));
  const rel = relative(baseDir, target);
  if (rel.startsWith("..") || rel === ".." || rel.startsWith(`..${process.sep}`)) {
    return null;
  }
  return target;
};

const sendText = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
};

const streamFile = (req, res, filePath) => {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    sendText(res, 404, "Not found\n");
    return;
  }

  if (!stat.isFile()) {
    sendText(res, 404, "Not found\n");
    return;
  }

  const headers = {
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-type": MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
  };

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, headers);
      res.end();
      return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (start >= stat.size || end < start) {
      res.writeHead(416, {
        ...headers,
        "content-range": `bytes */${stat.size}`,
      });
      res.end();
      return;
    }

    const cappedEnd = Math.min(end, stat.size - 1);
    res.writeHead(206, {
      ...headers,
      "content-length": cappedEnd - start + 1,
      "content-range": `bytes ${start}-${cappedEnd}/${stat.size}`,
    });
    createReadStream(filePath, { start, end: cappedEnd }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...headers,
    "content-length": stat.size,
  });
  createReadStream(filePath).pipe(res);
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const samplesDir = resolve(options.samples);
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/healthz") {
      sendText(res, 200, "ok\n");
      return;
    }

    if (url.pathname.startsWith("/fate-suite/")) {
      if (!existsSync(samplesDir)) {
        sendText(
          res,
          404,
          `FATE samples directory does not exist: ${samplesDir}\nRun: node scripts/sync-browser-fate-samples.mjs --tag browser-smoke --samples ${samplesDir}\n`
        );
        return;
      }
      const samplePath = safeJoin(samplesDir, url.pathname.slice("/fate-suite/".length));
      if (!samplePath) {
        sendText(res, 400, "Bad sample path\n");
        return;
      }
      streamFile(req, res, samplePath);
      return;
    }

    const webPath = url.pathname === "/" ? "fate-browser.html" : url.pathname.slice(1);
    const filePath = safeJoin(WEB_DIR, webPath);
    if (!filePath) {
      sendText(res, 400, "Bad path\n");
      return;
    }
    streamFile(req, res, filePath);
  });

  server.listen(options.port, options.host, () => {
    console.log(`Browser FATE runner: http://${options.host}:${options.port}/fate-browser.html`);
    console.log(`Serving web assets from: ${WEB_DIR}`);
    console.log(`Serving FATE samples from: ${samplesDir}`);
  });
};

main();
