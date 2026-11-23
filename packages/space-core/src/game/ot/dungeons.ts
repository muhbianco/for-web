/**
 * Dungeons do jogo idle (docs/espaco/jogo/ot). Conteúdo nosso (nomes, temas, salas); as
 * regras de combate, experiência, grupo e loot são as do OT (TFS). Os monstros estão em
 * monsters.ts e a corrida em run.ts.
 */
export type DungeonId =
  | "cripta-do-musgo"
  | "galerias-afogadas"
  | "forja-rachada";

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
   * só informação para o menu). Medido no simulador em 23/11/2026: 120 sementes por level, kit
   * inicial com o melhor vestido, 100 flechas, 5 poções, skill principal 10 + 2·level, escudo
   * 10 + level, magic level do mago = level (o treino dos heróis de produção). `group` é o trio
   * cavaleiro + arqueiro + druida; `solo`, por vocação base (null: sozinho não dá até o 50).
   */
  comfort: {
    group: number;
    solo: Readonly<Record<1 | 2 | 3 | 4, number | null>>;
  };
  blurb: string;
  stages: readonly DungeonStage[];
}

export const DUNGEONS: readonly Dungeon[] = [
  {
    id: "cripta-do-musgo",
    name: "Cripta do Musgo",
    minLevel: 1,
    comfort: { group: 1, solo: { 1: 4, 2: 4, 3: 1, 4: 1 } },
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
    id: "galerias-afogadas",
    name: "Galerias Afogadas",
    minLevel: 8,
    comfort: { group: 10, solo: { 1: 16, 2: 18, 3: 24, 4: 32 } },
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
    id: "forja-rachada",
    name: "Forja Rachada",
    minLevel: 20,
    comfort: { group: 36, solo: { 1: null, 2: null, 3: null, 4: null } },
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
];

export function dungeonOf(id: string): Dungeon | undefined {
  return DUNGEONS.find((d) => d.id === id);
}

/** Regras da sala de preparação na TV (etapa O4). */
export const LOBBY = {
  /** Até 4: o bônus de grupo do OT é máximo com 4 vocações diferentes [TFS party.lua]. */
  maxMembers: 4,
  /** A sala de preparação some sozinha se ninguém começar [nosso]. */
  ttlMs: 5 * 60 * 1000,
} as const;
