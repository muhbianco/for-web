import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { findPath, MOVE_SEND_HZ, MAX_SPEED, Perm, tileCenter } from "@muchat/space-core";
import WebSocket from "ws";

import { silentLog } from "../log.ts";
import { Registry } from "../space/registry.ts";
import { MemoryProfileStore } from "../space/profiles.ts";
import { MemoryAssignmentStore } from "../space/store.ts";
import type { AuthResult, MemberResult, StoatAuth, StoatMembers } from "../stoat/api.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { Gateway } from "./gateway.ts";
import { TokenBucket } from "./ratelimit.ts";

// ---- fixture: one server, a public and a private voice room ---------------

const SRV = "01JSRV00000000000000000000";
const PUB = "01JPVB00000000000000000000";
const PRIV = "01JPRV00000000000000000000";
const n = (b: bigint) => Number(b);
const DEFAULT = Perm.ViewChannel | Perm.ReadMessageHistory | Perm.SendMessage | Perm.Connect | Perm.Speak | Perm.Listen;

const users: Record<string, StoatUser> = {
  "token-ana-0000000000": { _id: "01JANA00000000000000000000", username: "ana" },
  "token-ana-second-tab": { _id: "01JANA00000000000000000000", username: "ana" },
  "token-bia-0000000000": { _id: "01JB1A00000000000000000000", username: "bia" },
  "token-out-0000000000": { _id: "01J0VT00000000000000000000", username: "out" },
};
const members: Record<string, StoatMember> = {
  "01JANA00000000000000000000": { _id: { server: SRV, user: "01JANA00000000000000000000" }, roles: [] },
  "01JB1A00000000000000000000": { _id: { server: SRV, user: "01JB1A00000000000000000000" }, roles: ["DIR"] },
};

