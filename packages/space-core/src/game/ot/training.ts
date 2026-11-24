import { type Rates, type Vocation, topVocation } from "./data.ts";

/**
 * Treino no dummy da sala. Usa a única regra de treino sem inimigo que a base do OT
 * tem: a do treino offline das estátuas [TFS data/creaturescripts/scripts/offline_training.lua,
 * src/player.h:152-155]. O tempo no dummy vale como o tempo treinado lá.
 */

/**
 * O que se treina no dummy: as escolhas da janela do TFS (game.cpp:54-58), no dummy de vocação;
 * e `habilidade`, no dummy de habilidade (24/11/2026, pedido do dono: é esse treino que dá os
 * pontos da árvore, não o level).
 */
export type TrainingSkill =
  | "espada"
  | "machado"
  | "maca"
  | "distancia"
  | "magia"
  | "habilidade";
export const TRAINING_SKILLS: readonly TrainingSkill[] = [
  "espada",
  "machado",
  "maca",
  "distancia",
  "magia",
  "habilidade",
];

/** Os dois dummies: o de vocação (as armas e a magia) e o de habilidade. */
export type DummyKind = "vocacao" | "habilidade";

/** O dummy aceita este treino? */
export function dummyTrains(kind: DummyKind, skill: TrainingSkill): boolean {
  return kind === "habilidade" ? skill === "habilidade" : skill !== "habilidade";
}

/**
 * Treino nos dois dummies ao mesmo tempo [nosso] (24/11/2026, pedido do dono): "se bater em um
 * único dummy, ganha 100% dele; se bater em dois, ganha 50% de cada". A skill escolhida no dummy
 * de vocação (com o escudo junto) e os pontos do dummy de habilidade rendem esta fração cada.
 */
export const DUAL_EFFICIENCY = 0.5;

/**
 * Até onde o herói segue treinando longe do dummy, dentro da sala dele (tiles). Também é o
 * alcance do segundo dummy no treino nos dois: ao lado de um, até esta distância do outro.
 */
export const TRAIN_REACH_TILES = 5;

/**
 * Pontos de habilidade [nosso, no molde das skills do TFS, vocation.cpp:141-148]: o ponto `n`
 * pede `50 × 1,1^(n − 1)` tentativas, e o dummy de habilidade rende como o treino de uma arma
 * corpo a corpo (uma tentativa a cada dois ataques, × a taxa de skill). Com a taxa 2: o 1º ponto
 * em 100 s, 24 em ~2,5 h, 40 em ~12 h, 50 em ~32 h e 60 em ~84 h de treino (a árvore de uma
 * classe tem de 65 a 68 pontos).
 */
export const SKILL_POINT = { base: 50, multiplier: 1.1 } as const;

/** O treino de habilidade: pontos ganhos e tentativas para o próximo. */
export interface PointTraining {
  points: number;
  tries: number;
}

/**
 * Cada renascimento da árvore deixa o treino de habilidade 1% mais lento, um sobre o outro
 * (24/11/2026, pelo dono: "cada reset precisa exigir 1% a mais de tempo"): 1,01^renascimentos.
 */
export const REBIRTH_TRAINING_PCT = 1;

export function rebirthScale(rebirths: number): number {
  return Math.pow(1 + REBIRTH_TRAINING_PCT / 100, Math.max(0, rebirths));
}

/** Tentativas do ponto `n`; `scale` é o do renascimento (rebirthScale). */
export function reqPointTries(n: number, scale = 1): number {
  return Math.floor(
    SKILL_POINT.base * Math.pow(SKILL_POINT.multiplier, n - 1) * scale,
  );
}

/** [nosso] Teto dos pontos ganhos (a árvore inteira de uma classe pede bem menos). */
export const MAX_SKILL_POINTS = 200;

export function addPointTries(
  p: PointTraining,
  count: number,
  scale = 1,
): PointTraining {
  let { points, tries } = p;
  if (count <= 0 || points >= MAX_SKILL_POINTS) return p;
  let next = reqPointTries(points + 1, scale);
  while (tries + count >= next) {
    count -= next - tries;
    points++;
    tries = 0;
    if (points >= MAX_SKILL_POINTS) return { points, tries: 0 };
    next = reqPointTries(points + 1, scale);
  }
  return { points, tries: tries + count };
}

/**
 * Sem limite de treino (24/11/2026, pedido do dono: "vamos remover esse limite de grind"): o
 * saldo de 12 h do TFS [player.h:154, offline_training.lua:17] saiu. O herói treina enquanto
 * fica no dummy; o "saldo" vira um número que não acaba (10 anos), para os documentos e as
 * telas de antes continuarem válidos.
 */
