import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_FRAME_BYTES, parseCommand } from "./messages.ts";

const ok = (raw: unknown) => {
  const res = parseCommand(JSON.stringify(raw));
  assert.equal(res.ok, true, JSON.stringify(raw));
  return res.ok ? res.cmd : null;
};
const bad = (raw: string, error: string) => assert.deepEqual(parseCommand(raw), { ok: false, error });

test("the commands of protocol v1 parse", () => {
  assert.equal(
    ok({ v: 1, t: "hello", id: "h1", d: { session_token: "x".repeat(16), server_id: "01JSRV00000000000000000000", client: "web" } })?.t,
    "hello",
  );
  assert.equal(ok({ v: 1, t: "avatar.move", seq: 1, d: { x: -32, y: 64, dir: "left", moving: true } })?.t, "avatar.move");
  assert.equal(ok({ v: 1, t: "presence.idle", id: "i1", d: { idle: true } })?.t, "presence.idle");
  assert.equal(ok({ v: 1, t: "ping", id: "p1" })?.t, "ping");
  assert.equal(ok({ v: 1, t: "media.session.request", id: "m1" })?.t, "media.session.request");
});

test("media.session.request carries no room: the server decides which one", () => {
  // A client cannot name a room to get a token for; extra fields are dropped.
  const cmd = ok({ v: 1, t: "media.session.request", id: "m1", d: { room_id: "01JPRV00000000000000000000" } });
  assert.deepEqual(cmd, { v: 1, t: "media.session.request", id: "m1" });
});

test("malformed frames are refused without throwing", () => {
  bad("{", "invalid_json");
  bad(JSON.stringify({ v: 2, t: "ping", id: "p" }), "invalid_message");
  bad(JSON.stringify({ v: 1, t: "media.session.request" }), "invalid_message");
  bad(JSON.stringify({ v: 1, t: "media.grant", id: "x" }), "invalid_message"); // server event, not a command
  bad("x".repeat(MAX_FRAME_BYTES + 1), "frame_too_large");
});
