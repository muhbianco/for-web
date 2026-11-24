import { COINS, itemDef } from "./items.ts";
import { allTierItems } from "./tiers.ts";

/**
 * Os NPCs do jogo idle (docs/espaco/jogo/ot, etapa O8): o mercador, o banqueiro e o mestre
 * (desde 24/11/2026, o da evolução de classe). Ficam na sala como objetos da decoração; o herói fala com eles ao lado, como
 * no OT.
 */

export interface ShopOffer {
  item: string;
  /** Preço em moedas de ouro. */
  price: number;
}

/**
 * O que o mercador vende. Flecha 2, virote 3, arco 200, besta 360 e mochila 20 são os preços
 * dos NPCs do TFS (data/npc/Tyoric.xml, Riona.xml); o resto é nosso, na faixa do OT.
 */
export const MERCHANT_SELLS: readonly ShopOffer[] = [
  { item: "flecha", price: 2 },
  { item: "virote", price: 3 },
  { item: "flecha-afiada", price: 5 },
  { item: "virote-perfurante", price: 5 },
  // 24/11/2026: a munição das dungeons novas [nosso].
  { item: "flecha-de-aco", price: 8 },
  { item: "virote-de-guerra", price: 10 },
  // Poções (etapa O9) [nosso, na faixa de preço do OT].
  { item: "pocao-pequena-de-vida", price: 20 },
  { item: "pocao-de-vida", price: 50 },
  { item: "pocao-de-mana", price: 56 },
  { item: "pocao-forte-de-vida", price: 115 },
  { item: "pocao-forte-de-mana", price: 93 },
  // 24/11/2026: as dos levels altos [TFS great/ultimate, na faixa de preço do OT].
  { item: "pocao-grande-de-vida", price: 190 },
  { item: "pocao-suprema-de-vida", price: 310 },
  { item: "pocao-grande-de-mana", price: 120 },
  { item: "pocao-suprema-de-mana", price: 230 },
  { item: "bolsa", price: 4 },
  { item: "mochila", price: 20 },
  { item: "arco-de-caca", price: 200 },
  // 24/11/2026: o começo do kit do Ragnarok (o resto cai nas dungeons) [nosso].
  { item: "bandana", price: 150 },
  { item: "sandalias", price: 80 },
  { item: "chapeu-de-aprendiz", price: 120 },
  { item: "traje-de-aventureiro", price: 300 },
  { item: "besta-leve", price: 360 },
  { item: "amuleto-do-escudeiro", price: 700 },
  { item: "anel-do-folego", price: 900 },
  { item: "anel-do-gume", price: 500 },
  { item: "anel-do-lenhador", price: 500 },
  { item: "anel-do-martelo", price: 500 },
];

/**
 * A munição das faixas do 85 ao 500 (tiers.ts): o arqueiro gasta uma por tiro (perto de 200 numa
 * corrida), então ela não pode depender só do loot [nosso, 24/11/2026].
 */
const TIER_AMMO: readonly ShopOffer[] = allTierItems()
  .filter((d) => d.slot === "municao")
  .map((d) => ({ item: d.id, price: 4 + Math.floor((d.minLevel ?? 0) / 25) }));

/** Tudo o que o mercador vende: a lista e a munição das faixas. */
export const MERCHANT_OFFERS: readonly ShopOffer[] = [...MERCHANT_SELLS, ...TIER_AMMO];

export function merchantOffer(itemId: string): ShopOffer | undefined {
  return MERCHANT_OFFERS.find((o) => o.item === itemId);
}

/**
 * Quanto o mercador paga por um item: o valor dele (o loot e o kit); moedas ele não compra
 * [nosso: um mercador só para tudo, no lugar dos vários do OT].
 */
export function merchantBuys(itemId: string): number | null {
  if (COINS.includes(itemId)) return null;
  const def = itemDef(itemId);
  if (!def) return null;
  if (def.value > 0) return def.value;
  // [nosso] O que ele vende e não tem valor próprio (munição, poções, bolsa, mochila, o arco
  // do kit) ele compra de volta pela metade (para baixo): flecha 1, flecha afiada 2, mochila
  // 10, poção pequena de vida 10. No OT o NPC não compra munição; aqui quem comprou a errada
  // não fica com o ouro preso. Menos que o preço: não há lucro em girar.
  const half = Math.floor((merchantOffer(itemId)?.price ?? 0) / 2);
  return half > 0 ? half : null;
}

/** O custo de repor um item gasto (o analisador): o preço do mercador, senão o valor. */
export function supplyPrice(itemId: string): number {
  return merchantOffer(itemId)?.price ?? itemDef(itemId)?.value ?? 0;
}

// A promoção virou a evolução de classe (abilities.ts EVOLUTION, 24/11/2026).

/** Teto de um valor em ouro num comando (depósito, saque, transferência). */
export const MONEY_MAX = 1_000_000_000;
