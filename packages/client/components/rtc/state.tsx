import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createSignal,
  JSX,
  Setter,
  useContext,
} from "solid-js";
import {
  RoomContext,
  TrackReferenceOrPlaceholder,
  useTracks,
} from "solid-livekit-components";

import {
  LocalTrackPublication,
  Room,
  ScreenSharePresets,
  Track,
  VideoResolution,
} from "livekit-client";
import { Channel } from "stoat.js";

import { SoundController, useClientLifecycle, useSound } from "@revolt/client";
import { useInstance } from "@revolt/instance";
import { ModalController, useModals } from "@revolt/modal";
import type { ScreenShareSelection } from "@revolt/modal/types";
import { useState } from "@revolt/state";
import {
  NoiseSuppresionState,
  ScreenShareQualityName,
  Voice as VoiceSettings,
} from "@revolt/state/stores/Voice";
import { VoiceCallCardContext } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";

import { Device, useDevice } from "@revolt/common";
import { InRoom } from "./components/InRoom";
import { RoomAudioManager } from "./components/RoomAudioManager";
import { VoiceProcessor } from "./VoiceProcessor";

type State =
  | "READY"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING";

type ScreenShareQuality = {
  name: ScreenShareQualityName;
  resolution: VideoResolution;
  fullName: string;
  contentHint: "detail" | "text" | "motion";
};

class Voice {
  #settings: VoiceSettings;

  channel: Accessor<Channel | undefined>;
  #setChannel: Setter<Channel | undefined>;

  room: Accessor<Room | undefined>;
  #setRoom: Setter<Room | undefined>;

  vidTracks: Accessor<TrackReferenceOrPlaceholder[]>;

  state: Accessor<State>;
  #setState: Setter<State>;

  deafen: Accessor<boolean>;
  microphone: Accessor<boolean>;

  video: Accessor<boolean>;
  #setVideo: Setter<boolean>;

  screenshare: Accessor<boolean>;
  #setScreenshare: Setter<boolean>;

  fullscreen: Accessor<boolean>;
  #setFullscreen: Setter<boolean>;

  focusId: Accessor<string | undefined>;
  #setFocus: Setter<string | undefined>;

  showBar: Accessor<boolean>;
  #setShowBar: Setter<boolean>;

  private sound: SoundController;
  private device: Device;

  private openModal;
  private config;
  private limits;
  private screenShareTracks: Set<string>;
  private voiceProcessor?: VoiceProcessor;

  constructor(
    voiceSettings: VoiceSettings,
    modals: ModalController,
    sound: SoundController,
    device: Device,
  ) {
    this.#settings = voiceSettings;
    this.sound = sound;
    this.device = device;

    const [channel, setChannel] = createSignal<Channel>();
    this.channel = channel;
    this.#setChannel = setChannel;

    const [room, setRoom] = createSignal<Room>();
    this.room = room;
    this.#setRoom = setRoom;

    this.vidTracks = () => [];

    const [state, setState] = createSignal<State>("READY");
    this.state = state;
    this.#setState = setState;

    this.deafen = () => voiceSettings.deafen;
    this.microphone = () => voiceSettings.micOn && !voiceSettings.deafen;

    const [video, setVideo] = createSignal(false);
    this.video = video;
    this.#setVideo = setVideo;

    const [screenshare, setScreenshare] = createSignal(false);
    this.screenshare = screenshare;
    this.#setScreenshare = setScreenshare;

    const [fullscreen, setFullscreen] = createSignal(false);
    this.fullscreen = fullscreen;
    this.#setFullscreen = setFullscreen;

    const [focus, setFocus] = createSignal<string>();
    this.focusId = focus;
    this.#setFocus = setFocus;

    const [showBar, setShowBar] = createSignal(true);
    this.showBar = showBar;
    this.#setShowBar = setShowBar;

    const inst = useInstance();
    this.config = inst.config;
    this.limits = inst.limits;
    this.openModal = modals.openModal;

    this.screenShareTracks = new Set();

    // Setup settings listeners
    this.settingsListeners();
  }

