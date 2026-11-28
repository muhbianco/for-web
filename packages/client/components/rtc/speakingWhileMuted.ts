/**
 * "Você está mutado": noticing that someone talks with the mic muted.
 *
 * Discord does this (read from its client on 28/11/2026): the native engine
 * keeps its VAD on the capture while self-muted and fires
 * `SpeakingWhileMuted`; the account panel then shows a tooltip on the mic
 * button for 2.5 s, at most once every 2 min, and not while the pointer is on
 * the button. Here the VoiceProcessor reads the level of a private copy of the
 * capture (the published one is disabled by the mute) and feeds this detector;
 * the Voice state applies the show/cooldown policy. Nothing leaves the device.
 */

/** How often the processor samples the muted capture. */
export const SWM_TICK_MS = 100;
/** Quietest level that can count as speech (dBFS, ~43 ms RMS). */
export const SWM_MIN_DB = -50;
/** Speech is this far above the noise floor the detector learned. */
export const SWM_ABOVE_FLOOR_DB = 12;
/** Ticks considered, and how many of them must be speech (300 of 500 ms). */
export const SWM_WINDOW = 5;
export const SWM_NEED = 3;
/** The floor follows quiet instantly and rises slowly (5 dB/s): steady noise
 * (fan, music) stops counting after a few seconds, a word does not move it. */
export const SWM_FLOOR_RISE_DB = 0.5;

/** Show the notice for this long. */
export const SWM_SHOW_MS = 2_500;
/** And not again before this. */
export const SWM_COOLDOWN_MS = 120_000;

export class SpeakingWhileMutedDetector {
  private floorDb: number | undefined;
  private recent: boolean[] = [];
  private active = false;

  /** Forget everything (unmuted, or the capture changed). */
  reset() {
    this.floorDb = undefined;
    this.recent = [];
    this.active = false;
  }

  /**
   * One level reading of the muted capture. True only on the tick speech
   * starts (the rising edge), so a long sentence is one event.
   */
  update(levelDb: number): boolean {
    if (!Number.isFinite(levelDb)) levelDb = -120;
    const floor = this.floorDb;
    const speech =
      floor !== undefined &&
      levelDb >= SWM_MIN_DB &&
      levelDb >= floor + SWM_ABOVE_FLOOR_DB;
    this.floorDb =
      floor === undefined || levelDb < floor
        ? levelDb
        : Math.min(levelDb, floor + SWM_FLOOR_RISE_DB);

    this.recent.push(speech);
    if (this.recent.length > SWM_WINDOW) this.recent.shift();
    const talking = this.recent.filter(Boolean).length >= SWM_NEED;
    const started = talking && !this.active;
    // Back to quiet only when the whole window is quiet (pauses between words).
    if (talking) this.active = true;
    else if (!this.recent.some(Boolean)) this.active = false;
    return started;
  }
}

/** Whether a speaking-while-muted event becomes a visible notice now. */
export function shouldShowSpeakingWhileMuted(s: {
  now: number;
  lastShownAt: number | undefined;
  muted: boolean;
  inCall: boolean;
  canSpeak: boolean;
}): boolean {
  if (!s.muted || !s.inCall || !s.canSpeak) return false;
  return (
    s.lastShownAt === undefined || s.now - s.lastShownAt >= SWM_COOLDOWN_MS
  );
}
