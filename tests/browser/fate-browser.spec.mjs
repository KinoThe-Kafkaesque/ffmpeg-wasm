import { expect, test } from "@playwright/test";

const runSyntheticFateCase = async (page, testCase) =>
  page.evaluate(async (candidate) => {
    const runner = new window.FateBrowserRunner({
      sampleBase: "/__test-fixtures__/",
      previewCanvas: document.getElementById("preview"),
    });
    return runner.runCase(candidate);
  }, testCase);

test("browser FATE harness can run metadata, decode, and seek profiles against local fixtures", async ({ page }) => {
  await page.goto("/fate-browser.html");
  await expect(page.locator("h1")).toHaveText("Browser FATE Runner");
  await expect(page.locator("#totalCount")).not.toHaveText("0");

  const results = [];
  results.push(
    await runSyntheticFateCase(page, {
      id: "local-browser-ci-mkv-metadata",
      sample: "smoke.mkv",
      source: "local-fixture",
      profile: "metadata",
      tags: ["browser-smoke"],
      formatHint: "matroska",
    }),
  );
  results.push(
    await runSyntheticFateCase(page, {
      id: "local-browser-ci-mkv-decode",
      sample: "smoke.mkv",
      source: "local-fixture",
      profile: "decode",
      tags: ["browser-smoke"],
      formatHint: "matroska",
    }),
  );
  results.push(
    await runSyntheticFateCase(page, {
      id: "local-browser-ci-mkv-seek",
      sample: "smoke.mkv",
      source: "local-fixture",
      profile: "seek",
      tags: ["browser-smoke"],
      formatHint: "matroska",
    }),
  );
  results.push(
    await runSyntheticFateCase(page, {
      id: "local-browser-ci-mp3-decode",
      sample: "audio.mp3",
      source: "local-fixture",
      profile: "decode",
      tags: ["browser-smoke"],
      formatHint: "mp3",
    }),
  );

  for (const result of results) {
    expect(result.status).toBe("pass");
    expect(result.summary.streams).toBeGreaterThan(0);
  }
  expect(results[1].summary.decoded.video).toBeGreaterThan(0);
  expect(results[1].summary.decoded.audio).toBeGreaterThan(0);
  expect(results[2].summary.seeks.length).toBeGreaterThanOrEqual(2);
  expect(results[3].summary.decoded.audio).toBeGreaterThan(0);
});
