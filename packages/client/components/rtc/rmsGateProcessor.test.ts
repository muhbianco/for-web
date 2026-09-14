import assert from "node:assert/strict";
import test from "node:test";

import {
  RMS_GATE_PROCESSOR_NAME,
  buildRmsGateProcessorSource,
} from "./rmsGateProcessor.ts";
import {
  createDecimatorState,
  decideGate,
  pushDecimated,
} from "./vadPolicy.ts";

interface Processor {
  port: FakePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

/** Minimal MessagePort stand-in: records posts, lets tests inject messages. */
class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  transfers: unknown[][] = [];
  postMessage(data: unknown, transfer?: unknown[]) {
    this.posted.push(data);
    if (transfer) this.transfers.push(transfer);
  }
  start() {}
  close() {}
  /** Deliver a message to whoever is listening on this end. */
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}

const LOOKAHEAD = 1536;
const STALE_QUANTA = 225;
const VAD_HOLD_QUANTA = 75;
const QUIET_HOLD_QUANTA = 15;

/** Evaluate the worklet script with the two globals AudioWorkletGlobalScope provides. */
function instantiate(): Processor {
  let registered: (new () => Processor) | undefined;
  const scope = {
    AudioWorkletProcessor: class {
      port = new FakePort();
    },
    registerProcessor(name: string, ctor: new () => Processor) {
      assert.equal(name, RMS_GATE_PROCESSOR_NAME);
      registered = ctor;
    },
  };
  const source = buildRmsGateProcessorSource(
    {
      defaultOpen: 0.01,
      defaultClose: 0.004,
      openRmsMin: 0.002,
      openRmsMax: 0.04,
      hysteresis: 0.4,
      autoOpenFloor: 0.003,
      autoOpenCap: 0.018,
      vadOpen: 0.5,
      vadClose: 0.35,
      vadHoldQuanta: VAD_HOLD_QUANTA,
      quietHoldQuanta: QUIET_HOLD_QUANTA,
      staleQuanta: STALE_QUANTA,
      lookahead: LOOKAHEAD,
      frameSamples16k: 512,
    },
    { decideGate, pushDecimated, createDecimatorState },
  );
  new Function("AudioWorkletProcessor", "registerProcessor", source)(
    scope.AudioWorkletProcessor,
    scope.registerProcessor,
  );
  assert.ok(registered, "worklet did not register a processor");
  return new registered();
}

/** Wire a fake VAD port into the processor the way the node side does. */
function withVad(gate: Processor): FakePort {
  const vad = new FakePort();
  gate.port.receive({ type: "vad-port", port: vad });
  return vad;
}

const params = (vadMode = 1) => ({
  openThreshold: new Float32Array([0.01]),
  closeThreshold: new Float32Array([0.004]),
  autoMode: new Float32Array([0]),
  vadMode: new Float32Array([vadMode]),
});

const loud = new Float32Array(128).fill(0.5);
const quiet = new Float32Array(128).fill(0.001);

function run(
  gate: Processor,
  input: Float32Array,
  quanta: number,
  p = params(),
  channels = 1,
) {
  const outs = Array.from({ length: channels }, () => new Float32Array(128));
  for (let i = 0; i < quanta; i++) gate.process([[input]], [outs], p);
  return outs;
}

const peak = (buf: Float32Array) => Math.max(...Array.from(buf).map(Math.abs));

test("without a VAD port: loud speech opens and reaches every output channel", () => {
  const gate = instantiate();
  const [left, right] = run(gate, loud, 8, params(), 2);
  assert.ok(left[127] > 0.45, `left channel silent: ${left[127]}`);
  assert.deepEqual(Array.from(right), Array.from(left));
});

test("without a VAD port: no delay is added (legacy behaviour)", () => {
  const gate = instantiate();
  // Ramp up first, then send a marker quantum and expect it straight away.
  run(gate, loud, 8);
  const marker = new Float32Array(128).fill(0.25);
  const [out] = run(gate, marker, 1);
  assert.ok(Math.abs(out[127] - 0.25) < 0.02, `delayed: ${out[127]}`);
});

test("no input silences every output channel", () => {
  const gate = instantiate();
  const left = new Float32Array(128).fill(1);
  const right = new Float32Array(128).fill(1);
  gate.process([[]], [[left, right]], params());
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
  const [out] = run(gate, quiet, 8);
  assert.equal(
    out.some((v) => Math.abs(v) > 1e-6),
    false,
  );
});

