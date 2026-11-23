import { z } from "zod";

import { MAX_FRAME_BYTES, PROTOCOL_VERSION } from "../../protocol/messages.ts";
import type { SkillId, VocationId } from "./data.ts";
import { type TrainingSkill, TRAINING_SKILLS } from "./training.ts";

/**
 * Comandos do jogo idle na WS do Espaço (docs/espaco/jogo/ot). Prefixo `rpg.`, separado do
 * `game.` do Refúgio (ADR 0009): os dois convivem enquanto o piloto antigo existir. O
 * gateway tenta `parseRpgCommand` antes do parser do mapa.
 */

const env = { v: z.literal(PROTOCOL_VERSION), id: z.string().min(1).max(40) };

/** Pede o estado do herói (abre o jogo; fecha um treino que ficou para trás). */
export const RpgOpenCmd = z.object({
  ...env,
  t: z.literal("rpg.open"),
  d: z.object({}).strict().optional(),
});

/** Escolhe a vocação (só uma vez, enquanto Aprendiz): 1 Feiticeiro, 2 Druida, 3 Arqueiro, 4 Cavaleiro. */
export const RpgVocationCmd = z.object({
  ...env,
  t: z.literal("rpg.vocation"),
  d: z
    .object({
      vocation: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
      ]),
    })
    .strict(),
});

/** Começa a treinar no dummy `instance` (o herói tem de estar ao lado). */
export const RpgTrainStartCmd = z.object({
  ...env,
  t: z.literal("rpg.train.start"),
  d: z
    .object({
      instance: z.string().min(1).max(40),
      skill: z.enum(TRAINING_SKILLS as [TrainingSkill, ...TrainingSkill[]]),
    })
    .strict(),
});

/** Para de treinar (credita o tempo treinado). */
export const RpgTrainStopCmd = z.object({
  ...env,
  t: z.literal("rpg.train.stop"),
  d: z.object({}).strict().optional(),
});

export const RpgCommand = z.discriminatedUnion("t", [
  RpgOpenCmd,
  RpgVocationCmd,
  RpgTrainStartCmd,
  RpgTrainStopCmd,
]);
export type RpgCommand = z.infer<typeof RpgCommand>;

/** `null` = não é comando do jogo idle (o gateway segue para os outros parsers). */
export function parseRpgCommand(
  raw: string,
): { ok: true; cmd: RpgCommand } | { ok: false; error: string } | null {
  if (raw.length > MAX_FRAME_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const t = (json as { t?: unknown }).t;
  if (typeof t !== "string" || !t.startsWith("rpg.")) return null;
  const res = RpgCommand.safeParse(json);
  return res.success
    ? { ok: true, cmd: res.data }
    : { ok: false, error: "invalid_message" };
}

/** Uma skill como o app vê: nível, tentativas e o requisito do próximo. */
export interface RpgSkillView {
  level: number;
  tries: number;
  next: number;
}

/** O treino em andamento: o app projeta o progresso pelo relógio com as regras puras. */
export interface RpgTrainingView {
  skill: TrainingSkill;
  instance: string;
  started_at: number;
  budget_ms: number;
  credited_s: number;
}

/** O herói como o app vê (tudo que o app precisa para projetar o treino sem perguntar). */
export interface RpgHeroView {
  vocation: VocationId;
  level: number;
  experience: number;
  health_max: number;
  mana_max: number;
  cap: number;
  skills: Record<SkillId, RpgSkillView>;
  magic: { level: number; mana_spent: number; next: number };
  stamina: number;
  /** Saldo de treino em ms no instante `bank_at` (enche até 12 h sem treinar). */
  bank_ms: number;
  bank_at: number;
  training: RpgTrainingView | null;
  /** Taxas do servidor em vigor (skill e magia multiplicam as tentativas). */
  rates: { exp: number; skill: number; magic: number; loot: number };
}

export interface RpgStateEvent {
  v: 1;
  t: "rpg.state";
  re?: string;
  d: { server_now: number; rev: number; hero: RpgHeroView | null };
}
