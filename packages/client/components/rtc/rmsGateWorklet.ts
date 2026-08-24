/** Close the DeepFilter residual when nobody is talking. */
export const RMS_GATE_WORKLET = `
class StoatRmsGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.open = false;
    this.gain = 0;
  }
  process(inputs, outputs) {
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
    if (this.open) {
      if (rms < 0.008) this.open = false;
    } else if (rms > 0.02) {
      this.open = true;
    }
    const target = this.open ? 1 : 0;
    const coeff = this.open ? 0.25 : 0.08;
    for (let i = 0; i < output.length; i++) {
      this.gain += (target - this.gain) * coeff;
      output[i] = input[i] * this.gain;
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
