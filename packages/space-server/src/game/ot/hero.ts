import {
  type MagicState,
  type Rates,
  type RpgHeroView,
  type RunHero,
  type RunReward,
  type SkillId,
  type SkillState,
  type TrainingBank,
  type TrainingSession,
  type TrainingSkill,
  type VocationId,
  addExperience,
  addManaSpent,
  addSkillTries,
  bankAfter,
  bankNow,
  bestGear,
  freshSkill,
  itemDef,
  regenStamina,
  reqMana,
  reqSkillTries,
  settleSession,
  SKILLS,
  STAMINA,
  START,
  startSession,
  TRAINING,
  VOCATIONS,
} from "@muchat/space-core/game/ot";

/**
 * O herói do jogo idle (docs/espaco/jogo/ot) no servidor: um por conta, criado no primeiro
 * uso. O Refúgio do ADR 0009 fica no `game_heroes`; este mora em `rpg_heroes` e começa do
 * zero (decisão do dono, 23/11/2026).
 */
export const RPG_VERSION = 1;

/** O treino aberto: a sessão das regras mais onde ele acontece. */
export interface RpgTraining extends TrainingSession {
  instance: string;
  server: string;
  zone: string;
}

/** O herói está numa dungeon até `ends_at` (etapa O5). */
export interface RpgRunMark {
  id: string;
  dungeon: string;
  ends_at: number;
}

/** Uma marca de corrida que passou disto do fim sem ser fechada é tratada como solta. */
export const RUN_STALE_MS = 10 * 60_000;

export interface RpgHeroDoc {
  _id: string;
  v: typeof RPG_VERSION;
  rev: number;
  created_at: number;
  updated_at: number;
  vocation: VocationId;
  level: number;
  experience: number;
  health_max: number;
  mana_max: number;
  cap: number;
  skills: Record<SkillId, SkillState>;
  magic: MagicState;
  stamina: number;
  bank: TrainingBank;
  training: RpgTraining | null;
  /** Etapa O5: moedas, a mochila, quando a stamina foi acertada e a corrida em andamento. */
  gold: number;
  bag: { item: string; count: number }[];
  stamina_at: number;
  run: RpgRunMark | null;
}

/** Herói novo [TFS schema.sql: level 1, vida 150, mana 0, cap 400, saldo de treino e stamina cheios]. */
export function newRpgHero(userId: string, now: number): RpgHeroDoc {
  const skills = {} as Record<SkillId, SkillState>;
  for (const s of SKILLS) skills[s] = freshSkill();
  return {
    _id: userId,
    v: RPG_VERSION,
    rev: 0,
    created_at: now,
    updated_at: now,
    vocation: 0,
    level: START.level,
    experience: 0,
    health_max: START.health,
    mana_max: START.mana,
    cap: START.cap,
    skills,
    magic: { level: 0, manaSpent: 0 },
    stamina: STAMINA.max,
    bank: { ms: TRAINING.maxBankMs, at: now },
    training: null,
    gold: 0,
    bag: [],
    stamina_at: now,
    run: null,
  };
}

/** Herói gravado antes da etapa O5: os campos novos com o valor de partida. */
export function normalizeHero(d: RpgHeroDoc): RpgHeroDoc {
  const x = d as Partial<RpgHeroDoc> & RpgHeroDoc;
  if (typeof x.gold !== "number") x.gold = 0;
  if (!Array.isArray(x.bag)) x.bag = [];
  if (typeof x.stamina_at !== "number") x.stamina_at = x.updated_at ?? 0;
  if (x.run === undefined) x.run = null;
  return x;
}

/** Na dungeon agora (uma marca muito velha, de corrida que não fechou, não prende o herói). */
export function inRun(d: RpgHeroDoc, now: number): boolean {
  return d.run !== null && now < d.run.ends_at + RUN_STALE_MS;
}

/** Stamina agora: recupera fora da dungeon [TFS regenerate_stamina.lua; aqui, desde a última corrida]. */
export function staminaNow(d: RpgHeroDoc, now: number): number {
  if (inRun(d, now)) return d.stamina;
  return regenStamina(d.stamina, Math.max(0, (now - d.stamina_at) / 1000));
}

/** Peso da mochila em centésimos de oz [TFS items.xml weight]. */
export function bagWeight(bag: readonly { item: string; count: number }[]): number {
  let w = 0;
  for (const b of bag) w += (itemDef(b.item)?.weight ?? 0) * b.count;
  return w;
}

function skillLevels(d: RpgHeroDoc): Record<SkillId, number> {
  const out = {} as Record<SkillId, number>;
  for (const k of SKILLS) out[k] = d.skills[k].level;
  return out;
}

