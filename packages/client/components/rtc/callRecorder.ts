import type {
  CallVerdict,
  CallVerdictKind,
  DspHealth,
} from "./callDiagnosis";
import type {
  CallStatsSnapshot,
  InboundAudioStats,
  OutboundAudioStats,
  TransportStats,
} from "./callStats";
import type { VoiceEngineStatus } from "./voiceEngineStatus";

/**
 * Per-call diagnostic report.
 *
 * The live panel answers "how is the call right now". This answers "what
 * happened during that call", after it ended, with numbers instead of
 * impressions: the timeline of every 2 s window, percentiles per metric and
 * per participant, the transport path (UDP mux / ICE-TCP / TURN relay), how
 * the verdict moved over time, and what the local DSP chain was doing.
 *
 * Nothing in here is audio. Identities are LiveKit identities (user ids), the
 * same the server already logs. The last full report is kept in localStorage
 * so it can be exported after the call; older calls keep only their summary.
 */

export const CALL_REPORT_VERSION = 1;
/** 2 s windows: 1800 = one hour of call in the timeline. */
export const MAX_TIMELINE = 1800;
export const LAST_REPORT_KEY = "muchat:voice:lastCallReport";
export const REPORT_SUMMARIES_KEY = "muchat:voice:callReportSummaries";
export const MAX_SUMMARIES = 10;

/** The DSP side, as sampled next to every stats window. */
export interface DspSample {
  engine?: string;
  deepFilterSlowRatio?: number;
  deepFilterMaxFrameMs?: number;
  deepFilterOverloaded?: boolean;
  deepFilterAttenDb?: number;
  noiseFloorDb?: number;
  silentMsPerSec?: number;
  longestSilentRunMs?: number;
  outputPeak?: number;
  gateOpen?: boolean;
  speechProb?: number;
  vadEngine?: string;
  agcGainDb?: number;
  inputSampleRate?: number;
  sampleRate?: number;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
  noiseSuppression?: boolean;
}

export function dspSampleFrom(status: VoiceEngineStatus): DspSample {
  return {
    engine: status.engine,
    deepFilterSlowRatio: status.deepFilterSlowRatio,
    deepFilterMaxFrameMs: status.deepFilterMaxFrameMs,
    deepFilterOverloaded: status.deepFilterOverloaded,
    deepFilterAttenDb: status.deepFilterAttenDb,
    noiseFloorDb: status.noiseFloorDb,
    silentMsPerSec: status.silentMsPerSec,
    longestSilentRunMs: status.longestSilentRunMs,
    outputPeak: status.outputPeak,
    gateOpen: status.gateOpen,
    speechProb: status.speechProb,
    vadEngine: status.vadEngine,
    agcGainDb: status.agcGainDb,
    inputSampleRate: status.inputSampleRate,
    sampleRate: status.sampleRate,
    echoCancellation: status.echoCancellation,
    autoGainControl: status.autoGainControl,
    noiseSuppression: status.noiseSuppression,
  };
}

export interface TimelineEntry {
  /** ms since call start */
  t: number;
  stats: CallStatsSnapshot;
  dsp?: DspSample;
  verdict: CallVerdictKind;
}

export interface CallEvent {
  t: number;
  kind: string;
  detail?: string;
}

export interface Percentiles {
  n: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
}

export interface ParticipantSummary {
  identity: string;
  name: string;
  /** Windows in which this peer's audio actually carried speech. */
  speechWindows: number;
  jitterMs?: Percentiles;
  lossPct?: Percentiles;
  concealedMsPerSec?: Percentiles;
  acceleratedMsPerSec?: Percentiles;
  deceleratedMsPerSec?: Percentiles;
  jitterBufferMs?: Percentiles;
  bitrateKbps?: Percentiles;
  codec?: string;
}

export interface SelfSummary {
  rttMs?: Percentiles;
  lossPct?: Percentiles;
  jitterMs?: Percentiles;
  bitrateKbps?: Percentiles;
  targetBitrateKbps?: Percentiles;
  codec?: string;
}

