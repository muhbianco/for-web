/**
 * Voice lab page. Builds the exact Room and microphone chain the app uses
 * (roomOptions.ts + VoiceProcessor.ts), connects with a token, records what
 * leaves the chain and what arrives from every remote participant, and
 * exposes it all on `window.__lab` for the Playwright driver (run.mjs).
 *
 * No Stoat login, no UI framework: just the media path under test.
 */
import {
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
} from "livekit-client";
import { createMutable } from "solid-js/store";

import {
  type CallStatsSnapshot,
  CallStatsCollector,
  IDLE_CALL_STATS,
} from "@revolt/rtc/callStats";
import { buildVoiceRoomOptions, voiceCaptureOptions } from "@revolt/rtc/roomOptions";
import { VoiceProcessor } from "@revolt/rtc/VoiceProcessor";
import type { Voice } from "@revolt/state/stores/Voice";
import type {
  DeepFilterSensitivity,
  NoiseSuppresionState,
} from "@revolt/state/stores/noiseSuppressionPolicy";

import { type Recording, encodeChunks, recordTrack } from "./recorderWorklet";

export interface LabConnectOptions {
  url: string;
  token: string;
  publish: boolean;
  ns: NoiseSuppresionState;
  gate: boolean;
  sensitivity: DeepFilterSensitivity;
  vip: boolean;
  /** Seconds of audio kept per recorded track (memory bound). */
  recordSeconds: number;
  /** Also record the capture before VoiceProcessor (fake device + browser APM). */
  recordRaw: boolean;
}

interface SdpCapture {
  side: "local" | "remote";
  type: string;
  /** Audio m-section codec lines only. */
  audio: string;
}

interface LabSnapshot {
  t: number;
  state: string;
  stats: CallStatsSnapshot;
  dsp?: ReturnType<VoiceProcessor["getSnapshot"]>;
  remoteCount: number;
  remoteIdentities: string[];
  sdps: SdpCapture[];
  iceServers: string[][];
  localIdentity?: string;
  room?: string;
  publishedSid?: string;
}

interface LabAudio {
  local?: string[];
  raw?: string[];
  remote: Record<string, string[]>;
  /** Wall-clock start of each recording, so two pages on one machine can be aligned. */
  localStartedAt?: number;
  remoteStartedAt: Record<string, number>;
}

const out = document.getElementById("out") as HTMLPreElement | null;
function log(line: string) {
  if (out) out.textContent = `${line}\n${out.textContent ?? ""}`.slice(0, 20000);
  console.info("[lab]", line);
}

/** Keep only what matters from an SDP: the audio m-section codec lines. */
function audioSection(sdp: string): string {
  const lines = sdp.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("m=audio"));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && l.startsWith("m="));
  return lines
    .slice(start, end < 0 ? undefined : end)
    .filter((l) => /^(m=|a=(rtpmap|fmtp|rtcp-fb|ptime|maxptime|sendrecv|sendonly|recvonly|inactive))/.test(l))
    .join("\n");
}

const sdps: SdpCapture[] = [];
const iceServers: string[][] = [];

// Capture negotiated SDP and the ICE server list (urls only, never credentials)
// without touching livekit-client.
const OriginalPC = window.RTCPeerConnection;
class LabPeerConnection extends OriginalPC {
  constructor(config?: RTCConfiguration) {
    super(config);
    iceServers.push(
      (config?.iceServers ?? []).flatMap((s) =>
        Array.isArray(s.urls) ? s.urls : [s.urls],
      ),
    );
  }
}
window.RTCPeerConnection = LabPeerConnection as typeof RTCPeerConnection;
const originalSetLocal = OriginalPC.prototype.setLocalDescription;
OriginalPC.prototype.setLocalDescription = async function (
  this: RTCPeerConnection,
  description?: RTCLocalSessionDescriptionInit,
) {
  const result = await originalSetLocal.call(this, description);
  const d = this.localDescription;
  if (d?.sdp) sdps.push({ side: "local", type: d.type, audio: audioSection(d.sdp) });
  return result;
};
const originalSetRemote = OriginalPC.prototype.setRemoteDescription;
OriginalPC.prototype.setRemoteDescription = async function (
  this: RTCPeerConnection,
  description: RTCSessionDescriptionInit,
) {
  const result = await originalSetRemote.call(this, description);
  if (description.sdp) {
    sdps.push({ side: "remote", type: description.type ?? "?", audio: audioSection(description.sdp) });
  }
  return result;
};

