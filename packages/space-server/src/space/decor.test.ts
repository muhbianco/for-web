import assert from "node:assert/strict";
import { test } from "node:test";

import { type DecorInstance, indexMap, Perm, roomZoneKey, solidAt, tileCenter } from "@muchat/space-core";

import { silentLog } from "../log.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { MemoryDecorStore } from "./decorStore.ts";
import { type SessionPort, SpaceRuntime, type Viewer } from "./runtime.ts";
import { MemoryAssignmentStore } from "./store.ts";

const SRV = "01JSRV00000000000000000000";
const PUB = "01JPVB00000000000000000000";
const DUO = "01JDV000000000000000000000";
const ANA = "01JANA00000000000000000000"; // owner
const BIA = "01JB1A00000000000000000000"; // role MOD
const CAI = "01JCA100000000000000000000"; // plain member
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
        channels: [PUB, DUO],
        default_permissions: n(DEFAULT),
        roles: { MOD: { name: "Moderação", rank: 1, permissions: { a: 0, d: 0 } } },
      },
    ],
    channels: [
      { channel_type: "TextChannel", _id: PUB, server: SRV, name: "Sala Aberta", voice: { max_users: 8 } },
      { channel_type: "TextChannel", _id: DUO, server: SRV, name: "Duo", voice: { max_users: 2 } },
    ],
  });
  return cache;
}

const user = (id: string, name: string): StoatUser => ({ _id: id, username: name.toLowerCase(), display_name: name });
const member = (id: string, roles: string[] = []): StoatMember => ({ _id: { server: SRV, user: id }, roles });

class FakeSession implements SessionPort {
  readonly events: Array<Record<string, unknown>> = [];
  readonly viewer: Viewer;
  pos = { x: 0, y: 0 };
  seq = 0;
  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }
  send(e: Record<string, unknown>) {
    this.events.push(e);
    if (e.t === "space.snapshot") {
      const you = (e.d as { you: { x: number; y: number; seq: number } }).you;
      this.pos = { x: you.x, y: you.y };
      this.seq = you.seq;
    }
    if (e.t === "avatar.correction") {
      const d = e.d as { x: number; y: number };
      this.pos = { x: d.x, y: d.y };
    }
  }
  close() {}
  of(t: string) {
    return this.events.filter((e) => e.t === t);
  }
  last(t: string) {
    return this.of(t).at(-1);
  }
  errorsFor(re: string) {
    return this.events.filter((e) => e.t === "error" && e.re === re).map((e) => e.d as { code: string; reason?: string });
  }
}

async function space(store = new MemoryDecorStore()) {
  const rt = new SpaceRuntime({ serverId: SRV, cache: makeCache(), store: new MemoryAssignmentStore(), decorStore: store, log: silentLog });
  await rt.init();
  return { rt, store };
}

function enter(rt: SpaceRuntime, id: string, name: string, roles: string[] = []) {
  const s = new FakeSession({ user: user(id, name), member: member(id, roles) });
  rt.join(s);
  return s;
}

