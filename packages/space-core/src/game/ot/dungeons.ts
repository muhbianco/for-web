/**
 * Dungeons do jogo idle (docs/espaco/jogo/ot). Conteúdo nosso (nomes, temas); as regras de
 * combate, experiência, grupo e loot são as do OT (TFS). Na etapa O4 só os dados que a sala
 * de preparação na TV usa; as salas, os monstros e o chefe entram na O5.
 */
export type DungeonId =
  | "cripta-do-musgo"
  | "galerias-afogadas"
  | "forja-rachada";

export interface Dungeon {
  id: DungeonId;
  name: string;
  /** Level mínimo para entrar (cada membro). */
  minLevel: number;
  /** Level a partir do qual a dungeon fica confortável (só informação). */
  recommendedLevel: number;
  blurb: string;
}

export const DUNGEONS: readonly Dungeon[] = [
  {
    id: "cripta-do-musgo",
    name: "Cripta do Musgo",
    minLevel: 1,
    recommendedLevel: 8,
    blurb:
      "Ratos, esqueletos e a Matriarca do Musgo no fundo. A primeira descida.",
  },
  {
    id: "galerias-afogadas",
    name: "Galerias Afogadas",
    minLevel: 8,
    recommendedLevel: 20,
    blurb: "Túneis alagados e o que vive neles. Pede um grupo que se cure.",
  },
  {
    id: "forja-rachada",
    name: "Forja Rachada",
    minLevel: 20,
    recommendedLevel: 40,
    blurb:
      "Uma forja antiga acordada. Fogo, ferro e um guardião que não cai fácil.",
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
