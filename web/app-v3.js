const APP_ASSET_VERSION = "20260513-seek-preroll";
const versionedAssetUrl = (path) => {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(APP_ASSET_VERSION)}`;
};

const statusEl = document.getElementById("status");
const fileInput = document.getElementById("fileInput");
const urlInput = document.getElementById("urlInput");
const sourceLauncher = document.getElementById("sourceLauncher");
const sourceFileBtn = document.getElementById("sourceFileBtn");
const sourceUrlForm = document.getElementById("sourceUrlForm");
const sourceUrlInput = document.getElementById("sourceUrlInput");
// const formatSelect = document.getElementById("formatSelect"); // Removed in v3
// const renderModeSelect = document.getElementById("renderMode"); // Removed in v3
const bufferSizeInput = document.getElementById("bufferSizeInput"); // ID changed or kept
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const overlayPlay = document.getElementById("overlayPlay");
const overlayPause = document.getElementById("overlayPause");
const overlayPlayPause = document.getElementById("overlayPlayPause"); // if unified
const overlayStop = document.getElementById("overlayStop"); // Removed in v3 UI but logic might remain? No, logic uses overlayPlay/Pause.
const seekRange = document.getElementById("seekRange");
const timeCurrentEl = document.getElementById("timeCurrent");
const timeTotalEl = document.getElementById("timeTotal");
const overlayMute = document.getElementById("overlayMute");
const overlayVolume = document.getElementById("overlayVolume");
const overlayFullscreen = document.getElementById("overlayFullscreen");
let canvas2d = document.getElementById("canvas2d");
let canvasGl = document.getElementById("canvasGl");
const canvasWrap = document.getElementById("canvasWrap");
const playerEl = document.getElementById("player");
const logEl = document.getElementById("log");
const resolutionEl = document.getElementById("resolution");
const frameCountEl = document.getElementById("frameCount");
const bytesCountEl = document.getElementById("bytesCount");
const ptsValueEl = document.getElementById("ptsValue");
const audioInfoEl = document.getElementById("audioInfo");
const audioClockEl = document.getElementById("audioClock"); // Not in v3 HTML? removed or forgot. Added implicitly or removed? It was in v2. It's fine if missing.
const osdEl = document.getElementById("osd");
const sourceOverlay = document.getElementById("sourceOverlay");
const sourceTitleEl = document.getElementById("sourceTitle");
const sourceMetaEl = document.getElementById("sourceMeta");
const sourceInfoEl = document.getElementById("sourceInfo");
const containerInfoEl = document.getElementById("containerInfo");
const seekInfoEl = document.getElementById("seekInfo");
const audioQueueInfoEl = document.getElementById("audioQueueInfo");
const audioDropInfoEl = document.getElementById("audioDropInfo");
const audioDecodeInfoEl = document.getElementById("audioDecodeInfo");
const trackInfoEl = document.getElementById("trackInfo");
const subtitleInfoEl = document.getElementById("subtitleInfo");

// New Menu Elements
const videoTrackMenu = document.getElementById("videoTrackMenu");
const audioTrackMenu = document.getElementById("audioTrackMenu");
const subtitleTrackMenu = document.getElementById("subtitleTrackMenu");
const chapterMenu = document.getElementById("chapterMenu");
const attachmentInfoEl = document.getElementById("attachmentInfo");
const attachmentCountEl = document.getElementById("attachmentCount");
const attachmentListEl = document.getElementById("attachmentList");
const speedDisplay = document.getElementById("speedDisplay");
const screenshotBtn = document.getElementById("screenshotBtn");
const audioDelayInput = document.getElementById("audioDelayInput");
const audioDelayDisplay = document.getElementById("audioDelayDisplay");
const subtitleDelayInput = document.getElementById("subtitleDelayInput");
const subtitleDelayDisplay = document.getElementById("subtitleDelayDisplay");
const brightnessInput = document.getElementById("brightnessInput");
const contrastInput = document.getElementById("contrastInput");
const saturationInput = document.getElementById("saturationInput");
const filtersResetBtn = document.getElementById("filtersResetBtn");

// Modals
const urlModal = document.getElementById("urlModal");
const urlLoadBtn = document.getElementById("urlLoadBtn");
const urlCancelBtn = document.getElementById("urlCancelBtn");
const shortcutsModal = document.getElementById("shortcutsModal");
const shortcutsCloseBtn = document.getElementById("shortcutsCloseBtn");

// Menu Buttons
const menuOpenBtn = document.getElementById("menuOpenBtn");
const menuUrlBtn = document.getElementById("menuUrlBtn");
const menuCloseBtn = document.getElementById("menuCloseBtn");
const shortcutsBtn = document.getElementById("shortcutsBtn");

const DEFAULT_AUDIO_RATE = 48000;
const MAX_PENDING_AUDIO_BUFFERS = 96;
const AUDIO_TARGET_BUFFER_SECONDS = 0.45;
const AUDIO_MAX_BUFFER_SECONDS = 1.4;
const AUDIO_MIN_BUFFER_AFTER_TRIM_SECONDS = 0.08;
const AUDIO_LAG_CORRECTION_SECONDS = 0.3;
const AUDIO_SYNC_POST_INTERVAL_MS = 200;
const AUDIO_SEEK_PREROLL_SECONDS = 0.12;
const STOP_ACK_TIMEOUT_MS = 1500;
const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const MEDIA_TYPE_VIDEO = 0;
const MEDIA_TYPE_AUDIO = 1;
const MEDIA_TYPE_SUBTITLE = 3;
const FORMAT_BY_EXTENSION = new Map([
  ["mp4", "mov"],
  ["m4v", "mov"],
  ["mov", "mov"],
  ["3gp", "mov"],
  ["3g2", "mov"],
  ["mkv", "matroska"],
  ["webm", "matroska"],
  ["avi", "avi"],
  ["ts", "mpegts"],
  ["mts", "mpegts"],
  ["m2ts", "mpegts"],
  ["mp3", "mp3"],
  ["flac", "flac"],
  ["ogg", "ogg"],
  ["oga", "ogg"],
  ["opus", "ogg"],
  ["wav", "wav"],
]);
const FORMAT_LABELS = {
  mov: "MP4 / QuickTime",
  matroska: "Matroska / WebM",
  avi: "AVI",
  mpegts: "MPEG-TS",
  mp3: "MP3",
  flac: "FLAC",
  ogg: "Ogg",
  wav: "WAV",
};

const createDefaultSourceState = () => ({
  kind: "",
  name: "",
  formatHint: "",
  formatSource: "auto",
  ioMode: "",
  range: false,
  seekable: false,
  size: 0,
});

const state = {
  worker: null,
  ready: false,
  workerNeedsRestart: false,
  started: false,
  playing: false,
  scrubbing: false,
  duration: 0,
  seekEnabled: false,
  seekHint: "",
  renderMode: "2d",
  formatHint: "",
  source: createDefaultSourceState(),
  media: {
    hasVideo: false,
    hasAudio: false,
    hasSubtitle: false,
    videoCount: 0,
    audioCount: 0,
    subtitleCount: 0,
  },
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
    availableFrames: 0,
    droppedSamples: 0,
    trimmedSamples: 0,
    underrunFrames: 0,
    capacityFrames: 0,
    statusReady: false,
    lastQueuedPts: null,
    lastQueuedEndPts: null,
    clock: null,
    drift: null,
    corrections: 0,
    lastSyncPost: 0,
    holding: false,
    seekVideoSettled: false,
    seekVideoSettledAt: 0,
    heldBufferedSeconds: 0,
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
  chapters: [],
  hasOrderedChapters: false,
  attachments: [],
  workerDebug: null,
};

const loadTrackPrefs = () => {
  try {
    const v = window.localStorage.getItem("v3.videoTrack");
    const a = window.localStorage.getItem("v3.audioTrack");
    const vv = v !== null ? Number.parseInt(v, 10) : -1;
    const aa = a !== null ? Number.parseInt(a, 10) : -1;
    if (Number.isFinite(vv)) state.tracks.video = vv;
    if (Number.isFinite(aa)) state.tracks.audio = aa;
  } catch (err) {}
};

const saveTrackPrefs = () => {
  try {
    window.localStorage.setItem("v3.videoTrack", String(state.tracks.video));
    window.localStorage.setItem("v3.audioTrack", String(state.tracks.audio));
  } catch (err) {}
};

const buildTrackLabel = (stream) => {
  const parts = [`#${stream.index}`];
  if (stream.language) parts.push(stream.language);
  if (stream.codec) parts.push(stream.codec);
  if (stream.title) parts.push(stream.title);
  if (stream.isDefault) parts.push("default");
  return parts.join(" · ");
};

