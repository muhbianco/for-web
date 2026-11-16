import assert from "node:assert/strict";
import { test } from "node:test";

import { expectedPosition, Perm, roomZoneKey, tileCenter, type TvState } from "@muchat/space-core";

import { silentLog } from "../log.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { MemoryDecorStore } from "./decorStore.ts";
import { type SessionPort, SpaceRuntime, type Viewer } from "./runtime.ts";
import { MemoryAssignmentStore } from "./store.ts";
import { MemoryTvStore, TV_EMPTY_OFF_MS } from "./tv.ts";

// Cenário A da matriz da fase 4 (ADR 0008), lado do servidor: a TV de cada
// sala, uma sessão por vez, permissões do Stoat por sala, rev, intervalo.

const SRV = "01JSRV00000000000000000000";
const PUB = "01JPVB00000000000000000000"; // M: TV by the theme
const DUO = "01JDV000000000000000000000"; // S: TV on the wall; @everyone may not control here
const ANA = "01JANA00000000000000000000"; // owner
const BIA = "01JB1A00000000000000000000";
const CAI = "01JCA100000000000000000000";
const GIL = "01JG1L00000000000000000000"; // role TVM: manages TVs
const VID = "dQw4w9WgXcQ";
const VID2 = "9bZkp7q19f0";
const n = (b: bigint) => Number(b);
const DEFAULT =
  Perm.ViewChannel | Perm.ReadMessageHistory | Perm.SendMessage | Perm.Connect | Perm.Speak | Perm.Listen |
  Perm.InteractSpaceObjects | Perm.ControlSpaceTv;

function makeCache(): StoatCache {
  const cache = new StoatCache();
  cache.apply({
    type: "Ready",
    servers: [
      {
        _id: SRV,
        owner: ANA,
        name: "Piloto",
        channels: [PUB, DUO],
        default_permissions: n(DEFAULT),
        roles: {
          TVM: { name: "TV", rank: 1, permissions: { a: n(Perm.ManageSpaceTvs), d: 0 } },
          BLIND: { name: "Sem TV", rank: 2, permissions: { a: 0, d: n(Perm.InteractSpaceObjects | Perm.ControlSpaceTv) } },
        },
      },
    ],
    channels: [
      { channel_type: "TextChannel", _id: PUB, server: SRV, name: "Sala Aberta", voice: { max_users: 8 } },
      {
        channel_type: "TextChannel",
        _id: DUO,
        server: SRV,
        name: "Duo",
        voice: { max_users: 4 },
        // In this room @everyone watches but does not control the TV.
        default_permissions: { a: 0, d: n(Perm.ControlSpaceTv) },
      },
    ],
  });
  return cache;
}

class FakeSession implements SessionPort {
  readonly viewer: Viewer;
  readonly events: Array<Record<string, any>> = [];
  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }
  send(e: Record<string, unknown>) {
    this.events.push(e as Record<string, any>);
  }
  close() {}
  tv(room: string): Record<string, any> | undefined {
    return this.events.filter((e) => e.t === "tv.state" && e.d.room_id === room).at(-1)?.d;
  }
  error(re: string) {
    return this.events.find((e) => e.t === "error" && e.re === re)?.d;
  }
}

const user = (id: string, name: string): StoatUser => ({ _id: id, username: name });
const member = (id: string, roles: string[] = []): StoatMember => ({ _id: { server: SRV, user: id }, roles });

async function world(opts: { tvStore?: MemoryTvStore; decorStore?: MemoryDecorStore; clock?: { now: number } } = {}) {
  const clock = opts.clock ?? { now: 1_800_000_000_000 };
  const tvStore = opts.tvStore ?? new MemoryTvStore();
  const decorStore = opts.decorStore ?? new MemoryDecorStore();
  const rt = new SpaceRuntime({
    serverId: SRV,
    cache: makeCache(),
    store: new MemoryAssignmentStore(),
    decorStore,
    tvStore,
    log: silentLog,
    now: () => clock.now,
  });
  await rt.init();
  return { rt, clock, tvStore, decorStore };
}

