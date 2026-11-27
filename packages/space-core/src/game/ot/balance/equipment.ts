import {
  type AffixId,
  type AmmoGrade,
  type ArmorSlot,
  type ArmorWeight,
  type ClassId,
  type FamilyDef,
  type FamilyId,
  type OffhandId,
  type RarityId,
  type Stats,
  AFFIXES,
  AMMO_GRADES,
  ARMOR_SLOTS,
  ARMOR_WEIGHTS,
  CLASSES,
  FAMILIES,
  STATS,
} from "./content.ts";
import {
  type Balance,
  type GearBonus,
  type HeroLoadout,
  type HeroStats,
  balance as gameBalance,
} from "./formulas.ts";
import type { ItemPerk } from "./items/perks.ts";

/**
 * O item instanciado (spec §9) e o herói da engine nova: o que vai salvo e o caminho até os derivados.
 * O item guarda só o que o define (família ou peso, iL, raridade, refino, afixos); o status base sai
 * das fórmulas toda vez (§0.2). Geração, drop, refino no Ferreiro e auto-equipar entram na Fase 5.
 */

/** Um afixo já rolado: atributo e rating em número absoluto; `pct` em fração (0,03 = 3%). */
export interface Affix {
  id: AffixId;
  value: number;
}

interface ItemCommon {
  ilvl: number;
  rarity: RarityId;
  refine: number;
  affixes: Affix[];
  /** Lendário com efeito único (items/legendary.ts). */
  legendary?: string;
  /** Os perks rolados no Ferreiro (items/perks.ts); sem eles, vale o de origem do lendário. */
  perks?: ItemPerk[];
}

export interface WeaponItem extends ItemCommon {
  slot: "arma";
  family: FamilyId;
}

export interface OffhandItem extends ItemCommon {
  slot: "secundaria";
  offhand: OffhandId;
}

export interface ArmorItem extends ItemCommon {
  slot: ArmorSlot;
  weight: ArmorWeight;
}

export interface JewelItem extends ItemCommon {
  slot: "colar" | "anel";
}

export type ItemInstance = WeaponItem | OffhandItem | ArmorItem | JewelItem;

export interface Equipment {
  arma?: WeaponItem;
  secundaria?: OffhandItem;
  elmo?: ArmorItem;
  armadura?: ArmorItem;
  calcas?: ArmorItem;
  botas?: ArmorItem;
  colar?: JewelItem;
  anel?: JewelItem;
}

/** O herói da engine nova: só o que não se deriva. */
export interface BalanceHero {
  cls: ClassId;
  level: number;
  job: number;
  /** Proficiência guardada (o nível base do Dojô); a efetiva é limitada pelo nível. */
  proficiency: number;
  /** Atributos de pontos (começam em 1). Os afixos somam por cima, nos derivados. */
  attrs: Stats;
  equipment: Equipment;
  ammo?: AmmoGrade;
  /** Quantas vezes já redistribuiu os atributos no Mestre (a 1ª é grátis; D25). */
  attrResets?: number;
  /** XP de nível e de job acumulados desde o 1 (progress.ts). */
  xp?: number;
  jobXp?: number;
}

/**
 * Sem arma, o herói bate como uma espada de base 0 (o spec não tem punhos): só o status de
 * atributos e nível entra no ATQ.
 */
export const UNARMED: FamilyId = "espada";

export type EquipError =
  | "classe-nao-usa"
  | "peso-acima-da-classe"
  | "nivel-baixo"
  | "duas-maos-com-escudo"
  | "focus-sem-arma-magica-de-uma-mao"
  | "aljava-sem-arma-de-distancia"
  | "punhal-sem-arma-de-uma-mao"
  | "slot-errado";

/**
 * Como a classe veste um peso de armadura (§9.3; 27/11/2026): "natural" é o dela ou mais leve;
 * "acima" é um peso acima, com penalidade (`overweightHaste`/`overweightCooldown` por peça); null
 * não veste.
 */
export function armorFit(
  cls: ClassId,
  weight: ArmorWeight,
): "natural" | "acima" | null {
  const d =
    ARMOR_WEIGHTS.indexOf(weight) - ARMOR_WEIGHTS.indexOf(CLASSES[cls].armor);
  return d <= 0 ? "natural" : d === 1 ? "acima" : null;
}

/** Peso de armadura que a classe pode vestir: o dela, os mais leves e um acima (com penalidade). */
export function canWearWeight(cls: ClassId, weight: ArmorWeight): boolean {
  return armorFit(cls, weight) !== null;
}

/**
 * A mão secundária combina com a arma (§9.1)? A regra é uma só para vestir a arma, vestir a mão
 * secundária e o "escolher o melhor sozinho": escudo com arma de uma mão (ou nenhuma); focus com
 * arma mágica de uma mão; aljava com arco ou besta; punhal com arma corpo a corpo de uma mão.
 */
