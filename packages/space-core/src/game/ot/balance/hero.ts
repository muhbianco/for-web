import { resetAllocation, resetAttributes, raiseStats } from "./attributes.ts";
import type { Condition, FighterInput } from "./combat/types.ts";
import {
  type AmmoGrade,
  type ClassId,
  type GearSlot,
  type Stats,
  ARMOR_SLOTS,
  CLASSES,
  FAMILIES,
} from "./content.ts";
import { trainDojo } from "./dojo.ts";
import {
  type BalanceHero,
  type Equipment,
  type ItemInstance,
  cannotEquip,
} from "./equipment.ts";
import { heroFighter } from "./fighter.ts";
import type { BalanceConfig } from "./config.ts";
import { type Balance, balance as gameBalance } from "./formulas.ts";
import { autoEquip } from "./items/autoequip.ts";
import {
  type ItemBase,
  type Material,
  type RandomSource,
  generateItem,
} from "./items/generate.ts";
import { itemPerks } from "./items/legendary.ts";
import { rollPerk } from "./items/perks.ts";
import {
  dismantle,
  refineAttempt,
  refineCostOf,
  reforge,
  reforgeCost,
  stoneMatters,
} from "./items/smith.ts";
import {
  ammoPackPrice,
  buyBackPrice,
  commonItemPrice,
  potionPrice,
  sellNeedsConfirm,
} from "./npcs/merchant.ts";
import { gainXp } from "./progress.ts";
import { createReference } from "./reference.ts";
import {
  type HeroSkills,
  type SpendTarget,
  evolve,
  fitSkillsToJob,
  freshHeroSkills,
  resetSkills,
  setSlots,
  spendPoint,
} from "./skills/tree.ts";

/**
 * O herói v5 (Fase 8): tudo o que o jogador guarda na engine nova, e cada ação dele como função pura
 * (devolve o herói novo ou o motivo da recusa). O servidor só guarda, controla a concorrência e roda
 * as corridas. Nada derivado fica salvo (§0.2): HP, MP e o resto saem das fórmulas toda vez.
 * Na virada todo mundo recomeça (D34): não há migração do v4.
 */

export const HERO_VERSION = 5;

/** Um item que é de alguém: o item do §9 com um id, para equipar, vender e transferir. */
export type OwnedItem = ItemInstance & { uid: string };

export type OwnedEquipment = {
  [K in keyof Equipment]?: NonNullable<Equipment[K]> & { uid: string };
};

/** Tamanho da poção no cinto (D35): pequena, média ou grande. */
export type PotionSize = keyof BalanceConfig["potions"]["sizes"];
export const POTION_SIZES: PotionSize[] = ["pequena", "media", "grande"];
type PotionStock = Record<PotionSize, number>;
const noPotions = (): PotionStock => ({ pequena: 0, media: 0, grande: 0 });

/** Espaços da mochila (P78: itens não têm peso; poção, munição e minério não ocupam espaço). */
export const BAG_SLOTS = 40;

export interface HeroV5 {
  v: typeof HERO_VERSION;
  cls: ClassId;
  level: number;
  /** XP de nível e de job acumulados desde o 1. */
  xp: number;
  job: number;
  jobXp: number;
  /** Proficiência guardada (b) e o XP dentro dela (Dojô). */
  proficiency: number;
  proficiencyXp: number;
  attrs: Stats;
  attrResets: number;
  skills: HeroSkills;
  equipment: OwnedEquipment;
  bag: OwnedItem[];
  gold: number;
  /** Poções por tamanho (D35: cura fixa da faixa do herói na hora de beber, × o tamanho). */
  potions: { hp: PotionStock; mp: PotionStock };
  /** O tamanho que vai no cinto na corrida, para vida e para mana. */
  belt: { hp: PotionSize; mp: PotionSize };
  /** Munição do caçador: a melhor que tiver vai na corrida. */
  ammo: Partial<Record<AmmoGrade, number>>;
  ores: Partial<Record<Material, number>>;
  essence: number;
  stones: number;
  vault: { gold: number; items: OwnedItem[]; expansions: number };
  /** Quando beber: vida e mana abaixo destas frações. */
  supplies: { hp: number; mp: number };
  autoEquip: boolean;
  /** Treino no Dojô em andamento: desde quando (ms). */
  dojo: { since: number } | null;
}

