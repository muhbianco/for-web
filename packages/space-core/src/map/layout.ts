import {
  MAX_SLOTS_PER_WING,
  MAX_WINGS,
  ROOM_DEPTH,
  ROOM_INTERIOR,
  ROOM_LENGTH,
  type RoomSize,
  Tile,
  TILE,
  type TileKind,
} from "./constants.ts";
import type {
  CompiledMap,
  CompiledRoom,
  CompiledWing,
  LayoutInput,
  SlotInput,
  TilePos,
  TileRect,
} from "./types.ts";

/**
 * Deterministic layout, template 2: one fixed template for every Stoat server
 * (ADR 0005; proportions and shared walls from ADR 0007).
 *
 *            north wings (even index) grow up ↑
 *   ┌─hall─┐═══ spine ═══════════════════════→ grows east
 *            south wings (odd index) grow down ↓
 *
 * A wing is a 3-tile corridor leaving the spine, with rooms lined up on both
 * sides like houses on a street: even slots on the west side, odd slots on the
 * east side, each side stacking away from the spine. Every room is ROOM_DEPTH
 * deep, so a wing has straight outer walls; a room's length along the corridor
 * comes from its size. The first room of each side sits on the spine and opens
 * onto it; the others open onto the wing corridor. Walls are shared (room ↔
 * room, room ↔ corridor, wing ↔ wing, hall ↔ first wing), so the whole map
 * reads as one building.
 *
 * Stability is by construction, not by bookkeeping: a wing's x depends only
 * on its index, and a room's rows only on the sizes of the earlier slots on
 * its side of the same wing. Archived rooms keep their slot (and size) as a
 * walled, doorless block, so nothing after them moves. Appending a wing or a
 * room never moves anything already placed; only the spine and the far end of
 * a corridor extend. Coordinates are signed tile coordinates with a fixed
 * origin (the hall's top-left), so north growth never shifts them.
 */

export const TEMPLATE_VERSION = 2 as const;

// Hall (outer, walls included) and the spine rows it opens onto.
const LOBBY_W = 14;
const LOBBY_H = 11;
const MID_Y = 5;
const SPINE_WALL_N = MID_Y - 2; // 3
const SPINE_WALL_S = MID_Y + 2; // 7
const SPINE_X0 = LOBBY_W; // first spine floor column, right after the hall's east wall
const SPINE_STUB = 4; // spine floor length when there is no wing yet

const SIDE_W = ROOM_DEPTH + 2; // outer wall + interior + corridor-side wall
const CORRIDOR = 3;
const WING_W = 2 * SIDE_W + CORRIDOR; // 21
/** Adjacent wing pairs share their outer wall. */
const WING_PITCH = WING_W - 1;
/** A legacy `null` slot (template 1) had the largest footprint. */
const LEGACY_FREE_SIZE: RoomSize = "L";

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}

const PRIORITY: Record<TileKind, number> = {
  [Tile.Void]: 0,
  [Tile.Wall]: 1,
  [Tile.Floor]: 2,
  [Tile.Door]: 3,
};

/** Sparse painter: a higher-priority kind wins (Door > Floor > Wall > Void). */
class Canvas {
  private readonly cells = new Map<string, TileKind>();
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  set(tx: number, ty: number, kind: TileKind) {
    const key = `${tx},${ty}`;
    const prev = this.cells.get(key);
    if (prev !== undefined && PRIORITY[prev] >= PRIORITY[kind]) return;
    this.cells.set(key, kind);
    if (tx < this.minX) this.minX = tx;
    if (ty < this.minY) this.minY = ty;
    if (tx > this.maxX) this.maxX = tx;
    if (ty > this.maxY) this.maxY = ty;
  }

  rect(r: TileRect, kind: TileKind) {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) this.set(x, y, kind);
  }

  /** Walls on the border, `inner` inside. */
  box(r: TileRect, inner: TileKind) {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const edge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
        this.set(x, y, edge ? Tile.Wall : inner);
      }
    }
  }

  get(tx: number, ty: number): TileKind {
    return this.cells.get(`${tx},${ty}`) ?? Tile.Void;
  }
}

const rect = (x0: number, y0: number, x1: number, y1: number): TileRect => ({
  x0: Math.min(x0, x1),
  y0: Math.min(y0, y1),
  x1: Math.max(x0, x1),
  y1: Math.max(y0, y1),
});

/** West outer wall of the wing pair holding wing `index` (north and south share x). */
function wingX0(index: number): number {
  const pair = Math.floor(index / 2);
  return LOBBY_W - 1 + pair * WING_PITCH;
}

