import {
  DEFAULT_INPUT_SENSITIVITY,
  GATE_AUTO_OPEN_CAP,
  GATE_AUTO_OPEN_FLOOR,
  GATE_HYSTERESIS,
  GATE_OPEN_RMS_MAX,
  GATE_OPEN_RMS_MIN,
  gateThresholdsFromSensitivity,
} from "../state/stores/noiseSuppressionPolicy";

import {
  RMS_GATE_PROCESSOR_NAME,
  buildRmsGateProcessorSource,
} from "./rmsGateProcessor";

const defaults = gateThresholdsFromSensitivity(DEFAULT_INPUT_SENSITIVITY);

/** Close the DeepFilter residual when nobody is talking. */
export const RMS_GATE_WORKLET = buildRmsGateProcessorSource({
  defaultOpen: defaults.open,
  defaultClose: defaults.close,
  openRmsMin: GATE_OPEN_RMS_MIN,
  openRmsMax: GATE_OPEN_RMS_MAX,
  hysteresis: GATE_HYSTERESIS,
  autoOpenFloor: GATE_AUTO_OPEN_FLOOR,
  autoOpenCap: GATE_AUTO_OPEN_CAP,
});

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
  // Mono in, mono out: the suppressors only look at channel 0 and a wider
  // destination makes LiveKit publish stereo.
  return new AudioWorkletNode(context, RMS_GATE_PROCESSOR_NAME, {
    channelCount: 1,
    channelCountMode: "explicit",
    outputChannelCount: [1],
  });
}
