import { type Rates, type Vocation, topVocation } from "./data.ts";

/**
 * Treino no dummy da sala. Usa a única regra de treino sem inimigo que a base do OT
 * tem: a do treino offline das estátuas [TFS data/creaturescripts/scripts/offline_training.lua,
 * src/player.h:152-155]. O tempo no dummy vale como o tempo treinado lá.
 */

/** O que se treina no dummy: as escolhas da janela do TFS (game.cpp:54-58). */
export type TrainingSkill =
  | "espada"
  | "machado"
  | "maca"
  | "distancia"
  | "magia";
export const TRAINING_SKILLS: readonly TrainingSkill[] = [
  "espada",
  "machado",
  "maca",
  "distancia",
  "magia",
];

export const TRAINING = {
  /** Saldo máximo de treino: 12 h [TFS player.h:154]. */
  maxBankMs: 12 * 3600 * 1000,
  /** Uma sessão gasta no máximo 12 h [TFS offline_training.lua:17]. */
  maxSessionMs: 43_200 * 1000,
  /**
   * Menos de 60 s não rende [TFS offline_training.lua:25]. [nosso] Aqui também não gasta
   * o saldo (o original gastava): quem encosta no dummy e sai logo não perde nada.
   */
  minCreditMs: 60 * 1000,
} as const;

/** Tentativas (ou mana) de um treino de `seconds` segundos, já com a taxa do servidor. */
export interface TrainingGain {
  /** Tentativas da skill treinada, ou mana gasta no caso de "magia". */
  main: number;
  /** Tentativas de escudo, sempre junto [TFS offline_training.lua:71-73]. */
  escudo: number;
}

/**
 * Ganho de `seconds` segundos de treino [TFS offline_training.lua:60-73]:
 * - corpo a corpo: `segundos / (velocidade de ataque em s) / 2` (uma tentativa a cada dois ataques);
 * - distância: o mesmo `/ 4`;
 * - magia: `segundos × manaAmount / (manaTicks da vocação do topo × 2)` de mana;
 * - escudo: `segundos / 4`.
 * Cada valor é truncado como no repasse do Lua para o uint64 e só então multiplicado pela
 * taxa [TFS data/events/scripts/player.lua:222-233].
 */
export function trainingGain(
  voc: Vocation,
  skill: TrainingSkill,
  seconds: number,
  rates: Rates,
): TrainingGain {
  if (seconds <= 0) return { main: 0, escudo: 0 };
  const top = topVocation(voc);
  let main: number;
  if (skill === "magia") {
    const ticks = Math.max(1, top.manaTicks * 2);
    main = Math.floor((seconds * voc.manaAmount) / ticks) * rates.magic;
  } else {
    const modifier = top.attackSpeedMs / 1000;
    main =
      Math.floor(seconds / modifier / (skill === "distancia" ? 4 : 2)) *
      rates.skill;
  }
  const escudo = main > 0 ? Math.floor(seconds / 4) * rates.skill : 0;
  return { main, escudo };
}

/**
 * Crédito incremental: o ganho entre `fromSeconds` e `toSeconds` de uma mesma sessão.
 * É a diferença dos ganhos acumulados, então creditar em pedaços dá o mesmo total que
 * creditar de uma vez (sem perder o resto da truncagem).
 */
export function trainingDelta(
  voc: Vocation,
  skill: TrainingSkill,
  fromSeconds: number,
  toSeconds: number,
  rates: Rates,
): TrainingGain {
  const a = trainingGain(voc, skill, Math.max(0, fromSeconds), rates);
  const b = trainingGain(voc, skill, Math.max(0, toSeconds), rates);
  return {
    main: Math.max(0, b.main - a.main),
    escudo: Math.max(0, b.escudo - a.escudo),
  };
}

/** O saldo de treino: quanto se pode treinar, e quando foi a última conta. */
export interface TrainingBank {
  /** Saldo em ms no instante `at`. */
  ms: number;
  at: number;
}

/**
 * Saldo agora. Enquanto o herói não treina, o saldo enche no ritmo do relógio, até 12 h
 * [TFS player.h:152-155: `addOfflineTrainingTime`, teto 12 h]. [nosso] O original enchia
 * só com o personagem deslogado; aqui enche em qualquer momento sem treino.
 */
export function bankNow(bank: TrainingBank, now: number): number {
  const elapsed = Math.max(0, now - bank.at);
  return Math.min(TRAINING.maxBankMs, bank.ms + elapsed);
}

/** Uma sessão no dummy: começou em `startedAt` com `budgetMs` de saldo disponível. */
export interface TrainingSession {
  skill: TrainingSkill;
  startedAt: number;
  budgetMs: number;
  /** Segundos já creditados nesta sessão (para o crédito incremental). */
  creditedSeconds: number;
}

/** Abre uma sessão: o orçamento é o saldo agora, até 12 h. */
export function startSession(
  bank: TrainingBank,
  skill: TrainingSkill,
  now: number,
): TrainingSession {
  return {
    skill,
    startedAt: now,
    budgetMs: Math.min(TRAINING.maxSessionMs, bankNow(bank, now)),
    creditedSeconds: 0,
  };
}

/** Segundos de treino que contam até `now` (para no fim do orçamento). */
export function sessionSeconds(s: TrainingSession, now: number): number {
  const ms = Math.min(Math.max(0, now - s.startedAt), s.budgetMs);
  return Math.floor(ms / 1000);
}

/**
 * Fecha a conta de uma sessão até `now`: o ganho ainda não creditado, os segundos que
 * passam a valer como creditados e o saldo que sobra. Sessão com menos de 60 s no total
 * não rende e não gasta saldo [nosso, ver TRAINING.minCreditMs].
 */
export function settleSession(
  voc: Vocation,
  s: TrainingSession,
  now: number,
  rates: Rates,
): { gain: TrainingGain; creditedSeconds: number; spentMs: number } {
  const seconds = sessionSeconds(s, now);
  if (seconds * 1000 < TRAINING.minCreditMs) {
    return {
      gain: { main: 0, escudo: 0 },
      creditedSeconds: s.creditedSeconds,
      spentMs: 0,
    };
  }
  const gain = trainingDelta(voc, s.skill, s.creditedSeconds, seconds, rates);
  return { gain, creditedSeconds: seconds, spentMs: seconds * 1000 };
}

/**
 * O saldo depois de encerrar a sessão em `now`: o orçamento menos o que foi treinado.
 * O orçamento é o saldo inteiro do início (saldo e sessão têm o mesmo teto de 12 h).
 */
export function bankAfter(s: TrainingSession, now: number): TrainingBank {
  const seconds = sessionSeconds(s, now);
  const spent = seconds * 1000 < TRAINING.minCreditMs ? 0 : seconds * 1000;
  return { ms: Math.max(0, s.budgetMs - spent), at: now };
}
