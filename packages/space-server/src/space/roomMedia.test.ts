import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findPath,
  indexMap,
  managedRoomName,
  MAX_SPEED,
  MOVE_SEND_HZ,
  parseManagedRoomName,
  Perm,
  type TilePos,
  tileCenter,
} from "@muchat/space-core";

import { silentLog } from "../log.ts";
import { MediaController } from "../media/controller.ts";
import { FakeClock, FakeLeases, FakeLiveKit, FakeMinter } from "../media/fakes.ts";
import { Sweeper } from "../media/sweeper.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { MediaHub, STARTUP_GRACE_MS } from "./roomMedia.ts";
import { DISCONNECT_GRACE_MS, type SessionPort, SpaceRuntime, type Viewer } from "./runtime.ts";
import { MemoryAssignmentStore } from "./store.ts";

// ---- fixture -----------------------------------------------------------------
// Server SRV: PUB (8 places), PRIV (Diretoria only), ONE (1 place).
// Server SRV2: R2. Roles: DIR (sees PRIV), VID (camera/screen), MUTE (no Speak).

const SRV = "01JSRV00000000000000000000";
const SRV2 = "01JSRV20000000000000000000";
const PUB = "01JPVB00000000000000000000";
const PRIV = "01JPRV00000000000000000000";
const ONE = "01J0NE00000000000000000000";
const R2 = "01JR2000000000000000000000";
const ANA = "01JANA00000000000000000000";
const BIA = "01JB1A00000000000000000000";
const CAI = "01JCA100000000000000000000";
const DUD = "01JDVD00000000000000000000";
const n = (b: bigint) => Number(b);
const DEFAULT = Perm.ViewChannel | Perm.ReadMessageHistory | Perm.SendMessage | Perm.Connect | Perm.Speak | Perm.Listen;

function makeCache(): StoatCache {
  const cache = new StoatCache();
  const roles = {
    DIR: { name: "Diretoria", rank: 1, permissions: { a: 0, d: 0 } },
    VID: { name: "Vídeo", rank: 2, permissions: { a: n(Perm.Video), d: 0 } },
    MUTE: { name: "Ouvinte", rank: 3, permissions: { a: 0, d: n(Perm.Speak) } },
  };
  cache.apply({
    type: "Ready",
    servers: [
      { _id: SRV, owner: "01J0WNER000000000000000000", name: "Piloto", channels: [PUB, PRIV, ONE], default_permissions: n(DEFAULT), roles },
      { _id: SRV2, owner: "01J0WNER000000000000000000", name: "Outro", channels: [R2], default_permissions: n(DEFAULT), roles: {} },
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
      { channel_type: "TextChannel", _id: ONE, server: SRV, name: "Cabine", voice: { max_users: 1 } },
      { channel_type: "TextChannel", _id: R2, server: SRV2, name: "Sala do Outro", voice: {} },
    ],
  });
  return cache;
}

const user = (id: string, username: string): StoatUser => ({ _id: id, username });
const member = (server: string, userId: string, roles: string[] = []): StoatMember => ({ _id: { server, user: userId }, roles });

class FakeSession implements SessionPort {
  viewer: Viewer;
  sent: Array<Record<string, any>> = [];
  closedWith: number | null = null;
  pos = { x: 0, y: 0 };
  seq = 0;
  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }
  send(event: Record<string, unknown>) {
    const e = event as Record<string, any>;
    this.sent.push(e);
    if (e.t === "space.snapshot") {
      this.pos = { x: e.d.you.x, y: e.d.you.y };
      this.seq = e.d.you.seq;
    }
    if (e.t === "avatar.correction") this.pos = { x: e.d.x, y: e.d.y };
  }
  close(code: number) {
    this.closedWith = code;
  }
  of(t: string) {
    return this.sent.filter((e) => e.t === t);
  }
  last(t: string) {
    return this.of(t).at(-1);
  }
}

interface World {
  clock: { now: number };
  lk: FakeLiveKit;
  leases: FakeLeases;
  minter: FakeMinter;
  retryClock: FakeClock;
  controller: MediaController;
  hub: MediaHub;
  cache: StoatCache;
}

