import type { VocationId } from "./data.ts";
import { VOCATIONS } from "./data.ts";
import type { Element } from "./items.ts";
import { JOB } from "./job.ts";
import type { SpellFormula } from "./spells.ts";

/**
 * Habilidades e árvore do herói (pedido do dono em 24/11/2026). Toda classe tem 4 habilidades
 * fixas, de saída; a árvore não traz habilidade nova, dá "adereços" a essas quatro (mais força,
 * menos mana, recarga menor, alvo a mais, segundo golpe, elemento, atordoar...). Os pontos da
 * árvore vêm do treino no dummy de habilidade (training.ts, `habilidade`), não do level. A
 * árvore tem três partes, uma por classe: a 2ª e a 3ª abrem com a evolução no Mestre.
 *
 * O número de partida de cada habilidade é o da magia do TFS citada nela (data/scripts/spells):
 * mana, recarga e fórmula. Os adereços são nossos [nosso], no papel das skills do Ragnarok
 * (Bash atordoa, Double Strafe bate duas vezes, Arrow Shower pega mais de um...).
 */

/** A classe pela evolução: 1 (a de saída), 2 (promovida) e 3. */
export type JobTier = 1 | 2 | 3;

/** As quatro classes (vocações base do OT). */
export type ClassId = 1 | 2 | 3 | 4;

export const JOB_NAMES: Readonly<
  Record<ClassId, readonly [string, string, string]>
> = {
  1: ["Feiticeiro", "Arquimago", "Grão-mago"],
  2: ["Druida", "Ancião", "Primevo"],
  3: ["Arqueiro", "Caçador", "Sentinela"],
  4: ["Cavaleiro", "Campeão", "Senhor da guerra"],
};

/**
 * O que a evolução pede [nosso]. A 2ª classe é a promoção que já existia (level 20 e 20.000 de
 * ouro [TFS promotion.lua]) e agora pede também pontos postos na árvore, no papel do nível de
 * classe 40 que o Ragnarok pede para a troca de classe. A 3ª é nova.
 */
export const EVOLUTION: Readonly<
  Record<2 | 3, { level: number; cost: number; points: number }>
> = {
  2: { level: 20, cost: 20_000, points: 8 },
  3: { level: 50, cost: 150_000, points: 24 },
};

/** A classe de um herói pela vocação (a promovida já é a 2ª) e pela marca da 3ª. */
export function jobTier(vocation: VocationId, third: boolean): JobTier {
  const v = VOCATIONS[vocation];
  if (v.id === v.base) return 1;
  return third ? 3 : 2;
}

export function jobName(vocation: VocationId, tier: JobTier): string {
  const base = VOCATIONS[vocation].base;
  if (base === 0) return VOCATIONS[0].name;
  return JOB_NAMES[base as ClassId][tier - 1]!;
}

/**
 * Redistribuir no Mestre [nosso]: a primeira vez de cada (atributos, árvore) é de graça; depois,
 * 500 de ouro por level. Os atributos só voltam por aqui, como no Ragnarok (o reset é do NPC).
 */
export function resetCost(level: number, done: number): number {
  return done <= 0 ? 0 : 500 * Math.max(1, Math.floor(level));
}

/** Por que não evolui agora (null: pode). */
export function cannotEvolve(
  vocation: VocationId,
  tier: JobTier,
  level: number,
  pointsSpent: number,
): "no_vocation" | "max_tier" | "level" | "points" | null {
  if (VOCATIONS[vocation].base === 0) return "no_vocation";
  if (tier >= 3) return "max_tier";
  const req = EVOLUTION[(tier + 1) as 2 | 3];
  if (level < req.level) return "level";
  if (pointsSpent < req.points) return "points";
  return null;
}

// ---- habilidades --------------------------------------------------------------

/**
 * O tipo da habilidade. "foco" (24/11/2026): reforço do próprio herói por um tempo (a
 * Concentração do Arqueiro do Ragnarok).
 */
export type AbilityKind =
  | "ataque"
  | "area"
  | "cura"
  | "cura-outro"
  | "desafio"
  | "foco";

/**
 * A Concentração [RO AC_CONCENTRATION: AGI e DES a mais por um tempo], na nossa escala: por
 * `durationMs` (mais os adereços de fôlego), os tiros saem `dmgPct`% mais fortes e
 * `aspdPct`% mais rápidos, os dois vezes a força dos adereços.
 */
export const CONCENTRATION = { durationMs: 10_000, dmgPct: 10, aspdPct: 8 };

export interface AbilityDef {
  id: string;
  name: string;
  cls: ClassId;
  kind: AbilityKind;
  element: Element | "cura";
  mana: number;
  cooldownMs: number;
  formula: SpellFormula;
  /** O golpe passa pela armadura do alvo [TFS COMBAT_PARAM_BLOCKARMOR]. */
  blockArmor?: boolean;
  /** De onde vêm os números. */
  source: string;
  blurb: string;
}

const magia = (
  min: [number, number],
  max: [number, number],
  mlCap?: number,
): SpellFormula =>
  mlCap === undefined
    ? { type: "magia", min, max }
    : { type: "magia", min, max, mlCap };
