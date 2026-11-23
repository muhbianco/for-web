import {
  type MagicState,
  type Rates,
  type RpgHeroView,
  type SkillId,
  type SkillState,
  type TrainingBank,
  type TrainingSession,
  type TrainingSkill,
  type VocationId,
  addManaSpent,
  addSkillTries,
  bankAfter,
  bankNow,
  freshSkill,
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
  };
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

export function rpgHeroView(d: RpgHeroDoc, rates: Rates): RpgHeroView {
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
    stamina: d.stamina,
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
  };
}

/** Teto do documento no Mongo (o herói é pequeno; isto pega um bug, não um jogador). */
export const RPG_DOC_MAX_BYTES = 16 * 1024;
export function rpgDocBytes(d: RpgHeroDoc): number {
  return Buffer.byteLength(JSON.stringify(d));
}
