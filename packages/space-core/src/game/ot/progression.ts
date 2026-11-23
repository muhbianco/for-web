import {
  type SkillId,
  type Vocation,
  MAX_LEVEL,
  MAX_MAGIC_LEVEL,
  MAX_SKILL,
  MIN_SKILL,
  SKILL_BASE,
} from "./data.ts";

/** Uma skill: o nível e as tentativas acumuladas para o próximo. */
export interface SkillState {
  level: number;
  tries: number;
}

/** O magic level e a mana gasta para o próximo. */
export interface MagicState {
  level: number;
  manaSpent: number;
}

/**
 * Tentativas para chegar ao nível `level` da skill [TFS vocation.cpp:141-148]:
 * `base × multiplicador^(level − 11)`, truncado como o cast para uint64.
 */
export function reqSkillTries(
  voc: Vocation,
  skill: SkillId,
  level: number,
): number {
  return Math.floor(
    SKILL_BASE[skill] * Math.pow(voc.skill[skill], level - (MIN_SKILL + 1)),
  );
}

/** Mana gasta para chegar ao magic level `level` [TFS vocation.cpp:150-156]. */
export function reqMana(voc: Vocation, level: number): number {
  if (level === 0) return 0;
  return Math.floor(1600 * Math.pow(voc.manaMultiplier, level - 1));
}

/** Progresso em pontos-base (0–10000) [TFS player.cpp getBasisPointLevel]. */
export function basisPoints(count: number, next: number): number {
  if (next === 0) return 0;
  const r = Math.floor((count * 10_000) / next);
  return r > 10_000 ? 0 : r;
}

/**
 * Soma `count` tentativas à skill [TFS player.cpp:479-528]: ao fechar o requisito, sobe e
 * o resto passa para o nível seguinte. As tentativas já vêm com a taxa do servidor
 * aplicada (quem chama multiplica). Para no teto `MAX_SKILL` [nosso].
 */
export function addSkillTries(
  voc: Vocation,
  skill: SkillId,
  s: SkillState,
  count: number,
): SkillState {
  let { level, tries } = s;
  if (count <= 0 || level >= MAX_SKILL) return s;
  let next = reqSkillTries(voc, skill, level + 1);
  while (tries + count >= next) {
    count -= next - tries;
    level++;
    tries = 0;
    if (level >= MAX_SKILL) return { level, tries: 0 };
    next = reqSkillTries(voc, skill, level + 1);
  }
  return { level, tries: tries + count };
}

/** Soma mana gasta ao magic level [TFS player.cpp:1660-1700], com o teto `MAX_MAGIC_LEVEL`. */
export function addManaSpent(
  voc: Vocation,
  m: MagicState,
  amount: number,
): MagicState {
  let { level, manaSpent } = m;
  if (amount <= 0 || level >= MAX_MAGIC_LEVEL) return m;
  let next = reqMana(voc, level + 1);
  while (manaSpent + amount >= next) {
    amount -= next - manaSpent;
    level++;
    manaSpent = 0;
    if (level >= MAX_MAGIC_LEVEL) return { level, manaSpent: 0 };
    next = reqMana(voc, level + 1);
  }
  return { level, manaSpent: manaSpent + amount };
}

/**
 * Experiência total para estar no level `lv` [TFS player.h:146-149]:
 * `(((lv − 6)·lv + 17)·lv − 12) / 6 × 100`, com a divisão inteira do original.
 */
export function expForLevel(lv: number): number {
  return Math.floor((((lv - 6) * lv + 17) * lv - 12) / 6) * 100;
}

/** O que o herói ganha ao subir de level: vida, mana e capacidade da vocação. */
export interface LevelState {
  level: number;
  experience: number;
  healthMax: number;
  manaMax: number;
  cap: number;
}

/**
 * Soma experiência [TFS player.cpp:1753-1790]. Cada level dá `gainHp`, `gainMana` e
 * `gainCap` da vocação. Quem chama aplica a taxa e os multiplicadores antes. Devolve
 * também quantos levels subiu (o TFS enche vida e mana nesse caso).
 */
export function addExperience(
  voc: Vocation,
  s: LevelState,
  exp: number,
): LevelState & { gained: number } {
  if (exp <= 0 || s.level >= MAX_LEVEL) return { ...s, gained: 0 };
  let { level, healthMax, manaMax, cap } = s;
  const experience = s.experience + exp;
  const start = level;
  while (level < MAX_LEVEL && experience >= expForLevel(level + 1)) {
    level++;
    healthMax += voc.gainHp;
    manaMax += voc.gainMana;
    cap += voc.gainCap;
  }
  return { level, experience, healthMax, manaMax, cap, gained: level - start };
}

/**
 * Bônus de experiência de level baixo, em % [TFS data/lib/core/player.lua:548-556]: do level 2
 * ao 50, `100 × (50 − level) / 48`; fora disso, 0.
 */
export function lowLevelBonus(level: number): number {
  if (level > 1 && level <= 50) return (100 * (50 - level)) / 48;
  return 0;
}

/** Uma skill nova no mínimo. */
export function freshSkill(): SkillState {
  return { level: MIN_SKILL, tries: 0 };
}
