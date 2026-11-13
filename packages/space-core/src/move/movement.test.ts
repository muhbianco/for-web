import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_SPEED, MOVE_SEND_HZ, TILE } from "../map/constants.ts";
import { indexMap, regionAt, tileCenter } from "../map/grid.ts";
import { generateLayout } from "../map/layout.ts";
import { fakeUlid } from "../testing/prng.ts";
import { canOccupy, type DoorRule, sweep } from "./collision.ts";
import { applyMove, BUDGET_CAP, initialMoveState, type MoveState } from "./movement.ts";
import { findPath } from "./path.ts";

const ROOM_A = fakeUlid(1);
const ROOM_B = fakeUlid(2);

const map = generateLayout({
  templateVersion: 1,
  wings: [
    {
      index: 0,
      title: "Geral",
      slots: [
        { roomId: ROOM_A, label: "A", size: "M" },
        { roomId: ROOM_B, label: "B", size: "S" },
      ],
    },
  ],
});
const ix = indexMap(map);
const roomA = ix.roomsById.get(ROOM_A)!;
const open = () => true;
const lockedA = (id: string) => id !== ROOM_A;

/** Walks a tile path at max speed, MOVE_SEND_HZ, like a well-behaved client. */
function walk(state: MoveState, tiles: { tx: number; ty: number }[], t0: number, door: DoorRule = open) {
  const stepMs = 1000 / MOVE_SEND_HZ;
  const stepPx = (MAX_SPEED * stepMs) / 1000;
  let s = state;
  let t = t0;
  const changes: Array<{ from: string | null; to: string | null }> = [];
  let corrections = 0;
  for (const tile of tiles.slice(1)) {
    const goal = tileCenter(tile);
    while (Math.hypot(goal.x - s.pos.x, goal.y - s.pos.y) > 0.5) {
      const d = Math.hypot(goal.x - s.pos.x, goal.y - s.pos.y);
      const k = Math.min(1, stepPx / d);
      t += stepMs;
      const out = applyMove(
        ix,
        s,
        { x: s.pos.x + (goal.x - s.pos.x) * k, y: s.pos.y + (goal.y - s.pos.y) * k, seq: s.seq + 1 },
        t,
        door,
      );
      if (out.kind === "stale") throw new Error("unexpected stale");
      if (out.kind === "corrected") {
        corrections++;
        s = out.state;
        break;
      }
      if (out.roomChange) changes.push(out.roomChange);
      s = out.state;
    }
  }
  return { state: s, t, changes, corrections };
}

const spawn = tileCenter(map.spawns[0]!);

test("a client walking at max speed into a room is never corrected", () => {
  const path = findPath(ix, map.spawns[0]!, roomA.inside, open)!;
  const res = walk(initialMoveState(spawn, null, 0), path, 0);
  assert.equal(res.corrections, 0);
  assert.deepEqual(res.changes, [{ from: null, to: ROOM_A }]);
  assert.equal(res.state.room, ROOM_A);
});

test("network jitter: a burst of legitimate moves arriving together is accepted", () => {
  let s = initialMoveState(spawn, null, 0);
  // 6 moves of one 15 Hz step each, all received at the same instant.
  const stepPx = MAX_SPEED / MOVE_SEND_HZ;
  for (let i = 1; i <= 6; i++) {
    const out = applyMove(ix, s, { x: spawn.x + stepPx * i, y: spawn.y, seq: i }, 1000, open);
    assert.equal(out.kind, "accepted", `move ${i}`);
    if (out.kind === "accepted") s = out.state;
  }
});

test("teleport is corrected back to the last accepted position", () => {
  const s = initialMoveState(spawn, null, 0);
  const far = tileCenter(roomA.inside);
  const out = applyMove(ix, s, { x: far.x, y: far.y, seq: 1 }, 10, open);
  assert.equal(out.kind, "corrected");
  if (out.kind === "corrected") {
    assert.equal(out.reason, "speed");
    assert.deepEqual(out.state.pos, spawn);
    assert.equal(out.state.room, null);
  }
  assert.ok(Math.hypot(far.x - spawn.x, far.y - spawn.y) > BUDGET_CAP);
});

