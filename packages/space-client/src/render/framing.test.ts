import assert from "node:assert/strict";
import { test } from "node:test";

import { clampAxis, fitZoom } from "./framing.ts";

test("a phone frames the room at 1, a computer at 2", () => {
  assert.equal(fitZoom(393, 780), 1, "phone in portrait");
  assert.equal(fitZoom(360, 690), 1, "small phone");
  assert.equal(fitZoom(851, 345), 1, "phone in landscape");
  assert.equal(fitZoom(520, 1230), 1, "tablet in portrait beside the app's sidebar");
  assert.equal(fitZoom(976, 740), 2, "tablet in landscape");
  assert.equal(fitZoom(1320, 850), 2, "computer");
});

test("never past the computer's zoom, never below 1", () => {
  assert.equal(fitZoom(3840, 2000), 2);
  assert.equal(fitZoom(100, 100), 1);
  assert.equal(fitZoom(0, 0), 1);
  assert.equal(fitZoom(Number.NaN, 500), 1);
});

test("the camera stops at the map's edge instead of showing the void", () => {
  // A map 0..1000 wide, 200 world px visible on each side of the centre.
  assert.equal(clampAxis(500, 200, 0, 1000), 500, "in the middle: on you");
  assert.equal(clampAxis(50, 200, 0, 1000), 200, "near the left edge: the edge stays put");
  assert.equal(clampAxis(990, 200, 0, 1000), 800, "near the right edge");
  // A map narrower than the screen: in the middle, wherever you stand.
  assert.equal(clampAxis(10, 600, 0, 1000), 500);
  assert.equal(clampAxis(990, 600, 0, 1000), 500);
});