export interface PathSummary {
  publisher?: Pick<
    TransportStats,
    | "protocol"
    | "localCandidateType"
    | "remoteCandidateType"
    | "relayProtocol"
    | "usesRelay"
    | "remotePort"
  >;
  subscriber?: Pick<
    TransportStats,
    | "protocol"
    | "localCandidateType"
    | "remoteCandidateType"
    | "relayProtocol"
    | "usesRelay"
    | "remotePort"
  >;
  /** STUN RTT on the publisher pair (ms). */
  transportRttMs?: Percentiles;
  availableOutgoingKbps?: Percentiles;
  /** Coarse region hint from the RTT, for grouping reports. */
  rttBucket?: "<50ms" | "50-120ms" | "120-200ms" | "200-300ms" | ">300ms";
}

export interface DspSummary {
  engines: string[];
  deepFilterSlowRatio?: Percentiles;
  deepFilterMaxFrameMs?: Percentiles;
  deepFilterOverloaded: boolean;
  silentMsPerSec?: Percentiles;
  longestSilentRunMs?: Percentiles;
  deepFilterAttenDb?: Percentiles;
  agcGainDb?: Percentiles;
  inputSampleRate?: number;
}

export interface CallReportSummary {
  version: number;
  id: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  room?: string;
  localIdentity?: string;
  client: { userAgent: string; platform: string };
  /** connect() -> "connected", ms. */
  connectMs?: number;
  reconnects: number;
  signalReconnects: number;
  windows: number;
  path: PathSummary;
  self: SelfSummary;
  participants: ParticipantSummary[];
  verdicts: Partial<Record<CallVerdictKind, number>>;
  dsp: DspSummary;
  events: CallEvent[];
}

export interface CallReport extends CallReportSummary {
  timeline: TimelineEntry[];
}

export function percentiles(values: Array<number | undefined>): Percentiles | undefined {
  const v = values
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    .sort((a, b) => a - b);
  if (!v.length) return undefined;
  const at = (p: number) =>
    v[Math.min(v.length - 1, Math.max(0, Math.floor((p / 100) * (v.length - 1))))];
  return { n: v.length, min: v[0], p50: at(50), p95: at(95), max: v[v.length - 1] };
}

function codecLabel(codec: InboundAudioStats["codec"] | OutboundAudioStats["codec"]) {
  if (!codec?.mimeType) return undefined;
  const parts = [codec.mimeType.replace("audio/", "")];
  if (codec.channels) parts.push(`${codec.channels}ch`);
  if (codec.fmtp) parts.push(codec.fmtp);
  return parts.join(" ");
}

function rttBucket(rtt?: number): PathSummary["rttBucket"] {
  if (rtt === undefined) return undefined;
  if (rtt < 50) return "<50ms";
  if (rtt < 120) return "50-120ms";
  if (rtt < 200) return "120-200ms";
  if (rtt < 300) return "200-300ms";
  return ">300ms";
}

function pathOf(t?: TransportStats) {
  if (!t) return undefined;
  return {
    protocol: t.protocol,
    localCandidateType: t.localCandidateType,
    remoteCandidateType: t.remoteCandidateType,
    relayProtocol: t.relayProtocol,
    usesRelay: t.usesRelay,
    remotePort: t.remotePort,
  };
}

/** Speech must have flowed for a window to say anything about a peer's audio. */
const MIN_PACKETS_SPEECH_WINDOW = 25;

