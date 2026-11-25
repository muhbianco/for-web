import {
  type AffixId,
  type AmmoGrade,
  type ArmorSlot,
  type ArmorWeight,
  type ClassId,
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
  | "slot-errado";

/** Peso de armadura que a classe pode vestir: o dela ou mais leve (§9.3). */
export function canWearWeight(cls: ClassId, weight: ArmorWeight): boolean {
  return (
    ARMOR_WEIGHTS.indexOf(weight) <= ARMOR_WEIGHTS.indexOf(CLASSES[cls].armor)
  );
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
      const fam = FAMILIES[item.family];
      if (off === "escudo" && fam.hands === 2) return "duas-maos-com-escudo";
      if (off === "focus" && !(fam.kind === "magic" && fam.hands === 1))
        return "focus-sem-arma-magica-de-uma-mao";
      if (off === "aljava" && fam.kind !== "ranged")
        return "aljava-sem-arma-de-distancia";
      return null;
    }
    case "secundaria": {
      if (!cls.offhands.includes(item.offhand)) return "classe-nao-usa";
      const w = hero.equipment.arma
        ? FAMILIES[hero.equipment.arma.family]
        : null;
      if (item.offhand === "escudo" && w?.hands === 2)
        return "duas-maos-com-escudo";
      if (item.offhand === "focus" && !(w?.kind === "magic" && w.hands === 1))
        return "focus-sem-arma-magica-de-uma-mao";
      if (item.offhand === "aljava" && w?.kind !== "ranged")
        return "aljava-sem-arma-de-distancia";
      return null;
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
  for (const slot of ARMOR_SLOTS) {
    const piece = eq[slot];
    if (!piece) continue;
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
