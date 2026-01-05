const statusEl = document.getElementById("status");
const fileInput = document.getElementById("fileInput");
const urlInput = document.getElementById("urlInput");
const formatSelect = document.getElementById("formatSelect");
const renderModeSelect = document.getElementById("renderMode");
const bufferSizeInput = document.getElementById("bufferSize");
const volumeRange = document.getElementById("volumeRange");
const volumeValue = document.getElementById("volumeValue");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const overlayPlay = document.getElementById("overlayPlay");
const overlayPause = document.getElementById("overlayPause");
const overlayStop = document.getElementById("overlayStop");
const seekRange = document.getElementById("seekRange");
const timeCurrentEl = document.getElementById("timeCurrent");
const timeTotalEl = document.getElementById("timeTotal");
const overlayMute = document.getElementById("overlayMute");
const overlayVolume = document.getElementById("overlayVolume");
const overlayFullscreen = document.getElementById("overlayFullscreen");
const canvas2d = document.getElementById("canvas2d");
const canvasGl = document.getElementById("canvasGl");
const canvasWrap = document.getElementById("canvasWrap");
const playerEl = document.getElementById("player");
const videoTrackSelect = document.getElementById("videoTrackSelect");
const audioTrackSelect = document.getElementById("audioTrackSelect");
const logEl = document.getElementById("log");
const resolutionEl = document.getElementById("resolution");
const frameCountEl = document.getElementById("frameCount");
const bytesCountEl = document.getElementById("bytesCount");
const ptsValueEl = document.getElementById("ptsValue");
const audioInfoEl = document.getElementById("audioInfo");
const audioClockEl = document.getElementById("audioClock");

// New feature elements
const speedSelect = document.getElementById("speedSelect");
const speedDisplay = document.getElementById("speedDisplay");
const screenshotBtn = document.getElementById("screenshotBtn");
const audioDelayInput = document.getElementById("audioDelayInput");
const audioDelayValue = document.getElementById("audioDelayValue");
const subtitleTrackSelect = document.getElementById("subtitleTrackSelect");
const subtitleDelayInput = document.getElementById("subtitleDelayInput");
const subtitleDelayValue = document.getElementById("subtitleDelayValue");
const loopToggle = document.getElementById("loopToggle");
const loopStartBtn = document.getElementById("loopStartBtn");
const loopEndBtn = document.getElementById("loopEndBtn");
const loopDisplay = document.getElementById("loopDisplay");
const aspectRatioSelect = document.getElementById("aspectRatioSelect");
const brightnessInput = document.getElementById("brightnessInput");
const contrastInput = document.getElementById("contrastInput");
const saturationInput = document.getElementById("saturationInput");
const filtersReset = document.getElementById("filtersReset");
const osdEl = document.getElementById("osd");

const DEFAULT_AUDIO_RATE = 48000;
const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

const state = {
  worker: null,
  ready: false,
  started: false,
  playing: false,
  scrubbing: false,
  duration: 0,
  seekEnabled: false,
  seekHint: "",
  renderMode: "2d",
  frames: 0,
  bytes: 0,
  pts: 0,
  lastSeekCommitTs: 0,
  lastSeekCommitValue: 0,
  audio: {
    context: null,
    worklet: null,
    gain: null,
    initPromise: null,
    ready: false,
    failed: false,
    channels: 0,
    sampleRate: 0,
    basePts: null,
    startTime: 0,
    bufferedSeconds: 0,
    pending: [],
    warned: false,
  },
  tracks: {
    video: -1,
    audio: -1,
    subtitle: -2, // -2 = none, -1 = auto
  },
  volume: 0.8,
  muted: false,
  playbackSpeed: 1.0,
  audioDelay: 0, // in seconds
  subtitleDelay: 0, // in seconds
  loop: {
    enabled: false,
    startTime: null,
    endTime: null,
  },
  aspectRatio: "auto", // auto, 16:9, 4:3, fill, stretch
  filters: {
    brightness: 100,
    contrast: 100,
    saturation: 100,
  },
};

const loadTrackPrefs = () => {
  try {
    const v = window.localStorage.getItem("v2.videoTrack");
    const a = window.localStorage.getItem("v2.audioTrack");
    const vv = v !== null ? Number.parseInt(v, 10) : -1;
    const aa = a !== null ? Number.parseInt(a, 10) : -1;
    if (Number.isFinite(vv)) {
      state.tracks.video = vv;
    }
    if (Number.isFinite(aa)) {
      state.tracks.audio = aa;
    }
  } catch (err) {}
};

const saveTrackPrefs = () => {
  try {
    window.localStorage.setItem("v2.videoTrack", String(state.tracks.video));
    window.localStorage.setItem("v2.audioTrack", String(state.tracks.audio));
  } catch (err) {}
};

const buildTrackLabel = (stream) => {
  const parts = [`#${stream.index}`];
  if (stream.language) {
    parts.push(stream.language);
  }
  if (stream.codec) {
    parts.push(stream.codec);
  }
  if (stream.title) {
    parts.push(stream.title);
  }
  if (stream.isDefault) {
    parts.push("default");
  }
  return parts.join(" · ");
};

