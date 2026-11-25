import { z } from "zod";

/**
 * Conteúdo declarativo do rebalanceamento (spec §0.3): classes (§6), famílias de arma, mão secundária,
 * armaduras, raridades e munição (§9). É dado, não código: a engine interpreta e os testes validam com
 * os schemas abaixo. Skills, adereços, afixos, monstros e DGs entram nas fases seguintes.
 */

export const STATS = ["FOR", "AGI", "VIT", "INT", "DES", "SOR"] as const;
export type Stat = (typeof STATS)[number];
export type Stats = Record<Stat, number>;

export const CLASS_IDS = [
  "guerreiro",
  "paladino",
  "padre",
  "druida",
  "mago",
  "cacador",
  "assassino",
] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export const FAMILY_IDS = [
  "espada",
  "machado",
  "lanca",
  "martelo",
  "maca",
  "adaga",
  "katar",
  "arco",
  "besta",
  "cajado",
  "cetro",
  "bastao",
] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

export const OFFHAND_IDS = ["escudo", "focus", "aljava"] as const;
export type OffhandId = (typeof OFFHAND_IDS)[number];

export const ARMOR_WEIGHTS = ["leve", "media", "pesada"] as const;
export type ArmorWeight = (typeof ARMOR_WEIGHTS)[number];

export const ARMOR_SLOTS = ["elmo", "armadura", "calcas", "botas"] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

export const RARITY_IDS = [
  "comum",
  "incomum",
  "raro",
  "epico",
  "lendario",
] as const;
export type RarityId = (typeof RARITY_IDS)[number];

const stat = z.enum(STATS);
const share = z.number().min(0).max(1);

/** As 6 linhas de proficiência: bônus máximo (com Proficiência 5000) de cada derivado. */
const ProficiencyWeights = z.object({
  hp: share,
  mp: share,
  atk: share,
  matk: share,
  def: share,
  mdef: share,
});
export type ProficiencyWeights = z.infer<typeof ProficiencyWeights>;

export const ClassSchema = z.object({
  id: z.enum(CLASS_IDS),
  role: z.enum(["tanque", "suporte", "dps"]),
  /** Títulos por tier: T1 (início), T2 (job 20), T3 (nível 40), T4 (nível 70). */
  titles: z.tuple([z.string(), z.string(), z.string(), z.string()]),
  weapons: z.array(z.enum(FAMILY_IDS)).min(1),
  offhands: z.array(z.enum(OFFHAND_IDS)),
  armor: z.enum(ARMOR_WEIGHTS),
  hp0: z.number().positive(),
  hpPerLevel: z.number().positive(),
  mp0: z.number().positive(),
  mpPerLevel: z.number().positive(),
  /** Multiplicador de ameaça sobre o dano (§5). */
  threat: z.number().positive(),
  proficiency: ProficiencyWeights,
  /**
   * A build de referência: fatia do gasto de pontos, NA ORDEM do spec (o alocador desempata pela
   * ordem, e os afixos do perfil vão para os dois primeiros por peso). É só o perfil de teste e a
   * sugestão da UI; o jogador distribui como quiser.
   */
  referenceBuild: z.array(z.tuple([stat, z.number().positive()])).min(1),
  referenceWeapon: z.enum(FAMILY_IDS),
  referenceOffhand: z.enum(OFFHAND_IDS).nullable(),
  /** O traço da classe (§6). Os números ficam aqui; o efeito é interpretado pela engine. */
  trait: z.object({
    id: z.string(),
    name: z.string(),
    lifesteal: z.number().optional(),
    blockBonus: z.number().optional(),
    healBonus: z.number().optional(),
    hotBonus: z.number().optional(),
    hotStacks: z.number().int().optional(),
    magicAutoAttack: z.number().optional(),
    hitBonusPct: z.number().optional(),
    poisonBonus: z.number().optional(),
  }),
});
export type ClassDef = z.infer<typeof ClassSchema>;

