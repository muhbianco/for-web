import {
  type DungeonDef,
  ALL_DUNGEONS,
  ALL_REGIONS,
  dungeonById,
} from "./catalog.ts";

/**
 * DG concluída e a trava do Chefe de Região (pedido do dono, 26/11/2026): uma vitória do grupo
 * marca a DG como concluída para todos que estavam nele, e o chefe de cada região só abre para o
 * herói que já concluiu todas as Caçadas e Masmorras daquela região. No grupo, cada herói precisa
 * ter concluído (não dá para "carregar" quem não concluiu).
 */

/** O limite de ids guardados (o catálogo inteiro cabe com folga). */
export const CLEARED_MAX = 256;

/** Ids canônicos (o alias antigo vira o id de hoje), sem repetidos, só os que existem, na ordem do catálogo. */
export function normalizeCleared(ids: readonly string[]): string[] {
  const set = new Set<string>();
  for (const id of ids) {
    const d = dungeonById(id);
    if (d) set.add(d.id);
  }
  return ALL_DUNGEONS.filter((d) => set.has(d.id)).map((d) => d.id);
}

/** As DGs que abrem o Chefe de Região: as Caçadas e Masmorras da região dele (vazio para os outros tipos). */
export function bossPrereqs(d: DungeonDef): DungeonDef[] {
  if (d.kind !== "regional") return [];
  return ALL_DUNGEONS.filter(
    (x) => x.region.index === d.region.index && x.kind !== "regional",
  );
}

/** O que ainda falta para enfrentar a DG (vazio: libera; só o chefe tem o que faltar). */
export function bossMissing(
  d: DungeonDef,
  cleared: readonly string[],
): DungeonDef[] {
  const done = new Set(normalizeCleared(cleared));
  return bossPrereqs(d).filter((x) => !done.has(x.id));
}

/** As regiões cujo chefe o herói já pode enfrentar (vai no membro do grupo, `RpgLobbyMember.regions`). */
export function bossRegions(cleared: readonly string[]): number[] {
  const done = new Set(normalizeCleared(cleared));
  return ALL_REGIONS.filter((r) =>
    ALL_DUNGEONS.every(
      (x) =>
        x.region.index !== r.index || x.kind === "regional" || done.has(x.id),
    ),
  ).map((r) => r.index);
}

/** A DG vencida entra na lista (uma vez); devolve a lista nova, normalizada. */
export function withCleared(
  cleared: readonly string[] | undefined,
  dungeon: string,
): string[] {
  return normalizeCleared([...(cleared ?? []), dungeon]);
}