const extensionFromName = (name) => {
  const clean = String(name || "").split("?")[0].split("#")[0];
  const match = /\.([a-z0-9]+)$/i.exec(clean);
  return match ? match[1].toLowerCase() : "";
};

const inferFormatFromExtension = (name) =>
  FORMAT_BY_EXTENSION.get(extensionFromName(name)) || "";

const inferFormatFromBytes = (bytes) => {
  if (!bytes || bytes.length < 4) return "";
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "matroska";
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return "mov";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x41 &&
    bytes[9] === 0x56 &&
    bytes[10] === 0x49 &&
    bytes[11] === 0x20
  ) {
    return "avi";
  }
  if (bytes[0] === 0x47 || (bytes.length > 188 && bytes[188] === 0x47)) {
    return "mpegts";
  }
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return "mp3";
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "mp3";
  }
  if (
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  ) {
    return "flac";
  }
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return "ogg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return "wav";
  }
  return "";
};

const formatLabel = (format) => FORMAT_LABELS[format] || (format ? format : "Auto");

const detectSource = async (file, url) => {
  const sourceName = file ? file.name : url || "";
  let formatHint = inferFormatFromExtension(sourceName);
  let formatSource = formatHint ? "extension" : "auto";

  if (file) {
    try {
      const sample = new Uint8Array(await file.slice(0, 512).arrayBuffer());
      const magicHint = inferFormatFromBytes(sample);
      if (magicHint) {
        formatHint = magicHint;
        formatSource = "magic bytes";
      }
    } catch (err) {
      log(`Container probe failed: ${err.message}`);
    }
  }

  return {
    kind: file ? "file" : "url",
    name: sourceName,
    size: file?.size || 0,
    formatHint,
    formatSource,
  };
};

const createMenuItem = (label, onClick, isChecked) => {
  const item = document.createElement("div");
  item.className = "menu-item";

  const check = document.createElement("span");
  check.className = "menu-checkbox";
  check.textContent = isChecked ? "✓" : "";

  item.appendChild(check);
  item.appendChild(document.createTextNode(" " + label));

  item.addEventListener("click", (e) => {
    // e.stopPropagation(); // Don't close menu immediately? Standard menus do.
    // For CSS hover menus, they don't close on click unless we move mouse away.
    onClick(e);
    // We could manually close, but CSS handles visibility.
  });

  return item;
};

const populateTrackSelects = (payload) => {
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  if (Number.isFinite(payload.selectedVideo)) {
    state.tracks.video = payload.selectedVideo;
  }
  if (Number.isFinite(payload.selectedAudio)) {
    state.tracks.audio = payload.audioEnabled === false ? -2 : payload.selectedAudio;
  }

  // Video Tracks
  if (videoTrackMenu) {
    videoTrackMenu.innerHTML = "";
    // Auto
    videoTrackMenu.appendChild(
      createMenuItem("Auto", () => setVideoTrack(-1), state.tracks.video === -1)
    );

    for (const stream of streams) {
      if (!stream || stream.mediaType !== 0) continue;
      const isSelected = state.tracks.video === stream.index;
      videoTrackMenu.appendChild(
        createMenuItem(
          buildTrackLabel(stream),
          () => setVideoTrack(stream.index),
          isSelected
        )
      );
    }
  }

  // Audio Tracks
  if (audioTrackMenu) {
    audioTrackMenu.innerHTML = "";
    // Auto
    audioTrackMenu.appendChild(
      createMenuItem("Auto", () => setAudioTrack(-1), state.tracks.audio === -1)
    );
    // None
    audioTrackMenu.appendChild(
      createMenuItem("None", () => setAudioTrack(-2), state.tracks.audio === -2)
    );

    for (const stream of streams) {
      if (!stream || stream.mediaType !== 1) continue;
      const isSelected = state.tracks.audio === stream.index;
      audioTrackMenu.appendChild(
        createMenuItem(
          buildTrackLabel(stream),
          () => setAudioTrack(stream.index),
          isSelected
        )
      );
    }
  }
};

const populateSubtitleTracks = (streams) => {
  if (!subtitleTrackMenu) return;
  subtitleTrackMenu.innerHTML = "";

  // None
  subtitleTrackMenu.appendChild(
    createMenuItem(
      "None",
      () => setSubtitleTrack(-2),
      state.tracks.subtitle === -2
    )
  );
  // Auto
  subtitleTrackMenu.appendChild(
    createMenuItem(
      "Auto",
      () => setSubtitleTrack(-1),
      state.tracks.subtitle === -1
    )
  );

  for (const stream of streams) {
    if (!stream || stream.mediaType !== 3) continue;
    const isSelected = state.tracks.subtitle === stream.index;
    subtitleTrackMenu.appendChild(
      createMenuItem(
        buildTrackLabel(stream),
        () => setSubtitleTrack(stream.index),
        isSelected
      )
    );
  }
};

const setMediaSummary = (payload) => {
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const videoCount = streams.filter((stream) => stream?.mediaType === MEDIA_TYPE_VIDEO).length;
  const audioCount = streams.filter((stream) => stream?.mediaType === MEDIA_TYPE_AUDIO).length;
  const subtitleCount = streams.filter((stream) => stream?.mediaType === MEDIA_TYPE_SUBTITLE).length;
  state.media = {
    hasVideo: videoCount > 0,
    hasAudio: audioCount > 0,
    hasSubtitle: subtitleCount > 0,
    videoCount,
    audioCount,
    subtitleCount,
  };
  if (Number.isFinite(payload?.selectedSubtitle)) {
    state.tracks.subtitle = payload.subtitlesEnabled === false ? -2 : payload.selectedSubtitle;
  }
  updateMediaMode();
  updateDiagnostics();
};

const chapterDisplayTitle = (chapter) => {
  if (!chapter) return "Untitled chapter";
  const title = typeof chapter.title === "string" ? chapter.title.trim() : "";
  if (title) return title;
  return `Chapter ${Number(chapter.index) + 1}`;
};

const jumpToChapter = (chapter) => {
  if (!chapter || !state.worker) return;
  if (!state.seekEnabled) {
    showOsd("Seek unavailable for this source");
    return;
  }
  const chapterIndex = Number(chapter.index);
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
    return;
  }
  const target = Number(chapter.start);
  const fallbackSeconds = Number.isFinite(target) && target >= 0 ? target : null;
  clearAudioQueue({ hold: true });
  if (fallbackSeconds !== null) {
    state.pts = fallbackSeconds;
    updateTimeline(fallbackSeconds);
    updateStats();
  }
  state.worker.postMessage({
    type: "seekChapter",
    chapterIndex,
    fallbackSeconds,
  });
  showOsd(`Chapter: ${chapterDisplayTitle(chapter)}`);
};

const renderChapterMenu = () => {
  if (!chapterMenu) return;
  chapterMenu.innerHTML = "";

  if (state.hasOrderedChapters) {
    const ordered = document.createElement("div");
    ordered.className = "menu-item menu-item-static";
    ordered.textContent = "Ordered chapters detected";
    chapterMenu.appendChild(ordered);
    chapterMenu.appendChild(document.createElement("div")).className =
      "menu-separator";
  }

  if (!Array.isArray(state.chapters) || state.chapters.length === 0) {
    const empty = document.createElement("div");
    empty.className = "menu-item menu-item-static";
    empty.textContent = "No chapters detected";
    chapterMenu.appendChild(empty);
    return;
  }

  for (const chapter of state.chapters) {
    const start = Number(chapter.start);
    const startText = Number.isFinite(start) ? formatTime(start) : "--:--";
    const label = `${startText} · ${chapterDisplayTitle(chapter)}`;
    chapterMenu.appendChild(createMenuItem(label, () => jumpToChapter(chapter), false));
  }
};

const renderAttachmentInspector = () => {
  if (!attachmentInfoEl || !attachmentListEl || !attachmentCountEl) return;
  const attachments = Array.isArray(state.attachments) ? state.attachments : [];
  attachmentCountEl.textContent = String(attachments.length);
  attachmentListEl.innerHTML = "";
  if (attachments.length === 0) {
    attachmentInfoEl.textContent = "No attachments detected.";
    return;
  }

  const fontLike = attachments.filter((item) => {
    const mime = String(item?.mimeType || "").toLowerCase();
    const name = String(item?.name || "").toLowerCase();
    return mime.includes("font") || /\.(ttf|otf|woff2?)$/.test(name);
  }).length;
  attachmentInfoEl.textContent = `${attachments.length} attachments (${fontLike} font-like)`;

  for (const item of attachments) {
    const row = document.createElement("div");
    row.className = "attachment-item";

    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = item?.name || `attachment-${item?.index ?? "?"}`;

    const meta = document.createElement("span");
    meta.className = "attachment-meta";
    const mime = item?.mimeType || "application/octet-stream";
    const size = Number.isFinite(item?.size) ? formatBytes(item.size) : "unknown size";
    meta.textContent = `${mime} · ${size}`;

    row.appendChild(name);
    row.appendChild(meta);
    attachmentListEl.appendChild(row);
  }
};

