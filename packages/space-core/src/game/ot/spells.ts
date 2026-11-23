import type { VocationId } from "./data.ts";
import type { Element } from "./items.ts";

/**
 * Magias que o herói lança sozinho na dungeon (etapa O5). Os nomes são nossos; level, mana,
 * cooldown e fórmula são os das magias do TFS citadas em cada uma (data/scripts/spells).
 * As fórmulas têm o formato `level/5 + x·a + b`, com `x` o magic level, a skill × ataque
 * da arma, ou a skill de distância.
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
    };

export interface SpellDef {
  id: string;
  name: string;
  /** Cura em si, cura num companheiro, ou ataque no alvo do grupo. */
  kind: "cura" | "cura-outro" | "ataque";
  vocations: readonly VocationId[];
  level: number;
  mana: number;
  cooldownMs: number;
  element: Element | "cura";
  formula: SpellFormula;
  /** O golpe passa pela armadura do alvo [TFS COMBAT_PARAM_BLOCKARMOR]. */
  blockArmor?: boolean;
}

const ALL_BUT_KNIGHT: readonly VocationId[] = [1, 2, 3];
const MAGES: readonly VocationId[] = [1, 2];

export const SPELLS: readonly SpellDef[] = [
  // [TFS healing/magic_patch.lua] level 1, mana 6, magic level até 20.
  {
    id: "remendo",
    name: "Remendo",
    kind: "cura",
    vocations: ALL_BUT_KNIGHT,
    level: 1,
    mana: 6,
    cooldownMs: 1000,
    element: "cura",
    formula: { type: "magia", min: [0.6, 3], max: [1, 6], mlCap: 20 },
  },
  // [TFS healing/bruise_bane.lua] level 1, mana 10.
  {
    id: "atadura",
    name: "Atadura",
    kind: "cura",
    vocations: [4],
    level: 1,
    mana: 10,
    cooldownMs: 1000,
    element: "cura",
    formula: { type: "magia", min: [1.4, 8], max: [1.8, 11], mlCap: 20 },
  },
  // [TFS healing/light_healing.lua] level 8, mana 20.
  {
    id: "cura-leve",
    name: "Cura leve",
    kind: "cura",
    vocations: ALL_BUT_KNIGHT,
    level: 8,
    mana: 20,
    cooldownMs: 1000,
    element: "cura",
    formula: { type: "magia", min: [1.4, 8], max: [1.8, 11] },
  },
  // [TFS healing/wound_cleansing.lua] level 8, mana 40.
  {
    id: "fechar-feridas",
    name: "Fechar feridas",
    kind: "cura",
    vocations: [4],
    level: 8,
    mana: 40,
    cooldownMs: 1000,
    element: "cura",
    formula: { type: "magia", min: [4, 25], max: [8, 50] },
  },
  // [TFS attack/apprentice's_strike.lua] level 8, mana 6, fogo 10–20.
  {
    id: "fagulha",
    name: "Fagulha",
    kind: "ataque",
    vocations: MAGES,
    level: 8,
    mana: 6,
    cooldownMs: 2000,
    element: "fogo",
    formula: { type: "fixa", min: 10, max: 20 },
  },
  // [TFS attack/energy_strike.lua] level 12, mana 20.
  {
    id: "golpe-de-raio",
    name: "Golpe de raio",
    kind: "ataque",
    vocations: MAGES,
    level: 12,
    mana: 20,
    cooldownMs: 2000,
    element: "energia",
    formula: { type: "magia", min: [1.4, 8], max: [2.2, 14] },
  },
  // [TFS attack/brutal_strike.lua] level 16, mana 30, cooldown 6 s, bloqueado pela armadura.
  {
    id: "golpe-brutal",
    name: "Golpe brutal",
    kind: "ataque",
    vocations: [4],
    level: 16,
    mana: 30,
    cooldownMs: 6000,
    element: "fisico",
    formula: { type: "arma", min: [0.02, 4], max: [0.04, 9] },
    blockArmor: true,
  },
  // [TFS healing/heal_friend.lua] level 18, mana 120.
  {
    id: "cura-do-companheiro",
    name: "Cura do companheiro",
    kind: "cura-outro",
    vocations: [2],
    level: 18,
    mana: 120,
    cooldownMs: 1000,
    element: "cura",
    formula: { type: "magia", min: [6.3, 45], max: [14.4, 90] },
  },
  // [TFS healing/intense_healing.lua] level 20, mana 70.
  {
    id: "cura-intensa",
    name: "Cura intensa",
    kind: "cura",
    vocations: ALL_BUT_KNIGHT,
    level: 20,
    mana: 70,
    cooldownMs: 1000,
    element: "cura",
    formula: { type: "magia", min: [3.2, 20], max: [5.4, 40] },
  },
  // [TFS attack/ethereal_spear.lua] level 23, mana 25, bloqueada pela armadura.
  {
    id: "lanca-eterea",
    name: "Lança etérea",
    kind: "ataque",
    vocations: [3],
    level: 23,
    mana: 25,
    cooldownMs: 2000,
    element: "fisico",
    formula: { type: "distancia", min: [0.7, 0], max: [1, 5] },
    blockArmor: true,
  },
];

export function spellDef(id: string): SpellDef | undefined {
  return SPELLS.find((s) => s.id === id);
}

/** As magias que a vocação base já pode lançar no level. */
export function spellsFor(base: VocationId, level: number): SpellDef[] {
  return SPELLS.filter((s) => s.vocations.includes(base) && level >= s.level);
}

/**
 * Faixa da magia [TFS onGetFormulaValues]: a divisão do level é a do Lua (sem truncar) e o
 * valor vira inteiro ao entrar no combate.
 */
export function spellRange(
  s: SpellDef,
  hero: {
    level: number;
    magicLevel: number;
    weaponSkill: number;
    weaponAttack: number;
    distance: number;
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
  }
}
