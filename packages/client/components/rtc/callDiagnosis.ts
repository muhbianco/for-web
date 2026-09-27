import type { CallStatsSnapshot, ParticipantCallStats } from "./callStats";

/**
 * Turns the raw call stats into one sentence a person can act on.
 *
 * The whole point of the diagnostics work is that "the voice is chopping" has
 * four different causes that look identical to the ear:
 *
 *   local-cpu        this machine cannot encode/decode/denoise fast enough
 *   local-uplink     our upload is losing packets
 *   local-downlink   our download is losing packets (everyone sounds bad)
 *   remote-network   one specific peer's connection is bad (only they do)
 *
 * The last two are told apart by counting how many peers are affected: one bad
 * peer out of several is their problem, everyone bad at once is ours.
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

export type CallVerdictKind =
  | "waiting"
  | "ok"
  | "local-cpu"
  | "local-uplink"
  | "local-downlink"
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

  const withAudio = stats.participants.filter((p) => p.audio);
  const suffering = withAudio.filter(audioIsSuffering);
  if (!suffering.length) return { kind: "ok" };

  const worst = suffering.reduce((best, p) =>
    sufferingScore(p) > sufferingScore(best) ? p : best,
  );

  // Everyone at once is far more likely to be our own download than every
  // peer having gone bad simultaneously.
  if (withAudio.length > 1 && suffering.length === withAudio.length) {
    return { kind: "local-downlink", detail: describe(worst) };
  }

  return { kind: "remote-network", who: worst.name, detail: describe(worst) };
}
