import assert from "node:assert/strict";
import test from "node:test";

import {
  SWM_COOLDOWN_MS,
  SpeakingWhileMutedDetector,
  shouldShowSpeakingWhileMuted,
} from "./speakingWhileMuted.ts";

/** Feeds levels (one per 100 ms tick) and returns the ticks where it fired. */
function run(levels: number[]) {
  const d = new SpeakingWhileMutedDetector();
  return levels.flatMap((l, i) => (d.update(l) ? [i] : []));
}
const repeat = (db: number, n: number) => Array<number>(n).fill(db);

test("fires once when speech starts over a quiet room", () => {
  // Third speech tick: 300 ms of speech within 500 ms.
  assert.deepEqual(run([...repeat(-70, 20), ...repeat(-30, 20)]), [22]);
});

test("one sentence with short pauses is one event", () => {
  const sentence = [-30, -30, -32, -70, -31, -29, -70, -30, -33, -31];
  assert.equal(run([...repeat(-70, 10), ...sentence, ...sentence]).length, 1);
});

test("fires again after a real silence", () => {
  const fired = run([
    ...repeat(-70, 10),
    ...repeat(-30, 10),
    ...repeat(-70, 10),
    ...repeat(-30, 10),
  ]);
  assert.equal(fired.length, 2);
});

test("a single click or cough does not count", () => {
  assert.deepEqual(run([...repeat(-70, 10), -20, ...repeat(-70, 10)]), []);
});

test("a level below -50 dBFS is too close to noise to call speech", () => {
  assert.deepEqual(run([...repeat(-80, 10), ...repeat(-55, 10)]), []);
});

test("steady loud noise from the start never reads as speech", () => {
  assert.deepEqual(run(repeat(-35, 60)), []);
});

test("noise that starts mid-call stops counting once the floor catches up", () => {
  // A fan switched on: one event at most, and none once the floor rose.
  const fired = run([...repeat(-70, 10), ...repeat(-40, 120)]);
  assert.ok(fired.length <= 1, `fired ${fired.length} times`);
  assert.deepEqual(
    fired.filter((i) => i > 60),
    [],
  );
});

test("reset forgets the floor and the sentence in progress", () => {
  const d = new SpeakingWhileMutedDetector();
  for (const l of [...repeat(-70, 5), ...repeat(-30, 5)]) d.update(l);
  d.reset();
  const fired = [...repeat(-70, 5), ...repeat(-30, 5)].flatMap((l, i) =>
    d.update(l) ? [i] : [],
  );
  assert.deepEqual(fired, [7]);
});

test("digital silence (-Infinity) reads as quiet", () => {
  assert.deepEqual(run([...repeat(-Infinity, 10), ...repeat(-30, 5)]), [12]);
});

const base = {
  now: 1_000_000,
  lastShownAt: undefined,
  muted: true,
  inCall: true,
  canSpeak: true,
};

test("the notice shows the first time while muted in a call", () => {
  assert.equal(shouldShowSpeakingWhileMuted(base), true);
});

test("the notice waits the cooldown (Discord: 2 min)", () => {
  assert.equal(
    shouldShowSpeakingWhileMuted({ ...base, lastShownAt: base.now - 60_000 }),
    false,
  );
  assert.equal(
    shouldShowSpeakingWhileMuted({
      ...base,
      lastShownAt: base.now - SWM_COOLDOWN_MS,
    }),
    true,
  );
});

test("never with the mic open, out of a call or without permission to speak", () => {
  assert.equal(shouldShowSpeakingWhileMuted({ ...base, muted: false }), false);
  assert.equal(shouldShowSpeakingWhileMuted({ ...base, inCall: false }), false);
  assert.equal(
    shouldShowSpeakingWhileMuted({ ...base, canSpeak: false }),
    false,
  );
});