const setChapterData = (payload) => {
  const chapters = Array.isArray(payload?.chapters) ? payload.chapters : [];
  state.chapters = chapters.map((chapter, index) => ({
    index: Number.isInteger(chapter?.index) ? chapter.index : index,
    id: Number.isFinite(chapter?.id) ? chapter.id : index,
    title: chapter?.title || "",
    start: Number(chapter?.start ?? chapter?.startSeconds),
    end: Number(chapter?.end ?? chapter?.endSeconds),
  }));
  state.hasOrderedChapters = Boolean(payload?.hasOrderedChapters ?? payload?.ordered);
  renderChapterMenu();
};

const setAttachmentData = (payload) => {
  const attachments = Array.isArray(payload?.attachments)
    ? payload.attachments
    : [];
  state.attachments = attachments.map((item, index) => ({
    index: Number.isInteger(item?.index) ? item.index : index,
    name: item?.name || "",
    mimeType: item?.mimeType || "",
    size: Number(item?.size) || 0,
  }));
  renderAttachmentInspector();
};

const setSourceInfo = (info = {}) => {
  state.source = {
    ...state.source,
    ...info,
  };
  state.formatHint = state.source.formatHint || "";
  updateSourceOverlay();
  updateDiagnostics();
};

const updateSourceOverlay = () => {
  if (!canvasWrap) return;
  const hasName = Boolean(state.source.name);
  canvasWrap.classList.toggle("has-media", state.started || hasName);
  canvasWrap.classList.toggle(
    "loading",
    state.started && !state.frames && !state.media.hasAudio && state.playing,
  );
  if (sourceTitleEl) {
    if (!hasName) {
      sourceTitleEl.textContent = "Open a video or stream URL";
    } else if (state.media.hasAudio && !state.media.hasVideo) {
      sourceTitleEl.textContent = "Audio playback";
    } else {
      sourceTitleEl.textContent = state.source.name;
    }
  }
  if (sourceMetaEl) {
    if (!hasName) {
      sourceMetaEl.textContent = "Drop media here, upload a file, or paste a direct video URL.";
      return;
    }
    const parts = [];
    if (state.source.formatHint) {
      parts.push(`${formatLabel(state.source.formatHint)} from ${state.source.formatSource || "auto"}`);
    } else {
      parts.push("Container auto-detect");
    }
    if (state.source.ioMode) {
      parts.push(state.source.ioMode);
    }
    if (state.source.range) {
      parts.push("HTTP Range");
    }
    sourceMetaEl.textContent = parts.join(" · ");
  }
};

const updateMediaMode = () => {
  if (!canvasWrap) return;
  const audioOnly = state.media.hasAudio && !state.media.hasVideo;
  canvasWrap.classList.toggle("audio-only", audioOnly);
};

const updateDiagnostics = () => {
  if (sourceInfoEl) {
    const kind = state.source.kind || "-";
    const size = state.source.size ? ` · ${formatBytes(state.source.size)}` : "";
    sourceInfoEl.textContent = `${kind}${size}`;
  }
  if (containerInfoEl) {
    containerInfoEl.textContent = state.source.formatHint
      ? `${formatLabel(state.source.formatHint)} (${state.source.formatSource || "auto"})`
      : "Auto";
  }
  if (seekInfoEl) {
    seekInfoEl.textContent = state.seekEnabled
      ? state.source.range
        ? "Range read_at"
        : "read_at"
      : state.seekHint || "-";
  }
  if (audioQueueInfoEl) {
    const buffered = Number.isFinite(state.audio.bufferedSeconds)
      ? `${state.audio.bufferedSeconds.toFixed(2)}s`
      : "-";
    const pending = state.audio.pending.length;
    const drift = Number.isFinite(state.audio.drift)
      ? ` · drift ${state.audio.drift.toFixed(2)}s`
      : "";
    audioQueueInfoEl.textContent = `${buffered} · ${pending} pending${drift}`;
  }
  if (audioDropInfoEl) {
    audioDropInfoEl.textContent =
      `drop ${state.audio.droppedSamples || 0} · trim ${state.audio.trimmedSamples || 0} · under ${state.audio.underrunFrames || 0}`;
  }
  if (audioDecodeInfoEl) {
    const worker = state.workerDebug || {};
    if (worker.separateAudio) {
      const stream = Number.isFinite(worker.audioCtxStreamIndex)
        ? `#${worker.audioCtxStreamIndex}`
        : "auto";
      const ret = Number.isFinite(worker.lastAudioDecodeResult)
        ? ` · ret ${worker.lastAudioDecodeResult}`
        : "";
      audioDecodeInfoEl.textContent = `native ctx ${stream}${ret}`;
    } else {
      audioDecodeInfoEl.textContent = state.media.hasAudio
        ? "main ctx"
        : "-";
    }
  }
  if (trackInfoEl) {
    trackInfoEl.textContent = `${state.media.videoCount}V ${state.media.audioCount}A ${state.media.subtitleCount}S`;
  }
  if (subtitleInfoEl) {
    subtitleInfoEl.textContent = state.tracks.subtitle === -2
      ? "off"
      : state.tracks.subtitle === -1
        ? "auto"
        : `#${state.tracks.subtitle}`;
  }
  updateSourceOverlay();
};

const setVideoTrack = (index) => {
  state.tracks.video = index;
  saveTrackPrefs();
  updateMenuCheckmarks(); // Refresh UI
  applyTrackSelection();
  updateDiagnostics();
};

const setAudioTrack = (index) => {
  state.tracks.audio = index;
  saveTrackPrefs();
  updateMenuCheckmarks();
  applyTrackSelection();
  updateDiagnostics();
};

const setSubtitleTrack = (index) => {
  state.tracks.subtitle = index;
  updateMenuCheckmarks();
  if (state.worker) {
    state.worker.postMessage({
      type: "selectSubtitle",
      subtitleStreamIndex: state.tracks.subtitle,
    });
  }
  updateDiagnostics();
};

const updateMenuCheckmarks = () => {
  // Re-render tracks to update checks is lazy but works if list is small.
  // Or we can just toggle classes.
  // For now, since populate is called on stream load, we need to manually update checks if tracks are already loaded.
  // Actually, `populateTrackSelects` is called once. We should iterate existing items.

  // Helper to update checkmarks in a container
  const updateContainer = (container, currentValue) => {
    if (!container) return;
    const items = container.querySelectorAll(".menu-item");
    items.forEach((item) => {
      // This relies on the closure or data attribute.
      // Since we recreated items in populate, we need to know their value.
      // Let's store value in data attribute when creating.
      // Update: I didn't add data-value in createMenuItem.
      // Let's assume we call populate again or fix the DOM.
      // Simpler: Just refresh the whole list if we have the streams.
      // But we don't have streams easily accessible here without storing them.
    });
  };

  // For V3, let's just manually update specific known menus (Render Mode, Aspect Ratio)
  // For tracks, it's better to store streams in state and re-populate.
  if (state.lastStreams) {
    populateTrackSelects({ streams: state.lastStreams });
    populateSubtitleTracks(state.lastStreams);
  }

  // Render Mode
  document.querySelectorAll('[data-action="setRenderMode"]').forEach((el) => {
    const val = el.getAttribute("data-value");
    el.querySelector(".menu-checkbox").textContent =
      state.renderMode === val ? "✓" : "";
  });

  // Aspect Ratio
  document.querySelectorAll('[data-action="setAspect"]').forEach((el) => {
    const val = el.getAttribute("data-value");
    // Simple check
    const isSelected = state.aspectRatio === val;
    // Since I didn't add checkbox span in HTML for these, I should have.
    // HTML has no span for aspect ratio items. I need to add them or just bold the text.
    // Let's add bold style or color.
    el.style.fontWeight = isSelected ? "bold" : "normal";
    el.style.color = isSelected ? "var(--primary-color)" : "#eee";
  });

  // Speed
  document.querySelectorAll('[data-action="setSpeed"]').forEach((el) => {
    const val = parseFloat(el.getAttribute("data-value"));
    const isSelected = Math.abs(state.playbackSpeed - val) < 0.01;
    el.style.fontWeight = isSelected ? "bold" : "normal";
    el.style.color = isSelected ? "var(--primary-color)" : "#eee";
  });

};

