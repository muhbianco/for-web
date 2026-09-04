import { Accessor, createSignal, onCleanup, onMount } from "solid-js";

import { Participant, ParticipantEvent } from "livekit-client";

import { isDeafenedAttribute } from "./deafenAttribute";
import { useVoice } from "./state";

/**
 * Headset-off (deafen) for a LiveKit participant.
 *
 * Local: the Voice store is source of truth so the sidebar updates immediately.
 * Remote: LiveKit participant attributes published by the other client.
 */
export function useIsDeafened(participant: Participant): Accessor<boolean> {
  const voice = useVoice();
  const [fromRoom, setFromRoom] = createSignal(
    isDeafenedAttribute(participant.attributes),
  );

  onMount(() => {
    const onChange = () =>
      setFromRoom(isDeafenedAttribute(participant.attributes));
    participant.on(ParticipantEvent.AttributesChanged, onChange);
    onCleanup(() =>
      participant.off(ParticipantEvent.AttributesChanged, onChange),
    );
  });

  return () =>
    participant.isLocal
      ? voice.deafen() || !voice.listenPermission
      : fromRoom();
}