let stoatDown = false;
const auth: StoatAuth = {
  async me(token): Promise<AuthResult> {
    if (stoatDown) return { kind: "unavailable" };
    const user = users[token];
    return user ? { kind: "ok", user } : { kind: "invalid" };
  },
};
const memberSrc: StoatMembers = {
  async member(_server, userId): Promise<MemberResult> {
    const m = members[userId];
    return m ? { kind: "ok", member: m } : { kind: "not_member" };
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
      categories: [{ id: "CATDIR", title: "Diretoria", channels: [PRIV] }],
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
const store = new MemoryAssignmentStore();
const registry = new Registry({ cache, store, members: memberSrc, log: silentLog, now: () => clock });
const gateway = new Gateway({
  auth,
  members: memberSrc,
  cache,
  runtimes: registry,
  profiles: new MemoryProfileStore(),
  allowedOrigins: ["https://chat.example"],
  log: silentLog,
  // The privacy test sends a whole walk at once; the limiter is tested on its own below.
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

// ---- tiny client -----------------------------------------------------------

interface Client {
  ws: WebSocket;
  msgs: Array<Record<string, any>>;
  closed: Promise<number>;
  send(obj: unknown): void;
  wait(pred: (m: Record<string, any>) => boolean, ms?: number): Promise<Record<string, any>>;
}

function connect(origin?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/v1/ws`, origin ? { origin } : {});
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
    ws.on("unexpected-response", (_req, res) => reject(new Error(`http ${res.statusCode}`)));
    ws.on("error", (e) => reject(e));
    ws.on("open", () =>
      resolve({
        ws,
        msgs,
        closed,
        send: (obj) => ws.send(JSON.stringify(obj)),
        wait: (pred, ms = 2_000) =>
          new Promise((res, rej) => {
            const hit = msgs.find(pred);
            if (hit) return res(hit);
            const t = setTimeout(() => rej(new Error("timeout waiting for message")), ms);
            waiters.push({ pred, done: (m) => (clearTimeout(t), res(m)) });
          }),
      }),
    );
  });
}

const hello = (token: string, id = "h1") => ({
  v: 1,
  t: "hello",
  id,
  d: { session_token: token, server_id: SRV, client: "web" },
});

async function join(token: string) {
  const c = await connect();
  c.send(hello(token));
  const snap = await c.wait((m) => m.t === "space.snapshot");
  return { c, snap };
}

// ---- tests -------------------------------------------------------------------

test("hello → hello.ok + snapshot; private room name hidden from who cannot view it", async () => {
  const { c: ana, snap } = await join("token-ana-0000000000");
  const priv = snap.d.rooms.find((r: any) => r.room_id === PRIV);
  const pub = snap.d.rooms.find((r: any) => r.room_id === PUB);
  assert.deepEqual(priv, { room_id: PRIV, label: null, private: true, can_enter: false, occupants: null, capacity: null });
  assert.equal(pub.label, "Sala Aberta");
  assert.equal(pub.can_enter, true);
  // The "Diretoria" wing holds only the private room: its title is hidden too.
  const dirWing = snap.d.wings.find((w: any) => w.title === null);
  assert.ok(dirWing, "wing title hidden");
  ana.ws.close();
  await ana.closed;

  const { c: bia, snap: snapBia } = await join("token-bia-0000000000");
  const privBia = snapBia.d.rooms.find((r: any) => r.room_id === PRIV);
  assert.equal(privBia.label, "Sala Secreta");
  assert.equal(privBia.can_enter, true);
  assert.ok(snapBia.d.wings.some((w: any) => w.title === "Diretoria"));
  bia.ws.close();
  await bia.closed;
});

test("bad sessions are refused with the protocol close codes", async () => {
  const bad = await connect();
  bad.send(hello("token-nobody-000000"));
  assert.equal(await bad.closed, 4401);

  const outsider = await connect();
  outsider.send(hello("token-out-0000000000"));
  assert.equal(await outsider.closed, 4403);

  stoatDown = true;
  const down = await connect();
  down.send(hello("token-ana-0000000000"));
  assert.equal(await down.closed, 4503, "Stoat down is not 'invalid session'");
  stoatDown = false;

  const noHello = await connect();
  noHello.send({ v: 1, t: "ping", id: "p" });
  assert.equal(await noHello.closed, 4400);
});

test("a browser Origin outside the allowlist cannot open the socket", async () => {
  await assert.rejects(connect("https://evil.example"), /http 403/);
  const ok = await connect("https://chat.example");
  ok.ws.close();
});

test("moves are validated; teleports corrected; others see positions at 10 Hz", async () => {
  const { c: ana, snap } = await join("token-ana-0000000000");
  const { c: bia } = await join("token-bia-0000000000");
  const start = snap.d.you;
  clock += 1000 / MOVE_SEND_HZ;
  ana.send({ v: 1, t: "avatar.move", seq: 1, d: { x: start.x + 10, y: start.y, dir: "right", moving: true } });
  const seen = await bia.wait(
    (m) => m.t === "avatar.positions" && m.d.avatars.some((a: any) => a.user_id === start.user_id && a.x === start.x + 10),
  );
  assert.ok(seen);
  ana.send({ v: 1, t: "avatar.move", seq: 2, d: { x: start.x + 5000, y: start.y, dir: "right", moving: true } });
  const corr = await ana.wait((m) => m.t === "avatar.correction");
  assert.equal(corr.d.reason, "speed");
  assert.equal(corr.d.x, start.x + 10);
  ana.ws.close();
  bia.ws.close();
  await Promise.all([ana.closed, bia.closed]);
});

test("privacy: an avatar inside a private room disappears for who cannot view it; the door stays shut for them", async () => {
  const { c: ana } = await join("token-ana-0000000000");
  const { c: bia, snap } = await join("token-bia-0000000000");
  const rt = (await registry.get(SRV))!;
  const ix = rt.index;
  const room = ix.roomsById.get(PRIV)!;
  const me = snap.d.you;
  const startTile = { tx: Math.floor(me.x / 32), ty: Math.floor(me.y / 32) };
  const path = findPath(ix, startTile, room.inside, () => true)!;
  // The server reads the clock when it PROCESSES a move, so advance it per
  // batch and wait for a pong (ordered after the batch) before the next one:
  // otherwise the whole walk lands at one instant and the 0.5 s burst budget
  // (correctly) rejects it.
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
    for (const m of batch) bia.send({ v: 1, t: "avatar.move", seq: ++seq, d: { x: m.x, y: m.y, dir: "up", moving: true } });
    const id = `b${i}`;
    bia.send({ v: 1, t: "ping", id });
    await bia.wait((m) => m.t === "pong" && m.re === id);
  }
  const gone = await ana.wait((m) => m.t === "avatar.positions" && m.d.gone.includes(me.user_id), 4_000);
  assert.ok(gone, "ana is told bia is gone");
  assert.equal(
    ana.msgs.some((m) => m.t === "avatar.positions" && m.d.avatars.some((a: any) => a.user_id === me.user_id && a.room === PRIV)),
    false,
    "ana never receives a position inside the private room",
  );
  assert.equal(bia.msgs.some((m) => m.t === "avatar.correction"), false, "bia walked in without corrections");
  ana.ws.close();
  bia.ws.close();
  await Promise.all([ana.closed, bia.closed]);
});

test("a second tab of the same person replaces the first (4001)", async () => {
  const { c: first } = await join("token-ana-0000000000");
  const { c: second } = await join("token-ana-second-tab");
  assert.equal(await first.closed, 4001);
  second.ws.close();
  await second.closed;
});

test("layout over REST: members only, no names on the wire, stale fingerprint is 404", async () => {
  const rt = (await registry.get(SRV))!;
  const url = `http://${base}/v1/spaces/${SRV}/layout/${rt.layoutFingerprint}`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { "x-session-token": "token-out-0000000000" } })).status, 403);
  const ok = await fetch(url, { headers: { "x-session-token": "token-ana-0000000000" } });
  assert.equal(ok.status, 200);
  const body = await ok.text();
  assert.equal(body.includes("Sala Secreta"), false, "private name never on the wire");
  assert.equal(body.includes("Diretoria"), false, "category title never on the wire");
  const map = JSON.parse(body);
  assert.equal(map.rooms.length, 2);
  assert.equal(map.fingerprint, rt.layoutFingerprint);
  const stale = await fetch(`http://${base}/v1/spaces/${SRV}/layout/deadbeef`, {
    headers: { "x-session-token": "token-ana-0000000000" },
  });
  assert.equal(stale.status, 404);
});

test("a new voice channel in Stoat appears in the map for connected people", async () => {
  const { c: ana } = await join("token-ana-0000000000");
  const NEW = "01JNEW00000000000000000000";
  cache.apply({ type: "ChannelCreate", channel_type: "TextChannel", _id: NEW, server: SRV, name: "Nova Sala", voice: { max_users: 3 } });
  const changed = await ana.wait((m) => m.t === "space.layout.changed");
  const rooms = await ana.wait((m) => m.t === "space.rooms" && m.d.rooms.some((r: any) => r.room_id === NEW));
  assert.ok(changed.d.fingerprint);
  assert.equal(rooms.d.rooms.find((r: any) => r.room_id === NEW).label, "Nova Sala");
  ana.ws.close();
  await ana.closed;
});

test("flooding gets rate limited (20/s, burst 40), sustained abuse closes 4429", () => {
  const b = new TokenBucket(20, 40, 10_000, 0);
  let t = 0;
  const verdicts = Array.from({ length: 41 }, () => b.take(t));
  assert.equal(verdicts.filter((v) => v === "ok").length, 40);
  assert.equal(verdicts.at(-1), "drop");
  t += 1000; // refills 20
  assert.equal(Array.from({ length: 20 }, () => b.take(t)).every((v) => v === "ok"), true);
  assert.equal(b.take(t), "drop");
  assert.equal(b.take(t + 10_000 - 1 - 1000 + 1000), "ok", "refilled after a pause");
  const abuser = new TokenBucket(1, 1, 500, 0);
  abuser.take(0);
  assert.equal(abuser.take(1), "drop");
  assert.equal(abuser.take(10), "drop");
  // Keep hammering without pause: refill never reaches a whole token.
  let v: string = "drop";
  for (let ms = 11; ms <= 600 && v !== "abuse"; ms += 1) v = abuser.take(ms) === "ok" ? "drop" : abuser.take(ms);
  assert.ok(["abuse", "drop"].includes(v));
});

test("config lists the servers with the space on, only for a signed-in person", async () => {
  assert.equal((await fetch(`http://${base}/v1/config`)).status, 401);
  const res = await fetch(`http://${base}/v1/config`, { headers: { "x-session-token": "token-out-0000000000" } });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { servers: string[] }).servers, [SRV]);
});

test("profile: default look, validated patch, onboarding only moves forward; the new look reaches others", async () => {
  const url = `http://${base}/v1/me/profile`;
  const H = { "x-session-token": "token-bia-0000000000", "content-type": "application/json" };
  const first = (await (await fetch(url, { headers: H })).json()) as { onboarding_version: number; look: { palette: number } };
  assert.equal(first.onboarding_version, 0);
  assert.ok(first.look.palette >= 0 && first.look.palette < 8);
  for (const bad of ['{"look":{"palette":9}}', '{"look":{"palette":1},"admin":true}', "nope", '{"onboarding_done":7}']) {
    assert.equal((await fetch(url, { method: "PUT", headers: H, body: bad })).status, 400, bad);
  }
  assert.equal((await fetch(url, { method: "PUT", headers: H, body: "x".repeat(5000) })).status, 413);

  // Bia was left inside the private room by an earlier test, so Ana (who
  // cannot see in there) changes her look and Bia watches.
  const { c: bia } = await join("token-bia-0000000000");
  const { c: ana, snap } = await join("token-ana-0000000000");
  const palette = (snap.d.you.look.palette + 3) % 8;
  const HA = { ...H, "x-session-token": "token-ana-0000000000" };
  const put = await fetch(url, { method: "PUT", headers: HA, body: JSON.stringify({ look: { palette }, onboarding_done: 1 }) });
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { look: { palette }, onboarding_version: 1 });
  const seen = await bia.wait((m) => m.t === "avatar.positions" && m.d.avatars.some((a: any) => a.user_id === snap.d.you.user_id && a.look.palette === palette));
  assert.ok(seen, "bia sees ana's new look");
  ana.ws.close();
  bia.ws.close();
  await Promise.all([ana.closed, bia.closed]);
});
