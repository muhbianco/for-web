import { CLASSES, DUMMIES, RULES, type SkillId } from "./data.ts";
import { addSkillTries } from "./tables.ts";

/**
 * Progresso pelo relógio do servidor, sem tick (ADR 0009, decisão 3): todo
 * comando "assenta" o tempo passado com uma fórmula fechada. O app usa as
 * mesmas funções para mostrar o contador.
 */

export interface Training {
  skill: SkillId;
  /** Desde quando conta (ms do servidor). */
  since: number;
  /** Nível do boneco (índice em DUMMIES). */
  tier: number;
  /** Resto da divisão, em 1/600.000 de tentativa: coletar toda hora rende o mesmo que coletar uma vez. */
  rem: number;
}

const DIV = 600_000; // tentativas = ms × (tentativas/min × 10) / 600.000

export function dummyOf(tier: number) {
  return DUMMIES[Math.min(DUMMIES.length - 1, Math.max(0, Math.floor(tier)))]!;
}

/**
 * Quanto o boneco rendeu até `now`. Relógio para trás conta 0. O que passar do
 * teto do boneco se perde (e o resto também, porque o tempo não foi contado).
 */
export function settleTraining(t: Training, now: number): { tries: number; training: Training } {
  const d = dummyOf(t.tier);
  const capMs = d.capH * 3_600_000;
  const elapsed = Math.max(0, Math.floor(now - t.since));
  const capped = Math.min(elapsed, capMs);
  const units = (elapsed > capMs ? 0 : t.rem) + capped * d.triesPerMin10;
  return { tries: Math.floor(units / DIV), training: { ...t, since: Math.max(t.since, Math.floor(now)), rem: units % DIV } };
}

/** Pausa o boneco (expedição começando): assenta e zera o resto. */
export function pauseTraining(t: Training, now: number): { tries: number; training: Training } {
  const r = settleTraining(t, now);
  return { tries: r.tries, training: { ...r.training, rem: 0 } };
}

/** Retoma depois da expedição: conta a partir de agora. */
export function resumeTraining(t: Training, now: number): Training {
  return { ...t, since: Math.floor(now), rem: 0 };
}

/** Tentativas de treino até `now`, sem gravar nada (para o contador do app). */
export function pendingTries(t: Training, now: number): number {
  return settleTraining(t, now).tries;
}

export interface Vitals {
  hp: number;
  mp: number;
  /** Hora (ms do servidor) em que `hp` e `mp` valiam isto. */
  at: number;
}

/** Vida e mana no Refúgio: de 0 ao máximo em `RULES.regenFullMs`, linear. */
export function currentVitals(v: Vitals, maxHp: number, maxMp: number, now: number): { hp: number; mp: number } {
  const elapsed = Math.max(0, Math.floor(now - v.at));
  return {
    hp: Math.min(maxHp, v.hp + Math.floor((maxHp * elapsed) / RULES.regenFullMs)),
    mp: Math.min(maxMp, v.mp + Math.floor((maxMp * elapsed) / RULES.regenFullMs)),
  };
}

/** Aplica tentativas à skill com o custo da classe. */
export function trainSkill(
  cls: keyof typeof CLASSES,
  skill: SkillId,
  cur: { l: number; p: number },
  tries: number,
): { l: number; p: number } {
  const r = addSkillTries(cur.l, cur.p, tries, CLASSES[cls].skillCost10[skill]);
  return { l: r.level, p: r.progress };
}
