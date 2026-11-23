import assert from "node:assert/strict";
import test from "node:test";

import { type RoomLike, isCurrentRoom } from "./currentRoom.ts";

const room = (state: string): RoomLike => ({ state });

test("the call's own connected room is current", () => {
  const r = room("connected");
  assert.equal(isCurrentRoom(r, r), true);
});

test("a room still reconnecting is the call's: its failures are real", () => {
  const r = room("reconnecting");
  assert.equal(isCurrentRoom(r, r), true);
  const s = room("signalReconnecting");
  assert.equal(isCurrentRoom(s, s), true);
});

test("a room the server already dropped is not current, even before the app leaves it", () => {
  // The client sees livekit's "disconnected" a few ms before media.revoked.
  const r = room("disconnected");
  assert.equal(isCurrentRoom(r, r), false);
});

test("a room replaced by the next one is not current", () => {
  // Walking from the living room to the cinema: connect() already holds the cinema.
  const left = room("connected");
  const next = room("connecting");
  assert.equal(isCurrentRoom(next, left), false);
});

test("no call any more: nothing is current", () => {
  assert.equal(isCurrentRoom(undefined, room("connected")), false);
});
