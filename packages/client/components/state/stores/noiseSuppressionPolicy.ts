export const NOISE_SUPPRESSION_SCHEMA = 1;

export type NoiseSuppresionState =
  | "disabled"
  | "browser"
  | "enhanced"
  | "advanced";

const MODES: NoiseSuppresionState[] = [
  "disabled",
  "browser",
  "enhanced",
  "advanced",
];

export function isNoiseSuppressionMode(
  value: unknown,
): value is NoiseSuppresionState {
  return typeof value === "string" && (MODES as string[]).includes(value);
}

/**
 * Schema 0 (or missing): DeepFilterNet was the broken default. Roll those
 * clients back to RNNoise. Schema 1+: keep an explicit DeepFilter choice.
 */
export function applyNoiseSuppressionSchema(
  stored: NoiseSuppresionState | undefined,
  schema: number | undefined,
): { noiseSupression: NoiseSuppresionState; noiseSuppressionSchema: number } {
  const current = stored && isNoiseSuppressionMode(stored) ? stored : "enhanced";
  if ((schema ?? 0) >= NOISE_SUPPRESSION_SCHEMA) {
    return {
      noiseSupression: current,
      noiseSuppressionSchema: Math.max(schema ?? 0, NOISE_SUPPRESSION_SCHEMA),
    };
  }
  return {
    noiseSupression: current === "advanced" ? "enhanced" : current,
    noiseSuppressionSchema: NOISE_SUPPRESSION_SCHEMA,
  };
}

/** Browser AGC fights ML denoisers and pumps the noise floor. */
export function captureAutoGainEnabled(
  mode: NoiseSuppresionState | undefined,
  userPref: boolean | undefined,
): boolean {
  if (mode === "enhanced" || mode === "advanced") return false;
  return userPref ?? true;
}

export function captureBrowserNoiseSuppression(
  mode: NoiseSuppresionState | undefined,
): boolean {
  return mode === "browser";
}

/** 0 = most sensitive (quiet speech opens the gate). */
export const DEFAULT_INPUT_SENSITIVITY = 0.35;
export const GATE_OPEN_RMS_MIN = 0.002;
export const GATE_OPEN_RMS_MAX = 0.04;
export const GATE_HYSTERESIS = 0.4;
export const GATE_AUTO_OPEN_FLOOR = 0.003;
export const GATE_AUTO_OPEN_CAP = 0.018;

export function clampInputSensitivity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_INPUT_SENSITIVITY;
  }
  return Math.min(1, Math.max(0, value));
}

export function gateThresholdsFromSensitivity(sensitivity: number): {
  open: number;
  close: number;
} {
  const s = clampInputSensitivity(sensitivity);
  const open =
    GATE_OPEN_RMS_MIN + (GATE_OPEN_RMS_MAX - GATE_OPEN_RMS_MIN) * s;
  return { open, close: open * GATE_HYSTERESIS };
}

/** Map post-DeepFilter RMS onto the same 0–1 scale as the sensitivity slider. */
export function rmsToMeter(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const span = GATE_OPEN_RMS_MAX - GATE_OPEN_RMS_MIN;
  return Math.min(1, Math.max(0, (rms - GATE_OPEN_RMS_MIN) / span));
}