const arma = (min: [number, number], max: [number, number]): SpellFormula => ({
  type: "arma",
  min,
  max,
});
/**
 * [nosso] Os magos no modelo do cavaleiro (24/11/2026, pedido do dono): a varinha é a base e
 * cresce com o magic level (spells.ts WAND_ML); as magias de ataque são a menor parte do dano,
 * porque o renascimento cresce a árvore sem teto. A fórmula do TFS fica escrita e leva esta
 * fração: as de um alvo 0,3 (recarga ×4), as de área 0,45 (recarga ×3), para as salas cheias
 * ainda caírem juntas (com 0,3 o feiticeiro levava 13% mais dano na Cidadela).
 */
const MAGE_ATTACK = 0.3;
const MAGE_AREA = 0.45;
const magiaX = (
  min: [number, number],
  max: [number, number],
  k: number,
): SpellFormula => ({
  type: "magia",
  min: [min[0] * k, min[1] * k],
  max: [max[0] * k, max[1] * k],
});

const tiro = (min: number, max: number): SpellFormula => ({
  type: "tiro",
  min,
  max,
});

export const ABILITIES: readonly AbilityDef[] = [
  // ---- Cavaleiro ----------------------------------------------------------------
  {
    id: "golpe-brutal",
    name: "Golpe brutal",
    cls: 4,
    kind: "ataque",
    element: "fisico",
    mana: 30,
    cooldownMs: 6000,
    formula: arma([0.02, 4], [0.04, 9]),
    blockArmor: true,
    source: "brutal_strike.lua",
    blurb: "Um golpe forte com a arma no alvo do grupo.",
  },
  {
    id: "giro-da-lamina",
    name: "Giro da lâmina",
    cls: 4,
    kind: "area",
    element: "fisico",
    mana: 35,
    cooldownMs: 4000,
    formula: arma([0.02, 5], [0.04, 9]),
    blockArmor: true,
    source: "berserk.lua",
    blurb: "Gira a arma e acerta todos os monstros da sala.",
  },
  {
    id: "atadura",
    name: "Atadura",
    cls: 4,
    kind: "cura",
    element: "cura",
    mana: 10,
    cooldownMs: 1000,
    formula: magia([1.4, 8], [1.8, 11], 20),
    source: "bruise_bane.lua",
    blurb: "Cura a si mesmo quando a vida cai da metade.",
  },
  {
    id: "desafio",
    name: "Desafio",
    cls: 4,
    kind: "desafio",
    element: "fisico",
    mana: 40,
    cooldownMs: 2000,
    formula: { type: "fixa", min: 0, max: 0 },
    source: "challenge.lua",
    blurb:
      "Quando um monstro bate em outra pessoa, puxa a sala inteira para si por 8 s.",
  },
  // ---- Arqueiro (24/11/2026: o Arqueiro do Ragnarok, físico, sem magia nem cura) ----
  // O dano sai do tiro do arco com a flecha (fórmula "tiro"); a mana paga cada uma.
  // [nosso] 24/11/2026, à noite (pedido do dono): no modelo do cavaleiro, as habilidades são a
  // menor parte do dano e o tiro normal é a base (data.ts ARCHER_DIST_DAMAGE). Antes saíam a cada
  // 2 a 6 s com 1 a 2,3 tiros máximos e faziam 84% do dano no level 60; agora são tiros especiais
  // de recarga longa (a DES ainda corta até a metade), ~30% do dano, e 400 renascimentos dão
  // ×1,2, como no cavaleiro (scripts/rebirth-lab.ts). Os fatores são do tiro máximo já com o multiplicador do arqueiro.
  {
    id: "rajada-dupla",
    name: "Rajada dupla",
    cls: 3,
    kind: "ataque",
    element: "fisico",
    mana: 30,
    cooldownMs: 16_000,
    formula: tiro(0.2, 0.27),
    blockArmor: true,
    source: "RO AC_DOUBLE (Double Strafe)",
    blurb: "Duas flechas seguidas no alvo do grupo, pelo dano do arco.",
  },
  {
    id: "chuva-de-flechas",
    name: "Chuva de flechas",
    cls: 3,
    kind: "area",
    element: "fisico",
    mana: 45,
    cooldownMs: 24_000,
    formula: tiro(0.1, 0.15),
    blockArmor: true,
    source: "RO AC_SHOWER (Arrow Shower)",
    blurb: "Uma chuva de flechas em todos os monstros da sala.",
  },
  {
    id: "flecha-carregada",
    name: "Flecha carregada",
    cls: 3,
    kind: "ataque",
    element: "fisico",
    mana: 40,
    cooldownMs: 32_000,
    formula: tiro(0.31, 0.42),
    blockArmor: true,
    source: "RO AC_CHARGEARROW (Arrow Repel)",
    blurb: "Um tiro tenso e forte no alvo do grupo.",
  },
  {
    id: "concentracao",
    name: "Concentração",
    cls: 3,
    kind: "foco",
    element: "fisico",
    mana: 30,
    cooldownMs: 20_000,
    formula: { type: "fixa", min: 0, max: 0 },
    source: "RO AC_CONCENTRATION (Improve Concentration)",
    blurb: "Por 10 s, os tiros saem 10% mais fortes e 8% mais rápidos.",
  },
  // ---- Feiticeiro ---------------------------------------------------------------
  {
    id: "golpe-de-raio",
    name: "Golpe de raio",
    cls: 1,
    kind: "ataque",
    element: "energia",
    mana: 20,
    cooldownMs: 8000,
    formula: magiaX([1.4, 8], [2.2, 14], MAGE_ATTACK),
    source: "energy_strike.lua",
    blurb: "Energia no alvo do grupo.",
  },
  {
    id: "golpe-de-chama",
    name: "Golpe de chama",
    cls: 1,
    kind: "ataque",
    element: "fogo",
    mana: 20,
    cooldownMs: 8000,
    formula: magiaX([1.4, 8], [2.2, 14], MAGE_ATTACK),
    source: "flame_strike.lua",
    blurb: "Fogo no alvo do grupo.",
  },
  {
    id: "onda-de-fogo",
    name: "Onda de fogo",
    cls: 1,
    kind: "area",
    element: "fogo",
    mana: 25,
    cooldownMs: 12_000,
    formula: magiaX([1.2, 7], [2, 12], MAGE_AREA),
    source: "fire_wave.lua",
    blurb: "Uma onda de fogo que pega todos os monstros da sala.",
  },
  {
    id: "remendo",
    name: "Remendo",
    cls: 1,
    kind: "cura",
    element: "cura",
    mana: 6,
    cooldownMs: 1000,
    formula: magia([0.6, 3], [1, 6], 20),
    source: "magic_patch.lua",
    blurb: "Cura a si mesmo quando a vida cai da metade.",
  },
  // ---- Druida -------------------------------------------------------------------
  {
    id: "golpe-de-gelo",
    name: "Golpe de gelo",
    cls: 2,
    kind: "ataque",
    element: "gelo",
    mana: 20,
    cooldownMs: 8000,
    formula: magiaX([1.4, 8], [2.2, 14], MAGE_ATTACK),
    source: "ice_strike.lua",
    blurb: "Gelo no alvo do grupo.",
  },
  {
    id: "onda-de-gelo",
    name: "Onda de gelo",
    cls: 2,
    kind: "area",
    element: "gelo",
    mana: 25,
    cooldownMs: 12_000,
    formula: magiaX([0.8, 5], [2, 12], MAGE_AREA),
    source: "ice_wave.lua",
    blurb: "Uma onda de gelo que pega todos os monstros da sala.",
  },
  {
    id: "cura-do-companheiro",
    name: "Cura do companheiro",
    cls: 2,
    kind: "cura-outro",
    element: "cura",
    mana: 120,
    cooldownMs: 1000,
    formula: magia([6.3, 45], [14.4, 90]),
    source: "heal_friend.lua",
    blurb: "Cura quem do grupo cair abaixo de 40% da vida.",
  },
  {
    id: "seiva",
    name: "Seiva",
    cls: 2,
    kind: "cura",
    element: "cura",
    mana: 6,
    cooldownMs: 1000,
    formula: magia([0.6, 3], [1, 6], 20),
    source: "magic_patch.lua",
    blurb: "Cura a si mesmo quando a vida cai da metade.",
  },
];

