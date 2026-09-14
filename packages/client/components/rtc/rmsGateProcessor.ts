/**
 * Source of the voice gate AudioWorkletProcessor. Kept free of imports so the
 * generated script can be evaluated in a unit test with fake worklet globals;
 * the shared policy functions are inlined by `.toString()`.
 *
 * Two modes, decided per quantum:
 * - RMS only (legacy): open above `openThreshold`, close under `closeThreshold`.
 *   Used when no VAD port was given, `vadMode` is 0, or the Worker has gone
 *   quiet for `staleQuanta` (fallback is automatic).
 * - VAD: audio is delayed by one VAD frame (32 ms) so the speech probability
 *   for a frame arrives before that frame reaches the output; the gate opens
 *   only when loud AND probably speech (see vadPolicy.decideGate).
 *
 * The delay is switched only while the gate is closed so it never clicks.
 */
import type {
  createDecimatorState,
  decideGate,
  pushDecimated,
} from "./vadPolicy";

/**
 * The policy functions are passed in (not imported) so this module stays
 * import-free at runtime; the caller inlines their source with `.toString()`.
 */
export interface GatePolicyFunctions {
  decideGate: typeof decideGate;
  pushDecimated: typeof pushDecimated;
  createDecimatorState: typeof createDecimatorState;
}

export interface RmsGateConstants {
  defaultOpen: number;
  defaultClose: number;
  openRmsMin: number;
  openRmsMax: number;
  hysteresis: number;
  autoOpenFloor: number;
  autoOpenCap: number;
  /** vadPolicy.VAD_OPEN */
  vadOpen: number;
  /** vadPolicy.VAD_CLOSE */
  vadClose: number;
  vadHoldQuanta: number;
  quietHoldQuanta: number;
  staleQuanta: number;
  /** Delay in graph samples (one VAD frame at 48 kHz). */
  lookahead: number;
  /** 16 kHz samples per VAD frame. */
  frameSamples16k: number;
}

export const RMS_GATE_PROCESSOR_NAME = "stoat-rms-gate";

