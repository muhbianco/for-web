/**
 * Atributos do herói no modelo do Ragnarok (pedido do dono em 24/11/2026: "um painel de status
 * para distribuir pontos FOR, AGI, VIT, INT, DES e SOR iguais ao do Ragnarok"). As fórmulas são
 * as do rAthena pré-renovação (src/map/status.cpp, battle.cpp e pc.cpp, lidos em 24/11/2026),
 * reimplementadas. O que é do Ragnarok fica marcado [RO arquivo função]; o que é nosso, [nosso].
 *
 * O herói continua com a base do OT (skills de arma e magic level treinados no dummy,
 * ataque das armas, armadura, magias): os atributos entram por cima, cada um no papel que
 * tem no Ragnarok, numa escala convertida para os números do OT (o dano de um golpe do OT
 * é uma fração do de um golpe do Ragnarok no mesmo ponto do jogo).
 */

export type StatId = "for" | "agi" | "vit" | "int" | "des" | "sor";
export const STATS: readonly StatId[] = ["for", "agi", "vit", "int", "des", "sor"];
export type Stats = Record<StatId, number>;

/** Todo atributo começa em 1 [RO pc.cpp: personagem novo com 1 em cada] e vai até 99 [RO pré-renovação]. */
export const STAT_MIN = 1;
export const STAT_MAX = 99;

/**
 * Pontos por level (decisão do dono, 24/11/2026: "cada level dá 5 pontos de status"). O
 * Ragnarok dá de 3 a 22 pontos por level e cobra mais por ponto a cada 10 [RO pc.cpp
 * PC_STATUS_POINT_COST]; com 5 fixos, cada ponto vale +1 [nosso].
 */
export const POINTS_PER_LEVEL = 5;

export function freshStats(): Stats {
  return { for: 1, agi: 1, vit: 1, int: 1, des: 1, sor: 1 };
}

/** Pontos que o level dá no total [nosso: o level 1 já dá os seus 5]. */
export function statPointsTotal(level: number): number {
  return POINTS_PER_LEVEL * Math.max(1, Math.floor(level));
}

/** Pontos já postos (o que passou de 1 em cada atributo). */
export function statPointsSpent(s: Stats): number {
  let n = 0;
  for (const k of STATS) n += s[k] - STAT_MIN;
  return n;
}

export function statPointsFree(s: Stats, level: number): number {
  return statPointsTotal(level) - statPointsSpent(s);
}

/** Atributos válidos: inteiros entre 1 e 99, sem passar dos pontos do level. */
export function validStats(s: unknown, level: number): s is Stats {
  if (typeof s !== "object" || s === null) return false;
  for (const k of STATS) {
    const v = (s as Record<string, unknown>)[k];
    if (!Number.isInteger(v) || (v as number) < STAT_MIN || (v as number) > STAT_MAX) return false;
  }
  return statPointsFree(s as Stats, level) >= 0;
}

/**
 * Soma `add` (pontos por atributo, todos ≥ 0) aos atributos, se couber no level e no teto.
 * Devolve os atributos novos ou o motivo da recusa.
 */
export function addStats(
  s: Stats,
  add: Partial<Record<StatId, number>>,
  level: number,
): { ok: true; stats: Stats } | { ok: false; reason: "bad_points" | "stat_max" | "no_points" } {
  const next = { ...s };
  let total = 0;
  for (const k of STATS) {
    const n = add[k] ?? 0;
    if (!Number.isInteger(n) || n < 0) return { ok: false, reason: "bad_points" };
    next[k] += n;
    total += n;
    if (next[k] > STAT_MAX) return { ok: false, reason: "stat_max" };
  }
  if (total === 0) return { ok: false, reason: "bad_points" };
  if (statPointsFree(next, level) < 0) return { ok: false, reason: "no_points" };
  return { ok: true, stats: next };
}

/**
 * Ataque base [RO status.cpp status_base_atk, pré-renovação, jogador]: o atributo principal mais
 * (principal/10)², mais o secundário/5 e SOR/5. No corpo a corpo o principal é FOR e o
 * secundário DES; com arma de distância os dois trocam.
 */
export function baseAtk(s: Stats, ranged: boolean): number {
  const main = ranged ? s.des : s.for;
  const second = ranged ? s.for : s.des;
  const d = Math.floor(main / 10);
  return main + d * d + Math.floor(second / 5) + Math.floor(s.sor / 5);
}

/** MATQ mínimo e máximo [RO status.cpp status_base_matk_min/max, pré-renovação]: INT + (INT/7)², INT + (INT/5)². */
export function baseMatk(s: Stats): [number, number] {
  const a = Math.floor(s.int / 7);
  const b = Math.floor(s.int / 5);
  return [s.int + a * a, s.int + b * b];
}

/**
 * [nosso] Escala do Ragnarok para o OT: cada ponto de ataque base é +0,4% de dano da arma, e
 * cada ponto de MATQ é +0,25% de dano e de cura das magias. Com FOR 50 (ATQ 75) a arma bate
 * 30% mais; com INT 50 (MATQ 99~150) a magia sai entre 25% e 37% mais forte.
 */
export const ATK_PCT = 0.4;
export const MATK_PCT = 0.25;

/** Escala da defesa da VIT e da INT sobre o dano do OT [nosso]: um quarto da do Ragnarok. */
export const SOFT_DEF_SCALE = 0.25;

