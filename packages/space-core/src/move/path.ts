import { Tile } from "../map/constants.ts";
import { type MapIndex, solidAt, tileAt } from "../map/grid.ts";
import type { TilePos } from "../map/types.ts";
import type { DoorRule } from "./collision.ts";

/** Hard cap on explored tiles: click-to-move must never stall a frame. */
export const MAX_PATH_NODES = 20_000;

function walkable(ix: MapIndex, tx: number, ty: number, door: DoorRule): boolean {
  const kind = tileAt(ix.map, tx, ty);
  if (kind === Tile.Floor) return !solidAt(ix, tx, ty);
  if (kind === Tile.Door) {
    const room = ix.doorOf.get(`${tx},${ty}`);
    return Boolean(room && door(room.roomId));
  }
  return false;
}

/** Minimal binary heap keyed by f-score. */
class Heap {
  private readonly items: Array<{ key: number; f: number }> = [];
  get size() {
    return this.items.length;
  }
  push(key: number, f: number) {
    const a = this.items;
    a.push({ key, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const ai = a[i];
      const ap = a[p];
      if (!ai || !ap || ap.f <= ai.f) break;
      a[i] = ap;
      a[p] = ai;
      i = p;
    }
  }
  pop(): number | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (!top || !last) return undefined;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if ((a[l]?.f ?? Infinity) < (a[m]?.f ?? Infinity)) m = l;
        if ((a[r]?.f ?? Infinity) < (a[m]?.f ?? Infinity)) m = r;
        if (m === i) break;
        const am = a[m];
        const ai = a[i];
        if (!am || !ai) break;
        a[m] = ai;
        a[i] = am;
        i = m;
      }
    }
    return top.key;
  }
}

/**
 * 4-neighbour A* over tiles. Returns the tile path from `start` to `goal`
 * (both included), or null when unreachable within MAX_PATH_NODES. Tile
 * centres keep 16 px from walls, more than the avatar radius.
 */
export function findPath(ix: MapIndex, start: TilePos, goal: TilePos, door: DoorRule): TilePos[] | null {
  const { map } = ix;
  const inGrid = (tx: number, ty: number) =>
    tx >= map.originTx && ty >= map.originTy && tx < map.originTx + map.width && ty < map.originTy + map.height;
  if (!inGrid(start.tx, start.ty) || !inGrid(goal.tx, goal.ty)) return null;
  if (!walkable(ix, goal.tx, goal.ty, door)) return null;
  const key = (tx: number, ty: number) => (ty - map.originTy) * map.width + (tx - map.originTx);
  const startKey = key(start.tx, start.ty);
  const goalKey = key(goal.tx, goal.ty);
  const g = new Map<number, number>([[startKey, 0]]);
  const came = new Map<number, number>();
  const open = new Heap();
  const h = (k: number) =>
    Math.abs((k % map.width) - (goalKey % map.width)) +
    Math.abs(Math.floor(k / map.width) - Math.floor(goalKey / map.width));
  open.push(startKey, h(startKey));
  const closed = new Set<number>();
  while (open.size > 0) {
    const cur = open.pop();
    if (cur === undefined) break;
    if (cur === goalKey) {
      const out: TilePos[] = [];
      for (let k: number | undefined = cur; k !== undefined; k = came.get(k)) {
        out.push({ tx: (k % map.width) + map.originTx, ty: Math.floor(k / map.width) + map.originTy });
      }
      return out.reverse();
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (closed.size > MAX_PATH_NODES) return null;
    const cx = (cur % map.width) + map.originTx;
    const cy = Math.floor(cur / map.width) + map.originTy;
    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ] as const) {
      if (!inGrid(nx, ny) || !walkable(ix, nx, ny, door)) continue;
      const nk = key(nx, ny);
      const ng = (g.get(cur) ?? 0) + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, cur);
        open.push(nk, ng + h(nk));
      }
    }
  }
  return null;
}