export type HeroResult<E extends string, X = object> =
  | ({ ok: true; hero: HeroV5 } & X)
  | { ok: false; error: E };

const fail = <E extends string>(error: E) => ({ ok: false as const, error });
const done = <X extends object>(hero: HeroV5, extra?: X) => ({
  ok: true as const,
  hero,
  ...(extra ?? ({} as X)),
});

/** O herói na forma das fórmulas (balance/equipment.ts). */
export function balanceHero(h: HeroV5): BalanceHero {
  return {
    cls: h.cls,
    level: h.level,
    job: h.job,
    proficiency: h.proficiency,
    attrs: h.attrs,
    equipment: h.equipment,
    ...(bestAmmo(h) ? { ammo: bestAmmo(h)! } : {}),
    attrResets: h.attrResets,
    xp: h.xp,
    jobXp: h.jobXp,
  };
}

function bestAmmo(h: HeroV5): AmmoGrade | null {
  const fam = h.equipment.arma ? FAMILIES[h.equipment.arma.family] : null;
  if (!fam || fam.kind !== "ranged") return null;
  for (const g of ["runica", "afiada", "comum"] as const)
    if ((h.ammo[g] ?? 0) > 0) return g;
  return null;
}

// ------------------------------------------------------------ criação

/**
 * Jogador novo (D37): nível 1, atributos em 1, as skills do T1 e o equipamento do perfil de referência do
 * L1 (Raro +4 com os afixos do perfil, na família e no peso da classe; o conteúdo é calibrado nele),
 * 100 poções pequenas de vida e 100 de mana e, no caçador, 100 flechas comuns. Com o kit Comum e 10
 * poções nenhuma classe vencia a primeira Caçada (medido em 25/11/2026).
 */
export function createHero(
  cls: ClassId,
  newId: () => string,
  B: Balance = gameBalance,
): HeroV5 {
  const c = CLASSES[cls];
  const ref = createReference(B).referenceBalanceHero(cls, 1).equipment;
  const equipment: Record<string, OwnedItem> = {};
  for (const [slot, it] of Object.entries(ref))
    if (it)
      equipment[slot] = {
        ...(it as ItemInstance),
        affixes: (it as ItemInstance).affixes.map((a) => ({ ...a })),
        uid: newId(),
      };
  const ranged = FAMILIES[c.referenceWeapon].kind === "ranged";
  return {
    v: HERO_VERSION,
    cls,
    level: 1,
    xp: 0,
    job: 1,
    jobXp: 0,
    proficiency: 1,
    proficiencyXp: 0,
    attrs: { FOR: 1, AGI: 1, VIT: 1, INT: 1, DES: 1, SOR: 1 },
    attrResets: 0,
    skills: freshHeroSkills(cls),
    equipment: equipment as OwnedEquipment,
    bag: [],
    gold: 0,
    potions: {
      hp: { ...noPotions(), pequena: 100 },
      mp: { ...noPotions(), pequena: 100 },
    },
    belt: { hp: "pequena", mp: "pequena" },
    ammo: ranged ? { comum: 100 } : {},
    ores: {},
    essence: 0,
    stones: 0,
    vault: { gold: 0, items: [], expansions: 0 },
    supplies: { hp: 0.5, mp: 0.3 },
    autoEquip: true,
    dojo: null,
  };
}

// ------------------------------------------------------------ atributos e skills

export function raiseAttributes(
  h: HeroV5,
  req: Partial<Stats>,
  B: Balance = gameBalance,
) {
  const r = raiseStats(h.level, h.attrs, req, B);
  return r.ok ? done({ ...h, attrs: r.stats }) : fail(r.error);
}

/** Mestre: redistribuir os atributos (a 1ª grátis, depois 5.000; D25). */
export function respecAttributes(h: HeroV5, B: Balance = gameBalance) {
  const r = resetAttributes(h, B);
  if (r.cost > h.gold) return fail("sem-ouro" as const);
  return done({ ...r.hero, gold: h.gold - r.cost }, { cost: r.cost });
}

