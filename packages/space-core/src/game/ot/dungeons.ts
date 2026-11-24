import { allTierDungeons } from "./tiers.ts";

/**
 * Dungeons do jogo idle (docs/espaco/jogo/ot). Conteúdo nosso (nomes, temas, salas); as
 * regras de combate, experiência, grupo e loot são as do OT (TFS). Os monstros estão em
 * monsters.ts e a corrida em run.ts.
 */
/** As dungeons de antes; as das faixas do 85 ao 500 vêm de tiers.ts (qualquer texto). */
export type DungeonId =
  | string
  | "cripta-do-musgo"
  | "toca-dos-javalis"
  | "galerias-afogadas"
  | "ninho-das-aranhas"
  | "forja-rachada"
  | "mina-assombrada"
  | "bosque-petrificado"
  | "cidadela-de-cinzas"
  | "abismo-gelado"
  | "trono-do-vazio";

/** Uma sala da dungeon: os monstros entram juntos; a última é a do chefe. */
export interface DungeonStage {
  name: string;
  monsters: readonly { id: string; count: number }[];
}

export interface Dungeon {
  id: DungeonId;
  name: string;
  /** Level mínimo para entrar (cada membro). */
  minLevel: number;
  /**
   * [nosso] Level a partir do qual a dungeon fica confortável (vence 70% ou mais das corridas;
   * só informação para o menu). Medido em 24/11/2026 com scripts/comfort-levels.ts (60 sementes
   * por level), no herói dos atributos e da árvore: os 5 pontos por level na construção típica
   * da classe, min(60, level) pontos na árvore, o melhor equipamento já ao alcance no level,
   * skill e magic level do treino de produção e as poções da faixa; desde os itens com atributos
   * (24/11/2026, engine 8), os atributos deles e o melhor anel e colar. `group` é o trio cavaleiro +
   * arqueiro + druida; `solo`, por vocação base (null: sozinho não dá).
   */
  comfort: {
    group: number;
    solo: Readonly<Record<1 | 2 | 3 | 4, number | null>>;
  };
  blurb: string;
  stages: readonly DungeonStage[];
  /** As salas com a arte de uma dungeon de antes e outra cor (as faixas de tiers.ts). */
  look?: { like: string; tint: string };
}

