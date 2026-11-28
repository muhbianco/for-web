/**
 * When a "speaking" indicator (the green ring on the map, the call tile, the
 * channel preview) may light up.
 *
 * LiveKit's `isSpeaking` comes from the server's active-speaker loop, which
 * smooths the audio level and only reports every few hundred ms. After a mute
 * it keeps the person "speaking" for 0.5–1.2 s while the muted badge is already
 * on: in the full lab (qa/full-lab/mute-lab.mjs, 28/11/2026) 6–13 % of the
 * samples after each mute showed the ring and the badge together, although the
 * audio itself stopped in ≤150 ms at the listener. That ring made people doubt
 * the mute worked.
 *
 * Discord never shows it: its `useIsSpeaking({ checkIsMuted })` is
 * `isSpeaking && !(mute || selfMute)`. Same rule here, so the ring can never
 * contradict the badge.
 */
export function speakingShown(s: {
  speaking: boolean;
  micMuted: boolean;
  deafened: boolean;
}): boolean {
  return s.speaking && !s.micMuted && !s.deafened;
}

/** The slice of a LiveKit participant `audibleSpeakers` reads. */
export interface SpeakerLike {
  isLocal: boolean;
  isMicrophoneEnabled: boolean;
}

/**
 * The active speakers worth a ring: whoever has the microphone published and
 * not muted. For ourselves the Voice state decides (`localMicOn`), because it
 * flips before LiveKit finishes muting and also covers deafen.
 */
export function audibleSpeakers<P extends SpeakerLike>(
  speakers: readonly P[],
  localMicOn: boolean,
): P[] {
  return speakers.filter(
    (p) => p.isMicrophoneEnabled && (!p.isLocal || localMicOn),
  );
}
