import type { EnemyInput, Family } from "../combat/types.ts";
import type { DungeonType } from "../formulas.ts";
import type { Monsters } from "../monsters/generate.ts";
import { DUNGEON_EDGE } from "./edge.generated.ts";

/**
 * O catálogo de DGs (spec §12): 10 regiões de 50 níveis; em cada uma, Caçadas em X+1, X+10, X+20,
 * X+30 e X+40, Masmorras em X+10 a X+40 (na região 1 só a partir do 20) e o Chefe de Região em X+50.
 * Quatro salas: 4 lacaios; 5 lacaios; 3 lacaios + 1 elite; o chefe. Numa DG de nível R os lacaios vão
 * de R−4 a R, elite e chefe ficam em R (decisão do dono, D14), e a entrada é a partir de R−5.
 */

export interface Region {
  index: number;
  from: number;
  to: number;
  name: string;
  /** Material do equipamento e do minério da região (§9.7). */
  material: string;
  families: Family[];
  /** Fração dos lacaios com auto-ataque mágico (a partir da região 2, 30% a 50%). */
  magicShare: number;
  bossName: string;
}

/** As 10 regiões calibradas (até o 500, o teto do herói). */
export const REGIONS: Region[] = [
  {
    index: 1,
    from: 1,
    to: 50,
    name: "Bosque dos Javalis",
    material: "Ferro",
    families: ["fera"],
    magicShare: 0,
    bossName: "Rei Javali Presa-de-Ferro",
  },
  {
    index: 2,
    from: 51,
    to: 100,
    name: "Pântano Sombrio",
    material: "Bronze",
    families: ["fera", "humanoide"],
    magicShare: 0.3,
    bossName: "Matriarca do Lodo",
  },
  {
    index: 3,
    from: 101,
    to: 150,
    name: "Minas Anãs",
    material: "Aço",
    families: ["elemental", "humanoide"],
    magicShare: 0.3,
    bossName: "Golem Forjado",
  },
  {
    index: 4,
    from: 151,
    to: 200,
    name: "Deserto das Ruínas",
    material: "Prata",
    families: ["morto-vivo", "fera"],
    magicShare: 0.3,
    bossName: "Faraó Esquecido",
  },
  {
    index: 5,
    from: 201,
    to: 250,
    name: "Terras Congeladas",
    material: "Ouro Rúnico",
    families: ["elemental"],
    magicShare: 0.5,
    bossName: "Rainha do Inverno",
  },
  {
    index: 6,
    from: 251,
    to: 300,
    name: "Vulcão Rubro",
    material: "Obsidiana",
    families: ["elemental", "dragao"],
    magicShare: 0.3,
    bossName: "Senhor das Brasas",
  },
  {
    index: 7,
    from: 301,
    to: 350,
    name: "Cidade Afundada",
    material: "Coral Abissal",
    families: ["aberracao", "humanoide"],
    magicShare: 0.5,
    bossName: "Leviatã Coroado",
  },
  {
    index: 8,
    from: 351,
    to: 400,
    name: "Necrópole",
    material: "Osso Ancestral",
    families: ["morto-vivo", "sombrio"],
    magicShare: 0.3,
    bossName: "Arquilich",
  },
  {
    index: 9,
    from: 401,
    to: 450,
    name: "Templo Celeste",
    material: "Celestita",
    families: ["humanoide", "fera"],
    magicShare: 0.3,
    bossName: "Serafim Partido",
  },
  {
    index: 10,
    from: 451,
    to: 500,
    name: "O Vazio",
    material: "Vazio",
    families: ["aberracao", "sombrio"],
    magicShare: 0.3,
    bossName: "Devorador de Estrelas",
  },
];

/**
 * O fim de jogo (27/11/2026): do 501 ao 600, acima do teto do herói (500), na mesma progressão de
 * dificuldade (a tabela de monstros segue o ritmo do 400 ao 500 e o aperto repete o da região
 * anterior). Sem calibração: é para o grupo travar antes de zerar, mesmo acima do limite com perks.
 * O drop fica no iL 500 (run/loot.ts): nada aqui deixa o herói mais forte.
 */
