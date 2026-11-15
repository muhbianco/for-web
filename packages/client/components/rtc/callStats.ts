import {
  type LocalParticipant,
  type RemoteParticipant,
  type RemoteTrack,
  type Room,
  ConnectionQuality,
  RoomEvent,
  Track,
} from "livekit-client";

/**
 * Per-call network telemetry, read straight from the WebRTC stats API.
 *
 * Why this exists: bad network and saturated CPU produce the same complaint
 * ("the voice is chopping / sped up") and the fork had no way to tell them
 * apart. The two counters that settle it live only in the raw RTCStatsReport,
 * not in livekit's typed getReceiverStats():
 *
 *   removedSamplesForAcceleration   NetEQ threw audio away to catch up, which
 *                                   is literally the "sped up voice"
 *   insertedSamplesForDeceleration  NetEQ stretched audio to slow down
 *
 * so every track is read through getRTCStatsReport(); that one report also
 * carries the codec actually negotiated, the ICE candidate pair in use (and
 * whether it is a TURN relay), the transport RTT and the bandwidth estimate.
 *
 * Everything reported here is a rate over the last window, never a lifetime
 * total: a counter that only grows says nothing about how the call is doing
 * right now. The raw counters are kept between windows and diffed.
 */

/** Matches livekit's own monitorFrequency, so we sample in step with it. */
export const CALL_STATS_INTERVAL_MS = 2000;

/**
 * Opus always decodes at 48 kHz here (VoiceProcessor refuses any other rate),
 * so sample counters convert to milliseconds with this constant.
 */
const OPUS_SAMPLE_RATE = 48000;

/** Below this many packets in a window, a loss percentage is just noise. */
const MIN_PACKETS_FOR_LOSS = 20;

/** The codec the browser actually negotiated for a track. */
export interface CodecInfo {
  /** e.g. "audio/opus", "audio/red" */
  mimeType?: string;
  clockRate?: number;
  channels?: number;
  payloadType?: number;
  /** e.g. "minptime=10;useinbandfec=1;usedtx=1" */
  fmtp?: string;
}

export interface InboundAudioStats {
  /** Network jitter as measured by the receiver (ms). */
  jitterMs?: number;
  /** Packet loss over the window (0-100). */
  lossPct?: number;
  /** Audio discarded per second to catch up: the "sped up" voice (ms/s). */
  acceleratedMsPerSec?: number;
  /** Audio stretched per second to slow down (ms/s). */
  deceleratedMsPerSec?: number;
  /**
   * Audio invented per second to cover lost packets (ms/s). Excludes
   * concealment during silence, which DTX makes constant and harmless.
   */
  concealedMsPerSec?: number;
  /** Concealment during silence / DTX (ms/s). Harmless, kept for context. */
  silentConcealedMsPerSec?: number;
  /** How many separate loss events NetEQ had to paper over (per second). */
  concealmentEventsPerSec?: number;
  /** Average jitter buffer delay over the window (ms). */
  jitterBufferMs?: number;
  /** What NetEQ was aiming for over the window (ms). */
  jitterBufferTargetMs?: number;
  /** Lower bound NetEQ imposed on itself over the window (ms). */
  jitterBufferMinimumMs?: number;
  /** Playout delay we asked for on this track, if any (ms). */
  playoutDelayMs?: number;
  /**
   * Packets that arrived during the window. Without this, a window where the
   * person simply was not talking (DTX sends a couple of comfort-noise packets
   * a second) is indistinguishable from a healthy one: every rate is zero
   * either way. Anything reading these stats has to check this first.
   */
  packetsInWindow?: number;
  packetsPerSec?: number;
  bitrateKbps?: number;
  /** Opus in-band FEC packets that were used / thrown away (per second). */
  fecPacketsReceivedPerSec?: number;
  fecPacketsDiscardedPerSec?: number;
  /** Packets the jitter buffer dropped as too late (per second). */
  packetsDiscardedPerSec?: number;
  nackPerSec?: number;
  /** Decoded audio level 0-1 (what the listener's decoder is putting out). */
  audioLevel?: number;
  codec?: CodecInfo;
}