export function offhandMismatch(
  off: OffhandId,
  w: FamilyDef | null,
): EquipError | null {
  switch (off) {
    case "escudo":
      return w?.hands === 2 ? "duas-maos-com-escudo" : null;
    case "focus":
      return w && w.kind === "magic" && w.hands === 1
        ? null
        : "focus-sem-arma-magica-de-uma-mao";
    case "aljava":
      return w?.kind === "ranged" ? null : "aljava-sem-arma-de-distancia";
    case "punhal":
      return w && w.kind === "melee" && w.hands === 1
        ? null
        : "punhal-sem-arma-de-uma-mao";
  }
}

/**
 * Por que este item não pode ir neste slot do herói (null = pode). Confere classe, peso, requisito de
 * nível e a combinação de mãos com o que já está vestido.
 */
export function cannotEquip(
  hero: BalanceHero,
  item: ItemInstance,
  B: Balance = gameBalance,
): EquipError | null {
  const cls = CLASSES[hero.cls];
  if (!B.canEquip(hero.level, item.ilvl)) return "nivel-baixo";
  switch (item.slot) {
    case "arma": {
      if (!cls.weapons.includes(item.family)) return "classe-nao-usa";
      const off = hero.equipment.secundaria?.offhand;
      return off ? offhandMismatch(off, FAMILIES[item.family]) : null;
    }
    case "secundaria": {
      if (!cls.offhands.includes(item.offhand)) return "classe-nao-usa";
      const w = hero.equipment.arma
        ? FAMILIES[hero.equipment.arma.family]
        : null;
      return offhandMismatch(item.offhand, w);
    }
    case "colar":
    case "anel":
      return null;
    default:
      if (!(ARMOR_SLOTS as readonly string[]).includes(item.slot))
        return "slot-errado";
      return canWearWeight(hero.cls, item.weight)
        ? null
        : "peso-acima-da-classe";
  }
}

function equippedItems(eq: Equipment): ItemInstance[] {
  const out: ItemInstance[] = [];
  for (const it of Object.values(eq)) if (it) out.push(it as ItemInstance);
  return out;
}

/** Soma os afixos de tudo o que está vestido: atributos à parte, o resto no formato dos derivados. */
export function affixTotals(eq: Equipment): {
  attrs: Stats;
  bonus: GearBonus;
} {
  const attrs: Stats = { FOR: 0, AGI: 0, VIT: 0, INT: 0, DES: 0, SOR: 0 };
  const bonus: Required<GearBonus> = {
    hpPct: 0,
    mpPct: 0,
    atkPct: 0,
    matkPct: 0,
    defPct: 0,
    mdefPct: 0,
    hit: 0,
    flee: 0,
    critRating: 0,
    critMultPct: 0,
    hastePct: 0,
    cooldownPct: 0,
    healPct: 0,
    effectResPct: 0,
  };
  for (const it of equippedItems(eq))
    for (const a of it.affixes) {
      if (!(a.id in AFFIXES)) continue;
      if ((STATS as readonly string[]).includes(a.id))
        attrs[a.id as keyof Stats] += a.value;
      else bonus[a.id as keyof GearBonus] += a.value;
    }
  return { attrs, bonus };
}

/** Do herói salvo ao que as fórmulas pedem (§4.2). */
export function heroLoadout(
  hero: BalanceHero,
  B: Balance = gameBalance,
): HeroLoadout {
  const eq = hero.equipment;
  const { attrs: gearAttrs, bonus } = affixTotals(eq);
  const attrs = { ...hero.attrs };
  for (const s of STATS) attrs[s] += gearAttrs[s];

  const weapon = eq.arma;
  const family = weapon?.family ?? UNARMED;
  const weaponBase = weapon
    ? B.weaponBaseValue(weapon.ilvl) *
      B.rarityMult(weapon.rarity) *
      B.refineMult(weapon.refine, true)
    : 0;

  const off = eq.secundaria;
  const shieldDef =
    off?.offhand === "escudo"
      ? B.shieldDefValue(off.ilvl) *
        B.rarityMult(off.rarity) *
        B.refineMult(off.refine, false)
      : 0;

  let armorDef = 0;
  let armorMdef = 0;
  let overweight = 0;
  for (const slot of ARMOR_SLOTS) {
    const piece = eq[slot];
    if (!piece) continue;
    if (armorFit(hero.cls, piece.weight) === "acima") overweight++;
    const mult = B.rarityMult(piece.rarity) * B.refineMult(piece.refine, false);
    armorDef += B.armorDefPiece(piece.ilvl, slot, piece.weight) * mult;
    armorMdef += B.armorMdefPiece(piece.ilvl, slot, piece.weight) * mult;
  }

  return {
    cls: CLASSES[hero.cls],
    level: hero.level,
    attrs,
    proficiency: hero.proficiency,
    family,
    weaponBase,
    offhand: off?.offhand ?? null,
    shieldDef,
    armorDef,
    armorMdef,
    ammoPct: hero.ammo ? AMMO_GRADES[hero.ammo] : 0,
    overweight,
    bonus,
  };
}

/** Os derivados do herói: sempre recalculados, nunca salvos. */
export function heroDerived(
  hero: BalanceHero,
  B: Balance = gameBalance,
): HeroStats {
  return B.heroStats(heroLoadout(hero, B));
}