const applyTrackSelection = () => {
  if (!state.worker) return;
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
  while (logLines.length > 200) logLines.shift();
  if (logEl) {
    logEl.textContent = logLines.join("\n");
    logEl.scrollTop = logEl.scrollHeight;
  }
};

const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message;
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
  if (hrs > 0)
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const syncOverlayControls = () => {
  if (!overlayPlay || !overlayPause) return;

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
    overlayFullscreen.innerHTML = document.fullscreenElement
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
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
  updateMenuCheckmarks();
};

const setSeekEnabled = (enabled, reason) => {
  state.seekEnabled = Boolean(enabled);
  state.seekHint = reason || "";
  if (seekRange) {
    seekRange.disabled = !state.seekEnabled || state.duration === 0;
    if (reason) seekRange.title = reason;
    else seekRange.removeAttribute("title");
  }
  updateDiagnostics();
};

const setDuration = (seconds) => {
  const duration = seconds > 0 ? seconds : 0;
  state.duration = duration;
  if (seekRange) seekRange.max = duration.toFixed(2);
  if (timeTotalEl)
    timeTotalEl.textContent = duration > 0 ? formatTime(duration) : "--:--";
};

const updateTimeline = (seconds) => {
  const clamped = Math.max(0, seconds);
  if (!state.scrubbing && timeCurrentEl) {
    timeCurrentEl.textContent = formatTime(clamped);
  }
  if (seekRange && !state.scrubbing) {
    seekRange.value = clamped.toFixed(2);
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
    availableFrames: 0,
    droppedSamples: 0,
    trimmedSamples: 0,
    underrunFrames: 0,
    capacityFrames: 0,
    statusReady: false,
    lastQueuedPts: null,
    lastQueuedEndPts: null,
    clock: null,
    drift: null,
    corrections: 0,
    lastSyncPost: 0,
    holding: false,
    seekVideoSettled: false,
    seekVideoSettledAt: 0,
    heldBufferedSeconds: 0,
    pending: [],
    warned: false,
  };
};

const applyGain = () => {
  if (!state.audio.gain) return;
  state.audio.gain.gain.value = state.muted ? 0 : state.volume;
};

const updateVolume = (value) => {
  const volume = Math.max(0, Math.min(1, value));
  state.volume = volume;
  if (overlayVolume) {
    overlayVolume.value = volume.toString();
    overlayVolume.style.setProperty("--volume-progress", `${volume * 100}%`);
  }
  applyGain();
};

const setMuted = (muted) => {
  state.muted = Boolean(muted);
  if (overlayMute) {
    overlayMute.innerHTML = state.muted
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  }
  applyGain();
};

const getAudioClock = () => {
  if (state.audio.holding) return null;
  if (
    Number.isFinite(state.audio.lastQueuedEndPts) &&
    Number.isFinite(state.audio.bufferedSeconds) &&
    state.audio.statusReady
  ) {
    return state.audio.lastQueuedEndPts - state.audio.bufferedSeconds + state.audioDelay;
  }
  if (!state.audio.context || state.audio.basePts === null) return null;
  return state.audio.context.currentTime - state.audio.startTime + state.audioDelay;
};

const updateAudioDisplay = () => {
  if (audioInfoEl) {
    if (state.audio.sampleRate && state.audio.channels) {
      audioInfoEl.textContent = `${state.audio.sampleRate} Hz / ${state.audio.channels} ch`;
    } else {
      audioInfoEl.textContent = "-";
    }
  }
  // No audio clock display in V3 html, but we can log it or use it for sync
  updateDiagnostics();
};

const updateStats = () => {
  if (frameCountEl) frameCountEl.textContent = state.frames.toString();
  if (bytesCountEl) bytesCountEl.textContent = formatBytes(state.bytes);
  if (ptsValueEl) ptsValueEl.textContent = `${state.pts.toFixed(2)}s`;
  updateAudioDisplay();
  updateDiagnostics();
};

const syncAudioClock = () => {
  if (state.audio.context && state.audio.basePts !== null) {
    state.audio.startTime =
      state.audio.context.currentTime - state.audio.basePts;
  }
};

const audioFrameDuration = (buffer, sampleRate, channels) => {
  if (!(buffer instanceof ArrayBuffer) || !sampleRate || !channels) return 0;
  return buffer.byteLength / Float32Array.BYTES_PER_ELEMENT / channels / sampleRate;
};

const postAudioSync = (force = false) => {
  const clock = getAudioClock();
  state.audio.clock = Number.isFinite(clock) ? clock : null;
  if (!state.worker) return;
  const now = performance.now();
  if (!Number.isFinite(clock)) {
    if (!force) return;
    state.audio.lastSyncPost = now;
    state.worker.postMessage({
      type: "audioClock",
      clock: null,
      drift: null,
      bufferedSeconds: 0,
    });
    return;
  }
  if (!force && now - state.audio.lastSyncPost < AUDIO_SYNC_POST_INTERVAL_MS) {
    return;
  }
  state.audio.lastSyncPost = now;
  state.worker.postMessage({
    type: "audioClock",
    clock,
    drift: Number.isFinite(state.audio.drift) ? state.audio.drift : null,
    bufferedSeconds: Number.isFinite(state.audio.bufferedSeconds)
      ? state.audio.bufferedSeconds
      : null,
  });
};

const trimAudioBuffer = (seconds) => {
  if (!state.audio.worklet || !state.audio.sampleRate || state.audio.holding) return;
  const frames = Math.max(0, Math.floor(seconds * state.audio.sampleRate));
  if (frames <= 0) return;
  state.audio.worklet.port.postMessage({ type: "trim", frames });
  state.audio.corrections += 1;
};

const recoverAudioClock = () => {
  if (state.audio.holding) {
    state.audio.clock = null;
    state.audio.drift = null;
    postAudioSync(true);
    return;
  }
  const clock = getAudioClock();
  if (!Number.isFinite(clock)) {
    postAudioSync();
    return;
  }

  state.audio.clock = clock;
  state.audio.drift = Number.isFinite(state.pts) ? state.pts - clock : null;
  const buffered = Number.isFinite(state.audio.bufferedSeconds)
    ? state.audio.bufferedSeconds
    : 0;

  const inPostSeekGrace =
    state.audio.seekVideoSettledAt > 0 &&
    performance.now() - state.audio.seekVideoSettledAt < 5000;

  if (
    !inPostSeekGrace &&
    state.media.hasVideo &&
    state.playing &&
    Number.isFinite(state.audio.drift)
  ) {
    if (
      state.audio.drift > AUDIO_LAG_CORRECTION_SECONDS &&
      buffered > AUDIO_MIN_BUFFER_AFTER_TRIM_SECONDS
    ) {
      const trimSeconds = Math.min(
        state.audio.drift - AUDIO_MIN_BUFFER_AFTER_TRIM_SECONDS,
        buffered - AUDIO_MIN_BUFFER_AFTER_TRIM_SECONDS,
      );
      if (trimSeconds > 0.02) {
        trimAudioBuffer(trimSeconds);
      }
    } else if (buffered > AUDIO_MAX_BUFFER_SECONDS) {
      trimAudioBuffer(buffered - AUDIO_TARGET_BUFFER_SECONDS);
    }
  }

  postAudioSync();
};

const setAudioHold = (enabled) => {
  const hold = Boolean(enabled);
  state.audio.holding = hold;
  if (state.audio.worklet) {
    state.audio.worklet.port.postMessage({ type: "hold", enabled: hold });
  }
  if (hold) {
    state.audio.seekVideoSettled = false;
    state.audio.seekVideoSettledAt = 0;
    state.audio.heldBufferedSeconds = 0;
    state.audio.clock = null;
    state.audio.drift = null;
    postAudioSync(true);
  }
};

const releaseAudioHold = () => {
  if (!state.audio.holding) return;
  const buffered = Math.max(0, state.audio.heldBufferedSeconds || 0);
  if (Number.isFinite(state.audio.lastQueuedEndPts) && buffered > 0) {
    state.audio.bufferedSeconds = buffered;
    state.audio.statusReady = true;
    state.audio.basePts = state.audio.lastQueuedEndPts - buffered;
    if (state.audio.context) {
      state.audio.startTime = state.audio.context.currentTime - state.audio.basePts;
    }
  }
  state.audio.holding = false;
  state.audio.seekVideoSettled = false;
  state.audio.heldBufferedSeconds = 0;
  if (state.audio.worklet) {
    state.audio.worklet.port.postMessage({ type: "hold", enabled: false });
  }
  recoverAudioClock();
};