function enter(rt: SpaceRuntime, id: string, name: string, roles: string[] = []) {
  const s = new FakeSession({ user: user(id, name), member: member(id, roles) });
  rt.join(s);
  return s;
}

/** Puts someone inside a room the way the server would (teleport-like placement). */
function putIn(rt: SpaceRuntime, s: FakeSession, roomId: string | null) {
  const internals = rt as unknown as {
    avatars: Map<string, unknown>;
    place: (a: unknown, pos: { x: number; y: number }, room: string | null) => void;
  };
  const a = internals.avatars.get(s.viewer.user._id);
  const room = roomId ? rt.index.roomsById.get(roomId)! : null;
  const pos = room ? tileCenter(room.inside) : tileCenter(rt.map.spawns[0]!);
  internals.place(a, pos, roomId);
}

const cmd = (rt: SpaceRuntime, s: FakeSession, id: string, c: Parameters<SpaceRuntime["tvCommand"]>[2]) => rt.tvCommand(s, id, c);

test("A: every room has its own TV; choosing a video reaches everyone in that room and nobody else", async () => {
  const { rt } = await world();
  assert.equal(rt.hasTv(PUB), true, "the theme gives the M room a TV");
  assert.equal(rt.hasTv(DUO), true, "and the S room one on the wall");
  const ana = enter(rt, ANA, "Ana");
  const bia = enter(rt, BIA, "Bia");
  const cai = enter(rt, CAI, "Caio");
  putIn(rt, ana, PUB);
  putIn(rt, bia, PUB);
  assert.deepEqual(bia.tv(PUB)?.state, null, "entering, the room's TV state (off) arrives");
  assert.equal(bia.tv(PUB)?.you.control, true);

  cmd(rt, ana, "l1", { t: "tv.load", room_id: PUB, base_rev: 0, app: "youtube", ref: VID });
  const s = bia.tv(PUB)!.state as TvState;
  assert.equal(s.ref, VID);
  assert.equal(s.status, "playing");
  assert.equal(s.pos_s, 0);
  assert.equal(s.started_by, ANA);
  assert.equal(s.by_name, "Ana");
  assert.equal(cai.tv(PUB), undefined, "someone outside the room gets nothing");

  // Not in the room: refused, whatever the client claims.
  cmd(rt, cai, "c1", { t: "tv.pause", room_id: PUB, base_rev: s.rev, pos_s: 3 });
  assert.equal(cai.error("c1")?.reason, "not_in_room");
});

test("A: play, pause, seek move one shared state; a command from an older state is refused (stale_rev)", async () => {
  const { rt, clock } = await world();
  const ana = enter(rt, ANA, "Ana");
  const bia = enter(rt, BIA, "Bia");
  putIn(rt, ana, PUB);
  putIn(rt, bia, PUB);
  cmd(rt, ana, "l1", { t: "tv.load", room_id: PUB, base_rev: 0, app: "youtube", ref: VID });
  const r1 = rt.tv.state(PUB)!.rev;
  clock.now += 10_000;
  cmd(rt, bia, "p1", { t: "tv.pause", room_id: PUB, base_rev: r1, pos_s: 10.2 });
  let s = ana.tv(PUB)!.state as TvState;
  assert.equal(s.status, "paused");
  assert.equal(s.pos_s, 10.2);
  assert.equal(s.by, BIA);
  // Ana still thinks it is r1: her play is refused and she gets the current state.
  cmd(rt, ana, "x1", { t: "tv.play", room_id: PUB, base_rev: r1, pos_s: 10.2 });
  assert.equal(ana.error("x1")?.code, "stale_rev");
  assert.equal((ana.tv(PUB)!.state as TvState).rev, s.rev);
  cmd(rt, ana, "p2", { t: "tv.seek", room_id: PUB, base_rev: s.rev, pos_s: 60 });
  s = bia.tv(PUB)!.state as TvState;
  assert.equal(s.pos_s, 60);
  assert.equal(s.status, "paused", "seek keeps the status");
  clock.now += 1_000;
  cmd(rt, bia, "p3", { t: "tv.play", room_id: PUB, base_rev: s.rev, pos_s: 60 });
  s = ana.tv(PUB)!.state as TvState;
  assert.equal(s.status, "playing");
  assert.equal(s.ref_ms, clock.now, "the position runs from the server's clock");
});