export function abilityDef(id: string): AbilityDef | undefined {
  return ABILITIES.find((a) => a.id === id);
}

/** As 4 habilidades da classe, na ordem da ficha. */
export function abilitiesOf(cls: number): AbilityDef[] {
  return ABILITIES.filter((a) => a.cls === cls);
}

// ---- árvore ---------------------------------------------------------------------

/** O que um adereço faz, por ponto posto nele. */
export type NodeEffect =
  /** Dano ou cura a mais, em %. */
  | { t: "power"; pct: number }
  /** Mana a menos, em %. */
  | { t: "cost"; pct: number }
  /** Recarga a menos, em ms. */
  | { t: "cooldown"; ms: number }
  /** Monstros a mais no mesmo golpe (habilidade de alvo). */
  | { t: "targets"; n: number }
  /** Um segundo golpe no mesmo alvo, com esta % do primeiro. */
  | { t: "echo"; pct: number }
  /** Esta % do dano volta como vida para quem lançou. */
  | { t: "leech"; pct: number }
  /** Chance (%) de atrasar o próximo ataque do monstro atingido em `ms`. */
  | { t: "stun"; chance: number; ms: number }
  /** O golpe passa a ser deste elemento. */
  | { t: "element"; element: Element }
  /** Troca a fórmula (e a mana) pela de outra magia do TFS. */
  | {
      t: "formula";
      formula: SpellFormula;
      mana: number;
      name: string;
      source: string;
      /** A magia nova é de outro elemento (a onda de raízes é de terra). */
      element?: Element;
    }
  /** A cura dispara mais cedo: o limite sobe estes pontos de % da vida. */
  | { t: "trigger"; pct: number }
  /** A cura também cura o resto do grupo, com esta % do valor. */
  | { t: "group"; pct: number }
  /** O desafio prende por mais `ms`. */
  | { t: "focus"; ms: number }
  /** Enquanto o desafio prende, o dano que o cavaleiro leva cai esta %. */
  | { t: "guard"; pct: number }
  /**
   * [nosso] 24/11/2026: chance (%) de a habilidade sair crítica (×CRIT_MULT, golpe ou cura); na
   * Concentração, a chance de crítico dos tiros enquanto ela dura.
   */
  | { t: "crit"; pct: number }
  /** [nosso] 24/11/2026: a habilidade ignora esta % da armadura e da resistência do monstro. */
  | { t: "pierce"; pct: number }
  /** [nosso] 24/11/2026: enquanto o desafio prende, a Proteção do cavaleiro sobe esta %. */
  | { t: "cover"; pct: number };