export function spendSkillPoint(
  h: HeroV5,
  skillId: string,
  target: SpendTarget,
  B: Balance = gameBalance,
) {
  const r = spendPoint(h.cls, h.job, h.skills, skillId, target, B);
  return r.ok ? done({ ...h, skills: r.skills }) : fail(r.error);
}

export function setSkillSlots(h: HeroV5, slots: string[]) {
  const r = setSlots(h.cls, h.skills, slots);
  return r.ok ? done({ ...h, skills: r.skills }) : fail(r.error);
}

/** A IA de uma skill: as condições do jogador, ou `null` para voltar à padrão. */
export function setSkillAi(
  h: HeroV5,
  skillId: string,
  conditions: Condition[] | null,
) {
  if (!h.skills.builds[skillId]) return fail("skill-desconhecida" as const);
  if (conditions && (conditions.length === 0 || conditions.length > 3))
    return fail("condicoes-invalidas" as const);
  const ai = { ...h.skills.ai };
  if (conditions) ai[skillId] = conditions;
  else delete ai[skillId];
  return done({ ...h, skills: { ...h.skills, ai } });
}

/**
 * O herói dentro das regras de tier de agora (D51): o servidor chama ao ler o herói do banco e grava
 * se mudou. Ver `fitSkillsToJob`.
 */
export function fitHeroSkills(
  h: HeroV5,
  B: Balance = gameBalance,
): { hero: HeroV5; changed: boolean } {
  const r = fitSkillsToJob(h.cls, h.job, h.skills, B);
  return r.changed
    ? { hero: { ...h, skills: r.skills }, changed: true }
    : { hero: h, changed: false };
}

/** Mestre: evoluir de tier (grátis, D11). */
export function evolveTier(h: HeroV5, B: Balance = gameBalance) {
  const r = evolve(h.cls, h.job, h.skills, B);
  return r.ok ? done({ ...h, skills: r.skills }) : fail(r.error);
}

/** Mestre: redistribuir as skills (a 1ª grátis, depois 5.000; D25). */
export function respecSkills(h: HeroV5, B: Balance = gameBalance) {
  const r = resetSkills(h.skills, B);
  if (r.cost > h.gold) return fail("sem-ouro" as const);
  return done(
    { ...h, skills: r.skills, gold: h.gold - r.cost },
    { cost: r.cost },
  );
}

/** A ordem de vestir na troca de classe: a arma antes da mão secundária (o escudo confere com ela). */
const WEAR_ORDER: GearSlot[] = [
  "arma",
  "secundaria",
  ...ARMOR_SLOTS,
  "colar",
  "anel",
];

/**
 * Mestre: trocar de classe (26/11/2026, pedido do dono). O preço é o job e a Proficiência, que voltam
 * ao 1; as skills da classe nova começam no T1 (os pontos saem do job). Nível, XP, ouro, itens,
 * poções, munição e minério ficam. Os atributos voltam a 1 com os pontos livres, sem gastar a
 * redistribuição (a build de uma classe não serve na outra, e o preço é só o que o dono definiu). O
 * que a classe nova não veste vai para a mochila; com o "escolher o melhor" ligado, ela veste o que
 * servir da mochila.
 */
export function changeClass(
  h: HeroV5,
  cls: ClassId,
  B: Balance = gameBalance,
) {
  if (!CLASSES[cls]) return fail("classe-desconhecida" as const);
  if (cls === h.cls) return fail("mesma-classe" as const);
  if (h.dojo) return fail("treinando" as const);
  const base: HeroV5 = {
    ...h,
    cls,
    job: 1,
    jobXp: 0,
    proficiency: 1,
    proficiencyXp: 0,
    attrs: resetAllocation(B),
    skills: freshHeroSkills(cls),
    equipment: {} as OwnedEquipment,
  };
  const worn: Record<string, OwnedItem> = {};
  const bag = [...h.bag];
  let off = 0;
  for (const slot of WEAR_ORDER) {
    const it = (h.equipment as Record<string, OwnedItem | undefined>)[slot];
    if (!it) continue;
    const probe = { ...base, equipment: worn as OwnedEquipment };
    if (cannotEquip(balanceHero(probe), it, B)) {
      bag.push(it);
      off++;
    } else worn[slot] = it;
  }
  if (bag.length > BAG_SLOTS) return fail("mochila-cheia" as const);
  const next: HeroV5 = { ...base, equipment: worn as OwnedEquipment, bag };
  if (!next.autoEquip || off === 0) return done(next, { unequipped: off });
  const auto = autoEquipBag(next, B);
  return done(auto.ok ? auto.hero : next, { unequipped: off });
}

