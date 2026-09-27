import {
  type LocalParticipant,
  type RemoteParticipant,
  type RemoteTrack,
  type Room,
  ConnectionQuality,
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
 * so remote tracks are read through RemoteTrack.getRTCStatsReport() while the
 * local side uses livekit's typed sender stats.
 *
 * Everything reported here is a rate over the last window, never a lifetime
 * total: a counter that only grows says nothing about how the call is doing
 * right now.
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
  /** Average jitter buffer delay over the window (ms). */
  jitterBufferMs?: number;
  /** Playout delay we asked for on this track, if any (ms). */
  playoutDelayMs?: number;
  /**
   * Packets that arrived during the window. Without this, a window where the
   * person simply was not talking (DTX sends a couple of comfort-noise packets
   * a second) is indistinguishable from a healthy one: every rate is zero
   * either way. Anything reading these stats has to check this first.
   */
  packetsInWindow?: number;
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
  jitterMs?: number;
  bitrateKbps?: number;
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
}

export const IDLE_CALL_STATS: CallStatsSnapshot = {
  inCall: false,
  self: { quality: ConnectionQuality.Unknown, video: [] },
  participants: [],
};

/** Raw counters kept between windows so we can diff them. */
interface AudioCounters {
  timestamp: number;
  packetsReceived: number;
  packetsLost: number;
  concealedSamples: number;
  silentConcealedSamples: number;
  removedSamplesForAcceleration: number;
  insertedSamplesForDeceleration: number;
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
}

interface VideoCounters {
  timestamp: number;
  packetsReceived: number;
  packetsLost: number;
  framesDropped: number;
  totalFreezesDuration: number;
}

interface SentCounters {
  timestamp: number;
  bytesSent: number;
  packetsSent: number;
  packetsLost: number;
}

interface SentAudioSample {
  roundTripTime?: number;
  packetsLost?: number;
  packetsSent?: number;
  jitter?: number;
  bytesSent?: number;
  timestamp: number;
}

interface SentVideoSample {
  rid?: string;
  framesPerSecond?: number;
  frameWidth?: number;
  frameHeight?: number;
  bytesSent?: number;
  packetsSent?: number;
  packetsLost?: number;
  timestamp: number;
  qualityLimitationReason?: string;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
  return Math.round((lostDelta / total) * 1000) / 10;
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
  return Math.round((lostDelta / sentDelta) * 1000) / 10;
}

function samplesToMsPerSec(
  sampleDelta: number,
  elapsedSec: number,
): number | undefined {
  if (elapsedSec <= 0) return undefined;
  return Math.round(((sampleDelta / OPUS_SAMPLE_RATE) * 1000) / elapsedSec);
}

/** Finds the inbound-rtp entry of the given kind in a raw stats report. */
function findInbound(
  report: RTCStatsReport,
  kind: "audio" | "video",
): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined;
  report.forEach((entry) => {
    const stat = entry as Record<string, unknown>;
    if (stat.type === "inbound-rtp" && stat.kind === kind) {
      found = stat;
    }
  });
  return found;
}

/** With simulcast there is one entry per layer; the widest is what peers see. */
function pickTopLayer<T extends { frameWidth?: number }>(
  layers: T[],
): T | undefined {
  if (!layers.length) return undefined;
  return layers.reduce((best, layer) =>
    (layer.frameWidth ?? 0) > (best.frameWidth ?? 0) ? layer : best,
  );
}

function hasSenderStats<T>(
  track: unknown,
): track is { getSenderStats(): Promise<T> } {
  return (
    typeof track === "object" &&
    track !== null &&
    typeof (track as { getSenderStats?: unknown }).getSenderStats === "function"
  );
}

export class CallStatsCollector {
  #timer?: ReturnType<typeof setInterval>;
  #room?: Room;
  #onSnapshot: (snapshot: CallStatsSnapshot) => void;
  /** Previous window, keyed by track sid. Pruned on every sample. */
  #audioIn = new Map<string, AudioCounters>();
  #videoIn = new Map<string, VideoCounters>();
  #sentOut = new Map<string, SentCounters>();
  #sampling = false;

  constructor(onSnapshot: (snapshot: CallStatsSnapshot) => void) {
    this.#onSnapshot = onSnapshot;
  }

