import assert from "node:assert/strict";
import test from "node:test";

import { participantUserId } from "./identity.ts";

const USER = "01JANA00000000000000000000";

test("space identities map to the Stoat user; classic ones stay as they are", () => {
  assert.equal(participantUserId(`sp_${USER}_1800000000123`), USER);
  assert.equal(participantUserId(`sp_${USER}_7#publish`), USER, "v0 publish suffix");
  assert.equal(participantUserId(USER), USER, "join_call identity is the user id");
  assert.equal(participantUserId("sp_not-a-ulid_1"), "sp_not-a-ulid_1");
  assert.equal(participantUserId(`sp_${USER}_01`), `sp_${USER}_01`, "leading zero is not ours");
});
