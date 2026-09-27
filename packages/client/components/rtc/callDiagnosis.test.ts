import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCELERATED_MS_PER_SEC_BAD,
  DSP_SLOW_RATIO_BAD,
  JITTER_MS_BAD,
  LOSS_PCT_BAD,
  diagnoseCall,
} from "./callDiagnosis.ts";
import type { CallStatsSnapshot, ParticipantCallStats } from "./callStats.ts";
import { DF_SLOW_RATIO } from "./deepFilterHealth.ts";

const QUALITY = "excellent" as ParticipantCallStats["quality"];

function peer(
  name: string,
  audio: ParticipantCallStats["audio"],
): ParticipantCallStats {
  return { identity: name, name, quality: QUALITY, audio };
}

function snapshot(
  participants: ParticipantCallStats[],
  self: Partial<CallStatsSnapshot["self"]> = {},
): CallStatsSnapshot {
  return {
    inCall: true,
    updatedAt: 1,
    self: { quality: QUALITY, video: [], ...self },
    participants,
  };
}

const HEALTHY = { jitterMs: 4, lossPct: 0, acceleratedMsPerSec: 0 };
const ACCELERATED = {
  jitterMs: 60,
  lossPct: 6,
  acceleratedMsPerSec: ACCELERATED_MS_PER_SEC_BAD + 30,
};

test("no sample yet is not a verdict", () => {
  assert.equal(
    diagnoseCall({ ...snapshot([]), updatedAt: undefined }).kind,
    "waiting",
  );
  assert.equal(
    diagnoseCall({ ...snapshot([]), inCall: false }).kind,
    "waiting",
  );
});

test("a healthy call says so", () => {
  assert.equal(diagnoseCall(snapshot([peer("gabriel", HEALTHY)])).kind, "ok");
});

test("one bad peer out of several is their connection", () => {
  const verdict = diagnoseCall(
    snapshot([peer("gabriel", ACCELERATED), peer("ana", HEALTHY)]),
  );
  assert.equal(verdict.kind, "remote-network");
  assert.equal(verdict.who, "gabriel");
  assert.match(verdict.detail ?? "", /acelerado/);
});

test("everyone bad at once is our own download", () => {
  const verdict = diagnoseCall(
    snapshot([peer("gabriel", ACCELERATED), peer("ana", ACCELERATED)]),
  );
  assert.equal(verdict.kind, "local-downlink");
});

test("a single peer in the call is still blamed on them, not on us", () => {
  // With one peer there is nothing to compare against, so "everyone is bad"
  // must not fire on a sample size of one.
  const verdict = diagnoseCall(snapshot([peer("gabriel", ACCELERATED)]));
  assert.equal(verdict.kind, "remote-network");
});

test("CPU beats network: a saturated encoder is diagnosed first", () => {
  const verdict = diagnoseCall(
    snapshot([peer("gabriel", ACCELERATED)], {
      video: [{ source: "screenshare", limitedBy: "cpu" }],
    }),
  );
  assert.equal(verdict.kind, "local-cpu");
});

test("a slow noise filter is a CPU verdict even with a clean network", () => {
  const verdict = diagnoseCall(snapshot([peer("gabriel", HEALTHY)]), {
    deepFilterOverloaded: true,
  });
  assert.equal(verdict.kind, "local-cpu");
});

test("our own upload loss is ours, not the peer's", () => {
  const verdict = diagnoseCall(
    snapshot([peer("gabriel", ACCELERATED)], {
      audio: { lossPct: LOSS_PCT_BAD + 2 },
    }),
  );
  assert.equal(verdict.kind, "local-uplink");
});

test("with two peers suffering and one fine, the worst is the one named", () => {
  const mild = { jitterMs: JITTER_MS_BAD + 1, lossPct: 0 };
  const verdict = diagnoseCall(
    snapshot([
      peer("ana", mild),
      peer("gabriel", ACCELERATED),
      peer("bia", HEALTHY),
    ]),
  );
  assert.equal(verdict.kind, "remote-network");
  assert.equal(verdict.who, "gabriel");
});

test("the duplicated DSP threshold stays in sync with deepFilterHealth", () => {
  // callDiagnosis cannot import it at runtime and stay testable, so this is
  // the guard against the two drifting apart.
  assert.equal(DSP_SLOW_RATIO_BAD, DF_SLOW_RATIO);
});