export const ENDGAME_REGIONS: Region[] = [
  {
    index: 11,
    from: 501,
    to: 550,
    name: "Fenda Abissal",
    material: "Vazio",
    families: ["aberracao", "elemental"],
    magicShare: 0.5,
    bossName: "Arauto da Fenda",
  },
  {
    index: 12,
    from: 551,
    to: 600,
    name: "Trono do Fim",
    material: "Vazio",
    families: ["sombrio", "morto-vivo"],
    magicShare: 0.4,
    bossName: "O Último Rei",
  },
  // D69 (27/11/2026, o dono: "vamos dar mais DGs, até o 1000, com artes novas, acompanhando a
  // progressão de até agora; dessa forma a gente tem mais folga pra entender até onde os heróis
  // vão"). O mesmo ritmo de monstros (monsters/generate.ts) e o mesmo aperto do 451–500 (edgeOf).
  {
    index: 13,
    from: 601,
    to: 650,
    name: "Ermo das Cinzas Rubras",
    material: "Vazio",
    families: ["dragao", "elemental"],
    magicShare: 0.4,
    bossName: "Wyrm da Brasa Eterna",
  },
  {
    index: 14,
    from: 651,
    to: 700,
    name: "Catedral Partida",
    material: "Vazio",
    families: ["morto-vivo", "humanoide"],
    magicShare: 0.5,
    bossName: "Inquisidor Sem Rosto",
  },
  {
    index: 15,
    from: 701,
    to: 750,
    name: "Mar de Vidro Negro",
    material: "Vazio",
    families: ["aberracao", "elemental"],
    magicShare: 0.5,
    bossName: "Kraken de Obsidiana",
  },
  {
    index: 16,
    from: 751,
    to: 800,
    name: "Forja dos Titãs",
    material: "Vazio",
    families: ["elemental", "humanoide"],
    magicShare: 0.3,
    bossName: "Titã da Bigorna",
  },
  {
    index: 17,
    from: 801,
    to: 850,
    name: "Jardim das Almas",
    material: "Vazio",
    families: ["sombrio", "fera"],
    magicShare: 0.4,
    bossName: "Jardineira dos Lamentos",
  },
  {
    index: 18,
    from: 851,
    to: 900,
    name: "Torre do Eclipse",
    material: "Vazio",
    families: ["humanoide", "sombrio"],
    magicShare: 0.5,
    bossName: "Arquimago do Eclipse",
  },
  {
    index: 19,
    from: 901,
    to: 950,
    name: "Coração do Abismo",
    material: "Vazio",
    families: ["aberracao", "dragao"],
    magicShare: 0.4,
    bossName: "O Coração que Pulsa",
  },
  {
    index: 20,
    from: 951,
    to: 1000,
    name: "Horizonte Final",
    material: "Vazio",
    families: ["sombrio", "aberracao"],
    magicShare: 0.5,
    bossName: "Aquele que Apaga o Tempo",
  },
];

/** Todas as regiões do jogo: as calibradas e as do fim de jogo. */
export const ALL_REGIONS: Region[] = [...REGIONS, ...ENDGAME_REGIONS];

export type DungeonKind = "cacada" | "masmorra" | "regional";

export interface DungeonDef {
  id: string;
  name: string;
  kind: DungeonKind;
  level: number;
  region: Region;
  /** Entrada a partir deste nível (R − 5). */
  minLevel: number;
  party: { min: number; max: number };
  /** Ids antigos que apontam para esta DG (corridas em andamento e a TV; P11). */
  aliases: string[];
}

const KIND_NAME: Record<DungeonKind, string> = {
  cacada: "Caçada",
  masmorra: "Masmorra",
  regional: "Chefe de Região",
};

export function regionOf(level: number): Region {
  return ALL_REGIONS[
    Math.min(
      ALL_REGIONS.length - 1,
      Math.max(0, Math.floor((Math.max(1, level) - 1) / 50)),
    )
  ]!;
}

function dungeon(
  kind: DungeonKind,
  level: number,
  aliases: string[] = [],
): DungeonDef {
  const region =
    kind === "regional" ? ALL_REGIONS[level / 50 - 1]! : regionOf(level);
  return {
    id: kind === "regional" ? `regiao-${region.index}` : `${kind}-${level}`,
    name:
      kind === "regional"
        ? region.bossName
        : `${KIND_NAME[kind]} — ${region.name} (${level})`,
    kind,
    level,
    region,
    minLevel: Math.max(1, level - 5),
    // D41 (25/11/2026, pedido do dono): Masmorra e Região de 1 a 5 (a sala da Masmorra continua do
    // tamanho de um trio para menos de 3, `partyScale.masmorraMin`); a Caçada era de 1 a 3 e abriu
    // para 5 em 27/11/2026 (pedido do dono), crescendo com o 4º e o 5º (`loot.huntGroupFrom`).
    party: { min: 1, max: 5 },
    aliases,
  };
}