/** O herói como entra na corrida: skills de agora, o melhor equipamento, a stamina de agora. */
export function heroRunSnapshot(
  d: RpgHeroDoc,
  name: string,
  now: number,
): RunHero {
  const skills = skillLevels(d);
  return {
    userId: d._id,
    name,
    vocation: d.vocation,
    level: d.level,
    healthMax: d.health_max,
    manaMax: d.mana_max,
    skills,
    magicLevel: d.magic.level,
    stamina: staminaNow(d, now),
    gear: bestGear(
      d.vocation,
      d.level,
      skills,
      d.mana_max,
      d.bag.map((b) => b.item),
    ),
  };
}

/**
 * Entra na dungeon: fecha um treino que tenha ficado aberto, acerta a stamina até agora (na
 * dungeon ela não recupera) e marca a corrida.
 */
export function markRun(
  d: RpgHeroDoc,
  mark: RpgRunMark,
  now: number,
  rates: Rates,
): RpgOutcome {
  if (d.vocation === 0) return { ok: false, reason: "no_vocation" };
  if (inRun(d, now)) return { ok: false, reason: "in_run" };
  stopTraining(d, now, rates);
  d.stamina = staminaNow({ ...d, run: null }, now);
  d.stamina_at = now;
  d.run = { ...mark };
  return { ok: true };
}

/** Desfaz a marca (a corrida não chegou a começar). */
export function unmarkRun(d: RpgHeroDoc, id: string): RpgOutcome {
  if (d.run?.id !== id) return { ok: false, reason: "not_in_run" };
  d.run = null;
  return { ok: true };
}

/** O que o fechamento da corrida fez no herói, para o app contar. */
export interface RunSettled {
  levelBefore: number;
  levelAfter: number;
  kept: { item: string; count: number }[];
  /** Não coube na mochila e virou moedas [nosso]. */
  sold: { item: string; count: number; gold: number }[];
}

/**
 * Fecha a corrida no herói, uma vez só: a marca tem de ser desta corrida. Gasta a stamina do
 * tempo na dungeon e, se ele não caiu, credita experiência, tentativas, mana, moedas e loot
 * (o que passa da capacidade é vendido na saída).
 */
export function settleRun(
  d: RpgHeroDoc,
  id: string,
  reward: RunReward | null,
  staminaCost: number,
  now: number,
): { ok: true; settled: RunSettled } | { ok: false; reason: string } {
  if (d.run?.id !== id) return { ok: false, reason: "not_in_run" };
  const voc = VOCATIONS[d.vocation];
  const settled: RunSettled = {
    levelBefore: d.level,
    levelAfter: d.level,
    kept: [],
    sold: [],
  };
  d.stamina = Math.max(0, d.stamina - staminaCost);
  d.stamina_at = now;
  d.run = null;
  if (!reward) return { ok: true, settled };
  const lv = addExperience(
    voc,
    {
      level: d.level,
      experience: d.experience,
      healthMax: d.health_max,
      manaMax: d.mana_max,
      cap: d.cap,
    },
    reward.exp,
  );
  d.level = lv.level;
  d.experience = lv.experience;
  d.health_max = lv.healthMax;
  d.mana_max = lv.manaMax;
  d.cap = lv.cap;
  settled.levelAfter = lv.level;
  for (const [k, n] of Object.entries(reward.tries) as [SkillId, number][])
    d.skills[k] = addSkillTries(voc, k, d.skills[k], n);
  d.magic = addManaSpent(voc, d.magic, reward.manaSpent);
  d.gold += reward.gold;
  const capacity = d.cap * 100;
  for (const l of reward.loot) {
    const def = itemDef(l.item);
    if (!def) continue;
    const w = def.weight * l.count;
    if (bagWeight(d.bag) + w <= capacity) {
      const prev = d.bag.find((b) => b.item === l.item);
      if (prev) prev.count += l.count;
      else d.bag.push({ item: l.item, count: l.count });
      settled.kept.push({ ...l });
    } else {
      const gold = def.value * l.count;
      d.gold += gold;
      settled.sold.push({ ...l, gold });
    }
  }
  return { ok: true, settled };
}

export type RpgOutcome = { ok: true } | { ok: false; reason: string };

/** Escolhe a vocação, só uma vez [TFS: a escolha é definitiva]. */
export function applyVocation(d: RpgHeroDoc, vocation: VocationId): RpgOutcome {
  if (d.vocation !== 0) return { ok: false, reason: "vocation_set" };
  if (vocation < 1 || vocation > 4)
    return { ok: false, reason: "bad_vocation" };
  d.vocation = vocation;
  return { ok: true };
}

