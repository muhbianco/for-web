import {
  PRODUCTION_METER_MESSAGE,
  PRODUCTION_METER_PROCESSOR_NAME,
  PRODUCTION_REPORT_QUANTA,
  SILENCE_PEAK,
  buildProductionMeterSource,
} from "./productionMeterProcessor";

/**
 * Wiring for the production meter (see productionMeterProcessor for why it
 * exists). Same shape as rmsGateWorklet: build the source, register it once
 * per context, hand back a mono-in/mono-out node.
 */

export const PRODUCTION_METER_WORKLET = buildProductionMeterSource({
  name: PRODUCTION_METER_PROCESSOR_NAME,
  message: PRODUCTION_METER_MESSAGE,
  silencePeak: SILENCE_PEAK,
  reportQuanta: PRODUCTION_REPORT_QUANTA,
});

const meteredContexts = new WeakSet<BaseAudioContext>();

export async function ensureProductionMeterNode(
  context: AudioContext,
): Promise<AudioWorkletNode> {
  if (!meteredContexts.has(context)) {
    const blob = new Blob([PRODUCTION_METER_WORKLET], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    try {
      await context.audioWorklet.addModule(url);
      meteredContexts.add(context);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  // Mono in, mono out: anything wider here makes LiveKit publish stereo,
  // which would also silently turn RED and DTX off.
  return new AudioWorkletNode(context, PRODUCTION_METER_PROCESSOR_NAME, {
    channelCount: 1,
    channelCountMode: "explicit",
    outputChannelCount: [1],
  });
}
