import type { NoiseSuppresionState } from "@revolt/state/stores/Voice";

export type VoiceEngineId =
  | "idle"
  | "deepfilter"
  | "rnnoise"
  | "bypass"
  | "browser-ns";

export interface VoiceEngineStatus {
  engine: VoiceEngineId;
  selectedMode?: NoiseSuppresionState;
  sampleRate?: number;
  processorAttached: boolean;
  inCall: boolean;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
  noiseSuppression?: boolean;
  lastError?: string;
  canUseDeepFilter?: boolean;
  inputRms?: number;
  gateOpen?: boolean;
  gateOpenThreshold?: number;
  /** DeepFilter attenuation limit currently applied (dB). */
  deepFilterAttenDb?: number;
  /** Estimated background noise before DeepFilter (dBFS). */
  noiseFloorDb?: number;
  /** Channels of the raw microphone capture (before the mono downmix). */
  inputChannelCount?: number;
  /** Slowest DeepFilter frame in the last second (ms). */
  deepFilterMaxFrameMs?: number;
  /** Share of slow DeepFilter frames in the last second (0-1). */
  deepFilterSlowRatio?: number;
  /** DeepFilter was replaced by RNNoise during this call because it fell behind. */
  deepFilterOverloaded?: boolean;
}

export const IDLE_VOICE_ENGINE_STATUS: VoiceEngineStatus = {
  engine: "idle",
  processorAttached: false,
  inCall: false,
};