const populateTrackSelects = (payload) => {
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  if (videoTrackSelect) {
    const currentValue = state.tracks.video;
    videoTrackSelect.textContent = "";
    const optAuto = document.createElement("option");
    optAuto.value = "-1";
    optAuto.textContent = "Auto";
    videoTrackSelect.appendChild(optAuto);

    for (const stream of streams) {
      if (!stream || stream.mediaType !== 0) {
        continue;
      }
      const opt = document.createElement("option");
      opt.value = String(stream.index);
      opt.textContent = buildTrackLabel(stream);
      videoTrackSelect.appendChild(opt);
    }

    const hasChoice = videoTrackSelect.querySelector(
      `option[value="${currentValue}"]`
    );
    videoTrackSelect.value = hasChoice ? String(currentValue) : "-1";
    videoTrackSelect.disabled = videoTrackSelect.options.length <= 1;
  }

  if (audioTrackSelect) {
    const currentValue = state.tracks.audio;
    audioTrackSelect.textContent = "";
    const optAuto = document.createElement("option");
    optAuto.value = "-1";
    optAuto.textContent = "Auto";
    audioTrackSelect.appendChild(optAuto);
    const optNone = document.createElement("option");
    optNone.value = "-2";
    optNone.textContent = "None";
    audioTrackSelect.appendChild(optNone);

    for (const stream of streams) {
      if (!stream || stream.mediaType !== 1) {
        continue;
      }
      const opt = document.createElement("option");
      opt.value = String(stream.index);
      opt.textContent = buildTrackLabel(stream);
      audioTrackSelect.appendChild(opt);
    }

    const hasChoice = audioTrackSelect.querySelector(
      `option[value="${currentValue}"]`
    );
    audioTrackSelect.value = hasChoice ? String(currentValue) : "-1";
    audioTrackSelect.disabled = audioTrackSelect.options.length <= 2;
  }

  if (subtitleTrackSelect) {
    const currentValue = state.tracks.subtitle;
    subtitleTrackSelect.textContent = "";
    const optNone = document.createElement("option");
    optNone.value = "-2";
    optNone.textContent = "None";
    subtitleTrackSelect.appendChild(optNone);
    const optAuto = document.createElement("option");
    optAuto.value = "-1";
    optAuto.textContent = "Auto";
    subtitleTrackSelect.appendChild(optAuto);

    for (const stream of streams) {
      if (!stream || stream.mediaType !== 3) {
        continue;
      }
      const opt = document.createElement("option");
      opt.value = String(stream.index);
      opt.textContent = buildTrackLabel(stream);
      subtitleTrackSelect.appendChild(opt);
    }

    const hasChoice = subtitleTrackSelect.querySelector(
      `option[value="${currentValue}"]`
    );
    subtitleTrackSelect.value = hasChoice ? String(currentValue) : "-2";
    subtitleTrackSelect.disabled = subtitleTrackSelect.options.length <= 2;
  }
};

const applyTrackSelection = () => {
  if (!state.worker) {
    return;
  }
  state.worker.postMessage({
    type: "selectStreams",
    videoStreamIndex: state.tracks.video,
    audioStreamIndex: state.tracks.audio,
  });
};

const logLines = [];
const log = (message) => {
  const stamp = new Date().toLocaleTimeString();
  logLines.push(`[${stamp}] ${message}`);
  while (logLines.length > 200) {
    logLines.shift();
  }
  logEl.textContent = logLines.join("\n");
  // Auto-scroll to bottom
  logEl.scrollTop = logEl.scrollHeight;
};

const setStatus = (message) => {
  statusEl.textContent = message;
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const syncOverlayControls = () => {
  if (!overlayPlay || !overlayPause || !overlayStop) {
    return;
  }
  overlayPlay.disabled = startBtn.disabled;
  overlayPause.disabled = pauseBtn.disabled;
  overlayStop.disabled = stopBtn.disabled;

  // Update visibility based on state
  if (state.playing) {
    overlayPlay.style.display = "none";
    overlayPause.style.display = "inline-flex";
  } else {
    overlayPlay.style.display = "inline-flex";
    overlayPause.style.display = "none";
  }
};

const updateFullscreenButton = () => {
  if (overlayFullscreen) {
    // Use an icon or text change
    overlayFullscreen.innerHTML = document.fullscreenElement
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
    overlayFullscreen.title = document.fullscreenElement
      ? "Exit Fullscreen"
      : "Fullscreen";
  }
};

const toggleFullscreen = async () => {
  if (!canvasWrap) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await canvasWrap.requestFullscreen();
    }
  } catch (err) {
    log(`Fullscreen failed: ${err.message}`);
  }
};

const setRenderMode = (mode) => {
  state.renderMode = mode === "webgl" ? "webgl" : "2d";
  canvas2d.classList.toggle("is-hidden", state.renderMode !== "2d");
  canvasGl.classList.toggle("is-hidden", state.renderMode !== "webgl");
  if (state.worker) {
    state.worker.postMessage({ type: "renderMode", mode: state.renderMode });
  }
};

const setSeekEnabled = (enabled, reason) => {
  state.seekEnabled = Boolean(enabled);
  state.seekHint = reason || "";
  if (seekRange) {
    seekRange.disabled = !state.seekEnabled || state.duration === 0;
    if (reason) {
      seekRange.title = reason;
    } else {
      seekRange.removeAttribute("title");
    }
    seekRange.parentElement.classList.toggle("disabled", seekRange.disabled);
  }
};

const setDuration = (seconds) => {
  const duration = seconds > 0 ? seconds : 0;
  state.duration = duration;
  if (seekRange) {
    seekRange.max = duration.toFixed(2);
  }
  if (timeTotalEl) {
    timeTotalEl.textContent = duration > 0 ? formatTime(duration) : "--:--";
  }
};

const updateTimeline = (seconds) => {
  const clamped = Math.max(0, seconds);
  if (!state.scrubbing && timeCurrentEl) {
    timeCurrentEl.textContent = formatTime(clamped);
  }
  if (seekRange && !state.scrubbing) {
    seekRange.value = clamped.toFixed(2);
    // Update progress bar visual if we implement a custom one
    const percent = state.duration > 0 ? (clamped / state.duration) * 100 : 0;
    seekRange.style.setProperty("--seek-progress", `${percent}%`);
  }
};

