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
export const STATS: readonly StatId[] = [
  "for",
  "agi",
  "vit",
  "int",
  "des",
  "sor",
];
export type Stats = Record<StatId, number>;

/**
 * Todo atributo começa em 1 [RO pc.cpp: personagem novo com 1 em cada]. Desde o rework de
 * 24/11/2026 ("o jogo não acaba nunca") não há teto: STAT_MAX é só a trava de sanidade de um
 * pedido (nenhum herói chega perto, pela escada de custo).
 */
export const STAT_MIN = 1;
export const STAT_MAX = 10_000;

/**
 * Pontos por level (decisão do dono, 24/11/2026: "cada level dá 5 pontos de status"). O ponto
 * custa mais a cada 10 do atributo (statCost) e, passado o 100, vale menos (statValue): cada
 * level compra menos, para sempre.
 */
export const POINTS_PER_LEVEL = 5;

/**
 * A escada de custo [RO pc.cpp PC_STATUS_POINT_COST, sem o teto do 99], a partir do 50 [nosso]:
 * até o 50 cada ponto custa 1 (o começo do jogo fica como era); do 51 ao 60 custa 2, do 61 ao 70
 * custa 3, e assim por diante, para sempre (do 191 ao 200 custa 16).
 */
export const STAT_LADDER_FROM = 51;
export function statCost(v: number): number {
  const x = Math.max(STAT_MIN, Math.floor(v));
  return x < STAT_LADDER_FROM ? 1 : 2 + Math.floor((x - STAT_LADDER_FROM) / 10);
}

/** Pontos para levar um atributo de 1 até `v` (a soma da escada, em fórmula fechada). */
export function statCostTo(v: number): number {
  const x = Math.max(STAT_MIN, Math.floor(v));
  if (x <= STAT_LADDER_FROM) return x - STAT_MIN;
  const m = x - STAT_LADDER_FROM;
  const q = Math.floor(m / 10);
  const r = m % 10;
  return STAT_LADDER_FROM - STAT_MIN + (10 * q * (q + 3)) / 2 + r * (q + 2);
}

/**
 * A escada de ganho [nosso]: até `STAT_SOFT` cada ponto vale cheio; dali em diante o ponto `v`
 * vale `STAT_SOFT / v`. A soma cresce como o logaritmo: sem teto, cada vez mais devagar (o 200
 * vale 169, o 300 vale 210, o 1000 vale 330).
 */
export const STAT_SOFT = 100;
export function statValue(v: number): number {
  return v <= STAT_SOFT ? v : STAT_SOFT + STAT_SOFT * Math.log(v / STAT_SOFT);
}

/** Os atributos como entram nas contas (statValue em cada um). */
export function effectiveStats(s: Stats): Stats {
  const out = { ...s };
  for (const k of STATS) out[k] = statValue(s[k]);
  return out;
}

/**
 * [nosso] Um número que cresce com o atributo sem passar de `cap`: perto do começo, igual a
 * `x`; depois, cada vez mais devagar (`cap · x / (x + cap)`). Velocidade, crítico, esquiva
 * perfeita, golpe mínimo e recarga usam isto: sem teto de atributo, nada passa do possível.
 */
export function softCap(x: number, cap: number): number {
  return x <= 0 ? 0 : (cap * x) / (x + cap);
}

export function freshStats(): Stats {
  return { for: 1, agi: 1, vit: 1, int: 1, des: 1, sor: 1 };
}

/** Pontos que o level dá no total [nosso: o level 1 já dá os seus 5]. */
export function statPointsTotal(level: number): number {
  return POINTS_PER_LEVEL * Math.max(1, Math.floor(level));
}

/** Pontos já postos: o custo da escada de cada atributo, do 1 até onde está. */
export function statPointsSpent(s: Stats): number {
  let n = 0;
  for (const k of STATS) n += statCostTo(s[k]);
  return n;
}

export function statPointsFree(s: Stats, level: number): number {
  return statPointsTotal(level) - statPointsSpent(s);
}

/** Atributos válidos: inteiros a partir de 1, com o custo da escada dentro dos pontos do level. */
export function validStats(s: unknown, level: number): s is Stats {
  if (typeof s !== "object" || s === null) return false;
  for (const k of STATS) {
    const v = (s as Record<string, unknown>)[k];
    if (
      !Number.isInteger(v) ||
      (v as number) < STAT_MIN ||
      (v as number) > STAT_MAX
    )
      return false;
  }
  return statPointsFree(s as Stats, level) >= 0;
}

