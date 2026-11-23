import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createSignal,
  JSX,
  on,
  onCleanup,
  Setter,
  useContext,
} from "solid-js";
import {
  RoomContext,
  TrackReferenceOrPlaceholder,
  useTracks,
} from "solid-livekit-components";

import {
  LocalAudioTrack,
  LocalTrackPublication,
  Room,
  ScreenShareCaptureOptions,
  ScreenSharePresets,
  Track,
  TrackEvent,
  VideoEncoding,
} from "livekit-client";
import { Channel, Client, Message } from "stoat.js";

import {
  SoundController,
  useClient,
  useClientLifecycle,
  useSound,
} from "@revolt/client";
import { useInstance } from "@revolt/instance";
import { ModalController, useModals } from "@revolt/modal";
import type { ScreenShareSelection } from "@revolt/modal/types";
import { useState } from "@revolt/state";
import {
  ScreenShareQualityName,
  Voice as VoiceSettings,
} from "@revolt/state/stores/Voice";
import { VoiceCallCardContext } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";

import { Device, useDevice } from "@revolt/common";
import { notifyPushRing, privateCallTargets } from "./callPush";
import { diagnoseCall } from "./callDiagnosis";
import {
  type CallReport,
  CallRecorder,
  dspSampleFrom,
  loadLastReport,
  saveReport,
} from "./callRecorder";
import {
  type CallStatsSnapshot,
  CallStatsCollector,
  IDLE_CALL_STATS,
} from "./callStats";
import { InRoom } from "./components/InRoom";
import { RoomAudioManager } from "./components/RoomAudioManager";
import { buildVoiceRoomOptions, voiceCaptureOptions } from "./roomOptions";
import { deafenAttributeValue, VOICE_DEAFENED_ATTR } from "./deafenAttribute";
import { canUseDeepFilter } from "./deepFilterSupport";
import { clearEntitlements, isVip, refreshEntitlements } from "./entitlements";
import {
  type QualityTier,
  normaliseFrameRate,
  qualitiesForTier,
  screenShareDegradation,
  screenShareEncoding,
  screenShareLabel,
} from "./screenSharePresets";
import { cancelTts, parseTtsCommand, speakTts } from "./tts";
import {
  type VoiceEngineStatus,
  IDLE_VOICE_ENGINE_STATUS,
} from "./voiceEngineStatus";
import {
  AUDIO_BW_CAPPED_BITRATE,
  type AudioBandwidthAction,
  AudioBandwidthPolicy,
} from "./audioBandwidthPolicy";
import { type MicHealReason, decideMicHeal, micBlocked } from "./micHealth";
import { isCurrentRoom } from "./currentRoom";
import { VoiceProcessor } from "./VoiceProcessor";
import { participantUserId } from "./identity";

/**
 * How long a microphone stays captured, unpublished, between leaving one room
 * and joining the next (Espaço room changes, switching calls). Past this the
 * capture is released as if the call had simply ended. In the Espaço the
 * avatar walks from one door to the next, which in the full lab took longer
 * than the first value tried (6 s): the parked mic expired on the way and
 * every room opened the device again. Nothing is sent while parked.
 */
const PARK_MIC_MS = 20_000;

interface ParkedMic {
  track: LocalAudioTrack;
  processor: VoiceProcessor;
  timer: ReturnType<typeof setTimeout>;
}
import { isSpaceServer } from "../space/config";

type State =
  | "READY"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING";

export type CallRing = {
  direction: "incoming" | "outgoing";
  channel: Channel;
  userId: string;
};

export type VoiceLayout = "fullscreen" | "expanded" | "collapsed" | undefined;

type ScreenShareQuality = Required<
  Pick<ScreenShareCaptureOptions, "contentHint" | "resolution">
