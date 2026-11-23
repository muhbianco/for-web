import type { SkillId, VocationId } from "./data.ts";

/**
 * Itens do jogo idle (docs/espaco/jogo/ot, etapas O5 e O7). Nomes e itens são nossos; os
 * números ficam na faixa dos itens do TFS (items.xml, weapons.xml) para as fórmulas de
 * combate darem o mesmo ritmo.
 */

/** Tipos de dano [TFS enums.h CombatType_t], com os nossos nomes. */
export type Element =
  | "fisico"
  | "energia"
  | "terra"
  | "fogo"
  | "gelo"
  | "sagrado"
  | "morte";
export const ELEMENTS: readonly Element[] = [
  "fisico",
  "energia",
  "terra",
  "fogo",
  "gelo",
  "sagrado",
  "morte",
];

/**
 * Os 10 lugares do corpo [TFS creature.h slots_t, 1 a 10]: cabeça, colar, mochila, corpo,
 * as duas mãos, pernas, pés, anel e munição. A mão da arma e a do escudo [nosso: no TFS
 * qualquer mão serve para qualquer um; aqui cada coisa tem a sua].
 */
export type Slot =
  | "cabeca"
  | "colar"
  | "mochila"
  | "corpo"
  | "arma"
  | "escudo"
  | "pernas"
  | "pes"
  | "anel"
  | "municao";
export const SLOTS: readonly Slot[] = [
  "cabeca",
  "colar",
  "mochila",
  "corpo",
  "arma",
  "escudo",
  "pernas",
  "pes",
  "anel",
  "municao",
];
export const ARMOR_SLOTS = ["cabeca", "corpo", "pernas", "pes"] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

/** A skill que a arma usa: espada, machado e maça no corpo a corpo, distância, varinha. */
export type WeaponKind =
  | "espada"
  | "machado"
  | "maca"
  | "distancia"
  | "varinha";

/** Tipo de munição [TFS ammoType: arrow, bolt]. */
export type AmmoType = "flecha" | "virote";

export interface ItemDef {
  id: string;
  name: string;
  /** Onde se veste; null: não é equipamento (as moedas). */
  slot: Slot | null;
  kind?: WeaponKind;
  attack?: number;
  defense?: number;
  armor?: number;
  /** Usa as duas mãos: não cabe escudo [TFS slotType two-handed]. */
  twoHanded?: true;
  /** No arco e na besta, a munição que atiram; na munição, o tipo dela [TFS ammoType]. */
  ammo?: AmmoType;
  /** Teto de acerto da munição [TFS maxHitChance; 75, 90 e 100 usam as tabelas]. */
  maxHitChance?: number;
  /** Acerto a mais do arco, somado ao da munição [TFS hitChance do arco]. */
  hitChance?: number;
  /** Varinha: dano elemental fixo por tiro e mana por tiro [TFS weapons.xml <wand>]. */
  wand?: { element: Element; min: number; max: number; mana: number };
  /** Bolsa e mochila: quantos espaços [TFS containerSize]. */
  container?: number;
  /** Cargas de quem absorve dano: uma por golpe absorvido [TFS charges, player.cpp:2021-2028]. */
  charges?: number;
  /** Segundos de uso do anel [TFS duration]; [nosso] só corre na dungeon. */
  duration?: number;
  /** Skill a mais enquanto veste [TFS skillSword, skillAxe, skillClub]. */
  skillBonus?: Readonly<Partial<Record<SkillId, number>>>;
  /** % do dano que some, por elemento [TFS absorbPercent*]; negativo = dano a mais. */
  absorb?: Readonly<Partial<Record<Element, number>>>;
  /** Vida e mana a cada `ticksMs` enquanto veste [TFS healthGain/manaGain/healthTicks]. */
  regen?: { health: number; mana: number; ticksMs: number };
  minLevel?: number;
  /** Vocações base que usam; sem a lista, todas. */
  vocations?: readonly VocationId[];
  /** Peso em centésimos de oz [TFS items.xml `weight`]. */
  weight: number;
  /** Valor em moedas de ouro (o mercador paga por ele na etapa O8; 0: não compra). */
  value: number;
  stackable?: boolean;
  /** Do kit da vocação: todo herói ganha ao escolher a vocação. */
  starter?: boolean;
  /** Quantos do kit (munição). */
  starterCount?: number;
  /**
   * Poção (etapa O9): vida e mana na faixa (sorteio normal) e o frasco que sobra
   * [TFS actions/scripts/others/potions.lua].
   */
  potion?: {
    health?: readonly [number, number];
    mana?: readonly [number, number];
    flask: string;
  };
}