  start(room: Room) {
    this.stop();
    this.#room = room;
    this.#timer = setInterval(() => {
      void this.sample();
    }, CALL_STATS_INTERVAL_MS);
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#room = undefined;
    this.#audioIn.clear();
    this.#videoIn.clear();
    this.#sentOut.clear();
    this.#onSnapshot(IDLE_CALL_STATS);
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
      const [participants, self] = await Promise.all([
        this.sampleRemote([...room.remoteParticipants.values()]),
        this.sampleLocal(room.localParticipant),
      ]);
      this.prune(room);
      this.#onSnapshot({
        inCall: true,
        updatedAt: Date.now(),
        self,
        participants,
      });
    } catch (error) {
      // A call can end mid-sample; losing one window is not worth an error toast.
      console.warn("[voice] call stats sample", error);
    } finally {
      this.#sampling = false;
    }
  }

  private async sampleRemote(
    participants: RemoteParticipant[],
  ): Promise<ParticipantCallStats[]> {
    return Promise.all(
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
  }

  private readInboundAudio(
    sid: string,
    report: RTCStatsReport,
    track: RemoteTrack,
  ): InboundAudioStats | undefined {
    const stat = findInbound(report, "audio");
    if (!stat) return undefined;

    const now: AudioCounters = {
      timestamp: num(stat.timestamp),
      packetsReceived: num(stat.packetsReceived),
      packetsLost: num(stat.packetsLost),
      concealedSamples: num(stat.concealedSamples),
      silentConcealedSamples: num(stat.silentConcealedSamples),
      removedSamplesForAcceleration: num(stat.removedSamplesForAcceleration),
      insertedSamplesForDeceleration: num(stat.insertedSamplesForDeceleration),
      jitterBufferDelay: num(stat.jitterBufferDelay),
      jitterBufferEmittedCount: num(stat.jitterBufferEmittedCount),
    };
    const previous = this.#audioIn.get(sid);
    this.#audioIn.set(sid, now);

    const jitter = optional(stat.jitter);
    const playoutDelay = track.getPlayoutDelay();
    const result: InboundAudioStats = {
      jitterMs: jitter === undefined ? undefined : Math.round(jitter * 1000),
      playoutDelayMs: playoutDelay
        ? Math.round(playoutDelay * 1000)
        : undefined,
    };
    if (!previous) return result;

    const elapsedSec = (now.timestamp - previous.timestamp) / 1000;
    if (elapsedSec <= 0) return result;

    result.packetsInWindow = Math.max(
      0,
      now.packetsReceived - previous.packetsReceived,
    );
    result.lossPct = lossPercent(
      now.packetsLost - previous.packetsLost,
      now.packetsReceived - previous.packetsReceived,
    );
    result.acceleratedMsPerSec = samplesToMsPerSec(
      now.removedSamplesForAcceleration -
        previous.removedSamplesForAcceleration,
      elapsedSec,
    );
    result.deceleratedMsPerSec = samplesToMsPerSec(
      now.insertedSamplesForDeceleration -
        previous.insertedSamplesForDeceleration,
      elapsedSec,
    );
    // Silent concealment is DTX doing its job, not a problem worth showing.
    const concealed =
      now.concealedSamples -
      previous.concealedSamples -
      (now.silentConcealedSamples - previous.silentConcealedSamples);
    result.concealedMsPerSec = samplesToMsPerSec(
      Math.max(0, concealed),
      elapsedSec,
    );

    const emitted =
      now.jitterBufferEmittedCount - previous.jitterBufferEmittedCount;
    if (emitted > 0) {
      const delay = now.jitterBufferDelay - previous.jitterBufferDelay;
      result.jitterBufferMs = Math.round((delay / emitted) * 1000);
    }
    return result;
  }

  private readInboundVideo(
    sid: string,
    report: RTCStatsReport,
  ): InboundVideoStats | undefined {
    const stat = findInbound(report, "video");
    if (!stat) return undefined;

    const now: VideoCounters = {
      timestamp: num(stat.timestamp),
      packetsReceived: num(stat.packetsReceived),
      packetsLost: num(stat.packetsLost),
      framesDropped: num(stat.framesDropped),
      totalFreezesDuration: num(stat.totalFreezesDuration),
    };
    const previous = this.#videoIn.get(sid);
    this.#videoIn.set(sid, now);

    const result: InboundVideoStats = {
      fps: optional(stat.framesPerSecond),
      width: optional(stat.frameWidth),
      height: optional(stat.frameHeight),
      decoder:
        typeof stat.decoderImplementation === "string"
          ? stat.decoderImplementation
          : undefined,
      powerEfficientDecoder:
        typeof stat.powerEfficientDecoder === "boolean"
          ? stat.powerEfficientDecoder
          : undefined,
    };
    if (!previous) return result;

    const elapsedSec = (now.timestamp - previous.timestamp) / 1000;
    if (elapsedSec <= 0) return result;

    result.lossPct = lossPercent(
      now.packetsLost - previous.packetsLost,
      now.packetsReceived - previous.packetsReceived,
    );
    result.framesDroppedPerSec = Math.round(
      (now.framesDropped - previous.framesDropped) / elapsedSec,
    );
    result.freezeMsPerSec = Math.round(
      ((now.totalFreezesDuration - previous.totalFreezesDuration) * 1000) /
        elapsedSec,
    );
    return result;
  }

  private async sampleLocal(
    participant: LocalParticipant,
  ): Promise<SelfCallStats> {
    const self: SelfCallStats = {
      quality: participant.connectionQuality,
      video: [],
    };

    for (const publication of participant.trackPublications.values()) {
      const track = publication.track;
      if (!track) continue;

      try {
        if (publication.source === Track.Source.Microphone) {
          if (!hasSenderStats<SentAudioSample | undefined>(track)) continue;
          const sent = await track.getSenderStats();
          if (sent) {
            self.audio = this.readOutboundAudio(publication.trackSid, sent);
          }
        } else if (
          publication.source === Track.Source.Camera ||
          publication.source === Track.Source.ScreenShare
        ) {
          if (!hasSenderStats<SentVideoSample[]>(track)) continue;
          const top = pickTopLayer(await track.getSenderStats());
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
      } catch {
        // Same as remote: a track can vanish mid-sample.
        continue;
      }
    }

    return self;
  }

  private readOutboundAudio(
    sid: string,
    sent: SentAudioSample,
  ): OutboundAudioStats {
    const window = this.outboundWindow(sid, sent);
    return {
      rttMs: sent.roundTripTime
        ? Math.round(sent.roundTripTime * 1000)
        : undefined,
      jitterMs: sent.jitter ? Math.round(sent.jitter * 1000) : undefined,
      lossPct: window.lossPct,
      bitrateKbps: window.bitrateKbps,
    };
  }

  private readOutboundVideo(
    sid: string,
    layer: SentVideoSample,
    source: "camera" | "screenshare",
  ): OutboundVideoStats {
    return {
      source,
      fps: optional(layer.framesPerSecond),
      width: optional(layer.frameWidth),
      height: optional(layer.frameHeight),
      bitrateKbps: this.outboundWindow(sid, layer).bitrateKbps,
      limitedBy:
        layer.qualityLimitationReason &&
        layer.qualityLimitationReason !== "none"
          ? layer.qualityLimitationReason
          : undefined,
    };
  }

  /** Bitrate and loss over the last window for one published track. */
  private outboundWindow(
    sid: string,
    sample: {
      timestamp: number;
      bytesSent?: number;
      packetsSent?: number;
      packetsLost?: number;
    },
  ): { bitrateKbps?: number; lossPct?: number } {
    const now: SentCounters = {
      timestamp: num(sample.timestamp),
      bytesSent: num(sample.bytesSent),
      packetsSent: num(sample.packetsSent),
      packetsLost: num(sample.packetsLost),
    };
    const previous = this.#sentOut.get(sid);
    this.#sentOut.set(sid, now);
    if (!previous) return {};

    const elapsedSec = (now.timestamp - previous.timestamp) / 1000;
    if (elapsedSec <= 0) return {};

    return {
      bitrateKbps: Math.round(
        ((now.bytesSent - previous.bytesSent) * 8) / elapsedSec / 1000,
      ),
      lossPct: sentLossPercent(
        now.packetsLost - previous.packetsLost,
        now.packetsSent - previous.packetsSent,
      ),
    };
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
    for (const map of [this.#audioIn, this.#videoIn, this.#sentOut]) {
      for (const sid of [...map.keys()]) {
        if (!live.has(sid)) map.delete(sid);
      }
    }
  }
}
