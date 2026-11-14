import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeUlid, prng } from "../testing/prng.ts";
import { canOccupy } from "../move/collision.ts";
import { findPath } from "../move/path.ts";
import { MAX_WINGS, type RoomSize, SIZE_RANK, Tile } from "./constants.ts";
import { indexMap, tileAt, tileCenter } from "./grid.ts";
import { generateLayout, LayoutError } from "./layout.ts";
import type { CompiledMap, CompiledRoom, LayoutInput, SlotInput, TileRect, WingInput } from "./types.ts";

const open = () => true;

function overlap(a: TileRect, b: TileRect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/** Walls are shared, so interiors (never outers) must be disjoint. */
function assertInvariants(map: CompiledMap, sampleReach: CompiledRoom[]) {
  const ix = indexMap(map);
  for (let i = 0; i < map.rooms.length; i++) {
    const a = map.rooms[i]!;
    assert.equal(tileAt(map, a.door.tx, a.door.ty), Tile.Door, `door of ${a.roomId}`);
    assert.equal(tileAt(map, a.outside.tx, a.outside.ty), Tile.Floor, `outside of ${a.roomId}`);
    assert.equal(tileAt(map, a.inside.tx, a.inside.ty), Tile.Floor, `inside of ${a.roomId}`);
    for (let ty = a.interior.y0; ty <= a.interior.y1; ty++) {
      for (let tx = a.interior.x0; tx <= a.interior.x1; tx++) {
        assert.equal(tileAt(map, tx, ty), Tile.Floor, `interior of ${a.roomId} at ${tx},${ty}`);
      }
    }
    for (let j = i + 1; j < map.rooms.length; j++) {
      const b = map.rooms[j]!;
      assert.equal(overlap(a.interior, b.interior), false, `${a.roomId} overlaps ${b.roomId}`);
    }
    assert.equal(overlap(a.interior, map.lobby), false, `${a.roomId} overlaps the hall`);
    assert.equal(overlap(a.interior, map.spine), false, `${a.roomId} overlaps the spine`);
    for (const w of map.wings) {
      assert.equal(overlap(a.interior, w.corridor), false, `${a.roomId} overlaps corridor ${w.index}`);
    }
  }
  for (const s of map.spawns) {
    assert.equal(tileAt(map, s.tx, s.ty), Tile.Floor);
    assert.ok(canOccupy(ix, tileCenter(s), open), "spawn must fit the avatar");
  }
  const start = map.spawns[0];
  assert.ok(start);
  for (const r of sampleReach) {
    const path = findPath(ix, start, r.inside, open);
    assert.ok(path, `room ${r.roomId} unreachable from the hall`);
  }
}

const slot = (id: number, size: RoomSize): SlotInput => ({ roomId: fakeUlid(id), label: `Sala ${id}`, size });
const free = (size: RoomSize): SlotInput => ({ roomId: null, label: "", size });

test("empty server: hall and a stub spine, spawns walkable", () => {
  const map = generateLayout({ templateVersion: 2, wings: [] });
  assert.equal(map.rooms.length, 0);
  assert.equal(map.hall.x1 - map.hall.x0 + 1, 12);
  assert.equal(map.hall.y1 - map.hall.y0 + 1, 9);
  assertInvariants(map, []);
});

test("rooms of every size line both sides of north and south wings; the first wing touches the hall", () => {
  const input: LayoutInput = {
    templateVersion: 2,
    wings: [
      { index: 0, title: "Geral", slots: [slot(1, "S"), slot(2, "M"), slot(3, "L"), slot(4, "S")] },
      { index: 1, title: "Jogos", slots: [slot(5, "L"), free("M"), slot(6, "M"), null] },
    ],
  };
  const map = generateLayout(input);
  assert.equal(map.rooms.length, 6);
  const north = map.wings.find((w) => w.index === 0);
  const south = map.wings.find((w) => w.index === 1);
  assert.ok(north?.north && south && !south.north);
  const byId = (n: number) => map.rooms.find((r) => r.roomId === fakeUlid(n))!;
  assert.equal(byId(1).outer.x0, map.lobby.x1, "first west room shares the hall's east wall");
  assert.equal(byId(1).outer.y1, map.spine.y0 - 1, "first room shares the spine wall");
  // The first room of each street opens onto the spine; the others onto the corridor.
  assert.equal(byId(1).door.ty, map.spine.y0 - 1);
  assert.equal(byId(2).door.ty, map.spine.y0 - 1);
  assert.equal(tileAt(map, byId(1).outside.tx, byId(1).outside.ty), Tile.Floor);
  assert.ok(byId(3).door.ty < map.spine.y0 - 1, "second west room opens onto the wing corridor");
  assert.equal(byId(3).door.tx, north!.corridor.x0 - 1);
  // Every room is 7 deep; lengths follow the size.
  for (const r of map.rooms) {
    assert.equal(r.interior.x1 - r.interior.x0 + 1, 7);
    assert.equal(r.interior.y1 - r.interior.y0 + 1, { S: 5, M: 7, L: 12 }[r.size]);
  }
  // Stacked rooms share a wall.
  assert.equal(byId(6).outer.y0, byId(5).outer.y1);
  assertInvariants(map, map.rooms);
});

test("the walk from the spawn to the first room is short", () => {
  const map = generateLayout({
    templateVersion: 2,
    wings: [{ index: 0, title: "Geral", slots: [slot(1, "M")] }],
  });
  const ix = indexMap(map);
  const path = findPath(ix, map.spawns[0]!, map.rooms[0]!.inside, open);
  assert.ok(path);
  assert.ok(path.length <= 16, `path is ${path.length} tiles`);
});

test("same input gives the same map and fingerprint; wing order does not matter", () => {
  const wings: WingInput[] = [
    { index: 0, title: "A", slots: [slot(1, "M")] },
    { index: 1, title: "B", slots: [slot(2, "S")] },
  ];
  const a = generateLayout({ templateVersion: 2, wings });
  const b = generateLayout({ templateVersion: 2, wings: [...wings].reverse() });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.deepEqual(a.rooms, b.rooms);
  const renamed = generateLayout({
    templateVersion: 2,
    wings: [{ ...wings[0]!, slots: [{ ...slot(1, "M"), label: "Outra" }] }, wings[1]!],
  });
  assert.notEqual(renamed.fingerprint, a.fingerprint);
});

test("invalid inputs are refused", () => {
  assert.throws(() => generateLayout({ templateVersion: 1 as 2, wings: [] }), LayoutError);
  assert.throws(
    () =>
      generateLayout({
        templateVersion: 2,
        wings: [
          { index: 0, title: "A", slots: [] },
          { index: 0, title: "B", slots: [] },
        ],
      }),
    LayoutError,
  );
  assert.throws(
    () =>
      generateLayout({
        templateVersion: 2,
        wings: [
          { index: 0, title: "A", slots: [slot(1, "S")] },
          { index: 1, title: "B", slots: [slot(1, "S")] },
        ],
      }),
    LayoutError,
  );
  assert.throws(
    () => generateLayout({ templateVersion: 2, wings: [{ index: MAX_WINGS, title: "X", slots: [] }] }),
    LayoutError,
  );
});

test("property: appending wings and rooms (and archiving) never moves an existing room", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rnd = prng(seed);
    const wings: WingInput[] = [];
    let nextId = 1;
    let prev = generateLayout({ templateVersion: 2, wings });
    for (let step = 0; step < 40; step++) {
      const op = wings.length === 0 ? 0 : rnd.int(10);
      if (op === 0 && wings.length < 12) {
        wings.push({ index: wings.length, title: `Ala ${wings.length}`, slots: [] });
      } else if (op === 1) {
        // Archive: the slot stays with its size, so nothing after it moves.
        const w = rnd.pick(wings);
        const live = w.slots.map((s, i) => (s?.roomId ? i : -1)).filter((i) => i >= 0);
        if (live.length > 0) {
          const i = rnd.pick(live);
          w.slots[i] = free(w.slots[i]!.size);
        }
      } else {
        const w = rnd.pick(wings);
        const size = rnd.pick(["S", "M", "L"] as const);
        // Reuse only a free slot that fits (the room takes the slot's size); otherwise append.
        const fit = w.slots.findIndex((s) => s && s.roomId === null && SIZE_RANK[s.size] >= SIZE_RANK[size]);
        const s = slot(nextId++, size);
        if (fit >= 0 && rnd.int(2) === 0) w.slots[fit] = { ...s, size: w.slots[fit]!.size };
        else w.slots.push(s);
      }
      const next = generateLayout({ templateVersion: 2, wings: structuredClone(wings) });
      const before = new Map(prev.rooms.map((r) => [r.roomId, r]));
      for (const r of next.rooms) {
        const old = before.get(r.roomId);
        if (!old) continue;
        assert.deepEqual(r.outer, old.outer, `seed ${seed} step ${step}: ${r.roomId} moved`);
        assert.deepEqual(r.door, old.door);
        assert.deepEqual(r.inside, old.inside);
      }
      for (const w of next.wings) {
        const old = prev.wings.find((o) => o.index === w.index);
        if (!old) continue;
        // The corridor only grows at its far end.
        if (w.north) assert.equal(w.corridor.y1, old.corridor.y1);
        else assert.equal(w.corridor.y0, old.corridor.y0);
        assert.equal(w.corridor.x0, old.corridor.x0);
        assert.ok(w.north ? w.corridor.y0 <= old.corridor.y0 : w.corridor.y1 >= old.corridor.y1);
      }
      assert.deepEqual(next.spawns, prev.spawns);
      const newest = next.rooms.filter((r) => !before.has(r.roomId));
      const sample = [...newest, ...next.rooms.slice(0, 2)];
      assertInvariants(next, sample);
      prev = next;
    }
  }
});

test("a full wing (60 slots) still fits and connects", () => {
  const slots = Array.from({ length: 60 }, (_, i) => slot(i + 1, (["S", "M", "L"] as const)[i % 3]!));
  const map = generateLayout({ templateVersion: 2, wings: [{ index: 0, title: "Grande", slots }] });
  assert.equal(map.rooms.length, 60);
  assertInvariants(map, [map.rooms[0]!, map.rooms[59]!]);
});