const resetAudioState = () => {
  state.audio = {
    context: null,
    worklet: null,
    gain: null,
    initPromise: null,
    ready: false,
    failed: false,
    channels: 0,
    sampleRate: 0,
    basePts: null,
    startTime: 0,
    bufferedSeconds: 0,
    pending: [],
    warned: false,
  };
};

const applyGain = () => {
  if (!state.audio.gain) {
    return;
  }
  state.audio.gain.gain.value = state.muted ? 0 : state.volume;
};

const updateVolume = (value) => {
  const volume = Math.max(0, Math.min(1, value));
  state.volume = volume;
  if (volumeValue) volumeValue.textContent = `${Math.round(volume * 100)}%`;
  if (overlayVolume) {
    overlayVolume.value = volume.toString();
    overlayVolume.style.setProperty("--volume-progress", `${volume * 100}%`);
  }
  if (volumeRange) {
    volumeRange.value = volume.toString();
  }
  applyGain();
};

const setMuted = (muted) => {
  state.muted = Boolean(muted);
  if (overlayMute) {
    overlayMute.innerHTML = state.muted
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';
    overlayMute.title = state.muted ? "Unmute" : "Mute";
  }
  applyGain();
};

const getAudioClock = () => {
  if (!state.audio.context || state.audio.basePts === null) {
    return null;
  }
  return state.audio.context.currentTime - state.audio.startTime;
};

const updateAudioDisplay = () => {
  if (state.audio.sampleRate && state.audio.channels) {
    audioInfoEl.textContent = `${state.audio.sampleRate} Hz / ${state.audio.channels} ch`;
  } else {
    audioInfoEl.textContent = "-";
  }
  const clock = getAudioClock();
  audioClockEl.textContent = clock !== null ? `${clock.toFixed(2)}s` : "0.00s";
};

const updateStats = () => {
  frameCountEl.textContent = state.frames.toString();
  bytesCountEl.textContent = formatBytes(state.bytes);
  ptsValueEl.textContent = `${state.pts.toFixed(2)}s`;
  updateAudioDisplay();
};

const syncAudioClock = () => {
  if (state.audio.context && state.audio.basePts !== null) {
    state.audio.startTime =
      state.audio.context.currentTime - state.audio.basePts;
  }
};

const flushAudioQueue = () => {
  if (!state.audio.ready || !state.audio.worklet) {
    return;
  }
  while (state.audio.pending.length) {
    const buffer = state.audio.pending.shift();
    state.audio.worklet.port.postMessage({ type: "push", buffer }, [buffer]);
  }
};

const initAudio = (sampleRate, channels) => {
  if (state.audio.failed) {
    return null;
  }
  if (state.audio.ready) {
    return state.audio.initPromise;
  }
  if (state.audio.initPromise) {
    return state.audio.initPromise;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    state.audio.failed = true;
    log("AudioContext unavailable in this browser.");
    return null;
  }

  state.audio.initPromise = (async () => {
    let audioContext;
    try {
      audioContext = new AudioCtx({ sampleRate });
    } catch (err) {
      log("AudioContext fallback to default sample rate.");
      audioContext = new AudioCtx();
    }

    if (!audioContext.audioWorklet) {
      state.audio.failed = true;
      log("AudioWorklet unavailable; use https:// or http://localhost.");
      try {
        await audioContext.close();
      } catch (err) {
        // ignore
      }
      return null;
    }

    await audioContext.audioWorklet.addModule("audio-worklet.js");
    const worklet = new AudioWorkletNode(audioContext, "ffmpeg-audio");
    const gain = audioContext.createGain();
    gain.gain.value = state.volume;

    worklet.connect(gain).connect(audioContext.destination);
    worklet.port.onmessage = (event) => {
      if (!event.data || event.data.type !== "status") {
        return;
      }
      const available = event.data.available || 0;
      const ch = event.data.channels || state.audio.channels || 2;
      const rate = event.data.sampleRate || audioContext.sampleRate;
      if (rate > 0) {
        state.audio.bufferedSeconds = available / (ch * rate);
      }
    };
    worklet.port.postMessage({ type: "config", channels });

    state.audio.context = audioContext;
    state.audio.worklet = worklet;
    state.audio.gain = gain;
    state.audio.ready = true;
    state.audio.sampleRate = audioContext.sampleRate;
    state.audio.channels = channels;

    syncAudioClock();
    applyGain();
    updateAudioDisplay();

    if (state.playing) {
      await audioContext.resume();
    }

    flushAudioQueue();
    return audioContext;
  })().catch((err) => {
    log(`Audio init failed: ${err.message}`);
    state.audio.initPromise = null;
    state.audio.failed = true;
  });

  return state.audio.initPromise;
};

const queueAudioBuffer = (buffer, pts) => {
  if (!state.audio.ready || !state.audio.worklet) {
    if (state.audio.pending.length < 12) {
      state.audio.pending.push(buffer);
    }
  } else {
    state.audio.worklet.port.postMessage({ type: "push", buffer }, [buffer]);
  }

  if (state.audio.basePts === null && Number.isFinite(pts)) {
    state.audio.basePts = pts;
    syncAudioClock();
  }
};

const clearAudioQueue = () => {
  if (state.audio.worklet) {
    state.audio.worklet.port.postMessage({ type: "clear" });
  }
  state.audio.pending = [];
  state.audio.basePts = null;
  state.audio.startTime = state.audio.context
    ? state.audio.context.currentTime
    : 0;
  updateAudioDisplay();
};

