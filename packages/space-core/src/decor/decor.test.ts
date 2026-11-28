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
import { arsenalMark, chestMark, defaultDecor, furnish, NOTICE_BOARD_MARK } from "./theme.ts";
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

test("sala do jogo (24/11/2026): \"Idle Hunt\" se mobilia com a TV, os 3 bonecos e os 4 NPCs; as outras não", async () => {
  const { isGameRoom } = await import("./theme.ts");
  assert.equal(isGameRoom("Idle Hunt"), true);
  assert.equal(isGameRoom("  iddle   HUNT "), true);
  assert.equal(isGameRoom("Idle"), false);
  const map = generateLayout({
    templateVersion: 2,
    wings: [
      {
        index: 0,
        title: "Geral",
        slots: [
          { roomId: fakeUlid(11), label: "Idle Hunt", size: "M" },
          { roomId: fakeUlid(12), label: "Lounge", size: "M" },
        ],
      },
      {
        index: 1,
        title: "Outra",
        slots: [
          { roomId: fakeUlid(13), label: "Iddle hunt", size: "M" },
          { roomId: fakeUlid(14), label: "Idle Hunt", size: "L" },
        ],
      },
    ],
  });
  const ix = indexMap(map);
  const zones = zonesOf(map);
  const d = defaultDecor(ix, { serverName: "Teste" });
  const GAME = [
    "dummy-wood",
    "dummy-target",
    "npc-mercador",
    "npc-banqueiro",
    "npc-mestre",
    "npc-ferreiro",
  ];
  for (const id of [fakeUlid(11), fakeUlid(13), fakeUlid(14)]) {
    const inRoom = d.items.filter((i) => i.zone === roomZoneKey(id)).map((i) => i.item);
    for (const item of GAME) assert.ok(inRoom.includes(item), `${id}: falta ${item} (${inRoom.join(",")})`);
    assert.ok(
      d.items.some((i) => i.zone === roomZoneKey(id) && itemOf(CATALOG, i.item)?.smartTv),
      `${id}: sem TV`,
    );
  }
  // A sala comum segue o tema de sempre, sem os objetos do jogo.
  const lounge = d.items.filter((i) => i.zone === roomZoneKey(fakeUlid(12))).map((i) => i.item);
  assert.ok(lounge.length > 0 && !lounge.some((i) => GAME.includes(i)));
  // Tudo válido e todas as portas alcançáveis.
  for (const item of d.items) {
    const others = { ...d, items: d.items.filter((i) => i.id !== item.id) };
    assert.equal(validatePlacement({ ix, zones, catalog: CATALOG, state: others }, item), null, `${item.item} em ${item.zone}`);
  }
  assert.equal(allReachable(map, solidMask(map, zones, CATALOG, d.items)), true);
});

test("quadro de avisos: item de parede 2×1, só aceita título e entra no hall do tema padrão", () => {
  const { ix, ctx } = fixture();
  const board = itemOf(CATALOG, "notice-board");
  assert.ok(board);
  assert.equal(board.layer, "wall");
  assert.equal(board.interaction, "news");
  assert.equal(board.solid, false);
  assert.deepEqual([board.w, board.h], [2, 1]);
  // Na parede, com título: ok. Endereço ou texto não são do quadro (as notas vêm do servidor).
  assert.equal(validatePlacement(ctx(), inst({ item: "notice-board", zone: "hall", x: 0, y: -1, config: { title: "Avisos" } })), null);
  assert.equal(
    validatePlacement(ctx(), inst({ item: "notice-board", zone: "hall", x: 0, y: -1, config: { url: "https://x.test" } })),
    "bad_config",
  );
  assert.equal(validatePlacement(ctx(), inst({ item: "notice-board", zone: "hall", x: 0, y: -1, config: { text: "oi" } })), "bad_config");
  // O tema padrão põe um na parede norte do hall (servidor novo).
  const decor = defaultDecor(ix, { serverName: "Teste" });
  const placed = decor.items.filter((i) => i.item === "notice-board");
  assert.equal(placed.length, 1);
  assert.equal(placed[0]!.zone, "hall");
  assert.equal(placed[0]!.y, -1);
});

test("quadro de avisos nos servidores que já existiam: entra uma vez no hall e não volta se tirarem", () => {
  const { ix, ctx } = fixture();
  // Um servidor de antes do quadro: hall mobiliado, sem quadro e sem a marca.
  const fresh = defaultDecor(ix, { serverName: "Antigo" });
  assert.ok(fresh.furnished.includes(NOTICE_BOARD_MARK), "servidor novo já sai marcado");
  const old = {
    ...fresh,
    items: fresh.items.filter((i) => i.item !== "notice-board"),
    furnished: fresh.furnished.filter((k) => k !== NOTICE_BOARD_MARK),
  };
  const migrated = furnish(ix, old);
  const boards = migrated.items.filter((i) => i.item === "notice-board");
  assert.equal(boards.length, 1);
  assert.equal(boards[0]!.zone, "hall");
  assert.equal(boards[0]!.y, -1);
  assert.equal(migrated.items.length, old.items.length + 1);
  assert.ok(migrated.furnished.includes(NOTICE_BOARD_MARK));
  // Vale contra o resto do hall.
  const others = { ...migrated, items: migrated.items.filter((i) => i.id !== boards[0]!.id) };
  assert.equal(validatePlacement(ctx(others), boards[0]!), null);
  // De novo não põe outro; tirado depois da marca, não volta.
  assert.equal(furnish(ix, migrated).items.length, migrated.items.length);
  const removed = { ...migrated, items: migrated.items.filter((i) => i.item !== "notice-board") };
  assert.equal(furnish(ix, removed).items.filter((i) => i.item === "notice-board").length, 0);
  // O lugar do tema ocupado: vai para o primeiro trecho livre da parede de cima.
  const blocked = { ...old, items: [...old.items, inst({ id: "x-1", item: "poster", zone: "hall", x: 9, y: -1 })] };
  if (validatePlacement(ctx(old), blocked.items.at(-1)!) === null) {
    const moved = furnish(ix, blocked).items.filter((i) => i.item === "notice-board");
    assert.equal(moved.length, 1);
    assert.notEqual(moved[0]!.x, 9);
  }
  // Quem já tinha posto um quadro em outro lugar não ganha outro.
  const own = { ...old, items: [...old.items, inst({ id: "x-2", item: "notice-board", zone: "spine", x: 0, y: -1 })] };
  assert.equal(furnish(ix, own).items.filter((i) => i.item === "notice-board").length, 1);
});

