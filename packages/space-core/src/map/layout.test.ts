import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeUlid, prng } from "../testing/prng.ts";
import { canOccupy } from "../move/collision.ts";
import { findPath } from "../move/path.ts";
import { MAX_WINGS, type RoomSize, Tile } from "./constants.ts";
import { indexMap, tileAt, tileCenter } from "./grid.ts";
import { generateLayout, LayoutError } from "./layout.ts";
import type { CompiledMap, CompiledRoom, LayoutInput, TileRect, WingInput } from "./types.ts";

const open = () => true;

function overlap(a: TileRect, b: TileRect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

function assertInvariants(map: CompiledMap, sampleReach: CompiledRoom[]) {
  const ix = indexMap(map);
  for (let i = 0; i < map.rooms.length; i++) {
    const a = map.rooms[i];
    assert.ok(a);
    assert.equal(tileAt(map, a.door.tx, a.door.ty), Tile.Door, `door of ${a.roomId}`);
    assert.equal(tileAt(map, a.outside.tx, a.outside.ty), Tile.Floor, `outside of ${a.roomId}`);
    assert.equal(tileAt(map, a.inside.tx, a.inside.ty), Tile.Floor, `inside of ${a.roomId}`);
    for (let j = i + 1; j < map.rooms.length; j++) {
      const b = map.rooms[j];
      assert.ok(b);
      assert.equal(overlap(a.outer, b.outer), false, `${a.roomId} overlaps ${b.roomId}`);
    }
    assert.equal(overlap(a.outer, map.lobby), false, `${a.roomId} overlaps the lobby`);
  }
  for (const s of map.spawns) {
    assert.equal(tileAt(map, s.tx, s.ty), Tile.Floor);
    assert.ok(canOccupy(ix, tileCenter(s), open), "spawn must fit the avatar");
  }
  const start = map.spawns[0];
  assert.ok(start);
  for (const r of sampleReach) {
    const path = findPath(ix, start, r.inside, open);
    assert.ok(path, `room ${r.roomId} unreachable from the lobby`);
  }
}

const slot = (id: number, size: RoomSize) => ({ roomId: fakeUlid(id), label: `Sala ${id}`, size });

test("empty server: lobby and a stub spine, spawns walkable", () => {
  const map = generateLayout({ templateVersion: 1, wings: [] });
  assert.equal(map.rooms.length, 0);
  assertInvariants(map, []);
});

test("rooms of every size sit on both sides of north and south wings", () => {
  const input: LayoutInput = {
    templateVersion: 1,
    wings: [
      { index: 0, title: "Geral", slots: [slot(1, "S"), slot(2, "M"), slot(3, "L"), slot(4, "S")] },
      { index: 1, title: "Jogos", slots: [slot(5, "L"), null, slot(6, "M")] },
    ],
  };
  const map = generateLayout(input);
  assert.equal(map.rooms.length, 6);
  const north = map.wings.find((w) => w.index === 0);
  const south = map.wings.find((w) => w.index === 1);
  assert.ok(north?.north && south && !south.north);
  for (const r of map.rooms) {
    const inLobbyRows = r.outer.y0 >= map.lobby.y0 && r.outer.y1 <= map.lobby.y1;
    assert.equal(inLobbyRows && r.outer.x0 <= map.lobby.x1, false);
  }
  assertInvariants(map, map.rooms);
});

test("same input gives the same map and fingerprint; wing order does not matter", () => {
  const wings: WingInput[] = [
    { index: 0, title: "A", slots: [slot(1, "M")] },
    { index: 1, title: "B", slots: [slot(2, "S")] },
  ];
  const a = generateLayout({ templateVersion: 1, wings });
  const b = generateLayout({ templateVersion: 1, wings: [...wings].reverse() });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.deepEqual(a.rooms, b.rooms);
  const renamed = generateLayout({
    templateVersion: 1,
    wings: [{ ...wings[0]!, slots: [{ ...slot(1, "M"), label: "Outra" }] }, wings[1]!],
  });
  assert.notEqual(renamed.fingerprint, a.fingerprint);
});

test("invalid inputs are refused", () => {
  assert.throws(() => generateLayout({ templateVersion: 2 as 1, wings: [] }), LayoutError);
  assert.throws(
    () =>
      generateLayout({
        templateVersion: 1,
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
        templateVersion: 1,
        wings: [
          { index: 0, title: "A", slots: [slot(1, "S")] },
          { index: 1, title: "B", slots: [slot(1, "S")] },
        ],
      }),
    LayoutError,
  );
  assert.throws(
    () => generateLayout({ templateVersion: 1, wings: [{ index: MAX_WINGS, title: "X", slots: [] }] }),
    LayoutError,
  );
});

test("property: appending wings and rooms (and archiving) never moves an existing room", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rnd = prng(seed);
    const wings: WingInput[] = [];
    let nextId = 1;
    let prev = generateLayout({ templateVersion: 1, wings });
    for (let step = 0; step < 40; step++) {
      const op = wings.length === 0 ? 0 : rnd.int(10);
      if (op === 0 && wings.length < 12) {
        wings.push({ index: wings.length, title: `Ala ${wings.length}`, slots: [] });
      } else if (op === 1) {
        // Archive: the slot stays (null), so the corridor never shrinks.
        const w = rnd.pick(wings);
        const live = w.slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
        if (live.length > 0) w.slots[rnd.pick(live)] = null;
      } else {
        const w = rnd.pick(wings);
        const free = w.slots.findIndex((s) => !s);
        const s = slot(nextId++, rnd.pick(["S", "M", "L"] as const));
        // Reuse only a free slot of the same wing; otherwise append.
        if (free >= 0 && rnd.int(2) === 0) w.slots[free] = s;
        else w.slots.push(s);
      }
      const next = generateLayout({ templateVersion: 1, wings: structuredClone(wings) });
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
      }
      const newest = next.rooms.filter((r) => !before.has(r.roomId));
      const sample = [...newest, ...next.rooms.slice(0, 2)];
      assertInvariants(next, sample);
      prev = next;
    }
  }
});

test("a full wing (60 slots) still fits and connects", () => {
  const slots = Array.from({ length: 60 }, (_, i) => slot(i + 1, (["S", "M", "L"] as const)[i % 3]!));
  const map = generateLayout({ templateVersion: 1, wings: [{ index: 0, title: "Grande", slots }] });
  assert.equal(map.rooms.length, 60);
  assertInvariants(map, [map.rooms[0]!, map.rooms[59]!]);
});
