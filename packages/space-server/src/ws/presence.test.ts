import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { findPath, MAX_SPEED, MOVE_SEND_HZ, Perm, tileCenter } from "@muchat/space-core";
import WebSocket from "ws";

import { silentLog } from "../log.ts";
import { MemoryProfileStore } from "../space/profiles.ts";
import { Registry } from "../space/registry.ts";
import { DISCONNECT_GRACE_MS } from "../space/runtime.ts";
import { MemoryAssignmentStore } from "../space/store.ts";
import type { AuthResult, MemberResult, StoatAuth, StoatMembers } from "../stoat/api.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { Gateway } from "./gateway.ts";

// Presence (ADR 0008, cenário C da matriz da fase 4) over real WebSockets:
// who is in the space, inside which room, as each viewer may see it; the
// watch-only session of the sidebar; disconnects and the reconnect grace.

const SRV = "01JSRV00000000000000000000";
const PUB = "01JPVB00000000000000000000";
const PRIV = "01JPRV00000000000000000000";
const n = (b: bigint) => Number(b);
const DEFAULT = Perm.ViewChannel | Perm.ReadMessageHistory | Perm.SendMessage | Perm.Connect | Perm.Speak | Perm.Listen;

const ANA = "01JANA00000000000000000000";
const BIA = "01JB1A00000000000000000000";
const CAI = "01JCA100000000000000000000";
const users: Record<string, StoatUser> = {
  "token-ana-0000000000": { _id: ANA, username: "ana", display_name: "Ana" },
  "token-bia-0000000000": { _id: BIA, username: "bia", display_name: "Bia" },
  "token-cai-0000000000": { _id: CAI, username: "cai", display_name: "Caio" },
};
const roles: Record<string, string[]> = { [ANA]: [], [BIA]: ["DIR"], [CAI]: [] };
const notMember = new Set<string>();

const auth: StoatAuth = {
  async me(token): Promise<AuthResult> {
    const user = users[token];
    return user ? { kind: "ok", user } : { kind: "invalid" };
  },
};
const memberSrc: StoatMembers = {
  async member(_server, userId): Promise<MemberResult> {
    if (notMember.has(userId) || !(userId in roles)) return { kind: "not_member" };
    const m: StoatMember = { _id: { server: SRV, user: userId }, roles: roles[userId] };
    return { kind: "ok", member: m };
  },
};

