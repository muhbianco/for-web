import type { ItemInstance, WeaponItem } from "../equipment.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import type { RandomSource } from "./generate.ts";

/**
 * A Arma Suprema (D68, 27/11/2026, pedido do dono: "removemos o segundo perk e criamos a arma
 * suprema… criada com 5 armas iguais e do mesmo level no ferreiro… dá em média 15% a mais de poder, e
 * nela sim vem o segundo perk, que também pode ser roletado"):
 *   - receita: `supreme.inputs` armas Lendárias da mesma família e do mesmo iL, nenhuma Suprema;
 *   - a base escolhida fica (afixos, refino, nome, 1º perk); as outras são consumidas;
 *   - `power`: o a mais no dano base da arma (ATQ/MATQ), sorteado em `supreme.power` (média 15%);
 *   - 2 perks (o 2º sorteado na forja, e rolável no Ferreiro como o 1º).
 * Fora do limite (o perfil de calibragem continua o Lendário) e fora do drop: só sai da forja.
 */

/** O a mais de poder da arma (0 se não é Suprema). */
export function supremePower(item: ItemInstance | undefined): number {
  return item?.slot === "arma" && item.supreme ? item.supreme.power : 0;
}

export function isSupreme(item: ItemInstance | undefined): item is WeaponItem & { supreme: { power: number } } {
  return supremePower(item) > 0;
}

/** Quantos perks o item pode ter: 2 na Suprema, 1 no resto (o 2º perk saiu dos outros itens). */
export function perkCapOf(item: ItemInstance, B: Balance = gameBalance): number {
  return isSupreme(item) ? B.cfg.supreme.maxPerks : B.cfg.legendaryPerks.maxPerks;
}

/** O poder da forja: de `min` a `max` em passos de `step`, todos com a mesma chance. */
export function rollSupremePower(rng: RandomSource, B: Balance = gameBalance): number {
  const p = B.cfg.supreme.power;
  const steps = Math.round((p.max - p.min) / p.step);
  const k = Math.min(steps, Math.floor(rng.next() * (steps + 1)));
  return Math.round((p.min + k * p.step) * 1e6) / 1e6;
}

/** A arma serve de ingrediente: Lendária, não Suprema. */
export function supremeIngredient(item: ItemInstance): item is WeaponItem {
  return item.slot === "arma" && item.rarity === "lendario" && !isSupreme(item);
}

/** A chave do grupo da receita: família e iL ("espada@480"). */
export function supremeKey(item: WeaponItem): string {
  return `${item.family}@${item.ilvl}`;
}

export type SupremeError =
  | "suprema-quantidade"
  | "suprema-nao-lendaria"
  | "suprema-armas-diferentes";

/** Confere a receita: a base e as outras (já achadas), na ordem; `null` quando vale. */
export function supremeRecipeError(
  base: ItemInstance,
  others: readonly ItemInstance[],
  B: Balance = gameBalance,
): SupremeError | null {
  if (others.length !== B.cfg.supreme.inputs - 1) return "suprema-quantidade";
  if (!supremeIngredient(base)) return "suprema-nao-lendaria";
  for (const x of others) {
    if (!supremeIngredient(x)) return "suprema-nao-lendaria";
    if (supremeKey(x) !== supremeKey(base)) return "suprema-armas-diferentes";
  }
  return null;
}
