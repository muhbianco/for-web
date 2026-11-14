import assert from "node:assert/strict";
import { test } from "node:test";

import { generateLayout } from "../map/layout.ts";
import { indexMap, setSolid, tileCenter } from "../map/grid.ts";
import { canOccupy } from "../move/collision.ts";
import { findPath } from "../move/path.ts";
import { fakeUlid } from "../testing/prng.ts";
import { CATALOG, itemOf, searchCatalog } from "./catalog.ts";
import {
  allReachable,
  applyDecorOp,
  footprint,
  type PlacementContext,
  solidMask,
  validateConfig,
  validatePlacement,
} from "./placement.ts";
import { defaultDecor, furnish } from "./theme.ts";
import { type DecorInstance, emptyDecor } from "./types.ts";
import { roomZoneKey, wingZoneKey, zonesOf } from "./zones.ts";

const open = () => true;

function fixture() {
  const map = generateLayout({
    templateVersion: 2,
    wings: [
      {
        index: 0,
        title: "Geral",
        slots: [
          { roomId: fakeUlid(1), label: "Café", size: "S" },
          { roomId: fakeUlid(2), label: "Lounge", size: "M" },
          { roomId: fakeUlid(3), label: "Arena", size: "L" },
          { roomId: fakeUlid(4), label: "Duo", size: "S" },
        ],
      },
      {
        index: 1,
        title: "Trabalho",
        slots: [
          { roomId: fakeUlid(5), label: "Reunião", size: "M" },
          { roomId: fakeUlid(6), label: "Foco", size: "S" },
          { roomId: fakeUlid(7), label: "Palco", size: "L" },
        ],
      },
    ],
  });
  const ix = indexMap(map);
  const zones = zonesOf(map);
  const ctx = (state = emptyDecor()): PlacementContext => ({ ix, zones, catalog: CATALOG, state });
  return { map, ix, zones, ctx };
}

const inst = (over: Partial<DecorInstance> & Pick<DecorInstance, "item" | "zone">): DecorInstance => ({
  id: over.id ?? `i-${over.item}-${over.x ?? 0}-${over.y ?? 0}`,
  item: over.item,
  zone: over.zone,
  x: over.x ?? 0,
  y: over.y ?? 0,
  rot: over.rot ?? 0,
  ...(over.variant ? { variant: over.variant } : {}),
  ...(over.config ? { config: over.config } : {}),
});

test("footprint transposes on odd quarter turns for rotatable items only", () => {
  const sofa = itemOf(CATALOG, "sofa-3")!;
  assert.deepEqual(footprint(sofa, 0), { w: 3, h: 1 });
  assert.deepEqual(footprint(sofa, 1), { w: 1, h: 3 });
  assert.deepEqual(footprint(sofa, 2), { w: 3, h: 1 });
  const round = itemOf(CATALOG, "table-round")!;
  assert.deepEqual(footprint(round, 1), { w: 2, h: 2 });
});

test("catalog: every item has a unique id, a sane footprint and a known layer", () => {
  const ids = new Set<string>();
  for (const i of CATALOG.items) {
    assert.ok(!ids.has(i.id), `duplicate ${i.id}`);
    ids.add(i.id);
    assert.ok(i.w >= 1 && i.h >= 1 && i.w <= 4 && i.h <= 4, i.id);
    if (i.layer === "rug" || i.layer === "wall" || i.layer === "ceiling") assert.equal(i.solid, false, i.id);
    if (i.layer === "floor") assert.equal(i.category, "floor", i.id);
  }
  assert.ok(CATALOG.items.length >= 70);
  assert.ok(searchCatalog(CATALOG, "poltrona").some((i) => i.id === "armchair"));
  assert.ok(searchCatalog(CATALOG, "FLIPERAMA", "gamer").some((i) => i.id === "arcade"));
  assert.ok(searchCatalog(CATALOG, "", "interactive").every((i) => i.interaction));
  assert.equal(searchCatalog(CATALOG, "televisao").some((i) => i.id === "tv-stand"), true, "accent-insensitive");
});