let clock = 1_800_000_000_000;
const cache = new StoatCache();
cache.apply({
  type: "Ready",
  servers: [
    {
      _id: SRV,
      owner: "01J0WNER000000000000000000",
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
const registry = new Registry({ cache, store: new MemoryAssignmentStore(), members: memberSrc, log: silentLog, now: () => clock });
const gateway = new Gateway({
  auth,
  members: memberSrc,
  cache,
  runtimes: registry,
  profiles: new MemoryProfileStore(),
  allowedOrigins: [],
  log: silentLog,
  rateLimit: { rate: 2_000, burst: 400 },
});
let base = "";

before(async () => {
  await gateway.listen(0, "127.0.0.1");
  base = `127.0.0.1:${gateway.address.port}`;
});
after(async () => {
  await gateway.close();
});

interface Client {
  ws: WebSocket;
  msgs: Array<Record<string, any>>;
  closed: Promise<number>;
  send(obj: unknown): void;
  wait(pred: (m: Record<string, any>) => boolean, ms?: number): Promise<Record<string, any>>;
  /** Latest presence received. */
  presence(): Record<string, any> | undefined;
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/v1/ws`);
    const msgs: Array<Record<string, any>> = [];
    const waiters: Array<{ pred: (m: Record<string, any>) => boolean; done: (m: Record<string, any>) => void }> = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      msgs.push(m);
      for (const w of [...waiters]) if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.done(m);
      }
    });
    const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
    ws.on("error", (e) => reject(e));
    ws.on("open", () =>
      resolve({
        ws,
        msgs,
        closed,
        send: (obj) => ws.send(JSON.stringify(obj)),
        wait: (pred, ms = 3_000) =>
          new Promise((res, rej) => {
            const hit = msgs.find(pred);
            if (hit) return res(hit);
            const t = setTimeout(() => rej(new Error("timeout waiting for message")), ms);
            waiters.push({ pred, done: (m) => (clearTimeout(t), res(m)) });
          }),
        presence: () => msgs.filter((m) => m.t === "space.presence").at(-1),
      }),
    );
  });
}

const hello = (token: string, mode?: "play" | "observe") => ({
  v: 1,
  t: "hello",
  id: "h1",
  d: { session_token: token, server_id: SRV, client: "web", ...(mode ? { mode } : {}) },
});

async function play(token: string) {
  const c = await connect();
  c.send(hello(token));
  const snap = await c.wait((m) => m.t === "space.snapshot");
  return { c, snap };
}

async function observe(token: string) {
  const c = await connect();
  c.send(hello(token, "observe"));
  await c.wait((m) => m.t === "hello.ok" && m.d.mode === "observe");
  await c.wait((m) => m.t === "space.presence");
  return c;
}

/**
 * The presence this client holds once the server caught up: the server's
 * clock is moved past the 250 ms floor, so the next tick (100 ms, real time)
 * sends whatever changed. A message from before the call never counts: the
 * last one received only stands once a few ticks passed with nothing newer.
 */
async function nextPresence(c: Client, pred: (d: Record<string, any>) => boolean, ms = 3_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const from = c.msgs.length;
    clock += 1_100;
    await new Promise((r) => setTimeout(r, 350));
    const fresh = c.msgs.slice(from).filter((m) => m.t === "space.presence");
    const latest = fresh.at(-1) ?? (fresh.length === 0 ? c.presence() : undefined);
    if (latest && pred(latest.d)) return latest.d;
  }
  throw new Error("timeout waiting for presence");
}

const inRoom = (d: Record<string, any>, room: string, user: string) =>
  d.rooms.some((r: any) => r.room_id === room && r.people.some((p: any) => p.user_id === user));
const outside = (d: Record<string, any>, user: string) => d.outside.some((p: any) => p.user_id === user);
const anywhere = (d: Record<string, any>, user: string) =>
  outside(d, user) || d.rooms.some((r: any) => r.people.some((p: any) => p.user_id === user));

/** Walks a play client into a room along the server's own path. */
async function walkInto(c: Client, snap: Record<string, any>, roomId: string, tag: string) {
  const rt = (await registry.get(SRV))!;
  const ix = rt.index;
  const room = ix.roomsById.get(roomId)!;
  const me = snap.d.you;
  const startTile = { tx: Math.floor(me.x / 32), ty: Math.floor(me.y / 32) };
  const path = findPath(ix, startTile, room.inside, () => true)!;
  const moves: Array<{ x: number; y: number }> = [];
  let pos = { x: me.x, y: me.y };
  const step = MAX_SPEED / MOVE_SEND_HZ;
  for (const tile of path.slice(1)) {
    const goal = tileCenter(tile);
    while (Math.hypot(goal.x - pos.x, goal.y - pos.y) > 0.5) {
      const d = Math.hypot(goal.x - pos.x, goal.y - pos.y);
      const k = Math.min(1, step / d);
      pos = { x: Math.round(pos.x + (goal.x - pos.x) * k), y: Math.round(pos.y + (goal.y - pos.y) * k) };
      moves.push(pos);
    }
  }
  let seq = me.seq;
  for (let i = 0; i < moves.length; i += 6) {
    const batch = moves.slice(i, i + 6);
    clock += (batch.length * 1000) / MOVE_SEND_HZ;
    for (const m of batch) c.send({ v: 1, t: "avatar.move", seq: ++seq, d: { x: m.x, y: m.y, dir: "up", moving: true } });
    const id = `${tag}${i}`;
    c.send({ v: 1, t: "ping", id });
    await c.wait((m) => m.t === "pong" && m.re === id);
  }
  return { seq, pos };
}

test("C1–C4: the sidebar (watch-only) sees who enters the space and which room; it is never counted itself", async () => {
  const side = await observe("token-cai-0000000000");
  const first = side.presence()!.d;
  assert.equal(anywhere(first, CAI), false, "a watcher is not in the space");

  const { c: ana, snap } = await play("token-ana-0000000000");
  let d = await nextPresence(side, (x) => outside(x, ANA));
  assert.equal(d.outside.find((p: any) => p.user_id === ANA).name, "Ana");
  assert.equal(d.outside.find((p: any) => p.user_id === ANA).state, "online");

  await walkInto(ana, snap, PUB, "a");
  d = await nextPresence(side, (x) => inRoom(x, PUB, ANA));
  const person = d.rooms.find((r: any) => r.room_id === PUB).people[0];
  assert.equal(person.voice, null, "no media in this setup: inside the room, not in its call");
  assert.equal(outside(d, ANA), false);

  // The map session gets the same presence (names for its room list).
  const own = await nextPresence(ana, (x) => inRoom(x, PUB, ANA));
  assert.ok(own);

  // A watch-only session cannot act in the space.
  side.send({ v: 1, t: "avatar.move", seq: 1, d: { x: 0, y: 0, dir: "up", moving: true } });
  const err = await side.wait((m) => m.t === "error");
  assert.equal(err.d.code, "not_allowed");

  ana.ws.close();
  side.ws.close();
  await Promise.all([ana.closed, side.closed]);
});

test("C6–C7: a dropped connection shows as reconnecting, then leaves after the grace; coming back restores the room", async () => {
  const side = await observe("token-cai-0000000000");
  const { c: ana, snap } = await play("token-ana-0000000000");
  // Within the grace of an earlier test Ana may still be inside PUB.
  if (snap.d.you.room !== PUB) await walkInto(ana, snap, PUB, "c");
  await nextPresence(side, (x) => inRoom(x, PUB, ANA));
  ana.ws.terminate();
  let d = await nextPresence(side, (x) => x.rooms.some((r: any) => r.people.some((p: any) => p.user_id === ANA && p.state === "reconnecting")));
  assert.ok(d, "reconnecting, still inside the room during the grace");

  const { c: back } = await play("token-ana-0000000000");
  d = await nextPresence(side, (x) => x.rooms.some((r: any) => r.people.some((p: any) => p.user_id === ANA && p.state === "online")));
  assert.ok(inRoom(d, PUB, ANA), "back in the same room");

  back.ws.terminate();
  // The server notices the drop asynchronously: only then may the clock run.
  await nextPresence(side, (x) => x.rooms.some((r: any) => r.people.some((p: any) => p.user_id === ANA && p.state === "reconnecting")));
  clock += DISCONNECT_GRACE_MS + 1_000;
  d = await nextPresence(side, (x) => !anywhere(x, ANA));
  assert.equal(anywhere(d, ANA), false, "gone after the grace");
  side.ws.close();
  await side.closed;
});

test("C5/E: a private room is invisible to who cannot view it, people inside included", async () => {
  const side = await observe("token-cai-0000000000"); // no DIR role
  const boss = await observe("token-ana-0000000000");
  roles[ANA] = ["DIR"];
  cache.apply({ type: "ServerMemberUpdate", id: { server: SRV, user: ANA }, data: { roles: ["DIR"] }, clear: [] });
  await new Promise((r) => setTimeout(r, 50));
  const { c: bia, snap } = await play("token-bia-0000000000");
  await walkInto(bia, snap, PRIV, "b");
  const seen = await nextPresence(boss, (x) => inRoom(x, PRIV, BIA));
  assert.ok(seen, "a DIR member sees Bia inside the private room");
  clock += 1_100;
  await new Promise((r) => setTimeout(r, 250));
  const d = side.presence()!.d;
  assert.equal(d.rooms.some((r: any) => r.room_id === PRIV), false, "no trace of the private room");
  assert.equal(anywhere(d, BIA), false, "nor of who is inside it");

  // Losing the role mid-session hides it on the next presence.
  roles[ANA] = [];
  cache.apply({ type: "ServerMemberUpdate", id: { server: SRV, user: ANA }, data: { roles: [] }, clear: [] });
  const after = await nextPresence(boss, (x) => !x.rooms.some((r: any) => r.room_id === PRIV));
  assert.equal(anywhere(after, BIA), false);
  bia.ws.close();
  side.ws.close();
  boss.ws.close();
  await Promise.all([bia.closed, side.closed, boss.closed]);
});

test("watchers are bounded per person (oldest closes 4001) and follow membership (4403)", async () => {
  const w1 = await observe("token-cai-0000000000");
  const w2 = await observe("token-cai-0000000000");
  const w3 = await observe("token-cai-0000000000");
  const w4 = await observe("token-cai-0000000000");
  assert.equal(await w1.closed, 4001);
  notMember.add(CAI);
  cache.apply({ type: "ServerMemberLeave", id: SRV, user: CAI });
  const codes = await Promise.all([w2.closed, w3.closed, w4.closed]);
  assert.deepEqual(codes, [4403, 4403, 4403]);
  notMember.delete(CAI);
});

test("a second map tab is told it was replaced before the 4001", async () => {
  const { c: first } = await play("token-cai-0000000000");
  const { c: second } = await play("token-cai-0000000000");
  await first.wait((m) => m.t === "session.replaced");
  assert.equal(await first.closed, 4001);
  second.ws.close();
  await second.closed;
});
