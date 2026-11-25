import type { EnemyInput, Family } from "../combat/types.ts";
import type { DungeonType } from "../formulas.ts";
import type { Monsters } from "../monsters/generate.ts";

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
  maxSeconds: number;
  /** Ids antigos que apontam para esta DG (corridas em andamento e a TV; P11). */
  aliases: string[];
}

const KIND_NAME: Record<DungeonKind, string> = {
  cacada: "Caçada",
  masmorra: "Masmorra",
  regional: "Chefe de Região",
};

export function regionOf(level: number): Region {
  return REGIONS[
    Math.min(
      REGIONS.length - 1,
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
    kind === "regional" ? REGIONS[level / 50 - 1]! : regionOf(level);
  const maxMs = kind === "cacada" ? 8 * 60_000 : 10 * 60_000;
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
    party: kind === "cacada" ? { min: 1, max: 2 } : { min: 3, max: 4 },
    maxSeconds: maxMs / 1000,
    aliases,
  };
}

/** As ~99 DGs do catálogo, por nível. A "Toca dos Javalis" de hoje vira a Caçada de nível 1 (§12.2). */
export const DUNGEONS: DungeonDef[] = (() => {
  const out: DungeonDef[] = [];
  for (const r of REGIONS) {
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
})();

export function dungeonById(id: string): DungeonDef | undefined {
  return DUNGEONS.find((d) => d.id === id || d.aliases.includes(id));
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
  const o = { partySize, type };
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