test("placement: zone bounds, floor vs wall, overlap by layer", () => {
  const { ctx } = fixture();
  const hall = "hall";
  assert.equal(validatePlacement(ctx(), inst({ item: "nope", zone: hall })), "unknown_item");
  assert.equal(validatePlacement(ctx(), inst({ item: "floor-wood", zone: hall })), "not_placeable");
  assert.equal(validatePlacement(ctx(), inst({ item: "sofa-3", zone: "room:missing" })), "unknown_zone");
  assert.equal(validatePlacement(ctx(), inst({ item: "sofa-3", zone: hall, x: 10, y: 0 })), "out_of_zone");
  assert.equal(validatePlacement(ctx(), inst({ item: "sofa-3", zone: hall, x: 0, y: 0 })), null);
  assert.equal(validatePlacement(ctx(), inst({ item: "table-round", zone: hall, rot: 1 })), "bad_rotation");
  assert.equal(validatePlacement(ctx(), inst({ item: "coffee-table", zone: hall, rot: 2 })), "bad_rotation");
  assert.equal(validatePlacement(ctx(), inst({ item: "sofa-3", zone: hall, variant: "xadrez" })), "bad_config");
  // Wall items hang on the row above the zone, and only on wall tiles.
  assert.equal(validatePlacement(ctx(), inst({ item: "poster", zone: hall, x: 0, y: 0 })), "not_wall");
  assert.equal(validatePlacement(ctx(), inst({ item: "poster", zone: hall, x: 0, y: -1 })), null);
  assert.equal(validatePlacement(ctx(), inst({ item: "poster", zone: hall, x: 11, y: -1 })), null);
  assert.equal(validatePlacement(ctx(), inst({ item: "painting-wide", zone: hall, x: 11, y: -1 })), "out_of_zone");
  // A floor item cannot sit on the wall row.
  assert.equal(validatePlacement(ctx(), inst({ item: "plant-small", zone: hall, x: 0, y: -1 })), "out_of_zone");

  const withSofa = applyDecorOp(emptyDecor(), { kind: "place", item: inst({ id: "sofa0", item: "sofa-3", zone: hall, x: 0, y: 0 }) }, 1);
  assert.equal(validatePlacement(ctx(withSofa), inst({ item: "armchair", zone: hall, x: 1, y: 0 })), "overlap");
  assert.equal(validatePlacement(ctx(withSofa), inst({ item: "rug-living", zone: hall, x: 0, y: 0 })), null, "a rug under a sofa is fine");
  assert.equal(validatePlacement(ctx(withSofa), inst({ item: "ceiling-lamp", zone: hall, x: 1, y: 0 })), null);
  assert.equal(validatePlacement(ctx(withSofa), inst({ id: "sofa0", item: "armchair", zone: hall, x: 5, y: 5 })), "bad_id", "ids are unique");
  assert.equal(validatePlacement(ctx(withSofa), inst({ id: "ab", item: "armchair", zone: hall, x: 5, y: 5 })), "bad_id", "ids have at least 4 chars");
  // Moving the sofa itself: ignore its own footprint.
  assert.equal(validatePlacement(ctx(withSofa), inst({ id: "sofa0", item: "sofa-3", zone: hall, x: 1, y: 0 }), "sofa0"), null);
});

test("placement: doorways, spawns and paths stay free", () => {
  const { map, ctx } = fixture();
  const room = map.rooms[0]!;
  const zone = roomZoneKey(room.roomId);
  const rel = (tx: number, ty: number) => ({ x: tx - room.interior.x0, y: ty - room.interior.y0 });
  assert.equal(validatePlacement(ctx(), inst({ item: "plant-small", zone, ...rel(room.inside.tx, room.inside.ty) })), "blocks_door");
  assert.equal(validatePlacement(ctx(), inst({ item: "rug-doormat", zone, ...rel(room.inside.tx, room.inside.ty) })), null, "rugs may lie in the doorway");
  const spawn = map.spawns[0]!;
  assert.equal(validatePlacement(ctx(), inst({ item: "plant-small", zone: "hall", x: spawn.tx - map.hall.x0, y: spawn.ty - map.hall.y0 })), "blocks_door");

  // Wall off a wing corridor with three lockers: the rooms behind become unreachable.
  const wing = map.wings[0]!;
  const key = wingZoneKey(wing.index);
  const row = wing.north ? wing.corridor.y1 - 1 : wing.corridor.y0 + 1;
  let state = emptyDecor();
  const y = row - wing.corridor.y0;
  assert.equal(validatePlacement(ctx(state), inst({ id: "lock0", item: "locker", zone: key, x: 0, y })), null);
  state = applyDecorOp(state, { kind: "place", item: inst({ id: "lock0", item: "locker", zone: key, x: 0, y }) }, 1);
  assert.equal(validatePlacement(ctx(state), inst({ id: "lock1", item: "locker", zone: key, x: 1, y })), null);
  state = applyDecorOp(state, { kind: "place", item: inst({ id: "lock1", item: "locker", zone: key, x: 1, y }) }, 2);
  assert.equal(validatePlacement(ctx(state), inst({ id: "lock2", item: "locker", zone: key, x: 2, y })), "blocks_path");
  assert.equal(validatePlacement(ctx(state), inst({ id: "rug02", item: "rug-doormat", zone: key, x: 2, y })), null, "a rug never blocks");
});

