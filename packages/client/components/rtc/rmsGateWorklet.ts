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
import {
  RMS_QUIET_HOLD_QUANTA,
  VAD_CLOSE,
  VAD_FRAME_SAMPLES_16K,
  VAD_HOLD_QUANTA,
  VAD_LOOKAHEAD_48K,
  VAD_OPEN,
  VAD_STALE_QUANTA,
  createDecimatorState,
  decideGate,
  pushDecimated,
} from "./vadPolicy";

const defaults = gateThresholdsFromSensitivity(DEFAULT_INPUT_SENSITIVITY);

/** Close the DeepFilter residual when nobody is talking. */
export const RMS_GATE_WORKLET = buildRmsGateProcessorSource(
  {
    defaultOpen: defaults.open,
    defaultClose: defaults.close,
    openRmsMin: GATE_OPEN_RMS_MIN,
    openRmsMax: GATE_OPEN_RMS_MAX,
    hysteresis: GATE_HYSTERESIS,
    autoOpenFloor: GATE_AUTO_OPEN_FLOOR,
    autoOpenCap: GATE_AUTO_OPEN_CAP,
    vadOpen: VAD_OPEN,
    vadClose: VAD_CLOSE,
    vadHoldQuanta: VAD_HOLD_QUANTA,
    quietHoldQuanta: RMS_QUIET_HOLD_QUANTA,
    staleQuanta: VAD_STALE_QUANTA,
    lookahead: VAD_LOOKAHEAD_48K,
    frameSamples16k: VAD_FRAME_SAMPLES_16K,
  },
  { decideGate, pushDecimated, createDecimatorState },
);

const gatedContexts = new WeakSet<BaseAudioContext>();

/**
 * Hand the worklet its end of the VAD MessageChannel (the Worker owns the
 * other end). `processorOptions` is structured-cloned without a transfer
 * list, so the port has to go through the node's own port.
 */
export function attachVadPort(node: AudioWorkletNode, port: MessagePort) {
  node.port.postMessage({ type: "vad-port", port }, [port]);
}

export function detachVadPort(node: AudioWorkletNode) {
  node.port.postMessage({ type: "vad-detach" });
}

/** Plain RMS gate until `attachVadPort` gives it a Worker to ask. */
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