export interface InboundVideoStats {
  fps?: number;
  width?: number;
  height?: number;
  lossPct?: number;
  framesDroppedPerSec?: number;
  /** Time the picture was frozen per second of call (ms/s). */
  freezeMsPerSec?: number;
  /** e.g. "libvpx" (software) vs an external/hardware decoder. */
  decoder?: string;
  powerEfficientDecoder?: boolean;
}

export interface OutboundAudioStats {
  /** Round trip time reported by the remote (ms). */
  rttMs?: number;
  /** Loss the remote reported on our audio (0-100). */
  lossPct?: number;
  /** Loss fraction the remote reported in its last RTCP RR (0-100). */
  fractionLostPct?: number;
  jitterMs?: number;
  bitrateKbps?: number;
  /** What the encoder was told to aim for (kbps). */
  targetBitrateKbps?: number;
  packetsPerSec?: number;
  nackPerSec?: number;
  retransmittedPerSec?: number;
  /** Level of the processed microphone signal handed to the encoder (0-1). */
  audioLevel?: number;
  codec?: CodecInfo;
}

export interface OutboundVideoStats {
  source: "camera" | "screenshare";
  fps?: number;
  width?: number;
  height?: number;
  bitrateKbps?: number;
  /**
   * Why the encoder is holding back: "cpu" means this machine cannot keep up,
   * "bandwidth" means the uplink cannot. This one field is the difference
   * between "your connection is bad" and "your computer is busy".
   */
  limitedBy?: string;
}

/**
 * The transport under one peer connection. LiveKit uses two: PUBLISHER (our
 * media up to the SFU) and SUBSCRIBER (everyone else's media down to us).
 */
export interface TransportStats {
  role: "publisher" | "subscriber";
  iceState?: string;
  dtlsState?: string;
  /** host / srflx / prflx / relay */
  localCandidateType?: string;
  remoteCandidateType?: string;
  /** udp / tcp */
  protocol?: string;
  /** Set when our local candidate is a TURN relay: udp / tcp / tls. */
  relayProtocol?: string;
  /** True when media goes through TURN on either side. */
  usesRelay: boolean;
  /** Port on the SFU side: 7882 = UDP mux, 7881 = ICE/TCP, 3478 = TURN. */
  remotePort?: number;
  /** STUN round trip on the selected pair (ms). */
  currentRttMs?: number;
  /** Sender-side bandwidth estimate (kbps), publisher only. */
  availableOutgoingKbps?: number;
  availableIncomingKbps?: number;
  sendKbps?: number;
  recvKbps?: number;
}

export interface ParticipantCallStats {
  identity: string;
  name: string;
  quality: ConnectionQuality;
  audio?: InboundAudioStats;
  video?: InboundVideoStats;
}

export interface SelfCallStats {
  quality: ConnectionQuality;
  audio?: OutboundAudioStats;
  video: OutboundVideoStats[];
}

export interface CallStatsSnapshot {
  inCall: boolean;
  /** Date.now() of the last completed sample. */
  updatedAt?: number;
  self: SelfCallStats;
  participants: ParticipantCallStats[];
  transport?: {
    publisher?: TransportStats;
    subscriber?: TransportStats;
  };
  /** livekit Room.state at sample time. */
  connectionState?: string;
  /** Full reconnects (ICE restart / new session) since the call started. */
  reconnects?: number;
  /** Signal-only reconnects (WebSocket dropped, media kept) since start. */
  signalReconnects?: number;
}

export const IDLE_CALL_STATS: CallStatsSnapshot = {
  inCall: false,
  self: { quality: ConnectionQuality.Unknown, video: [] },
  participants: [],
};

type Stat = Record<string, unknown>;