type LabSettings = Pick<
  Voice,
  | "inputVolume"
  | "noiseSupression"
  | "deepFilterSensitivity"
  | "inputSensitivity"
  | "voiceGate"
  | "echoCancellation"
  | "autoGainControl"
> & { readonly autoInputSensitivity: boolean };

class Lab {
  room?: Room;
  processor?: VoiceProcessor;
  micTrack?: LocalAudioTrack;
  settings?: LabSettings;
  latest: CallStatsSnapshot = IDLE_CALL_STATS;
  collector = new CallStatsCollector((s) => {
    this.latest = s;
  });
  localRec?: Recording;
  rawRec?: Recording;
  remoteRecs = new Map<string, Recording>();
  recordSeconds = 130;
  recordRaw = false;
  recorderContext?: AudioContext;
  publishedSid?: string;

  async connect(opts: LabConnectOptions) {
    await this.stop();
    sdps.length = 0;
    iceServers.length = 0;
    this.recordSeconds = opts.recordSeconds;
    this.recordRaw = opts.recordRaw;

    const settings = createMutable<LabSettings>({
      inputVolume: 1,
      noiseSupression: opts.ns,
      deepFilterSensitivity: opts.sensitivity,
      inputSensitivity: 0.35,
      voiceGate: opts.gate,
      echoCancellation: true,
      autoGainControl: true,
      get autoInputSensitivity() {
        return this.deepFilterSensitivity === "auto";
      },
    });
    this.settings = settings;

    const room = new Room(buildVoiceRoomOptions(settings, opts.vip));
    this.room = room;

    room.on(RoomEvent.TrackPublished, (pub) => {
      if (pub.kind === Track.Kind.Audio) pub.setSubscribed(true);
    });
    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      void this.onRemoteTrack(track, pub, participant);
    });
    room.on(RoomEvent.TrackUnsubscribed, (_track, _pub, participant) => {
      void this.remoteRecs.get(participant.identity)?.stop();
      this.remoteRecs.delete(participant.identity);
    });
    room.on(RoomEvent.Reconnecting, () => log("reconnecting"));
    room.on(RoomEvent.Reconnected, () => log("reconnected"));
    room.on(RoomEvent.Disconnected, (reason) => log(`disconnected: ${String(reason)}`));
    room.on(RoomEvent.ConnectionQualityChanged, (q, p) => log(`quality ${p.identity}: ${q}`));

    await room.connect(opts.url, opts.token, { autoSubscribe: false });
    log(`connected as ${room.localParticipant.identity} to ${room.name}`);
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.kind === Track.Kind.Audio) pub.setSubscribed(true);
      }
    }
    this.collector.start(room, { manual: true });

    if (opts.publish) {
      // Same path as Voice.connect: capture with the app's constraints, publish
      // with the app's publishDefaults, then attach the processor (the app does
      // it on `localTrackPublished`).
      const track = await createLocalAudioTrack(voiceCaptureOptions(settings));
      this.micTrack = track;
      const rawTrack = track.mediaStreamTrack;
      const publication = await room.localParticipant.publishTrack(track, {
        source: Track.Source.Microphone,
      });
      this.publishedSid = publication.trackSid;
      this.processor = new VoiceProcessor(settings as unknown as Voice, () => undefined);
      await track.setProcessor(this.processor);
      log(`published mic ${publication.trackSid}, engine=${this.processor.getSnapshot().engine}`);
      this.recorderContext = new AudioContext({ sampleRate: 48000 });
      const processed = this.processor.processedTrack ?? track.mediaStreamTrack;
      this.localRec = await recordTrack(processed, opts.recordSeconds, this.recorderContext);
      if (opts.recordRaw) {
        this.rawRec = await recordTrack(rawTrack, opts.recordSeconds, this.recorderContext);
      }
    }
    return { localIdentity: room.localParticipant.identity, room: room.name };
  }

  private async onRemoteTrack(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) {
    if (track.kind !== Track.Kind.Audio) return;
    // What the app does: an <audio> element per remote track.
    const element = track.attach();
    element.style.display = "none";
    document.body.appendChild(element);
    log(`subscribed ${participant.identity} ${pub.trackSid}`);
    this.recorderContext ??= new AudioContext({ sampleRate: 48000 });
    const rec = await recordTrack(track.mediaStreamTrack, this.recordSeconds, this.recorderContext);
    this.remoteRecs.set(participant.identity, rec);
  }

  snapshot(): LabSnapshot {
    const room = this.room;
    return {
      t: Date.now(),
      state: room?.state ?? "idle",
      stats: this.latest,
      dsp: this.processor?.getSnapshot(),
      remoteCount: room?.remoteParticipants.size ?? 0,
      remoteIdentities: room ? [...room.remoteParticipants.keys()] : [],
      sdps: [...sdps],
      iceServers: [...iceServers],
      localIdentity: room?.localParticipant.identity,
      room: room?.name,
      publishedSid: this.publishedSid,
    };
  }

  /** Forces a stats sample now (the driver aligns its own clock to it). */
  async sample() {
    await this.collector.sampleNow();
    return this.snapshot();
  }

  async stop(): Promise<LabAudio> {
    const audio: LabAudio = { remote: {}, remoteStartedAt: {} };
    if (this.localRec) {
      audio.localStartedAt = this.localRec.startedAt;
      audio.local = encodeChunks(await this.localRec.stop());
    }
    if (this.rawRec) audio.raw = encodeChunks(await this.rawRec.stop());
    for (const [identity, rec] of this.remoteRecs) {
      audio.remoteStartedAt[identity] = rec.startedAt;
      audio.remote[identity] = encodeChunks(await rec.stop());
    }
    this.localRec = undefined;
    this.rawRec = undefined;
    this.remoteRecs.clear();
    this.collector.stop();
    this.latest = IDLE_CALL_STATS;
    try {
      await this.processor?.destroy();
    } catch (error) {
      console.warn("[lab] processor destroy", error);
    }
    this.processor = undefined;
    this.micTrack?.stop();
    this.micTrack = undefined;
    if (this.room) {
      await this.room.disconnect(true);
      this.room = undefined;
    }
    if (this.recorderContext) {
      await this.recorderContext.close().catch(() => undefined);
      this.recorderContext = undefined;
    }
    document.querySelectorAll("audio").forEach((el) => el.remove());
    return audio;
  }
}