/** As DGs de uma lista de regiões, por nível. */
function dungeonsOf(regions: Region[]): DungeonDef[] {
  const out: DungeonDef[] = [];
  for (const r of regions) {
    const X = r.from - 1;
    for (const off of [1, 10, 20, 30, 40])
      out.push(
        dungeon("cacada", X + off, X === 0 && off === 1 ? ["toca"] : []),
      );
    for (const off of [10, 20, 30, 40])
      // D19: Masmorras só a partir do 40 (antes, o T1/T2 não sustenta a regra de composição).
      if (X + off >= 40) out.push(dungeon("masmorra", X + off));
    out.push(dungeon("regional", X + 50));
  }
  return out.sort((a, b) => a.level - b.level || a.kind.localeCompare(b.kind));
}

/**
 * As ~99 DGs calibradas, por nível (até o 500). A "Toca dos Javalis" de hoje vira a Caçada de nível 1
 * (§12.2). É a lista da calibração (relatório, aperto, jornada); o jogo usa `ALL_DUNGEONS`.
 */
export const DUNGEONS: DungeonDef[] = dungeonsOf(REGIONS);

/** As DGs do fim de jogo (501–1000), fora da calibração. */
export const ENDGAME_DUNGEONS: DungeonDef[] = dungeonsOf(ENDGAME_REGIONS);

/** Todas as DGs que o jogo oferece. */
export const ALL_DUNGEONS: DungeonDef[] = [...DUNGEONS, ...ENDGAME_DUNGEONS];

export function dungeonById(id: string): DungeonDef | undefined {
  return ALL_DUNGEONS.find((d) => d.id === id || d.aliases.includes(id));
}

/**
 * O aperto da DG (D41). As do fim de jogo não têm calibração: repetem o da DG equivalente da região
 * anterior (a Masmorra 510 usa o da 460; a Região 11, o da 10), e a dificuldade sobe pela tabela.
 */
export function edgeOf(d: DungeonDef) {
  let id = d.id;
  let level = d.level;
  // De 50 em 50 para trás até achar a DG calibrada equivalente (o fim de jogo, até o 1000, cai na
  // do 451–500; D69: antes parava em 4 passos e as acima do 700 ficariam sem aperto).
  while (level >= 1) {
    const e = DUNGEON_EDGE[id];
    if (e) return e;
    level -= 50;
    if (level < 1) return undefined;
    id =
      d.kind === "regional"
        ? `regiao-${level / 50}`
        : `${d.kind}-${level}`;
  }
  return undefined;
}

/** Tipo de DG para escala e XP (o Regional é uma Masmorra com recompensa ×2). */
export function dungeonType(d: DungeonDef): DungeonType {
  return d.kind === "cacada"
    ? "cacada"
    : d.kind === "masmorra"
      ? "masmorra"
      : "regional";
}

/**
 * As 4 salas, com os monstros gerados para o grupo. Os lacaios vão de R−4 a R, em rodízio; uma
 * fração deles (a da região) bate com magia; a família sai da lista da região.
 */
export function dungeonRooms(
  d: DungeonDef,
  partySize: number,
  M: Monsters,
): EnemyInput[][] {
  const type = dungeonType(d);
  const edge = edgeOf(d);
  const o = { partySize, type, ...(edge ? { edge } : {}) };
  const R = d.level;
  let k = 0;
  const family = () => d.region.families[k % d.region.families.length]!;
  const nextLacaio = (): EnemyInput => {
    const level = Math.max(1, R - 4 + (k % 5));
    const magic = k % 10 < Math.round(d.region.magicShare * 10);
    const fam = family();
    k++;
    return M.lacaio(level, { ...o, family: fam, magic });
  };
  const room1 = Array.from({ length: 4 }, nextLacaio);
  const room2 = Array.from({ length: 5 }, nextLacaio);
  const room3 = [
    ...Array.from({ length: 3 }, nextLacaio),
    M.elite(R, { ...o, family: family() }),
  ];
  const bossOpts = { ...o, family: family() };
  const boss =
    d.kind === "cacada"
      ? M.chefeMenor(R, bossOpts)
      : d.kind === "masmorra"
        ? M.chefe(R, bossOpts)
        : M.regional(R, bossOpts);
  return [room1, room2, room3, [boss]];
}
