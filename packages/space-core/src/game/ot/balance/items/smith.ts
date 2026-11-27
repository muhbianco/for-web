import type { RarityId } from "../content.ts";
import type { ItemInstance } from "../equipment.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import {
  type Material,
  type RandomSource,
  affixCount,
  materialOf,
  rollAffixes,
} from "./generate.ts";

/**
 * O Ferreiro (spec §9.6 e §10), com a regra do spec inteira (decisão do dono de 25/11/2026, D3):
 * refina arma, armadura e escudo; até o +4 é certo; a falha do +5 ao +7 perde só o ouro e o minério;
 * do +8 ao +10 a falha também derruba 1 nível, a não ser que se gaste uma Pedra de Proteção. Nunca
 * destrói o item. Reforjar sorteia os afixos de novo; desmontar vira minério.
 */

export interface RefineCost {
  gold: number;
  ore: { material: Material; count: number };
}

/** Refina? Arma, as 4 peças de armadura e a mão secundária quando é escudo. */
export function refinable(item: ItemInstance): boolean {
  if (item.slot === "colar" || item.slot === "anel") return false;
  if (item.slot === "secundaria") return item.offhand === "escudo";
  return true;
}

/** Custo da tentativa de levar o item de `refine` para `refine + 1`. */
export function refineCostOf(
  item: ItemInstance,
  B: Balance = gameBalance,
): RefineCost | null {
  if (!refinable(item) || item.refine >= B.cfg.refine.max) return null;
  const c = B.refineCost(item.ilvl, item.refine + 1);
  return {
    gold: c.gold,
    ore: { material: materialOf(item.ilvl), count: c.ore },
  };
}

/**
 * A Pedra de Proteção serve nesta tentativa? Só quando a falha derrubaria o nível (P48). Fora disso o
 * pedido de proteger é ignorado: nem gasta, nem exige ter pedra (26/11/2026, o pedido ficava preso
 * de um item para outro e travava o refino com "sem pedra").
 */
export function stoneMatters(
  item: ItemInstance,
  B: Balance = gameBalance,
): boolean {
  return (
    refineCostOf(item, B) !== null && B.refineFailure(item.refine) === "cai"
  );
}

export type RefineOutcome =
  | { kind: "subiu"; item: ItemInstance }
  | { kind: "falhou"; item: ItemInstance }
  | { kind: "caiu"; item: ItemInstance }
  | { kind: "protegido"; item: ItemInstance };

export type RefineError = "nao-refinavel" | "no-maximo" | "sem-pedra";

/**
 * Uma tentativa. Quem chama já cobrou o custo (refineCostOf) e, se `protect`, a Pedra de Proteção.
 * A Pedra só faz diferença quando a falha derrubaria o nível; antes disso ela não é gasta (P48).
 */
export function refineAttempt(
  item: ItemInstance,
  rng: RandomSource,
  opts: { protect?: boolean } = {},
  B: Balance = gameBalance,
):
  | { ok: true; outcome: RefineOutcome; stoneUsed: boolean }
  | { ok: false; error: RefineError } {
  if (!refinable(item)) return { ok: false, error: "nao-refinavel" };
  if (item.refine >= B.cfg.refine.max) return { ok: false, error: "no-maximo" };
  const chance = B.refineChance(item.refine);
  if (rng.next() < chance)
    return {
      ok: true,
      outcome: { kind: "subiu", item: { ...item, refine: item.refine + 1 } },
      stoneUsed: false,
    };
  if (B.refineFailure(item.refine) === "custo")
    return { ok: true, outcome: { kind: "falhou", item }, stoneUsed: false };
  if (opts.protect)
    return { ok: true, outcome: { kind: "protegido", item }, stoneUsed: true };
  return {
    ok: true,
    outcome: { kind: "caiu", item: { ...item, refine: item.refine - 1 } },
    stoneUsed: false,
  };
}

/** Reforjar: sorteia os afixos de novo, mantendo raridade, refino e o efeito lendário. */
export function reforgeCost(
  item: ItemInstance,
  B: Balance = gameBalance,
): RefineCost {
  return {
    gold: 30 * B.lacaioGold(item.ilvl),
    ore: { material: materialOf(item.ilvl), count: 5 },
  };
}

export function reforge(
  item: ItemInstance,
  rng: RandomSource,
  B: Balance = gameBalance,
): ItemInstance {
  const offhand = item.slot === "secundaria" ? item.offhand : undefined;
  const affixes = rollAffixes(
    item.slot,
    item.ilvl,
    affixCount(item.slot, item.rarity),
    rng,
    offhand,
    B,
  );
  return { ...item, affixes };
}

/**
 * §10: desmontar → minérios da região (Comum 1, Incomum 2, Raro 4, Épico 8, Lendário 16) e, do
 * lendário, Essência (`legendaryPerks.dismantleEssence`: 2 desde 27/11/2026; o spec dava 1).
 */
const DISMANTLE: Record<RarityId, number> = {
  comum: 1,
  incomum: 2,
  raro: 4,
  epico: 8,
  lendario: 16,
};

export function dismantle(
  item: ItemInstance,
  B: Balance = gameBalance,
): {
  ore: { material: Material; count: number };
  essence: number;
} {
  return {
    ore: { material: materialOf(item.ilvl), count: DISMANTLE[item.rarity] },
    essence:
      item.rarity === "lendario" ? B.cfg.legendaryPerks.dismantleEssence : 0,
  };
}