const lab = new Lab();
declare global {
  interface Window {
    __lab: Lab;
  }
}
window.__lab = lab;

// Manual controls.
document.getElementById("connect")?.addEventListener("click", () => {
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  const checked = (id: string) => (document.getElementById(id) as HTMLInputElement).checked;
  lab
    .connect({
      url: value("url"),
      token: value("token"),
      publish: checked("publish"),
      ns: value("ns") as NoiseSuppresionState,
      gate: checked("gate"),
      sensitivity: "auto",
      vip: false,
      recordSeconds: 60,
      recordRaw: false,
    })
    .then((r) => log(`ok ${JSON.stringify(r)}`))
    .catch((e) => log(`erro: ${String(e)}`));
});
document.getElementById("stop")?.addEventListener("click", () => {
  void lab.stop().then(() => log("parado"));
});
setInterval(() => {
  if (!lab.room || !out) return;
  const s = lab.snapshot();
  const first = s.stats.participants[0]?.audio;
  log(
    `${s.state} peers=${s.remoteCount} rtt=${s.stats.self.audio?.rttMs ?? "—"}ms ` +
      `in: jitter=${first?.jitterMs ?? "—"} loss=${first?.lossPct ?? "—"} conceal=${first?.concealedMsPerSec ?? "—"} ` +
      `accel=${first?.acceleratedMsPerSec ?? "—"} | dsp: ${s.dsp?.engine ?? "—"} slow=${s.dsp?.deepFilterSlowRatio ?? "—"} ` +
      `silent=${s.dsp?.silentMsPerSec ?? "—"}`,
  );
}, 2000);