export const CLASSES: Record<ClassId, ClassDef> = {
  guerreiro: {
    id: "guerreiro",
    role: "tanque",
    titles: ["Recruta", "Guerreiro", "Vanguarda", "Senhor da Guerra"],
    weapons: ["espada", "machado", "lanca"],
    offhands: ["escudo"],
    armor: "pesada",
    hp0: 150,
    hpPerLevel: 15,
    mp0: 30,
    mpPerLevel: 3,
    threat: 5,
    proficiency: {
      hp: 0.8,
      mp: 0.2,
      atk: 0.4,
      matk: 0.05,
      def: 0.5,
      mdef: 0.3,
    },
    referenceBuild: [
      ["VIT", 45],
      ["FOR", 35],
      ["AGI", 10],
      ["DES", 10],
    ],
    referenceWeapon: "espada",
    referenceOffhand: "escudo",
    trait: { id: "sede-de-batalha", name: "Sede de Batalha", lifesteal: 0.06 },
  },
  paladino: {
    id: "paladino",
    role: "tanque",
    titles: ["Escudeiro", "Paladino", "Templário", "Cruzado"],
    weapons: ["espada", "lanca", "martelo"],
    offhands: ["escudo"],
    armor: "pesada",
    hp0: 145,
    hpPerLevel: 14,
    mp0: 50,
    mpPerLevel: 6,
    threat: 5,
    proficiency: {
      hp: 0.7,
      mp: 0.4,
      atk: 0.3,
      matk: 0.35,
      def: 0.5,
      mdef: 0.6,
    },
    referenceBuild: [
      ["VIT", 45],
      ["FOR", 35],
      ["INT", 10],
      ["DES", 10],
    ],
    referenceWeapon: "espada",
    referenceOffhand: "escudo",
    trait: { id: "juramento", name: "Juramento", blockBonus: 0.15 },
  },
  padre: {
    id: "padre",
    role: "suporte",
    titles: ["Acólito", "Padre", "Sumo Sacerdote", "Arcebispo"],
    weapons: ["cajado", "maca", "besta"],
    offhands: ["escudo"],
    armor: "leve",
    hp0: 100,
    hpPerLevel: 7,
    mp0: 80,
    mpPerLevel: 10,
    threat: 1,
    proficiency: {
      hp: 0.4,
      mp: 0.7,
      atk: 0.05,
      matk: 0.55,
      def: 0.2,
      mdef: 0.45,
    },
    referenceBuild: [
      ["INT", 50],
      ["VIT", 30],
      ["DES", 20],
    ],
    referenceWeapon: "cajado",
    referenceOffhand: null,
    trait: { id: "devocao", name: "Devoção", healBonus: 0.1 },
  },
  druida: {
    id: "druida",
    role: "suporte",
    titles: [
      "Aprendiz do Bosque",
      "Druida",
      "Guardião do Bosque",
      "Arquidruida",
    ],
    weapons: ["cajado", "adaga", "lanca", "bastao"],
    offhands: ["escudo"],
    armor: "media",
    hp0: 105,
    hpPerLevel: 8,
    mp0: 80,
    mpPerLevel: 9,
    threat: 1,
    proficiency: {
      hp: 0.45,
      mp: 0.65,
      atk: 0.15,
      matk: 0.5,
      def: 0.3,
      mdef: 0.4,
    },
    referenceBuild: [
      ["INT", 45],
      ["VIT", 25],
      ["DES", 20],
      ["AGI", 10],
    ],
    referenceWeapon: "bastao",
    referenceOffhand: null,
    trait: {
      id: "ciclo-da-vida",
      name: "Ciclo da Vida",
      hotBonus: 0.1,
      hotStacks: 2,
    },
  },
  mago: {
    id: "mago",
    role: "dps",
    titles: ["Aprendiz", "Mago", "Feiticeiro", "Arquimago"],
    weapons: ["cajado", "cetro"],
    offhands: ["focus", "escudo"],
    armor: "leve",
    hp0: 90,
    hpPerLevel: 5,
    mp0: 90,
    mpPerLevel: 12,
    threat: 0.8,
    proficiency: {
      hp: 0.3,
      mp: 0.7,
      atk: 0.05,
      matk: 0.6,
      def: 0.15,
      mdef: 0.45,
    },
    referenceBuild: [
      ["INT", 55],
      ["DES", 30],
      ["VIT", 15],
    ],
    referenceWeapon: "cajado",
    referenceOffhand: null,
    trait: {
      id: "canalizacao-arcana",
      name: "Canalização Arcana",
      magicAutoAttack: 0.6,
    },
  },
  cacador: {
    id: "cacador",
    role: "dps",
    titles: ["Arqueiro", "Caçador", "Sentinela", "Patrulheiro"],
    weapons: ["arco", "besta", "adaga", "lanca"],
    offhands: ["aljava"],
    armor: "media",
    hp0: 110,
    hpPerLevel: 8,
    mp0: 60,
    mpPerLevel: 6,
    threat: 0.8,
    proficiency: {
      hp: 0.4,
      mp: 0.35,
      atk: 0.6,
      matk: 0.05,
      def: 0.25,
      mdef: 0.25,
    },
    referenceBuild: [
      ["DES", 50],
      ["AGI", 25],
      ["SOR", 15],
      ["VIT", 10],
    ],
    referenceWeapon: "arco",
    referenceOffhand: "aljava",
    trait: { id: "olho-de-aguia", name: "Olho de Águia", hitBonusPct: 0.1 },
  },
  assassino: {
    id: "assassino",
    role: "dps",
    titles: ["Gatuno", "Assassino", "Algoz", "Mestre das Sombras"],
    weapons: ["katar", "adaga", "espada", "lanca", "arco"],
    offhands: ["escudo"],
    armor: "media",
    hp0: 115,
    hpPerLevel: 9,
    mp0: 50,
    mpPerLevel: 5,
    threat: 0.7,
    proficiency: {
      hp: 0.45,
      mp: 0.3,
      atk: 0.6,
      matk: 0.05,
      def: 0.25,
      mdef: 0.25,
    },
    referenceBuild: [
      ["SOR", 35],
      ["FOR", 30],
      ["AGI", 25],
      ["VIT", 10],
    ],
    referenceWeapon: "katar",
    referenceOffhand: null,
    trait: { id: "laminas-gemeas", name: "Lâminas Gêmeas", poisonBonus: 0.2 },
  },
};

