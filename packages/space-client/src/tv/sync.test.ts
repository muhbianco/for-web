import assert from "node:assert/strict";
import { test } from "node:test";

import type { TvState } from "@muchat/space-core";

import type { PlayerState, TvPlayer } from "./player.ts";
import { TvSync } from "./sync.ts";

class FakePlayer implements TvPlayer {
  calls: string[] = [];
  t = 0;
  s: PlayerState = "unstarted";
  load(ref: string, startS: number, play: boolean) {
    this.calls.push(`load ${ref} ${startS.toFixed(1)} ${play}`);
    this.t = startS;
    this.s = play ? "playing" : "cued";
  }
  play() {
    this.calls.push("play");
    this.s = "playing";
  }
  pause() {
    this.calls.push("pause");
    this.s = "paused";
  }
  seek(s: number) {
    this.calls.push(`seek ${s.toFixed(1)}`);
    this.t = s;
  }
  time() {
    return this.t;
  }
  duration() {
    return 600;
  }
  title() {
    return "";
  }
  setVolume() {}
  state() {
    return this.s;
  }
  destroy() {}
}

const base: TvState = {
  room_id: "01JPVB00000000000000000000",
  app: "youtube",
  ref: "dQw4w9WgXcQ",
  status: "playing",
  pos_s: 0,
  ref_ms: 1_000_000,
  rev: 1,
  by: "u",
  by_name: "Ana",
  started_by: "u",
  started_ms: 1_000_000,
};

function setup(serverNow: { v: number }) {
  const p = new FakePlayer();
  const sync = new TvSync(p, () => serverNow.v);
  const check = () => (sync as unknown as { check: () => void }).check();
  return { p, sync, check };
}

test("A: a newcomer loads the video at the shared position and plays", () => {
  const now = { v: 1_042_000 };
  const { p, sync } = setup(now);
  sync.apply(base);
  assert.deepEqual(p.calls, ["load dQw4w9WgXcQ 42.0 true"]);
  sync.destroy();
});

test("A: pause, seek and play follow the state; nothing broadcast, nothing to fight", () => {
  const now = { v: 1_010_000 };
  const { p, sync } = setup(now);
  sync.apply(base);
  p.calls = [];
  sync.apply({ ...base, rev: 2, status: "paused", pos_s: 10.2, ref_ms: now.v });
  assert.deepEqual(p.calls, ["pause"], "already at 10 s: no seek needed (0.3 s tolerance)");
  p.calls = [];
  sync.apply({ ...base, rev: 3, status: "paused", pos_s: 60, ref_ms: now.v });
  assert.deepEqual(p.calls, ["pause", "seek 60.0"]);
  p.calls = [];
  now.v += 2_000;
  sync.apply({ ...base, rev: 4, status: "playing", pos_s: 60, ref_ms: now.v - 500 });
  assert.deepEqual(p.calls, ["seek 60.5", "play"], "resumes where the state says, clock included");
  p.calls = [];
  sync.apply(null);
  assert.deepEqual(p.calls, ["pause"], "TV off");
  sync.destroy();
});

test("A: drift above 0.75 s seen twice is corrected; buffering and small drift are left alone", () => {
  const now = { v: 1_000_000 };
  const { p, sync, check } = setup(now);
  sync.apply(base);
  p.calls = [];
  now.v += 5_000;
  p.t = 5.3; // 0.3 s ahead: fine
  check();
  assert.deepEqual(p.calls, []);
  p.t = 3; // 2 s behind
  check();
  assert.deepEqual(p.calls, [], "first time: wait");
  p.s = "buffering";
  check();
  assert.deepEqual(p.calls, [], "buffering: never chase");
  p.s = "playing";
  check();
  assert.deepEqual(p.calls, ["seek 5.0"], "seen twice while playing: seek to where everyone is");
  assert.ok(Math.abs(sync.lastDrift + 2) < 0.01);
  sync.destroy();
});

test("A: a different video replaces the current one (one at a time)", () => {
  const now = { v: 1_000_000 };
  const { p, sync } = setup(now);
  sync.apply(base);
  p.calls = [];
  sync.apply({ ...base, rev: 5, ref: "9bZkp7q19f0", pos_s: 0, ref_ms: now.v });
  assert.deepEqual(p.calls, ["load 9bZkp7q19f0 0.0 true"]);
  sync.destroy();
});
