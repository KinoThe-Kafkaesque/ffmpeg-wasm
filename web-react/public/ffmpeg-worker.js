/* global FFmpegWasm */

const DEFAULT_AUDIO_RATE = 48000;
const BUFFER_LIMIT_BYTES = 500 * 1024 * 1024;
const SEEKABLE_FILE_LIMIT = BUFFER_LIMIT_BYTES;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const SEEK_MAX_BUFFER_BYTES = 48 * 1024 * 1024;
const BUFFER_POLL_MS = 15;
const MAX_CHUNK_BYTES = 256 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const state = {
  Module: null,
  api: null,
  ctx: 0,
  opened: false,
  playing: false,
  waitingForData: false,
  draining: false,
  streamRunning: false,
  streamToken: 0,
  sessionToken: 0,
  frames: 0,
  bytes: 0,
  duration: 0,
  currentTime: 0,
  basePts: null,
  baseWall: 0,
  seekEnabled: false,
  seekSlow: false,
  seeking: false,
  seekTarget: null,
  seekUiLast: 0,
  seekPreviewLast: 0,
  maxBufferBytes: DEFAULT_MAX_BUFFER_BYTES,
  decodeTimer: null,
  reader: null,
  abortController: null,
  lastOpenError: null,
  renderMode: "2d",
  formatHint: "",
  activeFile: null,
  activeUrl: null,
  audioChannels: 0,
  audioSampleRate: 0,
  canvas2d: null,
  canvasGl: null,
  ctx2d: null,
  imageData: null,
  rgbaBuffer: null,
  glState: null,
  lastStatsSent: 0,
  durationCheckLast: 0,
};

const postLog = (message) => postMessage({ type: "log", message });
const postStatus = (message) => postMessage({ type: "status", message });

const hasExport = (name) =>
  state.Module && typeof state.Module[`_${name}`] === "function";

const createApi = (Module) => ({
  create: Module.cwrap("ffmpeg_wasm_create", "number", ["number"]),
  destroy: Module.cwrap("ffmpeg_wasm_destroy", null, ["number"]),
  append: Module.cwrap("ffmpeg_wasm_append", "number", ["number", "number", "number"]),
  setEof: Module.cwrap("ffmpeg_wasm_set_eof", null, ["number"]),
  open: Module.cwrap("ffmpeg_wasm_open", "number", ["number", "string"]),
  readFrame: Module.cwrap("ffmpeg_wasm_read_frame", "number", ["number"]),
  width: Module.cwrap("ffmpeg_wasm_video_width", "number", ["number"]),
  height: Module.cwrap("ffmpeg_wasm_video_height", "number", ["number"]),
  pts: Module.cwrap("ffmpeg_wasm_frame_pts_seconds", "number", ["number"]),
  toRgba: Module.cwrap("ffmpeg_wasm_frame_to_rgba", "number", ["number"]),
  rgbaPtr: Module.cwrap("ffmpeg_wasm_rgba_ptr", "number", ["number"]),
  rgbaStride: Module.cwrap("ffmpeg_wasm_rgba_stride", "number", ["number"]),
  audioChannels: Module.cwrap("ffmpeg_wasm_audio_channels", "number", ["number"]),
  audioSampleRate: Module.cwrap("ffmpeg_wasm_audio_sample_rate", "number", ["number"]),
  audioSamples: Module.cwrap("ffmpeg_wasm_audio_nb_samples", "number", ["number"]),
  audioPtr: Module.cwrap("ffmpeg_wasm_audio_ptr", "number", ["number"]),
  audioPts: Module.cwrap("ffmpeg_wasm_audio_pts_seconds", "number", ["number"]),
  bufferedBytes: Module.cwrap("ffmpeg_wasm_buffered_bytes", "number", ["number"]),
  duration: Module.cwrap("ffmpeg_wasm_duration_seconds", "number", ["number"]),
  seek: Module.cwrap("ffmpeg_wasm_seek_seconds", "number", ["number", "number"]),
  setKeepAll: Module.cwrap("ffmpeg_wasm_set_keep_all", null, ["number", "number"]),
  setBufferLimit: Module.cwrap("ffmpeg_wasm_set_buffer_limit", null, ["number", "number"]),
  setAudioEnabled: Module.cwrap("ffmpeg_wasm_set_audio_enabled", null, ["number", "number"]),
});