> & {
  name: ScreenShareQualityName;
  fullName: string;
  encoding: VideoEncoding;
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

  layout: Accessor<VoiceLayout>;
  #setLayout: Setter<VoiceLayout>;

  focusId: Accessor<string | undefined>;
  #setFocus: Setter<string | undefined>;

  showBar: Accessor<boolean>;
  #setShowBar: Setter<boolean>;

  ring: Accessor<CallRing | undefined>;
  #setRing: Setter<CallRing | undefined>;
  #ringTimer?: ReturnType<typeof setTimeout>;

  private sound: SoundController;
  private device: Device;

  private openModal;
  private config;
  private limits;
  private screenShareTracks: Set<string>;
  private voiceProcessor?: VoiceProcessor;
  #moving = false;

  /**
   * The mic button says open but nothing reaches the others: the OS or the
   * device is silencing the capture, or livekit paused the upstream (the
   * "limbo", docs/voz/10). The UI warns; healMicrophone tries to fix it.
   */
  micBlocked: Accessor<boolean>;
  #upstreamPausedSince?: number;
  #lastMicRestartAt = 0;
  #healing = false;
  #instrumentedMics = new WeakSet<LocalAudioTrack>();
  /** Capture + chain kept warm between two rooms (see parkMicrophone). */
  #parkedMic?: ParkedMic;
  /** The real stop() of each mic track, which guardMicrophoneStop wraps. */
  #micStops = new WeakMap<LocalAudioTrack, () => void>();
  /** True while this class tears a room down itself (real stops allowed). */
  #ownTeardown = false;
  /** Opus ceiling under a tight uplink (audioBandwidthPolicy.ts). */
  #bandwidth = new AudioBandwidthPolicy();
  /** The sender's own maxBitrate before a cap, to put back. */
  #normalAudioBitrate?: number;

  engineStatus: Accessor<VoiceEngineStatus>;
  #setEngineStatus: Setter<VoiceEngineStatus>;

  /** Network side of the diagnostics; engineStatus covers the DSP side. */
  callStats: Accessor<CallStatsSnapshot>;
  #setCallStats: Setter<CallStatsSnapshot>;
  #statsCollector: CallStatsCollector;
  /** Per-call report: the timeline behind the live panel, kept for export. */
  #recorder = new CallRecorder(diagnoseCall);

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

    const [layout, setLayout] = createSignal<VoiceLayout>();
    this.layout = layout;
    this.#setLayout = setLayout;

    const [focus, setFocus] = createSignal<string>();
    this.focusId = focus;
    this.#setFocus = setFocus;

    const [showBar, setShowBar] = createSignal(true);
    this.showBar = showBar;
    this.#setShowBar = setShowBar;

    const [ring, setRing] = createSignal<CallRing>();
    this.ring = ring;
    this.#setRing = setRing;
    this.#ringTimer = undefined;

    const [engineStatus, setEngineStatus] = createSignal<VoiceEngineStatus>(
      IDLE_VOICE_ENGINE_STATUS,
    );
    this.engineStatus = engineStatus;
    this.#setEngineStatus = setEngineStatus;

    const [callStats, setCallStats] =
      createSignal<CallStatsSnapshot>(IDLE_CALL_STATS);
    this.callStats = callStats;
    this.#setCallStats = setCallStats;
    this.#statsCollector = new CallStatsCollector((snapshot) => {
      this.#setCallStats(snapshot);
      this.#recorder.push(snapshot, dspSampleFrom(this.engineStatus()));
      // Watchdog: every stats window, check the open mic is really sending.
      if (this.microphone()) void this.healMicrophone("watchdog");
      const bw = this.#bandwidth.observe(
        snapshot.transport?.publisher?.availableOutgoingKbps,
      );
      if (bw) void this.applyAudioBitrateCap(bw);
    });

    this.micBlocked = () => {
      const status = this.engineStatus();
      return micBlocked({
        micOn: this.microphone(),
        inCall: this.state() === "CONNECTED",
        upstreamPaused: status.micUpstreamPaused,
        sourceMuted: status.micSourceMuted,
        sourceState: status.micSourceState,
      });
    };

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

    createEffect(
      on(
        () =>
          [
            getSettings().echoCancellation,
            getSettings().autoGainControl,
            getSettings().noiseSupression,
          ] as const,
        () => {
          void this.applyCaptureConstraints();
        },
        { defer: true },
      ),
    );
  }

  /** Capture constraints for the current settings (see roomOptions.ts). */
  private captureAudioOptions() {
    return voiceCaptureOptions(this.#settings);
  }

  private async applyCaptureConstraints() {
    const publication = this.getMicrophoneTrack();
    const track = publication?.audioTrack;
    if (!track) {
      this.syncEngineStatus();
      return;
    }

    const capture = this.captureAudioOptions();
    track.constraints.echoCancellation = capture.echoCancellation;
    track.constraints.autoGainControl = capture.autoGainControl;
    track.constraints.noiseSuppression = capture.noiseSuppression;
    //@ts-expect-error voiceIsolation is not yet standard, but it supported by livekit and most chromium based browsers, including electron.
    track.constraints.voiceIsolation = capture.voiceIsolation;

    try {
      await track.restartTrack();
    } catch (error) {
      console.warn("[voice] restartTrack failed", error);
    }

    await this.ensureVoiceProcessor(publication, true);
    this.syncEngineStatus();
  }

  private async ensureVoiceProcessor(
    publication?: LocalTrackPublication,
    forceReplace = false,
  ) {
    const pub = publication ?? this.getMicrophoneTrack();
    const track = pub?.audioTrack;
    if (!track || track.source !== Track.Source.Microphone) return;

    if (forceReplace && track.getProcessor()) {
      try {
        await track.stopProcessor();
      } catch (error) {
        console.warn("[voice] stopProcessor", error);
      }
      this.voiceProcessor = undefined;
    }

    this.instrumentMicrophone(track);

    if (!track.getProcessor()) {
      this.voiceProcessor = new VoiceProcessor(
        this.#settings,
        () => this.syncEngineStatus(),
        (kind, detail) => this.#recorder.event(kind, detail),
      );
      await track.setProcessor(this.voiceProcessor);
    }
  }

  /**
   * Puts what livekit does to the mic on the call report's timeline (the
   * limbo was invisible in every report) and keeps the paused-since clock the
   * watchdog uses. Once per track: a parked track is published again.
   */
  private instrumentMicrophone(track: LocalAudioTrack) {
    if (this.#instrumentedMics.has(track)) return;
    this.#instrumentedMics.add(track);
    this.guardMicrophoneStop(track);
    track.on(TrackEvent.UpstreamPaused, () => {
      this.#upstreamPausedSince = Date.now();
      this.#recorder.event("micUpstreamPaused");
      this.syncEngineStatus();
    });
    track.on(TrackEvent.UpstreamResumed, () => {
      this.#upstreamPausedSince = undefined;
      this.#recorder.event("micUpstreamResumed");
      this.syncEngineStatus();
    });
    track.on(TrackEvent.Ended, () => {
      this.#recorder.event("micEnded");
      this.syncEngineStatus();
    });
    track.on(TrackEvent.Restarted, () => {
      this.#recorder.event("micRestarted");
      this.syncEngineStatus();
    });
  }

  /**
   * Caps (or uncaps) the Opus bitrate on the mic's RTP sender. No SDP change
   * and no renegotiation; the encoding's own maxBitrate is kept to restore.
   */
  private async applyAudioBitrateCap(action: AudioBandwidthAction) {
    const sender = this.getMicrophoneTrack()?.audioTrack?.sender;
    if (!sender) return;
    try {
      const params = sender.getParameters();
      const encoding = params.encodings?.[0];
      if (!encoding) return;
      if (action === "cap") {
        this.#normalAudioBitrate = encoding.maxBitrate;
        encoding.maxBitrate = AUDIO_BW_CAPPED_BITRATE;
      } else if (this.#normalAudioBitrate !== undefined) {
        encoding.maxBitrate = this.#normalAudioBitrate;
      } else {
        delete encoding.maxBitrate;
      }
      await sender.setParameters(params);
      this.#recorder.event(
        "audioBitrate",
        action === "cap"
          ? `cap ${AUDIO_BW_CAPPED_BITRATE}`
          : `restore ${this.#normalAudioBitrate ?? "default"}`,
      );
    } catch (error) {
      console.warn("[voice] could not change the audio bitrate", error);
    }
  }

  /**
   * Makes an open mic actually send (see micHealth.ts): resumes a context
   * something suspended, resumes an upstream livekit left paused, or re-opens
   * a capture the OS muted or killed. Runs on every unmute and on the stats
   * watchdog while the mic is meant to be open.
   */
  async healMicrophone(reason: MicHealReason) {
    if (this.#healing) return;
    const room = this.room();
    const track = this.getMicrophoneTrack()?.audioTrack;
    if (!room || !track || this.state() !== "CONNECTED") return;
    this.#healing = true;
    try {
      const micOn =
        this.microphone() && room.localParticipant.isMicrophoneEnabled;
      if (!micOn) return;

      // A suspended context publishes nothing, whatever the track says.
      const processor = this.voiceProcessor;
      const before = processor?.getSnapshot().contextState;
      if (before && before !== "running") {
        const after = await processor?.ensureRunning();
        this.#recorder.event("micHeal", `${reason}:context ${before}->${after}`);
      }

      const source = processor?.sourceTrackState();
      const now = Date.now();
      const paused = track.isUpstreamPaused;
      if (paused && this.#upstreamPausedSince === undefined) {
        this.#upstreamPausedSince = now;
      }
      const action = decideMicHeal({
        micOn,
        upstreamPaused: paused,
        sourceState: source?.state,
        sourceMuted: source?.muted ?? false,
        pausedForMs: paused ? now - (this.#upstreamPausedSince ?? now) : 0,
        sinceLastRestartMs: now - this.#lastMicRestartAt,
        reason,
      });
      if (action === "none") return;
      this.#recorder.event("micHeal", `${reason}:${action}`);
      if (action === "resume") {
        await track.resumeUpstream();
      } else {
        this.#lastMicRestartAt = now;
        await track.restartTrack();
      }
    } catch (error) {
      console.warn("[voice] microphone heal failed", error);
      this.#recorder.event("micHeal", `${reason}:failed`);
    } finally {
      this.#healing = false;
      this.syncEngineStatus();
    }
  }

  private syncEngineStatus() {
    const publication = this.getMicrophoneTrack();
    const audioTrack = publication?.audioTrack;
    // `mediaStreamTrack` is the processed track once a processor is attached
    // (a MediaStreamDestination with no capture settings); read the capture
    // device's settings instead.
    const hardware:
      | (MediaTrackSettings & { channelCount?: number })
      | undefined =
      audioTrack?.getSourceTrackSettings?.() ??
      audioTrack?.mediaStreamTrack?.getSettings?.();
    const snapshot = this.voiceProcessor?.getSnapshot();
    const inCall =
      this.state() === "CONNECTED" ||
      this.state() === "CONNECTING" ||
      this.state() === "RECONNECTING";

    this.#setEngineStatus({
      engine: inCall ? (snapshot?.engine ?? "idle") : "idle",
      selectedMode: this.#settings.noiseSupression,
      sampleRate: snapshot?.sampleRate,
      inputSampleRate: hardware?.sampleRate,
      processorAttached: !!publication?.audioTrack?.getProcessor(),
      inCall,
      echoCancellation: hardware?.echoCancellation,
      autoGainControl: hardware?.autoGainControl,
      noiseSuppression: hardware?.noiseSuppression,
      lastError: snapshot?.lastError,
      canUseDeepFilter: canUseDeepFilter(),
      inputRms: snapshot?.inputRms,
      gateOpen: snapshot?.gateOpen,
      gateOpenThreshold: snapshot?.gateOpenThreshold,
      deepFilterAttenDb: snapshot?.deepFilterAttenDb,
      noiseFloorDb: snapshot?.noiseFloorDb,
      inputChannelCount: hardware?.channelCount,
      deepFilterMaxFrameMs: snapshot?.deepFilterMaxFrameMs,
      deepFilterStatWindows: snapshot?.deepFilterStatWindows,
      deepFilterStatFrames: snapshot?.deepFilterStatFrames,
      deepFilterSlowRatio: snapshot?.deepFilterSlowRatio,
      deepFilterOverloaded: snapshot?.deepFilterOverloaded,
      vadEngine: snapshot?.vadEngine,
      speechProb: snapshot?.speechProb,
      vadInferMs: snapshot?.vadInferMs,
      vadError: snapshot?.vadError,
      silentMsPerSec: snapshot?.silentMsPerSec,
      longestSilentRunMs: snapshot?.longestSilentRunMs,
      outputPeak: snapshot?.outputPeak,
      agcGainDb: snapshot?.agcGainDb,
      speechLevelDb: snapshot?.speechLevelDb,
      micUpstreamPaused: inCall
        ? publication?.audioTrack?.isUpstreamPaused
        : undefined,
      micSourceMuted: inCall ? snapshot?.sourceMuted : undefined,
      micSourceState: inCall ? snapshot?.sourceState : undefined,
      audioContextState: inCall ? snapshot?.contextState : undefined,
    });
  }

  /**
   * Joins `channel`. A refused or failed join (join_call error, the LiveKit
   * admission gate answering 403, no reachable node) never leaves the call
   * stuck in CONNECTING: the half-made room is torn down and the error is
   * reported. Pass `rethrow` when the caller retries on its own.
   */
  async connect(
    channel: Channel,
    auth?: { url: string; token: string },
    opts?: { recipients?: string[]; rethrow?: boolean },
  ) {
    // Leaving one room for another: keep the mic chain warm for the next one.
    this.disconnect({ park: true });

    this.device.setWakeLocked();
    this.#recorder.start({ room: channel.id });

    // Lido uma vez por chamada: o tier decide o que esta Room pode publicar, e
    // mudá-lo no meio exigiria republicar as tracks.
    const vip = isVip();

    // Capture, output and publish options live in roomOptions.ts so the voice
    // lab (qa/voice-lab) measures exactly the Room this app builds.
    const room = new Room(buildVoiceRoomOptions(this.#settings, vip));

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
      this.#setLayout();
      this.#setFocus(undefined);
      this.#setShowBar(true);
    });

    room.addListener("connected", () => {
      this.#setState("CONNECTED");
      const parked = this.takeParkedMicrophone();
      if (!this.speakingPermission) {
        this.releaseMicrophone(parked, "no permission to speak here");
      } else if (parked) {
        void this.publishParkedMicrophone(room, parked);
      } else {
        this.openMicrophone(room);
      }
      for (const p of room.remoteParticipants.values()) {
        const screenShareTrack = p.getTrackPublication(
          Track.Source.ScreenShare,
        );
        if (screenShareTrack) {
          this.screenShareTracks.add(screenShareTrack.trackSid);
        }
      }
      this.sound.playSound("userJoinVoice");
      this.clearRing();
      this.syncNativeVoiceSession();
      this.publishDeafenState();
      this.#statsCollector.start(room);
      this.#recorder.connected({
        room: room.name,
        identity: room.localParticipant.identity,
      });
    });

    room.addListener("reconnecting", () => {
      this.#recorder.event("reconnecting");
    });
    room.addListener("reconnected", () => {
      this.#recorder.event("reconnected");
    });
    room.addListener("signalReconnecting", () => {
      this.#recorder.event("signalReconnecting");
    });
    room.addListener("connectionQualityChanged", (quality, participant) => {
      this.#recorder.event("quality", `${participant.identity}:${quality}`);
    });

    room.addListener("disconnected", () => {
      if (this.#moving) return;
      this.#setState("DISCONNECTED");
    });

    room.addListener("localTrackPublished", (pub) => {
      if (pub.audioTrack && pub.audioTrack.source === Track.Source.Microphone) {
        void this.ensureVoiceProcessor(pub).then(() => this.syncEngineStatus());
      }
    });

    room.addListener("participantConnected", (participant) => {
      this.sound.playSound("userJoinVoice");
      this.#recorder.event("participantConnected", participant.identity);
    });

    room.addListener("participantDisconnected", (participant) => {
      this.sound.playSound("userLeaveVoice");
      this.#recorder.event("participantDisconnected", participant.identity);
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

    try {
      if (!auth) {
        const selected = await Promise.any(
          this.config.features.livekit.nodes.map(async (node) => {
            return fetch(node.public_url.replace("wss", "https")).then(() => {
              return node.name;
            });
          }),
        );
        const startingPrivate =
          (channel.type === "DirectMessage" || channel.type === "Group") &&
          channel.voiceParticipants.size === 0;
        const recipients =
          opts?.recipients ??
          (startingPrivate ? privateCallTargets(channel) : undefined);
        auth = await channel.joinCall(selected, true, recipients);
        if (startingPrivate) {
          const peerId = recipients?.[0] ?? channel.recipient?.id ?? "";
          this.beginOutgoingRing(channel, peerId);
          if (peerId) {
            void notifyPushRing(channel, peerId).catch(() => {
              /* push is best-effort; WS ring still works */
            });
          }
        }
      }

      await room.connect(auth.url, auth.token, {
        autoSubscribe: false,
      });
    } catch (error) {
      // Only tear down if a newer connect() has not replaced this room meanwhile.
      if (this.room() === room) this.disconnect({ silent: true });
      if (opts?.rethrow) throw error;
      this.onErr(error);
    }
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

  /** The last finished call's report (this device), for the diagnostics panel. */
  lastCallReport(): CallReport | undefined {
    return loadLastReport();
  }

  /**
   * Opens the mic in a fresh room the usual way. A failure (no device, denied
   * permission) used to leave the button showing an open mic with nothing
   * published; now the button follows what was really published.
   *
   * Only for this room while it is still the call's (currentRoom.ts): when
   * the person already left it, its late answer (livekit's 15 s "engine not
   * connected" rejection) is dropped, not shown, and never turns the mic
   * setting off under the room they are in now (docs/voz/12).
   */
  private openMicrophone(room: Room) {
    room.localParticipant
      .setMicrophoneEnabled(this.#settings.micOn)
      .then((track) => {
        if (!isCurrentRoom(this.room(), room)) {
          // Published on a room already left: livekit's own teardown stops it;
          // stopping it here too releases the device without waiting for that.
          if (track?.audioTrack) this.stopMicTrack(track.audioTrack);
          this.#recorder.event("micOpenStale", "opened");
          return;
        }
        this.#settings.micOn = track != null;
      })
      .catch((error: unknown) => {
        if (!isCurrentRoom(this.room(), room)) {
          console.warn("[voice] mic of a room already left; ignored", error);
          this.#recorder.event("micOpenStale", String(error));
          return;
        }
        this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;
        this.#recorder.event("micOpenFailed", String(error));
        this.onErr(error);
      });
  }

  /**
   * In the Espaço the server moves people between rooms by removing them from
   * the old LiveKit room. livekit-client then tears the room down by itself
   * and stops every local track (`stopLocalTrackOnUnpublish`), mic and
   * processor included, before this class hears about it: measured in the full
   * lab on 22/11/2026, every room change opened the device again. The mic's
   * stop() is wrapped so that a stop this class did not ask for parks the
   * capture instead (PARK_MIC_MS); our own teardowns still stop it. Turning
   * the option off for the whole room is not an option: livekit also
   * unpublishes with stop=false to republish on reconnects, and camera and
   * screen tracks must keep their default behaviour.
   */
  private guardMicrophoneStop(track: LocalAudioTrack) {
    if (this.#micStops.has(track)) return;
    const original = track.stop.bind(track);
    this.#micStops.set(track, original);
    track.stop = () => {
      if (this.#ownTeardown || !track.getProcessor()) {
        original();
        return;
      }
      // livekit calls stop() twice in a teardown; the first one parked it.
      if (this.#parkedMic?.track === track) return;
      if (!this.parkTrack(track, track.getProcessor() as VoiceProcessor)) {
        original();
      }
    };
  }

  /** Really stops a mic track, past guardMicrophoneStop. */
  private stopMicTrack(track: LocalAudioTrack) {
    const original = this.#micStops.get(track);
    if (original) original();
    else track.stop();
  }

  /** Keeps a capture and its chain for the next room; false if it cannot. */
  private parkTrack(track: LocalAudioTrack, processor: VoiceProcessor): boolean {
    if (!(processor instanceof VoiceProcessor)) return false;
    if (processor.sourceTrackState()?.state !== "live") return false;
    this.releaseMicrophone(this.#parkedMic, "replaced by a newer park");
    if (this.voiceProcessor === processor) this.voiceProcessor = undefined;
    const parked: ParkedMic = {
      track,
      processor,
      timer: setTimeout(() => {
        if (this.#parkedMic === parked) {
          this.#parkedMic = undefined;
          this.releaseMicrophone(parked, "no room joined in time");
        }
      }, PARK_MIC_MS),
    };
    this.#parkedMic = parked;
    return true;
  }

  /**
   * Room → room without closing the mic (M1, docs/voz/10): unpublish the
   * track without stopping it and keep its processor, so the next room
   * publishes the same capture and the same warm chain (DeepFilter state,
   * learned gain, noise floor, VAD) instead of a new getUserMedia and a cold
   * model. unpublishTrack removes the publication synchronously, so the room
   * teardown that follows does not stop this track.
   */
  private parkMicrophone(room: Room) {
    const track = room.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.audioTrack;
    const processor = this.voiceProcessor;
    if (!track) return; // nothing published (listener, or mic never opened)
    if (!processor || track.getProcessor() !== processor) {
      console.warn("[voice] mic not parked: the processor is not ours");
      return;
    }
    if (!this.parkTrack(track, processor)) {
      console.warn("[voice] mic not parked: the capture already ended");
      return;
    }
    void room.localParticipant
      .unpublishTrack(track, false)
      .catch(() => undefined);
  }

  private takeParkedMicrophone(): ParkedMic | undefined {
    const parked = this.#parkedMic;
    this.#parkedMic = undefined;
    if (!parked) return undefined;
    clearTimeout(parked.timer);
    if (parked.processor.sourceTrackState()?.state !== "live") {
      this.releaseMicrophone(parked, "the capture ended while parked");
      return undefined;
    }
    return parked;
  }

  private releaseMicrophone(parked: ParkedMic | undefined, why?: string) {
    if (!parked) return;
    if (why) console.warn(`[voice] parked mic released: ${why}`);
    clearTimeout(parked.timer);
    if (this.#parkedMic === parked) this.#parkedMic = undefined;
    try {
      parked.processor.processedTrack?.stop();
      void parked.processor.destroy();
      this.stopMicTrack(parked.track);
    } catch {
      /* releasing a capture is best-effort */
    }
  }

  private async publishParkedMicrophone(room: Room, parked: ParkedMic) {
    try {
      // The new room starts in the state the person chose; a muted track is
      // published muted, like a mic muted after joining.
      if (!this.#settings.micOn && !parked.track.isMuted) {
        await parked.track.mute();
      } else if (this.#settings.micOn && parked.track.isMuted) {
        await parked.track.unmute();
      }
      // Left while that ran: publishing there would wait 15 s for nothing and
      // take the warm chain from the room the person is going to (docs/voz/12).
      if (!isCurrentRoom(this.room(), room)) {
        this.#recorder.event("micReuseStale");
        if (!this.parkTrack(parked.track, parked.processor)) {
          this.releaseMicrophone(parked, "the room was left before publishing");
        }
        return;
      }
      this.voiceProcessor = parked.processor;
      await room.localParticipant.publishTrack(parked.track, {
        source: Track.Source.Microphone,
      });
      this.#recorder.event("micReused");
      this.syncEngineStatus();
      if (this.#settings.micOn) void this.healMicrophone("unmute");
    } catch (error) {
      console.warn("[voice] could not reuse the microphone; reopening", error);
      this.#recorder.event("micReuseFailed", String(error));
      if (this.voiceProcessor === parked.processor) {
        this.voiceProcessor = undefined;
      }
      this.releaseMicrophone(parked);
      if (isCurrentRoom(this.room(), room)) this.openMicrophone(room);
    }
  }

  /**
   * `park`: another room is about to be joined (connect, an Espaço room
   * change): the mic is kept for PARK_MIC_MS instead of being released.
   */
  disconnect(opts?: { silent?: boolean; park?: boolean }) {
    this.#statsCollector.stop();
    const report = this.#recorder.stop();
    // Only calls that actually connected and ran for a while are worth keeping.
    if (report && report.windows >= 3) saveReport(report);
    this.device.releaseWakeLock();
    this.clearRing();
    this.syncNativeVoiceSession(true);
    cancelTts();
    const room = this.room();

    this.#upstreamPausedSince = undefined;
    this.#bandwidth.reset();
    this.#normalAudioBitrate = undefined;
    if (!opts?.park) {
      this.releaseMicrophone(this.#parkedMic, "the call ended");
    }

    this.#ownTeardown = true;
    try {
      if (room) {
        if (opts?.park) this.parkMicrophone(room);
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
    } finally {
      // room.disconnect() finishes later; by then our mic is either parked
      // (unpublished, livekit never sees it) or really stopped already.
      this.#ownTeardown = false;
    }

    batch(() => {
      this.#setState("READY");
      this.#setRoom();
      this.#setChannel();
      this.#setLayout();
      this.#setVideo(false);
      this.#setScreenshare(false);
      this.#setFocus(undefined);
      this.#setShowBar(true);
      this.vidTracks = () => [];
      this.#setEngineStatus(IDLE_VOICE_ENGINE_STATUS);
    });
    this.voiceProcessor = undefined;
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
      this.publishDeafenState();
      if (this.#settings.deafen) {
        cancelTts();
        this.sound.playSound("deafen");
      } else {
        this.sound.playSound("undeafen");
        if (room.localParticipant.isMicrophoneEnabled) {
          await this.healMicrophone("unmute");
        }
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
        // livekit's unmute does not resume an upstream it paused while the
        // OS had the device muted: the limbo (docs/voz/10).
        await this.healMicrophone("unmute");
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
  /** Supporter or not. Free whenever we have no proof otherwise. */
  tier(): QualityTier {
    return isVip() ? "vip" : "free";
  }

  getEnabledScreenShareQualities(): Partial<
    Record<ScreenShareQualityName, ScreenShareQuality>
  > {
    const tier = this.tier();
    const allowed = qualitiesForTier(tier);

    // "low" é sempre liberado: é o piso de todo mundo.
    const qualities: Partial<
      Record<ScreenShareQualityName, ScreenShareQuality>
    > = {
      low: {
        name: "low",
        resolution: ScreenSharePresets.h720fps30.resolution,
        fullName: screenShareLabel("low", undefined, tier),
        contentHint: "motion",
        encoding: screenShareEncoding("low", undefined, tier),
      },
    };

    const limit = this.limits().video_resolution;

    // O teto é a interseção: o servidor diz o máximo da instância, o tier diz
    // o máximo desta conta. Nenhum dos dois sozinho decide.
    if (
      allowed.includes("high") &&
      (limit[0] === 0 || limit[0] >= 1920) &&
      (limit[1] === 0 || limit[1] >= 1080)
    ) {
      qualities.high = {
        name: "high",
        resolution: ScreenSharePresets.h1080fps30.resolution,
        fullName: screenShareLabel("high", undefined, tier),
        contentHint: "motion",
        encoding: screenShareEncoding("high", undefined, tier),
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
        fullName: screenShareLabel("text", undefined, tier),
        contentHint: "text",
        encoding: screenShareEncoding("text", undefined, tier),
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

    // The frame rate has to reach the *encoding* as well, not just the
    // capture: livekit caps every layer at the encoding's maxFramerate, so
    // passing a 30 fps preset while capturing 60 published 30 and burned the
    // sender's CPU for nothing. See screenSharePresets.ts.
    // `quality` may have fallen back to "low" when the picked one is not
    // enabled, so derive from the resolved quality, not the requested name.
    const frameRate = normaliseFrameRate(
      quality.name,
      selection?.frameRate,
      this.tier(),
    );
    const resolution = { ...quality.resolution, frameRate };
    const encoding = screenShareEncoding(quality.name, frameRate, this.tier());

    room.localParticipant
      .setScreenShareEnabled(
        true,
        {
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
        },
        {
          screenShareEncoding: encoding,
          degradationPreference: screenShareDegradation(
            quality.name,
            frameRate,
            this.tier(),
          ),
        },
      )
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
    // The browser path has no FPS control, so this resolves to the default
    // (or 5 for source mode), exactly as before.
    const frameRate = normaliseFrameRate(quality.name, undefined, this.tier());

    try {
      // Our own livekit-client patch: re-applies the capture constraints AND
      // swaps publishOptions.screenShareEncoding, then recomputes the sender
      // encodings. The old raw applyConstraints() only moved the capture, so
      // switching quality mid-call left the previous bitrate/frame rate on
      // the wire.
      await videoTrack.applyScreenShareConstraints(
        {
          resolution: { ...quality.resolution, frameRate },
          contentHint: quality.contentHint,
        },
        screenShareEncoding(quality.name, frameRate, this.tier()),
      );

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

  resetLayout() {
    this.#setLayout();
  }

  toggleLayout(type: VoiceLayout) {
    this.#setLayout((l) => (l === type ? undefined : type));
  }

  fullscreen() {
    return this.layout() === "fullscreen";
  }

  toggleFullscreen(on: boolean = this.layout() !== "fullscreen") {
    this.#setLayout(on ? "fullscreen" : undefined);
  }

  trackId(t: TrackReferenceOrPlaceholder) {
    return `${t.source}_${t.participant.sid}`;
  }

  /**
   * "Watch" a track: show it as the main stage tile (Discord-style focus).
   * Refused when there is only one tile, since the grid already is that tile.
   */
  focus(t: TrackReferenceOrPlaceholder) {
    if (this.vidTracks().length < 2) return;
    this.#setFocus(this.trackId(t));
  }

  /**
   * "Stop watching": back to the plain grid. Also called automatically when
   * the focused track is unpublished or its participant leaves (see
   * VoiceCallCardActiveRoom), and on connect / disconnect.
   */
  clearFocus() {
    this.#setFocus(undefined);
    this.#setShowBar(true);
  }

  toggleFocus(t?: TrackReferenceOrPlaceholder) {
    if (!t || this.isFocus(t)) {
      this.clearFocus();
      return;
    }
    this.focus(t);
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
    const room = this.room();
    if (!room) return undefined;
    const direct = room.getParticipantByIdentity(userId);
    if (direct) return direct;
    // Rooms of the space use `sp_<user>_<seq>` identities (see ./identity).
    for (const p of room.remoteParticipants.values()) {
      if (participantUserId(p.identity) === userId) return p;
    }
    return participantUserId(room.localParticipant.identity) === userId
      ? room.localParticipant
      : undefined;
  }

  showCard(channel: Channel) {
    // In a space server you get into a room by walking in (the space grants
    // the media), so the "join" preview — which calls join_call, refused there
    // — never shows. Once you are in that room's call, its card is the call's
    // stage (grid, focus on a shared screen, expand, fullscreen), on the
    // room's chat and on the space's media stage alike.
    if (channel.serverId && isSpaceServer(channel.serverId)) {
      return this.channel()?.id === channel.id;
    }
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

  beginIncomingRing(channel: Channel, userId: string) {
    if (this.channel()?.id === channel.id) return;
    if (this.ring()?.channel.id === channel.id) return;
    this.clearRing();
    this.#setRing({ direction: "incoming", channel, userId });
    this.sound.startRingtone("ringtoneIncoming");
    try {
      window.native?.showIncomingCall?.();
    } catch {
      /* desktop shell is optional */
    }
    this.#ringTimer = setTimeout(() => this.clearRing(), 30_000);
  }

  beginOutgoingRing(channel: Channel, userId: string) {
    this.clearRing();
    this.#setRing({ direction: "outgoing", channel, userId });
    this.sound.startRingtone("ringtoneOutgoing");
    this.#ringTimer = setTimeout(() => this.clearRing(), 30_000);
  }

  clearRing() {
    if (this.#ringTimer) {
      clearTimeout(this.#ringTimer);
      this.#ringTimer = undefined;
    }
    this.sound.stopRingtone();
    this.#setRing(undefined);
  }

  async acceptIncoming() {
    const incoming = this.ring();
    if (!incoming || incoming.direction !== "incoming") return;
    const channel = incoming.channel;
    this.clearRing();
    await this.connect(channel);
  }

  declineIncoming() {
    this.clearRing();
  }

  /**
   * Broadcast headset-off so everyone in the LiveKit room can show it
   * next to the name. Token may omit canUpdateOwnMetadata; local UI
   * still uses the Voice store.
   */
  private publishDeafenState() {
    const room = this.room();
    if (!room) return;
    void room.localParticipant
      .setAttributes({
        [VOICE_DEAFENED_ATTR]: deafenAttributeValue(this.#settings.deafen),
      })
      .catch((error) => {
        console.warn("[voice] deafen attribute not published", error);
      });
  }

  private syncNativeVoiceSession(forceStop?: boolean) {
    const native = window.MuchatNative;
    if (!native?.startVoiceSession) return;
    const channel = this.channel();
    if (!forceStop && this.state() === "CONNECTED" && channel) {
      const title =
        channel.type === "DirectMessage"
          ? (channel.recipient?.displayName ?? "Chamada")
          : (channel.name ?? "Voz");
      native.startVoiceSession(title);
    } else {
      native.stopVoiceSession?.();
    }
  }

  private onErr(e: unknown) {
    // A server switched to the Muchat Espaço refuses classic voice
    // (FeatureDisabled{spatial_only}, raw JSON text from stoat-api): its rooms
    // are reached by walking in on the map, not by this call. Not a failure.
    if (typeof e === "string" && e.includes('"spatial_only"')) {
      console.warn("[voice] this server's voice lives in the space");
      return;
    }

    // Always leave a trace: a silently swallowed rejection here is exactly how
    // screen sharing "did nothing" with no error for days.
    console.error("[voice]", e);

    // A user declining a permission prompt or closing the OS picker is not a
    // failure worth a modal; anything else is.
    if ((e as Error)?.name === "NotAllowedError") return;
    this.openModal({ type: "error2", error: e });
  }

  /**
   * Drop the local LiveKit session if we were kicked from this channel.
   * A leave for the previous room during an admin move is expected — do not
   * tear down the reconnect.
   */
  handleVoiceChannelLeave(channelId: string, userId: string) {
    if (this.#moving) return;
    if (this.channel()?.id !== channelId) return;
    const me = this.channel()?.client.user?.id;
    if (me && userId === me) {
      this.disconnect({ silent: true });
    }
  }

  /**
   * Reconnect after an admin moved us into another voice channel.
   */
  async handleVoiceChannelMoved(
    client: Client,
    event: {
      node: string;
      from?: string;
      to?: string;
      token: string;
    },
  ) {
    if (!event.to) return;
    if (this.channel() && event.from && this.channel()!.id !== event.from) {
      return;
    }

    this.#moving = true;
    try {
      let dest = client.channels.get(event.to);
      if (!dest) {
        dest = await client.channels.fetch(event.to);
      }
      if (!dest) return;

      const nodes = this.config.features.livekit.nodes as {
        name: string;
        public_url: string;
      }[];
      const node = nodes.find((item) => item.name === event.node);
      this.sound.playSound("userMoved");
      try {
        if (node && event.token) {
          await this.connect(
            dest,
            { url: node.public_url, token: event.token },
            { rethrow: true },
          );
        } else {
          await this.connect(dest, undefined, { rethrow: true });
        }
      } catch (error) {
        console.error("[voice] move reconnect failed, retry joinCall", error);
        await this.connect(dest);
      }
    } catch (error) {
      console.error("[voice] move failed", error);
      this.onErr(error);
    } finally {
      this.#moving = false;
    }
  }

  playVoiceAlert() {
    this.sound.playSound("ringtoneIncoming", true, 1800);
  }

  /**
   * Discord-style `/tts`: a message with the command posted in the voice
   * channel we are connected to is spoken locally on this device. Everyone
   * in the call runs the same check, so everyone hears it (including the
   * author). Nothing is published to LiveKit.
   */
  handleTtsMessage(message: Message) {
    if (!this.#settings.ttsEnabled || this.#settings.deafen) return;
    if (this.state() !== "CONNECTED") return;

    const channel = this.channel();
    if (!channel || channel.id !== message.channelId) return;

    const author = message.author;
    if (author?.bot || author?.relationship === "Blocked") return;
    if (author && this.#settings.getUserMuted(author.id)) return;

    const text = parseTtsCommand(message.contentPlain);
    if (!text) return;

    speakTts(text, { volume: this.#settings.outputVolume }).catch((error) =>
      console.warn("[voice] tts failed", error),
    );
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
  const client = useClient();
  const { isLoggedIn } = useClientLifecycle();
  const voice = new Voice(state.voice, modals, sound, device);

  createEffect(() => {
    if (!isLoggedIn()) {
      voice.disconnect({ silent: true });
      // Um tier nunca sobrevive à sessão que o provou.
      clearEntitlements();
      return;
    }
    // Relido a cada login: o VIP vence sozinho, e quem acabou de pagar tem que
    // ver o que comprou sem reabrir o app.
    void refreshEntitlements(client());
  });

  createEffect(() => {
    const c = client();
    const onLeave = (channel: Channel, userId: string) => {
      voice.handleVoiceChannelLeave(channel.id, userId);
    };
    const onMoved = (event: {
      node: string;
      from?: string;
      to?: string;
      token: string;
    }) => {
      void voice.handleVoiceChannelMoved(c, event);
    };
    const onAlert = () => voice.playVoiceAlert();
    const onMessage = (message: Message) => voice.handleTtsMessage(message);
    c.addListener("voiceChannelLeave", onLeave);
    c.addListener("userMoveVoiceChannel", onMoved);
    c.addListener("voiceAlert", onAlert);
    c.addListener("messageCreate", onMessage);
    onCleanup(() => {
      c.removeListener("voiceChannelLeave", onLeave);
      c.removeListener("userMoveVoiceChannel", onMoved);
      c.removeListener("voiceAlert", onAlert);
      c.removeListener("messageCreate", onMessage);
    });
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