function makeWorld(opts: { debounceMs?: number; lk?: FakeLiveKit; leases?: FakeLeases; cache?: StoatCache; clock?: { now: number } } = {}): World {
  const clock = opts.clock ?? { now: 1_800_000_000_000 };
  const lk = opts.lk ?? new FakeLiveKit();
  const leases = opts.leases ?? new FakeLeases();
  const minter = new FakeMinter();
  const retryClock = new FakeClock(clock.now);
  const controller = new MediaController({ lk, leases, minter, publicUrl: "wss://chat.test/livekit", clock: retryClock });
  const hub = new MediaHub({ media: controller, log: silentLog, debounceMs: opts.debounceMs ?? 0, now: () => clock.now });
  return { clock, lk, leases, minter, retryClock, controller, hub, cache: opts.cache ?? makeCache() };
}

async function space(w: World, serverId = SRV): Promise<SpaceRuntime> {
  const rt = new SpaceRuntime({
    serverId,
    cache: w.cache,
    store: new MemoryAssignmentStore(),
    log: silentLog,
    now: () => w.clock.now,
    media: { hub: w.hub, lk: w.lk },
  });
  await rt.init();
  return rt;
}

async function enter(rt: SpaceRuntime, id: string, name: string, roles: string[] = []): Promise<FakeSession> {
  const s = new FakeSession({ user: user(id, name), member: member(rt.serverId, id, roles) });
  await rt.prepareJoin(s.viewer);
  rt.join(s);
  return s;
}

const tileOf = (p: { x: number; y: number }): TilePos => ({ tx: Math.floor(p.x / 32), ty: Math.floor(p.y / 32) });

/** Walks at legal speed to `goal`; stops at the first correction. */
function walk(w: World, rt: SpaceRuntime, s: FakeSession, goal: TilePos): { corrected: boolean } {
  const ix = indexMap(rt.map);
  const path = findPath(ix, tileOf(s.pos), goal, () => true);
  assert.ok(path, "path exists");
  const step = MAX_SPEED / MOVE_SEND_HZ;
  for (const tile of path.slice(1)) {
    const target = tileCenter(tile);
    while (Math.hypot(target.x - s.pos.x, target.y - s.pos.y) > 0.5) {
      const d = Math.hypot(target.x - s.pos.x, target.y - s.pos.y);
      const k = Math.min(1, step / d);
      const next = { x: Math.round(s.pos.x + (target.x - s.pos.x) * k), y: Math.round(s.pos.y + (target.y - s.pos.y) * k) };
      w.clock.now += 1000 / MOVE_SEND_HZ;
      const before = s.of("avatar.correction").length;
      rt.move(s, { seq: ++s.seq, x: next.x, y: next.y, dir: "up", moving: true });
      if (s.of("avatar.correction").length > before) return { corrected: true };
      s.pos = next;
    }
  }
  return { corrected: false };
}

const roomOf = (rt: SpaceRuntime, id: string) => indexMap(rt.map).roomsById.get(id)!;
const goIn = (w: World, rt: SpaceRuntime, s: FakeSession, id: string) => walk(w, rt, s, roomOf(rt, id).inside);
const goOut = (w: World, rt: SpaceRuntime, s: FakeSession, id: string) => walk(w, rt, s, roomOf(rt, id).outside);

// ---- entry and exit --------------------------------------------------------------

test("walking in grants media for that room only; walking out revokes it", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  assert.equal(goIn(w, rt, ana, PUB).corrected, false);
  await w.hub.settle();
  const g = ana.last("media.grant");
  assert.ok(g, "grant sent");
  assert.equal(g.d.room_id, PUB);
  assert.equal(g.d.url, "wss://chat.test/livekit");
  assert.match(g.d.identity, new RegExp(`^sp_${ANA}_\\d+$`));
  assert.deepEqual(g.d.sources, ["microphone"]);
  assert.equal(g.d.can_subscribe, true);
  const lease = w.leases.leases.get(g.d.identity)!;
  assert.equal(parseManagedRoomName(lease.room_name)?.roomId, PUB);
  assert.equal(lease.server_id, SRV);
  assert.equal(w.minter.minted.length, 1);

  goOut(w, rt, ana, PUB);
  await w.hub.settle();
  assert.deepEqual(ana.last("media.revoked")?.d, { room_id: PUB, reason: "left" });
  assert.equal(w.leases.leases.size, 0, "no lease after leaving");
  assert.ok(w.lk.calls.includes(`remove:${lease.room_name}:${g.d.identity}`), "participant removed");
  assert.equal(w.hub.grantCount, 0);
});

test("a quick in-and-out inside the debounce mints nothing", async () => {
  const w = makeWorld({ debounceMs: 40 });
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  goIn(w, rt, ana, PUB);
  goOut(w, rt, ana, PUB);
  await w.hub.settle();
  assert.equal(w.minter.minted.length, 0);
  assert.equal(w.leases.calls.filter((c) => c.startsWith("write:")).length, 0);
  assert.equal(ana.of("media.grant").length, 0);
});

