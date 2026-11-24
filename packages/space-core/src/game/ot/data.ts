/**
 * Regras do OT usadas pelo jogo do Espaço. Os números são os do The Forgotten Server
 * (TFS, commit 1561fa91); os nomes são nossos, sem conteúdo do Tibia. Referência e
 * decisões do dono: muchat/docs/espaco/jogo/ot/01-auditoria.md.
 *
 * Marcação nos comentários: [TFS arquivo:linha] regra original; [nosso] adaptação,
 * com o motivo.
 */

/** As skills de combate, na ordem do TFS (enums.h:303-308). A pesca fica de fora. */
export type SkillId =
  | "punhos"
  | "maca"
  | "espada"
  | "machado"
  | "distancia"
  | "escudo";
export const SKILLS: readonly SkillId[] = [
  "punhos",
  "maca",
  "espada",
  "machado",
  "distancia",
  "escudo",
];

/** Tentativas da primeira subida de cada skill [TFS vocation.cpp:139]. */
export const SKILL_BASE: Readonly<Record<SkillId, number>> = {
  punhos: 50,
  maca: 50,
  espada: 50,
  machado: 50,
  distancia: 30,
  escudo: 100,
};

/** Skill inicial [TFS const.h MINIMUM_SKILL_LEVEL]. */
export const MIN_SKILL = 10;

/**
 * [nosso] Teto de skill e de magic level. O TFS só para quando o requisito estoura o
 * uint64; aqui o teto mantém as tentativas como inteiros exatos em `number` e fica
 * muito acima do que o treino alcança (guerreiro com espada 200: ~3,3 bilhões de
 * tentativas na última subida).
 */
export const MAX_SKILL = 200;
export const MAX_MAGIC_LEVEL = 200;

/**
 * O teto de level de agora (24/11/2026, decisão do dono: "nosso primeiro level máximo é 500",
 * para jogar durante anos). É o único lugar a mudar quando o teto subir: a curva de experiência
 * (progression.ts expForLevel) já vale para qualquer level, e quem estiver parado no teto volta
 * a ganhar experiência na hora.
 */
export const MAX_LEVEL = 500;

/** Ids das vocações, os mesmos do TFS (data/XML/vocations.xml). */
export type VocationId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface Vocation {
  id: VocationId;
  /** Nome que o app mostra (nosso). */
  name: string;
  /** Vocação de origem: a própria, ou a base de uma promovida [TFS `fromvoc`]. */
  base: VocationId;
  /** A promoção desta vocação, quando houver. */
  promotion: VocationId | null;
  /** Multiplicador de tentativas por skill [TFS `<skill multiplier>`]. */
  skill: Readonly<Record<SkillId, number>>;
  /** Multiplicador da mana por magic level [TFS `manamultiplier`]. */
  manaMultiplier: number;
  /** Ganho por level [TFS `gainhp`, `gainmana`, `gaincap`]. */
  gainHp: number;
  gainMana: number;
  gainCap: number;
  /** Regeneração: `amount` a cada `ticks` segundos [TFS `gainhpticks` etc.]. */
  hpTicks: number;
  hpAmount: number;
  manaTicks: number;
  manaAmount: number;
  /** Intervalo entre ataques, ms [TFS `attackspeed`]. */
  attackSpeedMs: number;
  /** Multiplicadores do `<formula>` [TFS]: todos 1,0 na base. */
  meleeDamage: number;
  distDamage: number;
  defense: number;
  armor: number;
}

const NONE_SKILLS = {
  punhos: 1.5,
  maca: 2.0,
  espada: 2.0,
  machado: 2.0,
  distancia: 2.0,
  escudo: 1.5,
} as const;
const SORC_SKILLS = {
  punhos: 1.5,
  maca: 2.0,
  espada: 2.0,
  machado: 2.0,
  distancia: 2.0,
  escudo: 1.5,
} as const;
const DRUID_SKILLS = {
  punhos: 1.5,
  maca: 1.8,
  espada: 1.8,
  machado: 1.8,
  distancia: 1.8,
  escudo: 1.5,
} as const;
const PALADIN_SKILLS = {
  punhos: 1.2,
  maca: 1.2,
  espada: 1.2,
  machado: 1.2,
  distancia: 1.1,
  escudo: 1.1,
} as const;
const KNIGHT_SKILLS = {
  punhos: 1.1,
  maca: 1.1,
  espada: 1.1,
  machado: 1.1,
  distancia: 1.4,
  escudo: 1.1,
} as const;

const COMMON = {
  attackSpeedMs: 2000,
  meleeDamage: 1,
  distDamage: 1,
  defense: 1,
  armor: 1,
} as const;

/**
 * [nosso] O multiplicador do tiro do Arqueiro e do Caçador (24/11/2026). Com as habilidades
 * menores (abilities.ts), o tiro normal faz uns 73% do dano do arqueiro no level 60 de árvore
 * cheia e as habilidades 27%, como no cavaleiro (26%); antes as habilidades eram 84% e 400
 * renascimentos quase dobravam o dano. O valor (4) devolve o conforto de antes: o trio vence
 * na entrada de todas as dungeons e o arqueiro sozinho fica perto do que era (comfort-levels.ts,
 * 80 corridas). Ele não muda a proporção: as habilidades saem do mesmo tiro máximo.
 */
export const ARCHER_DIST_DAMAGE = 4;

