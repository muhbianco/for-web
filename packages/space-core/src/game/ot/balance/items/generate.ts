import {
  type AffixId,
  type ArmorSlot,
  type ArmorWeight,
  type FamilyId,
  type GearSlot,
  type OffhandId,
  type RarityId,
  AFFIX_IDS,
  AFFIXES,
  FAMILIES,
  JEWEL_EXTRA_AFFIXES,
  RARITIES,
  STATS,
} from "../content.ts";
import type { Affix, ItemInstance } from "../equipment.ts";
import { type Balance, balance as gameBalance } from "../formulas.ts";

/**
 * Geração de item (spec §9.4, §9.5 e §9.7): os afixos sorteados pelas regras de slot e raridade, o
 * material pela faixa de iL e o nome. O status base nunca é guardado: sai das fórmulas (equipment.ts).
 */

export interface RandomSource {
  next(): number;
}

/** §9.7: o material muda a cada 50 níveis de item; é também o minério da região. */
export const MATERIALS = [
  "Ferro",
  "Bronze",
  "Aço",
  "Prata",
  "Ouro Rúnico",
  "Obsidiana",
  "Coral Abissal",
  "Osso Ancestral",
  "Celestita",
  "Vazio",
] as const;
export type Material = (typeof MATERIALS)[number];

export function materialOf(ilvl: number): Material {
  const i = Math.min(
    MATERIALS.length - 1,
    Math.max(0, Math.floor((Math.max(1, ilvl) - 1) / 50)),
  );
  return MATERIALS[i]!;
}

/** §9.7: sufixo do afixo principal (o atributo de maior valor). */
export const AFFIX_SUFFIX: Record<(typeof STATS)[number], string> = {
  FOR: "do Touro",
  AGI: "da Raposa",
  VIT: "do Urso",
  INT: "da Coruja",
  DES: "do Falcão",
  SOR: "do Trevo",
};

const PIECE_NAME: Record<ArmorSlot, string> = {
  elmo: "Elmo",
  armadura: "Armadura",
  calcas: "Calças",
  botas: "Botas",
};
const OFFHAND_NAME: Record<OffhandId, string> = {
  escudo: "Escudo",
  focus: "Focus",
  aljava: "Aljava",
};

/** Quantos afixos o item traz: os da raridade, +1 em colar e anel (§9.3). */
export function affixCount(slot: GearSlot, rarity: RarityId): number {
  return (
    RARITIES[rarity].affixes +
    (slot === "colar" || slot === "anel" ? JEWEL_EXTRA_AFFIXES : 0)
  );
}

/** Afixos que podem sair no item (o "escudo" do §9.5 vale só para a mão secundária que é escudo). */
export function allowedAffixes(slot: GearSlot, offhand?: OffhandId): AffixId[] {
  return AFFIX_IDS.filter((id) => {
    const def = AFFIXES[id];
    if (!def.slots.includes(slot)) return false;
    if (slot === "secundaria" && def.scale === "pct" && offhand !== "escudo")
      return false;
    return true;
  });
}

/**
 * O valor nominal de um afixo no iL: atributo 1 + iL/40, rating 2 × isso; os de % sorteiam dentro da
 * faixa do §9.5. Atributo e rating rolam ±20% em volta do nominal (P47).
 */
export function rollAffixValue(
  id: AffixId,
  ilvl: number,
  rng: RandomSource,
  B: Balance = gameBalance,
): number {
  const def = AFFIXES[id];
  const roll = B.cfg.items.affixRoll;
  if (def.scale === "pct") {
    const min = def.min ?? 0;
    const max = def.max ?? min;
    return round4(min + (max - min) * rng.next());
  }
  const nominal =
    def.scale === "atributo" ? B.attributeAffix(ilvl) : B.ratingAffix(ilvl);
  return round2(nominal * (1 - roll + 2 * roll * rng.next()));
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** Sorteia `count` afixos distintos entre os permitidos no slot. */
export function rollAffixes(
  slot: GearSlot,
  ilvl: number,
  count: number,
  rng: RandomSource,
  offhand?: OffhandId,
  B: Balance = gameBalance,
): Affix[] {
  const pool = allowedAffixes(slot, offhand);
  const out: Affix[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const k = Math.floor(rng.next() * pool.length);
    const id = pool.splice(k, 1)[0]!;
    out.push({ id, value: rollAffixValue(id, ilvl, rng, B) });
  }
  return out;
}

export type ItemBase =
  | { slot: "arma"; family: FamilyId }
  | { slot: "secundaria"; offhand: OffhandId }
  | { slot: ArmorSlot; weight: ArmorWeight }
  | { slot: "colar" | "anel" };

/** Um item novo: base, iL e raridade escolhidos por quem gera (drop, mercador); afixos sorteados aqui. */
export function generateItem(
  base: ItemBase,
  ilvl: number,
  rarity: RarityId,
  rng: RandomSource,
  B: Balance = gameBalance,
): ItemInstance {
  const offhand = base.slot === "secundaria" ? base.offhand : undefined;
  const affixes = rollAffixes(
    base.slot,
    ilvl,
    affixCount(base.slot, rarity),
    rng,
    offhand,
    B,
  );
  return { ...base, ilvl, rarity, refine: 0, affixes } as ItemInstance;
}

/** §9.7: "<Família> de <Material>" + sufixo do afixo de atributo principal; lendário tem nome próprio. */
export function itemName(item: ItemInstance, legendaryName?: string): string {
  if (legendaryName) return legendaryName;
  let head: string;
  if (item.slot === "arma") head = FAMILIES[item.family].name;
  else if (item.slot === "secundaria") head = OFFHAND_NAME[item.offhand];
  else if (item.slot === "colar") head = "Colar";
  else if (item.slot === "anel") head = "Anel";
  else head = PIECE_NAME[item.slot];
  let main: Affix | undefined;
  for (const a of item.affixes)
    if (
      (STATS as readonly string[]).includes(a.id) &&
      (!main || a.value > main.value)
    )
      main = a;
  const suffix = main
    ? ` ${AFFIX_SUFFIX[main.id as (typeof STATS)[number]]}`
    : "";
  return `${head} de ${materialOf(item.ilvl)}${suffix}`;
}