/** Runs a command and waits for the queue to drain. */
async function run(rt: SpaceRuntime, s: FakeSession, id: string, cmd: Parameters<SpaceRuntime["decorCommand"]>[2]) {
  rt.decorCommand(s, id, cmd);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const inst = (id: string, item: string, zone: string, x: number, y: number, extra: Partial<DecorInstance> = {}): DecorInstance => ({
  id,
  item,
  zone,
  x,
  y,
  rot: 0,
  ...extra,
});

test("init furnishes the theme once and persists it; a second process reads the same revision", async () => {
  const { rt, store } = await space();
  assert.ok(rt.decorState.items.length > 40);
  assert.equal(rt.decorRev, 1);
  assert.equal((await store.load(SRV))?.rev, 1);
  const again = await space(store);
  assert.equal(again.rt.decorRev, 1);
  assert.equal(again.rt.decorState.items.length, rt.decorState.items.length);
  // The snapshot carries the revision, the URL and the person's rights.
  const ana = enter(rt, ANA, "Ana");
  const snap = ana.last("space.snapshot")!.d as { decor: { rev: number; url: string }; you: { decor: { can_edit: boolean; can_manage: boolean } } };
  assert.equal(snap.decor.rev, 1);
  assert.equal(snap.decor.url, `/_muchat/space/v1/spaces/${SRV}/decor`);
  assert.deepEqual(snap.you.decor, { can_edit: true, can_manage: true });
  const wire = JSON.parse(rt.decorWire) as Record<string, unknown>;
  assert.deepEqual(Object.keys(wire).sort(), ["floors", "items", "rev", "settings"]);
});

test("rights: owner edits and manages; plain members do not; a role setting opens editing to that role", async () => {
  const { rt } = await space();
  const ana = enter(rt, ANA, "Ana");
  const bia = enter(rt, BIA, "Bia", ["MOD"]);
  const cai = enter(rt, CAI, "Cai");
  assert.deepEqual(rt.decorRights(bia.viewer), { can_edit: false, can_manage: false });
  await run(rt, cai, "c1", { kind: "place", item: inst("cai-1", "plant-small", "hall", 0, 0) });
  assert.deepEqual(cai.errorsFor("c1"), [{ code: "not_allowed" }]);
  await run(rt, bia, "b1", { kind: "settings", settings: { editors: "roles", roles: ["MOD"] } });
  assert.deepEqual(bia.errorsFor("b1"), [{ code: "not_allowed" }]);
  await run(rt, ana, "a1", { kind: "settings", settings: { editors: "roles", roles: ["MOD"] } });
  assert.equal(ana.errorsFor("a1").length, 0);
  assert.deepEqual(rt.decorRights(bia.viewer), { can_edit: true, can_manage: false });
  assert.deepEqual(rt.decorRights(cai.viewer), { can_edit: false, can_manage: false });
  assert.deepEqual(bia.last("decor.rights")!.d, { can_edit: true, can_manage: false });
  assert.deepEqual((cai.last("decor.changed")!.d as { op: unknown }).op, { kind: "settings", settings: { editors: "roles", roles: ["MOD"] } });
  await run(rt, ana, "a2", { kind: "settings", settings: { editors: "everyone", roles: [] } });
  assert.deepEqual(rt.decorRights(cai.viewer), { can_edit: true, can_manage: false });
});

test("place, update and remove: validated, persisted with a new revision, told to everyone", async () => {
  const { rt, store } = await space();
  const ana = enter(rt, ANA, "Ana");
  const cai = enter(rt, CAI, "Cai");
  const rev0 = rt.decorRev;
  // The hall's first row holds theme items; a free spot deep in a room is safer.
  const room = rt.map.rooms.find((r) => r.roomId === PUB)!;
  const zone = roomZoneKey(PUB);
  // Clear the room first so the test does not depend on the theme's exact layout.
  for (const i of rt.decorState.items.filter((i) => i.zone === zone)) await run(rt, ana, `rm-${i.id}`, { kind: "remove", id: i.id });
  const chair = inst("chair-01", "chair", zone, 1, 1);
  await run(rt, ana, "p1", { kind: "place", item: chair });
  assert.equal(ana.errorsFor("p1").length, 0);
  const changed = cai.last("decor.changed")!.d as { rev: number; op: { kind: string; item?: DecorInstance }; by: string };
  assert.equal(changed.op.kind, "place");
  assert.deepEqual(changed.op.item, chair);
  assert.equal(changed.by, ANA);
  assert.equal(changed.rev, rt.decorRev);
  assert.ok(rt.decorRev > rev0);
  assert.equal((await store.load(SRV))?.rev, rt.decorRev);
  // Overlap on the same layer is refused with the reason; the state is unchanged.
  await run(rt, ana, "p2", { kind: "place", item: inst("chair-02", "chair", zone, 1, 1) });
  assert.deepEqual(ana.errorsFor("p2"), [{ code: "decor_invalid", reason: "overlap" }]);
  // A move keeps the id and item.
  await run(rt, ana, "u1", { kind: "update", item: { ...chair, x: 2, rot: 2 } });
  assert.equal(ana.errorsFor("u1").length, 0);
  assert.deepEqual(rt.decorState.items.find((i) => i.id === "chair-01"), { ...chair, x: 2, rot: 2 });
  await run(rt, ana, "u2", { kind: "update", item: { ...chair, item: "sofa-2" } });
  assert.deepEqual(ana.errorsFor("u2"), [{ code: "decor_invalid", reason: "unknown_item" }]);
  await run(rt, ana, "r1", { kind: "remove", id: "chair-01" });
  assert.equal(rt.decorState.items.some((i) => i.id === "chair-01"), false);
  await run(rt, ana, "r2", { kind: "remove", id: "chair-01" });
  assert.deepEqual(ana.errorsFor("r2"), [{ code: "not_found" }]);
  // Floors: a valid reference, back to default, an unknown floor.
  await run(rt, ana, "f1", { kind: "floor", zone, floor: "floor-gamer:ciano" });
  assert.equal(rt.decorState.floors[zone], "floor-gamer:ciano");
  await run(rt, ana, "f2", { kind: "floor", zone, floor: null });
  assert.equal(rt.decorState.floors[zone], undefined);
  await run(rt, ana, "f3", { kind: "floor", zone, floor: "sofa-2" });
  assert.deepEqual(ana.errorsFor("f3"), [{ code: "decor_invalid", reason: "unknown_item" }]);
  await run(rt, ana, "f4", { kind: "floor", zone, floor: "floor-wood:neon" });
  assert.deepEqual(ana.errorsFor("f4"), [{ code: "decor_invalid", reason: "bad_config" }]);
  assert.ok(room);
});

test("solid furniture blocks movement and nudges whoever stood there", async () => {
  const { rt } = await space();
  const ana = enter(rt, ANA, "Ana");
  const zone = roomZoneKey(PUB);
  for (const i of rt.decorState.items.filter((i) => i.zone === zone)) await run(rt, ana, `rm-${i.id}`, { kind: "remove", id: i.id });
  const room = rt.map.rooms.find((r) => r.roomId === PUB)!;
  // Put Ana in the middle of the room (as the server would after a teleport).
  const mid = { tx: room.interior.x0 + 3, ty: room.interior.y0 + 3 };
  (rt as unknown as { place: (a: unknown, p: { x: number; y: number }, room: string | null) => void }).place(
    (rt as unknown as { avatars: Map<string, unknown> }).avatars.get(ANA),
    tileCenter(mid),
    PUB,
  );
  ana.pos = tileCenter(mid);
  await run(rt, ana, "p1", { kind: "place", item: inst("tab-01", "table-round", zone, 3, 3) });
  assert.equal(ana.errorsFor("p1").length, 0);
  const ix = indexMap(rt.map);
  assert.equal(solidAt(ix, mid.tx, mid.ty), false, "a fresh index has no furniture");
  // Ana was moved off the table.
  const corr = ana.last("avatar.correction")!.d as { x: number; y: number; room: string | null; reason: string };
  assert.equal(corr.reason, "moved");
  assert.equal(corr.room, PUB, "she stays in the room");
  const t = { tx: Math.floor(corr.x / 32), ty: Math.floor(corr.y / 32) };
  assert.ok(t.tx < 3 + room.interior.x0 || t.tx > 4 + room.interior.x0 || t.ty < 3 + room.interior.y0 || t.ty > 4 + room.interior.y0);
  // Walking back onto the table is corrected by the server.
  const before = ana.of("avatar.correction").length;
  rt.move(ana, { seq: ++ana.seq, x: tileCenter(mid).x, y: tileCenter(mid).y, dir: "up", moving: true });
  assert.equal(ana.of("avatar.correction").length, before + 1);
});

test("a portal takes the person next to it to its target; from afar it does nothing", async () => {
  const { rt } = await space();
  const ana = enter(rt, ANA, "Ana");
  const cai = enter(rt, CAI, "Cai");
  const spawn = rt.map.spawns[0]!;
  // The portal lies right next to Ana's spawn (the theme's rug covers the spawn itself); its target is the Duo room.
  const portal = inst("portal-1", "portal-pad", "hall", spawn.tx - 1 - rt.map.hall.x0, spawn.ty - rt.map.hall.y0, { config: { target: roomZoneKey(DUO) } });
  await run(rt, ana, "p1", { kind: "place", item: portal });
  assert.equal(ana.errorsFor("p1").length, 0);
  // Cai spawned on another spawn: too far unless it is a neighbour.
  const caiTile = { tx: Math.floor(cai.pos.x / 32), ty: Math.floor(cai.pos.y / 32) };
  const near = Math.abs(caiTile.tx - spawn.tx) <= 1 && Math.abs(caiTile.ty - spawn.ty) <= 1;
  rt.teleport(cai, "t0", "portal-1");
  await settle();
  if (!near) assert.deepEqual(cai.errorsFor("t0"), [{ code: "not_allowed", reason: "too_far" }]);
  // Ana stands on it.
  rt.teleport(ana, "t1", "portal-1");
  await settle();
  assert.equal(ana.errorsFor("t1").length, 0);
  const corr = ana.last("avatar.correction")!.d as { room: string | null };
  assert.equal(corr.room, DUO);
  // Duo holds 2: a third person is refused at the door.
  const bia = enter(rt, BIA, "Bia");
  (rt as unknown as { place: (a: unknown, p: { x: number; y: number }, room: string | null) => void }).place(
    (rt as unknown as { avatars: Map<string, unknown> }).avatars.get(BIA),
    tileCenter(rt.map.rooms.find((r) => r.roomId === DUO)!.inside),
    DUO,
  );
  const cai2 = enter(rt, "01JCA200000000000000000000", "Cai2");
  (rt as unknown as { place: (a: unknown, p: { x: number; y: number }, room: string | null) => void }).place(
    (rt as unknown as { avatars: Map<string, unknown> }).avatars.get("01JCA200000000000000000000"),
    tileCenter(spawn),
    null,
  );
  rt.teleport(cai2, "t2", "portal-1");
  await settle();
  assert.deepEqual(cai2.errorsFor("t2"), [{ code: "not_allowed" }]);
  rt.teleport(cai2, "t3", "nope-0000");
  await settle();
  assert.deepEqual(cai2.errorsFor("t3"), [{ code: "not_found" }]);
});

test("a CAS conflict reloads the other writer's state and tells everyone to refetch", async () => {
  const store = new MemoryDecorStore();
  const { rt } = await space(store);
  const ana = enter(rt, ANA, "Ana");
  // Someone else (another process) wrote a newer revision behind our back.
  const foreign = { ...(await store.load(SRV))!, rev: rt.decorRev + 5, floors: { hall: "floor-tatami" } };
  store.docs.set(SRV, foreign);
  await run(rt, ana, "p1", { kind: "place", item: inst("plant-x1", "plant-small", "hall", 5, 0) });
  assert.deepEqual(ana.errorsFor("p1"), [{ code: "conflict" }]);
  assert.equal(rt.decorRev, foreign.rev);
  assert.equal(rt.decorState.floors.hall, "floor-tatami");
  assert.deepEqual((ana.last("decor.changed")!.d as { op: unknown }).op, { kind: "reset" });
});
