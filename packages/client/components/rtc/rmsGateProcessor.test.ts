import assert from "node:assert/strict";
import test from "node:test";

import {
  RMS_GATE_PROCESSOR_NAME,
  buildRmsGateProcessorSource,
} from "./rmsGateProcessor.ts";

interface Processor {
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

/** Evaluate the worklet script with the two globals AudioWorkletGlobalScope provides. */
function instantiate(): Processor {
  let registered: (new () => Processor) | undefined;
  const scope = {
    AudioWorkletProcessor: class {
      port = { postMessage() {} };
    },
    registerProcessor(name: string, ctor: new () => Processor) {
      assert.equal(name, RMS_GATE_PROCESSOR_NAME);
      registered = ctor;
    },
  };
  const source = buildRmsGateProcessorSource({
    defaultOpen: 0.01,
    defaultClose: 0.004,
    openRmsMin: 0.002,
    openRmsMax: 0.04,
    hysteresis: 0.4,
    autoOpenFloor: 0.003,
    autoOpenCap: 0.018,
  });
  new Function("AudioWorkletProcessor", "registerProcessor", source)(
    scope.AudioWorkletProcessor,
    scope.registerProcessor,
  );
  assert.ok(registered, "worklet did not register a processor");
  return new registered();
}

const params = {
  openThreshold: new Float32Array([0.01]),
  closeThreshold: new Float32Array([0.004]),
  autoMode: new Float32Array([0]),
};

test("loud speech opens the gate and reaches every output channel", () => {
  const gate = instantiate();
  const input = new Float32Array(128).fill(0.5);
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  // A few quanta so the gain ramp settles.
  for (let i = 0; i < 8; i++) {
    gate.process([[input]], [[left, right]], params);
  }
  assert.ok(left[127] > 0.45, `left channel silent: ${left[127]}`);
  assert.deepEqual(Array.from(right), Array.from(left));
});

test("no input silences every output channel", () => {
  const gate = instantiate();
  const left = new Float32Array(128).fill(1);
  const right = new Float32Array(128).fill(1);
  gate.process([[]], [[left, right]], params);
  assert.equal(
    left.some((v) => v !== 0),
    false,
  );
  assert.equal(
    right.some((v) => v !== 0),
    false,
  );
});

test("quiet input keeps the gate closed", () => {
  const gate = instantiate();
  const input = new Float32Array(128).fill(0.001);
  const out = new Float32Array(128);
  for (let i = 0; i < 8; i++) gate.process([[input]], [[out]], params);
  assert.equal(
    out.some((v) => Math.abs(v) > 1e-6),
    false,
  );
});