const KNIGHT: readonly VocationId[] = [4];
const PALADIN: readonly VocationId[] = [3];
const SORC: readonly VocationId[] = [1];
const DRUID: readonly VocationId[] = [2];
const MAGES: readonly VocationId[] = [1, 2];
const FRONT: readonly VocationId[] = [3, 4];

/** Os elementos que o TFS chama de "magic" [TFS items.cpp:1155-1163]. */
const magic = (pct: number): Partial<Record<Element, number>> => ({
  energia: pct,
  fogo: pct,
  terra: pct,
  gelo: pct,
  sagrado: pct,
  morte: pct,
});

/** As três moedas [TFS const.h ITEM_GOLD_COIN, ITEM_PLATINUM_COIN, ITEM_CRYSTAL_COIN]. */
export const GOLD = "moeda-de-ouro";
export const PLATINUM = "moeda-de-platina";
export const CRYSTAL = "moeda-de-cristal";
/** Da menor para a maior; cada uma vale 100 da anterior [TFS change_gold.lua]. */
export const COINS: readonly string[] = [GOLD, PLATINUM, CRYSTAL];

const LIST: readonly ItemDef[] = [
  // Moedas: 0,10 oz cada [TFS items.xml 2148, 2152, 2160], pilha de até 100.
  {
    id: GOLD,
    name: "Moeda de ouro",
    slot: null,
    weight: 10,
    value: 1,
    stackable: true,
  },
  {
    id: PLATINUM,
    name: "Moeda de platina",
    slot: null,
    weight: 10,
    value: 100,
    stackable: true,
  },
  {
    id: CRYSTAL,
    name: "Moeda de cristal",
    slot: null,
    weight: 10,
    value: 10_000,
    stackable: true,
  },

  // Recipientes [TFS items.xml 1987 bag, 1988 backpack]. A bolsa é a do primeiro dia
  // [TFS first_items.lua].
  {
    id: "bolsa",
    name: "Bolsa",
    slot: "mochila",
    container: 8,
    weight: 800,
    value: 0,
    starter: true,
  },
  {
    id: "mochila",
    name: "Mochila",
    slot: "mochila",
    container: 20,
    weight: 1800,
    value: 0,
  },

  // Kit de cada vocação [nosso]. A varinha do kit não gasta mana: o herói começa no level 1,
  // com mana 0 [TFS: level 1 sem vocação], e a varinha mais fraca do TFS gasta 1 por tiro.
  {
    id: "espada-curta",
    name: "Espada curta",
    slot: "arma",
    kind: "espada",
    attack: 12,
    defense: 10,
    vocations: KNIGHT,
    weight: 3500,
    value: 0,
    starter: true,
  },
  {
    id: "machadinha",
    name: "Machadinha",
    slot: "arma",
    kind: "machado",
    attack: 13,
    defense: 7,
    vocations: KNIGHT,
    weight: 4000,
    value: 0,
    starter: true,
  },
  {
    id: "porrete",
    name: "Porrete",
    slot: "arma",
    kind: "maca",
    attack: 12,
    defense: 9,
    vocations: KNIGHT,
    weight: 3800,
    value: 0,
    starter: true,
  },
  {
    id: "escudo-de-tabuas",
    name: "Escudo de tábuas",
    slot: "escudo",
    defense: 13,
    vocations: KNIGHT,
    weight: 4000,
    value: 0,
    starter: true,
  },
  // Arco e besta não têm ataque próprio: o dano vem da munição [TFS items.xml 2456, 2455;
  // weapons.cpp:839-849].
  {
    id: "arco-de-caca",
    name: "Arco de caça",
    slot: "arma",
    kind: "distancia",
    twoHanded: true,
    ammo: "flecha",
    vocations: PALADIN,
    weight: 3100,
    value: 0,
    starter: true,
  },
  {
    id: "flecha",
    name: "Flecha",
    slot: "municao",
    ammo: "flecha",
    attack: 25,
    maxHitChance: 91,
    vocations: PALADIN,
    weight: 70,
    value: 0,
    stackable: true,
    starter: true,
    starterCount: 100,
  },
  {
    id: "varinha-de-faiscas",
    name: "Varinha de faíscas",
    slot: "arma",
    kind: "varinha",
    wand: { element: "energia", min: 3, max: 7, mana: 0 },
    vocations: SORC,
    weight: 2200,
    value: 0,
    starter: true,
  },
  {
    id: "varinha-de-musgo",
    name: "Varinha de musgo",
    slot: "arma",
    kind: "varinha",
    wand: { element: "terra", min: 3, max: 7, mana: 0 },
    vocations: DRUID,
    weight: 2200,
    value: 0,
    starter: true,
  },
  {
    id: "capuz-de-couro",
    name: "Capuz de couro",
    slot: "cabeca",
    armor: 1,
    weight: 2200,
    value: 0,
    starter: true,
  },
  {
    id: "gibao-de-couro",
    name: "Gibão de couro",
    slot: "corpo",
    armor: 3,
    weight: 6000,
    value: 0,
    starter: true,
  },
  {
    id: "calca-de-couro",
    name: "Calça de couro",
    slot: "pernas",
    armor: 1,
    weight: 1800,
    value: 0,
    starter: true,
  },
  {
    id: "botas-de-couro",
    name: "Botas de couro",
    slot: "pes",
    armor: 1,
    weight: 900,
    value: 0,
    starter: true,
  },

  // Munição a mais [TFS items.xml 2543 bolt, 7364 sniper arrow, 7363 piercing bolt;
  // weapons.xml: gasta uma por tiro, `removecount`].
  {
    id: "virote",
    name: "Virote",
    slot: "municao",
    ammo: "virote",
    attack: 30,
    maxHitChance: 87,
    vocations: PALADIN,
    weight: 80,
    value: 0,
    stackable: true,
  },
  {
    id: "flecha-afiada",
    name: "Flecha afiada",
    slot: "municao",
    ammo: "flecha",
    attack: 28,
    maxHitChance: 100,
    minLevel: 20,
    vocations: PALADIN,
    weight: 70,
    value: 0,
    stackable: true,
  },
  {
    id: "virote-perfurante",
    name: "Virote perfurante",
    slot: "municao",
    ammo: "virote",
    attack: 33,
    maxHitChance: 87,
    minLevel: 25,
    vocations: PALADIN,
    weight: 80,
    value: 0,
    stackable: true,
  },

  // Colares [TFS items.xml 2200, 2198, 2201, 2161, 7887-7890, 2197]: absorvem e gastam carga.
  {
    id: "amuleto-do-escudeiro",
    name: "Amuleto do escudeiro",
    slot: "colar",
    absorb: { fisico: 6 },
    charges: 250,
    weight: 550,
    value: 100,
  },
  {
    id: "pingente-de-folha",
    name: "Pingente de folha",
    slot: "colar",
    absorb: { fisico: 5, ...magic(5) },
    charges: 50,
    weight: 270,
    value: 100,
  },
  {
    id: "colar-de-escamas",
    name: "Colar de escamas",
    slot: "colar",
    absorb: { fogo: 8 },
    charges: 200,
    weight: 630,
    value: 100,
  },
  {
    id: "talisma-de-cobre",
    name: "Talismã de cobre",
    slot: "colar",
    absorb: { energia: 10 },
    charges: 200,
    weight: 290,
    value: 100,
  },
  {
    id: "amuleto-de-musgo",
    name: "Amuleto de musgo",
    slot: "colar",
    absorb: { terra: 20, fogo: -10 },
    charges: 200,
    weight: 500,
    value: 1_500,
  },
  {
    id: "amuleto-de-geada",
    name: "Amuleto de geada",
    slot: "colar",
    absorb: { gelo: 20, energia: -10 },
    charges: 200,
    weight: 500,
    value: 1_500,
  },
  {
    id: "amuleto-de-lava",
    name: "Amuleto de lava",
    slot: "colar",
    absorb: { fogo: 20, gelo: -10 },
    charges: 200,
    weight: 500,
    value: 1_500,
  },
  {
    id: "pingente-de-raio",
    name: "Pingente de raio",
    slot: "colar",
    absorb: { energia: 20, terra: -10 },
    charges: 200,
    weight: 500,
    value: 1_500,
  },
  {
    id: "amuleto-de-pedra",
    name: "Amuleto de pedra",
    slot: "colar",
    absorb: { fisico: 80, morte: 80 },
    charges: 5,
    weight: 700,
    value: 500,
  },

  // Anéis [TFS items.xml 2205 ativo do 2168, 2216 do 2214, 2210-2212, 2164]: o tempo corre
  // enquanto veste; o de cargas gasta como o colar.
  {
    id: "anel-do-folego",
    name: "Anel do fôlego",
    slot: "anel",
    regen: { health: 2, mana: 8, ticksMs: 6000 },
    duration: 1200,
    weight: 80,
    value: 50,
  },
  {
    id: "anel-de-seiva",
    name: "Anel de seiva",
    slot: "anel",
    regen: { health: 6, mana: 24, ticksMs: 6000 },
    duration: 450,
    weight: 80,
    value: 100,
  },
  {
    id: "anel-do-gume",
    name: "Anel do gume",
    slot: "anel",
    skillBonus: { espada: 4 },
    duration: 1800,
    weight: 90,
    value: 100,
  },
  {
    id: "anel-do-lenhador",
    name: "Anel do lenhador",
    slot: "anel",
    skillBonus: { machado: 4 },
    duration: 1800,
    weight: 90,
    value: 100,
  },
  {
    id: "anel-do-martelo",
    name: "Anel do martelo",
    slot: "anel",
    skillBonus: { maca: 4 },
    duration: 1800,
    weight: 90,
    value: 100,
  },
  {
    id: "anel-da-firmeza",
    name: "Anel da firmeza",
    slot: "anel",
    absorb: { fisico: 20, ...magic(20) },
    charges: 20,
    weight: 100,
    value: 250,
  },

  // Poções [TFS potions.lua e items.xml 8704, 7618, 7620, 7588, 7589]: os mesmos números e
  // requisitos, com os nossos nomes. O frasco vazio volta para a mochila [TFS player:addItem].
  {
    id: "pocao-pequena-de-vida",
    name: "Poção pequena de vida",
    slot: null,
    potion: { health: [60, 90], flask: "frasco-vazio" },
    weight: 265,
    value: 0,
    stackable: true,
  },
  {
    id: "pocao-de-vida",
    name: "Poção de vida",
    slot: null,
    potion: { health: [125, 175], flask: "frasco-vazio" },
    weight: 270,
    value: 0,
    stackable: true,
  },
  {
    id: "pocao-de-mana",
    name: "Poção de mana",
    slot: null,
    potion: { mana: [75, 125], flask: "frasco-vazio" },
    weight: 270,
    value: 0,
    stackable: true,
  },
  {
    id: "pocao-forte-de-vida",
    name: "Poção forte de vida",
    slot: null,
    potion: { health: [250, 350], flask: "frasco-forte" },
    minLevel: 50,
    vocations: FRONT,
    weight: 290,
    value: 0,
    stackable: true,
  },
  {
    id: "pocao-forte-de-mana",
    name: "Poção forte de mana",
    slot: null,
    potion: { mana: [115, 185], flask: "frasco-forte" },
    minLevel: 50,
    weight: 290,
    value: 0,
    stackable: true,
  },
  // Frascos vazios [TFS items.xml 7636, 7634]; o mercador paga 5 por um [nosso, o preço do OT].
  {
    id: "frasco-vazio",
    name: "Frasco vazio",
    slot: null,
    weight: 150,
    value: 5,
    stackable: true,
  },
  {
    id: "frasco-forte",
    name: "Frasco vazio grande",
    slot: null,
    weight: 160,
    value: 5,
    stackable: true,
  },

  // Cripta do Musgo (level 1+).
  {
    id: "espada-de-ferro",
    name: "Espada de ferro",
    slot: "arma",
    kind: "espada",
    attack: 16,
    defense: 12,
    vocations: KNIGHT,
    weight: 3500,
    value: 60,
  },
  {
    id: "maca-cravejada",
    name: "Maça cravejada",
    slot: "arma",
    kind: "maca",
    attack: 16,
    defense: 10,
    vocations: KNIGHT,
    weight: 5000,
    value: 50,
  },
  {
    id: "machado-de-lenhador",
    name: "Machado de lenhador",
    slot: "arma",
    kind: "machado",
    attack: 17,
    defense: 8,
    vocations: KNIGHT,
    weight: 4500,
    value: 50,
  },
  {
    id: "escudo-de-bronze",
    name: "Escudo de bronze",
    slot: "escudo",
    defense: 16,
    vocations: KNIGHT,
    weight: 5000,
    value: 50,
  },
  {
    id: "elmo-de-ferro",
    name: "Elmo de ferro",
    slot: "cabeca",
    armor: 3,
    vocations: FRONT,
    weight: 3000,
    value: 30,
  },
  {
    id: "colete-de-escamas",
    name: "Colete de escamas",
    slot: "corpo",
    armor: 5,
    vocations: FRONT,
    weight: 8000,
    value: 40,
  },
  {
    id: "tunica-de-linho",
    name: "Túnica de linho",
    slot: "corpo",
    armor: 4,
    vocations: MAGES,
    weight: 2500,
    value: 35,
  },
  {
    id: "besta-leve",
    name: "Besta leve",
    slot: "arma",
    kind: "distancia",
    twoHanded: true,
    ammo: "virote",
    vocations: PALADIN,
    weight: 4000,
    value: 80,
  },
  {
    id: "varinha-de-brasa",
    name: "Varinha de brasa",
    slot: "arma",
    kind: "varinha",
    wand: { element: "fogo", min: 8, max: 18, mana: 2 },
    minLevel: 7,
    vocations: SORC,
    weight: 2200,
    value: 100,
  },
  {
    id: "bastao-de-raiz",
    name: "Bastão de raiz",
    slot: "arma",
    kind: "varinha",
    wand: { element: "terra", min: 8, max: 18, mana: 2 },
    minLevel: 7,
    vocations: DRUID,
    weight: 2200,
    value: 100,
  },

  // Galerias Afogadas (level 8+).
  {
    id: "espada-larga",
    name: "Espada larga",
    slot: "arma",
    kind: "espada",
    attack: 21,
    defense: 14,
    minLevel: 12,
    vocations: KNIGHT,
    weight: 4500,
    value: 150,
  },
  {
    id: "machado-de-batalha",
    name: "Machado de batalha",
    slot: "arma",
    kind: "machado",
    attack: 22,
    defense: 10,
    minLevel: 12,
    vocations: KNIGHT,
    weight: 5000,
    value: 150,
  },
  {
    id: "martelo-de-guerra",
    name: "Martelo de guerra",
    slot: "arma",
    kind: "maca",
    attack: 21,
    defense: 12,
    minLevel: 12,
    vocations: KNIGHT,
    weight: 6000,
    value: 150,
  },
  {
    id: "escudo-de-aco",
    name: "Escudo de aço",
    slot: "escudo",
    defense: 21,
    minLevel: 10,
    vocations: KNIGHT,
    weight: 6900,
    value: 120,
  },
  {
    id: "cota-de-malha",
    name: "Cota de malha",
    slot: "corpo",
    armor: 7,
    vocations: FRONT,
    weight: 10000,
    value: 120,
  },
  {
    id: "calca-de-malha",
    name: "Calça de malha",
    slot: "pernas",
    armor: 3,
    vocations: FRONT,
    weight: 3500,
    value: 60,
  },
  {
    id: "botas-de-viajante",
    name: "Botas de viajante",
    slot: "pes",
    armor: 2,
    weight: 1300,
    value: 40,
  },
  // [TFS items.xml 7438 elvish bow: acerto +5, sem ataque].
  {
    id: "arco-composto",
    name: "Arco composto",
    slot: "arma",
    kind: "distancia",
    twoHanded: true,
    ammo: "flecha",
    hitChance: 5,
    minLevel: 15,
    vocations: PALADIN,
    weight: 3900,
    value: 200,
  },
  {
    id: "varinha-de-geada",
    name: "Varinha de geada",
    slot: "arma",
    kind: "varinha",
    wand: { element: "gelo", min: 13, max: 25, mana: 3 },
    minLevel: 13,
    vocations: MAGES,
    weight: 2300,
    value: 250,
  },
  {
    id: "manto-azul",
    name: "Manto azul",
    slot: "corpo",
    armor: 6,
    minLevel: 10,
    vocations: MAGES,
    weight: 3000,
    value: 150,
  },

  // Forja Rachada (level 20+).
  {
    id: "lamina-da-forja",
    name: "Lâmina da forja",
    slot: "arma",
    kind: "espada",
    attack: 28,
    defense: 18,
    minLevel: 25,
    vocations: KNIGHT,
    weight: 5000,
    value: 600,
  },
  {
    id: "machado-rachado",
    name: "Machado rachado",
    slot: "arma",
    kind: "machado",
    attack: 30,
    defense: 14,
    minLevel: 25,
    vocations: KNIGHT,
    weight: 6000,
    value: 600,
  },
  {
    id: "malho-de-brasa",
    name: "Malho de brasa",
    slot: "arma",
    kind: "maca",
    attack: 29,
    defense: 16,
    minLevel: 25,
    vocations: KNIGHT,
    weight: 7000,
    value: 600,
  },
  {
    id: "escudo-da-forja",
    name: "Escudo da forja",
    slot: "escudo",
    defense: 27,
    minLevel: 25,
    vocations: KNIGHT,
    weight: 7500,
    value: 500,
  },
  {
    id: "placa-de-ferreiro",
    name: "Placa de ferreiro",
    slot: "corpo",
    armor: 10,
    minLevel: 20,
    vocations: KNIGHT,
    weight: 12000,
    value: 400,
  },
  {
    id: "elmo-de-aco",
    name: "Elmo de aço",
    slot: "cabeca",
    armor: 5,
    minLevel: 20,
    vocations: FRONT,
    weight: 4200,
    value: 250,
  },
  // [TFS items.xml 8855 composite hornbow: ataque 3, acerto +2].
  {
    id: "arco-de-guerra",
    name: "Arco de guerra",
    slot: "arma",
    kind: "distancia",
    twoHanded: true,
    ammo: "flecha",
    attack: 3,
    hitChance: 2,
    minLevel: 25,
    vocations: PALADIN,
    weight: 5200,
    value: 600,
  },
  {
    id: "varinha-ardente",
    name: "Varinha ardente",
    slot: "arma",
    kind: "varinha",
    wand: { element: "fogo", min: 27, max: 33, mana: 5 },
    minLevel: 19,
    vocations: SORC,
    weight: 2300,
    value: 600,
  },
  {
    id: "cajado-de-pedra",
    name: "Cajado de pedra",
    slot: "arma",
    kind: "varinha",
    wand: { element: "terra", min: 27, max: 33, mana: 5 },
    minLevel: 19,
    vocations: DRUID,
    weight: 2300,
    value: 600,
  },
];

