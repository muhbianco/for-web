/**
 * Refúgio, o RPG idle do Espaço (docs/espaco ADR 0009 e jogo/gdd.md no overlay
 * muchat): os dados do jogo. Tudo inteiro: porcentagem, pontos-base (1/10000),
 * décimos, milissegundos. Mudar um número aqui muda o balanceamento: rode
 * `node packages/space-core/src/game/balance/cli.ts` e compare com o GDD.
 */

/** Sobe quando a mesma entrada passa a dar outra luta ou outra expedição (o app compara antes de animar). */
export const GAME_ENGINE = 1;

export type ClassId = "cavaleiro" | "arqueiro" | "feiticeiro" | "druida";
export const CLASS_IDS: readonly ClassId[] = ["cavaleiro", "arqueiro", "feiticeiro", "druida"];

export type SkillId = "espada" | "machado" | "maca" | "distancia" | "escudo" | "magia";
export const SKILL_IDS: readonly SkillId[] = ["espada", "machado", "maca", "distancia", "escudo", "magia"];

export type Element = "fisico" | "fogo" | "energia" | "gelo" | "terra" | "sagrado";
export type WeaponType = "espada" | "machado" | "maca" | "arco" | "varinha" | "cajado";
export const WEAPON_TYPES: readonly WeaponType[] = ["espada", "machado", "maca", "arco", "varinha", "cajado"];
export type OffhandType = "escudo" | "aljava" | "foco";
export type Slot = "elmo" | "armadura" | "calcas" | "botas" | "secundaria" | "arma" | "anel" | "amuleto";
export const SLOTS: readonly Slot[] = ["elmo", "armadura", "calcas", "botas", "secundaria", "arma", "anel", "amuleto"];
export type Rarity = "comum" | "incomum" | "raro" | "epico" | "lendario" | "mitico";
export const RARITIES: readonly Rarity[] = ["comum", "incomum", "raro", "epico", "lendario", "mitico"];
export type Degree = "normal" | "dificil" | "pesadelo" | "abismo";
export const DEGREES: readonly Degree[] = ["normal", "dificil", "pesadelo", "abismo"];
export type Attr = "for" | "des" | "int" | "vit";
export const ATTRS: readonly Attr[] = ["for", "des", "int", "vit"];

export type Passive = "sangue_de_ferro" | "passo_leve" | "veu_arcano" | "raiz_dupla";

export interface ClassDef {
  hpBase: number;
  hpPerLevel: number;
  mpBase: number;
  mpPerLevel: number;
  /** Atributos por nível, em décimos (20 = +2,0 por nível). */
  attr10: Record<Attr, number>;
  weapons: readonly WeaponType[];
  offhand: OffhandType;
  /** Custo relativo das skills em décimos (10 = skill da classe). */
  skillCost10: Record<SkillId, number>;
  /** Mana por segundo em luta, em décimos. */
  mpRegen10: number;
  starter: WeaponType;
  passive: Passive;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  cavaleiro: {
    hpBase: 170,
    hpPerLevel: 18,
    mpBase: 30,
    mpPerLevel: 4,
    attr10: { for: 20, des: 5, int: 0, vit: 20 },
    weapons: ["espada", "machado", "maca"],
    offhand: "escudo",
    skillCost10: { espada: 10, machado: 10, maca: 10, distancia: 30, escudo: 10, magia: 40 },
    mpRegen10: 15,
    starter: "espada",
    passive: "sangue_de_ferro",
  },
  arqueiro: {
    hpBase: 130,
    hpPerLevel: 10,
    mpBase: 60,
    mpPerLevel: 12,
    attr10: { for: 10, des: 20, int: 5, vit: 10 },
    weapons: ["arco"],
    offhand: "aljava",
    skillCost10: { espada: 20, machado: 20, maca: 20, distancia: 10, escudo: 15, magia: 25 },
    mpRegen10: 25,
    starter: "arco",
    passive: "passo_leve",
  },
  feiticeiro: {
    hpBase: 105,
    hpPerLevel: 6,
    mpBase: 100,
    mpPerLevel: 20,
    attr10: { for: 0, des: 5, int: 30, vit: 5 },
    weapons: ["varinha"],
    offhand: "foco",
    skillCost10: { espada: 40, machado: 40, maca: 40, distancia: 30, escudo: 25, magia: 10 },
    mpRegen10: 40,
    starter: "varinha",
    passive: "veu_arcano",
  },
  druida: {
    hpBase: 115,
    hpPerLevel: 7,
    mpBase: 100,
    mpPerLevel: 18,
    attr10: { for: 0, des: 5, int: 25, vit: 10 },
    weapons: ["cajado"],
    offhand: "foco",
    skillCost10: { espada: 40, machado: 40, maca: 40, distancia: 30, escudo: 25, magia: 10 },
    mpRegen10: 40,
    starter: "cajado",
    passive: "raiz_dupla",
  },
};