export interface TreeNode {
  id: string;
  ability: string;
  tier: JobTier;
  name: string;
  /**
   * Os pontos que davam o efeito cheio até 24/11/2026. Desde então o adereço sobe em ups: o
   * efeito cheio de antes vale UPS_FULL ups (cada up é `ranks / UPS_FULL` do ponto de antes) e
   * ele vai até o teto da classe (TIER_MAX_UPS).
   */
  ranks: number;
  /** Precisa de ao menos 1 ponto neste outro adereço. */
  requires?: string;
  effect: NodeEffect;
}

/**
 * [nosso] 24/11/2026 (pedido do dono): os adereços sobem em ups. O efeito cheio de cada um até
 * então vale UPS_FULL ups; o teto de ups sobe com a evolução no Mestre (TIER_MAX_UPS) até 20.
 */
export const UPS_FULL = 5;
export const TIER_MAX_UPS: Readonly<Record<JobTier, number>> = { 1: 5, 2: 10, 3: 20 };
export const MAX_UPS = 20;
/**
 * O quanto rende cada up depois do UPS_FULL, perto do de antes (1 = igual). Ajustado no
 * balanceamento: as habilidades continuam a menor parte do dano (rebirth-lab.ts).
 */
export const LATE_UP = 0.5;
/** A troca de magia sai no 1º up; cada up a mais soma este % ao poder da habilidade. */
export const FORMULA_UP_PCT = 3;
/** Crítico de habilidade: o golpe ou a cura sai assim mais forte. */
export const CRIT_MULT = 1.5;

/** O peso de `ups` em ups cheios (os depois do UPS_FULL rendem LATE_UP). */
export function upsWeight(ups: number): number {
  return Math.min(ups, UPS_FULL) + Math.max(0, ups - UPS_FULL) * LATE_UP;
}

/** O efeito de `ups` num adereço, em pontos de antes (o que `effect` multiplica). */
export function nodeUnits(node: Pick<TreeNode, "ranks">, ups: number): number {
  return (upsWeight(ups) * node.ranks) / UPS_FULL;
}

/** O que o herói pôs na árvore: id do adereço → ups. */
export type Tree = Record<string, number>;

const N = (
  ability: string,
  key: string,
  tier: JobTier,
  name: string,
  ranks: number,
  effect: NodeEffect,
  requires?: string,
): TreeNode => ({
  id: `${ability}.${key}`,
  ability,
  tier,
  name,
  ranks,
  effect,
  ...(requires ? { requires: `${ability}.${requires}` } : {}),
});

/**
 * Os ramos de uma habilidade de ataque: força (5) e economia (3) na 1ª classe, um adereço de
 * forma (1) e força II (5) na 2ª, um de fecho (1) e recarga (2) na 3ª.
 */
function attackBranch(
  ability: string,
  costPct: number,
  t2: { key: string; name: string; effect: NodeEffect },
  t3: { key: string; name: string; effect: NodeEffect },
  cooldownMs = 500,
  extra?: { key: string; name: string; effect: NodeEffect },
): TreeNode[] {
  return [
    // 24/11/2026: o adereço novo de cada habilidade (crítico ou perfurar), na 2ª classe.
    ...(extra ? [N(ability, extra.key, 2, extra.name, 5, extra.effect, "forca")] : []),
    N(ability, "forca", 1, "Força", 5, { t: "power", pct: 8 }),
    N(
      ability,
      "economia",
      1,
      "Economia",
      3,
      { t: "cost", pct: costPct },
      "forca",
    ),
    N(ability, t2.key, 2, t2.name, 1, t2.effect, "forca"),
    N(ability, "forca2", 2, "Força II", 5, { t: "power", pct: 6 }, t2.key),
    N(ability, t3.key, 3, t3.name, 1, t3.effect, "forca2"),
    N(
      ability,
      "ritmo",
      3,
      "Ritmo",
      2,
      { t: "cooldown", ms: cooldownMs },
      t3.key,
    ),
  ];
}

const LIGHT_HEALING = magia([1.4, 8], [1.8, 11]);
const INTENSE_HEALING = magia([3.2, 20], [5.4, 40]);