/** A slot as the generator sees it: legacy `null` is a free slot of the largest size. */
function slotOf(s: SlotInput | null | undefined): SlotInput {
  return s ?? { roomId: null, label: "", size: LEGACY_FREE_SIZE };
}

function validate(input: LayoutInput) {
  if (input.templateVersion !== TEMPLATE_VERSION) {
    throw new LayoutError(`unknown template version ${String(input.templateVersion)}`);
  }
  if (input.wings.length > MAX_WINGS) throw new LayoutError("too many wings");
  const wingIdx = new Set<number>();
  const roomIds = new Set<string>();
  for (const w of input.wings) {
    if (!Number.isInteger(w.index) || w.index < 0 || w.index >= MAX_WINGS) {
      throw new LayoutError(`wing index out of range: ${w.index}`);
    }
    if (wingIdx.has(w.index)) throw new LayoutError(`duplicate wing index ${w.index}`);
    wingIdx.add(w.index);
    if (w.slots.length > MAX_SLOTS_PER_WING) throw new LayoutError(`too many slots in wing ${w.index}`);
    for (const raw of w.slots) {
      if (!raw) continue;
      if (!(raw.size in ROOM_INTERIOR)) throw new LayoutError(`bad size ${String(raw.size)}`);
      if (raw.roomId === null) continue;
      if (!raw.roomId) throw new LayoutError("room without id");
      if (roomIds.has(raw.roomId)) throw new LayoutError(`room ${raw.roomId} placed twice`);
      roomIds.add(raw.roomId);
    }
  }
}

export function generateLayout(input: LayoutInput): CompiledMap {
  validate(input);
  const c = new Canvas();

  // Hall, opening east onto the spine.
  const lobby = rect(0, 0, LOBBY_W - 1, LOBBY_H - 1);
  c.box(lobby, Tile.Floor);
  for (let y = SPINE_WALL_N + 1; y <= SPINE_WALL_S - 1; y++) c.set(LOBBY_W - 1, y, Tile.Floor);
  const hall = rect(1, 1, LOBBY_W - 2, LOBBY_H - 2);

  // Spine up to the last wing pair's outer wall (or a stub with no wings).
  const maxWing = input.wings.reduce((m, w) => Math.max(m, w.index), -1);
  const spineEnd = maxWing >= 0 ? wingX0(maxWing) + WING_W - 2 : SPINE_X0 + SPINE_STUB - 1;
  c.rect(rect(SPINE_X0, SPINE_WALL_N, spineEnd + 1, SPINE_WALL_N), Tile.Wall);
  c.rect(rect(SPINE_X0, SPINE_WALL_S, spineEnd + 1, SPINE_WALL_S), Tile.Wall);
  c.rect(rect(spineEnd + 1, SPINE_WALL_N, spineEnd + 1, SPINE_WALL_S), Tile.Wall);
  const spine = rect(SPINE_X0, SPINE_WALL_N + 1, spineEnd, SPINE_WALL_S - 1);
  c.rect(spine, Tile.Floor);

  const wings: CompiledWing[] = [];
  const rooms: CompiledRoom[] = [];

  for (const w of [...input.wings].sort((a, b) => a.index - b.index)) {
    const north = w.index % 2 === 0;
    const x0 = wingX0(w.index);
    const wallW = x0 + SIDE_W - 1; // corridor west wall = west rooms' corridor-side wall
    const cx0 = wallW + 1;
    const cx1 = cx0 + CORRIDOR - 1;
    const wallE = cx1 + 1; // corridor east wall = east rooms' corridor-side wall
    const xEnd = x0 + WING_W - 1;
    const spineWall = north ? SPINE_WALL_N : SPINE_WALL_S;
    const away = north ? -1 : 1;

    // Two streets, each stacking away from the spine; the first room's near
    // wall is the spine wall itself, and its door opens onto the spine.
    const near = { west: spineWall, east: spineWall };
    const first = { west: true, east: true };
    w.slots.forEach((raw, i) => {
      const s = slotOf(raw);
      const west = i % 2 === 0;
      const side = west ? "west" : "east";
      const h = ROOM_INTERIOR[s.size].h;
      const far = near[side] + away * (h + 1);
      const outer = rect(west ? x0 : wallE, near[side], west ? wallW : xEnd, far);
      c.box(outer, Tile.Floor);
      if (s.roomId !== null) {
        const interior = rect(outer.x0 + 1, outer.y0 + 1, outer.x1 - 1, outer.y1 - 1);
        let door: TilePos;
        let outside: TilePos;
        let inside: TilePos;
        if (first[side]) {
          // Street corner: door in the spine wall, in the middle of the room.
          const doorX = interior.x0 + Math.floor(ROOM_DEPTH / 2);
          door = { tx: doorX, ty: spineWall };
          outside = { tx: doorX, ty: spineWall - away };
          inside = { tx: doorX, ty: spineWall + away };
        } else {
          const doorX = west ? wallW : wallE;
          const doorY = outer.y0 + 1 + Math.floor((h - 1) / 2);
          door = { tx: doorX, ty: doorY };
          outside = { tx: west ? doorX + 1 : doorX - 1, ty: doorY };
          inside = { tx: west ? doorX - 1 : doorX + 1, ty: doorY };
        }
        c.set(door.tx, door.ty, Tile.Door);
        rooms.push({
          roomId: s.roomId,
          label: s.label,
          size: s.size,
          wingIndex: w.index,
          slotIndex: i,
          interior,
          outer,
          door,
          outside,
          inside,
          labelAnchor: {
            tx: Math.floor((interior.x0 + interior.x1) / 2),
            ty: Math.floor((interior.y0 + interior.y1) / 2),
          },
        });
      }
      near[side] = far;
      first[side] = false;
    });

    // The corridor runs to the longer street's end (at least one S room deep).
    const minFar = spineWall + away * (ROOM_LENGTH.S + 1);
    const farthest = north
      ? Math.min(near.west, near.east, minFar)
      : Math.max(near.west, near.east, minFar);
    const corridor = north
      ? rect(cx0, farthest + 1, cx1, spineWall - 1)
      : rect(cx0, spineWall + 1, cx1, farthest - 1);
    c.rect(rect(wallW, corridor.y0, wallW, corridor.y1), Tile.Wall);
    c.rect(rect(wallE, corridor.y0, wallE, corridor.y1), Tile.Wall);
    c.rect(rect(wallW, farthest, wallE, farthest), Tile.Wall);
    c.rect(corridor, Tile.Floor);
    // Opening in the spine wall.
    c.rect(rect(cx0, spineWall, cx1, spineWall), Tile.Floor);
    wings.push({ index: w.index, title: w.title, north, corridor });
  }

  // Spawn points in the middle of the hall, in front of the exit.
  const spawns: TilePos[] = [];
  for (const ty of [MID_Y - 1, MID_Y + 1]) for (const tx of [5, 7, 9]) spawns.push({ tx, ty });

  return compile(c, { lobby, hall, spine, rooms, wings, spawns });
}