const maybeReleaseSeekAudioHold = () => {
  if (!state.audio.holding || !state.audio.seekVideoSettled) return;
  if (
    !state.media.hasAudio ||
    state.audio.heldBufferedSeconds >= AUDIO_SEEK_PREROLL_SECONDS
  ) {
    releaseAudioHold();
  }
};

const postAudioFrameToWorklet = (frame) => {
  if (!state.audio.worklet || !frame?.buffer) return;
  const pts = Number.isFinite(frame.pts) ? frame.pts : null;
  const duration = Number.isFinite(frame.duration)
    ? frame.duration
    : audioFrameDuration(frame.buffer, frame.sampleRate, frame.channels);
  if (pts !== null) {
    state.audio.lastQueuedPts = pts;
    state.audio.lastQueuedEndPts = pts + duration;
  } else if (Number.isFinite(state.audio.lastQueuedEndPts)) {
    state.audio.lastQueuedEndPts += duration;
  }
  state.audio.worklet.port.postMessage({ type: "push", buffer: frame.buffer }, [
    frame.buffer,
  ]);
};

const flushAudioQueue = () => {
  if (!state.audio.ready || !state.audio.worklet) return 0;
  let flushed = 0;
  while (state.audio.pending.length) {
    postAudioFrameToWorklet(state.audio.pending.shift());
    flushed += 1;
  }
  recoverAudioClock();
  return flushed;
};

const initAudio = (sampleRate, channels) => {
  if (state.audio.failed) return null;
  if (state.audio.ready) return state.audio.initPromise;
  if (state.audio.initPromise) return state.audio.initPromise;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    state.audio.failed = true;
    log("AudioContext unavailable.");
    return null;
  }

  state.audio.initPromise = (async () => {
    let audioContext;
    try {
      audioContext = new AudioCtx({ sampleRate });
    } catch (err) {
      audioContext = new AudioCtx();
    }

    if (!audioContext.audioWorklet) {
      state.audio.failed = true;
      log("AudioWorklet unavailable.");
      return null;
    }

    await audioContext.audioWorklet.addModule(versionedAssetUrl("audio-worklet.js"));
    const worklet = new AudioWorkletNode(audioContext, "ffmpeg-audio");
    const gain = audioContext.createGain();
    gain.gain.value = state.volume;

    worklet.connect(gain).connect(audioContext.destination);
    worklet.port.onmessage = (event) => {
      if (!event.data || event.data.type !== "status") return;
      const {
        availableFrames,
        bufferedSeconds,
        droppedSamples,
        trimmedSamples,
        underrunFrames,
        capacityFrames,
      } = event.data;
      if (Number.isFinite(availableFrames)) {
        state.audio.availableFrames = availableFrames;
      }
      if (Number.isFinite(bufferedSeconds)) {
        state.audio.bufferedSeconds = bufferedSeconds;
      }
      if (Number.isFinite(droppedSamples)) {
        state.audio.droppedSamples = droppedSamples;
      }
      if (Number.isFinite(trimmedSamples)) {
        state.audio.trimmedSamples = trimmedSamples;
      }
      if (Number.isFinite(underrunFrames)) {
        state.audio.underrunFrames = underrunFrames;
      }
      if (Number.isFinite(capacityFrames)) {
        state.audio.capacityFrames = capacityFrames;
      }
      state.audio.statusReady = true;
      recoverAudioClock();
      updateDiagnostics();
    };
    worklet.port.postMessage({ type: "config", channels });
    if (state.audio.holding) {
      worklet.port.postMessage({ type: "hold", enabled: true });
    }

    state.audio.context = audioContext;
    state.audio.worklet = worklet;
    state.audio.gain = gain;
    state.audio.ready = true;
    state.audio.sampleRate = audioContext.sampleRate;
    state.audio.channels = channels;

    syncAudioClock();
    applyGain();
    updateAudioDisplay();

    flushAudioQueue();
    if (state.playing) await audioContext.resume();
    return audioContext;
  })().catch((err) => {
    log(`Audio init failed: ${err.message}`);
    state.audio.initPromise = null;
    state.audio.failed = true;
  });

  return state.audio.initPromise;
};

const queueAudioBuffer = (buffer, pts, sampleRate = state.audio.sampleRate, channels = state.audio.channels || 2) => {
  const frame = {
    buffer,
    pts,
    sampleRate,
    channels,
    duration: audioFrameDuration(buffer, sampleRate, channels),
  };
  if (!state.audio.ready || !state.audio.worklet) {
    if (state.audio.pending.length >= MAX_PENDING_AUDIO_BUFFERS) {
      state.audio.pending.shift();
    }
    state.audio.pending.push(frame);
  } else {
    postAudioFrameToWorklet(frame);
  }
  if (state.audio.holding) {
    state.audio.heldBufferedSeconds += frame.duration || 0;
    state.audio.bufferedSeconds = state.audio.heldBufferedSeconds;
    maybeReleaseSeekAudioHold();
  }

  if (state.audio.basePts === null && Number.isFinite(pts)) {
    state.audio.basePts = pts;
    syncAudioClock();
  }
  recoverAudioClock();
};

const clearAudioQueue = ({ hold = false } = {}) => {
  if (state.audio.worklet)
    state.audio.worklet.port.postMessage({ type: "clear" });
  state.audio.pending = [];
  state.audio.basePts = null;
  state.audio.lastQueuedPts = null;
  state.audio.lastQueuedEndPts = null;
  state.audio.heldBufferedSeconds = 0;
  state.audio.seekVideoSettled = false;
  state.audio.seekVideoSettledAt = 0;
  state.audio.clock = null;
  state.audio.drift = null;
  state.audio.statusReady = false;
  state.audio.startTime = state.audio.context
    ? state.audio.context.currentTime
    : 0;
  setAudioHold(hold);
  postAudioSync(true);
};

const closeAudio = async () => {
  if (state.audio.worklet) {
    state.audio.worklet.port.postMessage({ type: "clear" });
    state.audio.worklet.disconnect();
  }
  if (state.audio.gain) state.audio.gain.disconnect();
  if (state.audio.context) {
    try {
      await state.audio.context.close();
    } catch (e) {}
  }
  resetAudioState();
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
  state.source = createDefaultSourceState();
  state.formatHint = "";
  state.chapters = [];
  state.hasOrderedChapters = false;
  state.attachments = [];
  state.media = {
    hasVideo: false,
    hasAudio: false,
    hasSubtitle: false,
    videoCount: 0,
    audioCount: 0,
    subtitleCount: 0,
  };
  setDuration(0);
  updateTimeline(0);
  if (resolutionEl) resolutionEl.textContent = "-";
  setSeekEnabled(false);
  clearAudioQueue();
  updateStats();
  renderChapterMenu();
  renderAttachmentInspector();
  updateMediaMode();
  updateSourceOverlay();
  updateDiagnostics();
};

let activityTimeout;
const onUserActivity = () => {
  if (!canvasWrap) return;
  canvasWrap.classList.add("user-active");
  clearTimeout(activityTimeout);

  if (state.playing) {
    activityTimeout = setTimeout(() => {
      const isHovering = document.querySelector(
        ".menu-bar-overlay:hover, .controls-overlay:hover"
      );
      if (isHovering) {
        onUserActivity();
      } else {
        canvasWrap.classList.remove("user-active");
      }
    }, 2500);
  }
};

const setPausedState = (paused) => {
  if (!canvasWrap) return;
  if (paused) {
    canvasWrap.classList.add("paused");
    canvasWrap.classList.add("user-active");
    clearTimeout(activityTimeout);
  } else {
    canvasWrap.classList.remove("paused");
    onUserActivity();
  }
};

if (canvasWrap) {
  canvasWrap.addEventListener("mousemove", onUserActivity);
  canvasWrap.addEventListener("mousedown", onUserActivity);
  canvasWrap.addEventListener("click", onUserActivity);
  canvasWrap.addEventListener("keydown", onUserActivity);
  canvasWrap.addEventListener("pointermove", onUserActivity);
}