export const FamilySchema = z.object({
  id: z.enum(FAMILY_IDS),
  name: z.string(),
  /** Multiplicadores sobre a base da arma (12 + 2,4·iL). */
  atk: z.number().min(0),
  matk: z.number().min(0),
  hands: z.union([z.literal(1), z.literal(2)]),
  /** Ataques por segundo antes da AGI. */
  aps: z.number().positive(),
  /** Atributo que dá +1% do ATQ/MATQ da arma por ponto. */
  scale: stat,
  /** Corpo a corpo e à distância usam o status de ATQ de cada um; mágica bate com MATQ e não erra. */
  kind: z.enum(["melee", "ranged", "magic"]),
  /** Especiais da família (§9.2). */
  penetration: z.number().optional(),
  aoeBonus: z.number().optional(),
  stunChance: z.number().optional(),
  healBonus: z.number().optional(),
  critMultBonus: z.number().optional(),
  critRatingMult: z.number().optional(),
  cooldownCut: z.number().optional(),
  magicAutoAttack: z.number().optional(),
  ammo: z.enum(["flecha", "virote"]).optional(),
});
export type FamilyDef = z.infer<typeof FamilySchema>;

export const FAMILIES: Record<FamilyId, FamilyDef> = {
  espada: {
    id: "espada",
    name: "Espada",
    atk: 1,
    matk: 0,
    hands: 1,
    aps: 0.9,
    scale: "FOR",
    kind: "melee",
  },
  machado: {
    id: "machado",
    name: "Machado",
    atk: 1.4,
    matk: 0,
    hands: 2,
    aps: 0.7,
    scale: "FOR",
    kind: "melee",
    aoeBonus: 0.1,
  },
  lanca: {
    id: "lanca",
    name: "Lança",
    atk: 1.25,
    matk: 0,
    hands: 2,
    aps: 0.8,
    scale: "FOR",
    kind: "melee",
    penetration: 0.1,
  },
  martelo: {
    id: "martelo",
    name: "Martelo de guerra",
    atk: 1.45,
    matk: 0,
    hands: 2,
    aps: 0.65,
    scale: "FOR",
    kind: "melee",
    stunChance: 0.05,
  },
  maca: {
    id: "maca",
    name: "Maça",
    atk: 0.95,
    matk: 0.6,
    hands: 1,
    aps: 0.8,
    scale: "FOR",
    kind: "melee",
    healBonus: 0.05,
  },
  adaga: {
    id: "adaga",
    name: "Adaga",
    atk: 0.8,
    matk: 0,
    hands: 1,
    aps: 1.1,
    scale: "DES",
    kind: "melee",
    critMultBonus: 0.05,
  },
  katar: {
    id: "katar",
    name: "Katar",
    atk: 1.15,
    matk: 0,
    hands: 2,
    aps: 1,
    scale: "FOR",
    kind: "melee",
    critRatingMult: 2,
  },
  arco: {
    id: "arco",
    name: "Arco",
    atk: 1.2,
    matk: 0,
    hands: 2,
    aps: 0.75,
    scale: "DES",
    kind: "ranged",
    ammo: "flecha",
  },
  besta: {
    id: "besta",
    name: "Besta",
    atk: 1.4,
    matk: 0,
    hands: 2,
    aps: 0.6,
    scale: "DES",
    kind: "ranged",
    penetration: 0.15,
    ammo: "virote",
  },
  cajado: {
    id: "cajado",
    name: "Cajado",
    atk: 0.5,
    matk: 1.6,
    hands: 2,
    aps: 0.7,
    scale: "INT",
    kind: "magic",
    magicAutoAttack: 0.6,
  },
  cetro: {
    id: "cetro",
    name: "Cetro",
    atk: 0.4,
    matk: 1.15,
    hands: 1,
    aps: 0.8,
    scale: "INT",
    kind: "magic",
    cooldownCut: 0.05,
  },
  bastao: {
    id: "bastao",
    name: "Bastão",
    atk: 0.9,
    matk: 1.3,
    hands: 2,
    aps: 0.75,
    scale: "FOR",
    kind: "melee",
  },
};

