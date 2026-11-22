/**
 * What to do with the published microphone when it should be sending audio
 * and is not.
 *
 * The "limbo" (docs/voz/10 in the muchat repo): when the raw capture track
 * fires `mute` (the OS or the device stopped delivering audio — a headset mute
 * button, a wireless headset dozing off while the person is AFK), livekit-client
 * waits 5 s and pauses the upstream (`replaceTrack(null)`, track reported muted
 * to the server). Only the raw track's `unmute` event or a restart resume it;
 * the app's own unmute does not. The person then sees their mic open while
 * everyone else sees them muted and hears nothing, until they leave the room.
 *
 * The decision is pure so it can be tested; Voice applies it on every unmute
 * and on a watchdog tick while the mic is meant to be open.
 */

export type MicHealReason = "unmute" | "watchdog";

export type MicHealAction = "none" | "resume" | "restart";

export interface MicHealthInput {
  /** The person wants the mic open (not muted, not deafened). */
  micOn: boolean;
  /** livekit-client stopped sending the track (pauseUpstream). */
  upstreamPaused: boolean;
  /** readyState of the raw capture track. */
  sourceState: MediaStreamTrackState | undefined;
  /** The raw capture track is muted by the OS/device (MediaStreamTrack.muted). */
  sourceMuted: boolean;
  /** How long the upstream has been paused while the mic was meant to be open. */
  pausedForMs: number;
  /** Time since this client last re-acquired the microphone. */
  sinceLastRestartMs: number;
  reason: MicHealReason;
}

/** A restart re-opens the device: never more often than this on the watchdog. */
export const MIC_WATCHDOG_RESTART_INTERVAL_MS = 30_000;
/** Even a person pressing unmute again and again does not hammer getUserMedia. */
export const MIC_UNMUTE_RESTART_INTERVAL_MS = 5_000;
/**
 * The OS may un-mute the device on its own and fire `unmute` (livekit then
 * resumes by itself); the watchdog gives it this long before re-opening it.
 */
export const MIC_WATCHDOG_RESTART_AFTER_MS = 15_000;

export function decideMicHeal(input: MicHealthInput): MicHealAction {
  if (!input.micOn) return "none";

  const restartAllowed =
    input.reason === "unmute"
      ? input.sinceLastRestartMs >= MIC_UNMUTE_RESTART_INTERVAL_MS
      : input.sinceLastRestartMs >= MIC_WATCHDOG_RESTART_INTERVAL_MS;

  // The capture died (device unplugged, driver reset). livekit restarts it on
  // unmute and on `ended` while open, but not if that restart failed earlier.
  if (input.sourceState === "ended") {
    return restartAllowed ? "restart" : "none";
  }

  if (!input.upstreamPaused) return "none";

  // The device delivers again but the `unmute` event never reached livekit:
  // just send the track again.
  if (!input.sourceMuted) return "resume";

  // Still muted by the OS. A fresh capture often comes back live (the device
  // recovered without telling the old track); if not, livekit pauses again and
  // the UI keeps telling the person the system is silencing the mic.
  if (input.reason === "unmute") return restartAllowed ? "restart" : "none";
  if (input.pausedForMs >= MIC_WATCHDOG_RESTART_AFTER_MS && restartAllowed) {
    return "restart";
  }
  return "none";
}

/**
 * The person is sending nothing although their mic button says open: what the
 * UI warns about ("the system is silencing your microphone").
 */
export function micBlocked(opts: {
  micOn: boolean;
  inCall: boolean;
  upstreamPaused?: boolean;
  sourceMuted?: boolean;
  sourceState?: MediaStreamTrackState;
}): boolean {
  if (!opts.micOn || !opts.inCall) return false;
  return (
    !!opts.upstreamPaused || !!opts.sourceMuted || opts.sourceState === "ended"
  );
}
