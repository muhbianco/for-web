import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { Perm, roomZoneKey } from "@muchat/space-core";
import WebSocket from "ws";

import { silentLog } from "../log.ts";
import { MemoryDecorStore } from "../space/decorStore.ts";
import { MemoryProfileStore } from "../space/profiles.ts";
import { Registry } from "../space/registry.ts";
import { MemoryAssignmentStore } from "../space/store.ts";
import type { AuthResult, MemberResult, StoatAuth, StoatMembers } from "../stoat/api.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { Gateway } from "./gateway.ts";

// Cenário E da matriz da fase 4 (ADR 0008): o servidor decide, não a
// interface. Requisições cruas, como um cliente adulterado faria.

const SRV = "01JSRV00000000000000000000";
const PUB = "01JPVB00000000000000000000";
const PRIV = "01JPRV00000000000000000000";
const OWN = "01J0WNER000000000000000000";
const DIR = "01JD1R00000000000000000000";
const MEM = "01JMEM00000000000000000000";
const n = (b: bigint) => Number(b);
// No InteractSpaceObjects for @everyone here: objects' contents stay on the server.
const DEFAULT = Perm.ViewChannel | Perm.ReadMessageHistory | Perm.SendMessage | Perm.Connect | Perm.Speak | Perm.Listen;

const users: Record<string, StoatUser> = {
  "token-own-0000000000": { _id: OWN, username: "dona" },
  "token-dir-0000000000": { _id: DIR, username: "diretor" },
  "token-mem-0000000000": { _id: MEM, username: "membro" },
  "token-out-0000000000": { _id: "01J0VT00000000000000000000", username: "fora" },
};
const roles: Record<string, string[]> = { [OWN]: [], [DIR]: ["DIR"], [MEM]: [] };
const auth: StoatAuth = {
  async me(token): Promise<AuthResult> {
    const user = users[token];
    return user ? { kind: "ok", user } : { kind: "invalid" };
  },
};
const members: StoatMembers = {
  async member(_s, userId): Promise<MemberResult> {
    if (!(userId in roles)) return { kind: "not_member" };
    const m: StoatMember = { _id: { server: SRV, user: userId }, roles: roles[userId] };
    return { kind: "ok", member: m };
  },
};

const cache = new StoatCache();
cache.apply({
  type: "Ready",
  servers: [
    {
      _id: SRV,
      owner: OWN,
      name: "Piloto",
      channels: [PUB, PRIV],
      default_permissions: n(DEFAULT),
      roles: { DIR: { name: "Diretoria", rank: 1, permissions: { a: n(Perm.InteractSpaceObjects), d: 0 } } },
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
const decorStore = new MemoryDecorStore();
const registry = new Registry({ cache, store: new MemoryAssignmentStore(), decorStore, members, log: silentLog });
const gateway = new Gateway({
  auth,
  members,
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
      }),
    );
  });
}

async function play(token: string) {
  const c = await connect();
  c.send({ v: 1, t: "hello", id: "h", d: { session_token: token, server_id: SRV, client: "web" } });
  const snap = await c.wait((m) => m.t === "space.snapshot");
  return { c, snap };
}

const decorOf = async (token: string) => {
  const res = await fetch(`http://${base}/v1/spaces/${SRV}/decor`, { headers: { "x-session-token": token } });
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as Record<string, any>) : null };
};

test("E: a private room's objects and floor never reach who cannot view it (REST and live changes)", async () => {
  const { c: own } = await play("token-own-0000000000");
  const { c: mem } = await play("token-mem-0000000000");
  const { c: dir } = await play("token-dir-0000000000");
  const zone = roomZoneKey(PRIV);
  const rt = (await registry.get(SRV))!;
  for (const i of rt.decorState.items.filter((i) => i.zone === zone)) {
    own.send({ v: 1, t: "decor.remove", id: `rm-${i.id}`, d: { id: i.id } });
    await own.wait((m) => m.t === "decor.changed" && m.re === `rm-${i.id}`);
  }
  own.send({
    v: 1,
    t: "decor.place",
    id: "p1",
    d: { id: "secret-note", item: "info-totem", zone, x: 1, y: 1, rot: 0, config: { title: "Plano", text: "confidencial" } },
  });
  await own.wait((m) => m.t === "decor.changed" && m.re === "p1");

  const memEvent = await mem.wait((m) => m.t === "decor.changed" && m.d.by === OWN && m.d.rev === rt.decorRev);
  assert.deepEqual(memEvent.d.op, { kind: "reset" }, "a member without ViewChannel learns nothing but 'refetch'");
  assert.equal(JSON.stringify(mem.msgs).includes("confidencial"), false);
  const dirEvent = await dir.wait((m) => m.t === "decor.changed" && m.d.rev === rt.decorRev);
  assert.equal(dirEvent.d.op.item.config.text, "confidencial", "who may view and use it gets it");

  const asMem = await decorOf("token-mem-0000000000");
  assert.equal(asMem.status, 200);
  assert.equal(asMem.body!.items.some((i: any) => i.zone === zone), false, "nothing from the private room");
  assert.equal(JSON.stringify(asMem.body).includes("confidencial"), false);
  const asDir = await decorOf("token-dir-0000000000");
  assert.ok(asDir.body!.items.some((i: any) => i.id === "secret-note" && i.config?.text === "confidencial"));
  assert.equal((await decorOf("token-out-0000000000")).status, 403, "outsiders get nothing");
  for (const c of [own, mem, dir]) c.ws.close();
  await Promise.all([own.closed, mem.closed, dir.closed]);
});

