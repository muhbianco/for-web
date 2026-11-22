import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIO_BW_LOW_WINDOWS,
  AUDIO_BW_RECOVER_WINDOWS,
  AudioBandwidthPolicy,
} from "./audioBandwidthPolicy.ts";

test("a healthy uplink is never capped (reports of 17–22/11: ≥ 300 kbps)", () => {
  const p = new AudioBandwidthPolicy();
  for (let i = 0; i < 100; i++) assert.equal(p.observe(300), undefined);
  assert.equal(p.capped(), false);
});

test("a sustained low estimate caps once, a single dip does not", () => {
  const p = new AudioBandwidthPolicy();
  assert.equal(p.observe(90), undefined);
  assert.equal(p.observe(400), undefined, "dip over");
  const actions = [];
  for (let i = 0; i < AUDIO_BW_LOW_WINDOWS + 3; i++)
    actions.push(p.observe(90));
  assert.deepEqual(actions.filter(Boolean), ["cap"], "cap exactly once");
  assert.equal(actions.indexOf("cap"), AUDIO_BW_LOW_WINDOWS - 1);
});

test("restores only after the uplink stays good for a while", () => {
  const p = new AudioBandwidthPolicy();
  for (let i = 0; i < AUDIO_BW_LOW_WINDOWS; i++) p.observe(80);
  assert.equal(p.capped(), true);
  for (let i = 0; i < AUDIO_BW_RECOVER_WINDOWS - 1; i++) {
    assert.equal(p.observe(500), undefined);
  }
  assert.equal(p.observe(200), undefined, "in between: not yet");
  for (let i = 0; i < AUDIO_BW_RECOVER_WINDOWS - 1; i++) p.observe(500);
  assert.equal(p.observe(500), "restore");
  assert.equal(p.capped(), false);
});

test("no estimate changes nothing", () => {
  const p = new AudioBandwidthPolicy();
  for (let i = 0; i < 10; i++) assert.equal(p.observe(undefined), undefined);
  assert.equal(p.capped(), false);
});
