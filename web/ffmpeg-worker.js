/* global FFmpegWasm */

const DEFAULT_AUDIO_RATE = 48000;
const BUFFER_LIMIT_BYTES = 500 * 1024 * 1024;
const DEFAULT_MAX_BUFFER_BYTES = 512 * 1024 * 1024;
const SEEK_MAX_BUFFER_BYTES = 48 * 1024 * 1024;
const BUFFER_POLL_MS = 15;
const MAX_CHUNK_BYTES = 256 * 1024;
const MIN_OPEN_BYTES = 2 * 1024 * 1024; // Default minimum bytes before attempting to open container
const MIN_OPEN_BYTES_SMALL = 256 * 1024; // Lower threshold for small files
const HEADER_SAMPLE_BYTES = 32; // Bytes to sample for EBML header sanity-check

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
  pendingStreamSelection: null,
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
  lastOpenErrorLogged: null,
  renderMode: "2d",
  formatHint: "",
  activeFile: null,
  activeUrl: null,
  headerSample: null,
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
  durationUnknownLogged: false,
  // New feature state
  playbackSpeed: 1.0,
  subtitleDelay: 0,
  fontData: null,
};

const postLog = (message) => postMessage({ type: "log", message });
const postStatus = (message) => postMessage({ type: "status", message });

const isMp4Container = (file) => {
  if (!file) return false;
  const name = file.name.toLowerCase();
  const hint = (state.formatHint || "").toLowerCase();
  return (
    name.endsWith(".mp4") ||
    name.endsWith(".m4v") ||
    name.endsWith(".mov") ||
    name.endsWith(".3gp") ||
    name.endsWith(".3g2") ||
    hint === "mov" ||
    hint === "mp4"
  );
};

const hasExport = (name) =>
  state.Module && typeof state.Module[`_${name}`] === "function";

const cwrapMaybe = (Module, name, returnType, argTypes) =>
  hasExport(name) ? Module.cwrap(name, returnType, argTypes) : null;