export const TREE: readonly TreeNode[] = [
  // ---- Cavaleiro ----------------------------------------------------------------
  ...attackBranch(
    "golpe-brutal",
    10,
    {
      key: "atordoar",
      name: "Atordoar",
      effect: { t: "stun", chance: 30, ms: 2000 },
    },
    { key: "duplo", name: "Golpe duplo", effect: { t: "echo", pct: 50 } },
    1000,
    { key: "quebra", name: "Quebrar guarda", effect: { t: "pierce", pct: 3 } },
  ),
  ...attackBranch(
    "giro-da-lamina",
    15,
    { key: "sangria", name: "Sangria", effect: { t: "leech", pct: 10 } },
    { key: "redemoinho", name: "Redemoinho", effect: { t: "echo", pct: 40 } },
    500,
    { key: "certeiro", name: "Golpe certeiro", effect: { t: "crit", pct: 2 } }
  ),
  N("atadura", "forca", 1, "Força", 5, { t: "power", pct: 10 }),
  N("atadura", "firme", 2, "Cura firme", 5, { t: "crit", pct: 2 }, "forca"),
  N("atadura", "reflexo", 1, "Reflexo", 2, { t: "trigger", pct: 10 }, "forca"),
  N(
    "atadura",
    "fechar-feridas",
    2,
    "Fechar feridas",
    1,
    {
      t: "formula",
      formula: magia([4, 25], [8, 50]),
      mana: 40,
      name: "Fechar feridas",
      source: "wound_cleansing.lua",
    },
    "forca",
  ),
  N(
    "atadura",
    "forca2",
    2,
    "Força II",
    5,
    { t: "power", pct: 6 },
    "fechar-feridas",
  ),
  N("atadura", "economia", 3, "Economia", 3, { t: "cost", pct: 15 }, "forca2"),
  N(
    "atadura",
    "reflexo2",
    3,
    "Reflexo II",
    2,
    { t: "trigger", pct: 5 },
    "forca2",
  ),
  N("desafio", "presenca", 1, "Presença", 3, { t: "focus", ms: 2000 }),
  // 24/11/2026: o tanque protege o grupo mais enquanto o desafio prende (run.ts Proteção).
  N("desafio", "escudo", 2, "Escudo do grupo", 5, { t: "cover", pct: 1 }, "presenca"),
  N(
    "desafio",
    "economia",
    1,
    "Economia",
    3,
    { t: "cost", pct: 10 },
    "presenca",
  ),
  N("desafio", "muralha", 2, "Muralha", 3, { t: "guard", pct: 8 }, "presenca"),
  N(
    "desafio",
    "estrondo",
    2,
    "Estrondo",
    1,
    { t: "stun", chance: 100, ms: 1000 },
    "muralha",
  ),
  N("desafio", "bastiao", 3, "Bastião", 1, { t: "guard", pct: 15 }, "muralha"),
  N("desafio", "eco", 3, "Eco", 2, { t: "focus", ms: 2000 }, "bastiao"),
  // ---- Arqueiro -----------------------------------------------------------------
  ...attackBranch(
    "rajada-dupla",
    10,
    {
      key: "perfurante",
      name: "Flecha perfurante",
      effect: { t: "targets", n: 1 },
    },
    { key: "tripla", name: "Rajada tripla", effect: { t: "echo", pct: 50 } },
    500,
    { key: "certeira", name: "Flecha certeira", effect: { t: "crit", pct: 2 } }
  ),
  ...attackBranch(
    "chuva-de-flechas",
    15,
    {
      key: "farpas",
      name: "Flechas farpadas",
      effect: { t: "stun", chance: 15, ms: 1500 },
    },
    { key: "tormenta", name: "Tormenta", effect: { t: "echo", pct: 35 } },
    500,
    { key: "pontas", name: "Pontas de aço", effect: { t: "pierce", pct: 3 } }
  ),
  ...attackBranch(
    "flecha-carregada",
    10,
    {
      key: "impacto",
      name: "Impacto",
      effect: { t: "stun", chance: 35, ms: 2000 },
    },
    { key: "trespassar", name: "Trespassar", effect: { t: "targets", n: 1 } },
    500,
    { key: "rompe", name: "Rompe-armadura", effect: { t: "pierce", pct: 3 } },
  ),
  N("concentracao", "foco", 1, "Foco", 5, { t: "power", pct: 10 }),
  N("concentracao", "mira", 2, "Mira", 5, { t: "crit", pct: 2 }, "foco"),
  N("concentracao", "folego", 1, "Fôlego", 3, { t: "focus", ms: 1000 }, "foco"),
  N(
    "concentracao",
    "economia",
    2,
    "Economia",
    3,
    { t: "cost", pct: 15 },
    "foco",
  ),
  N("concentracao", "foco2", 2, "Foco II", 5, { t: "power", pct: 6 }, "economia"),
  N(
    "concentracao",
    "olho-de-aguia",
    3,
    "Olho de águia",
    2,
    { t: "focus", ms: 2000 },
    "foco2",
  ),
  N(
    "concentracao",
    "ritmo",
    3,
    "Ritmo",
    2,
    { t: "cooldown", ms: 2000 },
    "olho-de-aguia",
  ),
  // ---- Feiticeiro ---------------------------------------------------------------
  ...attackBranch(
    "golpe-de-raio",
    10,
    { key: "corrente", name: "Corrente", effect: { t: "targets", n: 1 } },
    { key: "sobrecarga", name: "Sobrecarga", effect: { t: "echo", pct: 50 } },
    500,
    { key: "faisca", name: "Faísca", effect: { t: "crit", pct: 2 } }
  ),
  ...attackBranch(
    "golpe-de-chama",
    10,
    { key: "combustao", name: "Combustão", effect: { t: "echo", pct: 35 } },
    {
      key: "chama-solar",
      name: "Chama solar",
      effect: {
        t: "formula",
        formula: magiaX([2.8, 16], [4.4, 28], MAGE_ATTACK),
        mana: 60,
        name: "Chama solar",
        source: "strong_flame_strike.lua",
      },
    },
    500,
    { key: "brasa", name: "Brasa", effect: { t: "pierce", pct: 3 } }
  ),
  ...attackBranch(
    "onda-de-fogo",
    15,
    {
      key: "grande-onda",
      name: "Grande onda",
      effect: {
        t: "formula",
        formula: magiaX([2.8, 16], [4.4, 28], MAGE_AREA),
        mana: 120,
        name: "Grande onda de fogo",
        source: "great_fire_wave.lua",
      },
    },
    { key: "tempestade", name: "Tempestade", effect: { t: "echo", pct: 40 } },
    500,
    { key: "calor", name: "Calor intenso", effect: { t: "crit", pct: 2 } }
  ),
  N("remendo", "cura-leve", 1, "Cura leve", 1, {
    t: "formula",
    formula: LIGHT_HEALING,
    mana: 20,
    name: "Cura leve",
    source: "light_healing.lua",
  }),
  N("remendo", "plena", 2, "Cura plena", 5, { t: "crit", pct: 2 }, "cura-leve"),
  N(
    "remendo",
    "reflexo",
    1,
    "Reflexo",
    2,
    { t: "trigger", pct: 10 },
    "cura-leve",
  ),
  N(
    "remendo",
    "intensa",
    2,
    "Cura intensa",
    1,
    {
      t: "formula",
      formula: INTENSE_HEALING,
      mana: 70,
      name: "Cura intensa",
      source: "intense_healing.lua",
    },
    "cura-leve",
  ),
  N("remendo", "forca", 2, "Força", 5, { t: "power", pct: 10 }, "intensa"),
  N("remendo", "economia", 3, "Economia", 3, { t: "cost", pct: 15 }, "forca"),
  N(
    "remendo",
    "reflexo2",
    3,
    "Reflexo II",
    2,
    { t: "trigger", pct: 5 },
    "forca",
  ),
  // ---- Druida -------------------------------------------------------------------
  ...attackBranch(
    "golpe-de-gelo",
    10,
    {
      key: "congelar",
      name: "Congelar",
      effect: { t: "stun", chance: 25, ms: 2000 },
    },
    { key: "estilhaco", name: "Estilhaço", effect: { t: "targets", n: 2 } },
    500,
    { key: "gelo-fino", name: "Gelo fino", effect: { t: "pierce", pct: 3 } }
  ),
  ...attackBranch(
    "onda-de-gelo",
    15,
    {
      key: "raizes",
      name: "Onda de raízes",
      effect: {
        t: "formula",
        formula: magiaX([3.25, 5], [6.75, 30], MAGE_AREA),
        mana: 170,
        name: "Onda de raízes",
        source: "terra_wave.lua",
        element: "terra",
      },
    },
    { key: "inverno", name: "Inverno", effect: { t: "echo", pct: 40 } },
    500,
    { key: "nevasca", name: "Nevasca", effect: { t: "crit", pct: 2 } }
  ),
  N("cura-do-companheiro", "forca", 1, "Força", 5, { t: "power", pct: 8 }),
  N("cura-do-companheiro", "graca", 2, "Graça", 5, { t: "crit", pct: 2 }, "forca"),
  N(
    "cura-do-companheiro",
    "economia",
    1,
    "Economia",
    3,
    { t: "cost", pct: 10 },
    "forca",
  ),
  N(
    "cura-do-companheiro",
    "em-massa",
    2,
    "Cura em massa",
    1,
    { t: "group", pct: 50 },
    "forca",
  ),
  N(
    "cura-do-companheiro",
    "forca2",
    2,
    "Força II",
    5,
    { t: "power", pct: 6 },
    "em-massa",
  ),
  N(
    "cura-do-companheiro",
    "bencao",
    3,
    "Bênção",
    2,
    { t: "trigger", pct: 10 },
    "forca2",
  ),
  N(
    "cura-do-companheiro",
    "fluxo",
    3,
    "Fluxo",
    3,
    { t: "cost", pct: 10 },
    "forca2",
  ),
  N("seiva", "cura-leve", 1, "Cura leve", 1, {
    t: "formula",
    formula: LIGHT_HEALING,
    mana: 20,
    name: "Cura leve",
    source: "light_healing.lua",
  }),
  N("seiva", "brotar", 2, "Brotar", 5, { t: "crit", pct: 2 }, "cura-leve"),
  N(
    "seiva",
    "reflexo",
    1,
    "Reflexo",
    2,
    { t: "trigger", pct: 10 },
    "cura-leve",
  ),
  N(
    "seiva",
    "intensa",
    2,
    "Cura intensa",
    1,
    {
      t: "formula",
      formula: INTENSE_HEALING,
      mana: 70,
      name: "Cura intensa",
      source: "intense_healing.lua",
    },
    "cura-leve",
  ),
  N("seiva", "forca", 2, "Força", 5, { t: "power", pct: 10 }, "intensa"),
  N("seiva", "abrigo", 3, "Abrigo", 1, { t: "group", pct: 30 }, "forca"),
  N("seiva", "economia", 3, "Economia", 3, { t: "cost", pct: 15 }, "abrigo"),
];

