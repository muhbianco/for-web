import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SCREEN_SHARE_FPS,
  SCREEN_SHARE_FRAME_RATES,
  TEXT_SCREEN_SHARE_FPS,
  normaliseFrameRate,
  screenShareEncoding,
  screenShareLabel,
} from "./screenSharePresets.ts";

test("the picked frame rate reaches the encoding", () => {
  // The bug this module exists for: 60 used to be captured and published as 30.
  assert.equal(screenShareEncoding("high", 60).maxFramerate, 60);
  assert.equal(screenShareEncoding("low", 60).maxFramerate, 60);
  assert.equal(screenShareEncoding("high", 15).maxFramerate, 15);
});

test("bitrate grows with the frame rate", () => {
  for (const quality of ["low", "high"] as const) {
    let previous = 0;
    for (const fps of SCREEN_SHARE_FRAME_RATES) {
      const bitrate = screenShareEncoding(quality, fps).maxBitrate!;
      assert.ok(
        bitrate > previous,
        `${quality} at ${fps}fps should beat ${previous}`,
      );
      previous = bitrate;
    }
  }
});

test("30 fps keeps livekit's original bitrates, so nothing changes by default", () => {
  assert.equal(screenShareEncoding("low", 30).maxBitrate, 2_000_000);
  assert.equal(screenShareEncoding("high", 30).maxBitrate, 5_000_000);
});

test("source mode ignores the frame rate control", () => {
  assert.equal(normaliseFrameRate("text", 60), TEXT_SCREEN_SHARE_FPS);
  assert.equal(
    screenShareEncoding("text", 60).maxFramerate,
    TEXT_SCREEN_SHARE_FPS,
  );
  assert.equal(screenShareLabel("text", 60), "Source 5FPS");
});

test("an unknown frame rate falls back instead of producing undefined bitrate", () => {
  assert.equal(normaliseFrameRate("high", 144), DEFAULT_SCREEN_SHARE_FPS);
  assert.equal(normaliseFrameRate("high", undefined), DEFAULT_SCREEN_SHARE_FPS);
  assert.ok(screenShareEncoding("high", 144).maxBitrate! > 0);
});

test("labels say what is actually published", () => {
  assert.equal(screenShareLabel("low", 30), "720p 30FPS");
  assert.equal(screenShareLabel("high", 60), "1080p 60FPS");
});
