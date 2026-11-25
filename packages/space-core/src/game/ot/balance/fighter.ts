import type { FighterInput } from "./combat/types.ts";
import { CLASSES, FAMILIES } from "./content.ts";
import { type BalanceHero, UNARMED, heroDerived } from "./equipment.ts";
import { type Balance, balance as gameBalance } from "./formulas.ts";
import { legendaryMods } from "./items/legendary.ts";
import { type Reference, createReference } from "./reference.ts";
import { compileLoadout } from "./skills/compile.ts";
import type { HeroSkills } from "./skills/tree.ts";

/**
 * Do herói salvo ao lutador do motor: derivados (com o traço de Precisão do caçador), as skills dos
 * slots compiladas com os lendários, os traços da classe e as poções da faixa. É o mesmo caminho do
 * simulador, do auto-equipar e (na virada) da corrida de verdade.
 */
export function heroFighter(
  hero: BalanceHero,
  skills: HeroSkills,
  opts: {
    potions?: { hp: number; mp: number; stock: number };
    potionAt?: { hp: number; mp: number };
  } = {},
  B: Balance = gameBalance,
  R: Reference = createReference(B),
): FighterInput {
  const c = CLASSES[hero.cls];
  const fam = FAMILIES[hero.equipment.arma?.family ?? UNARMED];
  const d = heroDerived(hero, B);
  return {
    cls: hero.cls,
    role: c.role,
    stats: { ...d, hit: d.hit * (1 + (c.trait.hitBonusPct ?? 0)) },
    skills: compileLoadout(hero.cls, skills, B, legendaryMods(hero.equipment)),
    potencyRank: 1,
    lifesteal: c.trait.lifesteal ?? 0,
    blockBonus: c.trait.blockBonus ?? 0,
    healBonus: (c.trait.healBonus ?? 0) + (fam.healBonus ?? 0) + healPct(hero),
    hotBonus: c.trait.hotBonus ?? 0,
    poisonBonus: c.trait.poisonBonus ?? 0,
    magicAutoAttack: fam.magicAutoAttack ?? c.trait.magicAutoAttack ?? 0.6,
    potions: opts.potions ?? {
      hp: R.potionHp(hero.level),
      mp: R.potionMp(hero.level),
      stock: 100,
    },
    ...(opts.potionAt ? { potionAt: opts.potionAt } : {}),
  };
}

/** Afixos de +% cura causada no equipamento. */
function healPct(hero: BalanceHero): number {
  let n = 0;
  for (const it of Object.values(hero.equipment))
    for (const a of it?.affixes ?? []) if (a.id === "healPct") n += a.value;
  return n;
}
