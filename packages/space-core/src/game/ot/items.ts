import type { HitCap } from "./combat.ts";
import type { VocationId } from "./data.ts";

/**
 * Itens do jogo idle (docs/espaco/jogo/ot, etapa O5). Nomes e itens são nossos; os números
 * ficam na faixa dos itens iniciais do TFS (items.xml, weapons.xml) para as fórmulas de
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

export type Slot = "arma" | "escudo" | "cabeca" | "corpo" | "pernas" | "pes";
export const ARMOR_SLOTS = ["cabeca", "corpo", "pernas", "pes"] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

/** A skill que a arma usa: espada, machado e maça no corpo a corpo, distância, varinha. */
export type WeaponKind =
  | "espada"
  | "machado"
  | "maca"
  | "distancia"
  | "varinha";

export interface ItemDef {
  id: string;
  name: string;
  /** Onde se veste; null: não é equipamento (as moedas). */
  slot: Slot | null;
  kind?: WeaponKind;
  attack?: number;
  defense?: number;
  armor?: number;
  /** Teto de acerto da arma de distância [TFS weapons.cpp:681-690]. */
  hitCap?: HitCap;
  /** Varinha: dano elemental fixo por tiro e mana por tiro [TFS weapons.xml <wand>]. */
  wand?: { element: Element; min: number; max: number; mana: number };
  minLevel?: number;
  /** Vocações base que usam; sem a lista, todas. */
  vocations?: readonly VocationId[];
  /** Peso em centésimos de oz [TFS items.xml `weight`]. */
  weight: number;
  /** Valor em moedas: o que não cabe na mochila é vendido por isso na saída [nosso]. */
  value: number;
  stackable?: boolean;
  /** Do kit da vocação: todo herói tem, não pesa, não cai. */
  starter?: boolean;
}

const KNIGHT: readonly VocationId[] = [4];
const PALADIN: readonly VocationId[] = [3];
const SORC: readonly VocationId[] = [1];
const DRUID: readonly VocationId[] = [2];
const MAGES: readonly VocationId[] = [1, 2];
const FRONT: readonly VocationId[] = [3, 4];

const LIST: readonly ItemDef[] = [
  // Moedas: vão direto para a bolsa de ouro do herói.
  {
    id: "moedas",
    name: "Moedas",
    slot: null,
    weight: 0,
    value: 1,
    stackable: true,
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
  {
    id: "arco-de-caca",
    name: "Arco de caça",
    slot: "arma",
    kind: "distancia",
    attack: 25,
    hitCap: 90,
    vocations: PALADIN,
    weight: 3100,
    value: 0,
    starter: true,
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
    attack: 30,
    hitCap: 100,
    minLevel: 6,
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
  {
    id: "arco-composto",
    name: "Arco composto",
    slot: "arma",
    kind: "distancia",
    attack: 35,
    hitCap: 90,
    minLevel: 15,
    vocations: PALADIN,
    weight: 3500,
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
  {
    id: "arco-de-guerra",
    name: "Arco de guerra",
    slot: "arma",
    kind: "distancia",
    attack: 42,
    hitCap: 90,
    minLevel: 25,
    vocations: PALADIN,
    weight: 4000,
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

/** O kit de uma vocação base (o que todo herói dela tem sem ganhar). */
export function starterKit(base: VocationId): ItemDef[] {
  return LIST.filter(
    (i) => i.starter && (!i.vocations || i.vocations.includes(base)),
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
