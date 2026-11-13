import {
  MAX_SLOTS_PER_WING,
  MAX_WINGS,
  ROOM_INTERIOR,
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
  TilePos,
  TileRect,
} from "./types.ts";

/**
 * Deterministic layout: one fixed template for every Stoat server (ADR 0005).
 *
 *            north wings (even index) grow up ↑
 *   ┌──────lobby──────┐═══ spine (hall) ═══════════════════→ grows east
 *            south wings (odd index) grow down ↓
 *
 * Stability is by construction, not by bookkeeping: a wing's position depends
 * only on its index and a slot's position only on (wing index, slot index).
 * Appending a wing or a room never moves anything already placed; only the
 * spine and wing end caps extend. Coordinates are signed tile coordinates with
 * a fixed origin (the lobby's top-left), so north growth never shifts them.
 */

export const TEMPLATE_VERSION = 1 as const;

// Lobby (outer, walls included) and the spine rows it opens onto.
const LOBBY_W = 22;
const LOBBY_H = 16;
const MID_Y = 8;
const SPINE_WALL_N = MID_Y - 2; // 6
const SPINE_WALL_S = MID_Y + 2; // 10
const SPINE_X0 = LOBBY_W; // first spine column, right after the lobby east wall
const SPINE_LEAD = 3;

// Slots: an L room (12×9 interior, 14×11 outer) fills a slot exactly.
const SLOT_W = ROOM_INTERIOR.L.w + 2; // across the wing (x)
const SLOT_L = ROOM_INTERIOR.L.h + 2; // along the wing (y)
const CORRIDOR = 3;
const WING_W = 2 * SLOT_W + CORRIDOR; // 31
const WING_GAP = 2;

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

/** Left edge of the wing pair holding wing `index` (north and south share x). */
function wingX0(index: number): number {
  const pair = Math.floor(index / 2);
  return SPINE_X0 + SPINE_LEAD + pair * (WING_W + WING_GAP);
}

/** Rows of a slot level, as an inclusive range, for a north or south wing. */
function levelRows(north: boolean, level: number): { y0: number; y1: number } {
  const d0 = level * SLOT_L;
  const d1 = d0 + SLOT_L - 1;
  return north
    ? { y0: SPINE_WALL_N - 1 - d1, y1: SPINE_WALL_N - 1 - d0 }
    : { y0: SPINE_WALL_S + 1 + d0, y1: SPINE_WALL_S + 1 + d1 };
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
    for (const s of w.slots) {
      if (!s) continue;
      if (!s.roomId) throw new LayoutError("room without id");
      if (roomIds.has(s.roomId)) throw new LayoutError(`room ${s.roomId} placed twice`);
      roomIds.add(s.roomId);
      if (!(s.size in ROOM_INTERIOR)) throw new LayoutError(`bad size for ${s.roomId}`);
    }
  }
}

