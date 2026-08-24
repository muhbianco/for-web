import {
  DEFAULT_INPUT_SENSITIVITY,
  GATE_AUTO_OPEN_CAP,
  GATE_AUTO_OPEN_FLOOR,
  GATE_HYSTERESIS,
  GATE_OPEN_RMS_MAX,
  GATE_OPEN_RMS_MIN,
  gateThresholdsFromSensitivity,
} from "../state/stores/noiseSuppressionPolicy";

const defaults = gateThresholdsFromSensitivity(DEFAULT_INPUT_SENSITIVITY);

/** Close the DeepFilter residual when nobody is talking. */
export const RMS_GATE_WORKLET = `
class StoatRmsGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "openThreshold",
        defaultValue: ${defaults.open},
        minValue: ${GATE_OPEN_RMS_MIN},
        maxValue: ${GATE_OPEN_RMS_MAX},
        automationRate: "k-rate",
      },
      {
        name: "closeThreshold",
        defaultValue: ${defaults.close},
        minValue: ${GATE_OPEN_RMS_MIN * GATE_HYSTERESIS},
        maxValue: ${GATE_OPEN_RMS_MAX},
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
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
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
        ${GATE_AUTO_OPEN_CAP},
        Math.max(this.floor * 4, ${GATE_AUTO_OPEN_FLOOR}),
      );
      closeTh = openTh * ${GATE_HYSTERESIS};
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
    this.tick = (this.tick + 1) % 8;
    if (this.tick === 0) {
      this.port.postMessage({ rms: rms, open: this.open, threshold: openTh });
    }
    return true;
  }
}
registerProcessor("stoat-rms-gate", StoatRmsGate);
`;

const gatedContexts = new WeakSet<BaseAudioContext>();

export async function ensureRmsGateNode(
  context: AudioContext,
): Promise<AudioWorkletNode> {
  if (!gatedContexts.has(context)) {
    const blob = new Blob([RMS_GATE_WORKLET], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    try {
      await context.audioWorklet.addModule(url);
      gatedContexts.add(context);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return new AudioWorkletNode(context, "stoat-rms-gate");
}
