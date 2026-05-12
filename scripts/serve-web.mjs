#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from "fs";
import { createServer } from "http";
import { extname, join, resolve, sep } from "path";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".map", "application/json; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
  [".mp4", "video/mp4"],
]);

const parseArgs = () => {
  const options = {
    dir: "web",
    host: "127.0.0.1",
    port: 8080,
  };

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dir") {
      options.dir = args[++i] || options.dir;
    } else if (arg === "--host") {
      options.host = args[++i] || options.host;
    } else if (arg === "--port") {
      options.port = Number.parseInt(args[++i] || `${options.port}`, 10);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/serve-web.mjs [--dir web] [--host 127.0.0.1] [--port 8080]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  return options;
};

const baseHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Accept-Ranges": "bytes",
};

const sendText = (res, status, text) => {
  res.writeHead(status, {
    ...baseHeaders,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
};

const resolveRequestPath = (rootDir, urlPath) => {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const fallback = existsSync(join(rootDir, "v3.html")) ? "/v3.html" : "/index.html";
  const relative = decoded === "/" ? fallback : decoded;
  const absolute = resolve(rootDir, `.${relative}`);
  if (absolute !== rootDir && !absolute.startsWith(`${rootDir}${sep}`)) {
    return null;
  }
  return absolute;
};

const parseRange = (rangeHeader, size) => {
  if (!rangeHeader) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return null;
  }
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) {
    return null;
  }
  const start = startText ? Number.parseInt(startText, 10) : Math.max(0, size - Number.parseInt(endText, 10));
  const end = endText ? Number.parseInt(endText, 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
};

const options = parseArgs();
const rootDir = resolve(options.dir);

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed\n");
    return;
  }

  const filePath = resolveRequestPath(rootDir, req.url || "/");
  if (!filePath) {
    sendText(res, 403, "Forbidden\n");
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendText(res, 404, "Not found\n");
    return;
  }

  const info = statSync(filePath);
  const contentType = mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream";
  const range = parseRange(req.headers.range, info.size);

  if (req.headers.range && !range) {
    res.writeHead(416, {
      ...baseHeaders,
      "Content-Range": `bytes */${info.size}`,
    });
    res.end();
    return;
  }

  const headers = {
    ...baseHeaders,
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  };

  if (range) {
    headers["Content-Length"] = range.end - range.start + 1;
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
    res.writeHead(206, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  headers["Content-Length"] = info.size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
});

server.listen(options.port, options.host, () => {
  console.log(`Serving ${rootDir}`);
  console.log(`Open http://${options.host}:${options.port}/v3.html`);
  console.log("COOP/COEP headers are enabled for pthread WASM builds.");
});