const stopPlayback = async () => {
  const workerStop = state.worker ? waitForWorkerStop() : Promise.resolve();
  state.playing = false;
  state.started = false;
  if (state.worker) state.worker.postMessage({ type: "stop" });
  const [, stopped] = await Promise.all([closeAudio(), workerStop]);
  if (state.worker && stopped === false) {
    state.workerNeedsRestart = true;
  }
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  startBtn.disabled = !state.ready;
  syncOverlayControls();
  resetUi();
  setStatus(state.ready ? "Ready" : "Stopped");
  log("Stopped.");
  setPausedState(true);
};

const pausePlayback = () => {
  if (!state.playing) return;
  state.playing = false;
  if (state.worker) state.worker.postMessage({ type: "pause" });
  suspendAudio();
  log("Paused.");
  pauseBtn.disabled = true;
  startBtn.disabled = false;
  syncOverlayControls();
  setPausedState(true);
};

const startPlayback = async (sourceOverride = null) => {
  if (!state.ready || !state.worker) return;

  const overrideFile = sourceOverride?.file || null;
  const overrideUrl = sourceOverride?.url ? String(sourceOverride.url).trim() : "";
  const selectedFile = fileInput?.files && fileInput.files[0] ? fileInput.files[0] : null;
  const selectedUrl = urlInput?.value ? urlInput.value.trim() : "";
  const file = overrideFile || selectedFile;
  const url = file ? "" : overrideUrl || selectedUrl;

  if (!state.started) {
    if (!file && !url) {
      log("Choose a file or enter a URL.");
      // Open file picker if nothing selected
      if (!file && !url && fileInput) fileInput.click();
      return;
    }
    if (url) {
      urlInput.value = url;
      if (sourceUrlInput) sourceUrlInput.value = url;
    }
    setChapterData({ chapters: [], hasOrderedChapters: false });
    setAttachmentData({ attachments: [] });
    if (canvasWrap) {
      canvasWrap.classList.remove("error");
      canvasWrap.classList.add("loading");
    }
    setStatus("Probing source...");
    const sourceInfo = await detectSource(file || null, file ? "" : url);
    setSourceInfo(sourceInfo);
    log(
      `Container ${sourceInfo.formatHint ? formatLabel(sourceInfo.formatHint) : "auto"} ` +
        `from ${sourceInfo.formatSource}.`,
    );
    const bufferMb = Number.parseInt(bufferSizeInput.value, 10) || 4;
    const bufferBytes = Math.max(1, bufferMb) * 1024 * 1024;

    state.started = true;
    state.playing = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    startBtn.disabled = true;
    syncOverlayControls();
    setPausedState(false);

    state.worker.postMessage({
      type: "load",
      file: file || null,
      url: file ? null : url || null,
      formatHint: state.formatHint,
      sourceInfo,
      bufferBytes,
      videoStreamIndex: state.tracks.video,
      audioStreamIndex: state.tracks.audio,
      subtitleStreamIndex: state.tracks.subtitle,
    });
  } else {
    state.playing = true;
    pauseBtn.disabled = false;
    startBtn.disabled = true;
    syncOverlayControls();
    setPausedState(false);
    state.worker.postMessage({ type: "play" });
  }

  resumeAudio();
};

const performSeek = (seconds) => {
  if (!state.seekEnabled || !state.worker) return;
  const target =
    state.duration > 0
      ? Math.max(0, Math.min(seconds, state.duration))
      : Math.max(0, seconds);
  clearAudioQueue();
  state.pts = target;
  updateTimeline(target);
  updateStats();
  state.worker.postMessage({ type: "seek", seconds: target });
  showOsd(`Seek: ${formatTime(target)}`);
};

const commitSeekFromUi = () => {
  if (!seekRange) return;
  const value = Number.parseFloat(seekRange.value);
  if (!Number.isFinite(value)) return;
  const now = performance.now();
  if (
    Math.abs(value - state.lastSeekCommitValue) < 0.01 &&
    now - state.lastSeekCommitTs < 200
  )
    return;
  state.lastSeekCommitTs = now;
  state.lastSeekCommitValue = value;
  performSeek(value);
};

const stopWaiters = new Set();
const readyWaiters = new Set();

const resolveStopWaiters = () => {
  for (const resolve of stopWaiters) resolve(true);
  stopWaiters.clear();
};

const waitForWorkerStop = () =>
  new Promise((resolve) => {
    let timeout = 0;
    const done = (acked) => {
      clearTimeout(timeout);
      stopWaiters.delete(done);
      resolve(Boolean(acked));
    };
    timeout = setTimeout(() => done(false), STOP_ACK_TIMEOUT_MS);
    stopWaiters.add(done);
  });

const resolveReadyWaiters = () => {
  for (const resolve of readyWaiters) resolve(true);
  readyWaiters.clear();
};

const waitForWorkerReady = (timeoutMs = 10000) => {
  if (state.ready && state.worker) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timeout = 0;
    const done = (ready) => {
      clearTimeout(timeout);
      readyWaiters.delete(done);
      resolve(Boolean(ready));
    };
    timeout = setTimeout(() => done(false), timeoutMs);
    readyWaiters.add(done);
  });
};

const replacePlaybackCanvases = () => {
  if (!canvas2d || !canvasGl) return;
  const next2d = document.createElement("canvas");
  next2d.id = "canvas2d";
  const nextGl = document.createElement("canvas");
  nextGl.id = "canvasGl";
  nextGl.className = "is-hidden";
  canvas2d.replaceWith(next2d);
  canvasGl.replaceWith(nextGl);
  canvas2d = next2d;
  canvasGl = nextGl;
  setRenderMode(state.renderMode);
};

const restartWorker = async () => {
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
  resolveStopWaiters();
  state.ready = false;
  state.workerNeedsRestart = false;
  replacePlaybackCanvases();
  setStatus("Initializing worker...");
  initWorker();
  const ready = await waitForWorkerReady();
  if (!ready) {
    state.workerNeedsRestart = true;
    setStatus("Worker restart failed");
  }
  return ready;
};

