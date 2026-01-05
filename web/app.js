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
const logEl = document.getElementById("log");
const resolutionEl = document.getElementById("resolution");
const frameCountEl = document.getElementById("frameCount");
const bytesCountEl = document.getElementById("bytesCount");
const ptsValueEl = document.getElementById("ptsValue");
const audioInfoEl = document.getElementById("audioInfo");
const audioClockEl = document.getElementById("audioClock");

const DEFAULT_AUDIO_RATE = 48000;

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
  volume: 0.8,
  muted: false,
};

const logLines = [];
const log = (message) => {
  const stamp = new Date().toLocaleTimeString();
  logLines.push(`[${stamp}] ${message}`);
  while (logLines.length > 200) {
    logLines.shift();
  }
  logEl.textContent = logLines.join("\n");
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
};

const updateFullscreenButton = () => {
  if (overlayFullscreen) {
    overlayFullscreen.textContent = document.fullscreenElement
      ? "Exit"
      : "Full";
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
  volumeValue.textContent = `${Math.round(volume * 100)}%`;
  if (overlayVolume) {
    overlayVolume.value = volume.toString();
  }
  if (volumeRange) {
    volumeRange.value = volume.toString();
  }
  applyGain();
};

const setMuted = (muted) => {
  state.muted = Boolean(muted);
  if (overlayMute) {
    overlayMute.textContent = state.muted ? "Unmute" : "Mute";
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

document.addEventListener("fullscreenchange", () => {
  updateFullscreenButton();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) {
    urlInput.value = "";
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

setRenderMode(renderModeSelect.value);
updateVolume(Number.parseFloat(volumeRange.value));
setMuted(false);
setDuration(0);
setSeekEnabled(false);
updateFullscreenButton();
syncOverlayControls();
resetUi();

setStatus("Initializing worker...");
initWorker();
