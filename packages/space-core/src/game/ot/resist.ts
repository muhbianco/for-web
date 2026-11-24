import type { Element, ItemDef } from "./items.ts";
import type { MonsterDef } from "./monsters.ts";

/**
 * Resistência física e resistência mágica (24/11/2026, decisão do dono: "o jogo vai ter
 * resistência física e resistência mágica. é isso"). O elemento continua no nome e no visual
 * (a chama, o gelo), mas o dano é de uma de duas classes: físico ou mágico. O herói não escolhe
 * a magia pelo monstro (o jogo é automático), então nenhum elemento é melhor ou pior que outro.
 *
 * Os números saem dos de antes, por elemento, sem reescrever os monstros e os itens:
 * - monstro: a física é a de antes; a mágica é a média nos seis elementos mágicos (com as
 *   fraquezas: um monstro das faixas, que resistia 50% ao elemento dele e era fraco 20% a
 *   outro, fica com 5%; um imune a fogo, com 17%);
 * - item: a física é a de antes; a mágica é metade da soma das proteções elementais, sem passar
 *   da maior delas, e o lado ruim some (os amuletos de +20% num elemento e -10% em outro
 *   protegem 10% de toda magia).
 */
export type DamageClass = "fisico" | "magia";

export const MAGIC_ELEMENTS: readonly Element[] = [
  "fogo",
  "gelo",
  "energia",
  "terra",
  "morte",
  "sagrado",
];

export function damageClass(el: Element | "cura"): DamageClass {
  return el === "fisico" || el === "cura" ? "fisico" : "magia";
}

const monsterCache = new WeakMap<object, { fisico: number; magia: number }>();

/** A resistência do monstro, em %, por classe de dano (negativa: dano a mais). */
export function monsterResist(m: Pick<MonsterDef, "elements">): {
  fisico: number;
  magia: number;
} {
  const hit = monsterCache.get(m);
  if (hit) return hit;
  const e = m.elements ?? {};
  let sum = 0;
  for (const el of MAGIC_ELEMENTS) sum += e[el] ?? 0;
  const out = {
    fisico: e.fisico ?? 0,
    magia: Math.round(sum / MAGIC_ELEMENTS.length),
  };
  monsterCache.set(m, out);
  return out;
}

/** A proteção de um item, em %, por classe de dano (só positiva na mágica). */
export function itemAbsorb(def: Pick<ItemDef, "absorb">): {
  fisico: number;
  magia: number;
} {
  const a = def.absorb ?? {};
  let sum = 0;
  let max = 0;
  for (const el of MAGIC_ELEMENTS) {
    const v = a[el] ?? 0;
    if (v <= 0) continue;
    sum += v;
    max = Math.max(max, v);
  }
  return { fisico: a.fisico ?? 0, magia: Math.min(max, Math.round(sum / 2)) };
}