/** Raw counters kept between windows so we can diff them. */
interface Counters {
  timestamp: number;
  values: Record<string, number>;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Inbound loss: packetsReceived excludes the lost ones, so the denominator is
 * what the sender must have emitted. Undefined when the sample is too small
 * to mean anything.
 */
function lossPercent(
  lostDelta: number,
  receivedDelta: number,
): number | undefined {
  const total = lostDelta + receivedDelta;
  if (total < MIN_PACKETS_FOR_LOSS) return undefined;
  return Math.round((Math.max(0, lostDelta) / total) * 1000) / 10;
}

/**
 * Outbound loss: packetsSent already counts everything we put on the wire and
 * the remote reports how many of those it never got, so the denominator is
 * packetsSent alone.
 */
function sentLossPercent(
  lostDelta: number,
  sentDelta: number,
): number | undefined {
  if (sentDelta < MIN_PACKETS_FOR_LOSS) return undefined;
  return Math.round((Math.max(0, lostDelta) / sentDelta) * 1000) / 10;
}

function samplesToMsPerSec(
  sampleDelta: number,
  elapsedSec: number,
): number | undefined {
  if (elapsedSec <= 0) return undefined;
  return Math.round(((sampleDelta / OPUS_SAMPLE_RATE) * 1000) / elapsedSec);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function findAll(report: RTCStatsReport, type: string): Stat[] {
  const found: Stat[] = [];
  report.forEach((entry) => {
    const stat = entry as Stat;
    if (stat.type === type) found.push(stat);
  });
  return found;
}

/** Finds the inbound-rtp entry of the given kind in a raw stats report. */
function findInbound(
  report: RTCStatsReport,
  kind: "audio" | "video",
): Stat | undefined {
  return findAll(report, "inbound-rtp").find((s) => s.kind === kind);
}

function findById(report: RTCStatsReport, id: unknown): Stat | undefined {
  if (typeof id !== "string") return undefined;
  const entry = report.get(id) as Stat | undefined;
  return entry;
}

function readCodec(report: RTCStatsReport, codecId: unknown): CodecInfo | undefined {
  const codec = findById(report, codecId);
  if (!codec) return undefined;
  return {
    mimeType: str(codec.mimeType),
    clockRate: optional(codec.clockRate),
    channels: optional(codec.channels),
    payloadType: optional(codec.payloadType),
    fmtp: str(codec.sdpFmtpLine),
  };
}

/** With simulcast there is one entry per layer; the widest is what peers see. */
function pickTopLayer(layers: Stat[]): Stat | undefined {
  if (!layers.length) return undefined;
  return layers.reduce((best, layer) =>
    num(layer.frameWidth) > num(best.frameWidth) ? layer : best,
  );
}

/**
 * Diffs raw counters between two samples of the same object. `rate(key)`
 * gives per-second, `delta(key)` the raw difference; both undefined on the
 * first sample.
 */
class Window {
  readonly elapsedSec: number;
  constructor(
    private readonly previous: Counters | undefined,
    private readonly now: Counters,
  ) {
    this.elapsedSec = previous
      ? (now.timestamp - previous.timestamp) / 1000
      : 0;
  }
  get valid(): boolean {
    return !!this.previous && this.elapsedSec > 0;
  }
  delta(key: string): number {
    if (!this.previous) return 0;
    return num(this.now.values[key]) - num(this.previous.values[key]);
  }
  rate(key: string): number | undefined {
    if (!this.valid) return undefined;
    return round1(this.delta(key) / this.elapsedSec);
  }
  kbps(key: string): number | undefined {
    if (!this.valid) return undefined;
    return Math.round((this.delta(key) * 8) / this.elapsedSec / 1000);
  }
}

function counters(stat: Stat, keys: string[]): Counters {
  const values: Record<string, number> = {};
  for (const key of keys) values[key] = num(stat[key]);
  return { timestamp: num(stat.timestamp), values };
}

const INBOUND_AUDIO_KEYS = [
  "packetsReceived",
  "packetsLost",
  "packetsDiscarded",
  "bytesReceived",
  "concealedSamples",
  "silentConcealedSamples",
  "concealmentEvents",
  "removedSamplesForAcceleration",
  "insertedSamplesForDeceleration",
  "jitterBufferDelay",
  "jitterBufferTargetDelay",
  "jitterBufferMinimumDelay",
  "jitterBufferEmittedCount",
  "fecPacketsReceived",
  "fecPacketsDiscarded",
  "nackCount",
];

const INBOUND_VIDEO_KEYS = [
  "packetsReceived",
  "packetsLost",
  "framesDropped",
  "totalFreezesDuration",
];

const OUTBOUND_KEYS = [
  "bytesSent",
  "packetsSent",
  "nackCount",
  "retransmittedPacketsSent",
];

const REMOTE_INBOUND_KEYS = ["packetsLost"];

const PAIR_KEYS = ["bytesSent", "bytesReceived"];

export class CallStatsCollector {
  #timer?: ReturnType<typeof setInterval>;
  #room?: Room;
  #onSnapshot: (snapshot: CallStatsSnapshot) => void;
  /** Previous window, keyed by stats object id (track sid / pair id). */
  #previous = new Map<string, Counters>();
  #sampling = false;
  #reconnects = 0;
  #signalReconnects = 0;
  #detachRoom?: () => void;

  constructor(onSnapshot: (snapshot: CallStatsSnapshot) => void) {
    this.#onSnapshot = onSnapshot;
  }

  /**
   * `manual`: no timer; the owner calls sampleNow() itself (the voice lab does,
   * so its 2 s windows are not split by a second clock).
   */
  start(room: Room, opts: { manual?: boolean } = {}) {
    this.stop();
    this.#room = room;
    this.#reconnects = 0;
    this.#signalReconnects = 0;
    const onReconnecting = () => {
      this.#reconnects += 1;
    };
    const onSignalReconnecting = () => {
      this.#signalReconnects += 1;
    };
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.SignalReconnecting, onSignalReconnecting);
    this.#detachRoom = () => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.SignalReconnecting, onSignalReconnecting);
    };
    if (!opts.manual) {
      this.#timer = setInterval(() => {
        void this.sample();
      }, CALL_STATS_INTERVAL_MS);
    }
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#detachRoom?.();
    this.#detachRoom = undefined;
    this.#room = undefined;
    this.#previous.clear();
    this.#onSnapshot(IDLE_CALL_STATS);
  }

  /** Take one sample now (the lab calls this instead of waiting for the timer). */
  async sampleNow(): Promise<void> {
    await this.sample();
  }

  /**
   * One sample across every track. Overlapping samples are skipped rather than
   * queued: getStats on a busy machine can take longer than the interval, and
   * piling calls up is exactly the CPU pressure we are trying to measure.
   */
  private async sample() {
    const room = this.#room;
    if (!room || this.#sampling) return;
    this.#sampling = true;

    try {
      const [remote, local] = await Promise.all([
        this.sampleRemote([...room.remoteParticipants.values()]),
        this.sampleLocal(room.localParticipant),
      ]);
      this.prune(room);
      this.#onSnapshot({
        inCall: true,
        updatedAt: Date.now(),
        self: local.self,
        participants: remote.participants,
        transport: {
          publisher: local.transport,
          subscriber: remote.transport,
        },
        connectionState: room.state,
        reconnects: this.#reconnects,
        signalReconnects: this.#signalReconnects,
      });
    } catch (error) {
      // A call can end mid-sample; losing one window is not worth an error toast.
      console.warn("[voice] call stats sample", error);
    } finally {
      this.#sampling = false;
    }
  }

  private async sampleRemote(participants: RemoteParticipant[]): Promise<{
    participants: ParticipantCallStats[];
    transport?: TransportStats;
  }> {
    let transport: TransportStats | undefined;
    const result = await Promise.all(
      participants.map(async (participant) => {
        const stats: ParticipantCallStats = {
          identity: participant.identity,
          name: participant.name || participant.identity,
          quality: participant.connectionQuality,
        };

        for (const publication of participant.trackPublications.values()) {
          const track = publication.track as RemoteTrack | undefined;
          if (!track || typeof track.getRTCStatsReport !== "function") continue;

          let report: RTCStatsReport | undefined;
          try {
            report = await track.getRTCStatsReport();
          } catch {
            // Track torn down between the listing and the read.
            continue;
          }
          if (!report) continue;

          // Every subscribed track shares the SUBSCRIBER peer connection, so
          // one report is enough for the transport.
          if (!transport) {
            transport = this.readTransport(report, "subscriber");
          }

          const sid = publication.trackSid;
          if (publication.kind === Track.Kind.Audio) {
            stats.audio = this.readInboundAudio(sid, report, track);
          } else if (publication.kind === Track.Kind.Video) {
            stats.video = this.readInboundVideo(sid, report);
          }
        }

        return stats;
      }),
    );
    return { participants: result, transport };
  }

  private readInboundAudio(
    sid: string,
    report: RTCStatsReport,
    track: RemoteTrack,
  ): InboundAudioStats | undefined {
    const stat = findInbound(report, "audio");
    if (!stat) return undefined;

    const now = counters(stat, INBOUND_AUDIO_KEYS);
    const window = new Window(this.#previous.get(sid), now);
    this.#previous.set(sid, now);

    const jitter = optional(stat.jitter);
    const playoutDelay = track.getPlayoutDelay();
    const result: InboundAudioStats = {
      jitterMs: jitter === undefined ? undefined : Math.round(jitter * 1000),
      playoutDelayMs: playoutDelay
        ? Math.round(playoutDelay * 1000)
        : undefined,
      audioLevel: optional(stat.audioLevel),
      codec: readCodec(report, stat.codecId),
    };
    if (!window.valid) return result;

    const elapsedSec = window.elapsedSec;
    result.packetsInWindow = Math.max(0, window.delta("packetsReceived"));
    result.packetsPerSec = window.rate("packetsReceived");
    result.bitrateKbps = window.kbps("bytesReceived");
    result.lossPct = lossPercent(
      window.delta("packetsLost"),
      window.delta("packetsReceived"),
    );
    result.acceleratedMsPerSec = samplesToMsPerSec(
      window.delta("removedSamplesForAcceleration"),
      elapsedSec,
    );
    result.deceleratedMsPerSec = samplesToMsPerSec(
      window.delta("insertedSamplesForDeceleration"),
      elapsedSec,
    );
    // Silent concealment is DTX doing its job, not a problem worth showing.
    const silent = window.delta("silentConcealedSamples");
    const concealed = window.delta("concealedSamples") - silent;
    result.concealedMsPerSec = samplesToMsPerSec(
      Math.max(0, concealed),
      elapsedSec,
    );
    result.silentConcealedMsPerSec = samplesToMsPerSec(
      Math.max(0, silent),
      elapsedSec,
    );
    result.concealmentEventsPerSec = window.rate("concealmentEvents");
    result.fecPacketsReceivedPerSec = window.rate("fecPacketsReceived");
    result.fecPacketsDiscardedPerSec = window.rate("fecPacketsDiscarded");
    result.packetsDiscardedPerSec = window.rate("packetsDiscarded");
    result.nackPerSec = window.rate("nackCount");

    const emitted = window.delta("jitterBufferEmittedCount");
    if (emitted > 0) {
      result.jitterBufferMs = Math.round(
        (window.delta("jitterBufferDelay") / emitted) * 1000,
      );
      result.jitterBufferTargetMs = Math.round(
        (window.delta("jitterBufferTargetDelay") / emitted) * 1000,
      );
      result.jitterBufferMinimumMs = Math.round(
        (window.delta("jitterBufferMinimumDelay") / emitted) * 1000,
      );
    }
    return result;
  }

  private readInboundVideo(
    sid: string,
    report: RTCStatsReport,
  ): InboundVideoStats | undefined {
    const stat = findInbound(report, "video");
    if (!stat) return undefined;

    const now = counters(stat, INBOUND_VIDEO_KEYS);
    const window = new Window(this.#previous.get(sid), now);
    this.#previous.set(sid, now);

    const result: InboundVideoStats = {
      fps: optional(stat.framesPerSecond),
      width: optional(stat.frameWidth),
      height: optional(stat.frameHeight),
      decoder: str(stat.decoderImplementation),
      powerEfficientDecoder:
        typeof stat.powerEfficientDecoder === "boolean"
          ? stat.powerEfficientDecoder
          : undefined,
    };
    if (!window.valid) return result;

    result.lossPct = lossPercent(
      window.delta("packetsLost"),
      window.delta("packetsReceived"),
    );
    result.framesDroppedPerSec = Math.round(
      window.delta("framesDropped") / window.elapsedSec,
    );
    result.freezeMsPerSec = Math.round(
      (window.delta("totalFreezesDuration") * 1000) / window.elapsedSec,
    );
    return result;
  }

  private async sampleLocal(
    participant: LocalParticipant,
  ): Promise<{ self: SelfCallStats; transport?: TransportStats }> {
    const self: SelfCallStats = {
      quality: participant.connectionQuality,
      video: [],
    };
    let transport: TransportStats | undefined;

    for (const publication of participant.trackPublications.values()) {
      const track = publication.track;
      if (!track || typeof track.getRTCStatsReport !== "function") continue;

      let report: RTCStatsReport | undefined;
      try {
        report = await track.getRTCStatsReport();
      } catch {
        // Same as remote: a track can vanish mid-sample.
        continue;
      }
      if (!report) continue;

      if (!transport) transport = this.readTransport(report, "publisher");

      if (publication.source === Track.Source.Microphone) {
        self.audio = this.readOutboundAudio(publication.trackSid, report);
      } else if (
        publication.source === Track.Source.Camera ||
        publication.source === Track.Source.ScreenShare
      ) {
        const layers = findAll(report, "outbound-rtp").filter(
          (s) => s.kind === "video",
        );
        const top = pickTopLayer(layers);
        if (top) {
          self.video.push(
            this.readOutboundVideo(
              publication.trackSid,
              top,
              publication.source === Track.Source.Camera
                ? "camera"
                : "screenshare",
            ),
          );
        }
      }
    }

    return { self, transport };
  }

  private readOutboundAudio(
    sid: string,
    report: RTCStatsReport,
  ): OutboundAudioStats | undefined {
    const out = findAll(report, "outbound-rtp").find((s) => s.kind === "audio");
    if (!out) return undefined;
    const remote = findAll(report, "remote-inbound-rtp").find(
      (s) => s.kind === "audio",
    );
    const source = findAll(report, "media-source").find(
      (s) => s.kind === "audio",
    );

    const now = counters(out, OUTBOUND_KEYS);
    if (remote) {
      now.values.remotePacketsLost = num(remote.packetsLost);
    }
    const window = new Window(this.#previous.get(sid), now);
    this.#previous.set(sid, now);

    const rtt = remote ? optional(remote.roundTripTime) : undefined;
    const jitter = remote ? optional(remote.jitter) : undefined;
    const fractionLost = remote ? optional(remote.fractionLost) : undefined;
    const result: OutboundAudioStats = {
      rttMs: rtt === undefined ? undefined : Math.round(rtt * 1000),
      jitterMs: jitter === undefined ? undefined : Math.round(jitter * 1000),
      fractionLostPct:
        fractionLost === undefined ? undefined : round1(fractionLost * 100),
      targetBitrateKbps:
        optional(out.targetBitrate) === undefined
          ? undefined
          : Math.round(num(out.targetBitrate) / 1000),
      audioLevel: source ? optional(source.audioLevel) : undefined,
      codec: readCodec(report, out.codecId),
    };
    if (!window.valid) return result;

    result.bitrateKbps = window.kbps("bytesSent");
    result.packetsPerSec = window.rate("packetsSent");
    result.nackPerSec = window.rate("nackCount");
    result.retransmittedPerSec = window.rate("retransmittedPacketsSent");
    if (remote) {
      result.lossPct = sentLossPercent(
        window.delta("remotePacketsLost"),
        window.delta("packetsSent"),
      );
    }
    return result;
  }

  private readOutboundVideo(
    sid: string,
    layer: Stat,
    source: "camera" | "screenshare",
  ): OutboundVideoStats {
    const now = counters(layer, OUTBOUND_KEYS);
    const window = new Window(this.#previous.get(sid), now);
    this.#previous.set(sid, now);
    const reason = str(layer.qualityLimitationReason);
    return {
      source,
      fps: optional(layer.framesPerSecond),
      width: optional(layer.frameWidth),
      height: optional(layer.frameHeight),
      bitrateKbps: window.kbps("bytesSent"),
      limitedBy: reason && reason !== "none" ? reason : undefined,
    };
  }

  /**
   * The selected ICE candidate pair and the DTLS/ICE state of the peer
   * connection this report came from. Addresses are deliberately left out;
   * candidate types, protocol and the SFU port say everything the diagnosis
   * needs (7882 UDP mux, 7881 ICE/TCP, 3478 TURN).
   */
  private readTransport(
    report: RTCStatsReport,
    role: "publisher" | "subscriber",
  ): TransportStats | undefined {
    const transports = findAll(report, "transport");
    const transport =
      transports.find((t) => t.dtlsState === "connected") ?? transports[0];
    let pair = transport
      ? findById(report, transport.selectedCandidatePairId)
      : undefined;
    if (!pair) {
      pair = findAll(report, "candidate-pair").find(
        (p) => p.nominated === true || p.state === "succeeded",
      );
    }
    if (!transport && !pair) return undefined;

    const local = pair ? findById(report, pair.localCandidateId) : undefined;
    const remote = pair ? findById(report, pair.remoteCandidateId) : undefined;
    const result: TransportStats = {
      role,
      iceState: transport ? str(transport.iceState) : undefined,
      dtlsState: transport ? str(transport.dtlsState) : undefined,
      localCandidateType: local ? str(local.candidateType) : undefined,
      remoteCandidateType: remote ? str(remote.candidateType) : undefined,
      protocol: local ? str(local.protocol) : undefined,
      relayProtocol: local ? str(local.relayProtocol) : undefined,
      usesRelay:
        (local ? str(local.candidateType) : undefined) === "relay" ||
        (remote ? str(remote.candidateType) : undefined) === "relay",
      remotePort: remote ? optional(remote.port) : undefined,
    };
    if (pair) {
      const rtt = optional(pair.currentRoundTripTime);
      result.currentRttMs = rtt === undefined ? undefined : Math.round(rtt * 1000);
      const out = optional(pair.availableOutgoingBitrate);
      result.availableOutgoingKbps =
        out === undefined ? undefined : Math.round(out / 1000);
      const inc = optional(pair.availableIncomingBitrate);
      result.availableIncomingKbps =
        inc === undefined ? undefined : Math.round(inc / 1000);
      const id = `pair:${role}:${str(pair.id) ?? ""}`;
      const now = counters(pair, PAIR_KEYS);
      const window = new Window(this.#previous.get(id), now);
      this.#previous.set(id, now);
      if (window.valid) {
        result.sendKbps = window.kbps("bytesSent");
        result.recvKbps = window.kbps("bytesReceived");
      }
    }
    return result;
  }

  /** Drop counters for tracks that are gone, so the maps stay call-sized. */
  private prune(room: Room) {
    const live = new Set<string>();
    for (const participant of room.remoteParticipants.values()) {
      for (const sid of participant.trackPublications.keys()) live.add(sid);
    }
    for (const sid of room.localParticipant.trackPublications.keys()) {
      live.add(sid);
    }
    for (const key of [...this.#previous.keys()]) {
      if (key.startsWith("pair:")) continue;
      if (!live.has(key)) this.#previous.delete(key);
    }
  }
}
