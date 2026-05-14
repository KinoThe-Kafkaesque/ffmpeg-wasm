import { expect, test } from "@playwright/test";
import { FIXTURES } from "./fixtures.mjs";

const REQUIRED_READY_FEATURES = [
  "crossOriginIsolated",
  "sharedArrayBuffer",
  "worker",
  "webAssembly",
  "offscreenCanvasTransfer",
];

const readyFeaturesSatisfied = (features) =>
  REQUIRED_READY_FEATURES.every((name) => Boolean(features[name]));

const browserFeatures = async (page) =>
  page.evaluate(() => {
    const canvas = document.createElement("canvas");
    let webgl = false;
    try {
      webgl = Boolean(canvas.getContext("webgl"));
    } catch {}

    return {
      crossOriginIsolated: Boolean(window.crossOriginIsolated),
      sharedArrayBuffer: typeof window.SharedArrayBuffer === "function",
      worker: typeof window.Worker === "function",
      webAssembly: typeof window.WebAssembly === "object",
      offscreenCanvasTransfer:
        typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function",
      audioContext: typeof window.AudioContext === "function" || typeof window.webkitAudioContext === "function",
      webgl,
      videoFrame: typeof window.VideoFrame === "function",
    };
  });

const openPlayer = async (page) => {
  const response = await page.goto("/v3.html");
  expect(response?.ok()).toBe(true);
  expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response?.headers()["cross-origin-embedder-policy"]).toBe("require-corp");

  await expect(page.locator("#sourceOverlay")).toBeVisible();
  await expect(page.locator("#sourceFileBtn")).toBeVisible();
  await expect(page.locator("#sourceUrlInput")).toBeVisible();
  await expect(page.locator("#seekRange")).toBeDisabled();
  await expect(page.locator("#formatSelect")).toHaveCount(0);

  const features = await browserFeatures(page);
  await page.waitForFunction(
    () => {
      const status = document.getElementById("status")?.textContent || "";
      return !/Loading module|Initializing worker|Loading FFmpeg module/i.test(status);
    },
    null,
    { timeout: 45_000 },
  ).catch(() => {});
  const status = (await page.locator("#status").textContent())?.trim() || "";
  const log = (await page.locator("#log").textContent()) || "";
  return { features, status, log };
};

const requireReadyPlayer = async (page) => {
  const runtime = await openPlayer(page);
  const expectedReady = readyFeaturesSatisfied(runtime.features);
  test.skip(
    !expectedReady || runtime.status !== "Ready",
    `Browser does not expose the required pthread player features or module is not ready: ${JSON.stringify(runtime)}`,
  );
  return runtime;
};

const numericText = async (locator) => Number.parseFloat((await locator.textContent()) || "0");

test("player shell, headers, manifests, and browser capabilities are coherent", async ({ page }) => {
  const runtime = await openPlayer(page);
  const expectedReady = readyFeaturesSatisfied(runtime.features);

  if (expectedReady) {
    expect(runtime.status).toBe("Ready");
  } else {
    expect(["OffscreenCanvas unsupported", "Load failed", "Worker error", "API binding failed"]).toContain(
      runtime.status,
    );
  }

  const capabilities = await page.evaluate(async () =>
    fetch("/ffmpeg_wasm.capabilities.json", { cache: "no-store" }).then((res) => res.json()),
  );
  expect(capabilities.buildProfile.purpose).toBe("decode-playback");
  expect(capabilities.buildProfile.encoders).toBe(false);
  expect(capabilities.buildProfile.muxers).toBe(false);
  expect(capabilities.buildProfile.filters).toBe(false);
  expect(capabilities.wasm.pthreads).toBe(true);
  expect(capabilities.codecs.video).toContain("h264");
  expect(capabilities.codecs.video).toContain("hevc");
  expect(capabilities.codecs.video).toContain("av1");

  const components = await page.evaluate(async () =>
    fetch("/ffmpeg-components.json", { cache: "no-store" }).then((res) => res.json()),
  );
  expect(components.errors).toEqual([]);
  expect(components.enabled.encoder).toEqual([]);
  expect(components.enabled.muxer).toEqual([]);
  expect(components.enabled.filter).toEqual([]);
});

