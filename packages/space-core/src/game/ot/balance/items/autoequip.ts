import { fight } from "../combat/fight.ts";
import { type GearSlot, CLASSES, FAMILIES } from "../content.ts";
import {
  type BalanceHero,
  type Equipment,
  type ItemInstance,
  cannotEquip,
  heroDerived,
  offhandMismatch,
} from "../equipment.ts";
import { heroFighter } from "../fighter.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { type Reference, createReference } from "../reference.ts";
import type { HeroSkills } from "../skills/tree.ts";

/**
 * "Escolher o melhor sozinho" (spec §9.8): compara itens com a mesma conta do combate, sem pesos à
 * parte — o próprio motor de luta mede o dano por segundo contra um alvo do nível do herói.
 * - DPS: dano por segundo.
 * - Tanque: 0,7 × HP efetivo + 0,3 × ameaça/s, normalizados pelo equipamento atual.
 * - Suporte: 0,7 × cura/s + 0,3 × HP efetivo, normalizados.
 * Colar e anel ficam de fora; item com refino ≥ +7 nunca sai do corpo sem confirmação.
 */

/** Os slots que o automático mexe, na ordem (a arma primeiro: ela decide a mão secundária). */
export const AUTO_SLOTS: GearSlot[] = [
  "arma",
  "secundaria",
  "armadura",
  "elmo",
  "calcas",
  "botas",
];

export const KEEP_REFINE_FROM = 7;
const SIM_SECONDS = 30;

export interface HeroScore {
  dps: number;
  threatPerSecond: number;
  effectiveHp: number;
  /** Cura/s é proporcional a MATQ × (1 + bônus de cura) com o mesmo kit. */
  healPower: number;
}

export function scoreHero(
  hero: BalanceHero,
  skills: HeroSkills,
  B: Balance = gameBalance,
  R: Reference = createReference(B),
): HeroScore {
  const f = heroFighter(hero, skills, {}, B, R);
  const r = fight(
    [f],
    [
      {
        archetype: "chefe",
        level: hero.level,
        hp: 1e15,
        autoRaw: 0,
        attacksPerSecond: 0.5,
      },
    ],
    { maxSeconds: SIM_SECONDS, mode: "esperado" },
    B,
  );
  const d = heroDerived(hero, B);
  const dps = r.damage / SIM_SECONDS;
  return {
    dps,
    threatPerSecond: dps * d.threat,
    effectiveHp: d.hp / (1 - B.heroPhysicalReduction(d.def, hero.level)),
    healPower: d.matk * (1 + (f.healBonus ?? 0)),
  };
}

/** Nota do papel, relativa ao herói como está (1 = igual). */
export function roleScore(
  role: "tanque" | "suporte" | "dps",
  s: HeroScore,
  base: HeroScore,
): number {
  const rel = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? 2 : 1);
  if (role === "dps") return rel(s.dps, base.dps);
  if (role === "tanque")
    return (
      0.7 * rel(s.effectiveHp, base.effectiveHp) +
      0.3 * rel(s.threatPerSecond, base.threatPerSecond)
    );
  return (
    0.7 * rel(s.healPower, base.healPower) +
    0.3 * rel(s.effectiveHp, base.effectiveHp)
  );
}

export interface AutoEquipResult {
  equipment: Equipment;
  /** O que trocou (o item que saiu volta para a mochila). */
  changes: { slot: GearSlot; from: ItemInstance | null; to: ItemInstance }[];
  /** Trocas melhores que esbarram num item +7 ou mais: só com o ok do jogador. */
  needsConfirmation: {
    slot: GearSlot;
    current: ItemInstance;
    candidate: ItemInstance;
  }[];
}

/** Com esta arma, a mão secundária de agora ainda cabe? */
function offhandFits(eq: Equipment): boolean {
  const off = eq.secundaria?.offhand;
  if (!off) return true;
  return offhandMismatch(off, eq.arma ? FAMILIES[eq.arma.family] : null) === null;
}

export function autoEquip(
  hero: BalanceHero,
  skills: HeroSkills,
  candidates: ItemInstance[],
  B: Balance = gameBalance,
): AutoEquipResult {
  const R = createReference(B);
  const role = CLASSES[hero.cls].role;
  let eq: Equipment = { ...hero.equipment };
  const changes: AutoEquipResult["changes"] = [];
  const needsConfirmation: AutoEquipResult["needsConfirmation"] = [];
  const used = new Set<ItemInstance>();

  for (const slot of AUTO_SLOTS) {
    const current =
      (eq as Record<string, ItemInstance | undefined>)[slot] ?? null;
    const now = { ...hero, equipment: eq };
    const base = scoreHero(now, skills, B, R);
    let best: { item: ItemInstance; eq: Equipment; score: number } | null =
      null;
    for (const item of candidates) {
      if (item.slot !== slot || used.has(item) || item === current) continue;
      const trialEq: Equipment = { ...eq, [slot]: item };
      if (slot === "arma" && !offhandFits(trialEq)) delete trialEq.secundaria;
      if (
        cannotEquip(
          { ...hero, equipment: { ...trialEq, [slot]: undefined } },
          item,
          B,
        )
      )
        continue;
      const score = roleScore(
        role,
        scoreHero({ ...hero, equipment: trialEq }, skills, B, R),
        base,
      );
      if (score > 1 + 1e-9 && (!best || score > best.score))
        best = { item, eq: trialEq, score };
    }
    if (!best) continue;
    if (current && current.refine >= KEEP_REFINE_FROM) {
      needsConfirmation.push({ slot, current, candidate: best.item });
      continue;
    }
    used.add(best.item);
    eq = best.eq;
    changes.push({ slot, from: current, to: best.item });
  }
  return { equipment: eq, changes, needsConfirmation };
}