test("VAD attached but silent Worker: falls back to RMS, still opens", () => {
  const gate = instantiate();
  withVad(gate);
  const [out] = run(gate, loud, 8);
  assert.ok(out[127] > 0.45, "stale VAD must not mute the mic");
});

test("worklet ships one 512-sample 16 kHz frame every 12 quanta, transferred", () => {
  const gate = instantiate();
  const vad = withVad(gate);
  run(gate, loud, 24);
  assert.equal(vad.posted.length, 2);
  const frame = vad.posted[0] as {
    type: string;
    pcm: Float32Array;
    seq: number;
  };
  assert.equal(frame.type, "frame");
  assert.equal(frame.pcm.length, 512);
  assert.equal(frame.seq, 0);
  assert.equal((vad.posted[1] as { seq: number }).seq, 1);
  assert.equal(vad.transfers[0][0], frame.pcm.buffer);
});

test("a loud bark with low speech probability never opens", () => {
  const gate = instantiate();
  const vad = withVad(gate);
  vad.receive({ type: "prob", seq: 0, prob: 0.05, ms: 1 });
  const [out] = run(gate, loud, 100);
  assert.equal(peak(out), 0, "bark leaked through the gate");
});

test("speech opens after the lookahead and the delayed audio comes out", () => {
  const gate = instantiate();
  const vad = withVad(gate);
  // Worker says "speech" while the gate is still closed → delay engages.
  vad.receive({ type: "prob", seq: 0, prob: 0.9, ms: 1 });
  // Marker in the first quantum; silence after.
  const marker = new Float32Array(128).fill(0.5);
  const silence = new Float32Array(128);
  const outs: number[] = [];
  const p = params();
  const out = new Float32Array(128);
  gate.process([[marker]], [[out]], p);
  outs.push(peak(out));
  // Gate opened on the marker, but the marker itself is 12 quanta behind.
  for (let q = 1; q < 14; q++) {
    // Keep it "loud" for the RMS side so the gate stays open across the delay.
    gate.process([[q < 12 ? marker : silence]], [[out]], p);
    outs.push(peak(out));
  }
  assert.ok(
    outs[0] < 0.2,
    `no lookahead: first quantum already loud ${outs[0]}`,
  );
  assert.ok(outs[12] > 0.4, `marker never came out: ${outs.join(",")}`);
});

test("hold: speech resumes before the bark hold expires → stays open", () => {
  const gate = instantiate();
  const vad = withVad(gate);
  vad.receive({ type: "prob", seq: 0, prob: 0.9, ms: 1 });
  run(gate, loud, 20);
  vad.receive({ type: "prob", seq: 1, prob: 0.1, ms: 1 });
  run(gate, loud, VAD_HOLD_QUANTA - 2);
  vad.receive({ type: "prob", seq: 2, prob: 0.9, ms: 1 });
  const [out] = run(gate, loud, 4);
  assert.ok(peak(out) > 0.4, "gate closed during a short non-speech blip");
});

test("hold: sustained loud non-speech closes the gate", () => {
  const gate = instantiate();
  const vad = withVad(gate);
  vad.receive({ type: "prob", seq: 0, prob: 0.9, ms: 1 });
  run(gate, loud, 20);
  vad.receive({ type: "prob", seq: 1, prob: 0.1, ms: 1 });
  run(gate, loud, VAD_HOLD_QUANTA + 60);
  const [out] = run(gate, loud, 1);
  assert.ok(peak(out) < 0.01, `still open after hold: ${peak(out)}`);
});

test("vadMode 0 ignores the Worker entirely", () => {
  const gate = instantiate();
  const vad = withVad(gate);
  vad.receive({ type: "prob", seq: 0, prob: 0.05, ms: 1 });
  const [out] = run(gate, loud, 8, params(0));
  assert.ok(out[127] > 0.45, "vadMode=0 must behave like the RMS gate");
  assert.equal(vad.posted.length, 0, "no frames when vadMode is 0");
});

test("stats include the speech probability while the VAD is live", () => {
  const gate = instantiate();
  const vad = withVad(gate);
  vad.receive({ type: "prob", seq: 0, prob: 0.77, ms: 2 });
  run(gate, loud, 8);
  const stats = gate.port.posted.at(-1) as {
    rms: number;
    open: boolean;
    vadActive: boolean;
    prob?: number;
    inferMs?: number;
  };
  assert.equal(stats.vadActive, true);
  assert.equal(stats.prob, 0.77);
  assert.equal(stats.inferMs, 2);
  assert.equal(typeof stats.rms, "number");
});
