import { type Balance, balance as gameBalance } from "./formulas.ts";

/**
 * Subida de nível e de job (spec §2): o herói guarda o XP acumulado desde o nível 1; o nível e o job
 * saem dele. Os pontos de atributo e de habilidade não se guardam (vêm do nível e do job), e a
 * Proficiência guardada acima do teto se libera sozinha ao subir (`effectiveProficiency`).
 * A evolução de tier continua no Mestre: o job 20 não troca o tier sozinho.
 */

export interface HeroProgress {
  level: number;
  job: number;
  /** XP de nível acumulado desde o 1 (sem ele, o mínimo do nível). */
  xp?: number;
  /** XP de job acumulado desde o 1. */
  jobXp?: number;
}

export interface ProgressGain<H> {
  hero: H & { xp: number; jobXp: number };
  levelsGained: number;
  jobsGained: number;
}

/** Soma XP de nível e de job e sobe o que tiver de subir (até 500 e 150). */
export function gainXp<H extends HeroProgress>(
  hero: H,
  xp: number,
  jobXp: number,
  B: Balance = gameBalance,
): ProgressGain<H> {
  const lv = B.cfg.levels;
  const totalXp =
    Math.max(hero.xp ?? 0, B.xpTotalAt(hero.level)) + Math.max(0, xp);
  const totalJob =
    Math.max(hero.jobXp ?? 0, B.jobXpTotalAt(hero.job)) + Math.max(0, jobXp);
  // No teto, o XP para de contar (não sobra para depois).
  const xpCap = B.xpTotalAt(lv.maxLevel);
  const jobCap = B.jobXpTotalAt(lv.maxJob);
  const level = Math.max(hero.level, B.levelForXp(Math.min(totalXp, xpCap)));
  const job = Math.max(hero.job, B.jobForXp(Math.min(totalJob, jobCap)));
  return {
    hero: {
      ...hero,
      level,
      job,
      xp: Math.min(totalXp, xpCap),
      jobXp: Math.min(totalJob, jobCap),
    },
    levelsGained: level - hero.level,
    jobsGained: job - hero.job,
  };
}

/** Quanto falta para o próximo nível e quanto já foi (para a barra da tela). */
export function levelProgress(
  hero: HeroProgress,
  B: Balance = gameBalance,
): { into: number; need: number } {
  const base = B.xpTotalAt(hero.level);
  const xp = Math.max(hero.xp ?? 0, base);
  return { into: xp - base, need: B.xpToNext(hero.level) };
}
