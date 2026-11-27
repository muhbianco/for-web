import {
  type ArchetypeKey,
  type ClassId,
  type DungeonDef,
  type DungeonKind,
  type DungeonLootOdds,
  type RarityId,
  type Region,
  type RpgLobbyMember,
  balance as B,
  bossMissing,
  dungeonLootOdds,
  ALL_DUNGEONS,
  normalizeCleared,
  RARITY_IDS,
  ALL_REGIONS,
} from "@muchat/space-core/game/ot/balance";

/**
 * A tela de escolha de DG na TV (26/11/2026): as recomendadas para o nível, o catálogo por região
 * com "Concluída" e a trava do Chefe de Região, e o detalhe com o que cai e as chances. Só dados,
 * sem texto (os textos ficam em `gameText.ts` e nos componentes), para rodar nos testes do node.
 * Os números de drop saem do núcleo (`dungeonLootOdds`), o mesmo código do sorteio do servidor.
 */

export type DungeonFilter = DungeonKind | "todas";

export const KINDS: DungeonKind[] = ["cacada", "masmorra", "regional"];

/** O que impede o herói de entrar: o nível, ou o resto da região (o chefe). */
export type DungeonLock =
  | { why: "region"; missing: DungeonDef[] };

export interface DungeonRow {
  def: DungeonDef;
  done: boolean;
  lock: DungeonLock | null;
  recommended: boolean;
}

export interface RegionGroup {
  region: Region;
  /** A região do nível do herói (abre sozinha). */
  current: boolean;
  rows: DungeonRow[];
  /** Concluídas e total da região (todas as DGs dela, qualquer que seja o filtro). */
  done: number;
  total: number;
}

/**
 * A trava do herói para a DG: só o chefe de Região, que pede o resto da região. Desde 27/11/2026 o
 * nível não trava (o dono: "não vamos mais impedir ninguém de entrar em DG de level mais alto"): o
 * nível mínimo é só a recomendação.
 */
export function dungeonLock(
  d: DungeonDef,
  _level: number,
  cleared: readonly string[],
): DungeonLock | null {
  const missing = bossMissing(d, cleared);
  return missing.length > 0 ? { why: "region", missing } : null;
}

/** As recomendadas pelo nível: a mais alta de cada tipo em que o herói já entra (o selo "Recomendada"). */
export function recommendedDungeons(level: number): DungeonDef[] {
  const best = new Map<DungeonKind, DungeonDef>();
  for (const d of ALL_DUNGEONS) if (d.minLevel <= level) best.set(d.kind, d);
  return KINDS.flatMap((k) => (best.has(k) ? [best.get(k)!] : []));
}

export function dungeonRow(
  d: DungeonDef,
  level: number,
  cleared: readonly string[],
): DungeonRow {
  const done = new Set(normalizeCleared(cleared));
  return {
    def: d,
    done: done.has(d.id),
    lock: dungeonLock(d, level, cleared),
    recommended: recommendedDungeons(level).some((x) => x.id === d.id),
  };
}

/** O catálogo por região, com o filtro de tipo; as regiões sem DG no filtro somem. */
export function dungeonCatalog(
  level: number,
  cleared: readonly string[],
  filter: DungeonFilter,
): RegionGroup[] {
  const done = new Set(normalizeCleared(cleared));
  const rec = new Set(recommendedDungeons(level).map((d) => d.id));
  return ALL_REGIONS.map((region) => {
    const all = ALL_DUNGEONS.filter((d) => d.region.index === region.index);
    return {
      region,
      current: level >= region.from && level <= region.to,
      rows: all
        .filter((d) => filter === "todas" || d.kind === filter)
        .map((def) => ({
          def,
          done: done.has(def.id),
          lock: dungeonLock(def, level, cleared),
          recommended: rec.has(def.id),
        })),
      done: all.filter((d) => done.has(d.id)).length,
      total: all.length,
    };
  }).filter((g) => g.rows.length > 0);
}

/** Os tamanhos de grupo da DG (o seletor das chances). */
export function partySizes(d: DungeonDef): number[] {
  return Array.from(
    { length: d.party.max - d.party.min + 1 },
    (_, i) => d.party.min + i,
  );
}

/** O tamanho que as chances usam de saída: o do meu grupo (dentro do que a DG aceita), senão sozinho. */
export function partySizeFor(d: DungeonDef, members?: number): number {
  const n = members ?? 1;
  return Math.min(d.party.max, Math.max(d.party.min, n));
}

export interface RarityRow {
  rarity: RarityId;
  /** Chance de levar pelo menos um desta raridade numa corrida. */
  chance: number;
  /** Quantos desta raridade, em média, por corrida. */
  expected: number;
}

/** As 5 raridades, da Comum à Lendária, com a chance de cada uma para o herói. */
export function rarityRows(o: DungeonLootOdds): RarityRow[] {
  return RARITY_IDS.map((r) => ({
    rarity: r,
    chance: o.perHero.atLeastOne[r],
    expected: o.perHero.expected[r],
  }));
}

/** O destaque do cartão: as duas raridades mais altas que podem sair. */
export function topRarities(o: DungeonLootOdds, n = 2): RarityRow[] {
  return rarityRows(o)
    .filter((r) => r.chance > 0)
    .slice(-n)
    .reverse();
}

/** As chances da DG para o herói (classe) num grupo de `n`. */
export function oddsFor(d: DungeonDef, n: number, cls?: ClassId) {
  return dungeonLootOdds(d, n, cls);
}

/**
 * O que o chefe de cada tipo dá, para a legenda dos tipos: um item para o grupo ou um para cada um,
 * e a raridade mais baixa que sai dele (do `cfg.loot` do núcleo, nunca escrito à mão).
 */
export function bossLoot(kind: DungeonKind): {
  perPlayer: boolean;
  floor: RarityId;
} {
  const arch: ArchetypeKey =
    kind === "cacada"
      ? "chefeMenor"
      : kind === "masmorra"
        ? "chefe"
        : "regional";
  const src = B.cfg.loot.sources[arch];
  const weights: Partial<Record<RarityId, number>> = src.rarity;
  const floor = RARITY_IDS.find((r) => (weights[r] ?? 0) > 0) ?? RARITY_IDS[0]!;
  return { perPlayer: src.perPlayer, floor };
}

/** O tamanho de grupo do tipo (todas as DGs do tipo pedem o mesmo; a primeira serve). */
export function kindParty(kind: DungeonKind): { min: number; max: number } {
  return ALL_DUNGEONS.find((d) => d.kind === kind)!.party;
}

/** Quem do grupo ainda não pode enfrentar o chefe (o servidor manda as regiões de cada um). */
export function membersWithoutRegion(
  members: readonly RpgLobbyMember[],
  d: DungeonDef,
): RpgLobbyMember[] {
  if (d.kind !== "regional") return [];
  // Servidor anterior a 26/11/2026 não manda `regions`: sem dado, ninguém aparece.
  return members.filter(
    (m) => m.regions !== undefined && !m.regions.includes(d.region.index),
  );
}

/** O nível dos monstros e dos itens da DG: "36–40", ou "1" quando é um só (das salas de verdade). */
export function levelsText(d: DungeonDef): string {
  const { min, max } = dungeonLootOdds(d, 1).itemLevels;
  return min === max ? String(max) : `${min}–${max}`;
}
