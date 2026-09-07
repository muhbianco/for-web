/**
 * Schema history:
 * - 0: DeepFilterNet was a broken default (click artifacts).
 * - 1: rolled everyone back to RNNoise, kept explicit DeepFilter opt-in.
 * - 2: DeepFilterNet3 (patched worklet + gate) is the default again for
 *      everyone, with adaptive ("auto") strength. RNNoise stays the runtime
 *      fallback for devices that cannot run DeepFilter.
 */
export const NOISE_SUPPRESSION_SCHEMA = 2;

export type NoiseSuppresionState =
  | "disabled"
  | "browser"
  | "enhanced"
  | "advanced";

export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppresionState = "advanced";

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
 * DeepFilter strength preset.
 * - auto: attenuation limit follows the measured noise floor, gate tracks the
 *   floor too (Discord-style "automatically determine sensitivity").
 * - light / medium / strong: fixed attenuation limit; gate uses the manual
 *   sensitivity slider.
 */
export type DeepFilterSensitivity = "auto" | "light" | "medium" | "strong";

export const DEFAULT_DEEPFILTER_SENSITIVITY: DeepFilterSensitivity = "auto";

const DEEPFILTER_SENSITIVITIES: DeepFilterSensitivity[] = [
  "auto",
  "light",
  "medium",
  "strong",
];

export function isDeepFilterSensitivity(
  value: unknown,
): value is DeepFilterSensitivity {
  return (
    typeof value === "string" &&
    (DEEPFILTER_SENSITIVITIES as string[]).includes(value)
  );
}

/**
 * DeepFilterNet `atten_lim_db`: the most the model may attenuate a bin. Lower
 * keeps more room tone and fewer artifacts; 100 is "remove everything".
 */
export const DEEPFILTER_ATTEN_DB: Record<
  Exclude<DeepFilterSensitivity, "auto">,
  number
> = {
  light: 40,
  medium: 60,
  strong: 80,
};

export const DEEPFILTER_AUTO_ATTEN_MIN_DB = 40;
export const DEEPFILTER_AUTO_ATTEN_MAX_DB = 90;
/** Noise floor (dBFS, pre-DeepFilter) below which the light preset is enough. */
export const DEEPFILTER_AUTO_QUIET_FLOOR_DBFS = -60;
/** Noise floor above which we go to the maximum limit. */
export const DEEPFILTER_AUTO_LOUD_FLOOR_DBFS = -40;
/** Only re-send the level when it moved at least this much. */
export const DEEPFILTER_AUTO_STEP_DB = 5;

/**
 * Map a measured background-noise floor to a DeepFilter attenuation limit.
 * Quiet room (< -60 dBFS): 40 dB keeps the voice natural.
 * Loud room (> -40 dBFS, fan / street): 90 dB.
 * Linear in between, rounded to DEEPFILTER_AUTO_STEP_DB.
 */
export function attenDbFromNoiseFloor(floorDbfs: number): number {
  if (!Number.isFinite(floorDbfs)) return DEEPFILTER_ATTEN_DB.strong;
  if (floorDbfs <= DEEPFILTER_AUTO_QUIET_FLOOR_DBFS) {
    return DEEPFILTER_AUTO_ATTEN_MIN_DB;
  }
  if (floorDbfs >= DEEPFILTER_AUTO_LOUD_FLOOR_DBFS) {
    return DEEPFILTER_AUTO_ATTEN_MAX_DB;
  }
  const span =
    DEEPFILTER_AUTO_LOUD_FLOOR_DBFS - DEEPFILTER_AUTO_QUIET_FLOOR_DBFS;
  const t = (floorDbfs - DEEPFILTER_AUTO_QUIET_FLOOR_DBFS) / span;
  const raw =
    DEEPFILTER_AUTO_ATTEN_MIN_DB +
    (DEEPFILTER_AUTO_ATTEN_MAX_DB - DEEPFILTER_AUTO_ATTEN_MIN_DB) * t;
  return Math.round(raw / DEEPFILTER_AUTO_STEP_DB) * DEEPFILTER_AUTO_STEP_DB;
}

export function deepFilterAttenDb(
  sensitivity: DeepFilterSensitivity,
  noiseFloorDbfs?: number,
): number {
  if (sensitivity === "auto") {
    return noiseFloorDbfs === undefined
      ? DEEPFILTER_ATTEN_DB.strong
      : attenDbFromNoiseFloor(noiseFloorDbfs);
  }
  return DEEPFILTER_ATTEN_DB[sensitivity];
}

export function rmsToDbfs(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return -120;
  return Math.max(-120, 20 * Math.log10(rms));
}

/**
 * Schema < 2: move everyone to DeepFilterNet + auto strength once. Schema 2+:
 * keep whatever the user picked.
 */
export function applyNoiseSuppressionSchema(
  stored: NoiseSuppresionState | undefined,
  schema: number | undefined,
  storedSensitivity?: DeepFilterSensitivity,
): {
  noiseSupression: NoiseSuppresionState;
  noiseSuppressionSchema: number;
  deepFilterSensitivity: DeepFilterSensitivity;
} {
  const current =
    stored && isNoiseSuppressionMode(stored)
      ? stored
      : DEFAULT_NOISE_SUPPRESSION;
  const sensitivity = isDeepFilterSensitivity(storedSensitivity)
    ? storedSensitivity
    : DEFAULT_DEEPFILTER_SENSITIVITY;
  if ((schema ?? 0) >= NOISE_SUPPRESSION_SCHEMA) {
    return {
      noiseSupression: current,
      noiseSuppressionSchema: Math.max(schema ?? 0, NOISE_SUPPRESSION_SCHEMA),
      deepFilterSensitivity: sensitivity,
    };
  }
  return {
    noiseSupression: DEFAULT_NOISE_SUPPRESSION,
    noiseSuppressionSchema: NOISE_SUPPRESSION_SCHEMA,
    deepFilterSensitivity: DEFAULT_DEEPFILTER_SENSITIVITY,
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
  const open = GATE_OPEN_RMS_MIN + (GATE_OPEN_RMS_MAX - GATE_OPEN_RMS_MIN) * s;
  return { open, close: open * GATE_HYSTERESIS };
}

/** Map post-DeepFilter RMS onto the same 0–1 scale as the sensitivity slider. */
export function rmsToMeter(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const span = GATE_OPEN_RMS_MAX - GATE_OPEN_RMS_MIN;
  return Math.min(1, Math.max(0, (rms - GATE_OPEN_RMS_MIN) / span));
}
