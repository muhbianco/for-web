import assert from "node:assert/strict";
import test from "node:test";

import {
  applyNoiseSuppressionSchema,
  attenDbFromNoiseFloor,
  captureAutoGainEnabled,
  captureBrowserNoiseSuppression,
  clampInputSensitivity,
  DEEPFILTER_ATTEN_DB,
  DEEPFILTER_AUTO_ATTEN_MAX_DB,
  DEEPFILTER_AUTO_ATTEN_MIN_DB,
  DEEPFILTER_AUTO_STEP_DB,
  deepFilterAttenDb,
  DEFAULT_INPUT_SENSITIVITY,
  GATE_HYSTERESIS,
  GATE_OPEN_RMS_MAX,
  GATE_OPEN_RMS_MIN,
  gateThresholdsFromSensitivity,
  isNoiseSuppressionMode,
  NOISE_SUPPRESSION_SCHEMA,
  rmsToDbfs,
  rmsToMeter,
} from "./noiseSuppressionPolicy.ts";

test("schema < 2 moves every stored mode to DeepFilter auto once", () => {
  for (const stored of [
    "enhanced",
    "browser",
    "disabled",
    "advanced",
  ] as const) {
    for (const schema of [undefined, 0, 1]) {
      assert.deepEqual(applyNoiseSuppressionSchema(stored, schema, "strong"), {
        noiseSupression: "advanced",
        noiseSuppressionSchema: NOISE_SUPPRESSION_SCHEMA,
        deepFilterSensitivity: "auto",
      });
    }
  }
});

test("schema 2 keeps the user's explicit choices", () => {
  assert.deepEqual(applyNoiseSuppressionSchema("enhanced", 2, "medium"), {
    noiseSupression: "enhanced",
    noiseSuppressionSchema: 2,
    deepFilterSensitivity: "medium",
  });
  assert.deepEqual(applyNoiseSuppressionSchema("advanced", 3, undefined), {
    noiseSupression: "advanced",
    noiseSuppressionSchema: 3,
    deepFilterSensitivity: "auto",
  });
});

test("new profiles default to DeepFilter auto", () => {
  assert.deepEqual(applyNoiseSuppressionSchema(undefined, undefined), {
    noiseSupression: "advanced",
    noiseSuppressionSchema: NOISE_SUPPRESSION_SCHEMA,
    deepFilterSensitivity: "auto",
  });
});

test("fixed presets map to their attenuation limits", () => {
  assert.equal(deepFilterAttenDb("light"), DEEPFILTER_ATTEN_DB.light);
  assert.equal(deepFilterAttenDb("medium"), DEEPFILTER_ATTEN_DB.medium);
  assert.equal(deepFilterAttenDb("strong"), DEEPFILTER_ATTEN_DB.strong);
  assert.ok(DEEPFILTER_ATTEN_DB.light < DEEPFILTER_ATTEN_DB.medium);
  assert.ok(DEEPFILTER_ATTEN_DB.medium < DEEPFILTER_ATTEN_DB.strong);
});

test("auto preset follows the noise floor", () => {
  // No measurement yet: start strong, never silent-with-noise.
  assert.equal(deepFilterAttenDb("auto"), DEEPFILTER_ATTEN_DB.strong);
  assert.equal(attenDbFromNoiseFloor(-90), DEEPFILTER_AUTO_ATTEN_MIN_DB);
  assert.equal(attenDbFromNoiseFloor(-60), DEEPFILTER_AUTO_ATTEN_MIN_DB);
  assert.equal(attenDbFromNoiseFloor(-40), DEEPFILTER_AUTO_ATTEN_MAX_DB);
  assert.equal(attenDbFromNoiseFloor(-10), DEEPFILTER_AUTO_ATTEN_MAX_DB);
  const mid = attenDbFromNoiseFloor(-50);
  assert.ok(mid > DEEPFILTER_AUTO_ATTEN_MIN_DB);
  assert.ok(mid < DEEPFILTER_AUTO_ATTEN_MAX_DB);
  assert.equal(mid % DEEPFILTER_AUTO_STEP_DB, 0);
  assert.equal(attenDbFromNoiseFloor(Number.NaN), DEEPFILTER_ATTEN_DB.strong);
  assert.equal(deepFilterAttenDb("auto", -70), DEEPFILTER_AUTO_ATTEN_MIN_DB);
});

test("rms to dBFS clamps silence", () => {
  assert.equal(rmsToDbfs(0), -120);
  assert.equal(rmsToDbfs(1), 0);
  assert.ok(Math.abs(rmsToDbfs(0.1) + 20) < 1e-9);
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
