import assert from "node:assert/strict";
import { test } from "node:test";

import { Perm } from "@muchat/space-core";

import { silentLog } from "../log.ts";
import type { MemberResult, StoatMembers } from "../stoat/api.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { MemoryDecorStore } from "./decorStore.ts";
import { Registry } from "./registry.ts";
import type { SessionPort, Viewer } from "./runtime.ts";
import { MemoryAssignmentStore } from "./store.ts";

// Regressions of the 16/11/2026 audit (docs/espaco/fase-4-relatorio.md):
// - the Registry dropped the decoration store it was given, so decoration
//   lived in memory and vanished on every restart of the space service;
// - a permission cached for someone with no avatar survived the role change
//   that should have removed it.

const SRV = "01JSRV00000000000000000000";
const PUB = "01JPVB00000000000000000000";
const PRIV = "01JPRV00000000000000000000";
const ANA = "01JANA00000000000000000000";
const BIA = "01JB1A00000000000000000000";
const n = (b: bigint) => Number(b);
const DEFAULT = Perm.ViewChannel | Perm.ReadMessageHistory | Perm.SendMessage | Perm.Connect | Perm.Speak | Perm.Listen;

function makeCache(): StoatCache {
  const cache = new StoatCache();
  cache.apply({
    type: "Ready",
    servers: [
      {
        _id: SRV,
        owner: ANA,
        name: "Piloto",
        channels: [PUB, PRIV],
        default_permissions: n(DEFAULT),
        roles: { DIR: { name: "Diretoria", rank: 1, permissions: { a: 0, d: 0 } } },
      },
    ],
    channels: [
      { channel_type: "TextChannel", _id: PUB, server: SRV, name: "Sala Aberta", voice: { max_users: 8 } },
      {
        channel_type: "TextChannel",
        _id: PRIV,
        server: SRV,
        name: "Sala Secreta",
        voice: { max_users: 4 },
        default_permissions: { a: 0, d: n(Perm.ViewChannel | Perm.Connect) },
        role_permissions: { DIR: { a: n(Perm.ViewChannel | Perm.Connect), d: 0 } },
      },
    ],
  });
  return cache;
}

class CountingDecorStore extends MemoryDecorStore {
  loads = 0;
  saves = 0;
  override async load(serverId: string) {
    this.loads++;
    return super.load(serverId);
  }
  override async save(...args: Parameters<MemoryDecorStore["save"]>) {
    this.saves++;
    return super.save(...args);
  }
}

const roles = new Map<string, string[]>();
const members: StoatMembers = {
  async member(_server, userId): Promise<MemberResult> {
    const m: StoatMember = { _id: { server: SRV, user: userId }, roles: roles.get(userId) ?? [] };
    return { kind: "ok", member: m };
  },
};

const user = (id: string, name: string): StoatUser => ({ _id: id, username: name });

class Silent implements SessionPort {
  readonly viewer: Viewer;
  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }
  send() {}
  close() {}
}

test("the decoration store handed to the Registry is the one the runtimes use (survives a restart)", async () => {
  const decor = new CountingDecorStore();
  const assignments = new MemoryAssignmentStore();
  const first = new Registry({ cache: makeCache(), store: assignments, decorStore: decor, members, log: silentLog });
  const rt = (await first.get(SRV))!;
  assert.ok(decor.loads >= 1, "the runtime read the given store");
  assert.ok(decor.saves >= 1, "the default theme was persisted in the given store");
  const rev = rt.decorRev;
  assert.equal(decor.docs.get(SRV)?.rev, rev);

  // "Restart": a new process with the same database finds the same decoration.
  const second = new Registry({ cache: makeCache(), store: assignments, decorStore: decor, members, log: silentLog });
  const again = (await second.get(SRV))!;
  assert.equal(again.decorRev, rev, "same revision after the restart, not a fresh theme");
  assert.deepEqual(again.decorState.items, rt.decorState.items);
});

test("a role removed while the person has no avatar no longer opens the door when they come back", async () => {
  const cache = makeCache();
  const registry = new Registry({ cache, store: new MemoryAssignmentStore(), members, log: silentLog });
  const rt = (await registry.get(SRV))!;
  const withRole: Viewer = { user: user(BIA, "bia"), member: { _id: { server: SRV, user: BIA }, roles: ["DIR"] } };
  const fresh: Viewer = { user: user(BIA, "bia"), member: { _id: { server: SRV, user: BIA }, roles: [] } };
  assert.equal(rt.canEnter(withRole, PRIV), true, "with the role she may enter (and it is cached)");

  // She is not on the map (no avatar) when the role is taken away: the
  // member event must still drop what was cached for her.
  cache.apply({ type: "ServerMemberUpdate", id: { server: SRV, user: BIA }, data: { roles: [] }, clear: [] });
  assert.equal(rt.canEnter(fresh, PRIV), false, "the event cleared the cached permission");

  // And a hello always starts from the member it fetched, whatever was cached.
  rt.invalidatePerms(BIA);
  assert.equal(rt.canEnter(withRole, PRIV), true, "cached again from an old member object");
  rt.join(new Silent(fresh));
  assert.equal(rt.canEnter(fresh, PRIV), false, "joining clears it: the door is shut");
});

test("a Stoat timeout does not keep masking permissions after it ends", async () => {
  let clock = 1_800_000_000_000;
  const registry = new Registry({ cache: makeCache(), store: new MemoryAssignmentStore(), members, log: silentLog, now: () => clock });
  const rt = (await registry.get(SRV))!;
  const CAI = "01JCA100000000000000000000";
  const viewer: Viewer = {
    user: user(CAI, "cai"),
    member: { _id: { server: SRV, user: CAI }, roles: [], timeout: new Date(clock + 60_000).toISOString() },
  };
  assert.equal(rt.canEnter(viewer, PUB), false, "timed out: no Connect");
  clock += 61_000;
  assert.equal(rt.canEnter(viewer, PUB), true, "the cached mask lapsed with the timeout");
});