export function summarizeTimeline(timeline: TimelineEntry[]): {
  self: SelfSummary;
  participants: ParticipantSummary[];
  path: PathSummary;
  verdicts: Partial<Record<CallVerdictKind, number>>;
  dsp: DspSummary;
  reconnects: number;
  signalReconnects: number;
} {
  const byId = new Map<string, { name: string; audio: InboundAudioStats[] }>();
  const selfAudio: OutboundAudioStats[] = [];
  const pub: TransportStats[] = [];
  const sub: TransportStats[] = [];
  const dsp: DspSample[] = [];
  const verdicts: Partial<Record<CallVerdictKind, number>> = {};
  let reconnects = 0;
  let signalReconnects = 0;

  for (const entry of timeline) {
    verdicts[entry.verdict] = (verdicts[entry.verdict] ?? 0) + 1;
    if (entry.stats.self.audio) selfAudio.push(entry.stats.self.audio);
    if (entry.stats.transport?.publisher) pub.push(entry.stats.transport.publisher);
    if (entry.stats.transport?.subscriber) sub.push(entry.stats.transport.subscriber);
    if (entry.dsp) dsp.push(entry.dsp);
    reconnects = Math.max(reconnects, entry.stats.reconnects ?? 0);
    signalReconnects = Math.max(signalReconnects, entry.stats.signalReconnects ?? 0);
    for (const p of entry.stats.participants) {
      const slot = byId.get(p.identity) ?? { name: p.name, audio: [] };
      if (p.audio && (p.audio.packetsInWindow ?? 0) >= MIN_PACKETS_SPEECH_WINDOW) {
        slot.audio.push(p.audio);
      }
      byId.set(p.identity, slot);
    }
  }

  const participants: ParticipantSummary[] = [...byId.entries()].map(
    ([identity, { name, audio }]) => ({
      identity,
      name,
      speechWindows: audio.length,
      jitterMs: percentiles(audio.map((a) => a.jitterMs)),
      lossPct: percentiles(audio.map((a) => a.lossPct)),
      concealedMsPerSec: percentiles(audio.map((a) => a.concealedMsPerSec)),
      acceleratedMsPerSec: percentiles(audio.map((a) => a.acceleratedMsPerSec)),
      deceleratedMsPerSec: percentiles(audio.map((a) => a.deceleratedMsPerSec)),
      jitterBufferMs: percentiles(audio.map((a) => a.jitterBufferMs)),
      bitrateKbps: percentiles(audio.map((a) => a.bitrateKbps)),
      codec: codecLabel(audio.find((a) => a.codec)?.codec),
    }),
  );

  const self: SelfSummary = {
    rttMs: percentiles(selfAudio.map((a) => a.rttMs)),
    lossPct: percentiles(selfAudio.map((a) => a.lossPct)),
    jitterMs: percentiles(selfAudio.map((a) => a.jitterMs)),
    bitrateKbps: percentiles(selfAudio.map((a) => a.bitrateKbps)),
    targetBitrateKbps: percentiles(selfAudio.map((a) => a.targetBitrateKbps)),
    codec: codecLabel(selfAudio.find((a) => a.codec)?.codec),
  };

  const transportRtt = percentiles(pub.map((t) => t.currentRttMs));
  const path: PathSummary = {
    publisher: pathOf(pub[pub.length - 1]),
    subscriber: pathOf(sub[sub.length - 1]),
    transportRttMs: transportRtt,
    availableOutgoingKbps: percentiles(pub.map((t) => t.availableOutgoingKbps)),
    rttBucket: rttBucket(transportRtt?.p50 ?? self.rttMs?.p50),
  };

  const dspSummary: DspSummary = {
    engines: [...new Set(dsp.map((d) => d.engine).filter((e): e is string => !!e))],
    deepFilterSlowRatio: percentiles(dsp.map((d) => d.deepFilterSlowRatio)),
    deepFilterMaxFrameMs: percentiles(dsp.map((d) => d.deepFilterMaxFrameMs)),
    deepFilterOverloaded: dsp.some((d) => d.deepFilterOverloaded),
    silentMsPerSec: percentiles(dsp.map((d) => d.silentMsPerSec)),
    longestSilentRunMs: percentiles(dsp.map((d) => d.longestSilentRunMs)),
    deepFilterAttenDb: percentiles(dsp.map((d) => d.deepFilterAttenDb)),
    agcGainDb: percentiles(dsp.map((d) => d.agcGainDb)),
    inputSampleRate: dsp.find((d) => d.inputSampleRate)?.inputSampleRate,
  };

  return { self, participants, path, verdicts, dsp: dspSummary, reconnects, signalReconnects };
}

/** Produces the verdict stored with every window (callDiagnosis.diagnoseCall). */
export type Diagnose = (stats: CallStatsSnapshot, dsp?: DspHealth) => CallVerdict;

/**
 * No runtime imports besides types: `diagnose` is injected so this module
 * runs under `node --test` next to the pure diagnosis code.
 */
export class CallRecorder {
  readonly #diagnose: Diagnose;

  constructor(diagnose: Diagnose) {
    this.#diagnose = diagnose;
  }

  #timeline: TimelineEntry[] = [];
  #events: CallEvent[] = [];
  #startedAt?: number;
  #connectStartedAt?: number;
  #connectMs?: number;
  #room?: string;
  #identity?: string;

  get active(): boolean {
    return this.#startedAt !== undefined;
  }

