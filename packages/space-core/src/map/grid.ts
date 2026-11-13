import { Tile, TILE, type TileKind } from "./constants.ts";
import type { CompiledMap, CompiledRoom, TilePos } from "./types.ts";

/** Tile kind at signed tile coordinates; outside the grid is Void. */
export function tileAt(map: CompiledMap, tx: number, ty: number): TileKind {
  const x = tx - map.originTx;
  const y = ty - map.originTy;
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return Tile.Void;
  return (map.tiles[y * map.width + x] ?? Tile.Void) as TileKind;
}

export const tileOfPx = (px: number): number => Math.floor(px / TILE);

/** Centre of a tile in world px. */
export function tileCenter(p: TilePos): { x: number; y: number } {
  return { x: p.tx * TILE + TILE / 2, y: p.ty * TILE + TILE / 2 };
}

/**
 * Lookup tables built once per compiled map: which room's interior or door a
 * tile belongs to. Kept outside CompiledMap so the map stays plain data.
 */
export interface MapIndex {
  map: CompiledMap;
  roomsById: Map<string, CompiledRoom>;
  /** room index + 1 for interior tiles, 0 elsewhere. */
  interiorOf: Int32Array;
  /** "tx,ty" of a door tile → room. */
  doorOf: Map<string, CompiledRoom>;
}

export function indexMap(map: CompiledMap): MapIndex {
  const interiorOf = new Int32Array(map.width * map.height);
  const doorOf = new Map<string, CompiledRoom>();
  const roomsById = new Map<string, CompiledRoom>();
  map.rooms.forEach((r, i) => {
    roomsById.set(r.roomId, r);
    doorOf.set(`${r.door.tx},${r.door.ty}`, r);
    for (let ty = r.interior.y0; ty <= r.interior.y1; ty++) {
      for (let tx = r.interior.x0; tx <= r.interior.x1; tx++) {
        interiorOf[(ty - map.originTy) * map.width + (tx - map.originTx)] = i + 1;
      }
    }
  });
  return { map, roomsById, interiorOf, doorOf };
}

export type Region =
  | { kind: "room"; roomId: string }
  | { kind: "door"; roomId: string }
  | { kind: "open" }
  | { kind: "blocked" };

/** Region under a world-px point (the avatar centre). */
export function regionAt(ix: MapIndex, x: number, y: number): Region {
  const tx = tileOfPx(x);
  const ty = tileOfPx(y);
  const kind = tileAt(ix.map, tx, ty);
  if (kind === Tile.Door) {
    const room = ix.doorOf.get(`${tx},${ty}`);
    return room ? { kind: "door", roomId: room.roomId } : { kind: "blocked" };
  }
  if (kind !== Tile.Floor) return { kind: "blocked" };
  const lx = tx - ix.map.originTx;
  const ly = ty - ix.map.originTy;
  const ri = ix.interiorOf[ly * ix.map.width + lx] ?? 0;
  const room = ri > 0 ? ix.map.rooms[ri - 1] : undefined;
  return room ? { kind: "room", roomId: room.roomId } : { kind: "open" };
}

/**
 * Room membership after moving into `region`. The door tile is a neutral
 * threshold: standing on it (or jittering across it) keeps the current room,
 * so membership only changes after crossing a whole tile.
 */
export function nextRoom(current: string | null, region: Region): string | null {
  switch (region.kind) {
    case "room":
      return region.roomId;
    case "door":
    case "blocked":
      return current;
    case "open":
      return null;
  }
}