test("the token's sources follow Stoat permissions (Speak, Video, Listen)", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const cai = await enter(rt, CAI, "cai", ["VID"]);
  const dud = await enter(rt, DUD, "dud", ["MUTE"]);
  goIn(w, rt, cai, PUB);
  goIn(w, rt, dud, PUB);
  await w.hub.settle();
  assert.deepEqual(cai.last("media.grant")?.d.sources, ["microphone", "camera", "screen_share", "screen_share_audio"]);
  assert.deepEqual(dud.last("media.grant")?.d.sources, [], "listener publishes nothing");
  assert.equal(dud.last("media.grant")?.d.can_subscribe, true);
  const minted = w.minter.minted.find((m) => m.userId === DUD)!;
  assert.deepEqual(minted.sources, []);
});

test("a full room keeps its door shut for newcomers; no grant for them", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  const bia = await enter(rt, BIA, "bia");
  assert.equal(goIn(w, rt, ana, ONE).corrected, false);
  assert.equal(goIn(w, rt, bia, ONE).corrected, true, "bia stopped at the door");
  await w.hub.settle();
  assert.equal(rt.desiredRoom(BIA), null);
  assert.equal(bia.of("media.grant").length, 0);
  assert.equal(ana.of("media.grant").length, 1);
  assert.equal(rt.roomViews(bia.viewer).find((r) => r.room_id === ONE)?.capacity, 1);
});

test("the room's epoch turns only when its last person leaves", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  const bia = await enter(rt, BIA, "bia");
  goIn(w, rt, ana, PUB);
  goIn(w, rt, bia, PUB);
  await w.hub.settle();
  const room1 = w.leases.leases.get(ana.last("media.grant")!.d.identity)!.room_name;
  assert.equal(w.leases.leases.get(bia.last("media.grant")!.d.identity)!.room_name, room1, "same LiveKit room");

  goOut(w, rt, ana, PUB);
  await w.hub.settle();
  assert.equal(w.hub.isCurrentRoom(room1), true, "bia still inside: same epoch");

  goOut(w, rt, bia, PUB);
  await w.hub.settle();
  assert.equal(w.hub.isCurrentRoom(room1), false, "empty: the old room name is dead");

  w.clock.now += 1_000;
  goIn(w, rt, ana, PUB);
  await w.hub.settle();
  const room2 = w.leases.leases.get(ana.last("media.grant")!.d.identity)!.room_name;
  assert.notEqual(room2, room1);
  assert.equal(parseManagedRoomName(room2)?.roomId, PUB);
  assert.equal(w.hub.isCurrentRoom(room2), true);
});

// ---- access changes -------------------------------------------------------------

test("losing access while inside: put outside and media revoked", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const bia = await enter(rt, BIA, "bia", ["DIR"]);
  assert.equal(goIn(w, rt, bia, PRIV).corrected, false);
  await w.hub.settle();
  assert.equal(bia.last("media.grant")?.d.room_id, PRIV);
  rt.memberChanged(BIA, member(SRV, BIA, []));
  await w.hub.settle();
  assert.equal(rt.desiredRoom(BIA), null);
  assert.equal(bia.last("media.revoked")?.d.room_id, PRIV);
  assert.equal(w.leases.leases.size, 0);
});

test("a role edit that changes what the token allows re-grants with the new sources", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  goIn(w, rt, ana, PUB);
  await w.hub.settle();
  const first = ana.last("media.grant")!.d.identity;
  rt.memberChanged(ANA, member(SRV, ANA, ["VID"]));
  await w.hub.settle();
  assert.deepEqual(ana.last("media.revoked")?.d, { room_id: PUB, reason: "regrant" });
  const g = ana.last("media.grant")!;
  assert.notEqual(g.d.identity, first, "new identity: the old token never matches again");
  assert.deepEqual(g.d.sources, ["microphone", "camera", "screen_share", "screen_share_audio"]);
  assert.equal(w.leases.leases.has(first), false);
  // A change that does not touch the token leaves the grant alone.
  const minted = w.minter.minted.length;
  rt.memberChanged(ANA, member(SRV, ANA, ["VID", "DIR"]));
  await w.hub.settle();
  assert.equal(w.minter.minted.length, minted);
});

test("membership gone while reconnecting: media ends without waiting for the grace", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  goIn(w, rt, ana, PUB);
  await w.hub.settle();
  rt.leave(ana);
  rt.memberChanged(ANA, null);
  await w.hub.settle();
  assert.equal(w.leases.leases.size, 0);
  rt.tick();
  assert.equal(rt.hasAvatar(ANA), false);
});

