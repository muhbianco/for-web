import {
  CLASSES,
  type ClassId,
  currentVitals,
  DEFAULT_TACTICS,
  dummyOf,
  DUMMIES,
  equipError,
  type GameLook,
  type GameOffer,
  type HeroCore,
  heroCombat,
  type HeroView,
  type Item,
  baseItem,
  Rng,
  RULES,
  sellValue,
  settleTraining,
  shortId,
  type SkillId,
  SKILL_IDS,
  skillTriesToNext,
  type Slot,
  SPELL_BY_ID,
  type Tactics,
  trainSkill,
  type Training,
  type Vitals,
  WEAPONS,
  xpToNext,
} from "@muchat/space-core/game";

/**
 * O herói como fica guardado (`muchat_space.game_heroes`, um documento por
 * pessoa, ADR 0009 decisão 6). Tudo limitado: o documento cheio cabe em 32 KB.
 */
export interface HeroDoc {
  _id: string;
  v: 1;
  rev: number;
  created_at: number;
  updated_at: number;
  cls: ClassId;
  look: GameLook;
  level: number;
  xp: number;
  skills: Record<SkillId, { l: number; p: number }>;
  vitals: Vitals;
  training: Training;
  gold: number;
  potions: number;
  tactics: Tactics;
  gear: Partial<Record<Slot, Item>>;
  bag: Item[];
  pending: Item[];
  initiation_done: boolean;
  best: number;
  unlocks: string[];
  trophies: Record<string, number>;
  cosmetics: string[];
  stats: { runs: number; wins: number; deaths: number; kills: number; best_abyss: number };
  servers_seen: string[];
  /** Expedição em andamento (E3). */
  run: null;
}

export const HERO_VERSION = 1;
export const BAG_MAX = 40;
export const PENDING_MAX = 10;
export const SERVERS_SEEN_MAX = 50;
export const DOC_MAX_BYTES = 32_768;

export function potionPrice(level: number): number {
  return 20 + 2 * level;
}

export function heroCore(d: HeroDoc): HeroCore {
  return { cls: d.cls, level: d.level, skills: d.skills, gear: d.gear };
}

/** Herói recém-criado: nível 1, skills 1, kit inicial, 3 poções, boneco de madeira na skill da arma. */
export function newHeroDoc(userId: string, cls: ClassId, look: GameLook, now: number, serverId: string, rnd: () => number): HeroDoc {
  const rng = new Rng(rnd());
  const c = CLASSES[cls];
  const kit = (slot: Slot) => {
    const it = baseItem(shortId(rng), slot, "comum", 1, cls, slot === "arma" ? c.starter : undefined);
    return it;
  };
  const skills = Object.fromEntries(SKILL_IDS.map((s) => [s, { l: 1, p: 0 }])) as HeroDoc["skills"];
  const gear: HeroDoc["gear"] = { arma: kit("arma"), armadura: kit("armadura"), elmo: kit("elmo"), botas: kit("botas") };
  const max = heroCombat({ cls, level: 1, skills, gear });
  return {
    _id: userId,
    v: HERO_VERSION,
    rev: 0,
    created_at: now,
    updated_at: now,
    cls,
    look: { ...look, cosmetic: null },
    level: 1,
    xp: 0,
    skills,
    vitals: { hp: max.maxHp, mp: max.maxMp, at: now },
    training: { skill: WEAPONS[c.starter].skill, since: now, tier: 0, rem: 0 },
    gold: 0,
    potions: RULES.maxPotions,
    tactics: { ...DEFAULT_TACTICS, order: [] },
    gear,
    bag: [],
    pending: [],
    initiation_done: false,
    best: 0,
    unlocks: [],
    trophies: {},
    cosmetics: [],
    stats: { runs: 0, wins: 0, deaths: 0, kills: 0, best_abyss: 0 },
    servers_seen: [serverId],
    run: null,
  };
}

/** Assenta o treino até `now` (fórmula fechada); devolve as tentativas aplicadas. Muda o documento. */
export function settleHero(d: HeroDoc, now: number): number {
  if (d.run) return 0; // o boneco para durante a expedição (E3)
  const r = settleTraining(d.training, now);
  d.training = r.training;
  if (r.tries > 0) d.skills[d.training.skill] = trainSkill(d.cls, d.training.skill, d.skills[d.training.skill], r.tries);
  return r.tries;
}

/** Grava a vida e a mana de agora: antes de mudar algo que mexe no máximo (equipamento, nível). */
export function freezeVitals(d: HeroDoc, now: number) {
  const hc = heroCombat(heroCore(d));
  const v = currentVitals(d.vitals, hc.maxHp, hc.maxMp, now);
  d.vitals = { hp: v.hp, mp: v.mp, at: now };
}

export function touchServer(d: HeroDoc, serverId: string) {
  if (d.servers_seen.includes(serverId)) return;
  d.servers_seen.push(serverId);
  if (d.servers_seen.length > SERVERS_SEEN_MAX) d.servers_seen.splice(0, d.servers_seen.length - SERVERS_SEEN_MAX);
}

export function offersOf(d: HeroDoc): { potion: number | null; dummy: { tier: number; cost: number } | null } {
  const next = DUMMIES[d.training.tier + 1];
  return {
    potion: d.potions < RULES.maxPotions ? potionPrice(d.level) : null,
    dummy: next ? { tier: d.training.tier + 1, cost: next.cost } : null,
  };
}