// ------------------------------------------------------------ equipamento e mochila

const takeFromBag = (h: HeroV5, uid: string) => {
  const i = h.bag.findIndex((x) => x.uid === uid);
  return i < 0
    ? null
    : { item: h.bag[i]!, bag: [...h.bag.slice(0, i), ...h.bag.slice(i + 1)] };
};

export function equipItem(h: HeroV5, uid: string, B: Balance = gameBalance) {
  const got = takeFromBag(h, uid);
  if (!got) return fail("item-nao-encontrado" as const);
  const slot = got.item.slot as GearSlot;
  // A arma nova confere sem a mão secundária: se não combinar, a secundária sai (abaixo).
  const probe = { ...h.equipment } as Record<string, OwnedItem | undefined>;
  if (slot === "arma") delete probe.secundaria;
  const err = cannotEquip(
    balanceHero({ ...h, equipment: probe as OwnedEquipment }),
    got.item,
    B,
  );
  if (err) return fail(err);
  const out = { ...h.equipment } as Record<string, OwnedItem | undefined>;
  const bag = [...got.bag];
  const old = out[slot];
  if (old) bag.push(old);
  out[slot] = got.item;
  // Arma de 2 mãos tira o escudo; o que sai volta para a mochila.
  if (slot === "arma" && out.secundaria) {
    const off = out.secundaria;
    if (cannotEquip(balanceHero({ ...h, equipment: out }), off, B)) {
      bag.push(off);
      delete out.secundaria;
    }
  }
  if (bag.length > BAG_SLOTS) return fail("mochila-cheia" as const);
  return done({ ...h, equipment: out as OwnedEquipment, bag });
}

export function unequipItem(h: HeroV5, slot: GearSlot) {
  const out = { ...h.equipment } as Record<string, OwnedItem | undefined>;
  const it = out[slot];
  if (!it) return fail("slot-vazio" as const);
  if (h.bag.length >= BAG_SLOTS) return fail("mochila-cheia" as const);
  delete out[slot];
  return done({ ...h, equipment: out as OwnedEquipment, bag: [...h.bag, it] });
}

/** "Escolher o melhor sozinho" (§9.8): troca o que melhora; o que esbarra num +7 volta para confirmar. */
export function autoEquipBag(h: HeroV5, B: Balance = gameBalance) {
  const r = autoEquip(balanceHero(h), h.skills, h.bag, B);
  const byItem = new Map<ItemInstance, OwnedItem>(h.bag.map((x) => [x, x]));
  for (const x of Object.values(h.equipment)) if (x) byItem.set(x, x);
  const equipment: Record<string, OwnedItem> = {};
  for (const [slot, it] of Object.entries(r.equipment))
    if (it) equipment[slot] = byItem.get(it)!;
  const worn = new Set(Object.values(equipment));
  const all = [...h.bag, ...(Object.values(h.equipment) as OwnedItem[])];
  const bag = all.filter((x) => x && !worn.has(x));
  if (bag.length > BAG_SLOTS) return fail("mochila-cheia" as const);
  return done(
    { ...h, equipment: equipment as OwnedEquipment, bag },
    {
      changed: r.changes.length,
      confirm: r.needsConfirmation.map((x) => ({
        slot: x.slot,
        uid: byItem.get(x.candidate)!.uid,
      })),
    },
  );
}

export function discardItem(h: HeroV5, uid: string) {
  const got = takeFromBag(h, uid);
  return got
    ? done({ ...h, bag: got.bag })
    : fail("item-nao-encontrado" as const);
}

// ------------------------------------------------------------ Mercador

const positiveInt = (n: number) => Number.isInteger(n) && n > 0 && n <= 10_000;

