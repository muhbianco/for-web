import assert from "node:assert/strict";
import test from "node:test";

import {
  RMS_QUIET_HOLD_QUANTA,
  VAD_CLOSE,
  VAD_FRAME_QUANTA,
  VAD_FRAME_SAMPLES_16K,
  VAD_HOLD_QUANTA,
  VAD_LOOKAHEAD_48K,
  VAD_OPEN,
  createDecimatorState,
  decideGate,
  pushDecimated,
} from "./vadPolicy.ts";

const base = {
  openTh: 0.01,
  closeTh: 0.004,
  vadOpen: VAD_OPEN,
  vadClose: VAD_CLOSE,
  vadHoldQuanta: VAD_HOLD_QUANTA,
  quietHoldQuanta: RMS_QUIET_HOLD_QUANTA,
};

test("frame geometry: 512 samples at 16 kHz is 12 quanta at 48 kHz", () => {
  assert.equal(VAD_LOOKAHEAD_48K, 1536);
  assert.equal(VAD_FRAME_QUANTA, 12);
});

test("without VAD the gate is the legacy RMS gate", () => {
  const s = { open: false, hold: 0 };
  decideGate(s, { ...base, rms: 0.5, prob: -1, vadActive: false });
  assert.equal(s.open, true);
  decideGate(s, { ...base, rms: 0.001, prob: -1, vadActive: false });
  assert.equal(s.open, false, "closes immediately when quiet");
});

test("a loud bark with low speech probability never opens", () => {
  const s = { open: false, hold: 0 };
  for (let i = 0; i < 200; i++) {
    decideGate(s, { ...base, rms: 0.6, prob: 0.05, vadActive: true });
  }
  assert.equal(s.open, false);
});

test("speech opens only when both loud and probable", () => {
  const s = { open: false, hold: 0 };
  decideGate(s, { ...base, rms: 0.001, prob: 0.95, vadActive: true });
  assert.equal(s.open, false, "quiet speech-like noise stays closed");
  decideGate(s, { ...base, rms: 0.3, prob: 0.9, vadActive: true });
  assert.equal(s.open, true);
});

test("pauses between words survive the hold; a long bark does not", () => {
  const s = { open: true, hold: 0 };
  // Loud but non-speech for less than the hold: stays open.
  for (let i = 0; i < VAD_HOLD_QUANTA - 1; i++) {
    decideGate(s, { ...base, rms: 0.3, prob: 0.1, vadActive: true });
  }
  assert.equal(s.open, true);
  // Speech resumes: hold resets.
  decideGate(s, { ...base, rms: 0.3, prob: 0.9, vadActive: true });
  assert.equal(s.hold, 0);
  // Sustained loud non-speech closes after the hold.
  for (let i = 0; i < VAD_HOLD_QUANTA; i++) {
    decideGate(s, { ...base, rms: 0.3, prob: 0.1, vadActive: true });
  }
  assert.equal(s.open, false);
});

test("quiet input closes after the short lookahead hold", () => {
  const s = { open: true, hold: 0 };
  for (let i = 0; i < RMS_QUIET_HOLD_QUANTA - 1; i++) {
    decideGate(s, { ...base, rms: 0.001, prob: 0.9, vadActive: true });
  }
  assert.equal(s.open, true, "tail of the word is still passing");
  decideGate(s, { ...base, rms: 0.001, prob: 0.9, vadActive: true });
  assert.equal(s.open, false);
});

test("decimator turns 12 quanta into exactly one 512-sample frame", () => {
  const state = createDecimatorState(VAD_FRAME_SAMPLES_16K);
  const quantum = new Float32Array(128);
  let full = 0;
  for (let q = 0; q < 12; q++) {
    for (let i = 0; i < 128; i++) quantum[i] = q * 128 + i;
    if (pushDecimated(state, quantum)) full++;
  }
  assert.equal(full, 1);
  assert.equal(state.frameLen, VAD_FRAME_SAMPLES_16K);
  assert.equal(state.carryLen, 0);
  // Each output is the mean of three consecutive inputs.
  assert.equal(state.frame[0], 1);
  assert.equal(state.frame[1], 4);
  assert.equal(state.frame[511], 1534);
});

test("decimator carries the leftover across quantum boundaries", () => {
  const state = createDecimatorState(8);
  // 128 = 42*3 + 2 → two samples carried.
  const first = new Float32Array(128).fill(3);
  assert.equal(pushDecimated(state, first), true);
  assert.equal(state.carryLen, 2);
  state.frameLen = 0;
  const second = new Float32Array(128).fill(9);
  pushDecimated(state, second);
  // First output mixes 2 carried 3s with one 9.
  assert.ok(Math.abs(state.frame[0] - 5) < 1e-6);
  assert.equal(state.frame[1], 9);
});