export interface WeaponDef {
  skill: SkillId;
  atkPct: number;
  intervalMs: number;
  element: Element;
  /** Chance de atordoar 0,8 s por golpe, em pontos-base. */
  stunBp: number;
}

export const WEAPONS: Record<WeaponType, WeaponDef> = {
  espada: { skill: "espada", atkPct: 100, intervalMs: 2000, element: "fisico", stunBp: 0 },
  machado: { skill: "machado", atkPct: 128, intervalMs: 2500, element: "fisico", stunBp: 0 },
  maca: { skill: "maca", atkPct: 108, intervalMs: 2200, element: "fisico", stunBp: 900 },
  arco: { skill: "distancia", atkPct: 92, intervalMs: 1700, element: "fisico", stunBp: 0 },
  varinha: { skill: "magia", atkPct: 80, intervalMs: 1800, element: "energia", stunBp: 0 },
  cajado: { skill: "magia", atkPct: 90, intervalMs: 1900, element: "terra", stunBp: 0 },
};
export const WEAPON_STUN_MS = 800;
/** Nenhum golpe do herói sai em menos que isto, com qualquer bônus de velocidade. */
export const MIN_INTERVAL_MS = 400;

export type SpellKind = "dano" | "area" | "cura" | "escudo" | "marca" | "enfraquece" | "corrente" | "dot";

export interface SpellDef {
  id: string;
  cls: ClassId;
  unlock: number;
  mp: number;
  cdMs: number;
  kind: SpellKind;
  /** % do golpe base (dano), % da vida (cura), % de redução (escudo, enfraquece) ou % a mais (marca). */
  power: number;
  element: Element;
  stunMs?: number;
  /** Queimadura: % do dano da magia por segundo, por 4 s. */
  burnPct?: number;
  targets?: number;
  ignoreArmor?: boolean;
}

export const SPELLS: readonly SpellDef[] = [
  { id: "golpe_pesado", cls: "cavaleiro", unlock: 1, mp: 8, cdMs: 8000, kind: "dano", power: 320, element: "fisico" },
  { id: "brado", cls: "cavaleiro", unlock: 5, mp: 12, cdMs: 18000, kind: "enfraquece", power: 25, element: "fisico" },
  { id: "investida", cls: "cavaleiro", unlock: 12, mp: 15, cdMs: 12000, kind: "dano", power: 200, element: "fisico", stunMs: 1500 },
  { id: "muralha", cls: "cavaleiro", unlock: 18, mp: 20, cdMs: 25000, kind: "escudo", power: 30, element: "fisico" },
  { id: "redemoinho", cls: "cavaleiro", unlock: 25, mp: 25, cdMs: 10000, kind: "area", power: 200, element: "fisico" },
  { id: "flecha_luminosa", cls: "arqueiro", unlock: 1, mp: 10, cdMs: 6000, kind: "dano", power: 230, element: "sagrado" },
  { id: "disparo_triplo", cls: "arqueiro", unlock: 5, mp: 14, cdMs: 7000, kind: "area", power: 100, element: "fisico", targets: 3 },
  { id: "marca_da_presa", cls: "arqueiro", unlock: 12, mp: 12, cdMs: 14000, kind: "marca", power: 25, element: "fisico" },
  { id: "perfurante", cls: "arqueiro", unlock: 18, mp: 20, cdMs: 10000, kind: "dano", power: 300, element: "fisico", ignoreArmor: true },
  { id: "chuva_de_flechas", cls: "arqueiro", unlock: 25, mp: 30, cdMs: 16000, kind: "area", power: 190, element: "fisico" },
  { id: "bola_de_fogo", cls: "feiticeiro", unlock: 1, mp: 12, cdMs: 4000, kind: "dano", power: 210, element: "fogo", burnPct: 12 },
  { id: "raio", cls: "feiticeiro", unlock: 5, mp: 18, cdMs: 6000, kind: "dano", power: 300, element: "energia" },
  { id: "corrente", cls: "feiticeiro", unlock: 12, mp: 24, cdMs: 9000, kind: "corrente", power: 200, element: "energia", targets: 3 },
  { id: "explosao", cls: "feiticeiro", unlock: 18, mp: 30, cdMs: 11000, kind: "area", power: 180, element: "fogo" },
  { id: "meteoro", cls: "feiticeiro", unlock: 25, mp: 45, cdMs: 20000, kind: "area", power: 360, element: "fogo" },
  { id: "espinheiro", cls: "druida", unlock: 1, mp: 10, cdMs: 6000, kind: "dano", power: 220, element: "terra" },
  { id: "seiva", cls: "druida", unlock: 1, mp: 15, cdMs: 7000, kind: "cura", power: 28, element: "terra" },
  { id: "onda_gelida", cls: "druida", unlock: 5, mp: 18, cdMs: 8000, kind: "area", power: 140, element: "gelo", stunMs: 600 },
  { id: "esporos", cls: "druida", unlock: 12, mp: 20, cdMs: 12000, kind: "dot", power: 18, element: "terra" },
  { id: "furia_da_mata", cls: "druida", unlock: 18, mp: 25, cdMs: 7000, kind: "dano", power: 340, element: "terra" },
  { id: "espirito", cls: "druida", unlock: 25, mp: 30, cdMs: 25000, kind: "escudo", power: 25, element: "terra" },
];