const emitStats = (force = false) => {
  const now = performance.now();
  if (!force && now - state.lastStatsSent < 120) {
    return;
  }
  state.lastStatsSent = now;
  postMessage({
    type: "stats",
    frames: state.frames,
    bytes: state.bytes,
    pts: state.currentTime,
    duration: state.duration,
    seeking: state.seeking,
    audioChannels: state.audioChannels,
    audioSampleRate: state.audioSampleRate,
  });
};

const destroyDecoder = () => {
  if (state.ctx && state.api) {
    state.api.destroy(state.ctx);
  }
  state.ctx = 0;
  state.opened = false;
  state.waitingForData = false;
  state.draining = false;
  state.frames = 0;
  state.bytes = 0;
  state.duration = 0;
  state.currentTime = 0;
  state.basePts = null;
  state.baseWall = 0;
  state.seeking = false;
  state.seekTarget = null;
  state.seekUiLast = 0;
  state.seekPreviewLast = 0;
  state.lastOpenError = null;
  state.audioChannels = 0;
  state.audioSampleRate = 0;
  state.imageData = null;
  state.rgbaBuffer = null;
  state.glState = null;
  state.durationCheckLast = 0;
  emitStats(true);
};

const stopStream = () => {
  state.streamToken += 1;
  state.streamRunning = false;
  const reader = state.reader;
  state.reader = null;
  if (reader) {
    try {
      reader.cancel().catch(() => {});
    } catch (err) {
      // ignore cancellation errors
    }
  }
  const controller = state.abortController;
  state.abortController = null;
  if (controller) {
    controller.abort();
  }
  return Promise.resolve();
};

const stopDecodeLoop = () => {
  if (state.decodeTimer) {
    clearTimeout(state.decodeTimer);
    state.decodeTimer = null;
  }
};

const resetPlayback = async () => {
  state.sessionToken += 1;
  state.playing = false;
  stopDecodeLoop();
  await stopStream();
  destroyDecoder();
  postMessage({ type: "audioClear" });
  postStatus("Ready");
};

const ensureDecoder = (bufferBytes) => {
  if (state.ctx) return;
  const initialBytes = bufferBytes > 0 ? bufferBytes : 4 * 1024 * 1024;
  state.ctx = state.api.create(initialBytes);
  if (!state.ctx) {
    postLog("Failed to create decoder context.");
    return;
  }
  if (state.api.setBufferLimit && hasExport("ffmpeg_wasm_set_buffer_limit")) {
    state.api.setBufferLimit(state.ctx, BUFFER_LIMIT_BYTES);
  }
};

const allocateAndAppend = (chunk) => {
  const Module = state.Module;
  const ptr = Module._malloc(chunk.length);
  Module.HEAPU8.set(chunk, ptr);
  const ret = state.api.append(state.ctx, ptr, chunk.length);
  Module._free(ptr);
  return ret;
};

const tryOpen = () => {
  if (state.opened || !state.ctx) return;
  const ret = state.api.open(state.ctx, state.formatHint || null);
  if (ret === 0) {
    state.opened = true;
    state.lastOpenError = null;
    state.duration = 0;
    if (state.api.duration && hasExport("ffmpeg_wasm_duration_seconds")) {
      const duration = state.api.duration(state.ctx);
      if (duration > 0) {
        state.duration = duration;
      }
    }
    postStatus("Playing");
    emitStats(true);
    startDecodeLoop(0);
  } else if (ret !== state.lastOpenError) {
    state.lastOpenError = ret;
    postLog(`Open waiting for more data (code ${ret}).`);
  }
};

const appendChunk = (token, chunk) => {
  if (token !== state.streamToken) {
    return false;
  }
  if (!state.ctx) return false;
  const ret = allocateAndAppend(chunk);
  if (ret < 0) {
    postLog(`Append failed with code ${ret}.`);
    state.streamRunning = false;
    state.api.setEof(state.ctx);
    state.draining = true;
    return false;
  }
  state.bytes += chunk.length;
  emitStats();
  tryOpen();
  if (state.waitingForData) {
    state.waitingForData = false;
    startDecodeLoop(0);
  }
  return true;
};

const waitForBuffer = async (token) => {
  if (!state.api || !state.ctx || !state.api.bufferedBytes) {
    return;
  }
  if (!hasExport("ffmpeg_wasm_buffered_bytes")) {
    return;
  }
  if (!Number.isFinite(state.maxBufferBytes)) {
    return;
  }
  while (
    token === state.streamToken &&
    state.streamRunning &&
    state.api.bufferedBytes(state.ctx) > state.maxBufferBytes
  ) {
    await sleep(BUFFER_POLL_MS);
  }
};

