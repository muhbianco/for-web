import type { CompiledMap, TileRect } from "../map/types.ts";

/**
 * Zones are the places decoration is anchored to (ADR 0007): the hall, the
 * spine, each wing corridor and each room interior. Instances store
 * coordinates relative to their zone, so a room keeps its furniture wherever
 * a later template puts it.
 */
export type ZoneKind = "hall" | "spine" | "corridor" | "room";

export interface Zone {
  /** `hall`, `spine`, `wing:<index>`, `room:<roomId>`. */
  key: string;
  kind: ZoneKind;
  /** Walkable rectangle of the zone (absolute tiles). */
  rect: TileRect;
  roomId?: string;
  wingIndex?: number;
  /** PT-BR label for the editor; room names come from the viewer's room views. */
  label: string;
}

export interface ZoneIndex {
  byKey: Map<string, Zone>;
  list: Zone[];
}

export const roomZoneKey = (roomId: string) => `room:${roomId}`;
export const wingZoneKey = (index: number) => `wing:${index}`;

export function zonesOf(map: CompiledMap): ZoneIndex {
  const list: Zone[] = [
    { key: "hall", kind: "hall", rect: map.hall, label: "Hall de entrada" },
    { key: "spine", kind: "spine", rect: map.spine, label: "Corredor principal" },
  ];
  for (const w of map.wings) {
    list.push({ key: wingZoneKey(w.index), kind: "corridor", rect: w.corridor, wingIndex: w.index, label: `Corredor da ala ${w.index + 1}` });
  }
  for (const r of map.rooms) {
    list.push({ key: roomZoneKey(r.roomId), kind: "room", rect: r.interior, roomId: r.roomId, label: r.label || "Sala" });
  }
  return { byKey: new Map(list.map((z) => [z.key, z])), list };
}

/** The zone whose walkable rectangle holds the tile, if any. */
export function zoneAt(zones: ZoneIndex, tx: number, ty: number): Zone | undefined {
  for (const z of zones.list) {
    if (tx >= z.rect.x0 && tx <= z.rect.x1 && ty >= z.rect.y0 && ty <= z.rect.y1) return z;
  }
  return undefined;
}

export const zoneWidth = (z: Zone) => z.rect.x1 - z.rect.x0 + 1;
export const zoneHeight = (z: Zone) => z.rect.y1 - z.rect.y0 + 1;
