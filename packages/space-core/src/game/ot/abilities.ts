import type { VocationId } from "./data.ts";
import { VOCATIONS } from "./data.ts";
import type { Element } from "./items.ts";
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

export type AbilityKind = "ataque" | "area" | "cura" | "cura-outro" | "desafio";

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
    mana: 115,
    cooldownMs: 4000,
    formula: arma([0.03, 7], [0.05, 11]),
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
  // ---- Arqueiro -----------------------------------------------------------------
  {
    id: "lanca-eterea",
    name: "Lança etérea",
    cls: 3,
    kind: "ataque",
    element: "fisico",
    mana: 25,
    cooldownMs: 2000,
    formula: { type: "distancia", min: [0.7, 0], max: [1, 5] },
    blockArmor: true,
    source: "ethereal_spear.lua",
    blurb: "Uma lança de luz no alvo, pela skill de distância.",
  },
  {
    id: "missil-sagrado",
    name: "Míssil sagrado",
    cls: 3,
    kind: "ataque",
    element: "sagrado",
    mana: 20,
    cooldownMs: 2000,
    formula: magia([1.9, 8], [3, 18]),
    source: "divine_missile.lua",
    blurb: "Dano sagrado no alvo, pelo magic level.",
  },
  {
    id: "caldeira-sagrada",
    name: "Caldeira sagrada",
    cls: 3,
    kind: "area",
    element: "sagrado",
    mana: 160,
    cooldownMs: 4000,
    formula: magia([5, 25], [6.2, 45]),
    source: "divine_caldera.lua",
    blurb: "Luz em volta: acerta todos os monstros da sala.",
  },
  {
    id: "cura-de-campo",
    name: "Cura de campo",
    cls: 3,
    kind: "cura",
    element: "cura",
    mana: 20,
    cooldownMs: 1000,
    formula: magia([1.4, 8], [1.8, 11]),
    source: "light_healing.lua",
    blurb: "Cura a si mesmo quando a vida cai da metade.",
  },
  // ---- Feiticeiro ---------------------------------------------------------------
  {
    id: "golpe-de-raio",
    name: "Golpe de raio",
    cls: 1,
    kind: "ataque",
    element: "energia",
    mana: 20,
    cooldownMs: 2000,
    formula: magia([1.4, 8], [2.2, 14]),
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
    cooldownMs: 2000,
    formula: magia([1.4, 8], [2.2, 14]),
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
    cooldownMs: 4000,
    formula: magia([1.2, 7], [2, 12]),
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
    cooldownMs: 2000,
    formula: magia([1.4, 8], [2.2, 14]),
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
    cooldownMs: 4000,
    formula: magia([0.8, 5], [2, 12]),
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
  | { t: "guard"; pct: number };

export interface TreeNode {
  id: string;
  ability: string;
  tier: JobTier;
  name: string;
  ranks: number;
  /** Precisa de ao menos 1 ponto neste outro adereço. */
  requires?: string;
  effect: NodeEffect;
}

/** O que o herói pôs na árvore: id do adereço → pontos. */
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
): TreeNode[] {
  return [
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
  ),
  ...attackBranch(
    "giro-da-lamina",
    15,
    { key: "sangria", name: "Sangria", effect: { t: "leech", pct: 10 } },
    { key: "redemoinho", name: "Redemoinho", effect: { t: "echo", pct: 40 } },
  ),
  N("atadura", "forca", 1, "Força", 5, { t: "power", pct: 10 }),
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
    "lanca-eterea",
    10,
    { key: "perfurar", name: "Perfurar", effect: { t: "targets", n: 1 } },
    { key: "dupla", name: "Lança dupla", effect: { t: "echo", pct: 60 } },
  ),
  ...attackBranch(
    "missil-sagrado",
    10,
    { key: "luz", name: "Luz que cura", effect: { t: "leech", pct: 15 } },
    { key: "julgamento", name: "Julgamento", effect: { t: "targets", n: 2 } },
  ),
  ...attackBranch(
    "caldeira-sagrada",
    15,
    {
      key: "consagrar",
      name: "Consagrar",
      effect: { t: "stun", chance: 20, ms: 1500 },
    },
    { key: "coro", name: "Coro", effect: { t: "echo", pct: 40 } },
  ),
  N("cura-de-campo", "forca", 1, "Força", 5, { t: "power", pct: 10 }),
  N(
    "cura-de-campo",
    "reflexo",
    1,
    "Reflexo",
    2,
    { t: "trigger", pct: 10 },
    "forca",
  ),
  N(
    "cura-de-campo",
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
    "forca",
  ),
  N(
    "cura-de-campo",
    "forca2",
    2,
    "Força II",
    5,
    { t: "power", pct: 6 },
    "intensa",
  ),
  N(
    "cura-de-campo",
    "abrigo",
    3,
    "Abrigo",
    1,
    { t: "group", pct: 30 },
    "forca2",
  ),
  N(
    "cura-de-campo",
    "economia",
    3,
    "Economia",
    3,
    { t: "cost", pct: 15 },
    "abrigo",
  ),
  // ---- Feiticeiro ---------------------------------------------------------------
  ...attackBranch(
    "golpe-de-raio",
    10,
    { key: "corrente", name: "Corrente", effect: { t: "targets", n: 1 } },
    { key: "sobrecarga", name: "Sobrecarga", effect: { t: "echo", pct: 50 } },
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
        formula: magia([2.8, 16], [4.4, 28]),
        mana: 60,
        name: "Chama solar",
        source: "strong_flame_strike.lua",
      },
    },
  ),
  ...attackBranch(
    "onda-de-fogo",
    15,
    {
      key: "grande-onda",
      name: "Grande onda",
      effect: {
        t: "formula",
        formula: magia([2.8, 16], [4.4, 28]),
        mana: 120,
        name: "Grande onda de fogo",
        source: "great_fire_wave.lua",
      },
    },
    { key: "tempestade", name: "Tempestade", effect: { t: "echo", pct: 40 } },
  ),
  N("remendo", "cura-leve", 1, "Cura leve", 1, {
    t: "formula",
    formula: LIGHT_HEALING,
    mana: 20,
    name: "Cura leve",
    source: "light_healing.lua",
  }),
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
  ),
  ...attackBranch(
    "onda-de-gelo",
    15,
    {
      key: "raizes",
      name: "Onda de raízes",
      effect: {
        t: "formula",
        formula: magia([3.25, 5], [6.75, 30]),
        mana: 170,
        name: "Onda de raízes",
        source: "terra_wave.lua",
        element: "terra",
      },
    },
    { key: "inverno", name: "Inverno", effect: { t: "echo", pct: 40 } },
  ),
  N("cura-do-companheiro", "forca", 1, "Força", 5, { t: "power", pct: 8 }),
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
  if ((t[id] ?? 0) >= node.ranks) return "max_rank";
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
      (v as number) > node.ranks
    )
      return false;
    if (abilityDef(node.ability)?.cls !== cls || node.tier > tier) return false;
    if (node.requires && !((t as Tree)[node.requires]! > 0)) return false;
  }
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
}

/** [nosso] Recarga mínima de uma habilidade com os adereços. */
export const MIN_COOLDOWN_MS = 500;

export function abilityNow(def: AbilityDef, t: Tree): AbilityNow {
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
    focusMs: def.kind === "desafio" ? 8000 : 0,
    guard: 0,
  };
  let cost = 0;
  let cooldown = 0;
  // A fórmula troca primeiro (ela traz a mana nova); os outros somam por ponto.
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
    const n = t[node.id] ?? 0;
    if (n <= 0) continue;
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
        out.targets += e.n * n;
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
        break;
    }
  }
  out.mana = Math.max(
    0,
    Math.floor((out.mana * (100 - Math.min(90, cost))) / 100),
  );
  out.cooldownMs = Math.max(MIN_COOLDOWN_MS, out.cooldownMs - cooldown);
  return out;
}
