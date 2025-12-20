import { useEffect, useRef, useState } from "react";
import "./App.css";

const DEFAULT_AUDIO_RATE = 48000;

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
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

function App() {
  const [status, setStatus] = useState("Initializing worker...");
  const [logText, setLogText] = useState("");
  const [stats, setStats] = useState({
    frames: 0,
    bytes: 0,
    resolution: "-",
    pts: "0.00s",
    currentTime: 0,
    duration: 0,
    timeCurrent: "0:00",
    timeTotal: "--:--",
    audioInfo: "-",
    audioClock: "0.00s",
  });
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [renderMode, setRenderMode] = useState("2d");
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [seekEnabled, setSeekEnabled] = useState(false);
  const [seekHint, setSeekHint] = useState("");
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const canvas2dRef = useRef(null);
  const canvasGlRef = useRef(null);
  const playerRef = useRef(null);
  const fileRef = useRef(null);
  const urlRef = useRef(null);
  const formatRef = useRef(null);
  const bufferRef = useRef(null);

  const workerRef = useRef(null);
  const startedRef = useRef(false);
  const logLinesRef = useRef([]);
  const scrubbingRef = useRef(false);
  const seekValueRef = useRef(0);
  const performSeekRef = useRef(null);
  const mutedRef = useRef(isMuted);
  const volumeRef = useRef(volume);

  const videoRef = useRef({
    frames: 0,
    bytes: 0,
    pts: 0,
    duration: 0,
    resolution: "-",
    seeking: false,
  });

  const audioRef = useRef({
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
  });

  const log = (message) => {
    const stamp = new Date().toLocaleTimeString();
    logLinesRef.current.push(`[${stamp}] ${message}`);
    if (logLinesRef.current.length > 200) {
      logLinesRef.current.shift();
    }
    setLogText(logLinesRef.current.join("\n"));
  };

  const getAudioClock = () => {
    const audio = audioRef.current;
    if (!audio.context || audio.basePts === null) {
      return null;
    }
    return audio.context.currentTime - audio.startTime;
  };

  const syncAudioClock = () => {
    const audio = audioRef.current;
    if (audio.context && audio.basePts !== null) {
      audio.startTime = audio.context.currentTime - audio.basePts;
    }
  };

  const applyGain = () => {
    const audio = audioRef.current;
    if (!audio.gain) return;
    audio.gain.gain.value = mutedRef.current ? 0 : volumeRef.current;
  };

  const flushAudioQueue = () => {
    const audio = audioRef.current;
    if (!audio.ready || !audio.worklet) {
      return;
    }
    while (audio.pending.length) {
      const buffer = audio.pending.shift();
      audio.worklet.port.postMessage({ type: "push", buffer }, [buffer]);
    }
  };

  const initAudio = (sampleRate, channels) => {
    const audio = audioRef.current;
    if (audio.failed) {
      return null;
    }
    if (audio.ready) {
      return audio.initPromise;
    }
    if (audio.initPromise) {
      return audio.initPromise;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      audio.failed = true;
      log("AudioContext unavailable in this browser.");
      return null;
    }

    audio.initPromise = (async () => {
      let audioContext;
      try {
        audioContext = new AudioCtx({ sampleRate });
      } catch {
        log("AudioContext fallback to default sample rate.");
        audioContext = new AudioCtx();
      }

      if (!audioContext.audioWorklet) {
        audio.failed = true;
        log("AudioWorklet unavailable; use https:// or http://localhost.");
        try {
          await audioContext.close();
        } catch {
          // ignore close errors
        }
        return null;
      }

      await audioContext.audioWorklet.addModule("/audio-worklet.js");
      const worklet = new AudioWorkletNode(audioContext, "ffmpeg-audio");
      const gain = audioContext.createGain();
      gain.gain.value = mutedRef.current ? 0 : volumeRef.current;

      worklet.connect(gain).connect(audioContext.destination);
      worklet.port.onmessage = (event) => {
        if (!event.data || event.data.type !== "status") {
          return;
        }
        const available = event.data.available || 0;
        const ch = event.data.channels || audio.channels || 2;
        const rate = event.data.sampleRate || audioContext.sampleRate;
        if (rate > 0) {
          audio.bufferedSeconds = available / (ch * rate);
        }
      };

      worklet.port.postMessage({ type: "config", channels });

      audio.context = audioContext;
      audio.worklet = worklet;
      audio.gain = gain;
      audio.ready = true;
      audio.sampleRate = audioContext.sampleRate;
      audio.channels = channels;

      syncAudioClock();
      applyGain();
      flushAudioQueue();

      try {
        await audioContext.resume();
      } catch {
        // resume can fail without user activation; caller will retry on play
      }

      return audioContext;
    })().catch((err) => {
      log(`Audio init failed: ${err.message}`);
      audioRef.current.initPromise = null;
      audioRef.current.failed = true;
    });

    return audio.initPromise;
  };

  const queueAudioBuffer = (buffer, pts) => {
    const audio = audioRef.current;
    if (audio.ready && audio.worklet) {
      audio.worklet.port.postMessage({ type: "push", buffer }, [buffer]);
    } else if (audio.pending.length < 12) {
      audio.pending.push(buffer);
    }

    if (audio.basePts === null && Number.isFinite(pts)) {
      audio.basePts = pts;
      syncAudioClock();
    }
  };

  const clearAudioQueue = () => {
    const audio = audioRef.current;
    if (audio.worklet) {
      audio.worklet.port.postMessage({ type: "clear" });
    }
    audio.pending = [];
    audio.basePts = null;
    audio.startTime = audio.context ? audio.context.currentTime : 0;
  };

  const suspendAudio = () => {
    const audio = audioRef.current;
    if (audio.context && audio.context.state === "running") {
      audio.context.suspend().catch(() => {});
    }
  };

  const resumeAudio = () => {
    const audio = audioRef.current;
    if (audio.context && audio.context.state === "suspended") {
      audio.context.resume().catch(() => {});
    }
  };

  const closeAudio = async () => {
    const audio = audioRef.current;
    if (audio.worklet) {
      audio.worklet.port.postMessage({ type: "clear" });
      audio.worklet.disconnect();
    }
    if (audio.gain) {
      audio.gain.disconnect();
    }
    if (audio.context) {
      try {
        await audio.context.close();
      } catch {
        // ignore close errors
      }
    }
    audioRef.current = {
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

  const updateStats = () => {
    const audio = audioRef.current;
    const video = videoRef.current;
    const audioInfo = audio.sampleRate && audio.channels
      ? `${audio.sampleRate} Hz / ${audio.channels} ch`
      : "-";
    const audioClock = getAudioClock();
    const timeCurrent = formatTime(video.pts);
    const timeTotal = video.duration > 0 ? formatTime(video.duration) : "--:--";
    setStats({
      frames: video.frames,
      bytes: video.bytes,
      resolution: video.resolution || "-",
      pts: `${video.pts.toFixed(2)}s`,
      currentTime: video.pts,
      duration: video.duration,
      timeCurrent,
      timeTotal,
      audioInfo,
      audioClock: audioClock !== null ? `${audioClock.toFixed(2)}s` : "0.00s",
    });
    if (!scrubbingRef.current) {
      setSeekValue(video.pts);
    }
  };

  const resetUi = () => {
    videoRef.current = {
      frames: 0,
      bytes: 0,
      pts: 0,
      duration: 0,
      resolution: "-",
      seeking: false,
    };
    setSeekValue(0);
    setSeekEnabled(false);
    setSeekHint("");
    updateStats();
  };

  const toggleFullscreen = async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await player.requestFullscreen();
      }
    } catch (err) {
      log(`Fullscreen failed: ${err.message}`);
    }
  };

  const startPlayback = () => {
    const worker = workerRef.current;
    if (!ready || !worker) {
      return;
    }

    const file = fileRef.current?.files?.[0] || null;
    const url = urlRef.current?.value?.trim() || "";
    if (!startedRef.current) {
      if (!file && !url) {
        log("Choose a file or enter a URL.");
        return;
      }

      const bufferMb = Number.parseInt(bufferRef.current?.value, 10) || 4;
      const bufferBytes = Math.max(1, bufferMb) * 1024 * 1024;
      const formatHint = formatRef.current?.value?.trim() || "";

      startedRef.current = true;
      setPlaying(true);
      setStatus("Starting...");
      if (!audioRef.current.initPromise && !audioRef.current.failed) {
        initAudio(DEFAULT_AUDIO_RATE, 2);
      }
      worker.postMessage({
        type: "load",
        file: file || null,
        url: file ? null : url || null,
        formatHint,
        bufferBytes,
      });
    } else {
      setPlaying(true);
      worker.postMessage({ type: "play" });
    }

    resumeAudio();
  };

  const pausePlayback = () => {
    const worker = workerRef.current;
    if (!worker) return;
    if (!playing) return;
    setPlaying(false);
    worker.postMessage({ type: "pause" });
    suspendAudio();
    log("Paused.");
  };

  const stopPlayback = () => {
    const worker = workerRef.current;
    if (!worker) return;
    startedRef.current = false;
    setPlaying(false);
    setStatus("Ready");
    worker.postMessage({ type: "stop" });
    suspendAudio();
    clearAudioQueue();
    resetUi();
    log("Stopped.");
  };

  const performSeek = (seconds) => {
    const worker = workerRef.current;
    if (!worker || !seekEnabled) {
      log("Seek disabled for this source.");
      return;
    }
    const target = Math.max(0, Math.min(seconds, videoRef.current.duration || seconds));
    clearAudioQueue();
    videoRef.current.pts = target;
    updateStats();
    setSeekValue(target);
    setStatus("Seeking...");
    worker.postMessage({ type: "seek", seconds: target });
  };

  const handleSeekInput = (event) => {
    const value = Number.parseFloat(event.target.value);
    scrubbingRef.current = true;
    setIsScrubbing(true);
    if (Number.isFinite(value)) {
      seekValueRef.current = value;
      setSeekValue(value);
    }
  };

  const commitSeek = () => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setIsScrubbing(false);
    performSeek(seekValueRef.current);
  };

  useEffect(() => {
    mutedRef.current = isMuted;
    applyGain();
  }, [isMuted]);

  useEffect(() => {
    volumeRef.current = volume;
    applyGain();
  }, [volume]);

  useEffect(() => {
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({ type: "renderMode", mode: renderMode });
    }
  }, [renderMode]);

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
    };
  }, []);

  useEffect(() => {
    performSeekRef.current = performSeek;
  });

  useEffect(() => {
    if (!isScrubbing) {
      return () => {};
    }
    const commit = () => {
      if (!scrubbingRef.current) {
        return;
      }
      scrubbingRef.current = false;
      setIsScrubbing(false);
      performSeekRef.current?.(seekValueRef.current);
    };
    window.addEventListener("pointerup", commit);
    window.addEventListener("pointercancel", commit);
    return () => {
      window.removeEventListener("pointerup", commit);
      window.removeEventListener("pointercancel", commit);
    };
  }, [isScrubbing]);

  useEffect(() => {
    const canvas2d = canvas2dRef.current;
    const canvasGl = canvasGlRef.current;
    if (!canvas2d || !canvasGl) {
      return () => {};
    }
    if (!canvas2d.transferControlToOffscreen || !canvasGl.transferControlToOffscreen) {
      setStatus("OffscreenCanvas unsupported");
      log("OffscreenCanvas is required for this demo (Chromium supports it).");
      return () => {};
    }

    const worker = new Worker("/ffmpeg-worker.js");
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const msg = event.data;
      if (!msg || !msg.type) {
        return;
      }

      if (msg.type === "ready") {
        setReady(true);
        setStatus("Ready");
        log("Module ready.");
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
        setSeekEnabled(Boolean(msg.enabled));
        setSeekHint(msg.reason || "");
        return;
      }
      if (msg.type === "resolution") {
        const w = msg.width || 0;
        const h = msg.height || 0;
        videoRef.current.resolution = w > 0 && h > 0 ? `${w} x ${h}` : "-";
        updateStats();
        return;
      }
      if (msg.type === "stats") {
        videoRef.current.frames = msg.frames || 0;
        videoRef.current.bytes = msg.bytes || 0;
        videoRef.current.pts = Number.isFinite(msg.pts) ? msg.pts : 0;
        if (Number.isFinite(msg.duration) && msg.duration > 0) {
          videoRef.current.duration = msg.duration;
        }
        if (Number.isFinite(msg.audioSampleRate) && msg.audioSampleRate > 0) {
          audioRef.current.sampleRate = msg.audioSampleRate;
        }
        if (Number.isFinite(msg.audioChannels) && msg.audioChannels > 0) {
          audioRef.current.channels = msg.audioChannels;
        }
        updateStats();
        return;
      }
      if (msg.type === "audio") {
        const channels = msg.channels || 2;
        const sampleRate = msg.sampleRate || DEFAULT_AUDIO_RATE;
        const pts = Number.isFinite(msg.pts) ? msg.pts : null;
        if (!audioRef.current.initPromise && !audioRef.current.failed) {
          initAudio(sampleRate, channels);
        }
        audioRef.current.channels = channels;
        audioRef.current.sampleRate = sampleRate;
        if (msg.buffer instanceof ArrayBuffer) {
          queueAudioBuffer(msg.buffer, pts);
          updateStats();
        }
        return;
      }
      if (msg.type === "audioClear") {
        clearAudioQueue();
        updateStats();
        return;
      }
      if (msg.type === "ended") {
        setPlaying(false);
        setStatus("Ended");
        return;
      }
    };

    worker.onerror = (event) => {
      log(`Worker error: ${event.message || event.type}`);
      setStatus("Worker error");
    };

    const offscreen2d = canvas2d.transferControlToOffscreen();
    const offscreenGl = canvasGl.transferControlToOffscreen();
    worker.postMessage(
      { type: "init", canvas2d: offscreen2d, canvasGl: offscreenGl, renderMode },
      [offscreen2d, offscreenGl],
    );

    return () => {
      worker.terminate();
      workerRef.current = null;
      closeAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="app">
      <header className="hero">
        <div>
          <h1>FFmpeg WASM Matroska Player</h1>
          <p>React demo with audio worklet playback.</p>
        </div>
        <div className="status">{status}</div>
      </header>

      <section className="panel grid">
        <div className="field">
          <label htmlFor="fileInput">Local file</label>
          <input
            id="fileInput"
            type="file"
            accept="video/*"
            ref={fileRef}
            onChange={() => {
              if (urlRef.current) urlRef.current.value = "";
            }}
          />
          <span className="hint">Matroska (MKV) recommended.</span>
        </div>
        <div className="field">
          <label htmlFor="urlInput">Stream URL (CORS required)</label>
          <input
            id="urlInput"
            type="url"
            placeholder="https://example.com/video.mkv"
            ref={urlRef}
            onInput={() => {
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <span className="hint">Uses fetch streaming; same-origin or CORS.</span>
        </div>
        <div className="field">
          <label htmlFor="formatSelect">Container hint</label>
          <select id="formatSelect" defaultValue="matroska" ref={formatRef}>
            <option value="">Auto detect</option>
            <option value="mov">MP4 / QuickTime (mov)</option>
            <option value="matroska">Matroska / WebM</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="renderMode">Render mode</label>
          <select
            id="renderMode"
            value={renderMode}
            onChange={(event) => setRenderMode(event.target.value)}
          >
            <option value="2d">Canvas 2D</option>
            <option value="webgl">WebGL (optional)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="bufferSize">Initial buffer (MB)</label>
          <input
            id="bufferSize"
            type="number"
            min="1"
            max="64"
            defaultValue="4"
            ref={bufferRef}
          />
        </div>
        <div className="field">
          <label htmlFor="volumeRange">Volume</label>
          <div className="range-row">
            <input
              id="volumeRange"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(event) => setVolume(Number.parseFloat(event.target.value))}
            />
            <span>{Math.round(volume * 100)}%</span>
          </div>
        </div>
      </section>

      <section className="panel actions">
        <button onClick={startPlayback} disabled={!ready || playing}>
          Start
        </button>
        <button onClick={pausePlayback} disabled={!playing}>
          Pause
        </button>
        <button className="stop" onClick={stopPlayback} disabled={!ready}>
          Stop
        </button>
      </section>

      <section className="player" ref={playerRef}>
        <div className="canvas-wrap" onDoubleClick={toggleFullscreen}>
          <canvas
            ref={canvas2dRef}
            className={renderMode === "2d" ? "" : "is-hidden"}
          ></canvas>
          <canvas
            ref={canvasGlRef}
            className={renderMode === "webgl" ? "" : "is-hidden"}
          ></canvas>
          <div className="canvas-controls">
            <div className="controls-left">
              <button onClick={startPlayback} disabled={!ready || playing}>
                Play
              </button>
              <button onClick={pausePlayback} disabled={!playing}>
                Pause
              </button>
              <button className="danger" onClick={stopPlayback} disabled={!ready}>
                Stop
              </button>
            </div>
            <div className="controls-center">
              <span>{isScrubbing ? formatTime(seekValue) : stats.timeCurrent}</span>
              <input
                type="range"
                min="0"
                max={(stats.duration || 0).toFixed(2)}
                step="0.01"
                value={seekValue}
                disabled={!seekEnabled || stats.duration === 0}
                title={seekHint}
                onChange={handleSeekInput}
                onMouseUp={commitSeek}
                onTouchEnd={commitSeek}
              />
              <span>{stats.timeTotal}</span>
            </div>
            <div className="controls-right">
              <button onClick={() => setIsMuted((prev) => !prev)}>
                {isMuted ? "Unmute" : "Mute"}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(event) => setVolume(Number.parseFloat(event.target.value))}
              />
              <button onClick={toggleFullscreen}>
                {isFullscreen ? "Exit" : "Full"}
              </button>
            </div>
          </div>
        </div>
        <div className="stats">
          <div>
            <span className="label">Resolution</span>
            <span>{stats.resolution}</span>
          </div>
          <div>
            <span className="label">Frames</span>
            <span>{stats.frames}</span>
          </div>
          <div>
            <span className="label">Buffered</span>
            <span>{formatBytes(stats.bytes)}</span>
          </div>
          <div>
            <span className="label">PTS</span>
            <span>{stats.pts}</span>
          </div>
          <div>
            <span className="label">Audio</span>
            <span>{stats.audioInfo}</span>
          </div>
          <div>
            <span className="label">Audio clock</span>
            <span>{stats.audioClock}</span>
          </div>
        </div>
        <pre aria-live="polite">{logText}</pre>
      </section>
    </main>
  );
}

export default App;
