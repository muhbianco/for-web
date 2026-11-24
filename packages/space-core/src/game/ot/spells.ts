import { maxWeaponDamage } from "./combat.ts";

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
   * [nosso] 24/11/2026, à noite (pedido do dono: "a habilidade deveria pegar o dano base e bater
   * em cima"): `min`–`max` vezes o golpe normal do herói agora (normalHitRange: a arma, o arco
   * com a flecha, a varinha), com a mesma % dos atributos. Tudo o que fortalece o ataque normal
   * fortalece a habilidade junto.
   */
  | { type: "golpe"; min: number; max: number };

/**
 * [nosso] A varinha no modelo do cavaleiro (24/11/2026, pedido do dono): o ataque normal do mago
 * cresce com o magic level, como a espada com a skill e o arco com a distância, e as magias são
 * a menor parte do dano (o renascimento cresce a árvore sem teto). A conta é a das magias do TFS
 * (`level/5 + magicLevel·a + b`), com o dano da varinha no lugar do `b`: no TFS a varinha é fixa.
 * Desde a fórmula "golpe" (24/11/2026, à noite) as magias partem da varinha: o WAND_ML acerta o
 * dano total dos magos (o do level 27 no grupo completo igual ao de antes; era [8,5; 10] com as
 * magias fracas) e as recargas, a parte das magias (~55% no 27, mais no fim do jogo).
 */
export const WAND_ML: [number, number] = [3.9, 4.6];

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
    /** O golpe normal do herói agora, antes da % dos atributos (normalHitRange). */
    baseHit?: readonly [number, number];
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
    case "golpe": {
      const [lo, hi] = hero.baseHit ?? [0, 0];
      return [Math.trunc(lo * f.min), Math.trunc(hi * f.max)];
    }
  }
}

/** A base das habilidades de ataque (fórmula "golpe"): de onde sai o golpe normal do herói. */
export type NormalHitKind = "melee" | "ranged" | "wand";

export interface NormalHitInput {
  level: number;
  magicLevel: number;
  /** A classe de base: 1 feiticeiro, 2 druida, 3 arqueiro, 4 cavaleiro. */
  cls: number;
  /** Os multiplicadores da vocação [TFS vocations.xml meleeDamage/distDamage]. */
  meleeDamage: number;
  distDamage: number;
  /** A arma na mão (null: punhos) e o fator do refino dela. */
  weapon: { kind?: string; attack?: number; wand?: { min: number; max: number } } | null;
  refine: number;
  /** O ataque da flecha que o arco atira agora (null: sem flecha que sirva). */
  ammoAttack: number | null;
  skills: Readonly<Record<"punhos" | "espada" | "machado" | "maca" | "distancia", number>>;
  /** O golpe não sai abaixo desta fração do máximo (a DES, attributes.ts minRoll). */
  minRoll: number;
  /** O fator do modo de luta [TFS ATTACK_FACTOR]. */
  attackFactor: number;
}

/**
 * [nosso] O golpe normal do herói agora, antes da % dos atributos, como a corrida o rola
 * (run.ts heroWeaponAttack): a base das habilidades de ataque. Os magos partem sempre da
 * varinha (sem ela, a conta dela sem o dano da arma, para a magia seguir o magic level); o
 * arqueiro, do arco com a flecha; sem isso, a arma corpo a corpo ou os punhos.
 */
export function normalHitRange(x: NormalHitInput): { lo: number; hi: number; kind: NormalHitKind } {
  const w = x.weapon;
  if (x.cls === 1 || x.cls === 2) {
    const wand = w?.kind === "varinha" && w.wand ? w.wand : null;
    const [a, b] = wandRange(wand ?? { min: 0, max: 0 }, x.level, x.magicLevel);
    const k = wand ? x.refine : 1;
    return { lo: Math.trunc(a * k), hi: Math.trunc(b * k), kind: "wand" };
  }
  if (w?.kind === "distancia" && x.ammoAttack !== null) {
    const hi = Math.trunc(
      maxWeaponDamage(x.level, x.skills.distancia, x.ammoAttack + (w.attack ?? 0), x.attackFactor) *
        x.distDamage *
        x.refine,
    );
    // [TFS weapons.cpp:827-836] mínimo `ceil(level × 0,2)` contra monstro, e a DES sobe o mínimo.
    const lo = Math.min(hi, Math.max(Math.ceil(x.level * 0.2), Math.floor(hi * x.minRoll)));
    return { lo, hi, kind: "ranged" };
  }
  const melee = w && (w.kind === "espada" || w.kind === "machado" || w.kind === "maca") ? w : null;
  const skill = melee ? x.skills[melee.kind as "espada" | "machado" | "maca"] : x.skills.punhos;
  const attack = melee ? (melee.attack ?? 7) : 7;
  const hi = Math.trunc(maxWeaponDamage(x.level, skill, attack, x.attackFactor) * x.meleeDamage * (melee ? x.refine : 1));
  return { lo: Math.min(hi, Math.floor(hi * x.minRoll)), hi, kind: "melee" };
}
