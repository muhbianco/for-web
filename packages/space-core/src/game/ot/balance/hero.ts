import { resetAttributes, raiseStats } from "./attributes.ts";
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
import { type Balance, balance as gameBalance } from "./formulas.ts";
import { autoEquip } from "./items/autoequip.ts";
import {
  type ItemBase,
  type Material,
  type RandomSource,
  generateItem,
} from "./items/generate.ts";
import {
  dismantle,
  refineAttempt,
  refineCostOf,
  reforge,
  reforgeCost,
} from "./items/smith.ts";
import { vaultExpansionCost, vaultSlots } from "./npcs/bank.ts";
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
  /** Poções no cinto (P79: valem o tier do herói na hora de beber). */
  potions: { hp: number; mp: number };
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
 * Jogador novo (P80): nível 1, atributos em 1, as skills do T1, a arma e a armadura Comuns do iL 1 da
 * classe (a mão secundária de referência, se houver), 10 poções de vida e, no caçador, 100 flechas.
 */
export function createHero(
  cls: ClassId,
  newId: () => string,
  B: Balance = gameBalance,
): HeroV5 {
  const c = CLASSES[cls];
  const zero: RandomSource = { next: () => 0.5 };
  const own = (base: ItemBase): OwnedItem => ({
    ...generateItem(base, 1, "comum", zero, B),
    uid: newId(),
  });
  const equipment: OwnedEquipment = {
    arma: own({
      slot: "arma",
      family: c.referenceWeapon,
    }) as OwnedEquipment["arma"],
  };
  if (c.referenceOffhand)
    equipment.secundaria = own({
      slot: "secundaria",
      offhand: c.referenceOffhand,
    }) as OwnedEquipment["secundaria"];
  for (const slot of ARMOR_SLOTS)
    (equipment as Record<string, OwnedItem>)[slot] = own({
      slot,
      weight: c.armor,
    });
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
    equipment,
    bag: [],
    gold: 0,
    potions: { hp: 10, mp: 0 },
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

/** Mestre: evoluir de tier (grátis, D11). */
export function evolveTier(h: HeroV5, B: Balance = gameBalance) {
  const r = evolve(h.cls, h.level, h.job, h.skills, B);
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
  count: number,
  B: Balance = gameBalance,
) {
  if (!positiveInt(count)) return fail("quantidade-invalida" as const);
  const cost = potionPrice(h.level, B)[kind] * count;
  if (cost > h.gold) return fail("sem-ouro" as const);
  return done(
    {
      ...h,
      gold: h.gold - cost,
      potions: { ...h.potions, [kind]: h.potions[kind] + count },
    },
    { cost },
  );
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
  if (protect && h.stones < 1) return fail("sem-pedra" as const);
  const r = refineAttempt(item, rng, { protect }, B);
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

export function vaultPut(h: HeroV5, uid: string, B: Balance = gameBalance) {
  const got = takeFromBag(h, uid);
  if (!got) return fail("item-nao-encontrado" as const);
  if (h.vault.items.length >= vaultSlots(h.vault.expansions, B))
    return fail("cofre-cheio" as const);
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

export function vaultExpand(h: HeroV5, B: Balance = gameBalance) {
  const cost = vaultExpansionCost(h.level, B);
  if (cost > h.gold) return fail("sem-ouro" as const);
  return done(
    {
      ...h,
      gold: h.gold - cost,
      vault: { ...h.vault, expansions: h.vault.expansions + 1 },
    },
    { cost },
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
        hp: R.potionHp(h.level),
        mp: R.potionMp(h.level),
        stock: h.potions.hp + h.potions.mp,
        hpStock: h.potions.hp,
        mpStock: h.potions.mp,
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
 * mochila até encher (o resto fica na dungeon e volta na lista `left`).
 */
export function applyRun(h: HeroV5, s: RunSpoils, B: Balance = gameBalance) {
  const g = gainXp(h, s.xp, s.jobXp, B);
  const room = Math.max(0, BAG_SLOTS - h.bag.length);
  const kept = s.items.slice(0, room);
  const left = s.items.slice(room);
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
      ores,
      stones: h.stones + s.stones,
      potions: {
        hp: Math.max(0, h.potions.hp - s.potionsUsed.hp),
        mp: Math.max(0, h.potions.mp - s.potionsUsed.mp),
      },
      ammo,
    },
    { left, levelsGained: g.levelsGained, jobsGained: g.jobsGained },
  );
}