const UNLIMITED_MS = 10 * 365 * 24 * 3600 * 1000;

export const TRAINING = {
  /** Saldo de treino: sem limite (antes 12 h). */
  maxBankMs: UNLIMITED_MS,
  /** Uma sessão: sem limite (antes 12 h). */
  maxSessionMs: UNLIMITED_MS,
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
  /** Tentativas de escudo, sempre junto [TFS offline_training.lua:71-73]; no treino de habilidade, nada. */
  escudo: number;
}

/**
 * Ganho de `seconds` segundos de treino [TFS offline_training.lua:60-73]:
 * - corpo a corpo: `segundos / (velocidade de ataque em s) / 2` (uma tentativa a cada dois ataques);
 * - distância: o mesmo `/ 4`;
 * - magia: `segundos × manaAmount / (manaTicks da vocação do topo × 2)` de mana;
 * - escudo: `segundos / 4`.
 * Cada valor é truncado como no repasse do Lua para o uint64 e só então multiplicado pela
 * taxa [TFS data/events/scripts/player.lua:222-233]. `efficiency` (treino nos dois dummies,
 * DUAL_EFFICIENCY) multiplica o resultado, truncado de novo; como o crédito é a diferença dos
 * ganhos acumulados (trainingDelta), creditar em pedaços não perde nada.
 */
export function trainingGain(
  voc: Vocation,
  skill: TrainingSkill,
  seconds: number,
  rates: Rates,
  efficiency = 1,
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
  const escudo =
    main > 0 && skill !== "habilidade" ? Math.floor(seconds / 4) * rates.skill : 0;
  if (efficiency === 1) return { main, escudo };
  return {
    main: Math.floor(main * efficiency),
    escudo: Math.floor(escudo * efficiency),
  };
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
  efficiency = 1,
): TrainingGain {
  const a = trainingGain(voc, skill, Math.max(0, fromSeconds), rates, efficiency);
  const b = trainingGain(voc, skill, Math.max(0, toSeconds), rates, efficiency);
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
export function bankNow(_bank: TrainingBank, _now: number): number {
  // Sem limite (24/11/2026): o saldo está sempre cheio.
  return TRAINING.maxBankMs;
}

/** Uma sessão no dummy: começou em `startedAt` com `budgetMs` de saldo disponível. */
export interface TrainingSession {
  /** No treino nos dois dummies, a skill do dummy de vocação (nunca "habilidade"). */
  skill: TrainingSkill;
  startedAt: number;
  budgetMs: number;
  /** Segundos já creditados nesta sessão (para o crédito incremental). */
  creditedSeconds: number;
  /** Nos dois dummies: `skill` e os pontos de habilidade, cada um a DUAL_EFFICIENCY. */
  dual?: boolean;
}

/** Quanto cada treino da sessão rende (1 num dummy, DUAL_EFFICIENCY nos dois). */
export function sessionEfficiency(s: Pick<TrainingSession, "dual">): number {
  return s.dual ? DUAL_EFFICIENCY : 1;
}

/** Abre uma sessão: o orçamento é o saldo agora, até 12 h. */
export function startSession(
  bank: TrainingBank,
  skill: TrainingSkill,
  now: number,
  dual = false,
): TrainingSession {
  return {
    skill,
    startedAt: now,
    budgetMs: Math.min(TRAINING.maxSessionMs, bankNow(bank, now)),
    creditedSeconds: 0,
    ...(dual ? { dual: true } : {}),
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
): {
  gain: TrainingGain;
  /** Tentativas de ponto de habilidade do treino nos dois dummies (0 fora dele). */
  points: number;
  creditedSeconds: number;
  spentMs: number;
} {
  const seconds = sessionSeconds(s, now);
  if (seconds * 1000 < TRAINING.minCreditMs) {
    return {
      gain: { main: 0, escudo: 0 },
      points: 0,
      creditedSeconds: s.creditedSeconds,
      spentMs: 0,
    };
  }
  const eff = sessionEfficiency(s);
  const gain = trainingDelta(voc, s.skill, s.creditedSeconds, seconds, rates, eff);
  const points = s.dual
    ? trainingDelta(voc, "habilidade", s.creditedSeconds, seconds, rates, eff).main
    : 0;
  return { gain, points, creditedSeconds: seconds, spentMs: seconds * 1000 };
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