test("A/E: permissions per room — no control in Duo, no TV at all without InteractSpaceObjects; bad links refused", async () => {
  const { rt } = await world();
  const ana = enter(rt, ANA, "Ana");
  const bia = enter(rt, BIA, "Bia");
  const dan = enter(rt, "01JDAN00000000000000000000", "Dan", ["BLIND"]);
  putIn(rt, ana, DUO);
  putIn(rt, bia, DUO);
  putIn(rt, dan, DUO);
  assert.equal(bia.tv(DUO)?.you.control, false, "the room's override takes control away");
  assert.equal(bia.tv(DUO)?.you.watch, true);
  cmd(rt, bia, "b1", { t: "tv.load", room_id: DUO, base_rev: 0, app: "youtube", ref: VID });
  assert.equal(bia.error("b1")?.code, "not_allowed");
  cmd(rt, ana, "a1", { t: "tv.load", room_id: DUO, base_rev: 0, app: "youtube", ref: "javascript:alert(1)" });
  assert.equal(ana.error("a1")?.reason, "bad_ref", "only a valid id is ever stored");
  cmd(rt, ana, "a2", { t: "tv.load", room_id: DUO, base_rev: 0, app: "youtube", ref: VID });
  assert.equal((bia.tv(DUO)!.state as TvState).ref, VID, "the owner controls (ManageServer)");
  assert.equal(dan.tv(DUO)!.state, null, "without InteractSpaceObjects the video is not even sent");
  assert.equal(dan.tv(DUO)!.you.watch, false);
});

test("A: one at a time — the interval blocks another video (not the same one); TV managers skip it; stop rules", async () => {
  const { rt, clock } = await world();
  const ana = enter(rt, ANA, "Ana");
  const bia = enter(rt, BIA, "Bia");
  const gil = enter(rt, GIL, "Gil", ["TVM"]);
  for (const s of [ana, bia, gil]) putIn(rt, s, PUB);
  // The owner sets a 5-minute interval (space settings).
  rt.decorCommand(ana, "s1", { kind: "settings", settings: { editors: "admins", roles: [], tv_cooldown_s: 300 } });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(rt.cooldownS(), 300);
  cmd(rt, bia, "b1", { t: "tv.load", room_id: PUB, base_rev: 0, app: "youtube", ref: VID });
  let rev = rt.tv.state(PUB)!.rev;
  clock.now += 60_000;
  cmd(rt, bia, "b2", { t: "tv.load", room_id: PUB, base_rev: rev, app: "youtube", ref: VID2 });
  assert.equal(bia.error("b2")?.code, "tv_cooldown");
  assert.equal(bia.error("b2")?.retry_after_ms, 240_000);
  cmd(rt, bia, "b3", { t: "tv.load", room_id: PUB, base_rev: rev, app: "youtube", ref: VID });
  assert.equal(bia.error("b3"), undefined, "restarting the same video is not a new one");
  rev = rt.tv.state(PUB)!.rev;
  cmd(rt, gil, "g1", { t: "tv.load", room_id: PUB, base_rev: rev, app: "youtube", ref: VID2 });
  assert.equal(rt.tv.state(PUB)!.ref, VID2, "ManageSpaceTvs skips the interval");
  rev = rt.tv.state(PUB)!.rev;
  // Stop: only whoever chose it (Gil now) or a manager.
  cmd(rt, bia, "b4", { t: "tv.stop", room_id: PUB, base_rev: rev });
  assert.equal(bia.error("b4")?.code, "not_allowed");
  cmd(rt, gil, "g2", { t: "tv.stop", room_id: PUB, base_rev: rev });
  assert.equal(rt.tv.state(PUB), null);
  assert.equal(bia.tv(PUB)!.state, null, "everyone in the room sees it off");
  // A new video after a stop gets a rev never used before (no stale command matches).
  cmd(rt, ana, "a1", { t: "tv.load", room_id: PUB, base_rev: 0, app: "youtube", ref: VID });
  assert.ok(rt.tv.state(PUB)!.rev > rev);
});