/** As 9 vocações do TFS (vocations.xml:3-90), com os nossos nomes. */
export const VOCATIONS: Readonly<Record<VocationId, Vocation>> = {
  0: {
    id: 0,
    name: "Aprendiz",
    base: 0,
    promotion: null,
    skill: NONE_SKILLS,
    manaMultiplier: 4.0,
    gainHp: 5,
    gainMana: 5,
    gainCap: 10,
    hpTicks: 6,
    hpAmount: 1,
    manaTicks: 6,
    manaAmount: 1,
    ...COMMON,
  },
  1: {
    id: 1,
    name: "Feiticeiro",
    base: 1,
    promotion: 5,
    skill: SORC_SKILLS,
    manaMultiplier: 1.1,
    gainHp: 5,
    gainMana: 30,
    gainCap: 10,
    hpTicks: 6,
    hpAmount: 5,
    manaTicks: 3,
    manaAmount: 5,
    ...COMMON,
  },
  2: {
    id: 2,
    name: "Druida",
    base: 2,
    promotion: 6,
    skill: DRUID_SKILLS,
    manaMultiplier: 1.1,
    gainHp: 5,
    gainMana: 30,
    gainCap: 10,
    hpTicks: 6,
    hpAmount: 5,
    manaTicks: 3,
    manaAmount: 5,
    ...COMMON,
  },
  3: {
    id: 3,
    name: "Arqueiro",
    base: 3,
    promotion: 7,
    skill: PALADIN_SKILLS,
    manaMultiplier: 1.4,
    gainHp: 10,
    gainMana: 15,
    gainCap: 20,
    hpTicks: 4,
    hpAmount: 5,
    manaTicks: 4,
    manaAmount: 5,
    ...COMMON,
    // [nosso] 24/11/2026: o tiro do arco é a base do arqueiro (o multiplicador de distância da
    // vocação [TFS vocations.xml distDamage]), e as habilidades, a menor parte do dano, como no
    // cavaleiro: o renascimento cresce a árvore sem teto (rebirth-lab.ts).
    distDamage: ARCHER_DIST_DAMAGE,
  },
  4: {
    id: 4,
    name: "Cavaleiro",
    base: 4,
    promotion: 8,
    skill: KNIGHT_SKILLS,
    manaMultiplier: 3.0,
    gainHp: 15,
    gainMana: 5,
    gainCap: 25,
    hpTicks: 3,
    hpAmount: 5,
    manaTicks: 6,
    manaAmount: 5,
    ...COMMON,
  },
  5: {
    id: 5,
    name: "Arquimago",
    base: 1,
    promotion: null,
    skill: SORC_SKILLS,
    manaMultiplier: 1.1,
    gainHp: 5,
    gainMana: 30,
    gainCap: 10,
    hpTicks: 4,
    hpAmount: 10,
    manaTicks: 2,
    manaAmount: 10,
    ...COMMON,
  },
  6: {
    id: 6,
    name: "Ancião",
    base: 2,
    promotion: null,
    skill: DRUID_SKILLS,
    manaMultiplier: 1.1,
    gainHp: 5,
    gainMana: 30,
    gainCap: 10,
    hpTicks: 4,
    hpAmount: 10,
    manaTicks: 2,
    manaAmount: 10,
    ...COMMON,
  },
  7: {
    id: 7,
    name: "Caçador",
    base: 3,
    promotion: null,
    skill: PALADIN_SKILLS,
    manaMultiplier: 1.4,
    gainHp: 10,
    gainMana: 15,
    gainCap: 20,
    hpTicks: 3,
    hpAmount: 10,
    manaTicks: 3,
    manaAmount: 10,
    ...COMMON,
    // [nosso] 24/11/2026: o tiro do arco é a base do arqueiro (o multiplicador de distância da
    // vocação [TFS vocations.xml distDamage]), e as habilidades, a menor parte do dano, como no
    // cavaleiro: o renascimento cresce a árvore sem teto (rebirth-lab.ts).
    distDamage: ARCHER_DIST_DAMAGE,
  },
  8: {
    id: 8,
    name: "Campeão",
    base: 4,
    promotion: null,
    skill: KNIGHT_SKILLS,
    manaMultiplier: 3.0,
    gainHp: 15,
    gainMana: 5,
    gainCap: 25,
    hpTicks: 2,
    hpAmount: 10,
    manaTicks: 4,
    manaAmount: 10,
    ...COMMON,
  },
};

/**
 * A vocação "do topo" que o treino offline usa para o ritmo [TFS offline_training.lua:56-58]:
 * a promoção, se existir; senão a própria.
 */
export function topVocation(v: Vocation): Vocation {
  return v.promotion !== null ? VOCATIONS[v.promotion] : v;
}

/**
 * Taxas do servidor [TFS config.lua.dist:145-148]. `skill` e `magic` = 2 por decisão do
 * dono (23/11/2026, "entre 1 e 3"); `exp` e `loot` ficam no padrão do TFS. São chaves do
 * operador: o servidor pode trocar sem deploy.
 */
export interface Rates {
  exp: number;
  skill: number;
  magic: number;
  loot: number;
}
export const DEFAULT_RATES: Readonly<Rates> = {
  exp: 1.5,
  skill: 2,
  magic: 2,
  loot: 2,
};

/** Vida, mana e capacidade de um herói novo [TFS schema.sql: health 150, mana 0, cap 400]. */
export const START = { level: 1, health: 150, mana: 0, cap: 400 } as const;