/** §9.3: peso de cada peça e de cada tipo de armadura. */
export const ARMOR_SLOT_WEIGHT: Record<ArmorSlot, number> = {
  elmo: 0.8,
  armadura: 1.5,
  calcas: 1.1,
  botas: 0.6,
};

export const ARMOR_WEIGHT: Record<ArmorWeight, { def: number; mdef: number }> =
  {
    leve: { def: 0.5, mdef: 1.2 },
    media: { def: 0.8, mdef: 0.8 },
    pesada: { def: 1.2, mdef: 0.6 },
  };

/** §9.4: raridade. */
export const RaritySchema = z.object({
  id: z.enum(RARITY_IDS),
  mult: z.number().min(1),
  affixes: z.number().int().min(0),
  unique: z.boolean(),
  color: z.string(),
});
export type RarityDef = z.infer<typeof RaritySchema>;

export const RARITIES: Record<RarityId, RarityDef> = {
  comum: { id: "comum", mult: 1, affixes: 0, unique: false, color: "cinza" },
  incomum: {
    id: "incomum",
    mult: 1.05,
    affixes: 1,
    unique: false,
    color: "verde",
  },
  raro: { id: "raro", mult: 1.1, affixes: 2, unique: false, color: "azul" },
  epico: { id: "epico", mult: 1.15, affixes: 3, unique: false, color: "roxo" },
  lendario: {
    id: "lendario",
    mult: 1.2,
    affixes: 3,
    unique: true,
    color: "laranja",
  },
};

/** §9.2: munição; o bônus soma ao ATQ à distância. */
export const AMMO_GRADES = { comum: 0, afiada: 0.05, runica: 0.1 } as const;
export type AmmoGrade = keyof typeof AMMO_GRADES;

/** §9.1: os slots que entram nos derivados (mochila e munição ficam como hoje, fora daqui). */
export const GEAR_SLOTS = [
  "arma",
  "secundaria",
  "elmo",
  "armadura",
  "calcas",
  "botas",
  "colar",
  "anel",
] as const;
export type GearSlot = (typeof GEAR_SLOTS)[number];

/** §9.3: colar e anel não têm status base e vêm com +1 afixo além da raridade. */
export const JEWEL_EXTRA_AFFIXES = 1;

