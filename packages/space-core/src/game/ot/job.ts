import { expForLevel } from "./progression.ts";

/**
 * O nível de job (24/11/2026, pedido do dono: "vamos trazer mais um conceito do Ragnarok, nível
 * de herói e nível de job"). Cada corrida dá ao job uma fração da mesma experiência do level, na
 * mesma curva (progression.ts expForLevel): ele sobe mais devagar. É o job que dá os pontos de
 * habilidade da árvore, um por nível [RO: um ponto por nível de job], no lugar do dummy de
 * habilidade, que saiu.
 */
export const JOB = {
  /** A fração da experiência da corrida que vai para o job. */
  expShare: 0.3,
  /** O nível de job máximo de agora. */
  maxLevel: 150,
} as const;

/**
 * Cada renascimento da árvore deixa o job 1% mais lento, um sobre o outro (24/11/2026, pelo dono:
 * "cada reset precisa exigir 1% a mais de tempo"; antes valia para o dummy de habilidade).
 */
export const REBIRTH_TRAINING_PCT = 1;

export function rebirthScale(rebirths: number): number {
  return Math.pow(1 + REBIRTH_TRAINING_PCT / 100, Math.max(0, rebirths));
}

/** A experiência de job que uma corrida dá (a fração do job, menos a dos renascimentos). */
export function jobExpGain(exp: number, rebirths = 0): number {
  if (exp <= 0) return 0;
  return Math.floor((exp * JOB.expShare) / rebirthScale(rebirths));
}

/** O nível de job com esta experiência de job (a curva do level, até JOB.maxLevel). */
export function jobLevelFor(exp: number): number {
  let lo = 1;
  let hi = JOB.maxLevel;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (expForLevel(mid) <= exp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Pontos de habilidade que o nível de job deu: um por nível, a partir do 2. */
export function jobPoints(level: number): number {
  return Math.max(0, Math.min(JOB.maxLevel, level) - 1);
}

/** O job de um herói: o nível, a experiência e quanto falta para o próximo. */
export interface JobState {
  level: number;
  exp: number;
}

/** Soma experiência de job (já com a fração) e devolve o estado novo. */
export function addJobExp(j: JobState, gain: number): JobState {
  if (gain <= 0 || j.level >= JOB.maxLevel) return j;
  const exp = j.exp + gain;
  return { level: Math.max(j.level, jobLevelFor(exp)), exp };
}