export function treeNode(id: string): TreeNode | undefined {
  return TREE.find((n) => n.id === id);
}

export function treeOf(ability: string): TreeNode[] {
  return TREE.filter((n) => n.ability === ability);
}

/** Pontos postos na árvore. */
export function treePointsSpent(t: Tree): number {
  let n = 0;
  for (const v of Object.values(t)) n += v;
  return n;
}

/** Por que não dá para pôr mais um ponto em `id` (null: dá). */
export function cannotLearn(
  t: Tree,
  id: string,
  cls: number,
  tier: JobTier,
  free: number,
):
  | "not_node"
  | "not_class"
  | "tier"
  | "requires"
  | "max_rank"
  | "no_points"
  | null {
  const node = treeNode(id);
  if (!node) return "not_node";
  if (abilityDef(node.ability)?.cls !== cls) return "not_class";
  if (node.tier > tier) return "tier";
  if (node.requires && !((t[node.requires] ?? 0) > 0)) return "requires";
  if ((t[id] ?? 0) >= TIER_MAX_UPS[tier]) return "max_rank";
  if (free <= 0) return "no_points";
  return null;
}

/** Árvore válida para a classe e a evolução (o que se lê do banco). */
export function validTree(t: unknown, cls: number, tier: JobTier): t is Tree {
  if (typeof t !== "object" || t === null || Array.isArray(t)) return false;
  for (const [id, v] of Object.entries(t)) {
    const node = treeNode(id);
    if (
      !node ||
      !Number.isInteger(v) ||
      (v as number) < 1 ||
      (v as number) > TIER_MAX_UPS[tier]
    )
      return false;
    if (abilityDef(node.ability)?.cls !== cls || node.tier > tier) return false;
    if (node.requires && !((t as Tree)[node.requires]! > 0)) return false;
  }
  return true;
}