export function heroView(d: HeroDoc, now: number): HeroView {
  const hc = heroCombat(heroCore(d));
  const v = currentVitals(d.vitals, hc.maxHp, hc.maxMp, now);
  const dummy = dummyOf(d.training.tier);
  const skills = {} as HeroView["skills"];
  for (const s of SKILL_IDS) skills[s] = { ...d.skills[s], next: skillTriesToNext(d.skills[s].l, CLASSES[d.cls].skillCost10[s]) };
  return {
    cls: d.cls,
    look: d.look,
    level: d.level,
    xp: d.xp,
    xp_next: xpToNext(d.level),
    skills,
    hp: v.hp,
    mp: v.mp,
    max_hp: hc.maxHp,
    max_mp: hc.maxMp,
    training: { skill: d.training.skill, tier: d.training.tier, since: d.training.since, cap_ms: dummy.capH * 3_600_000, tries_per_min10: dummy.triesPerMin10 },
    gold: d.gold,
    potions: d.potions,
    tactics: { order: d.tactics.order, potion_at: d.tactics.potionAt, heal_at: d.tactics.healAt },
    gear: d.gear,
    bag: d.bag,
    bag_max: BAG_MAX,
    pending: d.pending,
    initiation_done: d.initiation_done,
    best: d.best,
    stats: { runs: d.stats.runs, wins: d.stats.wins, deaths: d.stats.deaths, kills: d.stats.kills },
    cosmetics: d.cosmetics,
    combat: hc,
  };
}

// ---- comandos do Refúgio (no documento já assentado; muda o documento) -------

export type Outcome = { ok: true } | { ok: false; reason: string };
const ok: Outcome = { ok: true };
const no = (reason: string): Outcome => ({ ok: false, reason });

export function applyLook(d: HeroDoc, look: GameLook): Outcome {
  if (look.cosmetic !== null && !d.cosmetics.includes(look.cosmetic)) return no("cosmetic_locked");
  d.look = { ...look };
  return ok;
}

export function applyTrain(d: HeroDoc, skill: SkillId): Outcome {
  if (d.run) return no("on_run");
  d.training = { ...d.training, skill };
  return ok;
}

function takeItem(d: HeroDoc, id: string): { it: Item; from: "bag" | "pending"; index: number } | null {
  let i = d.bag.findIndex((x) => x.id === id);
  if (i >= 0) return { it: d.bag[i]!, from: "bag", index: i };
  i = d.pending.findIndex((x) => x.id === id);
  return i >= 0 ? { it: d.pending[i]!, from: "pending", index: i } : null;
}

export function applyEquip(d: HeroDoc, id: string, now: number): Outcome {
  if (d.run) return no("on_run");
  const found = takeItem(d, id);
  if (!found) return no("not_found");
  const err = equipError(d.cls, d.level, found.it);
  if (err) return no(err);
  freezeVitals(d, now);
  const list = found.from === "bag" ? d.bag : d.pending;
  const old = d.gear[found.it.slot];
  // O equipado volta para o lugar de onde o novo saiu (a lista não cresce).
  if (old) list.splice(found.index, 1, old);
  else list.splice(found.index, 1);
  d.gear[found.it.slot] = found.it;
  clampVitals(d);
  return ok;
}

export function applyUnequip(d: HeroDoc, slot: Slot, now: number): Outcome {
  if (d.run) return no("on_run");
  const it = d.gear[slot];
  if (!it) return no("empty");
  if (d.bag.length >= BAG_MAX) return no("bag_full");
  freezeVitals(d, now);
  delete d.gear[slot];
  d.bag.push(it);
  clampVitals(d);
  return ok;
}

export function applySell(d: HeroDoc, ids: string[]): Outcome {
  if (new Set(ids).size !== ids.length) return no("duplicate");
  let gold = 0;
  for (const id of ids) {
    const found = takeItem(d, id);
    if (!found) return no("not_found");
    (found.from === "bag" ? d.bag : d.pending).splice(found.index, 1);
    gold += sellValue(found.it);
  }
  d.gold += gold;
  return ok;
}

export function applyBuy(d: HeroDoc, offer: GameOffer, qty: number): Outcome {
  if (d.run) return no("on_run");
  if (offer === "potion") {
    if (d.potions + qty > RULES.maxPotions) return no("full");
    const cost = potionPrice(d.level) * qty;
    if (d.gold < cost) return no("no_gold");
    d.gold -= cost;
    d.potions += qty;
    return ok;
  }
  if (qty !== 1) return no("qty");
  const next = DUMMIES[d.training.tier + 1];
  if (!next) return no("max_tier");
  if (d.gold < next.cost) return no("no_gold");
  // O treino já foi assentado no boneco velho: daqui em diante conta o novo.
  d.gold -= next.cost;
  d.training = { ...d.training, tier: d.training.tier + 1 };
  return ok;
}

export function applyTactics(d: HeroDoc, t: Tactics): Outcome {
  const order = [...new Set(t.order)];
  for (const id of order) if (SPELL_BY_ID.get(id)?.cls !== d.cls) return no("spell");
  d.tactics = { order, potionAt: t.potionAt, healAt: t.healAt };
  return ok;
}

function clampVitals(d: HeroDoc) {
  const hc = heroCombat(heroCore(d));
  d.vitals = { ...d.vitals, hp: Math.min(d.vitals.hp, hc.maxHp), mp: Math.min(d.vitals.mp, hc.maxMp) };
}

export function docBytes(d: HeroDoc): number {
  return Buffer.byteLength(JSON.stringify(d), "utf8");
}