test("E: without InteractSpaceObjects an object's contents stay on the server (locked)", async () => {
  const { c: own } = await play("token-own-0000000000");
  const zone = roomZoneKey(PUB);
  const rt = (await registry.get(SRV))!;
  for (const i of rt.decorState.items.filter((i) => i.zone === zone)) {
    own.send({ v: 1, t: "decor.remove", id: `rp-${i.id}`, d: { id: i.id } });
    await own.wait((m) => m.t === "decor.changed" && m.re === `rp-${i.id}`);
  }
  own.send({
    v: 1,
    t: "decor.place",
    id: "p2",
    d: { id: "pub-note", item: "info-totem", zone, x: 1, y: 1, rot: 0, config: { text: "só para quem pode usar" } },
  });
  await own.wait((m) => m.t === "decor.changed" && m.re === "p2");
  const asMem = await decorOf("token-mem-0000000000");
  const item = asMem.body!.items.find((i: any) => i.id === "pub-note");
  assert.ok(item, "the object itself is there");
  assert.equal(item.config, undefined);
  assert.equal(item.locked, true);
  const asDir = await decorOf("token-dir-0000000000");
  assert.equal(asDir.body!.items.find((i: any) => i.id === "pub-note").config.text, "só para quem pode usar");
  own.ws.close();
  await own.closed;
});

test("E: raw commands from a member without permissions are refused by the server", async () => {
  const { c: mem } = await play("token-mem-0000000000");
  const attempts = [
    { t: "decor.place", d: { id: "xx-01", item: "plant-small", zone: "hall", x: 0, y: 0, rot: 0 } },
    { t: "decor.remove", d: { id: "pub-note" } },
    { t: "decor.floor", d: { zone: "hall", floor: null } },
    { t: "decor.settings", d: { editors: "everyone", roles: [] } },
    { t: "screen.stop", d: { user_id: OWN } },
  ];
  for (const [i, a] of attempts.entries()) mem.send({ v: 1, id: `m${i}`, ...a });
  for (let i = 0; i < attempts.length; i++) {
    const err = await mem.wait((m) => m.t === "error" && m.re === `m${i}`);
    assert.ok(["not_allowed", "not_found"].includes(err.d.code), `${attempts[i]!.t}: ${err.d.code}`);
  }
  mem.ws.close();
  await mem.closed;
});

test("E: losing a role mid-session takes its rights away at once (decor.rights)", async () => {
  roles[DIR] = ["DIR"];
  const { c: dir, snap } = await play("token-dir-0000000000");
  assert.equal(snap.d.you.decor.can_edit, false);
  // Give and take a decorating role while connected.
  cache.apply({
    type: "ServerRoleUpdate",
    id: SRV,
    role_id: "DIR",
    data: { permissions: { a: n(Perm.InteractSpaceObjects | Perm.DecorateSpace), d: 0 } },
    clear: [],
  });
  const granted = await dir.wait((m) => m.t === "decor.rights" && m.d.can_edit === true);
  assert.ok(granted);
  roles[DIR] = [];
  cache.apply({ type: "ServerMemberUpdate", id: { server: SRV, user: DIR }, data: { roles: [] }, clear: [] });
  const revoked = await dir.wait((m) => m.t === "decor.rights" && m.d.can_edit === false, 3_000);
  assert.ok(revoked);
  dir.send({ v: 1, t: "decor.place", id: "late", d: { id: "xx-02", item: "plant-small", zone: "hall", x: 0, y: 0, rot: 0 } });
  const err = await dir.wait((m) => m.t === "error" && m.re === "late");
  assert.equal(err.d.code, "not_allowed");
  dir.ws.close();
  await dir.closed;
});
