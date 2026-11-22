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
/**
 * Auto never goes past "medium". It used to climb to 90 dB, and DFN3 near its
 * ceiling over-suppresses into metallic, robotic voice; the manual "strong"
 * preset stays available for whoever wants more.
 */
export const DEEPFILTER_AUTO_ATTEN_MAX_DB = 60;
/** Noise floor (dBFS, pre-DeepFilter) below which the light preset is enough. */
export const DEEPFILTER_AUTO_QUIET_FLOOR_DBFS = -60;
/** Noise floor above which we go to the maximum limit. */
export const DEEPFILTER_AUTO_LOUD_FLOOR_DBFS = -40;
/** Only re-send the level when it moved at least this much. */
export const DEEPFILTER_AUTO_STEP_DB = 5;

/**
 * Map a measured background-noise floor to a DeepFilter attenuation limit.
 * Quiet room (< -60 dBFS): 40 dB keeps the voice natural.
 * Loud room (> -40 dBFS, fan / street): 60 dB.
 * Linear in between, rounded to DEEPFILTER_AUTO_STEP_DB.
 * No usable measurement: the light end, never the aggressive one.
 */
export function attenDbFromNoiseFloor(floorDbfs: number): number {
  if (!Number.isFinite(floorDbfs)) return DEEPFILTER_AUTO_ATTEN_MIN_DB;
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
    // Before the first floor reading (~1-2 s) start light: it used to start at
    // "strong" (80 dB), the worst setting for artifacts, on every room entry.
    return noiseFloorDbfs === undefined
      ? DEEPFILTER_AUTO_ATTEN_MIN_DB
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

/**
 * Speech-level normalizer BEFORE the suppressor (AGC2-style), for quiet and
 * uneven microphones.
 *
 * Why before: DeepFilterNet3 is trained on nominal levels; in the voice lab
 * (15/11/2026) speech at −48 dBFS RMS came out of it as noise, so no gain
 * placed after the suppressor can bring a quiet talker back. The browser AGC
 * stays off in ML modes (it pumped the noise floor into the suppressor).
 *
 * What it aims at (docs/voz/10 in the muchat repo): Discord runs the WebRTC
 * AGC2 adaptive digital controller and on the owner's headset delivered speech
 * at ≈ −23 dBFS after +19 dB (median). The previous make-up gain aimed −26 dBFS
 * at the *peak* of speech and stopped at +18 dB: a talker 24 dB under the
 * reference left the chain 6.7 dB quieter than a normal one. This one measures
 * the *active speech level* (power mean of the polls clearly above the noise
 * floor, the same measure as the lab's `levels.mjs`) and brings it to
 * NORMALIZER_TARGET_DBFS.
 *
 * Never attenuates (the limiter handles loud talkers), holds while nobody
 * talks, rises at most 6 dB/s and falls at 12 dB/s, and never lifts the noise
 * floor above NORMALIZER_NOISE_CEILING_DBFS. The floor is measured here (low
 * percentile of all polls), not from the gate, so it works before the gate has
 * ever closed and with RNNoise, which has no gate.
 */
export const NORMALIZER_TARGET_DBFS = -23;
export const NORMALIZER_MAX_GAIN_DB = 30;
/**
 * Highest noise floor the gain may produce at the suppressor input. AGC2 uses
 * −50; DeepFilter here removes a −45 dBFS fan cleanly (lab `noise45`), so the
 * ceiling sits a little higher to keep lifting quiet talkers in normal rooms.
 */
export const NORMALIZER_NOISE_CEILING_DBFS = -40;
/** Polls are 200 ms apart: 1.2 dB per poll is 6 dB/s up, 2.4 is 12 dB/s down. */
export const NORMALIZER_UP_DB_PER_POLL = 1.2;
export const NORMALIZER_DOWN_DB_PER_POLL = 2.4;
/**
 * Until the gain first reaches what the voice needs, it may rise 18 dB/s. The
 * lab (22/11/2026, quiet-24) lost the first 5 s of a quiet talker at 6 dB/s:
 * DeepFilter erases quiet speech until the gain is there. AGC2 solves the same
 * with a fixed +15 dB start, which would blast a loud talker instead.
 */
export const NORMALIZER_ATTACK_UP_DB_PER_POLL = 3.6;
/** Within this of the wanted gain counts as having reached it. */
export const NORMALIZER_CONVERGED_DB = 1;
/** A poll counts as speech only this far above the noise floor… */
export const NORMALIZER_SPEECH_ABOVE_FLOOR_DB = 12;
/** …and never below this absolute level (a dead mic must not be amplified). */
export const NORMALIZER_MIN_SPEECH_DBFS = -70;
/** Speech polls averaged for the level (~5 s of talking). */
export const NORMALIZER_SPEECH_POLLS = 25;
/** All polls kept for the floor (~10 s). */
export const NORMALIZER_FLOOR_POLLS = 50;
/** Floor = this percentile of the recent polls. */
export const NORMALIZER_FLOOR_PERCENTILE = 0.1;
/** Polls needed before the floor (and so any gain change) is trusted. */
export const NORMALIZER_MIN_FLOOR_POLLS = 3;
/** Speech polls needed before the level is trusted. */
export const NORMALIZER_MIN_SPEECH_POLLS = 2;
/** A floor that moved more than this re-classifies the recent polls. */
export const NORMALIZER_RECLASSIFY_DB = 6;

function powerMeanDb(levels: readonly number[]): number {
  let sum = 0;
  for (const db of levels) sum += 10 ** (db / 10);
  return 10 * Math.log10(sum / levels.length);
}

export class SpeechLevelNormalizer {
  #gainDb: number;
  #all: number[] = [];
  #speech: number[] = [];
  /** The gain has reached what the voice needs once (ends the fast attack). */
  #converged = false;
  /** Floor the speech list was classified against. */
  #classifiedFloor?: number;

  constructor(initialGainDb = 0) {
    this.#gainDb = Math.min(NORMALIZER_MAX_GAIN_DB, Math.max(0, initialGainDb));
  }

  gainDb(): number {
    return this.#gainDb;
  }

  /** Noise floor of the recent polls (dBFS, before the gain), once trusted. */
  floorDb(): number | undefined {
    if (this.#all.length < NORMALIZER_MIN_FLOOR_POLLS) return undefined;
    const sorted = [...this.#all].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * NORMALIZER_FLOOR_PERCENTILE)];
  }

  /** Active speech level (dBFS, before the gain), once trusted. */
  speechLevelDb(): number | undefined {
    if (this.#speech.length < NORMALIZER_MIN_SPEECH_POLLS) return undefined;
    return powerMeanDb(this.#speech);
  }

  /** Gain the normalizer wants right now, without the rate limit. */
  desiredGainDb(): number | undefined {
    const speech = this.speechLevelDb();
    const floor = this.floorDb();
    if (speech === undefined || floor === undefined) return undefined;
    const noiseRoom = Math.max(0, NORMALIZER_NOISE_CEILING_DBFS - floor);
    const desired = Math.min(
      NORMALIZER_MAX_GAIN_DB,
      noiseRoom,
      Math.max(0, NORMALIZER_TARGET_DBFS - speech),
    );
    // Hundredths of a dB: the power mean of equal levels is not exact.
    return Math.round(desired * 100) / 100;
  }

  /** One poll of the pre-gain level (dBFS). Returns the gain to apply (dB). */
  observe(sampleDbfs: number): number {
    if (!Number.isFinite(sampleDbfs)) return this.#gainDb;
    this.#all.push(sampleDbfs);
    if (this.#all.length > NORMALIZER_FLOOR_POLLS) this.#all.shift();
    const floor = this.floorDb();
    if (floor === undefined) return this.#gainDb;
    const isSpeech = (db: number) =>
      db >= NORMALIZER_MIN_SPEECH_DBFS &&
      db >= floor + NORMALIZER_SPEECH_ABOVE_FLOOR_DB;
    if (
      this.#classifiedFloor === undefined ||
      Math.abs(floor - this.#classifiedFloor) > NORMALIZER_RECLASSIFY_DB
    ) {
      // First floor, or the room changed: the recent polls are re-read
      // against it, so speech heard before the first pause still counts.
      this.#classifiedFloor = floor;
      this.#speech = this.#all
        .filter(isSpeech)
        .slice(-NORMALIZER_SPEECH_POLLS);
    } else if (isSpeech(sampleDbfs)) {
      this.#speech.push(sampleDbfs);
      if (this.#speech.length > NORMALIZER_SPEECH_POLLS) this.#speech.shift();
    }
    const desired = this.desiredGainDb();
    if (desired === undefined) return this.#gainDb;
    if (Math.abs(desired - this.#gainDb) <= NORMALIZER_CONVERGED_DB) {
      this.#converged = true;
    }
    if (desired > this.#gainDb) {
      const step = this.#converged
        ? NORMALIZER_UP_DB_PER_POLL
        : NORMALIZER_ATTACK_UP_DB_PER_POLL;
      this.#gainDb = Math.min(desired, this.#gainDb + step);
    } else {
      this.#gainDb = Math.max(
        desired,
        this.#gainDb - NORMALIZER_DOWN_DB_PER_POLL,
      );
    }
    return this.#gainDb;
  }
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