  // Dynamically set echo cancellation and gain control when the settings are changed
  // These functions are needed to maintain reactivity. Don't ask me why but if you make them not functions it breaks.
  private settingsListeners() {
    const getSettings = () => this.#settings;

    const setEchoCancellation = (echoCancellation: boolean) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.constraints.echoCancellation = echoCancellation;
      }
    };

    const setAutoGainControl = (autoGainControl: boolean) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.constraints.autoGainControl = autoGainControl;
      }
    };

    const setNoiseSuppression = (noiseSuppression: NoiseSuppresionState) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        if (noiseSuppression === "browser") {
          track.constraints.noiseSuppression = true;
          //@ts-expect-error voiceIsolation is not yet standard, but it supported by livekit and most chromium based browsers, including electron.
          track.constraints.voiceIsolation = true;
        } else {
          track.constraints.noiseSuppression = false;
          //@ts-expect-error voiceIsolation is not yet standard, but it supported by livekit and most chromium based browsers, including electron.
          track.constraints.voiceIsolation = false;
        }
      }
    };

    const restartTrack = () => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.restartTrack();
      }
    };

    createEffect(() => {
      setEchoCancellation(getSettings().echoCancellation ?? true);
      setAutoGainControl(getSettings().autoGainControl ?? true);
      setNoiseSuppression(getSettings().noiseSupression ?? "browser");
      restartTrack();
    });
  }

  async connect(channel: Channel, auth?: { url: string; token: string }) {
    this.disconnect();

    this.device.setWakeLocked();

    const room = new Room({
      audioCaptureDefaults: {
        deviceId: this.#settings.preferredAudioInputDevice,
        echoCancellation: this.#settings.echoCancellation,
        noiseSuppression: this.#settings.noiseSupression === "browser",
        autoGainControl: this.#settings.autoGainControl,
        voiceIsolation: this.#settings.noiseSupression === "browser",
      },
      audioOutput: {
        deviceId: this.#settings.preferredAudioOutputDevice,
      },
      videoCaptureDefaults: {
        resolution: {
          width: 1280,
          height: 720,
          frameRate: 30,
        },
        deviceId: this.#settings.preferredVideoDevice,
      },
    });

    this.vidTracks = useTracks(
      [
        { source: Track.Source.Camera, withPlaceholder: true },
        { source: Track.Source.ScreenShare, withPlaceholder: false },
      ],
      { room, onlySubscribed: false },
    );

    batch(() => {
      this.#setRoom(room);
      this.#setChannel(channel);
      this.#setState("CONNECTING");
      this.#setVideo(false);
      this.#setScreenshare(false);
    });

    room.addListener("connected", () => {
      this.#setState("CONNECTED");
      if (this.speakingPermission)
        room.localParticipant
          .setMicrophoneEnabled(this.#settings.micOn)
          .then((track) => {
            this.#settings.micOn = track != null;
          });
      for (const p of room.remoteParticipants.values()) {
        const screenShareTrack = p.getTrackPublication(
          Track.Source.ScreenShare,
        );
        if (screenShareTrack) {
          this.screenShareTracks.add(screenShareTrack.trackSid);
        }
      }
      this.sound.playSound("userJoinVoice");
    });

    room.addListener("disconnected", () => this.#setState("DISCONNECTED"));

    room.addListener("localTrackPublished", (pub) => {
      if (pub.audioTrack && pub.audioTrack.source === Track.Source.Microphone) {
        if (!pub.audioTrack.getProcessor()) {
          pub.audioTrack?.setProcessor(
            (this.voiceProcessor = new VoiceProcessor(this.#settings)),
          );
        }
      }
    });

    room.addListener("participantConnected", () => {
      this.sound.playSound("userJoinVoice");
    });

    room.addListener("participantDisconnected", () => {
      this.sound.playSound("userLeaveVoice");
    });

    room.addListener("trackPublished", (pub) => {
      if (pub.source === Track.Source.ScreenShare) {
        pub.once("subscribed", (track) => {
          // Play the sound once playback starts, which might be quite a bit after subscription
          // as it starts paused for the screen share settings modal.
          track.once("videoPlaybackStarted", () => {
            this.sound.playSound("streamStart");
            if (track.sid) {
              this.screenShareTracks.add(track.sid);
            }
          });
        });
      }
    });

    room.addListener("trackUnpublished", (unpub) => {
      if (this.screenShareTracks.has(unpub.trackSid)) {
        this.sound.playSound("streamEnd");
        this.screenShareTracks.delete(unpub.trackSid);
      }
    });

    // Gather latency
    const selected = await Promise.any(
      this.config.features.livekit.nodes.map(async (node) => {
        return fetch(node.public_url.replace("wss", "https")).then(() => {
          return node.name;
        });
      }),
    );

    if (!auth) {
      auth = await channel.joinCall(selected);
    }

    await room.connect(auth.url, auth.token, {
      autoSubscribe: false,
    });
  }

  /**
   * Stop local mic/camera/screenshare tracks so the OS releases the devices
   * and remote peers stop receiving audio even if Room.disconnect is delayed.
   */
  private stopLocalMedia(room: Room) {
    try {
      this.voiceProcessor?.processedTrack?.stop();
      void this.voiceProcessor?.destroy();
    } catch {
      /* processor teardown is best-effort */
    }
    this.voiceProcessor = undefined;

    for (const pub of room.localParticipant.getTrackPublications()) {
      try {
        pub.track?.stop();
      } catch {
        /* ignore */
      }
      const media = pub.track?.mediaStreamTrack;
      if (media && media.readyState !== "ended") {
        try {
          media.stop();
        } catch {
          /* ignore */
        }
      }
    }
  }

  disconnect(opts?: { silent?: boolean }) {
    this.device.releaseWakeLock();
    const room = this.room();

    try {
      if (room) {
        this.stopLocalMedia(room);
        room.removeAllListeners();
        void room.disconnect(true);
      }
    } catch (e) {
      if (opts?.silent) {
        console.error("[voice] disconnect", e);
      } else {
        this.onErr(e);
      }
    }

    batch(() => {
      this.#setState("READY");
      this.#setRoom();
      this.#setChannel();
      this.#setFullscreen(false);
      this.#setVideo(false);
      this.#setScreenshare(false);
      this.vidTracks = () => [];
    });
    this.screenShareTracks = new Set();

    if (room && !opts?.silent) {
      this.sound.playSound("userLeaveVoice");
    }
  }

  async toggleDeafen(fromMute?: boolean) {
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setMicrophoneEnabled(
        (this.#settings.micOn || !!fromMute) &&
          !room.localParticipant.isMicrophoneEnabled,
      );

      this.#settings.deafen = !this.#settings.deafen;
      if (fromMute) {
        this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;
      }
      if (this.#settings.deafen) {
        this.sound.playSound("deafen");
      } else {
        this.sound.playSound("undeafen");
      }
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleMute() {
    if (this.#settings.deafen) {
      this.toggleDeafen(true);
      return;
    }
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setMicrophoneEnabled(
        !room.localParticipant.isMicrophoneEnabled,
      );

      this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;

      if (this.#settings.micOn) {
        this.sound.playSound("unmute");
      } else {
        this.sound.playSound("mute");
      }
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleCamera() {
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setCameraEnabled(
        !room.localParticipant.isCameraEnabled,
      );

      this.#setVideo(room.localParticipant.isCameraEnabled);
    } catch (e) {
      this.onErr(e);
    }
  }

  /**
   * Get the enabled screen share qualities. "low" will always be enabled.
   * Each screen share quality is checked against the limit if the limit is available on the client.
   *
   * TODO: Translate the fullNames here, I can't figure out how to do it.
   *
   * @param name The name of the screen share quality to get
   * @returns A partial record of ScreenShareQualityName to ScreenShareQuality. Will always contain "low" quality.
   */
  getEnabledScreenShareQualities(): Partial<
    Record<ScreenShareQualityName, ScreenShareQuality>
  > {
    // Always enable low
    const qualities: Partial<
      Record<ScreenShareQualityName, ScreenShareQuality>
    > = {
      low: {
        name: "low",
        resolution: ScreenSharePresets.h720fps30.resolution,
        fullName: `720p 30FPS`,
        contentHint: "motion",
      },
    };

    const limit = this.limits().video_resolution;

    // TODO: Add more resolutions to stream from if they're enabled. May tie into premium users in the future?
    if (
      (limit[0] === 0 || limit[0] >= 1920) &&
      (limit[1] === 0 || limit[1] >= 1080)
    ) {
      qualities.high = {
        name: "high",
        resolution: ScreenSharePresets.h1080fps30.resolution,
        fullName: `1080p 30FPS`,
        contentHint: "motion",
      };
      const originalResolution = ScreenSharePresets.original.resolution;
      originalResolution.frameRate = 5;
      originalResolution.aspectRatio = 0;

      const limit = this.limits().video_resolution;
      originalResolution.width = limit[0];
      originalResolution.height = limit[1];
      // If both resolutions are limited, set aspect ratio
      if (originalResolution.height !== 0 && originalResolution.width !== 0) {
        originalResolution.aspectRatio =
          originalResolution.width / originalResolution.height;
      }

      qualities.text = {
        name: "text",
        resolution: originalResolution,
        fullName: `Source 5FPS`,
        contentHint: "text",
      };
    }

    return qualities;
  }

  async toggleScreenshare() {
    const room = this.room();
    if (!room) {
      this.openModal({
        type: "error2",
        error: new Error("Entra na call antes de compartilhar a tela."),
      });
      return;
    }

    if (this.screenshare()) {
      await this.stopScreenshare();
      return;
    }

    // On the desktop shell we own the picker: list the sources, let the user
    // choose, and only capture from inside their click. In the browser the user
    // agent owns the picker, so we go straight to capture.
    if (window.native?.listScreenSources) {
      await this.pickScreenshareSource();
      return;
    }

    this.startScreenshare();
  }

  /** Stop sharing and drop any screen share audio still published. */
  private async stopScreenshare() {
    const room = this.room();
    if (!room) return;

    try {
      await room.localParticipant.setScreenShareEnabled(false);

      const audio = room.localParticipant.getTrackPublication(
        Track.Source.ScreenShareAudio,
      );
      if (audio?.track) {
        await room.localParticipant.unpublishTrack(audio.track);
      }

      this.#setScreenshare(room.localParticipant.isScreenShareEnabled);
      this.sound.playSound("streamEnd");
    } catch (e) {
      this.onErr(e);
    }
  }

  /** Ask the desktop shell for sources and open our own picker. */
  private async pickScreenshareSource() {
    const qualities = this.getEnabledScreenShareQualities();

    let sources;
    try {
      sources = await window.native!.listScreenSources!();
    } catch (e) {
      this.onErr(e);
      return;
    }

    if (!sources.length) {
      this.openModal({
        type: "error2",
        error: new Error(
          "Não achei nenhuma tela ou janela pra compartilhar. Se você está por RDP, tenta na sessão local.",
        ),
      });
      return;
    }

    this.openModal({
      type: "screen_share_picker",
      sources,
      qualities: Object.keys(qualities).map((k) => {
        const v = qualities[k as ScreenShareQualityName]!;
        return { name: k, fullName: v.fullName };
      }),
      arm: (sourceId, audio) => {
        void window.native!.armScreenShare!(sourceId, audio).catch((e) =>
          console.warn("[muchat] failed to arm screen share", e),
        );
      },
      // Runs inside the Go Live click so that getDisplayMedia still sees the
      // user gesture; awaiting anything here would break capture silently.
      callback: (selection) => this.startScreenshare(selection),
      onCancel: () => {},
    });
  }

  /**
   * Publish the screen share. Must be reachable synchronously from a user
   * gesture: everything up to livekit's getDisplayMedia call runs without an
   * await, which is what keeps the transient activation alive.
   */
  private startScreenshare(selection?: ScreenShareSelection) {
    const room = this.room();
    if (!room) return;

    const qualities = this.getEnabledScreenShareQualities();
    const qualityName =
      selection?.qualityName ?? this.#settings.screenShareQuality ?? "low";
    const quality = qualities[qualityName] ?? qualities.low!;
    const wantsAudio = selection
      ? selection.audio
      : this.#settings.screenShareAudio;

    const resolution = { ...quality.resolution };
    if (selection?.frameRate) {
      resolution.frameRate = selection.frameRate;
    }

    room.localParticipant
      .setScreenShareEnabled(true, {
        resolution,
        contentHint: quality.contentHint,
        audio: wantsAudio
          ? {
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
              voiceIsolation: false,
              restrictOwnAudio: true,
            }
          : false,
      })
      .then((localTrack) => this.onScreenshareStarted(localTrack, selection))
      .catch((e) => this.onErr(e));
  }

  /** Wire up the freshly published screen share track. */
  private onScreenshareStarted(
    localTrack: LocalTrackPublication | undefined,
    selection?: ScreenShareSelection,
  ) {
    const room = this.room();
    if (!room) return;

    this.#setScreenshare(room.localParticipant.isScreenShareEnabled);
    if (!localTrack) return;

    // Fired when the share ends outside our UI, e.g. the shared window closes
    // or the user hits the browser's own "stop sharing" bar. Without this,
    // livekit would keep publishing the screen share audio.
    localTrack.on("ended", () => {
      void this.stopScreenshare();
    });

    const screenAudioTrack = room.localParticipant.getTrackPublication(
      Track.Source.ScreenShareAudio,
    );

    // Our own picker already collected quality and audio, so there is nothing
    // left to ask. Only the browser path may still need the settings dialog.
    if (selection) {
      this.sound.playSound("streamStart");
      return;
    }

    const qualities = this.getEnabledScreenShareQualities();
    if (
      !this.#settings.screenShareQualityAsk ||
      Object.keys(qualities).length < 2
    ) {
      this.sound.playSound("streamStart");
      return;
    }

    localTrack.pauseUpstream();
    screenAudioTrack?.pauseUpstream();
    this.openModal({
      type: "screen_share_settings",
      trackReference: {
        participant: room.localParticipant,
        publication: localTrack,
        source: Track.Source.ScreenShare,
      },
      qualities: Object.keys(qualities).map((k) => {
        const v = qualities[k as ScreenShareQualityName]!;
        return { name: k, fullName: v.fullName };
      }),
      audio: !!screenAudioTrack,
      onCancel: () => void this.stopScreenshare(),
      callback: async (qualityName, audio) => {
        await this.applyScreenshareQuality(localTrack, qualityName, audio);
        localTrack.resumeUpstream();
        if (audio) screenAudioTrack?.resumeUpstream();
      },
    });
  }

  /** Re-constrain a live screen share track after the settings dialog. */
  private async applyScreenshareQuality(
    localTrack: LocalTrackPublication,
    qualityName: ScreenShareQualityName,
    audio: boolean,
  ) {
    const room = this.room();
    const videoTrack = localTrack.videoTrack;
    if (!room || !videoTrack) return;

    const qualities = this.getEnabledScreenShareQualities();
    const quality = qualities[qualityName] ?? qualities.low!;
    const { width, height, frameRate } = quality.resolution;

    try {
      await videoTrack.mediaStreamTrack.applyConstraints({
        frameRate: { max: frameRate },
        width: width === 0 ? undefined : { ideal: width, max: width },
        height: height === 0 ? undefined : { ideal: height, max: height },
      });
      videoTrack.mediaStreamTrack.contentHint = quality.contentHint;

      if (!audio) {
        const screenAudioTrack = room.localParticipant.getTrackPublication(
          Track.Source.ScreenShareAudio,
        );
        if (screenAudioTrack?.track) {
          await room.localParticipant.unpublishTrack(screenAudioTrack.track);
        }
      }

      this.sound.playSound("streamStart");
    } catch (e) {
      this.onErr(e);
    }
  }

  toggleFullscreen(fullscreen: boolean = !this.fullscreen()) {
    this.#setFullscreen(fullscreen);
  }

  trackId(t: TrackReferenceOrPlaceholder) {
    return `${t.source}_${t.participant.sid}`;
  }

  toggleFocus(t?: TrackReferenceOrPlaceholder) {
    const id = t ? this.trackId(t) : undefined;
    this.#setFocus(
      this.focusId() === id || this.vidTracks().length < 2 ? undefined : id,
    );
  }

  isFocus(t: TrackReferenceOrPlaceholder) {
    return this.trackId(t) === this.focusId();
  }

  focusTrack() {
    const id = this.focusId();
    return id
      ? this.vidTracks().find((t) => this.trackId(t) === id)
      : undefined;
  }

  toggleShowBar() {
    this.#setShowBar((s) => !s);
  }

  getConnectedUser(userId: string) {
    return this.room()?.getParticipantByIdentity(userId);
  }

  showCard(channel: Channel) {
    return (
      channel.isVoice &&
      (this.channel()?.id === channel.id ||
        channel.type === "TextChannel" ||
        !!channel.voiceParticipants.size)
    );
  }

  getMicrophoneTrack(): LocalTrackPublication | undefined {
    const track = this.room()?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    );
    return track;
  }

  get listenPermission() {
    return !!this.channel()?.havePermission("Listen");
  }

  get speakingPermission() {
    return !!this.channel()?.havePermission("Speak");
  }

  private onErr(e: unknown) {
    // Always leave a trace: a silently swallowed rejection here is exactly how
    // screen sharing "did nothing" with no error for days.
    console.error("[voice]", e);

    // A user declining a permission prompt or closing the OS picker is not a
    // failure worth a modal; anything else is.
    if ((e as Error)?.name === "NotAllowedError") return;
    this.openModal({ type: "error2", error: e });
  }
}

const voiceContext = createContext<Voice>(null as unknown as Voice);

/**
 * Mount global voice context and room audio manager
 */
export function VoiceContext(props: { children: JSX.Element }) {
  const state = useState();
  const modals = useModals();
  const sound = useSound();
  const device = useDevice();
  const { isLoggedIn } = useClientLifecycle();
  const voice = new Voice(state.voice, modals, sound, device);

  createEffect(() => {
    if (!isLoggedIn()) {
      voice.disconnect({ silent: true });
    }
  });

  return (
    <voiceContext.Provider value={voice}>
      <RoomContext.Provider value={voice.room}>
        <VoiceCallCardContext>{props.children}</VoiceCallCardContext>
        <InRoom>
          <RoomAudioManager />
        </InRoom>
      </RoomContext.Provider>
    </voiceContext.Provider>
  );
}

export const useVoice = () => useContext(voiceContext);