export const SPELL_BY_ID: ReadonlyMap<string, SpellDef> = new Map(SPELLS.map((s) => [s.id, s]));

export type EnemyId = "rato" | "esqueleto" | "fungo" | "ossario" | "matriarca";

export interface EnemyDef {
  hp: number;
  /** Ataque em décimos (35 = 3,5). */
  atk10: number;
  armor: number;
  intervalMs: number;
  xp: number;
  gold: readonly [number, number];
  resist: Partial<Record<Element, number>>;
  /** Veneno: % do golpe já mitigado, por segundo, por 4 s (renova, não acumula). */
  poisonPct: number;
  /** A cada `every` ataques, um golpe de `pct`%. */
  heavy?: { every: number; pct: number };
  boss: boolean;
}

/** Ruínas de Pedramusgo (área 1), valores do Normal. */
export const ENEMIES: Record<EnemyId, EnemyDef> = {
  rato: { hp: 76, atk10: 35, armor: 4, intervalMs: 1500, xp: 15, gold: [1, 3], resist: { fogo: -20 }, poisonPct: 0, boss: false },
  esqueleto: {
    hp: 160,
    atk10: 60,
    armor: 22,
    intervalMs: 2300,
    xp: 28,
    gold: [2, 5],
    resist: { sagrado: -35, terra: 25, gelo: 20 },
    poisonPct: 0,
    boss: false,
  },
  fungo: { hp: 120, atk10: 25, armor: 8, intervalMs: 2600, xp: 22, gold: [2, 4], resist: { fogo: -40, terra: 50 }, poisonPct: 30, boss: false },
  ossario: {
    hp: 760,
    atk10: 110,
    armor: 45,
    intervalMs: 2600,
    xp: 175,
    gold: [20, 35],
    resist: { sagrado: -25, terra: 20 },
    poisonPct: 0,
    heavy: { every: 4, pct: 220 },
    boss: false,
  },
  matriarca: { hp: 850, atk10: 70, armor: 28, intervalMs: 2400, xp: 750, gold: [100, 160], resist: { terra: 40, fogo: -25 }, poisonPct: 30, boss: true },
};
export const POISON_MS = 4000;

export interface DegreeDef {
  hpPct: number;
  atkPct: number;
  armorPct: number;
  xpPct: number;
  goldPct: number;
  ilvl: readonly [number, number];
  /** Pesos de raridade em pontos-base (somam 10.000). */
  rarity: Record<Rarity, number>;
}

export const DEGREE: Record<Degree, DegreeDef> = {
  normal: {
    hpPct: 100,
    atkPct: 100,
    armorPct: 100,
    xpPct: 100,
    goldPct: 100,
    ilvl: [1, 10],
    rarity: { comum: 6000, incomum: 2800, raro: 1000, epico: 190, lendario: 10, mitico: 0 },
  },
  dificil: {
    hpPct: 450,
    atkPct: 260,
    armorPct: 220,
    xpPct: 220,
    goldPct: 180,
    ilvl: [10, 22],
    rarity: { comum: 4500, incomum: 3200, raro: 1700, epico: 500, lendario: 90, mitico: 10 },
  },
  pesadelo: {
    hpPct: 1500,
    atkPct: 600,
    armorPct: 450,
    xpPct: 480,
    goldPct: 320,
    ilvl: [22, 36],
    rarity: { comum: 3000, incomum: 3400, raro: 2400, epico: 900, lendario: 250, mitico: 50 },
  },
  abismo: {
    hpPct: 4500,
    atkPct: 1300,
    armorPct: 800,
    xpPct: 1000,
    goldPct: 550,
    ilvl: [36, 50],
    rarity: { comum: 2000, incomum: 3000, raro: 3000, epico: 1400, lendario: 480, mitico: 120 },
  },
};
/** Cada degrau do Abismo multiplica vida, ataque, experiência e ouro por isto (%), e o ilvl sobe 1. */
export const ABYSS_STEP = { hpPct: 115, atkPct: 110, xpPct: 110, goldPct: 105 };
export const MAX_ABYSS = 200;

