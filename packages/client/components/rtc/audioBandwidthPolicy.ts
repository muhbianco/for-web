/**
 * Opus ceiling when the uplink gets tight (doc 08 / doc 10 M2 in the muchat
 * repo).
 *
 * Measured in the voice lab on 15/11/2026: a 96 kbit/s uplink drops the call,
 * because RED doubles the payload (~96 kbps on the wire at 48 kbps) and
 * Chromium does not lower an audio bitrate by itself. The per-call reports of
 * 17–22/11 never saw the estimate under 300 kbps, so this only acts on a
 * sustained, clearly low estimate, and lets go with hysteresis.
 *
 * The cap goes on the RTP sender (setParameters), so it changes nothing in
 * the SDP and needs no renegotiation; RED keeps protecting the smaller payload.
 */

/** Below this estimate (kbps) for LOW_WINDOWS stats windows: cap. */
export const AUDIO_BW_LOW_KBPS = 120;
/** Above this for RECOVER_WINDOWS windows: back to the normal ceiling. */
export const AUDIO_BW_RECOVER_KBPS = 250;
export const AUDIO_BW_LOW_WINDOWS = 3;
export const AUDIO_BW_RECOVER_WINDOWS = 5;
/** 24 kbps Opus + RED + headers ≈ 60–70 kbps on the wire. */
export const AUDIO_BW_CAPPED_BITRATE = 24_000;

export type AudioBandwidthAction = "cap" | "restore";

export class AudioBandwidthPolicy {
  #low = 0;
  #ok = 0;
  #capped = false;

  capped(): boolean {
    return this.#capped;
  }

  /** One stats window. `kbps` undefined (no estimate yet) changes nothing. */
  observe(kbps: number | undefined): AudioBandwidthAction | undefined {
    if (kbps === undefined || !Number.isFinite(kbps)) return undefined;
    if (!this.#capped) {
      this.#low = kbps < AUDIO_BW_LOW_KBPS ? this.#low + 1 : 0;
      if (this.#low >= AUDIO_BW_LOW_WINDOWS) {
        this.#capped = true;
        this.#low = 0;
        this.#ok = 0;
        return "cap";
      }
      return undefined;
    }
    this.#ok = kbps > AUDIO_BW_RECOVER_KBPS ? this.#ok + 1 : 0;
    if (this.#ok >= AUDIO_BW_RECOVER_WINDOWS) {
      this.#capped = false;
      this.#ok = 0;
      this.#low = 0;
      return "restore";
    }
    return undefined;
  }

  reset() {
    this.#low = 0;
    this.#ok = 0;
    this.#capped = false;
  }
}
