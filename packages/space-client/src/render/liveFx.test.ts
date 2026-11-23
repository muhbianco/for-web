import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LIVE_BLINK_MS,
  LIVE_WAVE_MS,
  LIVE_WAVES,
  livePulse,
  onSharer,
} from "./liveFx.ts";

test("the waves widen from the feet and fade as they go", () => {
  const a = livePulse(0).waves[0]!;
  const b = livePulse(LIVE_WAVE_MS * 0.4).waves[0]!;
  const c = livePulse(LIVE_WAVE_MS * 0.9).waves[0]!;
  assert.ok(a.rx < b.rx && b.rx < c.rx, "wider");
  assert.ok(a.ry < b.ry && b.ry < c.ry, "taller");
  assert.ok(a.alpha > b.alpha && b.alpha > c.alpha, "fainter");
  assert.ok(c.alpha > 0 && c.alpha < 0.2);
});

test("the waves loop and stay evenly spread", () => {
  const p = livePulse(123);
  assert.equal(p.waves.length, LIVE_WAVES);
  assert.deepEqual(livePulse(123 + LIVE_WAVE_MS).waves, p.waves);
  // Two waves half a period apart: never both at the feet.
  assert.notEqual(p.waves[0]!.rx, p.waves[1]!.rx);
});

test("the red dot blinks and the screen bobs by one pixel", () => {
  assert.equal(livePulse(0).dot, true);
  assert.equal(livePulse(LIVE_BLINK_MS * 0.9).dot, false);
  const bobs = new Set<number>();
  for (let t = 0; t < 3000; t += 50) bobs.add(livePulse(t).bob);
  assert.deepEqual([...bobs].sort(), [-1, 0]);
});

test("two people sharing side by side are out of step", () => {
  assert.notDeepEqual(livePulse(500, 0).waves, livePulse(500, 777).waves);
});

test("reduced motion: one still picture", () => {
  const a = livePulse(0, 0, true);
  assert.deepEqual(livePulse(987, 42, true), a);
  assert.equal(a.bob, 0);
  assert.equal(a.dot, true);
  assert.ok(a.waves.length > 0);
});

test("a click on the body or on the screen above it hits the sharer", () => {
  assert.ok(onSharer(100, 200, 100, 200), "feet");
  assert.ok(onSharer(105, 170, 100, 200), "body");
  assert.ok(onSharer(98, 135, 100, 200), "the screen over the head");
  assert.ok(onSharer(112, 120, 100, 200), "its AO VIVO tag");
  assert.ok(!onSharer(120, 180, 100, 200), "beside");
  assert.ok(!onSharer(100, 100, 100, 200), "far above");
  assert.ok(!onSharer(100, 210, 100, 200), "below");
});
