import type { VocationId } from "./data.ts";
import { type ItemDef, canDrink, itemDef, potionDefs } from "./items.ts";
import type { RunEvent, RunFrame, SupplyRule } from "./run.ts";

/**
 * O cinto de poções da tela da dungeon (24/11/2026, "igual o Diablo"): quantas poções cada herói
 * tem a cada segundo da corrida e qual ele bebe a seguir. A corrida já foi calculada no
 * servidor (run.ts); isto só conta o que ela fez, com as mesmas regras de escolha.
 *
 * O registro que o app guarda é curto (os últimos acontecimentos): por isso o servidor manda a
 * contagem do segundo em que a pessoa chega (`potionsAt`), e o app segue com os quadros que
 * chegam depois (`applyPotionEvent`).
 */

export type PotionKind = "health" | "mana";

/** A contagem de um herói: poção → quantas. */
export type PotionCounts = Record<string, number>;

/** Uma poção bebe uma por vez [TFS config timeBetweenExActions = 1000], como em run.ts. */
export const POTION_COOLDOWN_MS = 1000;

const avg = (r: readonly [number, number]) => (r[0] + r[1]) / 2;

/** As poções de um tipo, da que menos cura para a que mais cura. */
export function potionSizes(kind: PotionKind): ItemDef[] {
  return potionDefs()
    .filter((d) => d.potion?.[kind])
    .sort((a, b) => avg(a.potion![kind]!) - avg(b.potion![kind]!));
}

/** Quantas de cada poção a mochila tem (o resto fica de fora). */
export function potionCounts(
  pack: readonly { item: string; count: number }[],
): PotionCounts {
  const out: PotionCounts = {};
  for (const x of pack)
    if (itemDef(x.item)?.potion) out[x.item] = (out[x.item] ?? 0) + x.count;
  return out;
}

/**
 * O que um acontecimento muda na contagem: a poção bebida sai (uma, mesmo a que cura vida e
 * mana e gera dois acontecimentos) e a que veio no loot entra. O que ficou no corpo não entra.
 */
export function applyPotionEvent(counts: PotionCounts[], ev: RunEvent): void {
  if (ev.k === "pocao") {
    const c = counts[ev.a];
    if (!c) return;
    if (ev.mana && itemDef(ev.item)?.potion?.health) return;
    c[ev.item] = Math.max(0, (c[ev.item] ?? 0) - 1);
    return;
  }
  if (ev.k === "loot") {
    const c = counts[ev.a];
    if (!c || !itemDef(ev.item)?.potion) return;
    c[ev.item] = (c[ev.item] ?? 0) + ev.n;
  }
}

/** A experiência crua que o abate deu a cada herói (a tela soma; belt.ts expAt). */
export function applyExpEvent(exp: number[], ev: RunEvent): void {
  if (ev.k !== "abate" || !ev.xp) return;
  for (let i = 0; i < exp.length; i++) exp[i]! += ev.xp[i] ?? 0;
}

/** A experiência crua de cada herói (de `n`) até o fim do quadro `sec`. */
export function expAt(
  n: number,
  frames: readonly RunFrame[],
  sec: number,
): number[] {
  const exp = Array.from({ length: n }, () => 0);
  const last = Math.min(sec, frames.length - 1);
  for (let i = 0; i <= last; i++)
    for (const ev of frames[i]!.e) applyExpEvent(exp, ev);
  return exp;
}

/** A contagem de cada herói no fim do quadro `sec` (o índice em `frames`; -1: o começo). */
export function potionsAt(
  heroes: readonly { inv: { pack: readonly { item: string; count: number }[] } }[],
  frames: readonly RunFrame[],
  sec: number,
): PotionCounts[] {
  const counts = heroes.map((h) => potionCounts(h.inv.pack));
  const last = Math.min(sec, frames.length - 1);
  for (let i = 0; i <= last; i++)
    for (const ev of frames[i]!.e) applyPotionEvent(counts, ev);
  return counts;
}

/**
 * A poção que o herói bebe a seguir, com a regra dele (run.ts pickPotion): a escolhida, ou a que
 * mais cura entre as que pode beber e ainda tem. null: nunca bebe, ou nenhuma serve.
 */
export function nextPotion(
  kind: PotionKind,
  counts: PotionCounts,
  rule: SupplyRule,
  base: VocationId,
  level: number,
): string | null {
  if (rule.below <= 0) return null;
  let best: ItemDef | null = null;
  for (const d of potionSizes(kind)) {
    if ((counts[d.id] ?? 0) <= 0) continue;
    if (rule.item && d.id !== rule.item) continue;
    if (!canDrink(d, base, level)) continue;
    // potionSizes vem em ordem: a última que serve é a que mais cura.
    best = d;
  }
  return best?.id ?? null;
}