// ---- renascimento da árvore (24/11/2026) ------------------------------------------

/**
 * O renascimento da árvore (pedido do dono, 24/11/2026: "pro dummy nunca perder utilidade"):
 * na última classe (a 3ª) e com a árvore inteira cheia, a pessoa zera a árvore e os pontos de
 * habilidade ganhos (o treino no dummy recomeça) e escolhe UM adereço de UMA habilidade; cada vez
 * que ele é escolhido, o efeito de cada ponto dele cresce `MASTERY_PCT`% para sempre (a
 * maestria). Sem teto: dá para escolher o mesmo de novo. Antes de 24/11 à noite bastava a árvore
 * da classe de agora (na 1ª, umas 2 h de dummy: quebrava o jogo, pelo dono).
 */
export const MASTERY_PCT = 0.5;

/** Adereço → quantas vezes foi escolhido no renascimento. */
export type Mastery = Record<string, number>;

/** O multiplicador do efeito de um adereço pela maestria (1 sem nenhuma). */
export function masteryFactor(m: Mastery | undefined, id: string): number {
  return 1 + (MASTERY_PCT / 100) * (m?.[id] ?? 0);
}

/**
 * O adereço aceita maestria? Todos (24/11/2026, pelo dono: "força, economia, flecha perfurante,
 * etc."). Nos de número (força, economia, recarga, eco...) ela cresce o efeito de cada ponto; nos
 * de forma (alvo a mais, elemento, troca de magia), que não têm número, ela soma o mesmo % ao
 * poder da habilidade enquanto o adereço está aprendido (`isShapeNode`).
 */
export function masteryNode(id: string): boolean {
  return treeNode(id) !== undefined;
}

/** Adereço de forma: o efeito não tem número para a maestria crescer. */
export function isShapeNode(id: string): boolean {
  const t = treeNode(id)?.effect.t;
  return t === "targets" || t === "element" || t === "formula";
}

/**
 * Por que não renasce agora (null: pode, com o adereço `node`): só na 3ª classe e com o job no
 * máximo (24/11/2026; antes, a árvore cheia, que com os ups de até 20 ninguém enche).
 */
export function cannotRebirth(
  cls: number,
  tier: JobTier,
  jobLevel: number,
  node: string,
): "not_last_tier" | "job_level" | "not_node" | "not_class" | "not_mastery" | null {
  if (tier < 3) return "not_last_tier";
  if (jobLevel < JOB.maxLevel) return "job_level";
  const n = treeNode(node);
  if (!n) return "not_node";
  if (abilityDef(n.ability)?.cls !== cls) return "not_class";
  if (!masteryNode(node)) return "not_mastery";
  return null;
}

/** Maestria válida (o que se lê do banco): adereços que existem e contagens inteiras. */
export function validMastery(m: unknown): m is Mastery {
  if (typeof m !== "object" || m === null || Array.isArray(m)) return false;
  for (const [id, v] of Object.entries(m))
    if (!treeNode(id) || !Number.isInteger(v) || (v as number) < 1)
      return false;
  return true;
}

