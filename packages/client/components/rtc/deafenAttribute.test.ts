import assert from "node:assert/strict";
import test from "node:test";

import {
  VOICE_DEAFENED_ATTR,
  deafenAttributeValue,
  isDeafenedAttribute,
} from "./deafenAttribute.ts";

test("treats only the explicit true flag as deafened", () => {
  assert.equal(isDeafenedAttribute(undefined), false);
  assert.equal(isDeafenedAttribute({}), false);
  assert.equal(isDeafenedAttribute({ [VOICE_DEAFENED_ATTR]: "false" }), false);
  assert.equal(isDeafenedAttribute({ [VOICE_DEAFENED_ATTR]: "true" }), true);
});

test("serializes deafen for LiveKit attributes", () => {
  assert.equal(deafenAttributeValue(true), "true");
  assert.equal(deafenAttributeValue(false), "false");
});
