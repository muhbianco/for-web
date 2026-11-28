import type { AmmoGrade, RarityId } from "../content.ts";
import type { ItemInstance } from "../equipment.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";
import { isSupreme } from "../items/supreme.ts";

/**
 * O Mercador (spec §10): poções e munição por tier, equipamento Comum do tier e a compra de itens do
 * jogador por 10% do preço base. Preço sempre inteiro e pelo menos 1.
 */

/** Poções de vida e mana do tier do herói. */
export function potionPrice(
  level: number,
  B: Balance = gameBalance,
): { hp: number; mp: number } {
  return B.potionPrices(level);
}

/** Um pacote de munição do tier do herói (P15). */
export function ammoPackPrice(
  grade: AmmoGrade,
  level: number,
  B: Balance = gameBalance,
): { units: number; gold: number } {
  const m = B.cfg.merchant;
  const gold = B.lacaioGold(B.potionTierLevel(level));
  return {
    units: m.ammoPack,
    gold: Math.max(
      1,
      Math.ceil(m.ammoPackOfGold * gold * m.ammoGradeMult[grade]),
    ),
  };
}

/** Preço base de um item: o Comum do iL × a escada da raridade (P53). */
export function itemBasePrice(
  ilvl: number,
  rarity: RarityId,
  B: Balance = gameBalance,
): number {
  const m = B.cfg.merchant;
  return m.commonItemOfGold * B.lacaioGold(ilvl) * m.rarityPrice[rarity];
}

/** O que o Mercador cobra pelo equipamento Comum do tier do herói (o iL é o do tier). */
export function commonItemPrice(
  level: number,
  B: Balance = gameBalance,
): {
  ilvl: number;
  gold: number;
} {
  const ilvl = B.potionTierLevel(level);
  return { ilvl, gold: itemBasePrice(ilvl, "comum", B) };
}

/** O que o Mercador paga pelo item do jogador: 10% do preço base (o refino não entra). */
export function buyBackPrice(
  item: ItemInstance,
  B: Balance = gameBalance,
): number {
  // D68: a Suprema vale as lendárias que a forja consumiu.
  const n = isSupreme(item) ? B.cfg.supreme.inputs : 1;
  return Math.max(
    1,
    Math.floor(
      B.cfg.merchant.buyBackPct * itemBasePrice(item.ilvl, item.rarity, B) * n,
    ),
  );
}

/** Vender pede confirmação quando o item é refinado a partir do +7 (§9.8, P20). */
export function sellNeedsConfirm(
  item: ItemInstance,
  B: Balance = gameBalance,
): boolean {
  return item.refine >= B.cfg.bank.confirmRefineFrom;
}
