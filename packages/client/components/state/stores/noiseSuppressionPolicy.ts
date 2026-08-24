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
