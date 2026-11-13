import assert from "node:assert/strict";
import { test } from "node:test";

import { silentLog } from "../log.ts";
import { FakeLiveKit } from "../media/fakes.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatServer, StoatTextChannel } from "../stoat/types.ts";
import { SpatialSwitch, type SwitchStore } from "./spatialSwitch.ts";

const A = "01JSRVA0000000000000000000";
const B = "01JSRVB0000000000000000000";
const VA = "01JVCA0000000000000000000A"; // voice channel of A
const TA = "01JTXA0000000000000000000A"; // text channel of A
const VB = "01JVCB0000000000000000000B";
const DM = "01JDM00000000000000000000D"; // a DM call room: never touched

class MapStore implements SwitchStore {
  data = new Map<string, string>();
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
  async del(k: string) {
    this.data.delete(k);
  }
  async keysWithPrefix(p: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(p));
  }
}

const server = (id: string, channels: string[]): StoatServer => ({ _id: id, owner: "O", name: id, channels, default_permissions: 0, roles: {} });
const channel = (id: string, srv: string, voice: boolean): StoatTextChannel => ({
  channel_type: "TextChannel",
  _id: id,
  server: srv,
  name: id,
  ...(voice ? { voice: {} } : {}),
});

function setup(enabled: (id: string) => boolean) {
  const cache = new StoatCache();
  cache.replaceStructure([server(A, [VA, TA]), server(B, [VB])], [channel(VA, A, true), channel(TA, A, false), channel(VB, B, true)]);
  const store = new MapStore();
  const lk = new FakeLiveKit();
  lk.join(VA, "01JUSER0000000000000000000"); // someone in A's classic call
  lk.join(TA, "x"); // not a voice channel room (cannot happen, but must not be touched)
  lk.join(DM, "y");
  const sw = new SpatialSwitch({ store, lk, cache, enabled, log: silentLog });
  return { cache, store, lk, sw };
}

test("switching a server on sets its key and closes its classic voice rooms only", async () => {
  const { store, lk, sw } = setup((id) => id === A);
  await sw.sync();
  assert.deepEqual([...store.data.keys()], [`muchat:space:enabled:${A}`]);
  assert.ok(lk.calls.includes(`delete:${VA}`), "classic call of A closed");
  assert.ok(!lk.calls.includes(`delete:${TA}`));
  assert.ok(!lk.calls.includes(`delete:${DM}`), "DMs untouched");
  // Second pass: nothing new, nothing closed again.
  lk.calls.length = 0;
  await sw.sync();
  assert.deepEqual(lk.calls, []);
});

test("all servers ('*') and back: disabling one restores its classic voice", async () => {
  let all = true;
  const { store, sw } = setup((id) => all || id === A);
  await sw.sync();
  assert.equal(store.data.size, 2);
  all = false;
  await sw.sync();
  assert.deepEqual([...store.data.keys()], [`muchat:space:enabled:${A}`]);
});

test("a server the cache does not know keeps its key (no flip on a database hiccup)", async () => {
  const { cache, store, sw } = setup(() => true);
  await sw.sync();
  cache.replaceStructure([server(A, [VA, TA])], [channel(VA, A, true), channel(TA, A, false)]); // B vanished from the copy
  await sw.sync();
  assert.ok(store.data.has(`muchat:space:enabled:${B}`));
});

test("before the first structure load nothing is written", async () => {
  const store = new MapStore();
  const sw = new SpatialSwitch({ store, lk: new FakeLiveKit(), cache: new StoatCache(), enabled: () => true, log: silentLog });
  await sw.sync();
  assert.equal(store.data.size, 0);
});
