import { defineConfig, devices } from "@playwright/test";

const PORT = Number.parseInt(process.env.FFMPEG_WASM_BROWSER_TEST_PORT || "18761", 10);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 20_000,
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "output/playwright-report", open: "never" }],
    ["json", { outputFile: "output/playwright-results.json" }],
  ],
  outputDir: "output/playwright",
  globalSetup: "./tests/browser/global-setup.mjs",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `node scripts/serve-web.mjs --port ${PORT}`,
    url: `${baseURL}/v3.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], browserName: "firefox" },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 15"], browserName: "webkit" },
    },
  ],
});
