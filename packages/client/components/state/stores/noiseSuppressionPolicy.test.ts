import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNoiseSuppressionSchema,
  captureAutoGainEnabled,
  captureBrowserNoiseSuppression,
  isNoiseSuppressionMode,
  NOISE_SUPPRESSION_SCHEMA,
} from "./noiseSuppressionPolicy.ts";

test("rolls the broken DeepFilter default back to RNNoise once", () => {
  assert.deepEqual(applyNoiseSuppressionSchema("advanced", undefined), {
    noiseSupression: "enhanced",
    noiseSuppressionSchema: NOISE_SUPPRESSION_SCHEMA,
  });
  assert.deepEqual(applyNoiseSuppressionSchema("advanced", 0), {
    noiseSupression: "enhanced",
    noiseSuppressionSchema: NOISE_SUPPRESSION_SCHEMA,
  });
});

test("keeps an explicit DeepFilter choice after the schema bump", () => {
  assert.deepEqual(applyNoiseSuppressionSchema("advanced", 1), {
    noiseSupression: "advanced",
    noiseSuppressionSchema: 1,
  });
});

test("does not rewrite RNNoise or browser on migrate", () => {
  assert.equal(
    applyNoiseSuppressionSchema("enhanced", undefined).noiseSupression,
    "enhanced",
  );
  assert.equal(
    applyNoiseSuppressionSchema("browser", undefined).noiseSupression,
    "browser",
  );
});

test("AGC is forced off for ML noise suppression", () => {
  assert.equal(captureAutoGainEnabled("advanced", true), false);
  assert.equal(captureAutoGainEnabled("enhanced", true), false);
  assert.equal(captureAutoGainEnabled("browser", true), true);
  assert.equal(captureAutoGainEnabled("disabled", false), false);
});

test("browser NS constraint only in browser mode", () => {
  assert.equal(captureBrowserNoiseSuppression("browser"), true);
  assert.equal(captureBrowserNoiseSuppression("enhanced"), false);
  assert.equal(isNoiseSuppressionMode("advanced"), true);
  assert.equal(isNoiseSuppressionMode("true"), false);
});