// ---- disconnects, tabs, requests --------------------------------------------------

test("a socket drop keeps media through the grace; after it the lease goes", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  goIn(w, rt, ana, PUB);
  await w.hub.settle();
  rt.leave(ana);
  w.clock.now += DISCONNECT_GRACE_MS - 1;
  rt.tick();
  await w.hub.settle();
  assert.equal(w.leases.leases.size, 1, "still talking during a WS blip");
  w.clock.now += 2;
  rt.tick();
  await w.hub.settle();
  assert.equal(w.leases.leases.size, 0);
  assert.equal(rt.hasAvatar(ANA), false);
});

test("evict (session ended) revokes at once, before any tick", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  goIn(w, rt, ana, PUB);
  await w.hub.settle();
  rt.evict(ANA);
  await w.hub.settle();
  assert.equal(w.leases.leases.size, 0);
});

test("a new tab gets a token for the same grant; requests reissue it and are rate limited", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  goIn(w, rt, ana, PUB);
  await w.hub.settle();
  const identity = ana.last("media.grant")!.d.identity;

  const tab2 = new FakeSession(ana.viewer);
  rt.join(tab2);
  await w.hub.settle();
  assert.equal(tab2.last("space.snapshot")?.d.you.room, PUB, "keeps the spot");
  assert.equal(tab2.last("media.grant")?.d.identity, identity, "same admission, fresh token");

  assert.equal(rt.requestMedia(tab2), true);
  assert.equal(rt.requestMedia(tab2), false, "second request inside the cooldown");
  await w.hub.settle();
  assert.equal(tab2.of("media.grant").length, 2);
  assert.equal(tab2.last("media.grant")?.d.identity, identity);
  assert.equal(w.leases.calls.filter((c) => c.startsWith("write:")).length, 1, "no new lease");
});

test("LiveKit down at entry: presence stays, the client is told media is unavailable", async () => {
  const w = makeWorld();
  w.lk.failEnsure = new Error("livekit down");
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  goIn(w, rt, ana, PUB);
  await w.hub.settle();
  assert.equal(rt.desiredRoom(ANA), PUB);
  assert.deepEqual(ana.last("media.unavailable")?.d, { room_id: PUB, reason: "livekit" });
  assert.equal(w.leases.leases.size, 0, "half-made grant rolled back");
  // Back up: the client asks again ("Tentar de novo").
  w.lk.failEnsure = null;
  w.clock.now += 5_000;
  assert.equal(rt.requestMedia(ana), true);
  await w.hub.settle();
  assert.equal(ana.last("media.grant")?.d.room_id, PUB);
});

// ---- lease store -------------------------------------------------------------------

test("renewal: a lost lease is granted again; a store outage changes nothing", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  goIn(w, rt, ana, PUB);
  await w.hub.settle();
  const first = ana.last("media.grant")!.d.identity;
  const renewAll = () => (w.hub as unknown as { renewAll(): Promise<void> }).renewAll();

  w.leases.down = true;
  await renewAll();
  await w.hub.settle();
  assert.equal(ana.of("media.grant").length, 1, "no regrant on a Redis blip");
  w.leases.down = false;

  w.leases.leases.clear();
  w.leases.pointers.clear();
  await renewAll();
  await w.hub.settle();
  const g = ana.last("media.grant")!;
  assert.notEqual(g.d.identity, first);
  assert.ok(w.leases.leases.has(g.d.identity));
});

// ---- restart --------------------------------------------------------------------------

test("restart: a surviving lease puts the person back in their room with the same admission", async () => {
  const w1 = makeWorld();
  const rt1 = await space(w1);
  const ana1 = await enter(rt1, ANA, "ana");
  goIn(w1, rt1, ana1, PUB);
  await w1.hub.settle();
  const identity = ana1.last("media.grant")!.d.identity;
  const roomName = w1.leases.leases.get(identity)!.room_name;
  w1.lk.join(roomName, identity); // the call goes on in LiveKit

  // New process: same LiveKit and Redis, fresh memory.
  w1.clock.now += 3_000;
  const w2 = makeWorld({ lk: w1.lk, leases: w1.leases, cache: w1.cache, clock: w1.clock });
  const rt2 = await space(w2);
  const sweeper = new Sweeper({ lk: w2.lk, leases: w2.leases, isCurrentRoom: (n) => w2.hub.isCurrentRoom(n) });
  const ana2 = await enter(rt2, ANA, "ana");
  await w2.hub.settle();
  assert.equal(ana2.last("space.snapshot")?.d.you.room, PUB, "back in the room, not the lobby");
  assert.equal(ana2.last("media.grant")?.d.identity, identity, "same identity: the call never drops");
  const sweep = await sweeper.tick();
  assert.deepEqual(sweep?.removed, [], "the sweeper keeps the adopted participant");

  // The adopted grant behaves like any other: leaving revokes it.
  goOut(w2, rt2, ana2, PUB);
  await w2.hub.settle();
  assert.equal(w2.leases.leases.size, 0);
});