function compile(
  c: Canvas,
  parts: {
    lobby: TileRect;
    hall: TileRect;
    spine: TileRect;
    rooms: CompiledRoom[];
    wings: CompiledWing[];
    spawns: TilePos[];
  },
): CompiledMap {
  const originTx = c.minX;
  const originTy = c.minY;
  const width = c.maxX - c.minX + 1;
  const height = c.maxY - c.minY + 1;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) tiles[y * width + x] = c.get(x + originTx, y + originTy);
  }
  parts.rooms.sort((a, b) => a.wingIndex - b.wingIndex || a.slotIndex - b.slotIndex);
  const map: CompiledMap = {
    format: "muchat.space.map",
    formatVersion: 2,
    templateVersion: TEMPLATE_VERSION,
    tileSize: TILE,
    originTx,
    originTy,
    width,
    height,
    tiles,
    rooms: parts.rooms,
    wings: parts.wings,
    lobby: parts.lobby,
    hall: parts.hall,
    spine: parts.spine,
    spawns: parts.spawns,
    fingerprint: "",
  };
  map.fingerprint = fingerprint(map);
  return map;
}

/** FNV-1a 32-bit over the canonical content. Not a security hash. */
export function fingerprint(map: Omit<CompiledMap, "fingerprint"> & { fingerprint?: string }): string {
  let h = 0x811c9dc5;
  const mix = (byte: number) => {
    h ^= byte & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const text = JSON.stringify([
    map.templateVersion,
    map.originTx,
    map.originTy,
    map.width,
    map.height,
    map.rooms.map((r) => [r.roomId, r.label, r.size, r.wingIndex, r.slotIndex]),
    map.wings.map((w) => [w.index, w.title]),
  ]);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    mix(code);
    mix(code >> 8);
  }
  for (const t of map.tiles) mix(t);
  return h.toString(16).padStart(8, "0");
}
