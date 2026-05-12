/* global module */

(function attachFfmpegWasmApi(root) {
  const API_SPEC = {
    avcodecVersion: { name: "ffmpeg_wasm_avcodec_version", returnType: "number", argTypes: [], required: true },
    avformatVersion: { name: "ffmpeg_wasm_avformat_version", returnType: "number", argTypes: [], required: true },
    avutilVersion: { name: "ffmpeg_wasm_avutil_version", returnType: "number", argTypes: [], required: true },
    hasHevcAv1: { name: "ffmpeg_wasm_has_hevc_av1", returnType: "number", argTypes: [], required: true },

    create: { name: "ffmpeg_wasm_create", returnType: "number", argTypes: ["number"], required: true },
    destroy: { name: "ffmpeg_wasm_destroy", returnType: null, argTypes: ["number"], required: true },
    append: { name: "ffmpeg_wasm_append", returnType: "number", argTypes: ["number", "number", "number"], required: true },
    setEof: { name: "ffmpeg_wasm_set_eof", returnType: null, argTypes: ["number"], required: true },
    setKeepAll: { name: "ffmpeg_wasm_set_keep_all", returnType: null, argTypes: ["number", "number"], required: true },
    setBufferLimit: { name: "ffmpeg_wasm_set_buffer_limit", returnType: null, argTypes: ["number", "number"], required: true },
    setFileSize: { name: "ffmpeg_wasm_set_file_size", returnType: null, argTypes: ["number", "number"], required: true },
    setBufferOffset: { name: "ffmpeg_wasm_set_buffer_offset", returnType: null, argTypes: ["number", "number"] },
    setIoMode: { name: "ffmpeg_wasm_set_io_mode", returnType: "number", argTypes: ["number", "number"] },
    getIoMode: { name: "ffmpeg_wasm_get_io_mode", returnType: "number", argTypes: ["number"] },
    setCacheLimit: { name: "ffmpeg_wasm_set_cache_limit", returnType: null, argTypes: ["number", "number"] },
    setAudioEnabled: { name: "ffmpeg_wasm_set_audio_enabled", returnType: null, argTypes: ["number", "number"], required: true },

    open: { name: "ffmpeg_wasm_open", returnType: "number", argTypes: ["number", "string"], required: true },
    duration: { name: "ffmpeg_wasm_duration_seconds", returnType: "number", argTypes: ["number"], required: true },
    seek: { name: "ffmpeg_wasm_seek_seconds", returnType: "number", argTypes: ["number", "number"], required: true },
    chaptersCount: { name: "ffmpeg_wasm_chapters_count", returnType: "number", argTypes: ["number"] },
    hasOrderedChapters: { name: "ffmpeg_wasm_has_ordered_chapters", returnType: "number", argTypes: ["number"] },
    chapterStartSeconds: { name: "ffmpeg_wasm_chapter_start_seconds", returnType: "number", argTypes: ["number", "number"] },
    chapterEndSeconds: { name: "ffmpeg_wasm_chapter_end_seconds", returnType: "number", argTypes: ["number", "number"] },
    chapterTitle: { name: "ffmpeg_wasm_chapter_title", returnType: "string", argTypes: ["number", "number"] },
    chapterId: { name: "ffmpeg_wasm_chapter_id", returnType: "number", argTypes: ["number", "number"] },
    seekChapter: { name: "ffmpeg_wasm_seek_chapter", returnType: "number", argTypes: ["number", "number"] },
    prepareRestream: { name: "ffmpeg_wasm_prepare_restream", returnType: "number", argTypes: ["number", "number"] },
    readFrame: { name: "ffmpeg_wasm_read_frame", returnType: "number", argTypes: ["number"], required: true },
    readVideoFrame: { name: "ffmpeg_wasm_read_video_frame", returnType: "number", argTypes: ["number"] },

    width: { name: "ffmpeg_wasm_video_width", returnType: "number", argTypes: ["number"], required: true },
    height: { name: "ffmpeg_wasm_video_height", returnType: "number", argTypes: ["number"], required: true },
    frameFormat: { name: "ffmpeg_wasm_frame_format", returnType: "number", argTypes: ["number"] },
    frameDataPtr: { name: "ffmpeg_wasm_frame_data_ptr", returnType: "number", argTypes: ["number", "number"] },
    frameLinesize: { name: "ffmpeg_wasm_frame_linesize", returnType: "number", argTypes: ["number", "number"] },
    pts: { name: "ffmpeg_wasm_frame_pts_seconds", returnType: "number", argTypes: ["number"], required: true },
    toRgba: { name: "ffmpeg_wasm_frame_to_rgba", returnType: "number", argTypes: ["number"], required: true },
    rgbaPtr: { name: "ffmpeg_wasm_rgba_ptr", returnType: "number", argTypes: ["number"], required: true },
    rgbaStride: { name: "ffmpeg_wasm_rgba_stride", returnType: "number", argTypes: ["number"], required: true },
    rgbaSize: { name: "ffmpeg_wasm_rgba_size", returnType: "number", argTypes: ["number"] },

    audioChannels: { name: "ffmpeg_wasm_audio_channels", returnType: "number", argTypes: ["number"], required: true },
    audioSampleRate: { name: "ffmpeg_wasm_audio_sample_rate", returnType: "number", argTypes: ["number"], required: true },
    audioSamples: { name: "ffmpeg_wasm_audio_nb_samples", returnType: "number", argTypes: ["number"], required: true },
    audioPtr: { name: "ffmpeg_wasm_audio_ptr", returnType: "number", argTypes: ["number"], required: true },
    audioBytes: { name: "ffmpeg_wasm_audio_bytes", returnType: "number", argTypes: ["number"] },
    audioPts: { name: "ffmpeg_wasm_audio_pts_seconds", returnType: "number", argTypes: ["number"], required: true },

    bufferedBytes: { name: "ffmpeg_wasm_buffered_bytes", returnType: "number", argTypes: ["number"], required: true },
    compactBuffer: { name: "ffmpeg_wasm_compact_buffer", returnType: null, argTypes: ["number"], required: true },

    streamsCount: { name: "ffmpeg_wasm_streams_count", returnType: "number", argTypes: ["number"] },
    streamMediaType: { name: "ffmpeg_wasm_stream_media_type", returnType: "number", argTypes: ["number", "number"] },
    streamCodecId: { name: "ffmpeg_wasm_stream_codec_id", returnType: "number", argTypes: ["number", "number"] },
    streamCodecName: { name: "ffmpeg_wasm_stream_codec_name", returnType: "string", argTypes: ["number", "number"] },
    streamLanguage: { name: "ffmpeg_wasm_stream_language", returnType: "string", argTypes: ["number", "number"] },
    streamTitle: { name: "ffmpeg_wasm_stream_title", returnType: "string", argTypes: ["number", "number"] },
    streamIsDefault: { name: "ffmpeg_wasm_stream_is_default", returnType: "number", argTypes: ["number", "number"] },
    attachmentsCount: { name: "ffmpeg_wasm_attachments_count", returnType: "number", argTypes: ["number"] },
    attachmentName: { name: "ffmpeg_wasm_attachment_name", returnType: "string", argTypes: ["number", "number"] },
    attachmentMimeType: { name: "ffmpeg_wasm_attachment_mime_type", returnType: "string", argTypes: ["number", "number"] },
    attachmentSize: { name: "ffmpeg_wasm_attachment_size", returnType: "number", argTypes: ["number", "number"] },
    attachmentDataPtr: { name: "ffmpeg_wasm_attachment_data_ptr", returnType: "number", argTypes: ["number", "number"] },

    selectedVideoStream: { name: "ffmpeg_wasm_selected_video_stream", returnType: "number", argTypes: ["number"] },
    selectedAudioStream: { name: "ffmpeg_wasm_selected_audio_stream", returnType: "number", argTypes: ["number"] },
    audioIsEnabled: { name: "ffmpeg_wasm_audio_is_enabled", returnType: "number", argTypes: ["number"] },
    selectStreams: { name: "ffmpeg_wasm_select_streams", returnType: "number", argTypes: ["number", "number", "number"] },

    selectedSubtitleStream: { name: "ffmpeg_wasm_selected_subtitle_stream", returnType: "number", argTypes: ["number"] },
    subtitlesEnabled: { name: "ffmpeg_wasm_subtitles_enabled", returnType: "number", argTypes: ["number"] },
    selectSubtitleStream: { name: "ffmpeg_wasm_select_subtitle_stream", returnType: "number", argTypes: ["number", "number"] },
    addFont: { name: "ffmpeg_wasm_add_font", returnType: "number", argTypes: ["number", "string", "number", "number"], required: true },
    renderSubtitles: { name: "ffmpeg_wasm_render_subtitles", returnType: "number", argTypes: ["number", "number"] },
    subtitleEventsCount: { name: "ffmpeg_wasm_subtitle_events_count", returnType: "number", argTypes: ["number"] },
    subtitleFirstStartMs: { name: "ffmpeg_wasm_subtitle_first_start_ms", returnType: "number", argTypes: ["number"] },
    subtitleFirstEndMs: { name: "ffmpeg_wasm_subtitle_first_end_ms", returnType: "number", argTypes: ["number"] },
    clearSubtitleTrack: { name: "ffmpeg_wasm_clear_subtitle_track", returnType: null, argTypes: ["number"] },

    setLogLevel: { name: "ffmpeg_wasm_set_log_level", returnType: null, argTypes: ["number"] },
    errorString: { name: "ffmpeg_wasm_error_string", returnType: "string", argTypes: ["number"] },
    debugSnapshot: { name: "ffmpeg_wasm_debug_snapshot", returnType: "string", argTypes: ["number"] },

    debugSeekStream: { name: "ffmpeg_wasm_debug_seek_stream", returnType: "number", argTypes: ["number", "number", "number"], testOnly: true },
    debugBufferOffset: { name: "ffmpeg_wasm_debug_buffer_offset", returnType: "number", argTypes: ["number"], testOnly: true },
    debugBufferSize: { name: "ffmpeg_wasm_debug_buffer_size", returnType: "number", argTypes: ["number"], testOnly: true },
    debugBufferReadPos: { name: "ffmpeg_wasm_debug_buffer_read_pos", returnType: "number", argTypes: ["number"], testOnly: true },
    debugBytePos: { name: "ffmpeg_wasm_debug_byte_pos", returnType: "number", argTypes: ["number"], testOnly: true }
  };

  const EXTRA_EXPORTED_FUNCTIONS = ["malloc", "free"];

  const hasExport = (Module, name) => typeof Module[`_${name}`] === "function";

  const createFfmpegWasmApi = (Module, options = {}) => {
    const strictRequired = Boolean(options.strictRequired);
    const api = {};
    for (const [method, entry] of Object.entries(API_SPEC)) {
      if (!hasExport(Module, entry.name)) {
        if (strictRequired && entry.required) {
          throw new Error(`Missing required WASM export: ${entry.name}`);
        }
        api[method] = null;
        continue;
      }
      api[method] = Module.cwrap(entry.name, entry.returnType, entry.argTypes || []);
    }
    return api;
  };

  const ffmpegWasmExportedFunctions = (options = {}) => {
    const includeTestOnly = Boolean(options.includeTestOnly);
    const names = Object.values(API_SPEC)
      .filter((entry) => includeTestOnly || !entry.testOnly)
      .map((entry) => `_${entry.name}`);
    names.push(...EXTRA_EXPORTED_FUNCTIONS.map((name) => `_${name}`));
    return names;
  };

  const exported = {
    FFMPEG_WASM_API_SPEC: API_SPEC,
    createFfmpegWasmApi,
    ffmpegWasmExportedFunctions
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  } else {
    root.FFmpegWasmApi = exported;
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