test("walls stop movement; the correction is the last valid point", () => {
  // Lobby west wall is tile x = 0; walk left from the spawn.
  let s = initialMoveState(spawn, null, 0);
  let t = 0;
  let corrected = false;
  for (let seq = 1; seq < 200 && !corrected; seq++) {
    t += 1000 / MOVE_SEND_HZ;
    const out = applyMove(ix, s, { x: s.pos.x - 10, y: s.pos.y, seq }, t, open);
    if (out.kind === "corrected") {
      corrected = true;
      assert.equal(out.reason, "collision");
      assert.ok(out.state.pos.x >= TILE + 10 - 1, "stays clear of the wall");
      assert.ok(canOccupy(ix, out.state.pos, open));
    } else if (out.kind === "accepted") s = out.state;
  }
  assert.ok(corrected);
});

test("a locked door blocks entry; the door tile itself does not change membership", () => {
  const toOutside = findPath(ix, map.spawns[0]!, roomA.outside, open)!;
  const atDoor = walk(initialMoveState(spawn, null, 0), toOutside, 0);
  assert.equal(atDoor.corrections, 0);
  // Try to go in while locked.
  const tryIn = walk(atDoor.state, [roomA.outside, roomA.door, roomA.inside], atDoor.t, lockedA);
  assert.ok(tryIn.corrections > 0);
  assert.equal(tryIn.state.room, null);
  // Unlocked: in, then out again.
  const goIn = walk(atDoor.state, [roomA.outside, roomA.door, roomA.inside], atDoor.t, open);
  assert.deepEqual(goIn.changes, [{ from: null, to: ROOM_A }]);
  const goOut = walk(goIn.state, [roomA.inside, roomA.door, roomA.outside], goIn.t, lockedA);
  assert.equal(goOut.corrections, 0, "an occupant can always leave");
  assert.deepEqual(goOut.changes, [{ from: ROOM_A, to: null }]);
});

test("standing on the threshold keeps the current room (hysteresis)", () => {
  const door = tileCenter(roomA.door);
  assert.equal(regionAt(ix, door.x, door.y).kind, "door");
  const inside = initialMoveState(tileCenter(roomA.inside), ROOM_A, 0);
  const out = applyMove(ix, inside, { x: door.x, y: door.y, seq: 1 }, 1000, open);
  assert.equal(out.kind, "accepted");
  if (out.kind === "accepted") {
    assert.equal(out.state.room, ROOM_A);
    assert.equal(out.roomChange, null);
  }
});

test("door locked under someone on the threshold: they can step out, not in", () => {
  const door = tileCenter(roomA.door);
  const onDoor = initialMoveState(door, null, 0);
  assert.equal(canOccupy(ix, door, lockedA), false);
  const outside = tileCenter(roomA.outside);
  const stepOut = applyMove(ix, onDoor, { x: outside.x, y: outside.y, seq: 1 }, 500, lockedA);
  assert.equal(stepOut.kind, "accepted");
  const inside = tileCenter(roomA.inside);
  const stepIn = applyMove(ix, onDoor, { x: inside.x, y: inside.y, seq: 1 }, 500, lockedA);
  assert.equal(stepIn.kind, "corrected");
  if (stepIn.kind === "corrected") assert.equal(stepIn.state.room, null);
});

test("duplicates and out-of-order moves are ignored; NaN is corrected", () => {
  const s: MoveState = { ...initialMoveState(spawn, null, 0), seq: 5 };
  assert.equal(applyMove(ix, s, { x: spawn.x + 1, y: spawn.y, seq: 5 }, 10, open).kind, "stale");
  assert.equal(applyMove(ix, s, { x: spawn.x + 1, y: spawn.y, seq: 3 }, 10, open).kind, "stale");
  const bad = applyMove(ix, s, { x: Number.NaN, y: spawn.y, seq: 6 }, 10, open);
  assert.equal(bad.kind, "corrected");
  if (bad.kind === "corrected") assert.equal(bad.reason, "invalid");
});

test("sweep does not tunnel through a wall in one large step", () => {
  const lobbyRight = { x: (map.lobby.x1 - 1) * TILE + TILE / 2, y: 3 * TILE };
  const beyond = { x: (map.lobby.x1 + 3) * TILE, y: 3 * TILE };
  const res = sweep(ix, lobbyRight, beyond, open);
  assert.equal(res.blocked, true);
});