export function generateLayout(input: LayoutInput): CompiledMap {
  validate(input);
  const c = new Canvas();

  // Lobby, opening east onto the spine.
  const lobby = rect(0, 0, LOBBY_W - 1, LOBBY_H - 1);
  c.box(lobby, Tile.Floor);
  for (let y = SPINE_WALL_N + 1; y <= SPINE_WALL_S - 1; y++) c.set(LOBBY_W - 1, y, Tile.Floor);

  // Spine long enough for the furthest wing pair (or a stub with no wings).
  const maxWing = input.wings.reduce((m, w) => Math.max(m, w.index), -1);
  const spineEnd = maxWing >= 0 ? wingX0(maxWing) + WING_W - 1 + SPINE_LEAD : SPINE_X0 + SPINE_LEAD + 4;
  c.rect(rect(SPINE_X0, SPINE_WALL_N, spineEnd + 1, SPINE_WALL_N), Tile.Wall);
  c.rect(rect(SPINE_X0, SPINE_WALL_S, spineEnd + 1, SPINE_WALL_S), Tile.Wall);
  c.rect(rect(spineEnd + 1, SPINE_WALL_N, spineEnd + 1, SPINE_WALL_S), Tile.Wall);
  c.rect(rect(SPINE_X0, SPINE_WALL_N + 1, spineEnd, SPINE_WALL_S - 1), Tile.Floor);

  const wings: CompiledWing[] = [];
  const rooms: CompiledRoom[] = [];

  for (const w of [...input.wings].sort((a, b) => a.index - b.index)) {
    const north = w.index % 2 === 0;
    const x0 = wingX0(w.index);
    const cx0 = x0 + SLOT_W; // first corridor column
    const cx1 = cx0 + CORRIDOR - 1;
    const wallW = cx0 - 1;
    const wallE = cx1 + 1;
    let lastSlot = -1;
    w.slots.forEach((s, i) => {
      if (s) lastSlot = i;
    });
    const levels = Math.max(1, Math.floor(Math.max(lastSlot, w.slots.length - 1) / 2) + 1);
    const far = levelRows(north, levels - 1);
    const near = levelRows(north, 0);
    const corridor = north
      ? rect(cx0, far.y0, cx1, near.y1)
      : rect(cx0, near.y0, cx1, far.y1);

    // Corridor, its side walls, the end cap, and the opening in the spine wall.
    c.rect(rect(wallW, corridor.y0, wallW, corridor.y1), Tile.Wall);
    c.rect(rect(wallE, corridor.y0, wallE, corridor.y1), Tile.Wall);
    const capY = north ? corridor.y0 - 1 : corridor.y1 + 1;
    c.rect(rect(wallW, capY, wallE, capY), Tile.Wall);
    c.rect(corridor, Tile.Floor);
    c.rect(rect(cx0, north ? SPINE_WALL_N : SPINE_WALL_S, cx1, north ? SPINE_WALL_N : SPINE_WALL_S), Tile.Floor);
    wings.push({ index: w.index, title: w.title, north, corridor });

    w.slots.forEach((s, i) => {
      if (!s) return;
      rooms.push(placeRoom(c, s.roomId, s.label, s.size, w.index, i, north, wallW, wallE));
    });
  }

  // Spawn points spread over the lobby floor, away from walls.
  const spawns: TilePos[] = [];
  for (const ty of [5, 8, 11]) for (const tx of [5, 9, 13]) spawns.push({ tx, ty });

  return compile(c, lobby, rooms, wings, spawns);
}

function placeRoom(
  c: Canvas,
  roomId: string,
  label: string,
  size: RoomSize,
  wingIndex: number,
  slotIndex: number,
  north: boolean,
  wallW: number,
  wallE: number,
): CompiledRoom {
  const { w, h } = ROOM_INTERIOR[size];
  const outW = w + 2;
  const outH = h + 2;
  const west = slotIndex % 2 === 0;
  const level = Math.floor(slotIndex / 2);
  const rows = levelRows(north, level);
  const y0 = rows.y0 + Math.floor((SLOT_L - outH) / 2);
  const y1 = y0 + outH - 1;
  // The room's corridor-facing wall IS the corridor side wall.
  const x1 = west ? wallW : wallE + outW - 1;
  const x0 = west ? wallW - outW + 1 : wallE;
  const outer = rect(x0, y0, x1, y1);
  c.box(outer, Tile.Floor);
  const doorY = y0 + Math.floor(outH / 2);
  const doorX = west ? wallW : wallE;
  c.set(doorX, doorY, Tile.Door);
  const interior = rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1);
  return {
    roomId,
    label,
    size,
    wingIndex,
    slotIndex,
    interior,
    outer,
    door: { tx: doorX, ty: doorY },
    outside: { tx: west ? doorX + 1 : doorX - 1, ty: doorY },
    inside: { tx: west ? doorX - 1 : doorX + 1, ty: doorY },
    labelAnchor: {
      tx: Math.floor((interior.x0 + interior.x1) / 2),
      ty: Math.floor((interior.y0 + interior.y1) / 2),
    },
  };
}

function compile(
  c: Canvas,
  lobby: TileRect,
  rooms: CompiledRoom[],
  wings: CompiledWing[],
  spawns: TilePos[],
): CompiledMap {
  const originTx = c.minX;
  const originTy = c.minY;
  const width = c.maxX - c.minX + 1;
  const height = c.maxY - c.minY + 1;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) tiles[y * width + x] = c.get(x + originTx, y + originTy);
  }
  rooms.sort((a, b) => a.wingIndex - b.wingIndex || a.slotIndex - b.slotIndex);
  const map: CompiledMap = {
    format: "muchat.space.map",
    formatVersion: 1,
    templateVersion: TEMPLATE_VERSION,
    tileSize: TILE,
    originTx,
    originTy,
    width,
    height,
    tiles,
    rooms,
    wings,
    lobby,
    spawns,
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