const streamFile = async (file) => {
  const token = (state.streamToken += 1);
  state.streamRunning = true;
  const reader = file.stream().getReader();
  state.reader = reader;
  postLog(`Streaming file: ${file.name} (${file.size} bytes)`);

  while (token === state.streamToken && state.streamRunning) {
    await waitForBuffer(token);
    const { value, done } = await reader.read();
    if (token !== state.streamToken) break;
    if (done) break;
    if (value && value.length) {
      for (let offset = 0; offset < value.length; offset += MAX_CHUNK_BYTES) {
        if (token !== state.streamToken) break;
        await waitForBuffer(token);
        if (token !== state.streamToken) break;
        const slice = value.subarray(offset, offset + MAX_CHUNK_BYTES);
        if (!appendChunk(token, slice)) {
          return;
        }
        if (value.length > MAX_CHUNK_BYTES) {
          await sleep(0);
        }
      }
    }
  }

  if (token !== state.streamToken) {
    return;
  }

  if (state.streamRunning) {
    state.api.setEof(state.ctx);
    tryOpen();
    state.draining = true;
    postLog("File stream ended. Draining decoder.");
    startDecodeLoop(0);
  }
  state.streamRunning = false;
  if (state.reader === reader) {
    state.reader = null;
  }
};

const streamUrl = async (url) => {
  const token = (state.streamToken += 1);
  state.streamRunning = true;
  const abortController = new AbortController();
  state.abortController = abortController;
  postLog(`Fetching stream: ${url}`);

  let response;
  try {
    response = await fetch(url, { signal: abortController.signal });
  } catch (err) {
    if (token !== state.streamToken) {
      return;
    }
    postLog(`Fetch failed: ${err.message}`);
    state.streamRunning = false;
    return;
  }

  if (!response.ok || !response.body) {
    if (token !== state.streamToken) {
      return;
    }
    postLog(`HTTP error: ${response.status}`);
    state.streamRunning = false;
    return;
  }

  const reader = response.body.getReader();
  state.reader = reader;

  while (token === state.streamToken && state.streamRunning) {
    await waitForBuffer(token);
    const { value, done } = await reader.read();
    if (token !== state.streamToken) break;
    if (done) break;
    if (value && value.length) {
      for (let offset = 0; offset < value.length; offset += MAX_CHUNK_BYTES) {
        if (token !== state.streamToken) break;
        await waitForBuffer(token);
        if (token !== state.streamToken) break;
        const slice = value.subarray(offset, offset + MAX_CHUNK_BYTES);
        if (!appendChunk(token, slice)) {
          return;
        }
        if (value.length > MAX_CHUNK_BYTES) {
          await sleep(0);
        }
      }
    }
  }

  if (token !== state.streamToken) {
    return;
  }

  if (state.streamRunning) {
    state.api.setEof(state.ctx);
    tryOpen();
    state.draining = true;
    postLog("Network stream ended. Draining decoder.");
    startDecodeLoop(0);
  }
  state.streamRunning = false;
  if (state.reader === reader) {
    state.reader = null;
  }
};

const copyRgba = (ptr, stride, width, height, target) => {
  const rowSize = width * 4;
  const heap = state.Module.HEAPU8;
  for (let y = 0; y < height; y += 1) {
    const srcStart = ptr + y * stride;
    const srcEnd = srcStart + rowSize;
    const dstStart = y * rowSize;
    target.set(heap.subarray(srcStart, srcEnd), dstStart);
  }
};

