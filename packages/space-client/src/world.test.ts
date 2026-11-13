import assert from "node:assert/strict";
import { test } from "node:test";

import { generateLayout, MAX_SPEED, MOVE_SEND_HZ, applyMove, initialMoveState, indexMap, tileCenter, type CompiledMapWire } from "@muchat/space-core";

import { announceRoomChange, buildList, locationText, wingHeading } from "./list.ts";
import { type MoveCommand, Mover } from "./mover.ts";
import { decodeMap, INTERP_DELAY_MS, World } from "./world.ts";

const ROOM_A = "01JR00000000000000000000AA";
const ROOM_P = "01JR00000000000000000000PP";
const map = generateLayout({
  templateVersion: 1,
  wings: [
    { index: 0, title: "", slots: [{ roomId: ROOM_A, label: "", size: "M" }] },
    { index: 1, title: "", slots: [{ roomId: ROOM_P, label: "", size: "S" }] },
  ],
});
const ix = indexMap(map);

function world() {
  const w = new World();
  const wire: CompiledMapWire = { ...map, tiles: Buffer.from(map.tiles).toString("base64") };
  w.setMap(decodeMap(wire));
  const spawn = tileCenter(map.spawns[0]!);
  w.applySnapshot(
    {
      layout: { fingerprint: map.fingerprint },
      you: { user_id: "ME", name: "Eu", look: { palette: 2 }, x: spawn.x, y: spawn.y, room: null, seq: 0 },
      rooms: [
        { room_id: ROOM_A, label: "Sala Aberta", private: false, can_enter: true, occupants: [], capacity: null },
        { room_id: ROOM_P, label: null, private: true, can_enter: false, occupants: null, capacity: null },
      ],
      wings: [
        { index: 0, title: "Geral" },
        { index: 1, title: null },
      ],
      avatars: [],
    },
    0,
  );
  return w;
}

test("the wire map decodes to the same tiles", () => {
  const w = world();
  assert.deepEqual(w.map!.tiles, map.tiles);
});

test("remote avatars are interpolated 100 ms in the past, never extrapolated", () => {
  const w = world();
  const b = (x: number) => ({ user_id: "B", name: "b", look: { palette: 1 }, x, y: 0, dir: "down" as const, moving: true, room: null, state: "online" as const });
  w.applyPositions({ avatars: [b(0)], gone: [] }, 1000);
  w.applyPositions({ avatars: [b(100)], gone: [] }, 1100);
  const rb = w.others.get("B")!;
  assert.equal(rb.palette, 1);
  assert.deepEqual(w.positionOf(rb, 1000 + INTERP_DELAY_MS), { x: 0, y: 0 });
  assert.deepEqual(w.positionOf(rb, 1150), { x: 50, y: 0 });
  assert.deepEqual(w.positionOf(rb, 5000), { x: 100, y: 0 }, "holds the last sample");
  w.applyPositions({ avatars: [], gone: ["B"] }, 1200);
  assert.equal(w.others.has("B"), false);
});

test("mover: keyboard walk sends at most 15 Hz, a stop immediately, and the server accepts every move", () => {
  const w = world();
  const sent: MoveCommand[] = [];
  const mover = new Mover(w, (c) => sent.push(c));
  mover.setKey("right", true);
  let now = 0;
  for (let f = 0; f < 120; f++) {
    now += 1000 / 60;
    mover.step(1000 / 60, now);
  }
  mover.setKey("right", false);
  now += 1000 / 60;
  mover.step(1000 / 60, now);
  const last = sent.at(-1)!;
  assert.equal(last.d.moving, false, "stop sent");
  assert.ok(sent.length <= 2 * MOVE_SEND_HZ + 2, `rate ${sent.length} in 2 s`);
  // Replay against the authoritative validator with the same timing.
  const spawn = tileCenter(map.spawns[0]!);
  let s = initialMoveState(spawn, null, 0);
  let t = 0;
  for (const c of sent) {
    t += 1000 / MOVE_SEND_HZ;
    const out = applyMove(ix, s, { ...c.d, seq: c.seq }, t, () => true);
    assert.equal(out.kind, "accepted", `seq ${c.seq}`);
    if (out.kind === "accepted") s = out.state;
  }
  assert.ok(MAX_SPEED > 0);
});

test("mover: click-to-walk into an open room changes our room; a door we cannot open is refused", () => {
  const w = world();
  const events: string[] = [];
  w.on((e) => {
    if (e.kind === "room_changed") events.push(announceRoomChange(w, e.from, e.to));
  });
  const mover = new Mover(w, () => {});
  const a = ix.roomsById.get(ROOM_A)!;
  assert.equal(mover.walkTo(tileCenter(a.inside).x, tileCenter(a.inside).y), true);
  let now = 0;
  for (let f = 0; f < 60 * 20 && mover.walkingPath; f++) {
    now += 1000 / 60;
    mover.step(1000 / 60, now);
  }
  assert.equal(w.me!.room, ROOM_A);
  assert.deepEqual(events, ["Você entrou em Sala Aberta."]);
  const p = ix.roomsById.get(ROOM_P)!;
  assert.equal(mover.walkTo(tileCenter(p.inside).x, tileCenter(p.inside).y), false);
});

test("correction snaps us to the server's position", () => {
  const w = world();
  w.me!.x += 500;
  w.applyCorrection({ x: 300, y: 200, room: null, seq: 9, reason: "speed" });
  assert.equal(w.me!.x, 300);
  assert.equal(w.me!.seq, 9);
});

test("list: private room and its wing title stay hidden; status in plain text", () => {
  const w = world();
  const list = buildList(w);
  assert.deepEqual(
    list.map((wing) => [wingHeading(wing.title), wing.rooms.map((r) => [r.title, r.status])]),
    [
      ["Ala Geral", [["Sala Aberta", "vazia"]]],
      ["Ala restrita", [["Sala privada", "sem acesso"]]],
    ],
  );
  assert.equal(locationText(w), "Entrada");
});

test("a full room keeps its door shut in the prediction too, never for who is inside", () => {
  const w = world();
  w.setRooms(
    [
      { room_id: ROOM_A, label: "Sala Aberta", private: false, can_enter: true, occupants: [], capacity: 1 },
      { room_id: ROOM_P, label: null, private: true, can_enter: false, occupants: null, capacity: null },
    ],
    [{ index: 0, title: "Geral" }],
  );
  assert.equal(w.doorRule(ROOM_A), true, "empty: open");
  const b = { user_id: "B", name: "b", look: { palette: 1 }, x: 0, y: 0, dir: "down" as const, moving: false, room: ROOM_A, state: "online" as const };
  w.applyPositions({ avatars: [b], gone: [] }, 0);
  assert.equal(w.isFull(ROOM_A), true);
  assert.equal(w.doorRule(ROOM_A), false, "full: shut for newcomers");
  assert.match(buildList(w).flatMap((x) => x.rooms).find((r) => r.roomId === ROOM_A)!.status, /cheia/);
  w.setMyRoom(ROOM_A);
  assert.equal(w.doorRule(ROOM_A), true, "whoever is inside can always leave");
});
