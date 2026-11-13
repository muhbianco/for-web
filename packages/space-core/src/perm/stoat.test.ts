import assert from "node:assert/strict";
import { test } from "node:test";

import { channelPermissions, has, Perm, type PermServer } from "./stoat.ts";

const num = (b: bigint) => Number(b);
const DEFAULT =
  Perm.ViewChannel | Perm.ReadMessageHistory | Perm.SendMessage | Perm.Connect | Perm.Speak | Perm.Video | Perm.Listen;

const server = (roles: Record<string, { rank: number; a?: bigint; d?: bigint }> = {}, defaults = DEFAULT): PermServer => ({
  ownerId: "OWNER",
  defaultPermissions: num(defaults),
  roles: new Map(
    Object.entries(roles).map(([id, r]) => [id, { rank: r.rank, permissions: { a: num(r.a ?? 0n), d: num(r.d ?? 0n) } }]),
  ),
});

const user = { id: "U" };
const now = 1_800_000_000_000;

test("a plain member gets the server defaults", () => {
  const p = channelPermissions({ user, server: server(), channel: {}, member: { roles: [] }, nowMs: now });
  assert.ok(has(p, Perm.Connect) && has(p, Perm.ViewChannel));
  assert.equal(has(p, Perm.ManageChannel), false);
});

test("owner and privileged users get everything; non-members nothing", () => {
  assert.equal(channelPermissions({ user: { id: "OWNER" }, server: server(), channel: {}, member: null, nowMs: now }), Perm.GrantAllSafe);
  assert.equal(channelPermissions({ user: { id: "X", privileged: true }, server: server(), channel: {}, member: null, nowMs: now }), Perm.GrantAllSafe);
  assert.equal(channelPermissions({ user, server: server(), channel: {}, member: null, nowMs: now }), 0n);
});

test("backend order: channel default comes BEFORE server roles (stoat.js differs)", () => {
  // Channel default denies Connect; a server role allows it. The backend lets
  // the role re-allow (role applied after); stoat.js would deny.
  const s = server({ MOD: { rank: 1, a: Perm.Connect } });
  const p = channelPermissions({
    user,
    server: s,
    channel: { defaultPermissions: { a: 0, d: num(Perm.Connect) } },
    member: { roles: ["MOD"] },
    nowMs: now,
  });
  assert.ok(has(p, Perm.Connect));
});

test("channel role overrides apply after server roles and can deny", () => {
  const s = server({ VIS: { rank: 5 } });
  const p = channelPermissions({
    user,
    server: s,
    channel: { rolePermissions: { VIS: { a: 0, d: num(Perm.Connect) } } },
    member: { roles: ["VIS"] },
    nowMs: now,
  });
  assert.equal(has(p, Perm.Connect), false);
  assert.ok(has(p, Perm.ViewChannel));
});

test("rank 0 is applied last and wins over higher rank numbers", () => {
  const s = server({ LOW: { rank: 10, d: Perm.Connect }, TOP: { rank: 0, a: Perm.Connect } });
  const allow = channelPermissions({ user, server: s, channel: {}, member: { roles: ["LOW", "TOP"] }, nowMs: now });
  assert.ok(has(allow, Perm.Connect));
  const s2 = server({ LOW: { rank: 10, a: Perm.Connect }, TOP: { rank: 0, d: Perm.Connect } });
  const deny = channelPermissions({ user, server: s2, channel: {}, member: { roles: ["TOP", "LOW"] }, nowMs: now });
  assert.equal(has(deny, Perm.Connect), false);
});

test("private channel: without ViewChannel everything is zero", () => {
  const p = channelPermissions({
    user,
    server: server(),
    channel: { defaultPermissions: { a: 0, d: num(Perm.ViewChannel) } },
    member: { roles: [] },
    nowMs: now,
  });
  assert.equal(p, 0n);
});

test("role-restricted room: only the allowed role sees and connects", () => {
  const s = server({ DIR: { rank: 2 } });
  const channel = {
    defaultPermissions: { a: 0, d: num(Perm.ViewChannel | Perm.Connect) },
    rolePermissions: { DIR: { a: num(Perm.ViewChannel | Perm.Connect), d: 0 } },
  };
  const outsider = channelPermissions({ user, server: s, channel, member: { roles: [] }, nowMs: now });
  const insider = channelPermissions({ user, server: s, channel, member: { roles: ["DIR"] }, nowMs: now });
  assert.equal(outsider, 0n);
  assert.ok(has(insider, Perm.Connect));
});

test("member flags: can_publish=false drops Speak/Video, can_receive=false drops Listen", () => {
  const p = channelPermissions({
    user,
    server: server(),
    channel: {},
    member: { roles: [], canPublish: false, canReceive: false },
    nowMs: now,
  });
  assert.equal(has(p, Perm.Speak) || has(p, Perm.Video) || has(p, Perm.Listen), false);
  assert.ok(has(p, Perm.Connect));
});

test("timeout restricts to view/read; an expired timeout does nothing", () => {
  const timed = channelPermissions({ user, server: server(), channel: {}, member: { roles: [], timeoutUntil: now + 1 }, nowMs: now });
  assert.equal(timed, Perm.ViewChannel | Perm.ReadMessageHistory);
  const expired = channelPermissions({ user, server: server(), channel: {}, member: { roles: [], timeoutUntil: now - 1 }, nowMs: now });
  assert.ok(has(expired, Perm.Connect));
});

test("roles the server no longer has are ignored", () => {
  const p = channelPermissions({ user, server: server(), channel: {}, member: { roles: ["GONE"] }, nowMs: now });
  assert.ok(has(p, Perm.Connect));
});