test("URL sources fail visibly when HTTP/CORS/range access is unavailable", async ({ page }) => {
  await requireReadyPlayer(page);

  await page.locator("#sourceUrlInput").fill("/missing-browser-ci-video.mkv");
  await page.locator("#sourceUrlForm").evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  await expect(page.locator("#status")).toHaveText("Error", { timeout: 30_000 });
  await expect(page.locator("#sourceTitle")).toHaveText("Playback error");
  await expect(page.locator("#sourceMeta")).toContainText(/HTTP error|Open failed|Fetch failed/);
  await expect(page.locator("#log")).toContainText(/HTTP error|Error:/);
});

test("local MKV upload decodes video/audio/subtitle metadata and survives seek", async ({ page }) => {
  await requireReadyPlayer(page);

  await page.locator("#fileInput").setInputFiles(FIXTURES.mkv);

  await expect(page.locator("#status")).toHaveText(/Playing|Ended/, { timeout: 45_000 });
  await expect(page.locator("#resolution")).toHaveText("160 x 90", { timeout: 45_000 });
  await expect(page.locator("#sourceInfo")).toContainText("file");
  await expect(page.locator("#containerInfo")).toContainText(/Matroska|WebM/);
  await expect(page.locator("#seekInfo")).toContainText("read_at");
  await expect(page.locator("#trackInfo")).toHaveText("1V 1A 1S");
  await expect(page.locator("#audioInfo")).toContainText("48000 Hz");
  await expect(page.locator("#subtitleInfo")).toHaveText("off");

  await expect.poll(() => numericText(page.locator("#frameCount")), {
    timeout: 45_000,
    message: "expected decoded video frames",
  }).toBeGreaterThan(3);

  await expect(page.locator("#seekRange")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#subtitleTrackMenu .menu-item").nth(2).dispatchEvent("click");
  await expect(page.locator("#subtitleInfo")).toContainText("#");
  await expect(page.locator("#log")).toContainText(/Subtitle select ok|Subtitle track set/);

  await page.locator("#seekRange").evaluate((range) => {
    range.value = "2.50";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    range.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(() => numericText(page.locator("#ptsValue")), {
    timeout: 45_000,
    message: "expected playback PTS to settle at or after seek target",
  }).toBeGreaterThan(2.0);
  await expect(page.locator("#log")).not.toContainText("Decode error");
});

test("audio-only files enter the audio playback surface without a video canvas dependency", async ({ page }) => {
  await requireReadyPlayer(page);

  await page.locator("#fileInput").setInputFiles(FIXTURES.mp3);
  await expect(page.locator("#status")).toHaveText(/Playing|Ended/, { timeout: 45_000 });
  await expect(page.locator("#sourceTitle")).toHaveText("Audio playback", { timeout: 45_000 });
  await expect(page.locator("#trackInfo")).toHaveText("0V 1A 0S");
  await expect(page.locator("#audioInfo")).toContainText("48000 Hz");
  await expect(page.locator("#containerInfo")).toContainText("MP3");
  await expect(page.locator("#log")).not.toContainText("Decode error");
});

test("responsive player layout keeps video and controls usable on the active viewport", async ({ page }) => {
  await openPlayer(page);

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const wrap = document.getElementById("canvasWrap").getBoundingClientRect();
    const menu = document.getElementById("menuBar").getBoundingClientRect();
    const controls = document.querySelector(".controls-overlay").getBoundingClientRect();
    return {
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      wrap: { width: wrap.width, height: wrap.height },
      menu: { width: menu.width, height: menu.height },
      controls: { width: controls.width, height: controls.height },
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 2);
  expect(metrics.wrap.width).toBeGreaterThan(Math.min(280, metrics.clientWidth * 0.7));
  expect(metrics.wrap.height / metrics.wrap.width).toBeGreaterThan(0.4);
  expect(metrics.menu.width).toBeLessThanOrEqual(metrics.wrap.width + 2);
  expect(metrics.controls.width).toBeLessThanOrEqual(metrics.wrap.width + 2);
  expect(metrics.menu.height).toBeGreaterThan(20);
  expect(metrics.controls.height).toBeGreaterThan(40);
});
