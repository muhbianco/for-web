import assert from "node:assert/strict";
import { test } from "node:test";

import {
  identityBelongsTo,
  isManagedRoomName,
  managedRoomName,
  mediaIdentity,
  parseManagedRoomName,
  parseMediaIdentity,
} from "./naming.ts";

const ROOM = "01JCX6Y2Z9K8M7N6P5Q4R3S2T1";
const USER = "01M0AVGXQBDXXBEBXTF3YSFCQS";

test("room name round-trips and is managed", () => {
  const name = managedRoomName(ROOM, 3);
  assert.equal(name, `msp_${ROOM}_3`);
  assert.ok(isManagedRoomName(name));
  assert.deepEqual(parseManagedRoomName(name), { roomId: ROOM, epoch: 3 });
});

test("stoat channel ids are never managed", () => {
  assert.equal(isManagedRoomName("01JCHANNEL0000000000000000"), false);
  assert.equal(parseManagedRoomName("01JCHANNEL0000000000000000"), null);
});

test("room name rejects bad input", () => {
  assert.throws(() => managedRoomName("not-a-ulid", 1), RangeError);
  assert.throws(() => managedRoomName(ROOM, -1), RangeError);
  assert.throws(() => managedRoomName(ROOM, 1.5), RangeError);
  for (const bad of [
    "msp_",
    "msp__1",
    `msp_${ROOM}_`,
    `msp_${ROOM}_01`,
    `msp_${ROOM}_x`,
    `msp_${ROOM.toLowerCase()}_1`,
  ]) {
    assert.equal(parseManagedRoomName(bad), null, bad);
  }
});

test("identity round-trips and is unique per grant", () => {
  const a = mediaIdentity(USER, 1);
  const b = mediaIdentity(USER, 2);
  assert.notEqual(a, b);
  assert.deepEqual(parseMediaIdentity(a), { userId: USER, grantSeq: 1 });
  assert.equal(parseMediaIdentity(USER), null);
});

test("orphan matching covers publish-suffixed identities only for the same user", () => {
  const id = mediaIdentity(USER, 9);
  assert.ok(identityBelongsTo(id, USER));
  assert.ok(identityBelongsTo(`${id}#x`, USER));
  assert.equal(identityBelongsTo(id, "01M0AVGXQBDXXBEBXTF3YSFCQT"), false);
  assert.equal(identityBelongsTo(USER, USER), false);
});
