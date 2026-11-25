import { type Balance, balance as gameBalance } from "./formulas.ts";

/**
 * O Dojô (spec §2): o boneco dá XP de Proficiência por segundo (10/s; +5% por outro herói treinando na
 * mesma sala, até +25%). A Proficiência guardada (b) sobe sem teto de nível até 5000; a efetiva é
 * limitada por `10·L + 250` nas fórmulas, e o excedente fica guardado até o herói subir.
 */

export interface DojoHero {
  /** Proficiência guardada (b). */
  proficiency: number;
  /** XP de Proficiência dentro do nível base atual. */
  proficiencyXp?: number;
}

export function trainDojo<H extends DojoHero>(
  hero: H,
  seconds: number,
  othersTraining: number,
  B: Balance = gameBalance,
): { hero: H & { proficiencyXp: number }; gained: number } {
  const max = B.cfg.levels.maxProficiency;
  let b = hero.proficiency;
  let xp =
    (hero.proficiencyXp ?? 0) +
    Math.max(0, seconds) * B.proficiencyXpPerSecond(othersTraining);
  while (b < max) {
    const need = B.proficiencyXpToNext(b);
    if (xp < need) break;
    xp -= need;
    b++;
  }
  // No teto, o XP para de contar.
  if (b >= max) xp = 0;
  return {
    hero: { ...hero, proficiency: b, proficiencyXp: xp },
    gained: b - hero.proficiency,
  };
}