const initWorker = () => {
  if (!canvas2d.transferControlToOffscreen) {
    setStatus("OffscreenCanvas unsupported");
    log("OffscreenCanvas is required for this demo.");
    return;
  }

  const worker = new Worker(versionedAssetUrl("ffmpeg-worker.js"));
  state.worker = worker;
  worker.onmessage = (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    if (msg.type === "ready") {
      state.ready = true;
      state.workerNeedsRestart = false;
      startBtn.disabled = false;
      setStatus("Ready");
      syncOverlayControls();
      resolveReadyWaiters();
      return;
    }

    if (msg.type === "subtitleLog") {
      const start = Number(msg.startMs) || 0;
      const end = Number(msg.endMs) || start;
      log(
        `SUB [${(start / 1000).toFixed(2)}-${(end / 1000).toFixed(2)}] ${msg.text}`
      );
      return;
    }

    if (msg.type === "subtitleDebug") {
      log(
        `SUB debug events=${msg.nEvents ?? "-"} first=${msg.firstStartMs ?? "-"}-${msg.firstEndMs ?? "-"}`,
      );
      return;
    }

    if (msg.type === "ffmpegLog") {
      const level = Number.isFinite(msg.level) ? msg.level : "-";
      log(`FFmpeg[${level}] ${msg.message || ""}`);
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

    if (msg.type === "sourceInfo") {
      setSourceInfo(msg.source || msg);
      return;
    }

    if (msg.type === "stopped") {
      state.workerNeedsRestart = false;
      resolveStopWaiters();
      return;
    }

    if (msg.type === "debugSnapshot") {
      const worker = msg.worker || {};
      state.workerDebug = worker;
      if (Number.isFinite(worker.heapBytes)) {
        state.source.heapBytes = worker.heapBytes;
      }
      if (Number.isFinite(worker.duration) && worker.duration > 0) {
        setDuration(worker.duration);
      }
      updateDiagnostics();
      return;
    }

    if (msg.type === "streams") {
      state.lastStreams = msg.streams; // Store for menu repopulation
      setMediaSummary(msg);
      populateTrackSelects(msg);
      populateSubtitleTracks(msg.streams || []);
      return;
    }

    if (msg.type === "chapters") {
      setChapterData(msg);
      return;
    }

    if (msg.type === "attachments") {
      setAttachmentData(msg);
      return;
    }

    if (msg.type === "seekInfo") {
      setSeekEnabled(Boolean(msg.enabled), msg.reason || "");
      return;
    }

    if (msg.type === "resolution") {
      const w = msg.width || 0;
      const h = msg.height || 0;
      if (resolutionEl)
        resolutionEl.textContent = w > 0 && h > 0 ? `${w} x ${h}` : "-";
      return;
    }

    if (msg.type === "stats") {
      state.frames = msg.frames || 0;
      state.bytes = msg.bytes || 0;
      state.pts = Number.isFinite(msg.pts) ? msg.pts : 0;
      if (canvasWrap && (state.frames > 0 || state.media.hasAudio)) {
        canvasWrap.classList.remove("loading");
      }
      if (
        Number.isFinite(msg.duration) &&
        msg.duration > 0 &&
        msg.duration !== state.duration
      ) {
        setDuration(msg.duration);
        if (state.seekEnabled) setSeekEnabled(true, state.seekHint);
      }
      if (!state.scrubbing) updateTimeline(state.pts);
      updateStats();
      checkLoopBoundary();
      return;
    }

    if (msg.type === "audio") {
      const channels = msg.channels || 2;
      const sampleRate = msg.sampleRate || DEFAULT_AUDIO_RATE;
      const pts = Number.isFinite(msg.pts) ? msg.pts : null;
      if (!state.audio.initPromise && !state.audio.failed)
        initAudio(sampleRate, channels);
      if (msg.buffer instanceof ArrayBuffer)
        queueAudioBuffer(msg.buffer, pts, sampleRate, channels);
      return;
    }

    if (msg.type === "audioClear") {
      clearAudioQueue({ hold: state.audio.holding || Boolean(msg.hold) });
      return;
    }

    if (msg.type === "seekSettled") {
      state.audio.seekVideoSettled = true;
      state.audio.seekVideoSettledAt = performance.now();
      maybeReleaseSeekAudioHold();
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

    if (msg.type === "error") {
      const detail = msg.message || msg.error || "Worker error";
      log(`Error: ${detail}`);
      setStatus("Error");
      if (canvasWrap) canvasWrap.classList.add("error");
      if (sourceTitleEl) sourceTitleEl.textContent = "Playback error";
      if (sourceMetaEl) sourceMetaEl.textContent = detail;
      return;
    }

    if (msg.type === "screenshot") {
      handleScreenshotData(msg.dataUrl);
      return;
    }
  };

  worker.onerror = (event) => {
    log(`Worker error: ${event.message}`);
    setStatus("Worker error");
    state.workerNeedsRestart = true;
  };

  if (canvas2d._transferred || canvasGl._transferred) {
    setStatus("Canvas already transferred - refresh page");
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
      renderMode: state.renderMode,
    },
    [offscreen2d, offscreenGl]
  );
};

// ============================================
// UI Interactions
// ============================================

// Menu Actions
document.addEventListener("click", (e) => {
  // Check for menu items with data-action
  const target = e.target.closest("[data-action]");
  if (!target) return;

  const action = target.getAttribute("data-action");
  const value = target.getAttribute("data-value");

  if (action === "setRenderMode") {
    setRenderMode(value);
  } else if (action === "setAspect") {
    setAspectRatio(value);
  } else if (action === "setSpeed") {
    setPlaybackSpeed(parseFloat(value));
  }
});

const isLikelyMediaFile = (file) => {
  if (!file) return false;
  if (file.type?.startsWith("video/") || file.type?.startsWith("audio/")) {
    return true;
  }
  return FORMAT_BY_EXTENSION.has(extensionFromName(file.name));
};

const startNewSource = async ({ file = null, url = "" } = {}) => {
  const nextUrl = String(url || "").trim();
  if (!file && !nextUrl) return;
  if (!state.ready) {
    setStatus("Initializing worker...");
    log("Worker is still initializing.");
    return;
  }

  if (file) {
    if (urlInput) urlInput.value = "";
    if (sourceUrlInput) sourceUrlInput.value = "";
  } else if (nextUrl) {
    if (urlInput) urlInput.value = nextUrl;
    if (sourceUrlInput) sourceUrlInput.value = nextUrl;
    if (fileInput) fileInput.value = "";
  }

  if (state.started || state.playing || state.workerNeedsRestart) {
    await closeAudio();
    state.started = false;
    state.playing = false;
    syncOverlayControls();
    resetUi();
    const ready = await restartWorker();
    if (!ready) return;
  } else {
    resetUi();
  }

  await startPlayback({ file, url: nextUrl });
};

const setLauncherDragging = (isDragging) => {
  if (sourceLauncher) sourceLauncher.classList.toggle("is-dragging", isDragging);
};

// File / URL
if (menuOpenBtn) menuOpenBtn.addEventListener("click", () => fileInput.click());
if (menuUrlBtn)
  menuUrlBtn.addEventListener("click", () => {
    urlModal.classList.add("visible");
    urlInput.focus();
  });
if (menuCloseBtn) menuCloseBtn.addEventListener("click", () => stopPlayback());

// URL Modal
if (urlCancelBtn)
  urlCancelBtn.addEventListener("click", () =>
    urlModal.classList.remove("visible")
  );
if (urlLoadBtn)
  urlLoadBtn.addEventListener("click", () => {
    const url = urlInput.value.trim();
    if (url) {
      urlModal.classList.remove("visible");
      startNewSource({ url });
    }
  });

if (urlInput)
  urlInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const url = urlInput.value.trim();
    if (url) {
      urlModal.classList.remove("visible");
      startNewSource({ url });
    }
  });

if (sourceFileBtn)
  sourceFileBtn.addEventListener("click", () => {
    if (fileInput) fileInput.click();
  });

if (sourceUrlForm)
  sourceUrlForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = sourceUrlInput?.value.trim() || "";
    if (!url) {
      sourceUrlInput?.focus();
      return;
    }
    startNewSource({ url });
  });

if (sourceLauncher) {
  ["dragenter", "dragover"].forEach((type) => {
    sourceLauncher.addEventListener(type, (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      setLauncherDragging(true);
    });
  });

  ["dragleave", "dragend"].forEach((type) => {
    sourceLauncher.addEventListener(type, () => setLauncherDragging(false));
  });

  sourceLauncher.addEventListener("drop", (event) => {
    event.preventDefault();
    setLauncherDragging(false);
    const files = Array.from(event.dataTransfer?.files || []);
    const file = files.find(isLikelyMediaFile) || files[0];
    if (file) startNewSource({ file });
  });
}

// File Input
fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) {
    startNewSource({ file: fileInput.files[0] });
  }
});

// Playback Controls
startBtn.addEventListener("click", () => startPlayback());
pauseBtn.addEventListener("click", pausePlayback);
stopBtn.addEventListener("click", stopPlayback);

if (overlayPlay) overlayPlay.addEventListener("click", () => startPlayback());
if (overlayPause) overlayPause.addEventListener("click", pausePlayback);

if (seekRange) {
  seekRange.addEventListener("input", () => {
    state.scrubbing = true;
    const value = Number.parseFloat(seekRange.value);
    if (Number.isFinite(value)) {
      if (timeCurrentEl) timeCurrentEl.textContent = formatTime(value);
      const percent = state.duration > 0 ? (value / state.duration) * 100 : 0;
      seekRange.style.setProperty("--seek-progress", `${percent}%`);
    }
  });
  seekRange.addEventListener("change", () => {
    state.scrubbing = false;
    commitSeekFromUi();
  });
}

if (overlayMute)
  overlayMute.addEventListener("click", () => setMuted(!state.muted));
if (overlayVolume)
  overlayVolume.addEventListener("input", () =>
    updateVolume(Number.parseFloat(overlayVolume.value))
  );
if (overlayFullscreen)
  overlayFullscreen.addEventListener("click", toggleFullscreen);
if (canvasWrap) {
  let clickTimer = null;
  canvasWrap.addEventListener("click", (e) => {
    if (
      e.target.closest(
        "button, input, .source-launcher, .menu-item, .controls-overlay, .menu-bar-overlay"
      )
    ) {
      return;
    }
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      toggleFullscreen();
    } else {
      clickTimer = setTimeout(() => {
        clickTimer = null;
        if (state.started) {
          if (state.playing) {
            pausePlayback();
          } else {
            startPlayback();
          }
        }
      }, 250);
    }
  });
}
document.addEventListener("fullscreenchange", updateFullscreenButton);

// New Feature Logic (Ported from V2)

// OSD
let osdTimeout = null;
const showOsd = (message) => {
  if (!osdEl) return;
  osdEl.textContent = message;
  osdEl.classList.add("visible");
  clearTimeout(osdTimeout);
  osdTimeout = setTimeout(() => osdEl.classList.remove("visible"), 1500);
};

