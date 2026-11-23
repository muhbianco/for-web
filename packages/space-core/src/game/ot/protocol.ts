import { z } from "zod";

import { MAX_FRAME_BYTES, PROTOCOL_VERSION } from "../../protocol/messages.ts";
import type { SkillId, VocationId } from "./data.ts";
import type { Gear, RunFrame, RunOutcome } from "./run.ts";
import { type TrainingSkill, TRAINING_SKILLS } from "./training.ts";

/**
 * Comandos do jogo idle na WS do Espaço (docs/espaco/jogo/ot). Prefixo `rpg.`, separado do
 * `game.` do Refúgio (ADR 0009), removido em 23/11/2026. O
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

/** Cria a sala de preparação na TV `tv` para a dungeon (a pessoa tem de estar ao lado da TV). */
export const RpgLobbyCreateCmd = z.object({
  ...env,
  t: z.literal("rpg.lobby.create"),
  d: z
    .object({
      tv: z.string().min(1).max(40),
      dungeon: z.string().min(1).max(40),
    })
    .strict(),
});

/** Entra no grupo da TV `tv` (ao lado dela). */
export const RpgLobbyJoinCmd = z.object({
  ...env,
  t: z.literal("rpg.lobby.join"),
  d: z.object({ tv: z.string().min(1).max(40) }).strict(),
});

/** Sai do grupo (o líder saindo cancela). */
export const RpgLobbyLeaveCmd = z.object({
  ...env,
  t: z.literal("rpg.lobby.leave"),
  d: z.object({}).strict().optional(),
});

/** O líder começa a dungeon. */
export const RpgLobbyStartCmd = z.object({
  ...env,
  t: z.literal("rpg.lobby.start"),
  d: z.object({}).strict().optional(),
});

export const RpgCommand = z.discriminatedUnion("t", [
  RpgOpenCmd,
  RpgVocationCmd,
  RpgTrainStartCmd,
  RpgTrainStopCmd,
  RpgLobbyCreateCmd,
  RpgLobbyJoinCmd,
  RpgLobbyLeaveCmd,
  RpgLobbyStartCmd,
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
  /** Moedas (etapa O5). */
  gold: number;
  /** A mochila: o que caiu nas dungeons (o kit da vocação não entra). */
  bag: { item: string; count: number }[];
  /** Peso da mochila, em centésimos de oz; a capacidade é `cap` em oz. */
  bag_weight: number;
  /** O que o herói vestiria agora numa dungeon (o melhor do kit e da mochila). */
  gear: Gear;
  /** Na dungeon agora: até quando. */
  run: { id: string; dungeon: string; ends_at: number } | null;
}

export interface RpgStateEvent {
  v: 1;
  t: "rpg.state";
  re?: string;
  d: { server_now: number; rev: number; hero: RpgHeroView | null };
}

/** Um membro do grupo como a sala vê. */
export interface RpgLobbyMember {
  user_id: string;
  name: string;
  vocation: VocationId;
  level: number;
}

/** A sala de preparação de uma TV. */
export interface RpgLobbyView {
  tv: string;
  room: string;
  dungeon: string;
  leader: string;
  members: RpgLobbyMember[];
  max: number;
  expires_at: number;
}

/**
 * Estado da sala de uma TV, para quem está na sala do mapa: `lobby` null = não há grupo ali.
 * `started` vem uma vez, quando o líder começa; a corrida chega depois em `rpg.run`.
 */
export interface RpgLobbyEvent {
  v: 1;
  t: "rpg.lobby";
  d: {
    tv: string;
    lobby: RpgLobbyView | null;
    ended?: "started" | "cancelled" | "expired";
    started?: { dungeon: string; members: RpgLobbyMember[] };
  };
}

/** Um herói na corrida, como a sala vê. */
export interface RpgRunMemberView {
  user_id: string;
  name: string;
  vocation: VocationId;
  level: number;
  health_max: number;
  mana_max: number;
  gear: Gear;
}

/** Uma corrida de dungeon (etapa O5): quem, onde e quando acaba. */
export interface RpgRunView {
  id: string;
  tv: string;
  room: string;
  dungeon: string;
  started_at: number;
  ends_at: number;
  members: RpgRunMemberView[];
}

/** O que cada um levou, no fim (null em `reward`: caiu e perdeu a recompensa). */
export interface RpgRunEndView {
  outcome: RunOutcome;
  members: {
    user_id: string;
    dead: boolean;
    reward: {
      exp: number;
      gold: number;
      loot: { item: string; count: number }[];
      tries: Partial<Record<SkillId, number>>;
      mana_spent: number;
    } | null;
  }[];
}

/** Acontecimento do registro com o segundo em que aconteceu. */
export type RpgRunFeedItem = RunFrame["e"][number] & { at: number; st: number };

/**
 * A corrida inteira até agora, para quem chega (entrou na sala, abriu o app, começou): o
 * último quadro (`frame` null se a corrida veio de outra versão das regras) e o registro
 * recente. `end` vem quando a corrida acaba.
 */
export interface RpgRunEvent {
  v: 1;
  t: "rpg.run";
  d: {
    run: RpgRunView;
    frame: RunFrame | null;
    feed: RpgRunFeedItem[];
    end?: RpgRunEndView;
  };
}

/** Os segundos que passaram desde o último envio (normalmente um). */
export interface RpgRunTickEvent {
  v: 1;
  t: "rpg.run.tick";
  d: { id: string; frames: RunFrame[] };
}