/**
 * Soma `add` (quanto sobe cada atributo, todos ≥ 0) aos atributos, se o custo da escada couber
 * nos pontos do level.
 * Devolve os atributos novos ou o motivo da recusa.
 */
export function addStats(
  s: Stats,
  add: Partial<Record<StatId, number>>,
  level: number,
):
  | { ok: true; stats: Stats }
  | { ok: false; reason: "bad_points" | "stat_max" | "no_points" } {
  const next = { ...s };
  let total = 0;
  for (const k of STATS) {
    const n = add[k] ?? 0;
    if (!Number.isInteger(n) || n < 0)
      return { ok: false, reason: "bad_points" };
    next[k] += n;
    total += n;
    if (next[k] > STAT_MAX) return { ok: false, reason: "stat_max" };
  }
  if (total === 0) return { ok: false, reason: "bad_points" };
  if (statPointsFree(next, level) < 0)
    return { ok: false, reason: "no_points" };
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
 * cada ponto de MATQ é +0,15% de dano e de cura das magias. Com FOR 50 (ATQ 75) a arma bate
 * 30% mais; com INT 50 (MATQ 99~150) a magia sai entre 15% e 22% mais forte. A magia já cresce
 * com o magic level do OT: com +0,25% o mago sozinho vencia até a última dungeon (simulador,
 * 24/11/2026).
 */
export const ATK_PCT = 0.4;
export const MATK_PCT = 0.15;

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

/**
 * O que os atributos dão. Desde 24/11/2026 entra o valor de cada atributo (statValue, a escada
 * de ganho), e o que tinha teto no Ragnarok pelo 99 tem teto aqui pela curva (softCap): no
 * começo os números são os de antes; no alto, a velocidade de ataque não passa de 2,5 vezes, o
 * crítico de 60%, a esquiva perfeita de 40%, o golpe mínimo de 90% do máximo e a recarga não
 * cai abaixo da metade.
 */
export function derive(raw: Stats, level: number): Derived {
  const s = effectiveStats(raw);
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
    // [RO] − (4·AGI + DES)/1000, com a mesma inclinação no começo e no máximo −60%.
    aspd: 1 - 0.6 * (1 - Math.exp(-(4 * s.agi + s.des) / 600)),
    flee: Math.floor(level + s.agi),
    perfectDodge: softCap((s.sor + 10) / 10, 40),
    crit: softCap(1 + s.sor / 3, 60),
    hitBonus: Math.floor(s.des / 3),
    minRoll: softCap(s.des / 200, 0.9),
    cooldown: 1 - softCap(s.des / 300, 0.5),
    capBonus: Math.floor(raw.for) * 10,
    vitDef: [
      Math.floor(vMin * SOFT_DEF_SCALE),
      Math.floor(vMax * SOFT_DEF_SCALE),
    ],
    mdef: Math.floor((s.int + Math.floor(s.vit / 2)) * SOFT_DEF_SCALE),
  };
}

/** Vida e mana máximas com VIT e INT [RO: × (1 + atributo/100), truncado], pelo valor do atributo. */
export function withVit(healthMax: number, s: Stats): number {
  return Math.floor(healthMax * (1 + statValue(s.vit) / 100));
}
export function withInt(manaMax: number, s: Stats): number {
  return Math.floor(manaMax * (1 + statValue(s.int) / 100));
}

/**
 * Chance de um golpe físico do monstro acertar, em % [RO battle.cpp is_attack_hitting,
 * pré-renovação]: `80 + HIT − FLEE`, entre 5 e 100. O HIT do monstro é level + DES; [nosso] os
 * nossos monstros têm DES igual ao level. Com 3 ou mais monstros em cima, a esquiva cai 10%
 * por monstro além do segundo [RO agi_penalty_type 1, count 3, num 10].
 */
export function monsterHitChance(
  monsterLevel: number,
  flee: number,
  attackers = 1,
): number {
  let f = flee;
  if (attackers >= 3)
    f = Math.max(1, Math.floor((f * (100 - (attackers - 2) * 10)) / 100));
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
