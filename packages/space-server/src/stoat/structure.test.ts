import assert from "node:assert/strict";
import { test } from "node:test";

import { StoatCache } from "./cache.ts";
import { routeBonfireEvent, type StructureSnapshot, StructureSync } from "./structure.ts";
import type { StoatServer, StoatTextChannel } from "./types.ts";

const SRV = "01JSRV00000000000000000000";
const SRV2 = "01JSRV20000000000000000000";
const PUB = "01JPVB00000000000000000000";
const PRIV = "01JPRV00000000000000000000";
const silent = { info() {}, warn() {} };

const server = (id: string, channels: string[]): StoatServer => ({
  _id: id,
  owner: "01J0WNER000000000000000000",
  name: "s",
  channels,
  default_permissions: 0,
  roles: {},
});
const room = (id: string, srv = SRV, extra: Partial<StoatTextChannel> = {}): StoatTextChannel => ({
  channel_type: "TextChannel",
  _id: id,
  server: srv,
  name: id,
  voice: {},
  ...extra,
});

test("a full copy from the database keeps private rooms the bot cannot see", () => {
  const cache = new StoatCache();
  const events: string[] = [];
  cache.on((c) => events.push(c.kind === "ready" ? "ready" : `${c.kind}:${"serverId" in c ? c.serverId : ""}`));
  const priv = room(PRIV, SRV, { default_permissions: { a: 0, d: 1 << 20 } });
  cache.replaceStructure([server(SRV, [PUB, PRIV])], [room(PUB), priv]);
  assert.deepEqual(events, ["ready"]);
  assert.ok(cache.channels.has(PRIV));

  // The bot's own Ready (filtered by its ViewChannel) only hints a refresh: it
  // must not drop the private room from the cache.
  const sync = new StructureSync({ load: async () => ({ servers: [], channels: [] }), cache, log: silent, debounceMs: 60_000 });
  routeBonfireEvent({ type: "Ready", servers: [server(SRV, [PUB, PRIV])], channels: [room(PUB)] }, cache, sync);
  assert.ok(cache.channels.has(PRIV), "Ready payload ignored");
  sync.stop();
});

test("only servers that changed are announced; removed ones are gone", () => {
  const cache = new StoatCache();
  cache.replaceStructure([server(SRV, [PUB]), server(SRV2, [])], [room(PUB)]);
  const events: string[] = [];
  cache.on((c) => events.push(`${c.kind}:${"serverId" in c ? c.serverId : ""}`));
  cache.replaceStructure([server(SRV, [PUB]), server(SRV2, [])], [room(PUB)]);
  assert.deepEqual(events, [], "same copy: silence");
  cache.replaceStructure([server(SRV, [PUB])], [room(PUB, SRV, { voice: { max_users: 3 } })]);
  assert.deepEqual(events, ["server_gone:01JSRV20000000000000000000", "structure:01JSRV00000000000000000000"]);
});

test("member events still go to the cache; structure events only refresh", async () => {
  const cache = new StoatCache();
  cache.replaceStructure([server(SRV, [PUB])], [room(PUB)]);
  let loads = 0;
  const snap: StructureSnapshot = { servers: [server(SRV, [PUB, PRIV])], channels: [room(PUB), room(PRIV)] };
  const sync = new StructureSync({
    load: async () => {
      loads++;
      return snap;
    },
    cache,
    log: silent,
    debounceMs: 5,
  });
  const members: string[] = [];
  cache.on((c) => {
    if (c.kind === "member") members.push(c.userId);
  });
  routeBonfireEvent(
    {
      type: "Bulk",
      v: [
        { type: "ChannelCreate", channel_type: "TextChannel", _id: PRIV, server: SRV, name: "x" },
        { type: "ServerUpdate", id: SRV, data: {} },
        { type: "ServerMemberUpdate", id: { server: SRV, user: "U1" }, data: {} },
      ],
    },
    cache,
    sync,
  );
  assert.deepEqual(members, ["U1"]);
  assert.equal(cache.channels.has(PRIV), false, "not from the event payload");
  await new Promise((r) => setTimeout(r, 30));
  await sync.refresh();
  assert.ok(cache.channels.has(PRIV), "from the database");
  assert.ok(loads >= 1 && loads <= 3, `debounced (${loads} loads)`);
  sync.stop();
});

test("a failed refresh keeps the last good copy", async () => {
  const cache = new StoatCache();
  cache.replaceStructure([server(SRV, [PUB])], [room(PUB)]);
  const warns: string[] = [];
  const sync = new StructureSync({
    load: async () => {
      throw new Error("mongo down");
    },
    cache,
    log: { info() {}, warn: (m) => warns.push(m) },
  });
  await sync.refresh();
  assert.ok(cache.channels.has(PUB));
  assert.deepEqual(warns, ["structure refresh failed"]);
});