/** Close the DeepFilter residual when nobody is talking. */
export function buildRmsGateProcessorSource(
  c: RmsGateConstants,
  policy: GatePolicyFunctions,
): string {
  return `
const decideGate = ${policy.decideGate.toString()};
const pushDecimated = ${policy.pushDecimated.toString()};
const createDecimatorState = ${policy.createDecimatorState.toString()};
class StoatRmsGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "openThreshold",
        defaultValue: ${c.defaultOpen},
        minValue: ${c.openRmsMin},
        maxValue: ${c.openRmsMax},
        automationRate: "k-rate",
      },
      {
        name: "closeThreshold",
        defaultValue: ${c.defaultClose},
        minValue: ${c.openRmsMin * c.hysteresis},
        maxValue: ${c.openRmsMax},
        automationRate: "k-rate",
      },
      {
        name: "autoMode",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "vadMode",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
    ];
  }
  constructor() {
    super();
    this.state = { open: false, hold: 0 };
    this.gain = 0;
    this.floor = 0.001;
    this.tick = 0;
    // Lookahead ring buffer; sized for the delay plus one quantum.
    this.ring = new Float32Array(${c.lookahead} + 128);
    this.writePos = 0;
    this.delay = 0;
    // VAD wiring (optional). The MessagePort cannot travel in
    // processorOptions (structured clone, no transfer), so the node side
    // hands it over through this.port after construction.
    this.vadPort = null;
    this.prob = -1;
    this.probAge = ${c.staleQuanta};
    this.inferMs = 0;
    this.seq = 0;
    this.decimator = createDecimatorState(${c.frameSamples16k});
    this.port.onmessage = (event) => {
      const d = event.data;
      if (d && d.type === "vad-port" && d.port) this.attachVadPort(d.port);
      else if (d && d.type === "vad-detach") this.attachVadPort(null);
    };
  }
  attachVadPort(port) {
    if (this.vadPort) {
      this.vadPort.onmessage = null;
      if (this.vadPort.close) this.vadPort.close();
    }
    this.vadPort = port;
    this.prob = -1;
    this.probAge = ${c.staleQuanta};
    if (!port) return;
    port.onmessage = (event) => {
      const d = event.data;
      if (!d || d.type !== "prob" || typeof d.prob !== "number") return;
      this.prob = d.prob;
      this.probAge = 0;
      if (typeof d.ms === "number") this.inferMs = d.ms;
    };
    if (port.start) port.start();
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0];
    const channels = outputs[0];
    if (!channels || channels.length === 0) return true;
    const output = channels[0];
    if (!input) {
      for (let c = 0; c < channels.length; c++) channels[c].fill(0);
      return true;
    }
    const n = input.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / Math.max(n, 1));

    const auto = parameters.autoMode[0] >= 0.5;
    let openTh = parameters.openThreshold[0];
    let closeTh = parameters.closeThreshold[0];
    if (auto) {
      if (!this.state.open) {
        this.floor += (rms - this.floor) * 0.004;
      }
      openTh = Math.min(
        ${c.autoOpenCap},
        Math.max(this.floor * 4, ${c.autoOpenFloor}),
      );
      closeTh = openTh * ${c.hysteresis};
    }

    // Feed the VAD while it is wanted; staleness decides whether we trust it.
    const vadWanted = !!this.vadPort && parameters.vadMode[0] >= 0.5;
    if (vadWanted) {
      if (pushDecimated(this.decimator, input)) {
        const pcm = this.decimator.frame;
        this.vadPort.postMessage(
          { type: "frame", pcm: pcm, seq: this.seq++ },
          [pcm.buffer],
        );
        this.decimator.frame = new Float32Array(${c.frameSamples16k});
        this.decimator.frameLen = 0;
      }
    }
    this.probAge++;
    const vadActive = vadWanted && this.probAge < ${c.staleQuanta};

    decideGate(this.state, {
      rms: rms,
      openTh: openTh,
      closeTh: closeTh,
      prob: vadActive ? this.prob : -1,
      vadActive: vadActive,
      vadOpen: ${c.vadOpen},
      vadClose: ${c.vadClose},
      vadHoldQuanta: ${c.vadHoldQuanta},
      quietHoldQuanta: ${c.quietHoldQuanta},
    });

    // Retarget the delay only while (nearly) silent so it never clicks.
    const targetDelay = vadActive ? ${c.lookahead} : 0;
    if (this.delay !== targetDelay && this.gain < 0.01) {
      this.delay = targetDelay;
    }

    // Write the current quantum into the ring, read it back this.delay behind.
    const ring = this.ring;
    const size = ring.length;
    let w = this.writePos;
    for (let i = 0; i < n; i++) {
      ring[w] = input[i];
      w = (w + 1) % size;
    }
    let r = (this.writePos - this.delay + size) % size;
    this.writePos = w;

    const target = this.state.open ? 1 : 0;
    const coeff = this.state.open ? 0.25 : 0.08;
    for (let i = 0; i < n; i++) {
      this.gain += (target - this.gain) * coeff;
      output[i] = ring[r] * this.gain;
      r = (r + 1) % size;
    }
    // The graph is mono, but if a stereo capture ever reaches this node every
    // output channel must carry the voice; a silent right channel is what the
    // listener hears as "only the left ear".
    for (let c = 1; c < channels.length; c++) channels[c].set(output);

    this.tick = (this.tick + 1) % 8;
    if (this.tick === 0) {
      this.port.postMessage({
        rms: rms,
        open: this.state.open,
        threshold: openTh,
        vadActive: vadActive,
        prob: vadActive ? this.prob : undefined,
        inferMs: vadActive ? this.inferMs : undefined,
      });
    }
    return true;
  }
}
registerProcessor("${RMS_GATE_PROCESSOR_NAME}", StoatRmsGate);
`;
}