const closeAudio = async () => {
  if (state.audio.worklet) {
    state.audio.worklet.port.postMessage({ type: "clear" });
    state.audio.worklet.disconnect();
  }
  if (state.audio.gain) {
    state.audio.gain.disconnect();
  }
  if (state.audio.context) {
    try {
      await state.audio.context.close();
    } catch (err) {
      // ignore
    }
  }
  resetAudioState();
  updateAudioDisplay();
};

const suspendAudio = () => {
  if (state.audio.context && state.audio.context.state === "running") {
    state.audio.context.suspend().catch(() => {});
  }
};

const resumeAudio = () => {
  if (state.audio.context && state.audio.context.state === "suspended") {
    state.audio.context.resume().catch(() => {});
  }
};

const resetUi = () => {
  state.frames = 0;
  state.bytes = 0;
  state.pts = 0;
  setDuration(0);
  updateTimeline(0);
  resolutionEl.textContent = "-";
  setSeekEnabled(false);
  clearAudioQueue();
  updateStats();
};

const stopPlayback = async () => {
  state.playing = false;
  state.started = false;
  if (state.worker) {
    state.worker.postMessage({ type: "stop" });
  }
  // Close audio context so next file can create one with correct sample rate
  await closeAudio();
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  startBtn.disabled = !state.ready;
  syncOverlayControls();
  resetUi();
  if (videoTrackSelect) {
    videoTrackSelect.disabled = true;
    const opt = videoTrackSelect.querySelector(
      `option[value="${state.tracks.video}"]`
    );
    videoTrackSelect.value = opt ? String(state.tracks.video) : "-1";
  }
  if (audioTrackSelect) {
    audioTrackSelect.disabled = true;
    const opt = audioTrackSelect.querySelector(
      `option[value="${state.tracks.audio}"]`
    );
    audioTrackSelect.value = opt ? String(state.tracks.audio) : "-1";
  }
  if (subtitleTrackSelect) {
    subtitleTrackSelect.disabled = true;
    const opt = subtitleTrackSelect.querySelector(
      `option[value="${state.tracks.subtitle}"]`
    );
    subtitleTrackSelect.value = opt ? String(state.tracks.subtitle) : "-2";
  }
  log("Stopped.");
};

const pausePlayback = () => {
  if (!state.playing) return;
  state.playing = false;
  if (state.worker) {
    state.worker.postMessage({ type: "pause" });
  }
  suspendAudio();
  log("Paused.");
  pauseBtn.disabled = true;
  startBtn.disabled = false;
  syncOverlayControls();
};

const startPlayback = () => {
  if (!state.ready || !state.worker) {
    return;
  }

  const file = fileInput.files && fileInput.files[0];
  const url = urlInput.value.trim();

  if (!state.started) {
    if (!file && !url) {
      log("Choose a file or enter a URL.");
      return;
    }
    const bufferMb = Number.parseInt(bufferSizeInput.value, 10) || 4;
    const bufferBytes = Math.max(1, bufferMb) * 1024 * 1024;
    const formatHint = formatSelect.value.trim();

    state.started = true;
    state.playing = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    startBtn.disabled = true;
    syncOverlayControls();

    // Don't pre-initialize audio - wait for actual audio data to know the real sample rate

    state.worker.postMessage({
      type: "load",
      file: file || null,
      url: file ? null : url || null,
      formatHint: formatHint || "",
      bufferBytes,
      videoStreamIndex: state.tracks.video,
      audioStreamIndex: state.tracks.audio,
    });
  } else {
    state.playing = true;
    pauseBtn.disabled = false;
    startBtn.disabled = true;
    syncOverlayControls();
    state.worker.postMessage({ type: "play" });
  }

  resumeAudio();
};

const performSeek = (seconds) => {
  if (!state.seekEnabled || !state.worker) {
    log("Seek disabled for this source.");
    return;
  }
  const target =
    state.duration > 0
      ? Math.max(0, Math.min(seconds, state.duration))
      : Math.max(0, seconds);
  clearAudioQueue();
  state.pts = target;
  updateTimeline(target);
  updateStats();
  state.worker.postMessage({ type: "seek", seconds: target });
  setStatus("Seeking...");
};

const commitSeekFromUi = () => {
  if (!seekRange) return;
  const value = Number.parseFloat(seekRange.value);
  if (!Number.isFinite(value)) return;
  const now = performance.now();
  if (
    Math.abs(value - state.lastSeekCommitValue) < 0.01 &&
    now - state.lastSeekCommitTs < 200
  ) {
    return;
  }
  state.lastSeekCommitTs = now;
  state.lastSeekCommitValue = value;
  performSeek(value);
};

