import assert from "node:assert/strict";
import test from "node:test";

import {
  DF_MIN_FRAMES_PER_WINDOW,
  DF_SLOW_WINDOWS_TO_DEGRADE,
  DeepFilterHealth,
} from "./deepFilterHealth.ts";

const fast = { frames: 100, slowFrames: 2, maxMs: 3 };
const slow = { frames: 100, slowFrames: 60, maxMs: 14 };

test("one slow second right after start does not degrade", () => {
  const health = new DeepFilterHealth();
  assert.equal(health.observe(slow), false);
  assert.equal(health.observe(fast), false);
  assert.equal(health.snapshot().slowWindows, 0);
});

test("consecutive slow seconds degrade", () => {
  const health = new DeepFilterHealth();
  for (let i = 0; i < DF_SLOW_WINDOWS_TO_DEGRADE - 1; i++) {
    assert.equal(health.observe(slow), false);
  }
  assert.equal(health.observe(slow), true);
  assert.equal(health.snapshot().lastMaxMs, 14);
  assert.equal(health.snapshot().lastSlowRatio, 0.6);
});

test("windows with almost no frames are ignored", () => {
  const health = new DeepFilterHealth();
  const idle = {
    frames: DF_MIN_FRAMES_PER_WINDOW - 1,
    slowFrames: 40,
    maxMs: 20,
  };
  for (let i = 0; i < DF_SLOW_WINDOWS_TO_DEGRADE + 2; i++) {
    assert.equal(health.observe(idle), false);
  }
  assert.equal(health.snapshot().lastMaxMs, undefined);
});