const createApi = (Module) => ({
  create: Module.cwrap("ffmpeg_wasm_create", "number", ["number"]),
  destroy: Module.cwrap("ffmpeg_wasm_destroy", null, ["number"]),
  append: Module.cwrap("ffmpeg_wasm_append", "number", [
    "number",
    "number",
    "number",
  ]),
  setEof: Module.cwrap("ffmpeg_wasm_set_eof", null, ["number"]),
  open: Module.cwrap("ffmpeg_wasm_open", "number", ["number", "string"]),
  readFrame: Module.cwrap("ffmpeg_wasm_read_frame", "number", ["number"]),
  width: Module.cwrap("ffmpeg_wasm_video_width", "number", ["number"]),
  height: Module.cwrap("ffmpeg_wasm_video_height", "number", ["number"]),
  pts: Module.cwrap("ffmpeg_wasm_frame_pts_seconds", "number", ["number"]),
  toRgba: Module.cwrap("ffmpeg_wasm_frame_to_rgba", "number", ["number"]),
  rgbaPtr: Module.cwrap("ffmpeg_wasm_rgba_ptr", "number", ["number"]),
  rgbaStride: Module.cwrap("ffmpeg_wasm_rgba_stride", "number", ["number"]),
  audioChannels: Module.cwrap("ffmpeg_wasm_audio_channels", "number", [
    "number",
  ]),
  audioSampleRate: Module.cwrap("ffmpeg_wasm_audio_sample_rate", "number", [
    "number",
  ]),
  audioSamples: Module.cwrap("ffmpeg_wasm_audio_nb_samples", "number", [
    "number",
  ]),
  audioPtr: Module.cwrap("ffmpeg_wasm_audio_ptr", "number", ["number"]),
  audioPts: Module.cwrap("ffmpeg_wasm_audio_pts_seconds", "number", ["number"]),
  bufferedBytes: Module.cwrap("ffmpeg_wasm_buffered_bytes", "number", [
    "number",
  ]),
  compactBuffer: Module.cwrap("ffmpeg_wasm_compact_buffer", null, ["number"]),
  duration: Module.cwrap("ffmpeg_wasm_duration_seconds", "number", ["number"]),
  seek: Module.cwrap("ffmpeg_wasm_seek_seconds", "number", [
    "number",
    "number",
  ]),
  setKeepAll: Module.cwrap("ffmpeg_wasm_set_keep_all", null, [
    "number",
    "number",
  ]),
  setBufferLimit: Module.cwrap("ffmpeg_wasm_set_buffer_limit", null, [
    "number",
    "number",
  ]),
  setFileSize: Module.cwrap("ffmpeg_wasm_set_file_size", null, [
    "number",
    "number",
  ]),
  setBufferOffset: cwrapMaybe(Module, "ffmpeg_wasm_set_buffer_offset", null, [
    "number",
    "number",
  ]),
  setAudioEnabled: Module.cwrap("ffmpeg_wasm_set_audio_enabled", null, [
    "number",
    "number",
  ]),
  streamsCount: cwrapMaybe(Module, "ffmpeg_wasm_streams_count", "number", [
    "number",
  ]),
  streamMediaType: cwrapMaybe(
    Module,
    "ffmpeg_wasm_stream_media_type",
    "number",
    ["number", "number"]
  ),
  streamCodecName: cwrapMaybe(
    Module,
    "ffmpeg_wasm_stream_codec_name",
    "string",
    ["number", "number"]
  ),
  streamLanguage: cwrapMaybe(Module, "ffmpeg_wasm_stream_language", "string", [
    "number",
    "number",
  ]),
  streamTitle: cwrapMaybe(Module, "ffmpeg_wasm_stream_title", "string", [
    "number",
    "number",
  ]),
  streamIsDefault: cwrapMaybe(
    Module,
    "ffmpeg_wasm_stream_is_default",
    "number",
    ["number", "number"]
  ),
  selectedVideoStream: cwrapMaybe(
    Module,
    "ffmpeg_wasm_selected_video_stream",
    "number",
    ["number"]
  ),
  selectedAudioStream: cwrapMaybe(
    Module,
    "ffmpeg_wasm_selected_audio_stream",
    "number",
    ["number"]
  ),
  audioIsEnabled: cwrapMaybe(Module, "ffmpeg_wasm_audio_is_enabled", "number", [
    "number",
  ]),
  selectStreams: cwrapMaybe(Module, "ffmpeg_wasm_select_streams", "number", [
    "number",
    "number",
    "number",
  ]),
  selectedSubtitleStream: cwrapMaybe(
    Module,
    "ffmpeg_wasm_selected_subtitle_stream",
    "number",
    ["number"]
  ),
  subtitleEventsCount: cwrapMaybe(
    Module,
    "ffmpeg_wasm_subtitle_events_count",
    "number",
    ["number"]
  ),
  subtitleFirstStartMs: cwrapMaybe(
    Module,
    "ffmpeg_wasm_subtitle_first_start_ms",
    "number",
    ["number"]
  ),
  subtitleFirstEndMs: cwrapMaybe(
    Module,
    "ffmpeg_wasm_subtitle_first_end_ms",
    "number",
    ["number"]
  ),
  subtitlesEnabled: cwrapMaybe(
    Module,
    "ffmpeg_wasm_subtitles_enabled",
    "number",
    ["number"]
  ),
  selectSubtitleStream: cwrapMaybe(
    Module,
    "ffmpeg_wasm_select_subtitle_stream",
    "number",
    ["number", "number"]
  ),
  renderSubtitles: cwrapMaybe(
    Module,
    "ffmpeg_wasm_render_subtitles",
    "number",
    ["number", "number"]
  ),
  clearSubtitleTrack: cwrapMaybe(
    Module,
    "ffmpeg_wasm_clear_subtitle_track",
    null,
    ["number"]
  ),
  addFont: Module.cwrap("ffmpeg_wasm_add_font", "number", [
    "number",
    "string",
    "number",
    "number",
  ]),
});

const getStreamsPayload = () => {
  if (!state.api || !state.ctx || !state.opened) {
    return null;
  }
  if (!state.api.streamsCount || !state.api.streamMediaType) {
    return null;
  }

  const count = state.api.streamsCount(state.ctx);
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }

  const streams = [];
  for (let i = 0; i < count; i += 1) {
    const mediaType = state.api.streamMediaType(state.ctx, i);
    const codec = state.api.streamCodecName
      ? state.api.streamCodecName(state.ctx, i)
      : null;
    const language = state.api.streamLanguage
      ? state.api.streamLanguage(state.ctx, i)
      : null;
    const title = state.api.streamTitle
      ? state.api.streamTitle(state.ctx, i)
      : null;
    const isDefault = state.api.streamIsDefault
      ? Boolean(state.api.streamIsDefault(state.ctx, i))
      : false;
    streams.push({ index: i, mediaType, codec, language, title, isDefault });
  }

  const selectedVideo = state.api.selectedVideoStream
    ? state.api.selectedVideoStream(state.ctx)
    : -1;
  const selectedAudio = state.api.selectedAudioStream
    ? state.api.selectedAudioStream(state.ctx)
    : -1;
  const selectedSubtitle = state.api.selectedSubtitleStream
    ? state.api.selectedSubtitleStream(state.ctx)
    : -1;
  const audioEnabled = state.api.audioIsEnabled
    ? Boolean(state.api.audioIsEnabled(state.ctx))
    : true;
  const subtitlesEnabled = state.api.subtitlesEnabled
    ? Boolean(state.api.subtitlesEnabled(state.ctx))
    : false;

  return {
    type: "streams",
    streams,
    selectedVideo,
    selectedAudio,
    selectedSubtitle,
    audioEnabled,
    subtitlesEnabled,
  };
};

