/**
 * As fórmulas das magias do TFS (data/scripts/spells) que as habilidades usam (abilities.ts;
 * até 23/11/2026 eram as magias por level da etapa O5). Formato `level/5 + x·a + b`, com `x`
 * o magic level, a skill × ataque da arma, ou a skill de distância.
 */
export type SpellFormula =
  /** `level/5 + magicLevel·a + b` (o magic level pode ter teto, como no "magic patch"). */
  | {
      type: "magia";
      min: readonly [number, number];
      max: readonly [number, number];
      mlCap?: number;
    }
  /** Faixa fixa. */
  | { type: "fixa"; min: number; max: number }
  /** `level/5 + skill·ataque·a + b` com a arma na mão. */
  | {
      type: "arma";
      min: readonly [number, number];
      max: readonly [number, number];
    }
  /** `level/5 + distância·a + b`. */
  | {
      type: "distancia";
      min: readonly [number, number];
      max: readonly [number, number];
    }
  /**
   * 24/11/2026, o Arqueiro do Ragnarok: `min`–`max` vezes o tiro máximo do arco com a flecha
   * (o mesmo do ataque normal, run.ts). Sem arco e flecha, nada.
   */
  | { type: "tiro"; min: number; max: number };

/**
 * [nosso] A varinha no modelo do cavaleiro (24/11/2026, pedido do dono): o ataque normal do mago
 * cresce com o magic level, como a espada com a skill e o arco com a distância, e as magias são
 * a menor parte do dano (o renascimento cresce a árvore sem teto). A conta é a das magias do TFS
 * (`level/5 + magicLevel·a + b`), com o dano da varinha no lugar do `b`: no TFS a varinha é fixa.
 * Medido no level 60 de árvore cheia (scripts/rebirth-lab.ts): as magias ficam com 22% (druida) e
 * 26% (feiticeiro) do dano, antes 93–94%; 400 renascimentos dão ×1,25, antes ×2,0 a ×2,4.
 */
export const WAND_ML: [number, number] = [8.5, 10];

/** A faixa do tiro da varinha [nosso, ver WAND_ML]. */
export function wandRange(
  wand: { min: number; max: number },
  level: number,
  magicLevel: number,
): [number, number] {
  const l = level / 5;
  return [
    Math.trunc(l + magicLevel * WAND_ML[0] + wand.min),
    Math.trunc(l + magicLevel * WAND_ML[1] + wand.max),
  ];
}

/** Quanto tempo o desafio prende o monstro [TFS monster.cpp challengeCreature: 8000 ms]. */
export const CHALLENGE_FOCUS_MS = 8000;

/**
 * Faixa da magia [TFS onGetFormulaValues]: a divisão do level é a do Lua (sem truncar) e o
 * valor vira inteiro ao entrar no combate.
 */
export function spellRange(
  s: { formula: SpellFormula },
  hero: {
    level: number;
    magicLevel: number;
    weaponSkill: number;
    weaponAttack: number;
    distance: number;
    /** O tiro máximo do arco com a flecha (0: sem arco ou sem flecha). */
    rangedMax?: number;
  },
): [number, number] {
  const f = s.formula;
  const l = hero.level / 5;
  switch (f.type) {
    case "fixa":
      return [f.min, f.max];
    case "magia": {
      const ml = Math.min(hero.magicLevel, f.mlCap ?? Infinity);
      return [
        Math.trunc(l + ml * f.min[0] + f.min[1]),
        Math.trunc(l + ml * f.max[0] + f.max[1]),
      ];
    }
    case "arma": {
      const x = hero.weaponSkill * hero.weaponAttack;
      return [
        Math.trunc(l + x * f.min[0] + f.min[1]),
        Math.trunc(l + x * f.max[0] + f.max[1]),
      ];
    }
    case "distancia":
      return [
        Math.trunc(l + hero.distance * f.min[0] + f.min[1]),
        Math.trunc(l + hero.distance * f.max[0] + f.max[1]),
      ];
    case "tiro": {
      const m = hero.rangedMax ?? 0;
      return [Math.trunc(m * f.min), Math.trunc(m * f.max)];
    }
  }
}