export const RARITY: Record<Rarity, { pct: number; affixes: number }> = {
  comum: { pct: 100, affixes: 0 },
  incomum: { pct: 115, affixes: 1 },
  raro: { pct: 135, affixes: 2 },
  epico: { pct: 160, affixes: 3 },
  lendario: { pct: 190, affixes: 4 },
  mitico: { pct: 230, affixes: 5 },
};
/** Armadura de cada peça em % da fórmula da armadura. */
export const ARMOR_SLOT_PCT: Partial<Record<Slot, number>> = { elmo: 60, armadura: 100, calcas: 80, botas: 50 };
export const SHIELD_BLOCK_BP = 1500;

export type BoonId = "furia" | "ritmo" | "olho_agucado" | "seiva_viva" | "eco_arcano" | "lamina_larga" | "egide" | "vigor";

export interface Boons {
  dmgPct: number;
  speedPct: number;
  critBp: number;
  /** Regeneração em luta, em milésimos da vida por segundo (5 = 0,5%/s). */
  regenPerMille: number;
  echoBp: number;
  cleaveBp: number;
  wardPct: number;
  maxHpPct: number;
}
export const NO_BOONS: Readonly<Boons> = { dmgPct: 0, speedPct: 0, critBp: 0, regenPerMille: 0, echoBp: 0, cleaveBp: 0, wardPct: 0, maxHpPct: 0 };

export const BOONS: Record<BoonId, { apply: (b: Boons) => void; open: (b: Boons) => boolean }> = {
  furia: { apply: (b) => void (b.dmgPct += 20), open: (b) => b.dmgPct < 100 },
  ritmo: { apply: (b) => void (b.speedPct += 15), open: (b) => b.speedPct < 60 },
  olho_agucado: { apply: (b) => void (b.critBp += 1000), open: (b) => b.critBp < 3000 },
  seiva_viva: { apply: (b) => void (b.regenPerMille += 5), open: (b) => b.regenPerMille < 15 },
  eco_arcano: { apply: (b) => void (b.echoBp += 2500), open: (b) => b.echoBp < 5000 },
  lamina_larga: { apply: (b) => void (b.cleaveBp += 6000), open: (b) => b.cleaveBp < 6000 },
  egide: { apply: (b) => void (b.wardPct += 15), open: (b) => b.wardPct < 30 },
  vigor: { apply: (b) => void (b.maxHpPct += 12), open: (b) => b.maxHpPct < 36 },
};
export const BOON_IDS = Object.keys(BOONS) as BoonId[];

/** Boneco de treino: tentativas por minuto (décimos), teto acumulado e custo. */
export const DUMMIES = [
  { id: "madeira", triesPerMin10: 30, capH: 12, cost: 0 },
  { id: "reforcado", triesPerMin10: 40, capH: 14, cost: 1_500 },
  { id: "avancado", triesPerMin10: 55, capH: 16, cost: 9_000 },
  { id: "magico", triesPerMin10: 75, capH: 20, cost: 45_000 },
  { id: "lendario", triesPerMin10: 100, capH: 24, cost: 200_000 },
] as const;

export const RULES = {
  fightLimitMs: 120_000,
  /** O chefe dobra o dano depois disto. */
  enrageMs: 90_000,
  /** A sala "desaba": inimigos +10% de dano a cada 10 s depois disto. */
  collapseMs: 60_000,
  tickMs: 1000,
  critPct: 160,
  /** Teto do crítico sem e com bênçãos (pontos-base). */
  critCapBp: 5000,
  critCapBoonsBp: 6000,
  potionPct: 30,
  potionCdMs: 10_000,
  maxPotions: 3,
  /** Tentativas por ação em luta. */
  tries: { basic: 6, spell: 10, shield: 3 },
  /** O próximo comando da expedição espera a duração da luta dividida por isto. */
  replaySpeedMax: 4,
  /** Vida e mana do Refúgio voltam de 0 ao máximo neste tempo. */
  regenFullMs: 600_000,
  initiationBossPct: 55,
  rows: 8,
  lanes: 3,
  restHealPct: 35,
  sharpenPct: 8,
  retreatFromRow: 5,
  /** A expedição só começa com pelo menos esta vida (%): morrer custa esperar a regeneração. */
  minStartHpPct: 30,
  bagItemsMax: 20,
  maxLevel: 200,
  maxSkill: 120,
} as const;