/** O que os atributos dão, já calculado para o level. */
export interface Derived {
  /** Ataque base corpo a corpo e à distância [RO] e o dano a mais da arma, em % [nosso]. */
  atk: number;
  atkRanged: number;
  meleePct: number;
  rangedPct: number;
  /** MATQ [RO] e a faixa de dano/cura a mais das magias, em % [nosso]. */
  matk: [number, number];
  magicPct: [number, number];
  /** Vida e mana máximas a mais, em % [RO status_calc_maxhp_pc/maxsp_pc: × (1 + VIT/100), × (1 + INT/100)]. */
  hpPct: number;
  mpPct: number;
  /** Vida e mana a mais por tique da regeneração [RO status.cpp regen: + VIT/5 e + INT/6]. */
  hpRegen: number;
  mpRegen: number;
  /** O intervalo entre ataques é multiplicado por isto [RO status_base_amotion_pc: − (4·AGI + DES)/1000]. */
  aspd: number;
  /** Esquiva [RO status_calc_misc: level + AGI] e esquiva perfeita em % [RO flee2: (SOR + 10)/10]. */
  flee: number;
  perfectDodge: number;
  /** Crítico em % [RO status_calc_misc pré-renovação: (10 + SOR·10/3)/10]. */
  crit: number;
  /** [nosso] Pontaria à distância: + DES/3 pontos de acerto (o HIT do Ragnarok é level + DES). */
  hitBonus: number;
  /** [nosso] O golpe não sai abaixo desta fração do máximo (a DES do Ragnarok sobe o mínimo da arma). */
  minRoll: number;
  /** [nosso] As recargas das habilidades encolhem por isto (o Ragnarok corta a conjuração com DES/150). */
  cooldown: number;
  /** [nosso] Capacidade a mais, em oz (o Ragnarok dá +30 de peso por FOR). */
  capBonus: number;
  /** Defesa da VIT [RO battle.cpp, pré-renovação, jogador], já na escala do OT: mínimo e máximo. */
  vitDef: [number, number];
  /** Defesa mágica suave [RO status_calc_misc pré-renovação: INT + VIT/2], na escala do OT. */
  mdef: number;
}

/**
 * Defesa da VIT de um jogador contra um golpe físico [RO battle.cpp battle_calc_defense,
 * pré-renovação]: `VIT·0,3 + rnd(0, VIT²/150 − VIT·0,3 − 1) + VIT·0,5`. Devolve a faixa.
 */
export function vitDefRange(vit: number): [number, number] {
  const a = Math.floor((3 * vit) / 10);
  const spread = Math.max(0, Math.floor((vit * vit) / 150) - a - 1);
  const b = Math.floor(vit / 2);
  return [a + b, a + spread + b];
}

export function derive(s: Stats, level: number): Derived {
  const atk = baseAtk(s, false);
  const atkRanged = baseAtk(s, true);
  const matk = baseMatk(s);
  const [vMin, vMax] = vitDefRange(s.vit);
  return {
    atk,
    atkRanged,
    meleePct: atk * ATK_PCT,
    rangedPct: atkRanged * ATK_PCT,
    matk,
    magicPct: [matk[0] * MATK_PCT, matk[1] * MATK_PCT],
    hpPct: s.vit,
    mpPct: s.int,
    hpRegen: Math.floor(s.vit / 5),
    mpRegen: Math.floor(s.int / 6),
    aspd: 1 - (4 * s.agi + s.des) / 1000,
    flee: level + s.agi,
    perfectDodge: (s.sor + 10) / 10,
    crit: (10 + Math.floor((s.sor * 10) / 3)) / 10,
    hitBonus: Math.floor(s.des / 3),
    minRoll: s.des / 200,
    cooldown: 1 - s.des / 300,
    capBonus: s.for * 10,
    vitDef: [Math.floor(vMin * SOFT_DEF_SCALE), Math.floor(vMax * SOFT_DEF_SCALE)],
    mdef: Math.floor((s.int + Math.floor(s.vit / 2)) * SOFT_DEF_SCALE),
  };
}

/** Vida e mana máximas com VIT e INT [RO: × (1 + atributo/100), truncado]. */
export function withVit(healthMax: number, s: Stats): number {
  return Math.floor(healthMax * (1 + s.vit / 100));
}
export function withInt(manaMax: number, s: Stats): number {
  return Math.floor(manaMax * (1 + s.int / 100));
}

/**
 * Chance de um golpe físico do monstro acertar, em % [RO battle.cpp is_attack_hitting,
 * pré-renovação]: `80 + HIT − FLEE`, entre 5 e 100. O HIT do monstro é level + DES; [nosso] os
 * nossos monstros têm DES igual ao level. Com 3 ou mais monstros em cima, a esquiva cai 10%
 * por monstro além do segundo [RO agi_penalty_type 1, count 3, num 10].
 */
export function monsterHitChance(monsterLevel: number, flee: number, attackers = 1): number {
  let f = flee;
  if (attackers >= 3) f = Math.max(1, Math.floor((f * (100 - (attackers - 2) * 10)) / 100));
  const hit = 2 * monsterLevel;
  return Math.max(5, Math.min(100, 80 + hit - f));
}

/** Os nomes que o app mostra (como no Ragnarok em português). */
export const STAT_NAMES: Readonly<Record<StatId, string>> = {
  for: "FOR",
  agi: "AGI",
  vit: "VIT",
  int: "INT",
  des: "DES",
  sor: "SOR",
};
