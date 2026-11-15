import type { CallStatsSnapshot, ParticipantCallStats } from "./callStats";

/**
 * Turns the raw call stats into one sentence a person can act on.
 *
 * The whole point of the diagnostics work is that "the voice is chopping" has
 * several different causes that look identical to the ear:
 *
 *   local-cpu        this machine cannot encode/decode/denoise fast enough
 *   local-origin     our own DSP chain is emitting silence (gate / glitches),
 *                    so the gaps leave this machine already in the signal
 *   local-uplink     our upload is losing packets
 *   local-downlink   our download is losing packets (everyone sounds bad)
 *   local-playout    packets arrive fine (no loss, low jitter) but our decoder
 *                    still conceals / time-stretches: the problem is at the
 *                    destination (playout starving, clock, busy audio thread)
 *   remote-network   one specific peer's connection is bad (only they do)
 *
 * Downlink and remote are told apart by counting how many peers are affected:
 * one bad peer out of several is their problem, everyone bad at once is ours.
 */

/**
 * Audio removed per second before it is audible as "sped up speech". 20 ms/s
 * is 2% time compression; below that NetEQ is just doing its job.
 */
export const ACCELERATED_MS_PER_SEC_BAD = 20;

/** Audio invented per second to paper over loss, excluding silence. */
export const CONCEALED_MS_PER_SEC_BAD = 20;

/** Packet loss where Opus + RED stops being able to hide the gaps. */
export const LOSS_PCT_BAD = 3;

/** Jitter that forces the buffer to grow enough to be heard. */
export const JITTER_MS_BAD = 30;

/**
 * Share of late DSP frames that means this machine is the bottleneck. Kept as
 * its own constant rather than imported from deepFilterHealth so this module
 * has no runtime imports and can be unit tested under `node --test`; it is
 * deliberately the same value as DF_SLOW_RATIO there.
 */
export const DSP_SLOW_RATIO_BAD = 0.25;

/**
 * Digital silence leaving our own chain, per second of call, while the gate
 * says someone is talking. The production meter counts zeros at the point
 * LiveKit publishes; 20 ms/s of them during speech is already audible as a
 * missing syllable per minute of talk.
 */
export const SILENT_MS_PER_SEC_BAD = 20;

/**
 * Packets a 2 s window needs before a verdict means anything. Continuous
 * speech is ~50 packets/s; DTX during silence drops to a couple of
 * comfort-noise packets a second. Below this the window is silence, every
 * rate reads zero, and "healthy" would be a lie — which is exactly what the
 * panel said the first time it was pointed at a real problem.
 */
export const MIN_PACKETS_FOR_VERDICT = 25;

export type CallVerdictKind =
  | "waiting"
  | "no-data"
  | "ok"
  | "local-cpu"
  | "local-origin"
  | "local-uplink"
  | "local-downlink"
  | "local-playout"
  | "remote-network";

export interface CallVerdict {
  kind: CallVerdictKind;
  /** Whose connection it is, when the problem belongs to one peer. */
  who?: string;
  /** The measurement behind the verdict, so the UI can show its evidence. */
  detail?: string;
}

/** The slice of the DSP status this module needs. */
export interface DspHealth {
  deepFilterSlowRatio?: number;
  deepFilterOverloaded?: boolean;
  /** Digital silence the local chain emitted (ms/s), from the production meter. */
  silentMsPerSec?: number;
  /** True while the local gate is open (someone is talking into the mic). */
  gateOpen?: boolean;
}

/** True when this peer's inbound audio is visibly suffering. */
export function audioIsSuffering(participant: ParticipantCallStats): boolean {
  const audio = participant.audio;
  if (!audio) return false;
  return (
    (audio.acceleratedMsPerSec ?? 0) >= ACCELERATED_MS_PER_SEC_BAD ||
    (audio.concealedMsPerSec ?? 0) >= CONCEALED_MS_PER_SEC_BAD ||
    (audio.lossPct ?? 0) >= LOSS_PCT_BAD ||
    (audio.jitterMs ?? 0) >= JITTER_MS_BAD
  );
}

/**
 * Suffering with a clean network: no loss, low jitter, yet the decoder is
 * concealing or time-stretching. That cannot be the network's doing.
 */
export function sufferingWithCleanNetwork(
  participant: ParticipantCallStats,
): boolean {
  const audio = participant.audio;
  if (!audio) return false;
  const cleanNetwork =
    (audio.lossPct ?? 0) < LOSS_PCT_BAD &&
    (audio.jitterMs ?? 0) < JITTER_MS_BAD;
  const degraded =
    (audio.acceleratedMsPerSec ?? 0) >= ACCELERATED_MS_PER_SEC_BAD ||
    (audio.concealedMsPerSec ?? 0) >= CONCEALED_MS_PER_SEC_BAD;
  return cleanNetwork && degraded;
}

