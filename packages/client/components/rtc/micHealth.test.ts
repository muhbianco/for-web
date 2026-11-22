import assert from "node:assert/strict";
import test from "node:test";

import {
  type MicHealthInput,
  decideMicHeal,
  MIC_UNMUTE_RESTART_INTERVAL_MS,
  MIC_WATCHDOG_RESTART_AFTER_MS,
  MIC_WATCHDOG_RESTART_INTERVAL_MS,
  micBlocked,
} from "./micHealth.ts";

const base: MicHealthInput = {
  micOn: true,
  upstreamPaused: false,
  sourceState: "live",
  sourceMuted: false,
  pausedForMs: 0,
  sinceLastRestartMs: Number.POSITIVE_INFINITY,
  reason: "unmute",
};

test("does nothing while the person keeps the mic closed", () => {
  assert.equal(
    decideMicHeal({ ...base, micOn: false, upstreamPaused: true }),
    "none",
  );
});

test("does nothing on a healthy mic", () => {
  assert.equal(decideMicHeal(base), "none");
  assert.equal(decideMicHeal({ ...base, reason: "watchdog" }), "none");
});

test("resumes the upstream left paused after the device came back (the limbo)", () => {
  // Reproduced in qa/voice-lab/limbo.mjs: unmute alone kept 0 pkt/s.
  assert.equal(decideMicHeal({ ...base, upstreamPaused: true }), "resume");
  assert.equal(
    decideMicHeal({ ...base, upstreamPaused: true, reason: "watchdog" }),
    "resume",
  );
});

test("re-acquires on unmute when the OS still mutes the device", () => {
  assert.equal(
    decideMicHeal({ ...base, upstreamPaused: true, sourceMuted: true }),
    "restart",
  );
});

test("does not re-acquire again within a few seconds of the last try", () => {
  assert.equal(
    decideMicHeal({
      ...base,
      upstreamPaused: true,
      sourceMuted: true,
      sinceLastRestartMs: MIC_UNMUTE_RESTART_INTERVAL_MS - 1,
    }),
    "none",
  );
});

test("the watchdog waits for the OS before re-opening the device", () => {
  const muted: MicHealthInput = {
    ...base,
    upstreamPaused: true,
    sourceMuted: true,
    reason: "watchdog",
  };
  assert.equal(
    decideMicHeal({ ...muted, pausedForMs: MIC_WATCHDOG_RESTART_AFTER_MS - 1 }),
    "none",
  );
  assert.equal(
    decideMicHeal({ ...muted, pausedForMs: MIC_WATCHDOG_RESTART_AFTER_MS }),
    "restart",
  );
  assert.equal(
    decideMicHeal({
      ...muted,
      pausedForMs: MIC_WATCHDOG_RESTART_AFTER_MS,
      sinceLastRestartMs: MIC_WATCHDOG_RESTART_INTERVAL_MS - 1,
    }),
    "none",
  );
});

test("a capture that ended while the mic was open is restarted", () => {
  assert.equal(decideMicHeal({ ...base, sourceState: "ended" }), "restart");
  assert.equal(
    decideMicHeal({
      ...base,
      sourceState: "ended",
      reason: "watchdog",
      sinceLastRestartMs: 1000,
    }),
    "none",
  );
});

test("micBlocked warns only for an open mic in a call", () => {
  assert.equal(
    micBlocked({ micOn: true, inCall: true, upstreamPaused: true }),
    true,
  );
  assert.equal(
    micBlocked({ micOn: true, inCall: true, sourceMuted: true }),
    true,
  );
  assert.equal(
    micBlocked({ micOn: true, inCall: true, sourceState: "ended" }),
    true,
  );
  assert.equal(
    micBlocked({ micOn: false, inCall: true, sourceMuted: true }),
    false,
  );
  assert.equal(
    micBlocked({ micOn: true, inCall: false, sourceMuted: true }),
    false,
  );
  assert.equal(micBlocked({ micOn: true, inCall: true }), false);
});