const ensureWebGL = () => {
  if (state.glState) {
    return state.glState;
  }
  if (!state.canvasGl) {
    return null;
  }

  const gl = state.canvasGl.getContext("webgl", { alpha: false, premultipliedAlpha: false });
  if (!gl) {
    postLog("WebGL unavailable; falling back to Canvas 2D.");
    state.renderMode = "2d";
    return null;
  }

  const compileShader = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || "shader compile failed";
      gl.deleteShader(shader);
      postLog(info);
      return null;
    }
    return shader;
  };

  const vert = compileShader(
    gl.VERTEX_SHADER,
    `attribute vec2 a_position;
     attribute vec2 a_texCoord;
     varying vec2 v_texCoord;
     void main() {
       gl_Position = vec4(a_position, 0.0, 1.0);
       v_texCoord = a_texCoord;
     }`,
  );
  const frag = compileShader(
    gl.FRAGMENT_SHADER,
    `precision mediump float;
     varying vec2 v_texCoord;
     uniform sampler2D u_texture;
     void main() {
       gl_FragColor = texture2D(u_texture, v_texCoord);
     }`,
  );

  if (!vert || !frag) {
    return null;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    postLog("WebGL program link failed.");
    return null;
  }

  gl.useProgram(program);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const positionLoc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), gl.STATIC_DRAW);
  const texCoordLoc = gl.getAttribLocation(program, "a_texCoord");
  gl.enableVertexAttribArray(texCoordLoc);
  gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  const textureLoc = gl.getUniformLocation(program, "u_texture");
  gl.uniform1i(textureLoc, 0);

  state.glState = { gl, texture, width: 0, height: 0 };
  return state.glState;
};

const renderFrame2d = (ptr, stride, width, height) => {
  if (!state.ctx2d || !state.canvas2d) {
    return;
  }
  if (!state.imageData || state.imageData.width !== width || state.imageData.height !== height) {
    state.canvas2d.width = width;
    state.canvas2d.height = height;
    state.imageData = state.ctx2d.createImageData(width, height);
    postMessage({ type: "resolution", width, height });
  }

  copyRgba(ptr, stride, width, height, state.imageData.data);
  state.ctx2d.putImageData(state.imageData, 0, 0);
};

const renderFrameWebGL = (ptr, stride, width, height) => {
  const glState = ensureWebGL();
  if (!glState || !state.canvasGl) {
    return;
  }

  const gl = glState.gl;
  if (glState.width !== width || glState.height !== height) {
    state.canvasGl.width = width;
    state.canvasGl.height = height;
    gl.viewport(0, 0, width, height);
    glState.width = width;
    glState.height = height;
    postMessage({ type: "resolution", width, height });
  }

  const size = width * height * 4;
  if (!state.rgbaBuffer || state.rgbaBuffer.length !== size) {
    state.rgbaBuffer = new Uint8Array(size);
  }

  copyRgba(ptr, stride, width, height, state.rgbaBuffer);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, glState.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, state.rgbaBuffer);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};

const renderFrame = () => {
  const width = state.api.width(state.ctx);
  const height = state.api.height(state.ctx);
  if (width <= 0 || height <= 0) {
    return;
  }
  const rgbaOk = state.api.toRgba(state.ctx);
  if (rgbaOk < 0) {
    postLog(`RGBA conversion failed (${rgbaOk}).`);
    return;
  }
  const ptr = state.api.rgbaPtr(state.ctx);
  const stride = state.api.rgbaStride(state.ctx);
  if (state.renderMode === "webgl") {
    renderFrameWebGL(ptr, stride, width, height);
  } else {
    renderFrame2d(ptr, stride, width, height);
  }
};

const handleAudioFrame = () => {
  const channels = state.api.audioChannels(state.ctx);
  const sampleRate = state.api.audioSampleRate(state.ctx);
  const nbSamples = state.api.audioSamples(state.ctx);
  const ptr = state.api.audioPtr(state.ctx);
  if (!channels || !sampleRate || nbSamples <= 0 || !ptr) {
    return;
  }

  const totalSamples = nbSamples * channels;
  const view = new Float32Array(state.Module.HEAPF32.buffer, ptr, totalSamples);
  const copy = new Float32Array(totalSamples);
  copy.set(view);
  const pts = state.api.audioPts(state.ctx);
  state.audioChannels = channels;
  state.audioSampleRate = sampleRate;
  postMessage({ type: "audio", channels, sampleRate, pts, buffer: copy.buffer }, [copy.buffer]);
};

const scheduleNext = (delayMs) => {
  stopDecodeLoop();
  state.decodeTimer = setTimeout(decodeTick, delayMs);
};

