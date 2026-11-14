import assert from "node:assert/strict";
import { test } from "node:test";

import { Tile } from "../map/constants.ts";
import { indexMap, tileAt } from "../map/grid.ts";
import { generateLayout } from "../map/layout.ts";
import type { TilePos } from "../map/types.ts";
import { fakeUlid } from "../testing/prng.ts";
import { findPath } from "./path.ts";

const ROOM = fakeUlid(7);
const map = generateLayout({
  templateVersion: 2,
  wings: [
    { index: 0, title: "N", slots: [null, { roomId: ROOM, label: "Sala", size: "L" }] },
    { index: 1, title: "S", slots: [] },
  ],
});
const ix = indexMap(map);
const room = ix.roomsById.get(ROOM)!;

test("path from the lobby into a room is contiguous and walkable", () => {
  const path = findPath(ix, map.spawns[0]!, room.inside, () => true);
  assert.ok(path);
  for (let i = 1; i < path.length; i++) {
    const a: TilePos = path[i - 1]!;
    const b: TilePos = path[i]!;
    assert.equal(Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty), 1, "4-neighbour steps");
    assert.notEqual(tileAt(map, b.tx, b.ty), Tile.Wall);
    assert.notEqual(tileAt(map, b.tx, b.ty), Tile.Void);
  }
  assert.deepEqual(path.at(-1), room.inside);
});

test("a locked door makes the room unreachable, its outside still reachable", () => {
  const locked = (id: string) => id !== ROOM;
  assert.equal(findPath(ix, map.spawns[0]!, room.inside, locked), null);
  assert.ok(findPath(ix, map.spawns[0]!, room.outside, locked));
});

test("goals in walls or outside the grid are refused", () => {
  assert.equal(findPath(ix, map.spawns[0]!, { tx: 0, ty: 0 }, () => true), null);
  assert.equal(findPath(ix, map.spawns[0]!, { tx: -9999, ty: 0 }, () => true), null);
});