export const ITEMS: Readonly<Record<string, ItemDef>> = Object.fromEntries(
  LIST.map((i) => [i.id, i]),
);

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS[id];
}

/** O kit de uma vocação base (o que todo herói dela ganha ao escolher a vocação). */
export function starterKit(base: VocationId): ItemDef[] {
  return LIST.filter(
    (i) =>
      i.starter &&
      i.slot !== "mochila" &&
      (!i.vocations || i.vocations.includes(base)),
  );
}

/** A vocação base e o level permitem usar o item? */
export function canUse(
  item: ItemDef,
  base: VocationId,
  level: number,
): boolean {
  if (item.slot === null) return false;
  if (item.vocations && !item.vocations.includes(base)) return false;
  return level >= (item.minLevel ?? 0);
}

/** A vocação base e o level permitem beber a poção? [TFS potions.lua: level e vocations]. */
export function canDrink(
  item: ItemDef,
  base: VocationId,
  level: number,
): boolean {
  if (!item.potion) return false;
  if (item.vocations && !item.vocations.includes(base)) return false;
  return level >= (item.minLevel ?? 0);
}

/** As poções do jogo (etapa O9). */
export function potionDefs(): ItemDef[] {
  return LIST.filter((i) => i.potion);
}

/** Por que não pode usar: "vocation", "level" ou null (pode). */
export function cannotUse(
  item: ItemDef,
  base: VocationId,
  level: number,
): "not_equipment" | "vocation" | "level" | null {
  if (item.slot === null) return "not_equipment";
  if (item.vocations && !item.vocations.includes(base)) return "vocation";
  if (level < (item.minLevel ?? 0)) return "level";
  return null;
}