test("Arsenal (27/11/2026): uma estante no hall e em cada sala do jogo, uma vez; não volta se tirarem", () => {
  const map = generateLayout({
    templateVersion: 2,
    wings: [
      {
        index: 0,
        title: "Geral",
        slots: [
          { roomId: fakeUlid(1), label: "Café", size: "S" },
          { roomId: fakeUlid(2), label: "Idle Hunt", size: "M" },
          { roomId: fakeUlid(3), label: "Arena", size: "L" },
        ],
      },
    ],
  });
  const ix = indexMap(map);
  const zones = zonesOf(map);
  const ctx = (state = emptyDecor()): PlacementContext => ({ ix, zones, catalog: CATALOG, state });
  const game = roomZoneKey(fakeUlid(2));
  const fresh = defaultDecor(ix, { serverName: "Novo" });
  const racks = fresh.items.filter((i) => i.item === "arsenal");
  assert.deepEqual(racks.map((i) => i.zone).sort(), ["hall", game].sort());
  assert.ok(fresh.furnished.includes(arsenalMark("hall")) && fresh.furnished.includes(arsenalMark(game)));
  // No hall, embaixo do quadro de avisos e ao lado do Mercador.
  const hall = racks.find((i) => i.zone === "hall")!;
  assert.deepEqual([hall.x, hall.y], [9, 1]);
  for (const r of racks) {
    const others = { ...fresh, items: fresh.items.filter((i) => i.id !== r.id) };
    assert.equal(validatePlacement(ctx(others), r), null, r.zone);
  }
  // Um servidor de antes do Arsenal ganha as estantes uma vez; tiradas depois da marca, não voltam.
  const old = {
    ...fresh,
    items: fresh.items.filter((i) => i.item !== "arsenal"),
    furnished: fresh.furnished.filter((k) => !k.endsWith(":arsenal")),
  };
  const migrated = furnish(ix, old);
  assert.equal(migrated.items.filter((i) => i.item === "arsenal").length, 2);
  assert.equal(furnish(ix, migrated).items.length, migrated.items.length);
  const removed = { ...migrated, items: migrated.items.filter((i) => i.item !== "arsenal") };
  assert.equal(furnish(ix, removed).items.filter((i) => i.item === "arsenal").length, 0);
  // A estante só aceita título.
  assert.equal(itemOf(CATALOG, "arsenal")?.interaction, "arsenal");
});

test("baú compartilhado (28/11/2026): vai uma vez para o lado da Mula da sala do jogo; não volta se tirarem", () => {
  const map = generateLayout({
    templateVersion: 2,
    wings: [
      {
        index: 0,
        title: "Geral",
        slots: [
          { roomId: fakeUlid(1), label: "Café", size: "S" },
          { roomId: fakeUlid(2), label: "Idle Hunt", size: "M" },
        ],
      },
    ],
  });
  const ix = indexMap(map);
  const zones = zonesOf(map);
  const game = roomZoneKey(fakeUlid(2));
  const fresh = defaultDecor(ix, { serverName: "Novo" });
  const mule = fresh.items.find((i) => i.item === "npc-banqueiro")!;
  assert.equal(mule.zone, game);
  const chests = fresh.items.filter((i) => i.item === "chest-shared");
  assert.equal(chests.length, 1);
  const chest = chests[0]!;
  assert.equal(chest.zone, game);
  assert.ok(Math.abs(chest.x - mule.x) <= 2 && Math.abs(chest.y - mule.y) <= 2, "ao lado da Mula");
  assert.ok(fresh.furnished.includes(chestMark(game)));
  const others = { ...fresh, items: fresh.items.filter((i) => i.id !== chest.id) };
  assert.equal(validatePlacement({ ix, zones, catalog: CATALOG, state: others }, chest), null);
  // O servidor de antes (como o Alopa): a Mula já estava lá; o baú entra uma vez, e tirado não volta.
  const old = {
    ...fresh,
    items: fresh.items.filter((i) => i.item !== "chest-shared"),
    furnished: fresh.furnished.filter((k) => !k.endsWith(":chest")),
  };
  const migrated = furnish(ix, old);
  assert.deepEqual(
    migrated.items.filter((i) => i.item === "chest-shared").map((i) => [i.zone, i.x, i.y]),
    [[chest.zone, chest.x, chest.y]],
  );
  assert.equal(furnish(ix, migrated).items.length, migrated.items.length);
  const removed = { ...migrated, items: migrated.items.filter((i) => i.item !== "chest-shared") };
  assert.equal(furnish(ix, removed).items.filter((i) => i.item === "chest-shared").length, 0);
  // Quem já tinha posto um baú na sala não ganha outro.
  const own = { ...old, items: [...old.items, { ...chest, id: "meu-bau", x: 0, y: 0 }] };
  const kept = furnish(ix, own);
  assert.deepEqual(
    kept.items.filter((i) => i.item === "chest-shared").map((i) => i.id),
    ["meu-bau"],
  );
});