const initWorker = () => {
  if (!canvas2d.transferControlToOffscreen) {
    setStatus("OffscreenCanvas unsupported");
    log("OffscreenCanvas is required for this demo (Chromium supports it).");
    return;
  }

  const worker = new Worker("ffmpeg-worker.js");
  state.worker = worker;
  worker.onmessage = (event) => {
    const msg = event.data;
    if (!msg || !msg.type) {
      return;
    }

    if (msg.type === "ready") {
      state.ready = true;
      startBtn.disabled = false;
      setStatus("Ready");
      syncOverlayControls();
      return;
    }

    if (msg.type === "status") {
      setStatus(msg.message || "");
      return;
    }

    if (msg.type === "log") {
      log(msg.message || "");
      return;
    }

    if (msg.type === "streams") {
      populateTrackSelects(msg);
      populateSubtitleTracks(msg.streams || []);
      return;
    }

    if (msg.type === "seekInfo") {
      setSeekEnabled(Boolean(msg.enabled), msg.reason || "");
      return;
    }

    if (msg.type === "resolution") {
      const w = msg.width || 0;
      const h = msg.height || 0;
      resolutionEl.textContent = w > 0 && h > 0 ? `${w} x ${h}` : "-";
      return;
    }

    if (msg.type === "stats") {
      state.frames = msg.frames || 0;
      state.bytes = msg.bytes || 0;
      state.pts = Number.isFinite(msg.pts) ? msg.pts : 0;
      if (
        Number.isFinite(msg.duration) &&
        msg.duration > 0 &&
        msg.duration !== state.duration
      ) {
        setDuration(msg.duration);
        if (state.seekEnabled) {
          setSeekEnabled(true, state.seekHint);
        }
      }

      if (
        Number.isFinite(msg.audioSampleRate) &&
        Number.isFinite(msg.audioChannels)
      ) {
        state.audio.sampleRate = msg.audioSampleRate || 0;
        state.audio.channels = msg.audioChannels || 0;
      }

      if (!state.scrubbing) {
        updateTimeline(state.pts);
      }
      updateStats();
      return;
    }

    if (msg.type === "audio") {
      const channels = msg.channels || 2;
      const sampleRate = msg.sampleRate || DEFAULT_AUDIO_RATE;
      const pts = Number.isFinite(msg.pts) ? msg.pts : null;
      if (!state.audio.initPromise && !state.audio.failed) {
        initAudio(sampleRate, channels);
      }
      if (msg.buffer instanceof ArrayBuffer) {
        queueAudioBuffer(msg.buffer, pts);
      }
      return;
    }

    if (msg.type === "audioClear") {
      clearAudioQueue();
      return;
    }

    if (msg.type === "ended") {
      state.playing = false;
      pauseBtn.disabled = true;
      stopBtn.disabled = false;
      startBtn.disabled = false;
      syncOverlayControls();
      setStatus("Ended");
      return;
    }
  };
  worker.onerror = (event) => {
    log(`Worker error: ${event.message || event.type}`);
    setStatus("Worker error");
  };

  // Check if canvases were already transferred (can't transfer twice)
  if (canvas2d._transferred || canvasGl._transferred) {
    setStatus("Canvas already transferred - please refresh the page");
    log("OffscreenCanvas can only be transferred once. Refresh to reset.");
    return;
  }

  const offscreen2d = canvas2d.transferControlToOffscreen();
  const offscreenGl = canvasGl.transferControlToOffscreen();
  canvas2d._transferred = true;
  canvasGl._transferred = true;
  worker.postMessage(
    {
      type: "init",
      canvas2d: offscreen2d,
      canvasGl: offscreenGl,
      renderMode: renderModeSelect.value,
    },
    [offscreen2d, offscreenGl]
  );
};

startBtn.addEventListener("click", () => {
  startPlayback();
});

pauseBtn.addEventListener("click", () => {
  pausePlayback();
});

stopBtn.addEventListener("click", async () => {
  await stopPlayback();
});

if (overlayPlay) {
  overlayPlay.addEventListener("click", () => {
    startPlayback();
  });
}

if (overlayPause) {
  overlayPause.addEventListener("click", () => {
    pausePlayback();
  });
}

if (overlayStop) {
  overlayStop.addEventListener("click", async () => {
    await stopPlayback();
  });
}

if (seekRange) {
  seekRange.addEventListener("input", () => {
    state.scrubbing = true;
    const value = Number.parseFloat(seekRange.value);
    if (Number.isFinite(value)) {
      timeCurrentEl.textContent = formatTime(value);
      // Update progress bar visual
      const percent = state.duration > 0 ? (value / state.duration) * 100 : 0;
      seekRange.style.setProperty("--seek-progress", `${percent}%`);
    }
  });
  seekRange.addEventListener("change", () => {
    state.scrubbing = false;
    commitSeekFromUi();
  });
}

window.addEventListener("pointerup", () => {
  if (!state.scrubbing) {
    return;
  }
  state.scrubbing = false;
  commitSeekFromUi();
});

window.addEventListener("pointercancel", () => {
  if (!state.scrubbing) {
    return;
  }
  state.scrubbing = false;
  commitSeekFromUi();
});

if (overlayMute) {
  overlayMute.addEventListener("click", () => {
    setMuted(!state.muted);
  });
}

if (overlayVolume) {
  overlayVolume.addEventListener("input", () => {
    updateVolume(Number.parseFloat(overlayVolume.value));
  });
}

if (overlayFullscreen) {
  overlayFullscreen.addEventListener("click", () => {
    toggleFullscreen();
  });
}

if (canvasWrap) {
  canvasWrap.addEventListener("dblclick", () => {
    toggleFullscreen();
  });
}

if (videoTrackSelect) {
  videoTrackSelect.addEventListener("change", () => {
    const next = Number.parseInt(videoTrackSelect.value, 10);
    state.tracks.video = Number.isFinite(next) ? next : -1;
    saveTrackPrefs();
    applyTrackSelection();
  });
}

if (audioTrackSelect) {
  audioTrackSelect.addEventListener("change", () => {
    const next = Number.parseInt(audioTrackSelect.value, 10);
    state.tracks.audio = Number.isFinite(next) ? next : -1;
    saveTrackPrefs();
    applyTrackSelection();
  });
}

if (subtitleTrackSelect) {
  subtitleTrackSelect.addEventListener("change", () => {
    const next = Number.parseInt(subtitleTrackSelect.value, 10);
    state.tracks.subtitle = Number.isFinite(next) ? next : -2;
    if (state.worker) {
      state.worker.postMessage({
        type: "selectSubtitle",
        subtitleStreamIndex: state.tracks.subtitle,
      });
    }
  });
}

