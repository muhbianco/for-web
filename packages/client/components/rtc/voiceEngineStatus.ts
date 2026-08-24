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
}

export const IDLE_VOICE_ENGINE_STATUS: VoiceEngineStatus = {
  engine: "idle",
  processorAttached: false,
  inCall: false,
};
