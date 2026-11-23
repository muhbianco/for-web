import type { Element } from "./items.ts";
import type { LootEntry } from "./loot.ts";

/**
 * Monstros do jogo idle (etapa O5). Ficha com os campos da ficha do TFS
 * (data/monster/monsters/*.xml): vida, experiência, ataques com intervalo, chance e faixa,
 * defesa, armadura, elementos em % e loot em 1/100.000. Os monstros são nossos; os números
 * dos primeiros ficam na faixa dos monstros iniciais do TFS.
 */
export interface MonsterAttack {
  /** Corpo a corpo (passa pela defesa e pela armadura) ou magia (elemental, só a física pela armadura). */
  kind: "melee" | "magia";
  name?: string;
  intervalMs: number;
  /** Chance em % a cada intervalo [TFS `chance`; o corpo a corpo é sempre 100]. */
  chance: number;
  element: Element;
  min: number;
  max: number;
  /** Atinge o grupo inteiro [TFS área com `radius`]. */
  area?: boolean;
}

export interface MonsterDef {
  id: string;
  name: string;
  boss?: boolean;
  health: number;
  experience: number;
  armor: number;
  defense: number;
  attacks: readonly MonsterAttack[];
  /** Cura própria [TFS <defense name="healing">]. */
  heal?: { intervalMs: number; chance: number; min: number; max: number };
  /** % de dano a menos por elemento (negativo = fraqueza) [TFS `<element *Percent>`]. */
  elements?: Readonly<Partial<Record<Element, number>>>;
  loot: readonly LootEntry[];
}

const coins = (chance: number, countMax: number): LootEntry => ({
  item: "moedas",
  chance,
  countMax,
  stackable: true,
});
const drop = (item: string, chance: number): LootEntry => ({
  item,
  chance,
  countMax: 1,
  stackable: false,
});

const melee = (min: number, max: number): MonsterAttack => ({
  kind: "melee",
  intervalMs: 2000,
  chance: 100,
  element: "fisico",
  min,
  max,
});