const decodeTick = () => {
  state.decodeTimer = null;
  const token = state.sessionToken;
  if (!state.playing || !state.opened) {
    return;
  }

  const budgetMs = state.seeking ? 4 : 8;
  const start = performance.now();
  while (performance.now() - start < budgetMs) {
    if (token !== state.sessionToken) {
      return;
    }

    const result = state.api.readFrame(state.ctx);
    if (result === 2) {
      if (!state.seeking) {
        handleAudioFrame();
      }
      if (state.duration === 0) {
        const now = performance.now();
        if (now - state.durationCheckLast > 500 && state.api.duration && hasExport("ffmpeg_wasm_duration_seconds")) {
          state.durationCheckLast = now;
          const duration = state.api.duration(state.ctx);
          if (duration > 0 && duration !== state.duration) {
            state.duration = duration;
            emitStats(true);
          }
        }
      }
      continue;
    }

    if (result === 1) {
      const pts = state.api.pts(state.ctx);
      state.currentTime = pts;
      if (state.duration === 0) {
        const now = performance.now();
        if (now - state.durationCheckLast > 500 && state.api.duration && hasExport("ffmpeg_wasm_duration_seconds")) {
          state.durationCheckLast = now;
          const duration = state.api.duration(state.ctx);
          if (duration > 0 && duration !== state.duration) {
            state.duration = duration;
            emitStats(true);
          }
        }
      }

      if (state.seeking && state.seekTarget !== null && pts < state.seekTarget) {
        const now = performance.now();
        if (now - state.seekUiLast > 120) {
          state.seekUiLast = now;
          emitStats(true);
        }
        if (now - state.seekPreviewLast > 250) {
          state.seekPreviewLast = now;
          renderFrame();
        }
        continue;
      }

      if (state.seeking && state.seekTarget !== null && pts >= state.seekTarget) {
        state.seeking = false;
        state.seekTarget = null;
        state.basePts = null;
        state.baseWall = 0;
        state.maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES;
        postStatus("Playing");
        if (state.api.setAudioEnabled && hasExport("ffmpeg_wasm_set_audio_enabled")) {
          state.api.setAudioEnabled(state.ctx, 1);
        }
      }

      if (state.basePts === null) {
        state.basePts = pts;
        state.baseWall = performance.now() / 1000;
      }

      renderFrame();
      state.frames += 1;
      emitStats();

      const targetTime = state.baseWall + (pts - state.basePts);
      const nowSeconds = performance.now() / 1000;
      const delayMs = Math.max(0, (targetTime - nowSeconds) * 1000);
      scheduleNext(delayMs);
      return;
    }

    if (result === 0) {
      state.waitingForData = true;
      scheduleNext(30);
      return;
    }

    if (result === -1) {
      postLog("End of stream.");
      state.playing = false;
      postMessage({ type: "ended" });
      emitStats(true);
      return;
    }

    postLog(`Decode error: ${result}`);
    state.playing = false;
    postMessage({ type: "ended" });
    emitStats(true);
    return;
  }

  scheduleNext(state.seeking ? 5 : 0);
};

const startDecodeLoop = (delayMs) => {
  if (!state.playing) return;
  if (state.decodeTimer) return;
  scheduleNext(delayMs);
};

const performSlowSeek = (target) => {
  if (!state.activeFile) {
    postLog("Slow seek requires a local file.");
    return;
  }

  postLog("Slow seek: re-decoding from start.");
  postMessage({ type: "audioClear" });
  state.seeking = true;
  state.seekTarget = target;
  state.currentTime = 0;
  state.frames = 0;
  state.maxBufferBytes = Math.min(state.maxBufferBytes || SEEK_MAX_BUFFER_BYTES, SEEK_MAX_BUFFER_BYTES);
  state.basePts = null;
  state.baseWall = 0;
  emitStats(true);
  postStatus("Seeking...");

  const sessionToken = (state.sessionToken += 1);
  stopDecodeLoop();

  stopStream()
    .then(() => {
      if (sessionToken !== state.sessionToken) {
        return;
      }
      destroyDecoder();
      ensureDecoder(4 * 1024 * 1024);
      if (!state.ctx) return;
      state.opened = false;
      state.waitingForData = false;
      state.draining = false;
      if (state.api.setAudioEnabled && hasExport("ffmpeg_wasm_set_audio_enabled")) {
        state.api.setAudioEnabled(state.ctx, 0);
      }
      streamFile(state.activeFile);
      state.playing = true;
      startDecodeLoop(0);
    })
    .catch(() => {});
};

