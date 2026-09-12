/**
 * Source of the RMS gate AudioWorkletProcessor. Kept free of imports so the
 * generated script can be evaluated in a unit test with fake worklet globals.
 */
export interface RmsGateConstants {
  defaultOpen: number;
  defaultClose: number;
  openRmsMin: number;
  openRmsMax: number;
  hysteresis: number;
  autoOpenFloor: number;
  autoOpenCap: number;
}

export const RMS_GATE_PROCESSOR_NAME = "stoat-rms-gate";

/** Close the DeepFilter residual when nobody is talking. */
export function buildRmsGateProcessorSource(c: RmsGateConstants): string {
  return `
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
    ];
  }
  constructor() {
    super();
    this.open = false;
    this.gain = 0;
    this.floor = 0.001;
    this.tick = 0;
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
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / Math.max(input.length, 1));
    const auto = parameters.autoMode[0] >= 0.5;
    let openTh = parameters.openThreshold[0];
    let closeTh = parameters.closeThreshold[0];
    if (auto) {
      if (!this.open) {
        this.floor += (rms - this.floor) * 0.004;
      }
      openTh = Math.min(
        ${c.autoOpenCap},
        Math.max(this.floor * 4, ${c.autoOpenFloor}),
      );
      closeTh = openTh * ${c.hysteresis};
    }
    if (this.open) {
      if (rms < closeTh) this.open = false;
    } else if (rms > openTh) {
      this.open = true;
    }
    const target = this.open ? 1 : 0;
    const coeff = this.open ? 0.25 : 0.08;
    for (let i = 0; i < output.length; i++) {
      this.gain += (target - this.gain) * coeff;
      output[i] = input[i] * this.gain;
    }
    // The graph is mono, but if a stereo capture ever reaches this node every
    // output channel must carry the voice; a silent right channel is what the
    // listener hears as "only the left ear".
    for (let c = 1; c < channels.length; c++) channels[c].set(output);
    this.tick = (this.tick + 1) % 8;
    if (this.tick === 0) {
      this.port.postMessage({ rms: rms, open: this.open, threshold: openTh });
    }
    return true;
  }
}
registerProcessor("${RMS_GATE_PROCESSOR_NAME}", StoatRmsGate);
`;
}