document.addEventListener("fullscreenchange", () => {
  updateFullscreenButton();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) {
    urlInput.value = "";
    // Update custom file input label if present
    const wrapper = fileInput.closest(".file-input-wrapper");
    if (wrapper) {
      const btn = wrapper.querySelector("button");
      if (btn) btn.textContent = fileInput.files[0].name;
    }
  }
});

urlInput.addEventListener("input", () => {
  if (urlInput.value.trim()) {
    fileInput.value = "";
  }
});

renderModeSelect.addEventListener("change", () => {
  setRenderMode(renderModeSelect.value);
});

volumeRange.addEventListener("input", () => {
  updateVolume(Number.parseFloat(volumeRange.value));
});

// Initialize with some defaults
loadTrackPrefs();
setRenderMode(renderModeSelect.value);
updateVolume(Number.parseFloat(volumeRange.value));
// Ensure initial progress variables are set
if (volumeRange)
  volumeRange.style.setProperty(
    "--volume-progress",
    `${Number.parseFloat(volumeRange.value) * 100}%`
  );
if (overlayVolume)
  overlayVolume.style.setProperty(
    "--volume-progress",
    `${Number.parseFloat(volumeRange.value) * 100}%`
  );

setMuted(false);
setDuration(0);
setSeekEnabled(false);
updateFullscreenButton();
syncOverlayControls();
resetUi();

// ============================================
// NEW FEATURES
// ============================================

// OSD (On-Screen Display) for feedback
let osdTimeout = null;
const showOsd = (message, duration = 1500) => {
  if (!osdEl) return;
  osdEl.textContent = message;
  osdEl.classList.add("visible");
  clearTimeout(osdTimeout);
  osdTimeout = setTimeout(() => {
    osdEl.classList.remove("visible");
  }, duration);
};

// Playback Speed
const setPlaybackSpeed = (speed) => {
  const clamped = Math.max(0.25, Math.min(2.0, speed));
  state.playbackSpeed = clamped;
  if (state.audio.context) {
    // AudioContext playbackRate doesn't exist, we'd need to resample
    // For now, we'll notify the worker to adjust frame timing
  }
  if (state.worker) {
    state.worker.postMessage({ type: "setSpeed", speed: clamped });
  }
  if (speedSelect) speedSelect.value = clamped.toString();
  if (speedDisplay) speedDisplay.textContent = `${clamped}x`;
  showOsd(`Speed: ${clamped}x`);
  log(`Playback speed: ${clamped}x`);
};

const cycleSpeed = (direction) => {
  const currentIdx = PLAYBACK_SPEEDS.indexOf(state.playbackSpeed);
  let newIdx;
  if (currentIdx === -1) {
    newIdx = PLAYBACK_SPEEDS.findIndex((s) => s >= state.playbackSpeed);
    if (newIdx === -1) newIdx = PLAYBACK_SPEEDS.length - 1;
  } else {
    newIdx = currentIdx + direction;
  }
  newIdx = Math.max(0, Math.min(PLAYBACK_SPEEDS.length - 1, newIdx));
  setPlaybackSpeed(PLAYBACK_SPEEDS[newIdx]);
};

if (speedSelect) {
  speedSelect.addEventListener("change", () => {
    setPlaybackSpeed(parseFloat(speedSelect.value));
  });
}

// Screenshot
const takeScreenshot = () => {
  const canvas = state.renderMode === "webgl" ? canvasGl : canvas2d;
  if (!canvas) {
    log("No canvas available for screenshot");
    return;
  }

  // For OffscreenCanvas, we need to request the frame from the worker
  if (state.worker) {
    state.worker.postMessage({ type: "screenshot" });
  }
  showOsd("Screenshot captured!");
};

// Handle screenshot response from worker
const handleScreenshotData = (dataUrl) => {
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.download = `screenshot-${timestamp}.png`;
  link.href = dataUrl;
  link.click();
  log("Screenshot saved");
};

if (screenshotBtn) {
  screenshotBtn.addEventListener("click", takeScreenshot);
}

// Audio Delay
const setAudioDelay = (seconds) => {
  const clamped = Math.max(-5, Math.min(5, seconds));
  state.audioDelay = clamped;
  // Adjust the audio base PTS to shift audio timing
  if (state.audio.basePts !== null) {
    state.audio.basePts += clamped - state.audioDelay;
    syncAudioClock();
  }
  if (audioDelayInput) audioDelayInput.value = (clamped * 1000).toString();
  if (audioDelayValue)
    audioDelayValue.textContent = `${(clamped * 1000).toFixed(0)}ms`;
  showOsd(`Audio delay: ${(clamped * 1000).toFixed(0)}ms`);
};

const adjustAudioDelay = (deltaMs) => {
  setAudioDelay(state.audioDelay + deltaMs / 1000);
};

if (audioDelayInput) {
  audioDelayInput.addEventListener("input", () => {
    const ms = parseInt(audioDelayInput.value, 10) || 0;
    setAudioDelay(ms / 1000);
  });
}