const BASE_DUNGEONS: readonly Dungeon[] = [
  {
    id: "cripta-do-musgo",
    name: "Cripta do Musgo",
    minLevel: 1,
    comfort: { group: 1, solo: { 1: 2, 2: 2, 3: 1, 4: 1 } },
    blurb:
      "Ratos, esqueletos e a Matriarca do Musgo no fundo. A primeira descida.",
    stages: [
      {
        name: "Entrada alagada",
        monsters: [{ id: "rato-do-musgo", count: 3 }],
      },
      {
        name: "Galeria dos ossos",
        monsters: [
          { id: "rato-do-musgo", count: 2 },
          { id: "ossada-inquieta", count: 1 },
        ],
      },
      {
        name: "Ninho dos morcegos",
        monsters: [
          { id: "morcego-da-cripta", count: 3 },
          { id: "ossada-inquieta", count: 1 },
        ],
      },
      {
        name: "Câmara da Matriarca",
        monsters: [
          { id: "matriarca-do-musgo", count: 1 },
          { id: "rato-do-musgo", count: 2 },
        ],
      },
    ],
  },
  {
    id: "toca-dos-javalis",
    name: "Toca dos Javalis",
    minLevel: 4,
    comfort: { group: 4, solo: { 1: 4, 2: 4, 3: 4, 4: 4 } },
    blurb: "Lobos, javalis e quem caça nas tocas. O Rei Javali guarda o fundo.",
    stages: [
      {
        name: "Trilha dos lobos",
        monsters: [{ id: "lobo-cinzento", count: 3 }],
      },
      {
        name: "Lamaçal",
        monsters: [
          { id: "javali-bravo", count: 2 },
          { id: "lobo-cinzento", count: 1 },
        ],
      },
      {
        name: "Acampamento",
        monsters: [
          { id: "cacador-da-toca", count: 2 },
          { id: "javali-bravo", count: 1 },
        ],
      },
      {
        name: "Covil do Rei",
        monsters: [
          { id: "rei-javali", count: 1 },
          { id: "javali-bravo", count: 2 },
        ],
      },
    ],
  },
  {
    id: "galerias-afogadas",
    name: "Galerias Afogadas",
    minLevel: 8,
    comfort: { group: 8, solo: { 1: 8, 2: 8, 3: 8, 4: 10 } },
    blurb: "Túneis alagados e o que vive neles. Pede um grupo que se cure.",
    stages: [
      {
        name: "Comporta velha",
        monsters: [{ id: "caranguejo-de-pedra", count: 3 }],
      },
      {
        name: "Lodaçal",
        monsters: [
          { id: "troll-do-lodo", count: 3 },
          { id: "caranguejo-de-pedra", count: 1 },
        ],
      },
      {
        name: "Canal fundo",
        monsters: [
          { id: "serpente-da-comporta", count: 2 },
          { id: "troll-do-lodo", count: 2 },
        ],
      },
      {
        name: "Trono das águas",
        monsters: [
          { id: "rei-das-comportas", count: 1 },
          { id: "caranguejo-de-pedra", count: 2 },
        ],
      },
    ],
  },
  {
    id: "ninho-das-aranhas",
    name: "Ninho das Aranhas",
    minLevel: 13,
    comfort: { group: 13, solo: { 1: 13, 2: 13, 3: 13, 4: 17 } },
    blurb: "Teias, veneno e casulos. Fogo ajuda; a Rainha cura a si mesma.",
    stages: [
      {
        name: "Teias da entrada",
        monsters: [
          { id: "aranha-tecela", count: 2 },
          { id: "larva-gigante", count: 1 },
        ],
      },
      {
        name: "Galeria dos casulos",
        monsters: [
          { id: "larva-gigante", count: 2 },
          { id: "aranha-saltadora", count: 1 },
        ],
      },
      {
        name: "Poço das saltadoras",
        monsters: [
          { id: "aranha-saltadora", count: 2 },
          { id: "aranha-tecela", count: 1 },
        ],
      },
      {
        name: "Trono de seda",
        monsters: [
          { id: "rainha-aranha", count: 1 },
          { id: "aranha-tecela", count: 2 },
        ],
      },
    ],
  },
  {
    id: "forja-rachada",
    name: "Forja Rachada",
    minLevel: 20,
    comfort: { group: 20, solo: { 1: 24, 2: 20, 3: 20, 4: 26 } },
    blurb:
      "Uma forja antiga acordada. Fogo, ferro e um guardião que não cai fácil.",
    stages: [
      {
        name: "Pátio de escória",
        monsters: [{ id: "automato-de-ferro", count: 2 }],
      },
      {
        name: "Fornalhas",
        monsters: [
          { id: "brasa-viva", count: 2 },
          { id: "automato-de-ferro", count: 1 },
        ],
      },
      {
        name: "Bigorna partida",
        monsters: [
          { id: "martelador", count: 2 },
          { id: "brasa-viva", count: 1 },
        ],
      },
      {
        name: "Coração da forja",
        monsters: [
          { id: "guardiao-da-forja", count: 1 },
          { id: "automato-de-ferro", count: 1 },
        ],
      },
    ],
  },
  {
    id: "mina-assombrada",
    name: "Mina Assombrada",
    minLevel: 27,
    comfort: { group: 27, solo: { 1: 37, 2: 34, 3: 37, 4: 46 } },
    blurb:
      "Mineiros que não foram embora. Golpe físico entra menos; luz sagrada entra mais.",
    stages: [
      {
        name: "Poço de acesso",
        monsters: [{ id: "mineiro-espectral", count: 2 }],
      },
      {
        name: "Veio de carvão",
        monsters: [
          { id: "golem-de-carvao", count: 1 },
          { id: "morcego-vampiro", count: 2 },
        ],
      },
      {
        name: "Galeria desabada",
        monsters: [
          { id: "mineiro-espectral", count: 2 },
          { id: "golem-de-carvao", count: 1 },
        ],
      },
      {
        name: "Câmara do Capataz",
        monsters: [
          { id: "capataz-espectral", count: 1 },
          { id: "mineiro-espectral", count: 2 },
        ],
      },
    ],
  },
  {
    id: "bosque-petrificado",
    name: "Bosque Petrificado",
    minLevel: 35,
    comfort: { group: 35, solo: { 1: 41, 2: 35, 3: 41, 4: 50 } },
    blurb: "Um bosque virado pedra. Basiliscos, ents e a Medusa no centro.",
    stages: [
      {
        name: "Clareira de pedra",
        monsters: [
          { id: "harpia-de-granito", count: 2 },
          { id: "basilisco", count: 1 },
        ],
      },
      {
        name: "Bosque cinzento",
        monsters: [
          { id: "ent-de-pedra", count: 1 },
          { id: "basilisco", count: 2 },
        ],
      },
      {
        name: "Ninho das harpias",
        monsters: [{ id: "harpia-de-granito", count: 3 }],
      },
      {
        name: "Jardim da Medusa",
        monsters: [
          { id: "medusa-ancia", count: 1 },
          { id: "basilisco", count: 2 },
        ],
      },
    ],
  },
  {
    id: "cidadela-de-cinzas",
    name: "Cidadela de Cinzas",
    minLevel: 45,
    comfort: { group: 51, solo: { 1: null, 2: 75, 3: 72, 4: 78 } },
    blurb:
      "Uma fortaleza que queima há séculos. Gelo e luz sagrada ferem os demônios.",
    stages: [
      {
        name: "Portão queimado",
        monsters: [{ id: "cavaleiro-de-cinzas", count: 2 }],
      },
      {
        name: "Pátio das salamandras",
        monsters: [
          { id: "salamandra", count: 2 },
          { id: "cavaleiro-de-cinzas", count: 1 },
        ],
      },
      {
        name: "Capela profanada",
        monsters: [
          { id: "demonio-menor", count: 2 },
          { id: "salamandra", count: 1 },
        ],
      },
      {
        name: "Salão do trono",
        monsters: [
          { id: "senhor-das-cinzas", count: 1 },
          { id: "demonio-menor", count: 1 },
          { id: "cavaleiro-de-cinzas", count: 1 },
        ],
      },
    ],
  },
  {
    id: "abismo-gelado",
    name: "Abismo Gelado",
    minLevel: 55,
    comfort: { group: 55, solo: { 1: 91, 2: 73, 3: 76, 4: 94 } },
    blurb: "Frio que corta e gigantes no escuro. Fogo é o que eles temem.",
    stages: [
      { name: "Borda do abismo", monsters: [{ id: "lobo-glacial", count: 2 }] },
      {
        name: "Fenda",
        monsters: [
          { id: "espirito-da-nevasca", count: 2 },
          { id: "lobo-glacial", count: 1 },
        ],
      },
      {
        name: "Caverna dos gigantes",
        monsters: [{ id: "gigante-de-gelo", count: 2 }],
      },
      {
        name: "Ninho do Wyrm",
        monsters: [
          { id: "wyrm-de-gelo", count: 1 },
          { id: "espirito-da-nevasca", count: 1 },
        ],
      },
    ],
  },
  {
    id: "trono-do-vazio",
    name: "Trono do Vazio",
    minLevel: 70,
    comfort: { group: 70, solo: { 1: null, 2: 110, 3: null, 4: null } },
    blurb: "O fim do caminho. O que vive aqui come a luz.",
    stages: [
      { name: "Limiar", monsters: [{ id: "sombra-vazia", count: 2 }] },
      {
        name: "Corredor dos arautos",
        monsters: [
          { id: "arauto-do-vazio", count: 2 },
          { id: "sombra-vazia", count: 1 },
        ],
      },
      { name: "Fosso", monsters: [{ id: "devorador", count: 2 }] },
      {
        name: "Trono",
        monsters: [
          { id: "imperador-do-vazio", count: 1 },
          { id: "arauto-do-vazio", count: 1 },
        ],
      },
    ],
  },
];

/** As dungeons do jogo: as de antes e as das faixas do 85 ao 500 (tiers.ts). */
export const DUNGEONS: readonly Dungeon[] = [...BASE_DUNGEONS, ...allTierDungeons()];

export function dungeonOf(id: string): Dungeon | undefined {
  return DUNGEONS.find((d) => d.id === id);
}

/** Regras da sala de preparação na TV (etapa O4). */
export const LOBBY = {
  /** Até 4: o bônus de grupo do OT é máximo com 4 vocações diferentes [TFS party.lua]. */
  maxMembers: 4,
  /** A sala de preparação some sozinha se ninguém começar [nosso]. */
  ttlMs: 5 * 60 * 1000,
  /**
   * O grupo que já correu fica montado (24/11/2026, pedido do dono: "manter a pt quando a dg
   * acaba"): desfaz sozinho só depois disto sem corrida nenhuma (a TV fica livre de novo).
   */
  idleMs: 30 * 60 * 1000,
  /**
   * O loop (24/11/2026): a próxima corrida começa sozinha depois disto, o tempo de ver o
   * resultado e de parar se quiser.
   */
  loopDelayMs: 12 * 1000,
} as const;