  start(meta: { room?: string; identity?: string } = {}) {
    this.#timeline = [];
    this.#events = [];
    this.#startedAt = Date.now();
    this.#connectStartedAt = this.#startedAt;
    this.#connectMs = undefined;
    this.#room = meta.room;
    this.#identity = meta.identity;
  }

  /** Call once the Room reports "connected". */
  connected(meta: { room?: string; identity?: string } = {}) {
    if (!this.#startedAt) return;
    if (this.#connectStartedAt !== undefined) {
      this.#connectMs = Date.now() - this.#connectStartedAt;
    }
    if (meta.room) this.#room = meta.room;
    if (meta.identity) this.#identity = meta.identity;
    this.event("connected");
  }

  event(kind: string, detail?: string) {
    if (!this.#startedAt) return;
    if (this.#events.length >= 500) return;
    this.#events.push({ t: Date.now() - this.#startedAt, kind, detail });
  }

  push(stats: CallStatsSnapshot, dsp?: DspSample) {
    if (!this.#startedAt || !stats.inCall) return;
    const verdict = this.#diagnose(stats, {
      deepFilterSlowRatio: dsp?.deepFilterSlowRatio,
      deepFilterOverloaded: dsp?.deepFilterOverloaded,
      silentMsPerSec: dsp?.silentMsPerSec,
    }).kind;
    this.#timeline.push({
      t: Date.now() - this.#startedAt,
      stats,
      dsp,
      verdict,
    });
    if (this.#timeline.length > MAX_TIMELINE) this.#timeline.shift();
  }

  /** Ends the recording and returns the report (undefined if never started). */
  stop(): CallReport | undefined {
    if (!this.#startedAt) return undefined;
    const startedAt = this.#startedAt;
    const endedAt = Date.now();
    const summary = summarizeTimeline(this.#timeline);
    const report: CallReport = {
      version: CALL_REPORT_VERSION,
      id: `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      startedAt,
      endedAt,
      durationSec: Math.round((endedAt - startedAt) / 1000),
      room: this.#room,
      localIdentity: this.#identity,
      client: {
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        platform: typeof navigator === "undefined" ? "" : navigator.platform,
      },
      connectMs: this.#connectMs,
      reconnects: summary.reconnects,
      signalReconnects: summary.signalReconnects,
      windows: this.#timeline.length,
      path: summary.path,
      self: summary.self,
      participants: summary.participants,
      verdicts: summary.verdicts,
      dsp: summary.dsp,
      events: this.#events,
      timeline: this.#timeline,
    };
    this.#startedAt = undefined;
    this.#timeline = [];
    this.#events = [];
    return report;
  }
}

function withoutTimeline(report: CallReport): CallReportSummary {
  const { timeline: _timeline, ...summary } = report;
  return summary;
}

/** Persists the last full report and a rolling list of summaries. */
export function saveReport(report: CallReport, storage: Storage | undefined = globalThis.localStorage) {
  if (!storage) return;
  try {
    storage.setItem(LAST_REPORT_KEY, JSON.stringify(report));
    const raw = storage.getItem(REPORT_SUMMARIES_KEY);
    const list: CallReportSummary[] = raw ? (JSON.parse(raw) as CallReportSummary[]) : [];
    list.unshift(withoutTimeline(report));
    storage.setItem(REPORT_SUMMARIES_KEY, JSON.stringify(list.slice(0, MAX_SUMMARIES)));
  } catch (error) {
    // Quota or private mode: the report is still available in memory.
    console.warn("[voice] could not persist call report", error);
  }
}

export function loadLastReport(storage: Storage | undefined = globalThis.localStorage): CallReport | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(LAST_REPORT_KEY);
    return raw ? (JSON.parse(raw) as CallReport) : undefined;
  } catch {
    return undefined;
  }
}

export function loadReportSummaries(storage: Storage | undefined = globalThis.localStorage): CallReportSummary[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(REPORT_SUMMARIES_KEY);
    return raw ? (JSON.parse(raw) as CallReportSummary[]) : [];
  } catch {
    return [];
  }
}

/** Offers the report as a JSON download (browser only). */
export function downloadReport(report: CallReport | CallReportSummary) {
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const when = new Date(report.startedAt).toISOString().replace(/[:.]/g, "-");
  a.href = url;
  a.download = `muchat-voz-${when}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