export function buyPotions(
  h: HeroV5,
  kind: "hp" | "mp",
  size: PotionSize,
  count: number,
  B: Balance = gameBalance,
) {
  if (!positiveInt(count)) return fail("quantidade-invalida" as const);
  if (!POTION_SIZES.includes(size)) return fail("tamanho-invalido" as const);
  const cost =
    potionPrice(h.level, B)[kind] * B.cfg.potions.sizes[size].mult * count;
  if (cost > h.gold) return fail("sem-ouro" as const);
  const stock = { ...h.potions[kind], [size]: h.potions[kind][size] + count };
  return done(
    { ...h, gold: h.gold - cost, potions: { ...h.potions, [kind]: stock } },
    { cost },
  );
}

/** O tamanho de poção que vai no cinto (vida ou mana). */
export function setBelt(h: HeroV5, kind: "hp" | "mp", size: PotionSize) {
  if (!POTION_SIZES.includes(size)) return fail("tamanho-invalido" as const);
  return done({ ...h, belt: { ...h.belt, [kind]: size } });
}

export function buyAmmo(
  h: HeroV5,
  grade: AmmoGrade,
  packs: number,
  B: Balance = gameBalance,
) {
  if (!positiveInt(packs)) return fail("quantidade-invalida" as const);
  const p = ammoPackPrice(grade, h.level, B);
  const cost = p.gold * packs;
  if (cost > h.gold) return fail("sem-ouro" as const);
  return done(
    {
      ...h,
      gold: h.gold - cost,
      ammo: { ...h.ammo, [grade]: (h.ammo[grade] ?? 0) + p.units * packs },
    },
    { cost },
  );
}

/** Equipamento Comum do tier do herói (qualquer base: o Mercador vende para todo mundo). */
export function buyCommonItem(
  h: HeroV5,
  base: ItemBase,
  newId: () => string,
  rng: RandomSource,
  B: Balance = gameBalance,
) {
  if (h.bag.length >= BAG_SLOTS) return fail("mochila-cheia" as const);
  const p = commonItemPrice(h.level, B);
  if (p.gold > h.gold) return fail("sem-ouro" as const);
  const item: OwnedItem = {
    ...generateItem(base, p.ilvl, "comum", rng, B),
    uid: newId(),
  };
  return done(
    { ...h, gold: h.gold - p.gold, bag: [...h.bag, item] },
    { cost: p.gold, item },
  );
}

/** Vender da mochila: 10% do preço base; refinado do +7 pede confirmação (P20). */
export function sellItem(
  h: HeroV5,
  uid: string,
  confirmed: boolean,
  B: Balance = gameBalance,
) {
  const got = takeFromBag(h, uid);
  if (!got) return fail("item-nao-encontrado" as const);
  if (sellNeedsConfirm(got.item, B) && !confirmed)
    return fail("confirmacao" as const);
  const gold = buyBackPrice(got.item, B);
  return done({ ...h, bag: got.bag, gold: h.gold + gold }, { gold });
}

/** Tudo ou nada: uma lista sem repetição, cada uid aplicado sobre o resultado do anterior. */
function eachItem<E extends string, X extends object>(
  h: HeroV5,
  uids: string[],
  one: (h: HeroV5, uid: string) => HeroResult<E, X>,
): { ok: true; hero: HeroV5; each: X[] } | { ok: false; error: E | "lista-invalida" } {
  if (uids.length === 0 || new Set(uids).size !== uids.length)
    return fail("lista-invalida" as const);
  let cur = h;
  const each: X[] = [];
  for (const uid of uids) {
    const r = one(cur, uid);
    if (!r.ok) return r;
    cur = r.hero;
    each.push(r);
  }
  return { ok: true, hero: cur, each };
}

/** Vender vários de uma vez (a venda em lote numa gravação só): o +7 só com `confirmed`. */
export function sellItems(
  h: HeroV5,
  uids: string[],
  confirmed: boolean,
  B: Balance = gameBalance,
) {
  const r = eachItem(h, uids, (x, uid) => sellItem(x, uid, confirmed, B));
  if (!r.ok) return r;
  return done(r.hero, { gold: r.each.reduce((a, x) => a + x.gold, 0) });
}

// ------------------------------------------------------------ Ferreiro