const emitStreams = () => {
  const payload = getStreamsPayload();
  if (payload) {
    postMessage(payload);
  }
};

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
  state.lastOpenErrorLogged = null;
  state.headerSample = null;
  state.audioChannels = 0;
  state.audioSampleRate = 0;
  state.imageData = null;
  state.rgbaBuffer = null;
  state.glState = null;
  state.durationCheckLast = 0;
  state.durationUnknownLogged = false;
  emitStats(true);
};

const stopStream = async () => {
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
};

const stopDecodeLoop = () => {
  if (state.decodeTimer) {
    clearTimeout(state.decodeTimer);
    state.decodeTimer = null;
  }
};

const clearCanvas = () => {
  if (state.renderMode === "2d") {
    if (state.ctx2d && state.canvas2d) {
      state.ctx2d.clearRect(0, 0, state.canvas2d.width, state.canvas2d.height);
      state.ctx2d.fillStyle = "#000000";
      state.ctx2d.fillRect(0, 0, state.canvas2d.width, state.canvas2d.height);
    }
  } else {
    // WebGL
    // Don't use ensureWebGL() here to avoid recreating state if it was just destroyed
    // But if we are stopping, we likely have state.glState or at least state.canvasGl
    if (state.glState) {
      const gl = state.glState.gl;
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else if (state.canvasGl) {
      // Fallback if glState is missing but canvas exists
      const gl = state.canvasGl.getContext("webgl");
      if (gl) {
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
  }
};

const resetPlayback = async () => {
  state.sessionToken += 1;
  state.playing = false;
  stopDecodeLoop();
  await stopStream();
  clearCanvas();
  destroyDecoder();

  state.activeFile = null;
  state.activeUrl = null;
  state.formatHint = "";

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
  if (!ptr) {
    postLog(`malloc failed for ${chunk.length} bytes`);
    return -12; // AVERROR(ENOMEM)
  }
  Module.HEAPU8.set(chunk, ptr);
  const ret = state.api.append(state.ctx, ptr, chunk.length);
  Module._free(ptr);
  return ret;
};

const captureHeaderSample = (chunk) => {
  if (state.headerSample && state.headerSample.length >= HEADER_SAMPLE_BYTES) {
    return;
  }
  const already = state.headerSample ? state.headerSample.length : 0;
  const need = HEADER_SAMPLE_BYTES - already;
  const take = Math.min(need, chunk.length);
  if (take <= 0) {
    return;
  }
  const next = new Uint8Array(already + take);
  if (state.headerSample) {
    next.set(state.headerSample, 0);
  }
  next.set(chunk.subarray(0, take), already);
  state.headerSample = next;
};

const ebmlHeaderLooksValid = () => {
  if (!state.headerSample || state.headerSample.length < 4) {
    return null;
  }
  return (
    state.headerSample[0] === 0x1a &&
    state.headerSample[1] === 0x45 &&
    state.headerSample[2] === 0xdf &&
    state.headerSample[3] === 0xa3
  );
};

const getMinOpenBytes = () => {
  if (state.activeFile && Number.isFinite(state.activeFile.size)) {
    const size = state.activeFile.size;
    if (size <= MIN_OPEN_BYTES_SMALL) {
      return Math.min(MIN_OPEN_BYTES_SMALL, size);
    }
    return Math.min(MIN_OPEN_BYTES, size);
  }
  return MIN_OPEN_BYTES;
};

const describeOpenFailure = (ret, minOpenBytes) => {
  const headerOk = ebmlHeaderLooksValid();
  const hints = [];
  if (headerOk === false) {
    hints.push(
      "Missing or invalid EBML header; ensure the stream starts at byte 0."
    );
  }
  if (state.activeFile && state.bytes < minOpenBytes && !state.draining) {
    hints.push("Buffer more data (file is small) before opening.");
  }
  const hintText = hints.length ? ` ${hints.join(" ")}` : "";
  return `Open failed (${ret}).${hintText}`;
};

const tryOpen = () => {
  if (state.opened || !state.ctx) return;
  // Wait for minimum data before attempting to parse container header
  const minOpenBytes = getMinOpenBytes();
  if (state.bytes < minOpenBytes && !state.draining) return;

  const ret = state.api.open(state.ctx, state.formatHint || null);
  if (ret === 0) {
    state.opened = true;
    state.lastOpenError = null;
    state.lastOpenErrorLogged = null;
    state.duration = 0;
    if (state.api.duration && hasExport("ffmpeg_wasm_duration_seconds")) {
      const duration = state.api.duration(state.ctx);
      if (duration > 0) {
        state.duration = duration;
        state.durationUnknownLogged = false;
      } else if (
        !state.durationUnknownLogged &&
        state.activeFile &&
        isMp4Container(state.activeFile)
      ) {
        state.durationUnknownLogged = true;
        postLog(
          "MP4 duration unknown until moov atom is available (faststart recommended)."
        );
      }
    }
    postStatus("Playing");
    if (state.pendingStreamSelection && state.api.selectStreams) {
      const { videoStreamIndex, audioStreamIndex, subtitleStreamIndex } =
        state.pendingStreamSelection;
      state.pendingStreamSelection = null;
      const selectRet = state.api.selectStreams(
        state.ctx,
        Number(videoStreamIndex),
        Number(audioStreamIndex)
      );
      if (selectRet < 0) {
        postLog(`Track selection failed (${selectRet}).`);
      } else {
        postMessage({ type: "audioClear" });
        state.basePts = null;
        state.baseWall = 0;
      }
      // Apply subtitle selection if requested
      if (
        state.api.selectSubtitleStream &&
        subtitleStreamIndex !== undefined &&
        subtitleStreamIndex !== -2
      ) {
        const subRet = state.api.selectSubtitleStream(
          state.ctx,
          subtitleStreamIndex
        );
        if (subRet < 0) {
          postLog(`Subtitle track selection failed (${subRet}).`);
        } else {
          postLog(
            `Subtitle track set to ${
              subtitleStreamIndex === -1 ? "auto" : subtitleStreamIndex
            }`
          );
          injectFont();
        }
      }
    }
    emitStreams();
    emitStats(true);
    startDecodeLoop(0);
  } else if (ret !== state.lastOpenError) {
    state.lastOpenError = ret;
    if (state.draining || state.bytes >= minOpenBytes) {
      if (ret !== state.lastOpenErrorLogged) {
        state.lastOpenErrorLogged = ret;
        postLog(describeOpenFailure(ret, minOpenBytes));
      }
      if (state.draining) {
        state.playing = false;
        postStatus("Open failed");
        postMessage({ type: "ended" });
        emitStats(true);
      }
    } else {
      postLog(`Open waiting for more data (code ${ret}).`);
    }
  }
};

const appendChunk = (token, chunk) => {
  if (token !== state.streamToken) {
    return false;
  }
  if (!state.ctx) return false;
  captureHeaderSample(chunk);
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

const streamFile = async (file, startByte = 0) => {
  const token = (state.streamToken += 1);
  state.streamRunning = true;
  // Use file.slice() to start streaming from a specific byte offset
  const slicedFile = startByte > 0 ? file.slice(startByte) : file;
  const reader = slicedFile.stream().getReader();
  state.reader = reader;
  if (startByte > 0) {
    postLog(`Streaming file from byte ${startByte}: ${file.name}`);
  } else {
    postLog(`Streaming file: ${file.name} (${file.size} bytes)`);
  }

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
    state.draining = true;
    postLog("File stream ended. Draining decoder.");
    tryOpen();
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
    state.draining = true;
    postLog("Network stream ended. Draining decoder.");
    tryOpen();
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

  const gl = state.canvasGl.getContext("webgl", {
    alpha: false,
    premultipliedAlpha: false,
  });
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
     }`
  );
  const frag = compileShader(
    gl.FRAGMENT_SHADER,
    `precision mediump float;
     varying vec2 v_texCoord;
     uniform sampler2D u_texture;
     void main() {
       gl_FragColor = texture2D(u_texture, v_texCoord);
     }`
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
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  const positionLoc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]),
    gl.STATIC_DRAW
  );
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
  if (
    !state.imageData ||
    state.imageData.width !== width ||
    state.imageData.height !== height
  ) {
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
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    state.rgbaBuffer
  );
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
  if (state.api.renderSubtitles) {
    const pts = state.api.pts(state.ctx) + state.subtitleDelay;
    const enabled = state.api.subtitlesEnabled
      ? state.api.subtitlesEnabled(state.ctx)
      : true;
    const selectedSub = state.api.selectedSubtitleStream
      ? state.api.selectedSubtitleStream(state.ctx)
      : -1;
    const drew = state.api.renderSubtitles(state.ctx, pts);

    if (state._subtitleDebugCount === undefined) {
      state._subtitleDebugCount = 0;
    }
    if (
      state._subtitleDebugCount < 10 ||
      (pts >= 30 && pts - (state._subtitleLastLogPts || 0) >= 1)
    ) {
      postLog(
        `Subtitle render: ret=${drew} enabled=${enabled} track=${selectedSub} delay=${state.subtitleDelay.toFixed(
          3
        )} pts=${pts.toFixed(3)} events=${state.api.subtitleEventsCount ? state.api.subtitleEventsCount(state.ctx) : "n/a"} firstStartMs=${state.api.subtitleFirstStartMs ? state.api.subtitleFirstStartMs(state.ctx) : "n/a"} firstEndMs=${state.api.subtitleFirstEndMs ? state.api.subtitleFirstEndMs(state.ctx) : "n/a"}`
      );
      state._subtitleDebugCount += 1;
      state._subtitleLastLogPts = pts;
    }
    if (drew > 0 && !state._subtitleDrawnOnce) {
      state._subtitleDrawnOnce = true;
      postLog("Subtitles drew onto frame.");
    }
  } else if (!state._subtitleRenderMissingLogged) {
    state._subtitleRenderMissingLogged = true;
    postLog("Subtitle render function missing in wasm.");
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
  postMessage(
    { type: "audio", channels, sampleRate, pts, buffer: copy.buffer },
    [copy.buffer]
  );
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
        if (
          now - state.durationCheckLast > 500 &&
          state.api.duration &&
          hasExport("ffmpeg_wasm_duration_seconds")
        ) {
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
        if (
          now - state.durationCheckLast > 500 &&
          state.api.duration &&
          hasExport("ffmpeg_wasm_duration_seconds")
        ) {
          state.durationCheckLast = now;
          const duration = state.api.duration(state.ctx);
          if (duration > 0 && duration !== state.duration) {
            state.duration = duration;
            emitStats(true);
          }
        }
      }

      if (
        state.seeking &&
        state.seekTarget !== null &&
        pts < state.seekTarget
      ) {
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

      if (
        state.seeking &&
        state.seekTarget !== null &&
        pts >= state.seekTarget
      ) {
        state.seeking = false;
        state.seekTarget = null;
        state.basePts = null;
        state.baseWall = 0;
        state.maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES;
        postStatus("Playing");
        // Clear any stale audio before re-enabling
        postMessage({ type: "audioClear" });
        if (
          state.api.setAudioEnabled &&
          hasExport("ffmpeg_wasm_set_audio_enabled")
        ) {
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

      // Compact buffer periodically (every ~60 frames) to free memory
      if (state.api.compactBuffer && state.frames % 60 === 0) {
        state.api.compactBuffer(state.ctx);
      }

      // Calculate target time with playback speed adjustment
      const speed = state.playbackSpeed || 1.0;
      const elapsedVideo = pts - state.basePts;
      const targetTime = state.baseWall + elapsedVideo / speed;
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
      // Clear seeking state if we hit EOF during a seek
      if (state.seeking) {
        state.seeking = false;
        state.seekTarget = null;
        state.maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES;
        if (
          state.api.setAudioEnabled &&
          hasExport("ffmpeg_wasm_set_audio_enabled")
        ) {
          state.api.setAudioEnabled(state.ctx, 1);
        }
      }

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
  // For forward seeks: just fast-forward through frames (don't restart)
  // For backward seeks: must restart from beginning (MKV can't seek backward in stream)
  const needsRestart = target < state.currentTime;

  if (needsRestart && !state.activeFile) {
    postLog("Backward seek requires a local file.");
    return;
  }

  postLog(
    needsRestart
      ? `Slow seek backward to ${target.toFixed(
          2
        )}s (restarting from beginning).`
      : `Slow seek forward to ${target.toFixed(2)}s (fast-forwarding).`
  );

  postMessage({ type: "audioClear" });
  state.seeking = true;
  state.seekTarget = target;
  state.basePts = null;
  state.baseWall = 0;
  emitStats(true);
  postStatus("Seeking...");

  // Disable audio during seek
  if (state.api.setAudioEnabled && hasExport("ffmpeg_wasm_set_audio_enabled")) {
    state.api.setAudioEnabled(state.ctx, 0);
  }

  if (!needsRestart) {
    // Forward seek: just continue decoding, the decode loop will fast-forward
    startDecodeLoop(0);
    return;
  }

  // Backward seek: restart from beginning
  const file = state.activeFile;
  const sessionToken = (state.sessionToken += 1);
  stopDecodeLoop();

  stopStream()
    .then(() => {
      if (sessionToken !== state.sessionToken) return;

      const savedSeeking = state.seeking;
      const savedSeekTarget = state.seekTarget;

      destroyDecoder();

      state.seeking = savedSeeking;
      state.seekTarget = savedSeekTarget;

      ensureDecoder(4 * 1024 * 1024);
      if (!state.ctx) return;

      state.opened = false;
      state.waitingForData = false;
      state.draining = false;
      state.currentTime = 0;
      state.frames = 0;

      if (state.api.setFileSize && hasExport("ffmpeg_wasm_set_file_size")) {
        state.api.setFileSize(state.ctx, file.size);
      }
      if (
        state.api.setAudioEnabled &&
        hasExport("ffmpeg_wasm_set_audio_enabled")
      ) {
        state.api.setAudioEnabled(state.ctx, 0);
      }

      streamFile(file);
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

  const target =
    state.duration > 0
      ? Math.max(0, Math.min(seconds, state.duration))
      : Math.max(0, seconds);

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

  const isBackward = target < state.currentTime;
  const ret = state.api.seek(state.ctx, target);

  if (ret < 0) {
    postLog(`Seek failed with code ${ret}; falling back to slow seek.`);
    state.seekSlow = true;
    performSlowSeek(target);
    return;
  }

  // For backward seeks, verify FFmpeg actually moved backward
  // If data was compacted, FFmpeg might stay at current position
  if (isBackward) {
    // Peek at next frame to check actual position
    const peekRet = state.api.readFrame(state.ctx);
    if (peekRet === 1) {
      const actualPts = state.api.pts(state.ctx);
      // If we're still far ahead of target, fall back to slow seek
      if (actualPts > target + 10) {
        postLog(
          `Backward seek landed at ${actualPts.toFixed(
            1
          )}s instead of ${target.toFixed(1)}s; restarting.`
        );
        performSlowSeek(target);
        return;
      }
    }
  }

  // Set seeking state so decode loop fast-forwards if FFmpeg jumped to wrong keyframe
  state.seeking = true;
  state.seekTarget = target;
  state.basePts = null;
  state.baseWall = 0;
  state.currentTime = 0;
  state.frames = 0;
  postStatus("Seeking...");

  // Disable audio during seek fast-forward
  if (state.api.setAudioEnabled && hasExport("ffmpeg_wasm_set_audio_enabled")) {
    state.api.setAudioEnabled(state.ctx, 0);
  }

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

const injectFont = () => {
  if (!state.ctx || !state.fontData || !state.api.addFont) return;
  // Ensure we don't add it multiple times?
  // libass might handle duplicates or just waste memory.
  // But we re-create ass_library when we reopen subtitle stream?
  // Yes, init_ass_library creates a new library if one doesn't exist.
  // But if it exists, it returns early.
  // However, reopen_subtitle_stream calls close_subtitle_decoder first?
  // Let's check ffmpeg_wasm.c: reopen_subtitle_stream calls init_ass_library BEFORE close_subtitle_decoder?
  // No, init_ass_library(ctx) checks if ctx->ass_library exists.
  // And reopen_subtitle_stream calls init_ass_library.
  // Wait, reopen_subtitle_stream:
  //   init_ass_library(ctx);
  //   ...
  //   close_subtitle_decoder(ctx); // this frees ass_track but NOT ass_library?
  //
  // close_subtitle_decoder:
  //   ass_free_track(ctx->ass_track);
  //   avcodec_free_context(...);
  //
  // free_ass_renderer calls close_subtitle_decoder then ass_renderer_done then ass_library_done.
  // free_ass_renderer is called by reset_decoder.
  //
  // So ass_library persists across subtitle stream changes as long as decoder isn't reset.
  // So we only need to add font once per decoder session (opened=true).
  // But to be safe and simple, we can add it every time we select a subtitle stream,
  // assuming libass handles it or we track it.
  // Since we don't have easy way to check if font is added, let's track it in state?
  // Or just add it. ass_add_font adds to a list. Duplicate names might shadow or duplicate.
  // Let's try to add it only if we haven't added it for this session.
  // But session resets on file change.
  // Let's just add it. It's small.

  try {
    const len = state.fontData.byteLength;
    const ptr = state.Module._malloc(len);
    if (!ptr) {
      postLog("Failed to allocate memory for font");
      return;
    }
    state.Module.HEAPU8.set(state.fontData, ptr);
    state.api.addFont(state.ctx, "Inter", ptr, len);
    state.Module._free(ptr);
    postLog("Injected default font (Inter-Regular.ttf) into libass.");
  } catch (e) {
    postLog(`Error injecting font: ${e.message}`);
  }
};

const startSource = async ({
  file,
  url,
  formatHint,
  bufferBytes,
  videoStreamIndex,
  audioStreamIndex,
  subtitleStreamIndex,
}) => {
  await resetPlayback();

  state.formatHint = typeof formatHint === "string" ? formatHint.trim() : "";
  state.maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES;
  state.headerSample = null;
  state.lastOpenErrorLogged = null;

  if (state.api && state.api.selectStreams) {
    const v = Number.isFinite(videoStreamIndex) ? Number(videoStreamIndex) : -1;
    const a = Number.isFinite(audioStreamIndex) ? Number(audioStreamIndex) : -1;
    const s = Number.isFinite(subtitleStreamIndex)
      ? Number(subtitleStreamIndex)
      : -2;
    state.pendingStreamSelection = {
      videoStreamIndex: v,
      audioStreamIndex: a,
      subtitleStreamIndex: s,
    };
  }

  state.seekEnabled = Boolean(file);
  state.seekSlow = false; // Always try fast seek first; will fallback if it fails
  if (state.seekEnabled) {
    postMessage({
      type: "seekInfo",
      enabled: true,
      slow: false,
      reason: "",
    });
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

  // keep_all is now managed by C code:
  // - Set to 1 at create (prevents buffer compaction during open)
  // - Set to 0 after successful open (allows normal compaction during playback)
  if (state.api.setBufferLimit && hasExport("ffmpeg_wasm_set_buffer_limit")) {
    state.api.setBufferLimit(state.ctx, BUFFER_LIMIT_BYTES);
  }
  if (file && state.api.setFileSize && hasExport("ffmpeg_wasm_set_file_size")) {
    state.api.setFileSize(state.ctx, file.size);
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

  // Start loading font
  fetch("Inter-Regular.ttf")
    .then((resp) => {
      if (resp.ok) return resp.arrayBuffer();
      throw new Error("Font not found");
    })
    .then((buf) => {
      state.fontData = new Uint8Array(buf);
      postLog(
        `Loaded font: Inter-Regular.ttf (${state.fontData.byteLength} bytes)`
      );
    })
    .catch((e) => {
      postLog(`Failed to load default font: ${e.message}`);
    });

  try {
    state.Module = await FFmpegWasm({
      print: (text) => postLog(text),
      printErr: (text) => postLog(text),
    });
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

  if (msg.type === "subtitleDebug") {
    postLog(
      `Subtitle debug: ${msg.note || ""} nEvents=${msg.nEvents} firstStartMs=${msg.firstStartMs} firstEndMs=${msg.firstEndMs}`
    );
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
  } else if (msg.type === "selectStreams") {
    const videoStreamIndex = Number(msg.videoStreamIndex);
    const audioStreamIndex = Number(msg.audioStreamIndex);
    if (!state.api.selectStreams) {
      postLog("Track selection API unavailable; rebuild wasm.");
      return;
    }
    if (!state.ctx || !state.opened) {
      state.pendingStreamSelection = {
        ...(state.pendingStreamSelection || {}),
        videoStreamIndex,
        audioStreamIndex,
      };
      return;
    }
    const ret = state.api.selectStreams(
      state.ctx,
      videoStreamIndex,
      audioStreamIndex
    );
    if (ret < 0) {
      postLog(`Track selection failed (${ret}).`);
      return;
    }
    postMessage({ type: "audioClear" });
    state.basePts = null;
    state.baseWall = 0;
    emitStreams();
  } else if (msg.type === "screenshot") {
    // Capture current frame as screenshot
    takeScreenshot();
  } else if (msg.type === "setSpeed") {
    // Set playback speed
    const speed = Number(msg.speed) || 1.0;
    state.playbackSpeed = Math.max(0.25, Math.min(2.0, speed));
    // Adjust timing base to apply new speed
    if (state.basePts !== null) {
      state.baseWall = performance.now() / 1000;
      state.basePts = state.currentTime;
    }
    postLog(`Playback speed set to ${state.playbackSpeed}x`);
  } else if (msg.type === "frameStep") {
    // Step one frame forward or backward
    frameStep(msg.direction || 1);
  } else if (msg.type === "selectSubtitle") {
    const subtitleStreamIndex = Number(msg.subtitleStreamIndex);
    if (!state.api.selectSubtitleStream) {
      postLog("Subtitle selection API unavailable; rebuild wasm.");
      return;
    }
    if (!state.ctx || !state.opened) {
      state.pendingStreamSelection = {
        ...(state.pendingStreamSelection || {}),
        subtitleStreamIndex,
      };
      postLog(
        `Subtitle track ${subtitleStreamIndex} queued for when file opens.`
      );
      return;
    }
    const ret = state.api.selectSubtitleStream(state.ctx, subtitleStreamIndex);
    if (ret < 0) {
      postLog(`Subtitle track selection failed (${ret}).`);
      return;
    }
    injectFont();
    const enabledNow = state.api.subtitlesEnabled
      ? state.api.subtitlesEnabled(state.ctx)
      : null;
    const selectedNow = state.api.selectedSubtitleStream
      ? state.api.selectedSubtitleStream(state.ctx)
      : null;
    postLog(
      `Subtitle select ok ret=${ret} enabled=${enabledNow} track=${selectedNow}`
    );
    // Update pending selection state so it persists if re-opened (e.g. seek restart)
    if (state.pendingStreamSelection) {
      state.pendingStreamSelection.subtitleStreamIndex = subtitleStreamIndex;
    }
    if (state.api.clearSubtitleTrack && subtitleStreamIndex >= 0) {
      state.api.clearSubtitleTrack(state.ctx);
    }
    state._subtitleDebugCount = 0;
    state._subtitleDrawnOnce = false;
    state._subtitleRenderMissingLogged = false;
    emitStreams();
    postLog(
      `Subtitle track ${
        subtitleStreamIndex === -2
          ? "disabled"
          : `set to ${subtitleStreamIndex}`
      }`
    );
  } else if (msg.type === "setSubtitleDelay") {
    // Set subtitle delay
    state.subtitleDelay = Number(msg.delay) || 0;
    postLog(
      `Subtitle delay set to ${(state.subtitleDelay * 1000).toFixed(0)}ms`
    );
  }
};

// Screenshot function
const takeScreenshot = () => {
  let canvas, ctx;
  let dataUrl = null;

  if (state.renderMode === "webgl" && state.canvasGl) {
    canvas = state.canvasGl;
    const gl = state.glState ? state.glState.gl : null;
    if (gl && canvas.width > 0 && canvas.height > 0) {
      // Read pixels from WebGL context
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(
        0,
        0,
        canvas.width,
        canvas.height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels
      );

      // WebGL reads from bottom-left, need to flip vertically
      const tempCanvas = new OffscreenCanvas(canvas.width, canvas.height);
      const tempCtx = tempCanvas.getContext("2d");
      const imageData = tempCtx.createImageData(canvas.width, canvas.height);

      // Flip vertically
      for (let y = 0; y < canvas.height; y++) {
        const srcRow = (canvas.height - 1 - y) * canvas.width * 4;
        const dstRow = y * canvas.width * 4;
        for (let x = 0; x < canvas.width * 4; x++) {
          imageData.data[dstRow + x] = pixels[srcRow + x];
        }
      }
      tempCtx.putImageData(imageData, 0, 0);

      tempCanvas.convertToBlob({ type: "image/png" }).then((blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          postMessage({ type: "screenshot", dataUrl: reader.result });
        };
        reader.readAsDataURL(blob);
      });
      return;
    }
  }

  // Canvas 2D mode
  if (state.canvas2d && state.canvas2d.width > 0 && state.canvas2d.height > 0) {
    state.canvas2d.convertToBlob({ type: "image/png" }).then((blob) => {
      const reader = new FileReader();
      reader.onload = () => {
        postMessage({ type: "screenshot", dataUrl: reader.result });
      };
      reader.readAsDataURL(blob);
    });
    return;
  }

  postLog("No frame available for screenshot");
};

// Frame stepping function
const frameStep = (direction) => {
  if (!state.ctx || !state.opened) {
    postLog("No video loaded for frame stepping");
    return;
  }

  // Pause playback
  state.playing = false;
  stopDecodeLoop();

  if (direction > 0) {
    // Step forward: decode next frame
    const result = state.api.readFrame(state.ctx);
    if (result === 1) {
      const pts = state.api.pts(state.ctx);
      state.currentTime = pts;
      renderFrame();
      state.frames += 1;
      emitStats(true);
    } else if (result === 2) {
      // Audio frame, skip to next
      frameStep(1);
      return;
    } else {
      postLog("No more frames available");
    }
  } else {
    // Step backward: seek to previous keyframe (limited support)
    // This is complex with streaming - would need to seek backward
    postLog("Backward frame step not supported in streaming mode");
  }

  postStatus("Paused");
};