export const AFFIX_IDS = [
  ...STATS,
  "hpPct",
  "mpPct",
  "atkPct",
  "matkPct",
  "healPct",
  "defPct",
  "mdefPct",
  "hit",
  "flee",
  "critRating",
  "critMultPct",
  "hastePct",
  "cooldownPct",
  "effectResPct",
] as const;
export type AffixId = (typeof AFFIX_IDS)[number];

const ARMOR_PIECES: GearSlot[] = ["elmo", "armadura", "calcas", "botas"];

export const AffixSchema = z.object({
  id: z.enum(AFFIX_IDS),
  /**
   * Como o valor escala: `atributo` = 1 + iL/40; `rating` = 2 × (1 + iL/40) (planos, crescem com o
   * item); `pct` = fração fixa entre min e max (vale igual do nível 1 ao 500). Rolagem de ±20%.
   */
  scale: z.enum(["atributo", "rating", "pct"]),
  min: z.number().optional(),
  max: z.number().optional(),
  slots: z.array(z.enum(GEAR_SLOTS)).min(1),
});
export type AffixDef = z.infer<typeof AffixSchema>;

/**
 * §9.5. O afixo "+oz de capacidade" da mochila saiu pela decisão do dono de 25/11/2026 (capacidade só
 * pelos pontos). Onde o spec diz "escudo", vale a mão secundária só quando for escudo (a engine confere).
 */
export const AFFIXES: Record<AffixId, AffixDef> = {
  FOR: { id: "FOR", scale: "atributo", slots: [...GEAR_SLOTS] },
  AGI: { id: "AGI", scale: "atributo", slots: [...GEAR_SLOTS] },
  VIT: { id: "VIT", scale: "atributo", slots: [...GEAR_SLOTS] },
  INT: { id: "INT", scale: "atributo", slots: [...GEAR_SLOTS] },
  DES: { id: "DES", scale: "atributo", slots: [...GEAR_SLOTS] },
  SOR: { id: "SOR", scale: "atributo", slots: [...GEAR_SLOTS] },
  hpPct: {
    id: "hpPct",
    scale: "pct",
    min: 0.02,
    max: 0.04,
    slots: [...ARMOR_PIECES, "colar", "anel"],
  },
  mpPct: {
    id: "mpPct",
    scale: "pct",
    min: 0.02,
    max: 0.04,
    slots: [...ARMOR_PIECES, "colar", "anel"],
  },
  atkPct: {
    id: "atkPct",
    scale: "pct",
    min: 0.02,
    max: 0.04,
    slots: ["arma", "anel", "colar"],
  },
  matkPct: {
    id: "matkPct",
    scale: "pct",
    min: 0.02,
    max: 0.04,
    slots: ["arma", "anel", "colar"],
  },
  healPct: {
    id: "healPct",
    scale: "pct",
    min: 0.02,
    max: 0.05,
    slots: ["arma", "colar"],
  },
  defPct: {
    id: "defPct",
    scale: "pct",
    min: 0.03,
    max: 0.06,
    slots: [...ARMOR_PIECES, "secundaria"],
  },
  mdefPct: {
    id: "mdefPct",
    scale: "pct",
    min: 0.03,
    max: 0.06,
    slots: [...ARMOR_PIECES, "secundaria"],
  },
  hit: {
    id: "hit",
    scale: "rating",
    slots: ["arma", "anel", "botas", "elmo"],
  },
  flee: {
    id: "flee",
    scale: "rating",
    slots: ["arma", "anel", "botas", "elmo"],
  },
  critRating: {
    id: "critRating",
    scale: "rating",
    slots: ["arma", "anel", "botas", "elmo"],
  },
  critMultPct: {
    id: "critMultPct",
    scale: "pct",
    min: 0.03,
    max: 0.06,
    slots: ["arma", "anel"],
  },
  hastePct: {
    id: "hastePct",
    scale: "pct",
    min: 0.02,
    max: 0.05,
    slots: ["arma", "anel", "botas"],
  },
  cooldownPct: {
    id: "cooldownPct",
    scale: "pct",
    min: 0.01,
    max: 0.03,
    slots: ["elmo", "colar"],
  },
  effectResPct: {
    id: "effectResPct",
    scale: "pct",
    min: 0.05,
    max: 0.1,
    slots: ["colar", "anel"],
  },
};