// Subtitle Track Selection
const populateSubtitleTracks = (streams) => {
  if (!subtitleTrackSelect) return;
  subtitleTrackSelect.textContent = "";

  const optNone = document.createElement("option");
  optNone.value = "-2";
  optNone.textContent = "None";
  subtitleTrackSelect.appendChild(optNone);

  const optAuto = document.createElement("option");
  optAuto.value = "-1";
  optAuto.textContent = "Auto";
  subtitleTrackSelect.appendChild(optAuto);

  for (const stream of streams) {
    if (!stream || stream.mediaType !== 2) continue; // 2 = subtitle
    const opt = document.createElement("option");
    opt.value = String(stream.index);
    opt.textContent = buildTrackLabel(stream);
    subtitleTrackSelect.appendChild(opt);
  }

  subtitleTrackSelect.value = String(state.tracks.subtitle);
  subtitleTrackSelect.disabled = subtitleTrackSelect.options.length <= 2;
};

if (subtitleTrackSelect) {
  subtitleTrackSelect.addEventListener("change", () => {
    state.tracks.subtitle = parseInt(subtitleTrackSelect.value, 10);
    if (state.worker) {
      state.worker.postMessage({
        type: "selectSubtitle",
        subtitleStreamIndex: state.tracks.subtitle,
      });
    }
  });
}

// Subtitle Delay
const setSubtitleDelay = (seconds) => {
  const clamped = Math.max(-5, Math.min(5, seconds));
  state.subtitleDelay = clamped;
  if (state.worker) {
    state.worker.postMessage({ type: "setSubtitleDelay", delay: clamped });
  }
  if (subtitleDelayInput)
    subtitleDelayInput.value = (clamped * 1000).toString();
  if (subtitleDelayValue)
    subtitleDelayValue.textContent = `${(clamped * 1000).toFixed(0)}ms`;
  showOsd(`Subtitle delay: ${(clamped * 1000).toFixed(0)}ms`);
};

const adjustSubtitleDelay = (deltaMs) => {
  setSubtitleDelay(state.subtitleDelay + deltaMs / 1000);
};

if (subtitleDelayInput) {
  subtitleDelayInput.addEventListener("input", () => {
    const ms = parseInt(subtitleDelayInput.value, 10) || 0;
    setSubtitleDelay(ms / 1000);
  });
}

// A-B Loop
const setLoopStart = () => {
  state.loop.startTime = state.pts;
  updateLoopDisplay();
  showOsd(`Loop start: ${formatTime(state.loop.startTime)}`);
};

const setLoopEnd = () => {
  state.loop.endTime = state.pts;
  if (
    state.loop.startTime !== null &&
    state.loop.endTime < state.loop.startTime
  ) {
    // Swap if end is before start
    [state.loop.startTime, state.loop.endTime] = [
      state.loop.endTime,
      state.loop.startTime,
    ];
  }
  updateLoopDisplay();
  showOsd(`Loop end: ${formatTime(state.loop.endTime)}`);
};

const toggleLoop = () => {
  if (state.loop.startTime === null || state.loop.endTime === null) {
    showOsd("Set loop points first (A/B keys)");
    return;
  }
  state.loop.enabled = !state.loop.enabled;
  if (loopToggle) loopToggle.classList.toggle("active", state.loop.enabled);
  updateLoopDisplay();
  showOsd(state.loop.enabled ? "Loop enabled" : "Loop disabled");
};

const clearLoop = () => {
  state.loop.enabled = false;
  state.loop.startTime = null;
  state.loop.endTime = null;
  if (loopToggle) loopToggle.classList.remove("active");
  updateLoopDisplay();
  showOsd("Loop cleared");
};

const updateLoopDisplay = () => {
  if (!loopDisplay) return;
  if (state.loop.startTime !== null && state.loop.endTime !== null) {
    loopDisplay.textContent = `${formatTime(
      state.loop.startTime
    )} - ${formatTime(state.loop.endTime)}`;
  } else if (state.loop.startTime !== null) {
    loopDisplay.textContent = `${formatTime(state.loop.startTime)} - ?`;
  } else {
    loopDisplay.textContent = "Not set";
  }
};

const checkLoopBoundary = () => {
  if (
    !state.loop.enabled ||
    state.loop.startTime === null ||
    state.loop.endTime === null
  ) {
    return;
  }
  if (state.pts >= state.loop.endTime) {
    performSeek(state.loop.startTime);
  }
};

if (loopStartBtn) loopStartBtn.addEventListener("click", setLoopStart);
if (loopEndBtn) loopEndBtn.addEventListener("click", setLoopEnd);
if (loopToggle) loopToggle.addEventListener("click", toggleLoop);

// Aspect Ratio
const setAspectRatio = (ratio) => {
  state.aspectRatio = ratio;
  if (aspectRatioSelect) aspectRatioSelect.value = ratio;

  const container = canvasWrap;
  if (!container) return;

  // Remove all aspect ratio classes
  container.classList.remove(
    "aspect-auto",
    "aspect-16-9",
    "aspect-4-3",
    "aspect-fill",
    "aspect-stretch"
  );
  container.classList.add(
    `aspect-${ratio.replace(":", "-").replace("/", "-")}`
  );

  showOsd(`Aspect ratio: ${ratio}`);
};

if (aspectRatioSelect) {
  aspectRatioSelect.addEventListener("change", () => {
    setAspectRatio(aspectRatioSelect.value);
  });
}

// Video Filters
const applyFilters = () => {
  const container = canvasWrap;
  if (!container) return;

  const { brightness, contrast, saturation } = state.filters;
  container.style.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
};

const setFilter = (name, value) => {
  const clamped = Math.max(0, Math.min(200, value));
  state.filters[name] = clamped;
  applyFilters();

  const input = document.getElementById(`${name}Input`);
  const valueEl = document.getElementById(`${name}Value`);
  if (input) input.value = clamped.toString();
  if (valueEl) valueEl.textContent = `${clamped}%`;
};

