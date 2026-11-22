import { Show, createEffect, createMemo } from "solid-js";
import { AudioTrack, useTracks } from "solid-livekit-components";

import { getTrackReferenceId, isLocal } from "@livekit/components-core";
import { Key } from "@solid-primitives/keyed";
import { RemoteTrackPublication, Track } from "livekit-client";

import { useState } from "@revolt/state";

import { participantUserId } from "../identity";
import { useVoice } from "../state";

export function RoomAudioManager() {
  const voice = useVoice();
  const state = useState();

  const tracks = useTracks(
    [
      Track.Source.Microphone,
      Track.Source.ScreenShareAudio,
      Track.Source.Unknown,
    ],
    {
      updateOnlyOn: [],
      onlySubscribed: false,
    },
  );

  const filteredTracks = createMemo(() =>
    tracks().filter(
      (track) =>
        !isLocal(track.participant) &&
        track.publication.kind === Track.Kind.Audio,
    ),
  );

  createEffect(() => {
    const tracks = filteredTracks();
    console.info("[rtc] filtered tracks", filteredTracks());
    for (const track of tracks) {
      (track.publication as RemoteTrackPublication).setSubscribed(true);
      console.info(track.publication);
    }
  });

  const audioTracks = () => (
    <Key each={filteredTracks()} by={(item) => getTrackReferenceId(item)}>
      {(track) => (
        <AudioTrack
          trackRef={track()}
          volume={
            state.voice.outputVolume *
            (track().source === Track.Source.ScreenShareAudio
              ? state.voice.getScreenShareVolume(
                  participantUserId(track().participant.identity),
                )
              : state.voice.getUserVolume(
                  participantUserId(track().participant.identity),
                ))
          }
          muted={
            (track().source === Track.Source.ScreenShareAudio
              ? state.voice.getScreenShareMuted(
                  participantUserId(track().participant.identity),
                )
              : state.voice.getUserMuted(
                  participantUserId(track().participant.identity),
                )) || voice.deafen()
          }
          enableBoosting
        />
      )}
    </Key>
  );

  // A boosted track (volume > 100 %) plays through its own AudioContext, and
  // solid-livekit-components only points that context at the output device
  // when it creates it: switching the output mid-call left boosted people on
  // the old device. Keying the list on the device rebuilds them on the new one.
  const outputDevice = () => state.voice.preferredAudioOutputDevice ?? "";

  return (
    <div style={{ display: "none" }}>
      <Show when={outputDevice()} keyed fallback={audioTracks()}>
        {(_device: string) => audioTracks()}
      </Show>
    </div>
  );
}