const LIST: readonly MonsterDef[] = [
  // ---- Cripta do Musgo ------------------------------------------------------
  {
    id: "rato-do-musgo",
    name: "Rato do musgo",
    health: 20,
    experience: 5,
    armor: 1,
    defense: 1,
    attacks: [melee(0, 8)],
    elements: { terra: 20, sagrado: 20, gelo: -10, morte: -10 },
    loot: [coins(75_000, 4)],
  },
  {
    id: "morcego-da-cripta",
    name: "Morcego da cripta",
    health: 30,
    experience: 10,
    armor: 1,
    defense: 1,
    attacks: [melee(0, 8)],
    elements: { terra: -10 },
    loot: [coins(60_000, 6)],
  },
  {
    id: "ossada-inquieta",
    name: "Ossada inquieta",
    health: 50,
    experience: 35,
    armor: 2,
    defense: 2,
    attacks: [
      melee(0, 15),
      {
        kind: "magia",
        name: "Toque gelado",
        intervalMs: 2000,
        chance: 15,
        element: "morte",
        min: 7,
        max: 13,
      },
    ],
    elements: { sagrado: -25, morte: 100 },
    loot: [
      coins(70_000, 10),
      drop("espada-de-ferro", 1_500),
      drop("elmo-de-ferro", 2_000),
    ],
  },
  {
    id: "matriarca-do-musgo",
    name: "Matriarca do Musgo",
    boss: true,
    health: 220,
    experience: 150,
    armor: 2,
    defense: 2,
    attacks: [
      melee(0, 18),
      {
        kind: "magia",
        name: "Esporos",
        intervalMs: 2000,
        chance: 20,
        element: "terra",
        min: 6,
        max: 12,
      },
    ],
    heal: { intervalMs: 2000, chance: 10, min: 8, max: 15 },
    elements: { terra: 30, fogo: -10 },
    loot: [
      coins(100_000, 40),
      drop("espada-de-ferro", 12_000),
      drop("maca-cravejada", 10_000),
      drop("machado-de-lenhador", 10_000),
      drop("escudo-de-bronze", 15_000),
      drop("elmo-de-ferro", 15_000),
      drop("colete-de-escamas", 10_000),
      drop("tunica-de-linho", 12_000),
      drop("besta-leve", 8_000),
      drop("varinha-de-brasa", 8_000),
      drop("bastao-de-raiz", 8_000),
    ],
  },

  // ---- Galerias Afogadas ----------------------------------------------------
  {
    id: "caranguejo-de-pedra",
    name: "Caranguejo de pedra",
    health: 55,
    experience: 30,
    armor: 8,
    defense: 8,
    attacks: [melee(0, 20)],
    elements: { gelo: 20, fogo: -10, energia: -10 },
    loot: [coins(80_000, 12), drop("botas-de-viajante", 2_500)],
  },
  {
    id: "troll-do-lodo",
    name: "Troll do lodo",
    health: 55,
    experience: 25,
    armor: 6,
    defense: 6,
    attacks: [melee(0, 15)],
    elements: { terra: 15, fogo: -5 },
    loot: [coins(70_000, 10), drop("calca-de-malha", 2_000)],
  },
  {
    id: "serpente-da-comporta",
    name: "Serpente da comporta",
    health: 90,
    experience: 55,
    armor: 7,
    defense: 7,
    attacks: [
      melee(0, 30),
      {
        kind: "magia",
        name: "Jato frio",
        intervalMs: 2000,
        chance: 20,
        element: "gelo",
        min: 10,
        max: 30,
      },
    ],
    elements: { gelo: 50, energia: -15 },
    loot: [
      coins(85_000, 20),
      drop("cota-de-malha", 2_500),
      drop("manto-azul", 2_500),
    ],
  },
  {
    id: "rei-das-comportas",
    name: "Rei das Comportas",
    boss: true,
    health: 900,
    experience: 700,
    armor: 12,
    defense: 12,
    attacks: [
      melee(0, 45),
      {
        kind: "magia",
        name: "Onda da comporta",
        intervalMs: 2000,
        chance: 18,
        element: "gelo",
        min: 15,
        max: 35,
        area: true,
      },
    ],
    heal: { intervalMs: 2000, chance: 10, min: 40, max: 80 },
    elements: { gelo: 80, energia: -20 },
    loot: [
      coins(100_000, 120),
      drop("espada-larga", 10_000),
      drop("machado-de-batalha", 10_000),
      drop("martelo-de-guerra", 10_000),
      drop("escudo-de-aco", 12_000),
      drop("cota-de-malha", 12_000),
      drop("arco-composto", 10_000),
      drop("varinha-de-geada", 12_000),
      drop("manto-azul", 10_000),
    ],
  },

  // ---- Forja Rachada --------------------------------------------------------
  {
    id: "automato-de-ferro",
    name: "Autômato de ferro",
    health: 220,
    experience: 160,
    armor: 15,
    defense: 15,
    attacks: [melee(0, 55)],
    elements: { fisico: 10, fogo: 20, energia: -15 },
    loot: [coins(90_000, 40), drop("elmo-de-aco", 2_000)],
  },
  {
    id: "brasa-viva",
    name: "Brasa viva",
    health: 200,
    experience: 145,
    armor: 12,
    defense: 12,
    attacks: [
      melee(0, 35),
      {
        kind: "magia",
        name: "Labareda",
        intervalMs: 2000,
        chance: 20,
        element: "fogo",
        min: 30,
        max: 60,
      },
    ],
    elements: { fogo: 100, gelo: -20, energia: 20 },
    loot: [coins(85_000, 35), drop("varinha-ardente", 1_500)],
  },
  {
    id: "martelador",
    name: "Martelador",
    health: 320,
    experience: 260,
    armor: 18,
    defense: 18,
    attacks: [melee(0, 85)],
    elements: { terra: 10, fogo: 10, morte: -10 },
    loot: [
      coins(90_000, 60),
      drop("placa-de-ferreiro", 1_500),
      drop("cajado-de-pedra", 1_500),
    ],
  },
  {
    id: "guardiao-da-forja",
    name: "Guardião da Forja",
    boss: true,
    health: 2_800,
    experience: 2_500,
    armor: 25,
    defense: 25,
    attacks: [
      melee(0, 120),
      {
        kind: "magia",
        name: "Sopro da forja",
        intervalMs: 2000,
        chance: 20,
        element: "fogo",
        min: 40,
        max: 90,
        area: true,
      },
    ],
    heal: { intervalMs: 2000, chance: 10, min: 80, max: 160 },
    elements: { fogo: 100, gelo: -15, energia: 10 },
    loot: [
      coins(100_000, 300),
      drop("lamina-da-forja", 10_000),
      drop("machado-rachado", 10_000),
      drop("malho-de-brasa", 10_000),
      drop("escudo-da-forja", 12_000),
      drop("placa-de-ferreiro", 12_000),
      drop("elmo-de-aco", 12_000),
      drop("arco-de-guerra", 10_000),
      drop("varinha-ardente", 12_000),
      drop("cajado-de-pedra", 12_000),
    ],
  },
];

export const MONSTERS: Readonly<Record<string, MonsterDef>> =
  Object.fromEntries(LIST.map((m) => [m.id, m]));

export function monsterDef(id: string): MonsterDef | undefined {
  return MONSTERS[id];
}
