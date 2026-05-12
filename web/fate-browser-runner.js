/* global FFmpegWasm, FFmpegWasmApi */

(function attachFateBrowserRunner(root) {
  const AVMEDIA_TYPE_VIDEO = 0;
  const AVMEDIA_TYPE_AUDIO = 1;
  const RANDOM_ACCESS_IO_MODE = 1;

  const assert = (condition, message) => {
    if (!condition) {
      throw new Error(message);
    }
  };

  const joinUrl = (base, path) => {
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    const absoluteBase = new URL(
      normalizedBase,
      root.location ? root.location.href : "http://localhost/"
    );
    return new URL(path.split("/").map(encodeURIComponent).join("/"), absoluteBase).toString();
  };

  class FateBrowserRunner {
    constructor(options = {}) {
      this.sampleBase = options.sampleBase || "/fate-suite/";
      this.previewCanvas = options.previewCanvas || null;
      this.onLog = options.onLog || (() => {});
      this.wasmPromise = null;
      this.wasm = null;
      this.readAtBytes = null;
    }

    async loadWasm() {
      if (this.wasmPromise) {
        return this.wasmPromise;
      }

      this.wasmPromise = (async () => {
        if (typeof FFmpegWasm !== "function") {
          throw new Error("ffmpeg_wasm.js did not expose FFmpegWasm");
        }
        if (!root.FFmpegWasmApi?.createFfmpegWasmApi) {
          throw new Error("ffmpeg-wasm-api.js did not expose FFmpegWasmApi");
        }

        const Module = await FFmpegWasm({
          print: (message) => this.onLog(String(message)),
          printErr: (message) => this.onLog(String(message)),
        });
        const api = FFmpegWasmApi.createFfmpegWasmApi(Module);

        for (const name of ["create", "destroy", "open", "readFrame", "duration"]) {
          assert(api[name], `missing required wasm API: ${name}`);
        }

        Module.ffmpegReadAt = (offset, len, dstPtr) => {
          if (!this.readAtBytes) {
            return -38;
          }
          const start = Math.max(0, Math.trunc(Number(offset) || 0));
          const want = Math.max(0, Math.trunc(Number(len) || 0));
          if (want <= 0 || start >= this.readAtBytes.byteLength) {
            return 0;
          }
          const end = Math.min(start + want, this.readAtBytes.byteLength);
          const chunk = this.readAtBytes.subarray(start, end);
          Module.HEAPU8.set(chunk, dstPtr >>> 0);
          return chunk.byteLength;
        };

        this.wasm = { Module, api };
        return this.wasm;
      })();

      return this.wasmPromise;
    }

    async fetchSample(sample, signal) {
      const url = joinUrl(this.sampleBase, sample);
      const response = await fetch(url, { cache: "no-store", signal });
      if (!response.ok) {
        throw new Error(`sample fetch failed (${response.status}) ${url}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }

    appendBytes(ctx, bytes) {
      const { Module, api } = this.wasm;
      assert(api.append, "append API is unavailable");
      const ptr = Module._malloc(bytes.byteLength);
      assert(ptr, "malloc failed while appending media bytes");
      try {
        Module.HEAPU8.set(bytes, ptr);
        const ret = api.append(ctx, ptr, bytes.byteLength);
        if (ret < 0) {
          throw new Error(`append failed: ${ret}`);
        }
        return ret;
      } finally {
        Module._free(ptr);
      }
    }

    openBytes(bytes, formatHint = null, preferReadAt = true) {
      const { api } = this.wasm;
      const ctx = api.create(0);
      assert(ctx, "failed to create wasm decoder context");

      try {
        if (api.setFileSize) {
          api.setFileSize(ctx, bytes.byteLength);
        }

        if (preferReadAt && api.setIoMode) {
          this.readAtBytes = bytes;
          const modeRet = api.setIoMode(ctx, RANDOM_ACCESS_IO_MODE);
          assert(modeRet >= 0, `setIoMode(read_at) failed: ${modeRet}`);
          if (api.setCacheLimit) {
            api.setCacheLimit(ctx, 64 * 1024 * 1024);
          }
        } else {
          this.readAtBytes = null;
          this.appendBytes(ctx, bytes);
          if (api.setEof) {
            api.setEof(ctx);
          }
        }

        const openRet = api.open(ctx, formatHint || null);
        assert(openRet === 0, `open failed: ${openRet}`);
        return ctx;
      } catch (err) {
        api.destroy(ctx);
        this.readAtBytes = null;
        throw err;
      }
    }

    close(ctx) {
      this.readAtBytes = null;
      if (ctx && this.wasm?.api?.destroy) {
        this.wasm.api.destroy(ctx);
      }
    }

    getStreams(ctx) {
      const { api } = this.wasm;
      if (!api.streamsCount || !api.streamMediaType) {
        return [];
      }

      const streams = [];
      const count = api.streamsCount(ctx);
      for (let index = 0; index < count; index += 1) {
        streams.push({
          index,
          mediaType: api.streamMediaType(ctx, index),
          codecId: api.streamCodecId ? api.streamCodecId(ctx, index) : null,
          codecName: api.streamCodecName ? api.streamCodecName(ctx, index) : null,
          language: api.streamLanguage ? api.streamLanguage(ctx, index) : null,
          title: api.streamTitle ? api.streamTitle(ctx, index) : null,
          isDefault: api.streamIsDefault ? Boolean(api.streamIsDefault(ctx, index)) : false,
        });
      }
      return streams;
    }

    streamCounts(streams) {
      return {
        video: streams.filter((stream) => stream.mediaType === AVMEDIA_TYPE_VIDEO).length,
        audio: streams.filter((stream) => stream.mediaType === AVMEDIA_TYPE_AUDIO).length,
      };
    }

    copyCurrentRgbaToCanvas(ctx) {
      const { Module, api } = this.wasm;
      if (!this.previewCanvas || !api.toRgba || !api.rgbaPtr || !api.rgbaStride) {
        return null;
      }

      const width = api.width ? api.width(ctx) : 0;
      const height = api.height ? api.height(ctx) : 0;
      assert(width > 0 && height > 0, `invalid video dimensions: ${width}x${height}`);

      const rgbaRet = api.toRgba(ctx);
      assert(rgbaRet > 0, `RGBA conversion failed: ${rgbaRet}`);

      const ptr = api.rgbaPtr(ctx);
      const stride = api.rgbaStride(ctx);
      assert(ptr > 0 && stride >= width * 4, "invalid RGBA pointer or stride");

      const canvas = this.previewCanvas;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      const image = context.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        const srcStart = ptr + y * stride;
        const srcEnd = srcStart + width * 4;
        image.data.set(Module.HEAPU8.subarray(srcStart, srcEnd), y * width * 4);
      }
      context.putImageData(image, 0, 0);
      return { width, height, stride };
    }

    readFrames(ctx, options = {}) {
      const { api } = this.wasm;
      const wantVideo = options.wantVideo ?? 1;
      const wantAudio = options.wantAudio ?? 1;
      const maxReads = options.maxReads ?? 24000;
      const result = {
        video: 0,
        audio: 0,
        lastVideoPts: null,
        lastAudioPts: null,
        reads: 0,
        firstRgba: null,
      };

      for (let i = 0; i < maxReads; i += 1) {
        const ret = api.readFrame(ctx);
        result.reads = i + 1;

        if (ret === 1) {
          result.video += 1;
          result.lastVideoPts = api.pts ? api.pts(ctx) : null;
          if (!result.firstRgba) {
            result.firstRgba = this.copyCurrentRgbaToCanvas(ctx);
          }
        } else if (ret === 2) {
          result.audio += 1;
          result.lastAudioPts = api.audioPts ? api.audioPts(ctx) : null;
          if (api.audioSamples) {
            assert(api.audioSamples(ctx) > 0, "decoded audio frame has no samples");
          }
          if (api.audioPtr) {
            assert(api.audioPtr(ctx) > 0, "decoded audio frame has no data pointer");
          }
        } else if (ret <= 0) {
          result.terminalRet = ret;
          break;
        }

        if (result.video >= wantVideo && result.audio >= wantAudio) {
          break;
        }
      }

      return result;
    }

    readFrameAfterSeek(ctx, hasVideo, maxReads = 12000) {
      const { api } = this.wasm;
      for (let i = 0; i < maxReads; i += 1) {
        const ret = api.readFrame(ctx);
        if (ret === 1) {
          const pts = api.pts ? api.pts(ctx) : null;
          this.copyCurrentRgbaToCanvas(ctx);
          return { ok: true, kind: "video", pts, reads: i + 1 };
        }
        if (!hasVideo && ret === 2) {
          const pts = api.audioPts ? api.audioPts(ctx) : null;
          return { ok: true, kind: "audio", pts, reads: i + 1 };
        }
        if (ret <= 0) {
          return { ok: false, ret, reads: i + 1 };
        }
      }
      return { ok: false, ret: 0, reads: maxReads, reason: "max_reads" };
    }

    async runCase(testCase, options = {}) {
      const signal = options.signal;
      await this.loadWasm();

      if (testCase.skipReason && !options.includeMappedSkips) {
        return {
          status: "skip",
          reason: testCase.skipReason,
        };
      }

      const startedAt = performance.now();
      const bytes = await this.fetchSample(testCase.sample, signal);
      signal?.throwIfAborted?.();

      const ctx = this.openBytes(bytes, testCase.formatHint || null, true);
      try {
        const { api } = this.wasm;
        const streams = this.getStreams(ctx);
        const counts = this.streamCounts(streams);
        const duration = api.duration ? api.duration(ctx) : 0;

        assert(streams.length > 0, "no streams detected");
        assert(Number.isFinite(duration), `duration is not finite: ${duration}`);

        const summary = {
          bytes: bytes.byteLength,
          duration,
          streams: streams.length,
          videoStreams: counts.video,
          audioStreams: counts.audio,
        };

        if (testCase.profile === "metadata") {
          return {
            status: "pass",
            elapsedMs: performance.now() - startedAt,
            summary,
          };
        }

        const decoded = this.readFrames(ctx, {
          wantVideo: counts.video > 0 ? 1 : 0,
          wantAudio: counts.audio > 0 ? 1 : 0,
        });
        if (counts.video > 0) {
          assert(decoded.video > 0, "decoded no video frames");
          assert(decoded.firstRgba, "video frame did not convert to RGBA");
        } else if (counts.audio > 0) {
          assert(decoded.audio > 0, "decoded no audio frames");
        }
        summary.decoded = decoded;

        if (testCase.profile === "seek") {
          assert(api.seek, "seek API is unavailable");
          assert(duration > 0.5, `duration too short for seek test: ${duration}`);
          const fractions = duration > 20 ? [0.1, 0.5, 0.82] : [0.25, 0.6];
          const seeks = [];
          for (const fraction of fractions) {
            const target = Math.max(0, Math.min(duration - 0.05, duration * fraction));
            const seekRet = api.seek(ctx, target);
            assert(seekRet === 0, `seek failed at ${target.toFixed(3)}s: ${seekRet}`);
            const frame = this.readFrameAfterSeek(ctx, counts.video > 0);
            assert(frame.ok, `no frame after seek to ${target.toFixed(3)}s`);
            if (Number.isFinite(frame.pts)) {
              assert(
                frame.pts <= target + 30,
                `seek overshot too far: target=${target.toFixed(3)}s got=${frame.pts.toFixed(3)}s`
              );
            }
            seeks.push({ target, ...frame });
          }
          summary.seeks = seeks;
        }

        return {
          status: "pass",
          elapsedMs: performance.now() - startedAt,
          summary,
        };
      } finally {
        this.close(ctx);
      }
    }
  }

  root.FateBrowserRunner = FateBrowserRunner;
})(typeof globalThis !== "undefined" ? globalThis : self);
