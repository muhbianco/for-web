import type { Rng } from "../rng.ts";

/** Chance máxima de loot, em 1/100.000 [TFS monsters.h:13]. */
export const MAX_LOOTCHANCE = 100_000;

export interface LootEntry {
  item: string;
  /** Chance em 1/100.000 [TFS ficha do monstro, `chance`]. */
  chance: number;
  /** Quantidade máxima, para itens empilháveis [TFS `countmax`]. */
  countMax: number;
  stackable: boolean;
}

/**
 * Um sorteio de loot [TFS data/global.lua:91-93, data/lib/core/container.lua:5-20]:
 * `r = aleatório(0, 100.000) / rateLoot`; o item cai se `r < chance`. Empilhável: quantidade
 * `r % countMax + 1` (o Lua faz o resto em ponto flutuante e o item é criado com a parte
 * inteira, o que dá o mesmo que usar a parte inteira de `r`).
 */
export function rollLoot(rng: Rng, e: LootEntry, rateLoot: number): number {
  const r = rng.int(0, MAX_LOOTCHANCE) / rateLoot;
  if (!(r < e.chance)) return 0;
  return e.stackable ? (Math.floor(r) % Math.max(1, e.countMax)) + 1 : 1;
}