test("restart: the sweeper spares rooms of spaces not reopened yet only during the startup grace", async () => {
  const w = makeWorld();
  const old = managedRoomName(R2, 1_700_000_000_000);
  assert.equal(w.hub.isCurrentRoom(old), true, "within the grace");
  w.clock.now += STARTUP_GRACE_MS + 1;
  assert.equal(w.hub.isCurrentRoom(old), false);
  assert.equal(w.hub.isCurrentRoom("msp_garbage"), false);
});

test("restart: a lease for a room the person may no longer enter is not adopted", async () => {
  const w1 = makeWorld();
  const rt1 = await space(w1);
  const bia1 = await enter(rt1, BIA, "bia", ["DIR"]);
  goIn(w1, rt1, bia1, PRIV);
  await w1.hub.settle();
  assert.equal(w1.leases.leases.size, 1);

  const w2 = makeWorld({ lk: w1.lk, leases: w1.leases, cache: w1.cache, clock: w1.clock });
  const rt2 = await space(w2);
  const bia2 = await enter(rt2, BIA, "bia", []); // lost the role meanwhile
  await w2.hub.settle();
  assert.equal(bia2.last("space.snapshot")?.d.you.room, null, "lobby");
  assert.equal(bia2.of("media.grant").length, 0);
  assert.equal(w2.leases.leases.size, 0, "revoked now, not when it lapses");
});

// ---- two spaces at once ----------------------------------------------------------------

test("two spaces: walking into a room in the second moves the media; background events never steal it back", async () => {
  const w = makeWorld();
  const rtA = await space(w, SRV);
  const rtB = await space(w, SRV2);
  const anaA = await enter(rtA, ANA, "ana");
  const anaB = await enter(rtB, ANA, "ana");
  goIn(w, rtA, anaA, PUB);
  await w.hub.settle();
  const idA = anaA.last("media.grant")!.d.identity;

  goIn(w, rtB, anaB, R2);
  await w.hub.settle();
  assert.deepEqual(anaA.last("media.revoked")?.d, { room_id: PUB, reason: "elsewhere" });
  const idB = anaB.last("media.grant")!.d.identity;
  assert.notEqual(idB, idA);
  assert.equal(w.leases.leases.size, 1, "one lease per person, always");
  assert.equal(w.hub.holderOf(ANA)?.serverId, SRV2);

  // A role edit in space A must not pull the media back.
  rtA.memberChanged(ANA, member(SRV, ANA, ["VID"]));
  await w.hub.settle();
  assert.equal(w.hub.holderOf(ANA)?.serverId, SRV2);
  // Reopening A says where the media is.
  const tabA = new FakeSession(anaA.viewer);
  rtA.join(tabA);
  await w.hub.settle();
  assert.deepEqual(tabA.last("media.unavailable")?.d, { room_id: PUB, reason: "elsewhere" });

  // "Usar aqui" in A takes it back explicitly.
  w.clock.now += 5_000;
  assert.equal(rtA.requestMedia(tabA), true);
  await w.hub.settle();
  assert.equal(w.hub.holderOf(ANA)?.serverId, SRV);
  assert.deepEqual(anaB.last("media.revoked")?.d, { room_id: R2, reason: "elsewhere" });
  assert.equal(w.leases.leases.size, 1);

  // Leaving the room in B (no media there now) touches nothing.
  goOut(w, rtB, anaB, R2);
  await w.hub.settle();
  assert.equal(w.hub.holderOf(ANA)?.serverId, SRV);
});

test("server gone: every grant of that space ends", async () => {
  const w = makeWorld();
  const rt = await space(w);
  const ana = await enter(rt, ANA, "ana");
  goIn(w, rt, ana, PUB);
  await w.hub.settle();
  rt.dispose();
  await w.hub.settle();
  assert.equal(w.leases.leases.size, 0);
  assert.equal(w.hub.grantCount, 0);
});