/** A habilidade como ela sai com os adereços que o herói tem. */
export interface AbilityNow {
  def: AbilityDef;
  name: string;
  source: string;
  formula: SpellFormula;
  mana: number;
  cooldownMs: number;
  element: Element | "cura";
  blockArmor: boolean;
  /** Multiplicador do valor (1 + força). */
  power: number;
  targets: number;
  echo: number;
  leech: number;
  stun: { chance: number; ms: number } | null;
  /** Pontos de % somados ao limite da cura. */
  trigger: number;
  group: number;
  focusMs: number;
  guard: number;
  /** Chance (%) de sair crítica; na Concentração, o crítico dos tiros enquanto ela dura. */
  crit: number;
  /** % da armadura e da resistência do monstro que a habilidade ignora. */
  pierce: number;
  /** % a mais na Proteção do cavaleiro enquanto o desafio prende. */
  cover: number;
}

/** [nosso] Recarga mínima de uma habilidade com os adereços. */
export const MIN_COOLDOWN_MS = 500;

export function abilityNow(
  def: AbilityDef,
  t: Tree,
  mastery?: Mastery,
): AbilityNow {
  const out: AbilityNow = {
    def,
    name: def.name,
    source: def.source,
    formula: def.formula,
    mana: def.mana,
    cooldownMs: def.cooldownMs,
    element: def.element,
    blockArmor: !!def.blockArmor,
    power: 1,
    targets: 0,
    echo: 0,
    leech: 0,
    stun: null,
    trigger: 0,
    group: 0,
    focusMs:
      def.kind === "desafio"
        ? 8000
        : def.kind === "foco"
          ? CONCENTRATION.durationMs
          : 0,
    guard: 0,
    crit: 0,
    pierce: 0,
    cover: 0,
  };
  let cost = 0;
  let cooldown = 0;
  // A fórmula troca primeiro (ela traz a mana nova); os outros somam por up.
  for (const node of treeOf(def.id)) {
    const n = t[node.id] ?? 0;
    if (n > 0 && node.effect.t === "formula") {
      out.formula = node.effect.formula;
      out.mana = node.effect.mana;
      out.name = node.effect.name;
      out.source = node.effect.source;
      if (node.effect.element) out.element = node.effect.element;
    }
  }
  for (const node of treeOf(def.id)) {
    const ups = t[node.id] ?? 0;
    if (ups <= 0) continue;
    // 24/11/2026: `n0` é o efeito em pontos de antes (o cheio de antes = UPS_FULL ups); a
    // maestria multiplica o efeito dos ups postos (renascimento da árvore).
    const n0 = (upsWeight(ups) * node.ranks) / UPS_FULL;
    const n = n0 * masteryFactor(mastery, node.id);
    const e = node.effect;
    switch (e.t) {
      case "power":
        out.power += (e.pct * n) / 100;
        break;
      case "cost":
        cost += e.pct * n;
        break;
      case "cooldown":
        cooldown += e.ms * n;
        break;
      case "targets":
        out.targets += e.n * n0;
        break;
      case "echo":
        out.echo += (e.pct * n) / 100;
        break;
      case "leech":
        out.leech += (e.pct * n) / 100;
        break;
      case "stun":
        out.stun = {
          chance: Math.min(100, (out.stun?.chance ?? 0) + e.chance * n),
          ms: Math.max(out.stun?.ms ?? 0, e.ms),
        };
        break;
      case "crit":
        out.crit += e.pct * n;
        break;
      case "pierce":
        out.pierce += e.pct * n;
        break;
      case "cover":
        out.cover += e.pct * n;
        break;
      case "element":
        out.element = e.element;
        break;
      case "trigger":
        out.trigger += e.pct * n;
        break;
      case "group":
        out.group += (e.pct * n) / 100;
        break;
      case "focus":
        out.focusMs += e.ms * n;
        break;
      case "guard":
        out.guard += e.pct * n;
        break;
      case "formula":
        // A troca sai no 1º up; os ups a mais somam poder (FORMULA_UP_PCT cada).
        out.power += (FORMULA_UP_PCT * Math.max(0, upsWeight(ups) - 1)) / 100;
        break;
    }
  }
  // Tetos dos efeitos que viram absurdos com 20 ups.
  out.group = Math.min(1, out.group);
  out.trigger = Math.min(40, out.trigger);
  out.crit = Math.min(60, out.crit);
  out.pierce = Math.min(75, out.pierce);
  out.cover = Math.min(30, out.cover);
  // A maestria dos adereços de forma (alvo a mais, elemento, troca de magia): o mesmo % no poder
  // da habilidade, enquanto o adereço está aprendido.
  for (const node of treeOf(def.id))
    if ((t[node.id] ?? 0) > 0 && isShapeNode(node.id))
      out.power *= masteryFactor(mastery, node.id);
  out.mana = Math.max(
    0,
    Math.floor((out.mana * (100 - Math.min(90, cost))) / 100),
  );
  out.cooldownMs = Math.max(MIN_COOLDOWN_MS, out.cooldownMs - cooldown);
  return out;
}