const resetFilters = () => {
  state.filters = { brightness: 100, contrast: 100, saturation: 100 };
  applyFilters();
  if (brightnessInput) brightnessInput.value = "100";
  if (contrastInput) contrastInput.value = "100";
  if (saturationInput) saturationInput.value = "100";
  document
    .querySelectorAll(".filter-value")
    .forEach((el) => (el.textContent = "100%"));
  showOsd("Filters reset");
};

if (brightnessInput) {
  brightnessInput.addEventListener("input", () => {
    setFilter("brightness", parseInt(brightnessInput.value, 10));
  });
}
if (contrastInput) {
  contrastInput.addEventListener("input", () => {
    setFilter("contrast", parseInt(contrastInput.value, 10));
  });
}
if (saturationInput) {
  saturationInput.addEventListener("input", () => {
    setFilter("saturation", parseInt(saturationInput.value, 10));
  });
}
if (filtersReset) {
  filtersReset.addEventListener("click", resetFilters);
}

// Frame Stepping
const frameStep = (direction) => {
  if (!state.worker || !state.started) return;

  // Pause playback for frame stepping
  if (state.playing) {
    pausePlayback();
  }

  state.worker.postMessage({ type: "frameStep", direction });
  showOsd(direction > 0 ? "Frame →" : "← Frame");
};

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
document.addEventListener("keydown", (e) => {
  // Don't handle shortcuts when typing in inputs
  if (
    e.target.tagName === "INPUT" ||
    e.target.tagName === "TEXTAREA" ||
    e.target.tagName === "SELECT"
  ) {
    return;
  }

  const key = e.key.toLowerCase();
  const shift = e.shiftKey;
  const ctrl = e.ctrlKey || e.metaKey;

  switch (key) {
    // Play/Pause
    case " ":
    case "k":
      e.preventDefault();
      if (state.playing) {
        pausePlayback();
      } else {
        startPlayback();
      }
      break;

    // Seek
    case "arrowleft":
      e.preventDefault();
      if (state.seekEnabled) {
        performSeek(state.pts - (shift ? 30 : 5));
        showOsd(shift ? "-30s" : "-5s");
      }
      break;
    case "arrowright":
      e.preventDefault();
      if (state.seekEnabled) {
        performSeek(state.pts + (shift ? 30 : 5));
        showOsd(shift ? "+30s" : "+5s");
      }
      break;
    case "j":
      e.preventDefault();
      if (shift) {
        adjustAudioDelay(-100);
      } else if (state.seekEnabled) {
        performSeek(state.pts - 10);
        showOsd("-10s");
      }
      break;
    case "l":
      e.preventDefault();
      if (shift) {
        adjustAudioDelay(100);
      } else if (state.seekEnabled) {
        performSeek(state.pts + 10);
        showOsd("+10s");
      }
      break;

    // Volume
    case "arrowup":
      e.preventDefault();
      updateVolume(state.volume + 0.05);
      showOsd(`Volume: ${Math.round(state.volume * 100)}%`);
      break;
    case "arrowdown":
      e.preventDefault();
      updateVolume(state.volume - 0.05);
      showOsd(`Volume: ${Math.round(state.volume * 100)}%`);
      break;
    case "m":
      e.preventDefault();
      setMuted(!state.muted);
      showOsd(state.muted ? "Muted" : "Unmuted");
      break;

    // Fullscreen
    case "f":
      e.preventDefault();
      toggleFullscreen();
      break;

    // Screenshot
    case "s":
      if (!ctrl) {
        e.preventDefault();
        takeScreenshot();
      }
      break;

    // Frame stepping
    case ".":
    case ">":
      e.preventDefault();
      frameStep(1);
      break;
    case ",":
    case "<":
      e.preventDefault();
      frameStep(-1);
      break;

    // Playback speed
    case "[":
      e.preventDefault();
      cycleSpeed(-1);
      break;
    case "]":
      e.preventDefault();
      cycleSpeed(1);
      break;
    case "\\":
      e.preventDefault();
      setPlaybackSpeed(1.0);
      break;

    // Subtitle delay
    case "z":
      e.preventDefault();
      adjustSubtitleDelay(-100);
      break;
    case "x":
      e.preventDefault();
      adjustSubtitleDelay(100);
      break;

    // A-B Loop
    case "a":
      if (!ctrl) {
        e.preventDefault();
        setLoopStart();
      }
      break;
    case "b":
      e.preventDefault();
      setLoopEnd();
      break;
    case "p":
      e.preventDefault();
      toggleLoop();
      break;
    case "c":
      if (!ctrl) {
        e.preventDefault();
        clearLoop();
      }
      break;

    // Stop
    case "escape":
      e.preventDefault();
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (state.started) {
        stopPlayback();
      }
      break;

    // Jump to percentage (0-9)
    case "0":
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7":
    case "8":
    case "9":
      if (!ctrl && state.seekEnabled && state.duration > 0) {
        e.preventDefault();
        const percent = parseInt(key, 10) / 10;
        performSeek(state.duration * percent);
        showOsd(`${percent * 100}%`);
      }
      break;
  }
});

// Handle screenshot data from worker
const originalOnMessage = state.worker ? state.worker.onmessage : null;

setStatus("Initializing worker...");
initWorker();

// After worker init, patch the message handler
setTimeout(() => {
  if (state.worker) {
    const existingHandler = state.worker.onmessage;
    state.worker.onmessage = (event) => {
      const msg = event.data;
      if (msg && msg.type === "screenshot") {
        handleScreenshotData(msg.dataUrl);
        return;
      }
      if (msg && msg.type === "stats") {
        // Check loop boundary
        checkLoopBoundary();
      }
      if (existingHandler) existingHandler(event);
    };
  }
}, 100);
