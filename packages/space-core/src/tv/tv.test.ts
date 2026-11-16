import assert from "node:assert/strict";
import { test } from "node:test";

import { ClockOffset, DriftGuard, expectedPosition, TV_DRIFT_SEEK_S, youtube } from "./tv.ts";

test("youtube: links of every shape give the id; anything else is refused", () => {
  const id = "dQw4w9WgXcQ";
  for (const input of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}?start=10`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `youtube.com/watch?v=${id}`,
    `  ${id}  `,
  ]) {
    assert.equal(youtube.parse(input), id, input);
  }
  for (const input of [
    "",
    "dQw4w9WgXc", // 10 chars
    "dQw4w9WgXcQQ", // 12 chars
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=<script>",
    "https://www.youtube.com/channel/UCabcdefghijk",
    "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
  ]) {
    assert.equal(youtube.parse(input), null, input);
  }
  assert.equal(youtube.valid(id), true);
  assert.equal(youtube.valid("../../etc/pas"), false);
});

test("expected position: frozen when paused, runs with the server clock when playing", () => {
  const state = { status: "playing" as const, pos_s: 10, ref_ms: 1_000_000 };
  assert.equal(expectedPosition(state, 1_000_000), 10);
  assert.equal(expectedPosition(state, 1_002_500), 12.5);
  assert.equal(expectedPosition({ ...state, status: "paused" }, 1_009_000), 10);
  assert.equal(expectedPosition({ ...state, pos_s: 0 }, 999_000), 0, "never negative");
});

test("drift guard: small drift is left alone; a drift seen twice seeks; seeks are spaced", () => {
  const g = new DriftGuard();
  assert.equal(g.check(10.2, 10, 0), null, "within tolerance");
  assert.equal(g.check(12, 10, 1_000), null, "first strike only");
  assert.equal(g.check(13, 11, 2_000), 11, "second strike: seek");
  assert.equal(g.check(14, 12, 3_000), null);
  assert.equal(g.check(15, 13, 4_000), null, "too soon after the last seek");
  assert.equal(g.check(16, 14, 5_100), 14, "after the gap");
  assert.equal(g.check(14 + TV_DRIFT_SEEK_S - 0.01, 14, 9_000), null);
  g.reset();
  assert.equal(g.check(20, 10, 9_100), null);
  assert.equal(g.check(21, 11, 9_200), 11, "reset clears the spacing too");
});

test("clock offset: the sample with the smallest round trip wins; bad samples ignored", () => {
  const c = new ClockOffset();
  assert.equal(c.ready, false);
  // Local clock 5 s behind the server.
  c.add(1_000, 1_300, 6_150); // rtt 300, offset 5000
  c.add(2_000, 2_040, 7_020); // rtt 40, offset 5000
  c.add(3_000, 3_400, 8_500); // rtt 400, offset 5300 (queued on the way back)
  c.add(4_000, 3_000, 9_000); // negative rtt: ignored
  assert.equal(c.ready, true);
  assert.equal(c.offsetMs, 5_000);
  assert.equal(c.bestRttMs, 40);
  assert.equal(c.serverNow(10_000), 15_000);
});
