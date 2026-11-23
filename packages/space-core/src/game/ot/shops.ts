import { type VocationId, VOCATIONS } from "./data.ts";
import { COINS, itemDef } from "./items.ts";

/**
 * Os NPCs do jogo idle (docs/espaco/jogo/ot, etapa O8): o mercador, o banqueiro e o mestre
 * das vocações. Ficam na sala como objetos da decoração; o herói fala com eles ao lado, como
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
  // Poções (etapa O9) [nosso, na faixa de preço do OT].
  { item: "pocao-pequena-de-vida", price: 20 },
  { item: "pocao-de-vida", price: 50 },
  { item: "pocao-de-mana", price: 56 },
  { item: "pocao-forte-de-vida", price: 115 },
  { item: "pocao-forte-de-mana", price: 93 },
  { item: "bolsa", price: 4 },
  { item: "mochila", price: 20 },
  { item: "arco-de-caca", price: 200 },
  { item: "besta-leve", price: 360 },
  { item: "amuleto-do-escudeiro", price: 700 },
  { item: "anel-do-folego", price: 900 },
  { item: "anel-do-gume", price: 500 },
  { item: "anel-do-lenhador", price: 500 },
  { item: "anel-do-martelo", price: 500 },
];

export function merchantOffer(itemId: string): ShopOffer | undefined {
  return MERCHANT_SELLS.find((o) => o.item === itemId);
}

/**
 * Quanto o mercador paga por um item: o valor dele; moedas e o que não tem valor (o kit, a
 * munição) ele não compra [nosso: um mercador só para tudo, no lugar dos vários do OT].
 */
export function merchantBuys(itemId: string): number | null {
  if (COINS.includes(itemId)) return null;
  const def = itemDef(itemId);
  const v = def?.value ?? 0;
  if (v > 0) return v;
  // [nosso] A munição que ele vende, ele compra de volta pela metade (para baixo): flecha 1,
  // virote 1, flecha afiada e virote perfurante 2. No OT o NPC não compra munição; aqui quem
  // comprou a do level errado não fica com o ouro preso. Menos que o preço: não há lucro em girar.
  if (def?.slot === "municao") {
    const half = Math.floor((merchantOffer(itemId)?.price ?? 0) / 2);
    if (half > 0) return half;
  }
  return null;
}

/** O custo de repor um item gasto (o analisador): o preço do mercador, senão o valor. */
export function supplyPrice(itemId: string): number {
  return merchantOffer(itemId)?.price ?? itemDef(itemId)?.value ?? 0;
}

/** Promoção [TFS data/npc/scripts/promotion.lua: level 20, 20.000 de ouro]. */
export const PROMOTION = { level: 20, cost: 20_000 } as const;

/** Por que não pode promover: sem vocação, já promovido, level; null: pode. */
export function cannotPromote(
  vocation: VocationId,
  level: number,
): "no_vocation" | "promoted" | "level" | null {
  if (vocation === 0) return "no_vocation";
  if (VOCATIONS[vocation].promotion === null) return "promoted";
  if (level < PROMOTION.level) return "level";
  return null;
}

/** Teto de um valor em ouro num comando (depósito, saque, transferência). */
export const MONEY_MAX = 1_000_000_000;