const performSeek = (seconds) => {
  if (!state.seekEnabled) {
    postLog("Seek disabled for this source.");
    return;
  }

  const target = Math.max(0, Math.min(seconds, state.duration || seconds));

  if (state.seekSlow) {
    performSlowSeek(target);
    return;
  }

  if (!state.api.seek || !hasExport("ffmpeg_wasm_seek_seconds")) {
    postLog("Seek API not available; rebuild wasm.");
    return;
  }

  stopDecodeLoop();
  postMessage({ type: "audioClear" });
  const ret = state.api.seek(state.ctx, target);
  if (ret < 0) {
    postLog(`Seek failed with code ${ret}; falling back to slow seek.`);
    state.seekSlow = true;
    performSlowSeek(target);
    return;
  }

  state.basePts = null;
  state.baseWall = 0;
  state.currentTime = target;
  state.frames = 0;
  emitStats(true);
  startDecodeLoop(0);
};

const setRenderMode = (mode) => {
  state.renderMode = mode === "webgl" ? "webgl" : "2d";
  if (state.renderMode === "2d") {
    if (!state.ctx2d && state.canvas2d) {
      state.ctx2d = state.canvas2d.getContext("2d", { alpha: false });
    }
  } else {
    ensureWebGL();
  }
};

const startSource = async ({ file, url, formatHint, bufferBytes }) => {
  await resetPlayback();

  state.formatHint = typeof formatHint === "string" ? formatHint.trim() : "";
  state.maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES;

  const seekable = Boolean(file) && file.size <= SEEKABLE_FILE_LIMIT;
  state.seekEnabled = Boolean(file);
  state.seekSlow = Boolean(file) && !seekable;
  if (state.seekEnabled) {
    postMessage({
      type: "seekInfo",
      enabled: true,
      slow: state.seekSlow,
      reason: state.seekSlow ? "Slow seek: re-decodes from start." : "",
    });
    if (state.seekSlow) {
      postLog("Large file: slow seek enabled with rolling buffer cleanup.");
    }
  } else {
    postMessage({
      type: "seekInfo",
      enabled: false,
      slow: false,
      reason: "Seek disabled for streaming sources.",
    });
  }

  ensureDecoder(bufferBytes);
  if (!state.ctx) return;

  if (state.api.setKeepAll && hasExport("ffmpeg_wasm_set_keep_all")) {
    state.api.setKeepAll(state.ctx, seekable ? 1 : 0);
  }
  if (state.api.setBufferLimit && hasExport("ffmpeg_wasm_set_buffer_limit")) {
    state.api.setBufferLimit(state.ctx, BUFFER_LIMIT_BYTES);
  }

  state.playing = true;
  state.activeFile = file || null;
  state.activeUrl = url || null;
  emitStats(true);

  if (file) {
    streamFile(file);
  } else if (url) {
    streamUrl(url);
  } else {
    postLog("Choose a file or enter a URL.");
    state.playing = false;
    return;
  }

  startDecodeLoop(0);
};

const initModule = async () => {
  try {
    importScripts("ffmpeg_wasm.js");
  } catch (err) {
    postLog(`Failed to load ffmpeg_wasm.js: ${err.message}`);
    postStatus("Missing ffmpeg_wasm.js");
    return;
  }

  if (typeof FFmpegWasm !== "function") {
    postLog("FFmpegWasm factory not found.");
    postStatus("Missing FFmpegWasm");
    return;
  }

  postStatus("Loading FFmpeg module...");
  try {
    state.Module = await FFmpegWasm();
  } catch (err) {
    postLog(`Module load failed: ${err.message}`);
    postStatus("Load failed");
    return;
  }

  state.api = createApi(state.Module);
  postStatus("Ready");
  postMessage({ type: "ready" });
  postLog("Module ready.");
};

onmessage = (event) => {
  const msg = event.data;
  if (!msg || !msg.type) {
    return;
  }

  if (msg.type === "init") {
    state.canvas2d = msg.canvas2d || null;
    state.canvasGl = msg.canvasGl || null;
    if (state.canvas2d) {
      state.ctx2d = state.canvas2d.getContext("2d", { alpha: false });
    }
    setRenderMode(msg.renderMode);
    initModule();
    return;
  }

  if (!state.api) {
    return;
  }

  if (msg.type === "load") {
    startSource(msg);
  } else if (msg.type === "play") {
    state.playing = true;
    postStatus("Playing");
    startDecodeLoop(0);
  } else if (msg.type === "pause") {
    state.playing = false;
    stopDecodeLoop();
    postStatus("Paused");
  } else if (msg.type === "stop") {
    resetPlayback();
  } else if (msg.type === "seek") {
    performSeek(Number(msg.seconds) || 0);
  } else if (msg.type === "renderMode") {
    setRenderMode(msg.mode);
  }
};
