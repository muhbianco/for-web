import assert from "node:assert/strict";
import { test } from "node:test";

import { type ListRoom, type ListWing, shareList, shareZones } from "./list.ts";

function room(roomId: string, occupants: number): ListRoom {
  return { roomId, title: roomId, here: false, canEnter: true, isPrivate: false, canView: true, occupants, status: `${occupants}` };
}

function wings(a: number, b: number): ListWing[] {
  return [
    { index: 0, title: "A", rooms: [room("r1", a), room("r2", 0)] },
    { index: 1, title: "B", rooms: [room("r3", b)] },
  ];
}

// 15/11/2026: the list was rebuilt every 250 ms and Solid's <For> recreated
// every row (it compares by reference), losing hover and focus.
test("an unchanged list keeps the previous array", () => {
  const prev = wings(1, 2);
  assert.equal(shareList(prev, wings(1, 2)), prev);
});

test("one room changes: only that room and its wing are new", () => {
  const prev = wings(1, 2);
  const next = shareList(prev, wings(3, 2));
  assert.notEqual(next, prev);
  assert.notEqual(next[0], prev[0]);
  assert.notEqual(next[0]!.rooms[0], prev[0]!.rooms[0]);
  assert.equal(next[0]!.rooms[0]!.occupants, 3);
  assert.equal(next[0]!.rooms[1], prev[0]!.rooms[1], "untouched room keeps its object");
  assert.equal(next[1], prev[1], "untouched wing keeps its object");
});

test("a removed room is not resurrected", () => {
  const prev = wings(1, 2);
  const next = shareList(prev, [{ index: 0, title: "A", rooms: [room("r1", 1)] }, prev[1]!]);
  assert.equal(next[0]!.rooms.length, 1);
  assert.equal(next[0]!.rooms[0], prev[0]!.rooms[0]);
});

test("zones reuse unchanged options", () => {
  const prev = [{ key: "hall", label: "Hall" }, { key: "spine", label: "Corredor" }];
  assert.equal(shareZones(prev, [{ key: "hall", label: "Hall" }, { key: "spine", label: "Corredor" }]), prev);
  const next = shareZones(prev, [{ key: "hall", label: "Hall" }, { key: "spine", label: "Rua" }]);
  assert.equal(next[0], prev[0]);
  assert.notEqual(next[1], prev[1]);
});
