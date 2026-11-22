import { type Attr, ATTRS, CLASSES, type ClassId, type SkillId, type Slot, type WeaponType, WEAPONS } from "./data.ts";
import { isWeaponType, type Item } from "./items.ts";

/** O que as regras precisam do herói (o documento do servidor tem mais coisa). */
export interface HeroCore {
  cls: ClassId;
  level: number;
  skills: Record<SkillId, { l: number; p: number }>;
  gear: Partial<Record<Slot, Item>>;
}

/**
 * Status de luta derivados, calculados pelo servidor na hora de lutar. É isto
 * (e não o herói inteiro) que vai para o app na `game.fight`.
 */
export interface HeroCombat {
  cls: ClassId;
  level: number;
  maxHp: number;
  maxMp: number;
  /** Mana por segundo em luta, em décimos. */
  mpRegen10: number;
  weapon: WeaponType;
  /** Skill da arma equipada. */
  skill: number;
  magic: number;
  shield: number;
  atk: number;
  armor: number;
  attrs: Record<Attr, number>;
  critBp: number;
  speedPct: number;
  blockBp: number;
  dodgeBp: number;
}

export const CRIT_BASE_BP = 500;
export const BLOCK_CAP_BP = 4500;
export const DODGE_CAP_BP = 3000;

export function heroCombat(h: HeroCore): HeroCombat {
  const c = CLASSES[h.cls];
  const attrs = {} as Record<Attr, number>;
  for (const a of ATTRS) attrs[a] = Math.floor((c.attr10[a] * h.level) / 10);
  let atk = 0;
  let armor = 0;
  let critBp = CRIT_BASE_BP;
  let speedPct = 0;
  let hp = 0;
  let mp = 0;
  let blockBp = 0;
  for (const it of Object.values(h.gear)) {
    if (!it) continue;
    atk += it.atk;
    armor += it.armor;
    critBp += it.critBp;
    speedPct += it.speedPct;
    hp += it.hp;
    mp += it.mp;
    blockBp += it.blockBp;
    for (const a of ATTRS) attrs[a] += it.attrs[a] ?? 0;
  }
  const wt = h.gear.arma?.type;
  const weapon = isWeaponType(wt) ? wt : c.starter;
  const shield = h.skills.escudo.l;
  critBp += attrs.des * 20;
  speedPct += Math.floor(attrs.des / 4);
  if (blockBp > 0) blockBp = Math.min(BLOCK_CAP_BP, blockBp + Math.floor((shield * 5000) / (shield + 80)));
  const dodgeBp = Math.min(DODGE_CAP_BP, attrs.des * 15 + (c.passive === "passo_leve" ? 1000 : 0));
  return {
    cls: h.cls,
    level: h.level,
    maxHp: c.hpBase + c.hpPerLevel * (h.level - 1) + attrs.vit * 6 + hp,
    maxMp: c.mpBase + c.mpPerLevel * (h.level - 1) + attrs.int * 3 + mp,
    mpRegen10: c.mpRegen10 + attrs.int,
    weapon,
    skill: h.skills[WEAPONS[weapon].skill].l,
    magic: h.skills.magia.l,
    shield,
    atk,
    armor,
    attrs,
    critBp: Math.min(5000, critBp),
    speedPct,
    blockBp,
    dodgeBp,
  };
}

/**
 * Golpe base em centésimos de vida: (ATQ × arma% + nível + 8) × (1 + skill/20)
 * × (1 + atributo/200) × (1 + bônus de dano). O atributo é FOR para golpe físico
 * e INT para varinha e cajado. Sem `**`: só inteiros.
 */
export function baseHitCenti(hc: HeroCombat, dmgPct = 0): number {
  const w = WEAPONS[hc.weapon];
  const attr = w.skill === "magia" ? hc.attrs.int : hc.attrs.for;
  const b1 = Math.floor(((hc.atk * w.atkPct + (hc.level + 8) * 100) * (20 + hc.skill)) / 20);
  const b2 = Math.floor((b1 * (200 + attr)) / 200);
  return Math.floor((b2 * (100 + dmgPct)) / 100);
}
