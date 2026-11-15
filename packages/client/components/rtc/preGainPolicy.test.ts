import assert from "node:assert/strict";
import test from "node:test";

import {
  PRE_GAIN_MAX_DB,
  PRE_GAIN_UP_DB_PER_POLL,
  nextPreGainDb,
  updateActivityDb,
} from "../state/stores/noiseSuppressionPolicy.ts";

test("a normal talker gets no make-up gain", () => {
  let gain = 0;
  for (let i = 0; i < 50; i++) gain = nextPreGainDb(-22, gain);
  assert.equal(gain, 0);
});

test("a quiet talker is lifted slowly up to the cap", () => {
  // 24 dB under the reference: −48 dBFS RMS, the lab case that went mute.
  let gain = 0;
  const steps = [];
  for (let i = 0; i < 60; i++) {
    gain = nextPreGainDb(-48, gain);
    steps.push(gain);
  }
  assert.ok(Math.abs(steps[0] - PRE_GAIN_UP_DB_PER_POLL) < 1e-9, "one step per poll");
  assert.equal(gain, PRE_GAIN_MAX_DB, "capped at the maximum");
  // 3 dB/s: 18 dB takes 30 polls of 200 ms = 6 s.
  assert.equal(steps.findIndex((g) => g === PRE_GAIN_MAX_DB), 29);
});

test("gain comes back down faster than it went up", () => {
  let gain = 12;
  gain = nextPreGainDb(-20, gain);
  assert.ok(gain < 12 - PRE_GAIN_UP_DB_PER_POLL, "down step is larger than up step");
  for (let i = 0; i < 20; i++) gain = nextPreGainDb(-20, gain);
  assert.equal(gain, 0);
});

test("no activity measured keeps the gain where it is", () => {
  assert.equal(nextPreGainDb(undefined, 7.2), 7.2);
});

test("activity ignores polls at the noise floor and dead mics", () => {
  assert.equal(updateActivityDb(undefined, -50, -55), undefined, "5 dB above the floor is not speech");
  assert.equal(updateActivityDb(undefined, -80, -120), undefined, "below −70 dBFS is a dead mic");
  const first = updateActivityDb(undefined, -40, -60);
  assert.equal(first, -40);
  const louder = updateActivityDb(first, -30, -60);
  assert.equal(louder, -30, "a louder poll is taken at once (peak-hold)");
  const quieter = updateActivityDb(louder, -45, -60);
  assert.equal(quieter, -30.5, "a quieter poll only lets the hold decay");
});