/** How bad, so we can name the worst offender rather than an arbitrary one. */
function sufferingScore(participant: ParticipantCallStats): number {
  const audio = participant.audio;
  if (!audio) return 0;
  return (
    (audio.acceleratedMsPerSec ?? 0) +
    (audio.concealedMsPerSec ?? 0) +
    (audio.lossPct ?? 0) * 10 +
    (audio.jitterMs ?? 0)
  );
}

function describe(participant: ParticipantCallStats): string {
  const audio = participant.audio;
  if (!audio) return "";
  const parts: string[] = [];
  if ((audio.acceleratedMsPerSec ?? 0) >= ACCELERATED_MS_PER_SEC_BAD) {
    parts.push(`${audio.acceleratedMsPerSec} ms/s acelerado`);
  }
  if ((audio.concealedMsPerSec ?? 0) >= CONCEALED_MS_PER_SEC_BAD) {
    parts.push(`${audio.concealedMsPerSec} ms/s reconstruído`);
  }
  if ((audio.lossPct ?? 0) >= LOSS_PCT_BAD) {
    parts.push(`${audio.lossPct}% de perda`);
  }
  if ((audio.jitterMs ?? 0) >= JITTER_MS_BAD) {
    parts.push(`${audio.jitterMs} ms de jitter`);
  }
  return parts.join(", ");
}

export function diagnoseCall(
  stats: CallStatsSnapshot,
  dsp?: DspHealth,
): CallVerdict {
  if (!stats.inCall || !stats.updatedAt) return { kind: "waiting" };

  // CPU first: a saturated machine also produces loss-like symptoms, so
  // blaming the network while the encoder is screaming "cpu" is wrong.
  const cpuLimited = stats.self.video.find((v) => v.limitedBy === "cpu");
  if (cpuLimited) {
    return {
      kind: "local-cpu",
      detail: `o encoder de ${cpuLimited.source === "camera" ? "câmera" : "tela"} está limitado por CPU`,
    };
  }
  if (dsp?.deepFilterOverloaded) {
    return {
      kind: "local-cpu",
      detail: "o filtro de ruído não acompanhou e caiu para o RNNoise",
    };
  }
  if ((dsp?.deepFilterSlowRatio ?? 0) >= DSP_SLOW_RATIO_BAD) {
    const pct = Math.round((dsp?.deepFilterSlowRatio ?? 0) * 100);
    return {
      kind: "local-cpu",
      detail: `${pct}% dos quadros de áudio estão atrasados`,
    };
  }
  // Our own chain is handing LiveKit silence while the gate says we are
  // talking: the gaps are made here, before any network is involved.
  if (
    dsp?.gateOpen === true &&
    (dsp.silentMsPerSec ?? 0) >= SILENT_MS_PER_SEC_BAD
  ) {
    return {
      kind: "local-origin",
      detail: `${dsp.silentMsPerSec} ms/s de silêncio saindo do seu microfone processado`,
    };
  }

  const uplinkLoss = stats.self.audio?.lossPct ?? 0;
  const bandwidthLimited = stats.self.video.find(
    (v) => v.limitedBy === "bandwidth",
  );
  if (uplinkLoss >= LOSS_PCT_BAD) {
    return {
      kind: "local-uplink",
      detail: `${uplinkLoss}% do seu áudio não está chegando`,
    };
  }
  if (bandwidthLimited) {
    return {
      kind: "local-uplink",
      detail: "o vídeo está sendo limitado pela sua banda de subida",
    };
  }

  // Only windows with real speech in them can support a verdict about audio.
  const withAudio = stats.participants.filter(
    (p) => (p.audio?.packetsInWindow ?? 0) >= MIN_PACKETS_FOR_VERDICT,
  );
  if (!withAudio.length) {
    return {
      kind: "no-data",
      detail: "ninguém falou nesta janela de medição",
    };
  }

  const suffering = withAudio.filter(audioIsSuffering);
  if (!suffering.length) return { kind: "ok" };

  const worst = suffering.reduce((best, p) =>
    sufferingScore(p) > sufferingScore(best) ? p : best,
  );

  // Everyone at once is far more likely to be our own download than every
  // peer having gone bad simultaneously. If the network numbers are clean for
  // all of them, it is not the download either: it is our playout.
  if (withAudio.length > 1 && suffering.length === withAudio.length) {
    if (suffering.every(sufferingWithCleanNetwork)) {
      return { kind: "local-playout", detail: describe(worst) };
    }
    return { kind: "local-downlink", detail: describe(worst) };
  }

  // A single peer with clean network numbers but concealment on our side is
  // still us, not them: nothing was lost or late on the wire.
  if (withAudio.length === 1 && sufferingWithCleanNetwork(worst)) {
    return { kind: "local-playout", detail: describe(worst) };
  }

  return { kind: "remote-network", who: worst.name, detail: describe(worst) };
}