/** Credita o que o treino aberto rendeu até `now` (sem fechar). Devolve se algo mudou. */
export function creditTraining(
  d: RpgHeroDoc,
  now: number,
  rates: Rates,
): boolean {
  const t = d.training;
  if (!t) return false;
  const voc = VOCATIONS[d.vocation];
  const { gain, creditedSeconds } = settleSession(voc, t, now, rates);
  if (creditedSeconds === t.creditedSeconds) return false;
  t.creditedSeconds = creditedSeconds;
  if (t.skill === "magia") d.magic = addManaSpent(voc, d.magic, gain.main);
  else
    d.skills[t.skill] = addSkillTries(
      voc,
      t.skill,
      d.skills[t.skill],
      gain.main,
    );
  d.skills.escudo = addSkillTries(voc, "escudo", d.skills.escudo, gain.escudo);
  return true;
}

/**
 * Fecha o treino em `now`: credita e devolve o saldo que sobrou. Se o orçamento acabou
 * antes, o treino terminou ali, e o saldo volta a encher a partir daquele instante.
 */
export function stopTraining(
  d: RpgHeroDoc,
  now: number,
  rates: Rates,
): boolean {
  const t = d.training;
  if (!t) return false;
  const end = Math.min(now, t.startedAt + t.budgetMs);
  creditTraining(d, end, rates);
  d.bank = bankAfter(t, end);
  d.training = null;
  return true;
}

/** Começa a treinar (fecha antes o treino anterior, se houver). */
export function startTraining(
  d: RpgHeroDoc,
  where: { instance: string; server: string; zone: string },
  skill: TrainingSkill,
  now: number,
  rates: Rates,
): RpgOutcome {
  if (d.vocation === 0) return { ok: false, reason: "no_vocation" };
  if (inRun(d, now)) return { ok: false, reason: "in_run" };
  const t = d.training;
  if (
    t &&
    t.instance === where.instance &&
    t.server === where.server &&
    t.skill === skill &&
    now < t.startedAt + t.budgetMs
  ) {
    return { ok: true };
  }
  stopTraining(d, now, rates);
  const bank = bankNow(d.bank, now);
  if (bank < TRAINING.minCreditMs) return { ok: false, reason: "no_bank" };
  const s = startSession({ ms: bank, at: now }, skill, now);
  d.bank = { ms: bank, at: now };
  d.training = { ...s, ...where };
  return { ok: true };
}

/** O treino aberto já esgotou o orçamento? */
export function trainingExpired(d: RpgHeroDoc, now: number): boolean {
  const t = d.training;
  return !!t && now >= t.startedAt + t.budgetMs;
}

export function rpgHeroView(
  d: RpgHeroDoc,
  rates: Rates,
  now: number,
): RpgHeroView {
  const voc = VOCATIONS[d.vocation];
  const skills = {} as RpgHeroView["skills"];
  for (const s of SKILLS) {
    const st = d.skills[s];
    skills[s] = {
      level: st.level,
      tries: st.tries,
      next: reqSkillTries(voc, s, st.level + 1),
    };
  }
  return {
    vocation: d.vocation,
    level: d.level,
    experience: d.experience,
    health_max: d.health_max,
    mana_max: d.mana_max,
    cap: d.cap,
    skills,
    magic: {
      level: d.magic.level,
      mana_spent: d.magic.manaSpent,
      next: reqMana(voc, d.magic.level + 1),
    },
    stamina: staminaNow(d, now),
    bank_ms: d.bank.ms,
    bank_at: d.bank.at,
    training: d.training
      ? {
          skill: d.training.skill,
          instance: d.training.instance,
          started_at: d.training.startedAt,
          budget_ms: d.training.budgetMs,
          credited_s: d.training.creditedSeconds,
        }
      : null,
    rates: { ...rates },
    gold: d.gold,
    bag: d.bag.map((b) => ({ ...b })),
    bag_weight: bagWeight(d.bag),
    gear: bestGear(
      d.vocation,
      d.level,
      skillLevels(d),
      d.mana_max,
      d.bag.map((b) => b.item),
    ),
    run: inRun(d, now) && d.run ? { ...d.run } : null,
  };
}

/** Teto do documento no Mongo (o herói é pequeno; isto pega um bug, não um jogador). */
export const RPG_DOC_MAX_BYTES = 16 * 1024;
export function rpgDocBytes(d: RpgHeroDoc): number {
  return Buffer.byteLength(JSON.stringify(d));
}