test("solid mask: collision and pathfinding treat furniture as walls", () => {
  const { map, ix, zones } = fixture();
  const hallTile = { tx: map.hall.x0 + 2, ty: map.hall.y0 + 2 };
  const table = inst({ id: "tab0", item: "table-square", zone: "hall", x: 2, y: 2 });
  const mask = solidMask(map, zones, CATALOG, [table]);
  assert.equal(allReachable(map, mask), true);
  assert.ok(canOccupy(ix, tileCenter(hallTile), open), "free before");
  setSolid(ix, mask);
  assert.equal(canOccupy(ix, tileCenter(hallTile), open), false, "blocked after");
  const path = findPath(ix, { tx: map.hall.x0, ty: map.hall.y0 + 2 }, { tx: map.hall.x0 + 5, ty: map.hall.y0 + 2 }, open);
  assert.ok(path);
  assert.ok(!path.some((p) => p.tx === hallTile.tx && p.ty === hallTile.ty), "path goes around the table");
});

test("theme: the default decoration is deterministic, valid and keeps every door reachable", () => {
  const { map, ix, zones, ctx } = fixture();
  const a = defaultDecor(ix, { serverName: "Alopa" });
  const b = defaultDecor(ix, { serverName: "Alopa" });
  assert.deepEqual(a, b);
  assert.ok(a.items.length >= 60, `only ${a.items.length} items`);
  assert.equal(a.rev, 0);
  // Every zone was furnished, and every room got something.
  for (const z of zones.list) assert.ok(a.furnished.includes(z.key), `zone ${z.key} not furnished`);
  for (const r of map.rooms) assert.ok(a.items.some((i) => i.zone === roomZoneKey(r.roomId)), `room ${r.label} is empty`);
  // Re-validating each item against the others finds nothing wrong.
  for (const item of a.items) {
    const others = { ...a, items: a.items.filter((i) => i.id !== item.id) };
    assert.equal(validatePlacement(ctx(others), item), null, `${item.item} in ${item.zone}`);
  }
  assert.equal(allReachable(map, solidMask(map, zones, CATALOG, a.items)), true);
  // Furnishing again adds nothing; a new room gets furnished on its own.
  assert.equal(furnish(ix, a).items.length, a.items.length);
  const partial = { ...a, items: a.items.filter((i) => i.zone !== roomZoneKey(map.rooms[2]!.roomId)), furnished: a.furnished.filter((k) => k !== roomZoneKey(map.rooms[2]!.roomId)) };
  const refurnished = furnish(ix, partial, { onlyZones: new Set([roomZoneKey(map.rooms[2]!.roomId)]) });
  assert.equal(refurnished.items.length, a.items.length);
});

test("interaction configuration is checked per kind", () => {
  const { zones } = fixture();
  const arcade = itemOf(CATALOG, "arcade")!;
  const sofa = itemOf(CATALOG, "sofa-2")!;
  const portal = itemOf(CATALOG, "portal-pad")!;
  const board = itemOf(CATALOG, "whiteboard")!;
  assert.equal(validateConfig(arcade, { url: "https://example.com/jogo" }, zones), true);
  assert.equal(validateConfig(arcade, { url: "javascript:alert(1)" }, zones), false);
  assert.equal(validateConfig(arcade, { url: "ftp://x" }, zones), false);
  assert.equal(validateConfig(arcade, { text: "oi" }, zones), false, "a frame has no text");
  assert.equal(validateConfig(sofa, { url: "https://example.com" }, zones), false, "not interactive");
  assert.equal(validateConfig(sofa, undefined, zones), true);
  assert.equal(validateConfig(portal, { target: "hall" }, zones), true);
  assert.equal(validateConfig(portal, { target: "room:nope" }, zones), false);
  assert.equal(validateConfig(board, { title: "Pauta", text: "x".repeat(500) }, zones), true);
  assert.equal(validateConfig(board, { text: "x".repeat(501) }, zones), false);
  assert.equal(validateConfig(board, { text: "ok", extra: 1 } as never, zones), false);
});

test("applyDecorOp mirrors every op and never mutates the input", () => {
  const s0 = emptyDecor();
  const a = inst({ id: "ch-a", item: "chair", zone: "hall", x: 1, y: 1 });
  const s1 = applyDecorOp(s0, { kind: "place", item: a }, 1);
  assert.equal(s0.items.length, 0);
  assert.equal(s1.rev, 1);
  const s2 = applyDecorOp(s1, { kind: "update", item: { ...a, rot: 2 } }, 2);
  assert.equal(s2.items[0]!.rot, 2);
  const s3 = applyDecorOp(s2, { kind: "floor", zone: "hall", floor: "floor-wood:escuro" }, 3);
  assert.equal(s3.floors.hall, "floor-wood:escuro");
  const s4 = applyDecorOp(s3, { kind: "floor", zone: "hall", floor: null }, 4);
  assert.equal(s4.floors.hall, undefined);
  const s5 = applyDecorOp(s4, { kind: "settings", settings: { editors: "roles", roles: ["MOD"] } }, 5);
  assert.deepEqual(s5.settings, { editors: "roles", roles: ["MOD"] });
  const s6 = applyDecorOp(s5, { kind: "remove", id: "ch-a" }, 6);
  assert.equal(s6.items.length, 0);
  assert.equal(s6.rev, 6);
});
