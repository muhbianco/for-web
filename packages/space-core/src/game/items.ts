import {
  ARMOR_SLOT_PCT,
  type Attr,
  CLASSES,
  type ClassId,
  type OffhandType,
  RARITIES,
  RARITY,
  type Rarity,
  SHIELD_BLOCK_BP,
  type Slot,
  SLOTS,
  WEAPON_TYPES,
  type WeaponType,
} from "./data.ts";
import { type Rng, shortId } from "./rng.ts";

/** Um item, como fica guardado no herói (cerca de 120 bytes em JSON). */
export interface Item {
  id: string;
  slot: Slot;
  /** Arma: tipo da arma. Mão secundária: escudo, aljava ou foco. Outros: null. */
  type: WeaponType | OffhandType | null;
  rarity: Rarity;
  ilvl: number;
  atk: number;
  armor: number;
  attrs: Partial<Record<Attr, number>>;
  critBp: number;
  speedPct: number;
  hp: number;
  mp: number;
  blockBp: number;
}

export const MAX_ILVL = 300;

const round = (num: number, den: number) => Math.floor((num + Math.floor(den / 2)) / den);

export function weaponAtk(ilvl: number, rarity: Rarity): number {
  return round((120 + 24 * ilvl) * RARITY[rarity].pct, 1000);
}

export function requiredLevel(ilvl: number): number {
  return Math.max(1, ilvl - 2);
}

export function sellValue(it: Pick<Item, "ilvl" | "rarity">): number {
  return round((3 + 2 * it.ilvl) * RARITY[it.rarity].pct, 100);
}

export function isWeaponType(t: unknown): t is WeaponType {
  return typeof t === "string" && (WEAPON_TYPES as readonly string[]).includes(t);
}

function blank(id: string, slot: Slot, rarity: Rarity, ilvl: number): Item {
  return { id, slot, type: null, rarity, ilvl, atk: 0, armor: 0, attrs: {}, critBp: 0, speedPct: 0, hp: 0, mp: 0, blockBp: 0 };
}

/** Item base sem afixos (o kit inicial e os testes). */
export function baseItem(id: string, slot: Slot, rarity: Rarity, ilvl: number, cls: ClassId, weapon?: WeaponType): Item {
  const it = blank(id, slot, rarity, ilvl);
  const pct = RARITY[rarity].pct;
  if (slot === "arma") {
    it.type = weapon ?? CLASSES[cls].starter;
    it.atk = weaponAtk(ilvl, rarity);
  } else if (slot === "secundaria") {
    const off = CLASSES[cls].offhand;
    it.type = off;
    if (off === "escudo") {
      it.armor = round((30 + 9 * ilvl) * pct, 1000);
      it.blockBp = SHIELD_BLOCK_BP;
    } else if (off === "aljava") it.atk = round((30 + 6 * ilvl) * pct, 1000);
    else it.mp = round((10 + 3 * ilvl) * pct, 100);
  } else {
    const slotPct = ARMOR_SLOT_PCT[slot];
    if (slotPct) it.armor = round((20 + 8 * ilvl) * slotPct * pct, 100_000);
  }
  return it;
}

/**
 * Item sorteado: espaço (ou o pedido), tipo, status base e afixos pela raridade.
 * Arma: 70% de chance de ser da classe de quem achou.
 */
export function rollItem(rng: Rng, ilvlIn: number, rarity: Rarity, cls: ClassId, slot?: Slot): Item {
  const ilvl = Math.min(MAX_ILVL, Math.max(1, ilvlIn));
  const s = slot ?? rng.pick(SLOTS);
  const id = shortId(rng);
  let weapon: WeaponType | undefined;
  if (s === "arma") weapon = rng.bp(7000) ? rng.pick(CLASSES[cls].weapons) : rng.pick(WEAPON_TYPES);
  const it = baseItem(id, s, rarity, ilvl, cls, weapon);
  const affixes = RARITY[rarity].affixes + (s === "anel" || s === "amuleto" ? 1 : 0);
  for (let i = 0; i < affixes; i++) {
    const k = rng.pick(["for", "des", "int", "vit", "crit", "speed", "hp", "mp"] as const);
    if (k === "crit") it.critBp += 50 + 6 * ilvl;
    else if (k === "speed") it.speedPct += 2 + Math.floor(ilvl / 8);
    else if (k === "hp") it.hp += 8 + 4 * ilvl;
    else if (k === "mp") it.mp += 6 + 3 * ilvl;
    else it.attrs[k] = (it.attrs[k] ?? 0) + 1 + Math.floor((ilvl * 35) / 100);
  }
  return it;
}

/** Raridade sorteada pelos pesos, nunca abaixo de `min`. */
export function rollRarity(rng: Rng, weights: Record<Rarity, number>, min: Rarity = "comum"): Rarity {
  const r = rng.weighted(weights);
  return RARITIES.indexOf(r) < RARITIES.indexOf(min) ? min : r;
}

export type EquipError = "level" | "class" | "slot";

/** Por que este herói não pode usar o item (null = pode). */
export function equipError(cls: ClassId, level: number, it: Item): EquipError | null {
  if (level < requiredLevel(it.ilvl)) return "level";
  if (it.slot === "arma" && !(isWeaponType(it.type) && CLASSES[cls].weapons.includes(it.type))) return "class";
  if (it.slot === "secundaria" && it.type !== CLASSES[cls].offhand) return "class";
  if (!SLOTS.includes(it.slot)) return "slot";
  return null;
}

/** Nota para comparar itens do mesmo espaço ("melhor que o equipado"); −1 = não serve à classe. */
export function itemScore(it: Item | undefined, cls: ClassId): number {
  if (!it) return 0;
  if (equipError(cls, Number.MAX_SAFE_INTEGER, it) === "class") return -1;
  const main: Attr = cls === "cavaleiro" ? "for" : cls === "arqueiro" ? "des" : "int";
  return (
    it.atk * 3 +
    it.armor * 2 +
    (it.attrs[main] ?? 0) * 4 +
    (it.attrs.vit ?? 0) * 3 +
    (it.attrs.des ?? 0) +
    (it.attrs.for ?? 0) +
    (it.attrs.int ?? 0) +
    it.critBp / 40 +
    it.speedPct * 3 +
    it.hp / 3 +
    it.mp / 6 +
    it.blockBp / 100
  );
}