const replaceItem = (h: HeroV5, uid: string, item: OwnedItem): HeroV5 => {
  const eq = { ...h.equipment } as Record<string, OwnedItem | undefined>;
  for (const [k, v] of Object.entries(eq)) if (v?.uid === uid) eq[k] = item;
  return {
    ...h,
    equipment: eq as OwnedEquipment,
    bag: h.bag.map((x) => (x.uid === uid ? item : x)),
  };
};

const findItem = (h: HeroV5, uid: string): OwnedItem | null =>
  h.bag.find((x) => x.uid === uid) ??
  (Object.values(h.equipment).find((x) => x?.uid === uid) as
    | OwnedItem
    | undefined) ??
  null;

export function refineItem(
  h: HeroV5,
  uid: string,
  rng: RandomSource,
  protect: boolean,
  B: Balance = gameBalance,
) {
  const item = findItem(h, uid);
  if (!item) return fail("item-nao-encontrado" as const);
  const cost = refineCostOf(item, B);
  if (!cost) return fail("nao-refinavel" as const);
  if (cost.gold > h.gold) return fail("sem-ouro" as const);
  const ore = h.ores[cost.ore.material] ?? 0;
  if (ore < cost.ore.count) return fail("sem-minerio" as const);
  const useStone = protect && stoneMatters(item, B);
  if (useStone && h.stones < 1) return fail("sem-pedra" as const);
  const r = refineAttempt(item, rng, { protect: useStone }, B);
  if (!r.ok) return fail(r.error);
  const paid: HeroV5 = {
    ...h,
    gold: h.gold - cost.gold,
    ores: { ...h.ores, [cost.ore.material]: ore - cost.ore.count },
    stones: h.stones - (r.stoneUsed ? 1 : 0),
  };
  return done(replaceItem(paid, uid, { ...r.outcome.item, uid }), {
    outcome: r.outcome.kind,
  });
}

export function reforgeItem(
  h: HeroV5,
  uid: string,
  rng: RandomSource,
  B: Balance = gameBalance,
) {
  const item = findItem(h, uid);
  if (!item) return fail("item-nao-encontrado" as const);
  const cost = reforgeCost(item, B);
  if (cost.gold > h.gold) return fail("sem-ouro" as const);
  const ore = h.ores[cost.ore.material] ?? 0;
  if (ore < cost.ore.count) return fail("sem-minerio" as const);
  const paid: HeroV5 = {
    ...h,
    gold: h.gold - cost.gold,
    ores: { ...h.ores, [cost.ore.material]: ore - cost.ore.count },
  };
  return done(replaceItem(paid, uid, { ...reforge(item, rng, B), uid }));
}

/**
 * Rola o perk `slot` (0 ou 1) de um lendário (27/11/2026, pedido do dono): uma skill da classe do herói
 * (menos a do outro perk do item) com o tamanho na faixa dela. Custa Essência; vale vestido ou na
 * mochila. Os afixos não mudam (isso é o Reforjar).
 */
export function rerollPerk(
  h: HeroV5,
  uid: string,
  slot: number,
  rng: RandomSource,
  B: Balance = gameBalance,
) {
  const item = findItem(h, uid);
  if (!item) return fail("item-nao-encontrado" as const);
  if (item.rarity !== "lendario") return fail("nao-lendario" as const);
  const perks = itemPerks(item);
  if (!Number.isInteger(slot) || slot < 0 || slot >= Math.max(1, perks.length))
    return fail("perk-invalido" as const);
  const cost = B.cfg.legendaryPerks.rerollEssence;
  if (h.essence < cost) return fail("sem-essencia" as const);
  const others = perks.filter((_, i) => i !== slot).map((p) => p.skill);
  const perk = rollPerk(h.cls, others, rng);
  const next = [...perks];
  next[slot] = perk;
  return done(
    replaceItem({ ...h, essence: h.essence - cost }, uid, {
      ...item,
      perks: next,
    }),
    { perk },
  );
}