test("A: who comes in later, or back, joins where the video is; an empty room pauses, then turns off", async () => {
  const { rt, clock } = await world();
  const ana = enter(rt, ANA, "Ana");
  const bia = enter(rt, BIA, "Bia");
  putIn(rt, ana, PUB);
  cmd(rt, ana, "l1", { t: "tv.load", room_id: PUB, base_rev: 0, app: "youtube", ref: VID });
  const started = rt.tv.state(PUB)!;
  clock.now += 42_000;
  putIn(rt, bia, PUB);
  const late = bia.tv(PUB)!.state as TvState;
  assert.equal(late.rev, started.rev);
  assert.equal(expectedPosition(late, clock.now), 42, "the newcomer starts 42 s in, like everyone else");
  putIn(rt, bia, null);
  putIn(rt, bia, PUB);
  assert.equal((bia.tv(PUB)!.state as TvState).ref, VID, "back in the room: same session");

  // Everybody leaves: paused at the right position on the next tick.
  putIn(rt, ana, null);
  putIn(rt, bia, null);
  clock.now += 8_000;
  rt.tv.tick();
  const paused = rt.tv.state(PUB)!;
  assert.equal(paused.status, "paused");
  assert.equal(paused.pos_s, 50, "42 s + 8 s");
  clock.now += TV_EMPTY_OFF_MS;
  rt.tv.tick();
  assert.equal(rt.tv.state(PUB), null, "off after 30 min empty");
});

test("A: the TV survives a restart; removing the room's last TV object turns it off; no TV outside rooms", async () => {
  const tvStore = new MemoryTvStore();
  const decorStore = new MemoryDecorStore();
  const first = await world({ tvStore, decorStore });
  const ana = enter(first.rt, ANA, "Ana");
  putIn(first.rt, ana, PUB);
  cmd(first.rt, ana, "l1", { t: "tv.load", room_id: PUB, base_rev: 0, app: "youtube", ref: VID });
  await first.rt.tv.settle();
  const again = await world({ tvStore, decorStore, clock: first.clock });
  assert.equal(again.rt.tv.state(PUB)?.ref, VID, "restored from the store");

  const rt = again.rt;
  const owner = enter(rt, ANA, "Ana");
  putIn(rt, owner, PUB);
  for (const i of rt.decorState.items.filter((i) => i.zone === roomZoneKey(PUB) && ["tv-stand", "tv-wall", "projector-screen"].includes(i.item))) {
    rt.decorCommand(owner, `rm-${i.id}`, { kind: "remove", id: i.id });
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(rt.hasTv(PUB), false);
  assert.equal(rt.tv.state(PUB), null, "TV off with its last object gone");
  assert.equal(owner.tv(PUB)!.has_tv, false);
  cmd(rt, owner, "l2", { t: "tv.load", room_id: PUB, base_rev: 0, app: "youtube", ref: VID });
  assert.equal(owner.error("l2")?.code, "no_tv");

  rt.decorCommand(owner, "hall-tv", { kind: "place", item: { id: "tv-hall-01", item: "tv-stand", zone: "hall", x: 1, y: 1, rot: 0 } });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(owner.error("hall-tv"), { code: "decor_invalid", reason: "tv_outside_room" });
});
