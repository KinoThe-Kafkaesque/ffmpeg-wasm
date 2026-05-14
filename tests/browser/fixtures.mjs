import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT_DIR = resolve(new URL("../..", import.meta.url).pathname);
export const FIXTURE_DIR = resolve(ROOT_DIR, "web/__test-fixtures__");
export const FIXTURES = {
  ass: resolve(FIXTURE_DIR, "smoke.ass"),
  mkv: resolve(FIXTURE_DIR, "smoke.mkv"),
  mp4: resolve(FIXTURE_DIR, "late-moov.mp4"),
  mp3: resolve(FIXTURE_DIR, "audio.mp3"),
};

const runFfmpeg = (args) => {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });
};

const writeAssFixture = () => {
  writeFileSync(
    FIXTURES.ass,
    `[Script Info]
ScriptType: v4.00+
PlayResX: 160
PlayResY: 90

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,18,&H000000FF,&H000000FF,&H0000FF00,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,8,8,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.40,0:00:02.00,Default,,0,0,0,,BROWSER TEST 01
Dialogue: 0,0:00:02.20,0:00:04.20,Default,,0,0,0,,BROWSER TEST 02
Dialogue: 0,0:00:04.40,0:00:05.80,Default,,0,0,0,,BROWSER TEST 03
`,
  );
};

export const ensureBrowserFixtures = () => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeAssFixture();

  if (!existsSync(FIXTURES.mkv)) {
    runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-i",
      FIXTURES.ass,
      "-t",
      "6",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-map",
      "2:s:0",
      "-c:v",
      "mpeg4",
      "-q:v",
      "7",
      "-c:a",
      "aac",
      "-c:s",
      "ass",
      "-metadata:s:a:0",
      "language=eng",
      "-metadata:s:s:0",
      "language=eng",
      FIXTURES.mkv,
    ]);
  }

  if (!existsSync(FIXTURES.mp4)) {
    runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:sample_rate=48000",
      "-t",
      "4",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "mpeg4",
      "-q:v",
      "7",
      "-c:a",
      "aac",
      FIXTURES.mp4,
    ]);
  }

  if (!existsSync(FIXTURES.mp3)) {
    runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:sample_rate=48000",
      "-t",
      "3",
      "-c:a",
      "mp3",
      FIXTURES.mp3,
    ]);
  }
};