/** Imbuir: o lendário ganha um 2º perk rolado (numa skill que ele ainda não tem), por Essência. */
export function imbuePerk(
  h: HeroV5,
  uid: string,
  rng: RandomSource,
  B: Balance = gameBalance,
) {
  const item = findItem(h, uid);
  if (!item) return fail("item-nao-encontrado" as const);
  if (item.rarity !== "lendario") return fail("nao-lendario" as const);
  const perks = itemPerks(item);
  if (perks.length >= B.cfg.legendaryPerks.maxPerks)
    return fail("perks-cheios" as const);
  const cost = B.cfg.legendaryPerks.imbueEssence;
  if (h.essence < cost) return fail("sem-essencia" as const);
  const perk = rollPerk(
    h.cls,
    perks.map((p) => p.skill),
    rng,
  );
  return done(
    replaceItem({ ...h, essence: h.essence - cost }, uid, {
      ...item,
      perks: [...perks, perk],
    }),
    { perk },
  );
}

export function dismantleItem(h: HeroV5, uid: string) {
  const got = takeFromBag(h, uid);
  if (!got) return fail("item-nao-encontrado" as const);
  const d = dismantle(got.item);
  return done({
    ...h,
    bag: got.bag,
    ores: {
      ...h.ores,
      [d.ore.material]: (h.ores[d.ore.material] ?? 0) + d.ore.count,
    },
    essence: h.essence + d.essence,
  });
}

/** Desmontar vários de uma vez, só da mochila (o vestido não desmonta). */
export function dismantleItems(h: HeroV5, uids: string[]) {
  const r = eachItem(h, uids, (x, uid) => dismantleItem(x, uid));
  return r.ok ? done(r.hero) : r;
}

// ------------------------------------------------------------ Banqueiro (o cofre do próprio herói)

export function bankGold(h: HeroV5, amount: number) {
  if (!Number.isInteger(amount) || amount === 0)
    return fail("valor-invalido" as const);
  if (amount > 0 && amount > h.gold) return fail("sem-ouro" as const);
  if (amount < 0 && -amount > h.vault.gold) return fail("sem-ouro" as const);
  return done({
    ...h,
    gold: h.gold - amount,
    vault: { ...h.vault, gold: h.vault.gold + amount },
  });
}

/** Guarda no cofre (sem limite desde 27/11/2026: o Banqueiro guarda tudo). */
export function vaultPut(h: HeroV5, uid: string) {
  const got = takeFromBag(h, uid);
  if (!got) return fail("item-nao-encontrado" as const);
  return done({
    ...h,
    bag: got.bag,
    vault: { ...h.vault, items: [...h.vault.items, got.item] },
  });
}

export function vaultTake(h: HeroV5, uid: string) {
  const i = h.vault.items.findIndex((x) => x.uid === uid);
  if (i < 0) return fail("item-nao-encontrado" as const);
  if (h.bag.length >= BAG_SLOTS) return fail("mochila-cheia" as const);
  const item = h.vault.items[i]!;
  return done({
    ...h,
    bag: [...h.bag, item],
    vault: {
      ...h.vault,
      items: [...h.vault.items.slice(0, i), ...h.vault.items.slice(i + 1)],
    },
  });
}

/**
 * Vários itens de uma vez entre a mochila e o cofre, tudo ou nada, numa gravação só (item a item,
 * uma mochila inteira passava do limite de comandos por segundo). Retirar pede espaço para todos.
 */
export function vaultMoveMany(
  h: HeroV5,
  action: "guardar" | "retirar",
  uids: readonly string[],
) {
  const want = new Set(uids);
  if (uids.length === 0 || want.size !== uids.length)
    return fail("lista-invalida" as const);
  const from = action === "guardar" ? h.bag : h.vault.items;
  const moving = from.filter((x) => want.has(x.uid));
  if (moving.length !== want.size) return fail("item-nao-encontrado" as const);
  const rest = from.filter((x) => !want.has(x.uid));
  if (action === "guardar")
    return done(
      { ...h, bag: rest, vault: { ...h.vault, items: [...h.vault.items, ...moving] } },
      { moved: moving.length },
    );
  if (h.bag.length + moving.length > BAG_SLOTS)
    return fail("mochila-cheia" as const);
  return done(
    { ...h, bag: [...h.bag, ...moving], vault: { ...h.vault, items: rest } },
    { moved: moving.length },
  );
}

// ------------------------------------------------------------ Dojô

export function startDojo(h: HeroV5, now: number) {
  if (h.dojo) return fail("ja-treinando" as const);
  return done({ ...h, dojo: { since: now } });
}