// Speed
const setPlaybackSpeed = (speed) => {
  const clamped = Math.max(0.25, Math.min(2.0, speed));
  state.playbackSpeed = clamped;
  if (state.worker)
    state.worker.postMessage({ type: "setSpeed", speed: clamped });
  if (speedDisplay) speedDisplay.textContent = `${clamped}x`;
  showOsd(`Speed: ${clamped}x`);
  updateMenuCheckmarks();
};

// Screenshot
const handleScreenshotData = (dataUrl) => {
  const link = document.createElement("a");
  link.download = `screenshot-${Date.now()}.png`;
  link.href = dataUrl;
  link.click();
};

if (screenshotBtn)
  screenshotBtn.addEventListener("click", () => {
    if (state.worker) state.worker.postMessage({ type: "screenshot" });
    showOsd("Taking screenshot...");
  });

// Audio Delay
const setAudioDelay = (seconds) => {
  state.audioDelay = seconds;
  if (audioDelayInput) audioDelayInput.value = (seconds * 1000).toString();
  if (audioDelayDisplay)
    audioDelayDisplay.textContent = `${(seconds * 1000).toFixed(0)}ms`;
  recoverAudioClock();
  updateDiagnostics();
};

if (audioDelayInput) {
  audioDelayInput.addEventListener("input", () => {
    const val = parseInt(audioDelayInput.value, 10);
    setAudioDelay(val / 1000);
  });
}

// Subtitle Delay
const setSubtitleDelay = (seconds) => {
  state.subtitleDelay = seconds;
  if (state.worker)
    state.worker.postMessage({ type: "setSubtitleDelay", delay: seconds });
  if (subtitleDelayInput)
    subtitleDelayInput.value = (seconds * 1000).toString();
  if (subtitleDelayDisplay)
    subtitleDelayDisplay.textContent = `${(seconds * 1000).toFixed(0)}ms`;
};
if (subtitleDelayInput) {
  subtitleDelayInput.addEventListener("input", () => {
    const val = parseInt(subtitleDelayInput.value, 10);
    setSubtitleDelay(val / 1000);
  });
}

// Loop
const loopToggleBtn = document.getElementById("loopToggleBtn");
const checkLoopBoundary = () => {
  if (
    state.loop.enabled &&
    state.loop.endTime !== null &&
    state.pts >= state.loop.endTime
  ) {
    performSeek(state.loop.startTime || 0);
  }
};

if (loopToggleBtn)
  loopToggleBtn.addEventListener("click", () => {
    state.loop.enabled = !state.loop.enabled;
    const check = document.getElementById("loopCheck");
    if (check) check.textContent = state.loop.enabled ? "✓" : "";
    showOsd(state.loop.enabled ? "Loop Enabled" : "Loop Disabled");
  });

document.getElementById("loopSetABtn")?.addEventListener("click", () => {
  state.loop.startTime = state.pts;
  showOsd(`Loop Start: ${formatTime(state.pts)}`);
});
document.getElementById("loopSetBBtn")?.addEventListener("click", () => {
  state.loop.endTime = state.pts;
  showOsd(`Loop End: ${formatTime(state.pts)}`);
});
document.getElementById("loopClearBtn")?.addEventListener("click", () => {
  state.loop.enabled = false;
  state.loop.startTime = null;
  state.loop.endTime = null;
  document.getElementById("loopCheck").textContent = "";
  showOsd("Loop Cleared");
});

// Aspect Ratio
const setAspectRatio = (ratio) => {
  state.aspectRatio = ratio;
  if (canvasWrap) {
    canvasWrap.classList.remove(
      "aspect-auto",
      "aspect-16-9",
      "aspect-4-3",
      "aspect-fill",
      "aspect-stretch"
    );
    canvasWrap.classList.add(`aspect-${ratio.replace(":", "-")}`);
  }
  updateMenuCheckmarks();
  showOsd(`Aspect: ${ratio}`);
};

// Filters
const applyFilters = () => {
  if (canvasWrap) {
    canvasWrap.style.filter = `brightness(${state.filters.brightness}%) contrast(${state.filters.contrast}%) saturate(${state.filters.saturation}%)`;
  }
};
if (brightnessInput)
  brightnessInput.addEventListener("input", () => {
    state.filters.brightness = brightnessInput.value;
    applyFilters();
  });
if (contrastInput)
  contrastInput.addEventListener("input", () => {
    state.filters.contrast = contrastInput.value;
    applyFilters();
  });
if (saturationInput)
  saturationInput.addEventListener("input", () => {
    state.filters.saturation = saturationInput.value;
    applyFilters();
  });
if (filtersResetBtn)
  filtersResetBtn.addEventListener("click", () => {
    state.filters.brightness = 100;
    state.filters.contrast = 100;
    state.filters.saturation = 100;
    brightnessInput.value = 100;
    contrastInput.value = 100;
    saturationInput.value = 100;
    applyFilters();
    showOsd("Filters Reset");
  });

// Shortcuts Modal
if (shortcutsBtn)
  shortcutsBtn.addEventListener("click", () =>
    shortcutsModal.classList.add("visible")
  );
if (shortcutsCloseBtn)
  shortcutsCloseBtn.addEventListener("click", () =>
    shortcutsModal.classList.remove("visible")
  );

// Helper functions for keyboard shortcuts
const cycleSpeed = (direction) => {
  const idx = PLAYBACK_SPEEDS.findIndex(
    (s) => Math.abs(s - state.playbackSpeed) < 0.01
  );
  const newIdx = Math.max(
    0,
    Math.min(PLAYBACK_SPEEDS.length - 1, idx + direction)
  );
  setPlaybackSpeed(PLAYBACK_SPEEDS[newIdx]);
};

const adjustSubtitleDelay = (deltaMs) => {
  const newDelay = state.subtitleDelay + deltaMs / 1000;
  setSubtitleDelay(Math.max(-5, Math.min(5, newDelay)));
  showOsd(`Subtitle Delay: ${(newDelay * 1000).toFixed(0)}ms`);
};

const adjustAudioDelay = (deltaMs) => {
  const newDelay = state.audioDelay + deltaMs / 1000;
  setAudioDelay(Math.max(-5, Math.min(5, newDelay)));
  showOsd(`Audio Delay: ${(newDelay * 1000).toFixed(0)}ms`);
};

const setLoopStart = () => {
  state.loop.startTime = state.pts;
  showOsd(`Loop Start: ${formatTime(state.pts)}`);
};

const setLoopEnd = () => {
  state.loop.endTime = state.pts;
  showOsd(`Loop End: ${formatTime(state.pts)}`);
};

const toggleLoop = () => {
  state.loop.enabled = !state.loop.enabled;
  const check = document.getElementById("loopCheck");
  if (check) check.textContent = state.loop.enabled ? "✓" : "";
  showOsd(state.loop.enabled ? "Loop Enabled" : "Loop Disabled");
};

const clearLoop = () => {
  state.loop.enabled = false;
  state.loop.startTime = null;
  state.loop.endTime = null;
  const check = document.getElementById("loopCheck");
  if (check) check.textContent = "";
  showOsd("Loop Cleared");
};

const takeScreenshot = () => {
  if (state.worker) {
    state.worker.postMessage({ type: "screenshot" });
    showOsd("Taking screenshot...");
  }
};

const frameStep = (direction) => {
  if (state.worker) {
    state.worker.postMessage({ type: "frameStep", direction });
    showOsd(direction > 0 ? "Frame +1" : "Frame -1");
  }
};

// Keyboard Shortcuts
document.addEventListener("keydown", (e) => {
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
    case " ":
    case "k":
      e.preventDefault();
      if (state.playing) pausePlayback();
      else startPlayback();
      break;

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
      if (shift) adjustAudioDelay(-100);
      else if (state.seekEnabled) {
        performSeek(state.pts - 10);
        showOsd("-10s");
      }
      break;
    case "l":
      e.preventDefault();
      if (shift) adjustAudioDelay(100);
      else if (state.seekEnabled) {
        performSeek(state.pts + 10);
        showOsd("+10s");
      }
      break;

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

    case "f":
      e.preventDefault();
      toggleFullscreen();
      break;

    case "s":
      if (!ctrl) {
        e.preventDefault();
        takeScreenshot();
      }
      break;

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

    case "z":
      e.preventDefault();
      adjustSubtitleDelay(-100);
      break;
    case "x":
      e.preventDefault();
      adjustSubtitleDelay(100);
      break;

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

    case "escape":
      e.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen();
      else if (state.started) stopPlayback();
      break;

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

// Init
loadTrackPrefs();
setRenderMode("2d"); // Default
updateMenuCheckmarks();
setMuted(false);
resetUi();
setStatus("Initializing worker...");
initWorker();
