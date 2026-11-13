import { AVATAR_RADIUS, Tile, TILE } from "../map/constants.ts";
import { type MapIndex, tileAt, tileOfPx } from "../map/grid.ts";

/**
 * Whether this person may cross `roomId`'s door right now. Door state and
 * authorization live on the server; the client mirrors what it was told so
 * it does not walk into doors that will be refused.
 */
export type DoorRule = (roomId: string) => boolean;

export interface Point {
  x: number;
  y: number;
}

function blocked(ix: MapIndex, tx: number, ty: number, door: DoorRule): boolean {
  const kind = tileAt(ix.map, tx, ty);
  if (kind === Tile.Floor) return false;
  if (kind === Tile.Door) {
    const room = ix.doorOf.get(`${tx},${ty}`);
    return !room || !door(room.roomId);
  }
  return true; // Wall or Void
}

/** Circle (avatar) vs blocked tiles. */
export function canOccupy(ix: MapIndex, p: Point, door: DoorRule, r = AVATAR_RADIUS): boolean {
  const tx0 = tileOfPx(p.x - r);
  const tx1 = tileOfPx(p.x + r);
  const ty0 = tileOfPx(p.y - r);
  const ty1 = tileOfPx(p.y + r);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!blocked(ix, tx, ty, door)) continue;
      // Nearest point of the tile square to the circle centre.
      const nx = Math.max(tx * TILE, Math.min(p.x, tx * TILE + TILE));
      const ny = Math.max(ty * TILE, Math.min(p.y, ty * TILE + TILE));
      const dx = p.x - nx;
      const dy = p.y - ny;
      if (dx * dx + dy * dy < r * r) return false;
    }
  }
  return true;
}

export interface SweepResult {
  /** Last valid point along the segment. */
  pos: Point;
  blocked: boolean;
}

const SUBSTEP = 4; // px; well under the radius, so no tunnelling through a wall

/**
 * Walks from → to in small steps; stops at the last point the avatar fits.
 *
 * If `from` itself does not fit (a door was locked while someone stood on the
 * threshold, or the map changed under them), the leading invalid stretch is
 * allowed so they can walk out. That alone could carry someone through a
 * locked door, so `applyMove` separately refuses entering a room whose door
 * this person may not cross.
 */
export function sweep(ix: MapIndex, from: Point, to: Point, door: DoorRule, r = AVATAR_RADIUS): SweepResult {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / SUBSTEP));
  let escaping = !canOccupy(ix, from, door, r);
  let lastValid: Point = from;
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + (dx * i) / steps, y: from.y + (dy * i) / steps };
    const ok = canOccupy(ix, p, door, r);
    if (escaping) {
      if (ok) {
        escaping = false;
        lastValid = p;
      }
      continue;
    }
    if (!ok) return { pos: lastValid, blocked: true };
    lastValid = p;
  }
  if (escaping) return { pos: from, blocked: true };
  return { pos: { x: to.x, y: to.y }, blocked: false };
}

/**
 * Client-side step with wall sliding: try the full move, then each axis.
 * Proposals built this way rarely get corrected by the server.
 */
export function slide(ix: MapIndex, from: Point, dx: number, dy: number, door: DoorRule, r = AVATAR_RADIUS): Point {
  const full = sweep(ix, from, { x: from.x + dx, y: from.y + dy }, door, r);
  if (!full.blocked) return full.pos;
  const xOnly = sweep(ix, from, { x: from.x + dx, y: from.y }, door, r);
  const yOnly = sweep(ix, xOnly.pos, { x: xOnly.pos.x, y: xOnly.pos.y + dy }, door, r);
  return yOnly.pos;
}
