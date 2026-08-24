import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNoiseSuppressionSchema,
  captureAutoGainEnabled,
  captureBrowserNoiseSuppression,
  clampInputSensitivity,
  DEFAULT_INPUT_SENSITIVITY,
  GATE_HYSTERESIS,
  GATE_OPEN_RMS_MAX,
  GATE_OPEN_RMS_MIN,
  gateThresholdsFromSensitivity,
  isNoiseSuppressionMode,
  NOISE_SUPPRESSION_SCHEMA,
  rmsToMeter,
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

test("sensitivity slider maps to a wider gate at the left", () => {
  const quiet = gateThresholdsFromSensitivity(0);
  const tight = gateThresholdsFromSensitivity(1);
  const mid = gateThresholdsFromSensitivity(DEFAULT_INPUT_SENSITIVITY);
  assert.ok(quiet.open < mid.open);
  assert.ok(mid.open < tight.open);
  assert.equal(quiet.close, quiet.open * GATE_HYSTERESIS);
  assert.equal(quiet.open, GATE_OPEN_RMS_MIN);
  assert.equal(tight.open, GATE_OPEN_RMS_MAX);
  assert.ok(mid.open < 0.02);
});

test("sensitivity clamp and meter stay in range", () => {
  assert.equal(clampInputSensitivity(undefined), DEFAULT_INPUT_SENSITIVITY);
  assert.equal(clampInputSensitivity(-2), 0);
  assert.equal(clampInputSensitivity(4), 1);
  assert.equal(rmsToMeter(0), 0);
  assert.equal(rmsToMeter(GATE_OPEN_RMS_MIN), 0);
  assert.equal(rmsToMeter(GATE_OPEN_RMS_MAX), 1);
  assert.equal(rmsToMeter(GATE_OPEN_RMS_MAX * 4), 1);
});
