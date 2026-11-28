import type { Accessor } from "solid-js";
import { useIsMuted, useIsSpeaking } from "solid-livekit-components";

import { type Participant, Track } from "livekit-client";

import { speakingShown } from "./speakingShown";
import { useVoice } from "./state";
import { useIsDeafened } from "./useIsDeafened";

/**
 * `useIsSpeaking` that never lights up for a muted or deafened participant
 * (see speakingShown.ts). Ourselves: the Voice state, which flips on the click.
 */
export function useSpeakingShown(participant: Participant): Accessor<boolean> {
  const voice = useVoice();
  const speaking = useIsSpeaking(participant);
  const muted = useIsMuted({
    participant,
    source: Track.Source.Microphone,
  });
  const deafened = useIsDeafened(participant);
  return () =>
    speakingShown({
      speaking: speaking(),
      micMuted: muted() || (participant.isLocal && !voice.microphone()),
      deafened: deafened(),
    });
}
