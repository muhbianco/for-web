import type { ClassId } from "../content.ts";
import type { Equipment, ItemInstance } from "../equipment.ts";
import type { MechanicMod } from "../skills/schema.ts";
import type { ItemBase } from "./generate.ts";
import { type ItemPerk, JOB_XP_PERK, perkMods, perkText } from "./perks.ts";

/**
 * Lendários (spec §9.5): raridade Lendário com 3 afixos e um efeito único. O spec dá 8 exemplos
 * ("2 por classe e um por família"); os que faltam são conteúdo a definir (P49).
 *
 * Desde 27/11/2026 o efeito é um perk (items/perks.ts): o lendário cai com o perk de origem (o do
 * spec, abaixo) e o Ferreiro rola outro numa skill da classe de quem rola, com o tamanho na faixa
 * da skill; com Essência, ganha um 2º perk. O item guarda os perks rolados em `perks`; sem eles,
 * vale o de origem.
 */

export interface LegendaryDef {
  id: string;
  name: string;
  /** Classe que tira proveito (o item pode ser vestido por quem pode vestir a base). */
  cls: ClassId | null;
  base: ItemBase;
  /** O perk com que o lendário cai (o efeito do spec). */
  perk: ItemPerk;
}

export const LEGENDARIES: LegendaryDef[] = [
  {
    id: "machado-do-rugido",
    name: "Machado do Rugido",
    cls: "guerreiro",
    base: { slot: "arma", family: "machado" },
    perk: { skill: "grito-de-guerra", value: 0.8 },
  },
  {
    id: "egide-do-juramento",
    name: "Égide do Juramento",
    cls: "paladino",
    base: { slot: "secundaria", offhand: "escudo" },
    perk: { skill: "escudo-da-fe", value: 0.1 },
  },
  {
    id: "cajado-da-aurora",
    name: "Cajado da Aurora",
    cls: "padre",
    base: { slot: "arma", family: "cajado" },
    perk: { skill: "curar", value: 0.15 },
  },
  {
    id: "bastao-do-carvalho-velho",
    name: "Bastão do Carvalho Velho",
    cls: "druida",
    base: { slot: "arma", family: "bastao" },
    perk: { skill: "rejuvenescer", value: 1 },
  },
  {
    id: "cetro-das-cinzas",
    name: "Cetro das Cinzas",
    cls: "mago",
    base: { slot: "arma", family: "cetro" },
    perk: { skill: "explosao-de-fogo", value: 0.04 },
  },
  {
    id: "arco-do-vendaval",
    name: "Arco do Vendaval",
    cls: "cacador",
    base: { slot: "arma", family: "arco" },
    perk: { skill: "chuva-de-flechas", value: 0.2 },
  },
  {
    id: "katar-bicefalo",
    name: "Katar Bicéfalo",
    cls: "assassino",
    base: { slot: "arma", family: "katar" },
    perk: { skill: "emboscada", value: 0.5 },
  },
  {
    id: "coroa-do-mentor",
    name: "Coroa do Mentor",
    cls: null,
    base: { slot: "elmo", weight: "leve" },
    perk: { skill: JOB_XP_PERK, value: 0.05 },
  },
];

export function legendaryOf(item: ItemInstance): LegendaryDef | undefined {
  return item.legendary
    ? LEGENDARIES.find((l) => l.id === item.legendary)
    : undefined;
}

/** O texto do perk de origem do lendário (a lista de drops da TV). */
export function legendaryText(def: LegendaryDef): string {
  return perkText(def.perk) ?? "";
}

/** Os perks do item: os rolados no Ferreiro; sem eles, o de origem do lendário; fora do Lendário, nenhum. */
export function itemPerks(item: ItemInstance): ItemPerk[] {
  if (item.rarity !== "lendario") return [];
  if (item.perks) return item.perks;
  const def = legendaryOf(item);
  return def ? [def.perk] : [];
}

/** Os efeitos dos perks que o equipamento dá, por skill, para a compilação. */
export function legendaryMods(eq: Equipment): Record<string, MechanicMod[]> {
  const out: Record<string, MechanicMod[]> = {};
  for (const it of Object.values(eq) as (ItemInstance | undefined)[]) {
    if (!it) continue;
    for (const p of itemPerks(it)) {
      const mods = perkMods(p);
      if (mods.length > 0) (out[p.skill] ??= []).push(...mods);
    }
  }
  return out;
}

/** Bônus de XP de job somado do equipamento (o perk da Coroa do Mentor). */
export function jobXpBonus(eq: Equipment): number {
  let n = 0;
  for (const it of Object.values(eq) as (ItemInstance | undefined)[])
    for (const p of it ? itemPerks(it) : [])
      if (p.skill === JOB_XP_PERK) n += p.value;
  return n;
}
