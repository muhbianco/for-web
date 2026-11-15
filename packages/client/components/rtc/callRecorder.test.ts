import assert from "node:assert/strict";
import test from "node:test";

import { diagnoseCall } from "./callDiagnosis.ts";
import {
  type TimelineEntry,
  CallRecorder,
  percentiles,
  summarizeTimeline,
} from "./callRecorder.ts";
import type { CallStatsSnapshot } from "./callStats.ts";

const QUALITY = "excellent" as CallStatsSnapshot["self"]["quality"];

function snapshot(
  audio: Partial<NonNullable<CallStatsSnapshot["participants"][0]["audio"]>>,
  extra: Partial<CallStatsSnapshot> = {},
): CallStatsSnapshot {
  return {
    inCall: true,
    updatedAt: 1,
    self: {
      quality: QUALITY,
      video: [],
      audio: { rttMs: 250, bitrateKbps: 46, codec: { mimeType: "audio/opus", channels: 2, fmtp: "minptime=10;useinbandfec=1" } },
    },
    participants: [
      {
        identity: "u1",
        name: "Gabriel",
        quality: QUALITY,
        audio: { packetsInWindow: 100, jitterMs: 2, lossPct: 0, ...audio },
      },
    ],
    transport: {
      publisher: {
        role: "publisher",
        protocol: "udp",
        localCandidateType: "srflx",
        remoteCandidateType: "host",
        usesRelay: false,
        remotePort: 7882,
        currentRttMs: 246,
        availableOutgoingKbps: 1200,
      },
    },
    reconnects: 0,
    signalReconnects: 0,
    ...extra,
  };
}

test("percentiles ignore undefined and order values", () => {
  const p = percentiles([5, undefined, 1, 9, 3]);
  // Nearest-rank on 4 samples: p95 lands on the third value, max is the 4th.
  assert.deepEqual(p, { n: 4, min: 1, p50: 3, p95: 5, max: 9 });
  assert.equal(percentiles([undefined]), undefined);
});

test("summary aggregates per participant and keeps the path", () => {
  const timeline: TimelineEntry[] = [
    { t: 0, stats: snapshot({ concealedMsPerSec: 0 }), verdict: "ok" },
    { t: 2000, stats: snapshot({ concealedMsPerSec: 40 }), verdict: "local-playout" },
    // Silence window: must not count towards speech percentiles.
    { t: 4000, stats: snapshot({ packetsInWindow: 3, concealedMsPerSec: 500 }), verdict: "no-data" },
    { t: 6000, stats: snapshot({}, { reconnects: 1 }), verdict: "ok" },
  ];
  const s = summarizeTimeline(timeline);
  assert.equal(s.participants.length, 1);
  assert.equal(s.participants[0].speechWindows, 3);
  assert.equal(s.participants[0].concealedMsPerSec?.max, 40);
  assert.equal(s.verdicts.ok, 2);
  assert.equal(s.verdicts["local-playout"], 1);
  assert.equal(s.path.publisher?.remotePort, 7882);
  assert.equal(s.path.rttBucket, "200-300ms");
  assert.equal(s.reconnects, 1);
  assert.match(s.self.codec ?? "", /opus/);
});

test("recorder produces a report with timeline and events", () => {
  const recorder = new CallRecorder(diagnoseCall);
  assert.equal(recorder.stop(), undefined);
  recorder.start({ room: "r1" });
  recorder.connected({ identity: "me" });
  recorder.push(snapshot({}));
  recorder.push(snapshot({ acceleratedMsPerSec: 30 }));
  recorder.event("participantConnected", "u1");
  const report = recorder.stop();
  assert.ok(report);
  assert.equal(report.room, "r1");
  assert.equal(report.localIdentity, "me");
  assert.equal(report.windows, 2);
  assert.equal(report.timeline.length, 2);
  assert.ok(report.events.some((e) => e.kind === "participantConnected"));
  assert.equal(report.verdicts["local-playout"], 1);
  assert.equal(recorder.active, false);
});