/** Para o treino e credita o tempo (com o bônus social da sala no fim; o servidor passa quantos). */
export function stopDojo(
  h: HeroV5,
  now: number,
  othersTraining: number,
  B: Balance = gameBalance,
) {
  if (!h.dojo) return fail("sem-treino" as const);
  const seconds = Math.max(0, (now - h.dojo.since) / 1000);
  const r = trainDojo(h, seconds, othersTraining, B);
  return done({ ...r.hero, dojo: null }, { gained: r.gained });
}

// ------------------------------------------------------------ corrida

/** O lutador da corrida de verdade: poções e munição do herói, limiares de poção dele. */
export function heroRunFighter(
  h: HeroV5,
  B: Balance = gameBalance,
): FighterInput {
  const R = createReference(B);
  return heroFighter(
    balanceHero(h),
    h.skills,
    {
      potions: {
        hp: R.potionHp(h.level) * B.cfg.potions.sizes[h.belt.hp].mult,
        mp: R.potionMp(h.level) * B.cfg.potions.sizes[h.belt.mp].mult,
        stock: h.potions.hp[h.belt.hp] + h.potions.mp[h.belt.mp],
        hpStock: h.potions.hp[h.belt.hp],
        mpStock: h.potions.mp[h.belt.mp],
        hpCooldownMs: B.cfg.potions.sizes[h.belt.hp].cooldownMs,
        mpCooldownMs: B.cfg.potions.sizes[h.belt.mp].cooldownMs,
      },
      potionAt: h.supplies,
    },
    B,
    R,
  );
}

export interface RunSpoils {
  xp: number;
  jobXp: number;
  gold: number;
  items: OwnedItem[];
  ores: Partial<Record<Material, number>>;
  stones: number;
  potionsUsed: { hp: number; mp: number };
  ammoUsed: number;
}

/**
 * Fecha a corrida no herói: XP, job, ouro, minério, pedras; gasta poções e munição; os itens entram na
 * mochila até encher e o resto vai para o cofre do Banqueiro, que não tem limite (27/11/2026, o dono
 * perdeu um escudo lendário com a mochila cheia: "mão cheia, os itens começam a ir pro banqueiro").
 * `toVault` são os que foram para o cofre; `left` fica vazio (nada mais se perde na dungeon).
 */
export function applyRun(h: HeroV5, s: RunSpoils, B: Balance = gameBalance) {
  const g = gainXp(h, s.xp, s.jobXp, B);
  const room = Math.max(0, BAG_SLOTS - h.bag.length);
  const kept = s.items.slice(0, room);
  const toVault = s.items.slice(room);
  const left: OwnedItem[] = [];
  const ores = { ...h.ores };
  for (const [m, n] of Object.entries(s.ores))
    ores[m as Material] = (ores[m as Material] ?? 0) + (n ?? 0);
  let ammoLeft = s.ammoUsed;
  const ammo = { ...h.ammo };
  for (const gr of ["runica", "afiada", "comum"] as const) {
    if (ammoLeft <= 0) break;
    const have = ammo[gr] ?? 0;
    const take = Math.min(have, ammoLeft);
    if (take > 0) ammo[gr] = have - take;
    ammoLeft -= take;
  }
  return done(
    {
      ...h,
      level: g.hero.level,
      xp: g.hero.xp,
      job: g.hero.job,
      jobXp: g.hero.jobXp,
      gold: h.gold + s.gold,
      bag: [...h.bag, ...kept],
      vault:
        toVault.length > 0
          ? { ...h.vault, items: [...h.vault.items, ...toVault] }
          : h.vault,
      ores,
      stones: h.stones + s.stones,
      potions: {
        hp: {
          ...h.potions.hp,
          [h.belt.hp]: Math.max(0, h.potions.hp[h.belt.hp] - s.potionsUsed.hp),
        },
        mp: {
          ...h.potions.mp,
          [h.belt.mp]: Math.max(0, h.potions.mp[h.belt.mp] - s.potionsUsed.mp),
        },
      },
      ammo,
    },
    { left, toVault, levelsGained: g.levelsGained, jobsGained: g.jobsGained },
  );
}
