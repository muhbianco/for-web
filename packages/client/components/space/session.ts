import { createEffect, createRoot, on, onCleanup } from "solid-js";

import {
  type MediaGrant,
  type SpaceUiState,
  SpaceView,
  type SpaceViewOptions,
  type VoicePort,
} from "@muchat/space-client";
import { type Participant, RoomEvent, Track } from "livekit-client";
import type { Client } from "stoat.js";

import type { useVoice } from "@revolt/rtc";
import { participantUserId } from "@revolt/rtc/identity";

type Voice = ReturnType<typeof useVoice>;

/**
 * The app's single Voice seen as the space needs it. A room of the space IS a
 * Stoat voice channel, so the whole call UI (dock, floating card, mic, camera,
 * screen, noise suppression, devices, Android voice service) works unchanged:
 * only the token comes from the space server instead of join_call.
 */
export function voicePort(voice: Voice, client: () => Client): VoicePort {
  return {
    async connect(grant: MediaGrant) {
      const c = client();
      const channel = c.channels.get(grant.room_id) ?? (await c.channels.fetch(grant.room_id));
      if (!channel) throw new Error("room channel not found");
      await voice.connect(channel, { url: grant.url, token: grant.token }, { rethrow: true });
    },
    disconnect: () => voice.disconnect(),
    identity: () => voice.room()?.localParticipant?.identity || null,
    live: () => voice.state() === "CONNECTED",
    busyElsewhere: (roomId) => {
      const current = voice.channel();
      return !!current && current.id !== roomId;
    },
    stopScreenShare: () => {
      if (voice.screenshare()) void voice.toggleScreenshare();
    },
  };
}

interface Entry {
  view: SpaceView;
  dispose: () => void;
}

const sessions = new Map<string, Entry>();
const opening = new Map<string, Promise<SpaceView>>();

const holds = (s: SpaceUiState) =>
  s.media.kind === "connected" || s.media.kind === "connecting" || s.media.kind === "unavailable";

/**
 * Opens (or reattaches) the space of a server. A space stays connected after
 * its page closes while the person is in a room with audio, like a call: they
 * can read the room's chat or any other channel and keep talking. It closes on
 * its own once that audio ends.
 */
export function openSpace(
  opts: Omit<SpaceViewOptions, "voice"> & { voice: Voice; stoat: () => Client },
): Promise<SpaceView> {
  const existing = sessions.get(opts.serverId);
  if (existing) {
    try {
      existing.view.attach(opts.el);
      return Promise.resolve(existing.view);
    } catch (err) {
      // A kept space that can no longer draw would fail the same way on every
      // visit until the app restarts: drop it (its audio too) and open anew.
      console.error(
        "[space] could not reattach the kept space; reopening",
        err,
      );
      try {
        closeSpace(opts.serverId, existing);
      } catch (closeErr) {
        // Already out of `sessions` and its socket stopped; only drawing state is left.
        console.error("[space] closing the broken space failed", closeErr);
      }
    }
  }
  const pending = opening.get(opts.serverId);
  if (pending) return pending;

  const p = (async () => {
    const { voice, stoat, ...viewOpts } = opts;
    const view = await SpaceView.mount({ ...viewOpts, voice: voicePort(voice, stoat) });
    const dispose = createRoot((disposeRoot) => {
      // The call changed under the space: hung up in the dock, another call
      // started, or LiveKit dropped. MediaLink decides what that means.
      createEffect(
        on(
          () => [voice.state(), voice.channel()?.id] as const,
          ([state, channelId]) => {
            const media = view.ui.media;
            if (media.kind !== "connected") return;
            if (channelId !== media.roomId) view.voiceChanged("gone");
            else if (state === "DISCONNECTED") view.voiceChanged("dropped");
          },
          { defer: true },
        ),
      );
      // Someone in the room starts sharing a screen and nothing is in focus:
      // focus it, so the call card shows the presentation wherever the person
      // is (the map's stage, the floating card over another channel). Video
      // is subscribed only by what shows it; nothing else changes in the call.
      let shared = new Set<string>();
      createEffect(() => {
        const media = view.ui.media;
        // vidTracks is replaced on every connect: track the room to follow it.
        voice.room();
        const tracks = voice.vidTracks();
        const now = new Set<string>();
        for (const t of tracks) {
          if (t.source !== Track.Source.ScreenShare || !t.publication) continue;
          const key = voice.trackId(t);
          now.add(key);
          const fresh = !shared.has(key) && !t.participant.isLocal;
          if (fresh && media.kind === "connected" && !voice.focusTrack()) voice.focus(t);
        }
        shared = now;
      });
      // Our call's state for the others' indicators (ADR 0008): sent on change
      // only (SpaceView dedupes), and only for this space's room call.
      createEffect(() => {
        const media = view.ui.media;
        const channelId = voice.channel()?.id;
        const connected = voice.state() === "CONNECTED";
        const report = {
          connected,
          mic: connected && voice.microphone(),
          deaf: voice.deafen(),
          camera: connected && voice.video(),
          screen: connected && voice.screenshare(),
        };
        if (media.kind === "idle" || channelId !== media.roomId) return;
        view.reportVoice(report);
      });
      // Who speaks in our room's call: LiveKit already tells every participant
      // (read-only; nothing in the call changes). Drawn as a ring on the map.
      createEffect(() => {
        const room = voice.room();
        if (!room) {
          view.setSpeakers(new Set());
          return;
        }
        const update = (speakers: Participant[]) =>
          view.setSpeakers(new Set(speakers.map((p) => participantUserId(p.identity))));
        update(room.activeSpeakers);
        room.on(RoomEvent.ActiveSpeakersChanged, update);
        onCleanup(() => room.off(RoomEvent.ActiveSpeakersChanged, update));
      });
      return disposeRoot;
    });
    const entry: Entry = { view, dispose };
    sessions.set(opts.serverId, entry);
    view.subscribe((s) => {
      // Off the page and no audio to keep: nothing left to stay connected for.
      if (!view.isAttached && !holds(s)) queueMicrotask(() => closeSpace(opts.serverId, entry));
    });
    return view;
  })();
  opening.set(opts.serverId, p);
  void p.finally(() => opening.delete(opts.serverId)).catch(() => undefined);
  return p;
}

/** The page closed: keep the space only while it holds the room's audio. */
export function leaveSpacePage(serverId: string) {
  const entry = sessions.get(serverId);
  if (!entry) return;
  if (holds(entry.view.ui)) entry.view.detach();
  else closeSpace(serverId, entry);
}

function closeSpace(serverId: string, entry: Entry) {
  if (sessions.get(serverId) !== entry) return;
  sessions.delete(serverId);
  entry.dispose();
  entry.view.destroy();
}
