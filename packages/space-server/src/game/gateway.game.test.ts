import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { Perm } from "@muchat/space-core";
import WebSocket from "ws";

import { silentLog } from "../log.ts";
import { MemoryProfileStore } from "../space/profiles.ts";
import { Registry } from "../space/registry.ts";
import { MemoryAssignmentStore } from "../space/store.ts";
import type { AuthResult, MemberResult, StoatAuth, StoatMembers } from "../stoat/api.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { Gateway } from "../ws/gateway.ts";
import { GameService } from "./service.ts";
import { MemoryGameStore } from "./store.ts";
import { gameSwitch } from "./switch.ts";

// Refúgio (ADR 0009, etapa E2): os comandos do jogo pela WS do mapa, com as
// três chaves (operador, dono do servidor, pessoa) e a sessão observe.

const SRV = "01JSRV00000000000000000000"; // jogo ligado pelo operador
const OFF = "01JSRV0FF00000000000000000"; // jogo fora da lista do operador
const ROOM = "01JR00M0000000000000000000";
const ROOM2 = "01JR00M2000000000000000000";
const ANA = "01JANA00000000000000000000"; // dona do SRV
const BIA = "01JB1A00000000000000000000";
const CAI = "01JCA100000000000000000000"; // de castigo (timeout)
const n = (b: bigint) => Number(b);
const DEFAULT = Perm.ViewChannel | Perm.Connect | Perm.Speak | Perm.Listen | Perm.InteractSpaceObjects;

let clock = 1_800_000_000_000;
const users: Record<string, StoatUser> = {
  "token-ana-0000000000": { _id: ANA, username: "ana" },
  "token-bia-0000000000": { _id: BIA, username: "bia" },
  "token-cai-0000000000": { _id: CAI, username: "caio" },
};
const member = (server: string, user: string, extra: Partial<StoatMember> = {}): StoatMember => ({ _id: { server, user }, roles: [], ...extra });
const auth: StoatAuth = {
  async me(token): Promise<AuthResult> {
    const user = users[token];
    return user ? { kind: "ok", user } : { kind: "invalid" };
  },
};
const members: StoatMembers = {
  async member(server, userId): Promise<MemberResult> {
    if (userId === CAI) return { kind: "ok", member: member(server, userId, { timeout: new Date(clock + 3_600_000).toISOString() }) };
    return users[`token-${userId === ANA ? "ana" : "bia"}-0000000000`] ? { kind: "ok", member: member(server, userId) } : { kind: "not_member" };
  },
};

const cache = new StoatCache();
cache.apply({
  type: "Ready",
  servers: [
    { _id: SRV, owner: ANA, name: "Piloto", channels: [ROOM], categories: [], default_permissions: n(DEFAULT), roles: {} },
    { _id: OFF, owner: ANA, name: "Outro", channels: [ROOM2], categories: [], default_permissions: n(DEFAULT), roles: {} },
  ],
  channels: [
    { channel_type: "TextChannel", _id: ROOM, server: SRV, name: "Sala", voice: { max_users: 8 } },
    { channel_type: "TextChannel", _id: ROOM2, server: OFF, name: "Sala", voice: { max_users: 8 } },
  ],
});
const heroes = new MemoryGameStore();
const registry = new Registry({
  cache,
  store: new MemoryAssignmentStore(),
  members,
  log: silentLog,
  now: () => clock,
  gameAvailable: gameSwitch(SRV).available,
});
const gateway = new Gateway({
  auth,
  members,
  cache,
  runtimes: registry,
  profiles: new MemoryProfileStore(),
  allowedOrigins: [],
  log: silentLog,
  rateLimit: { rate: 2_000, burst: 400 },
  game: new GameService({ store: heroes, log: silentLog, now: () => clock }),
});
let base = "";
before(async () => {
  await gateway.listen(0, "127.0.0.1");
  base = `127.0.0.1:${gateway.address.port}`;
});
after(async () => {
  await gateway.close();
});

type Msg = Record<string, any>;
async function join(token: string, server = SRV, mode?: "observe") {
  const ws = new WebSocket(`ws://${base}/v1/ws`);
  const msgs: Msg[] = [];
  const waiters: { pred: (m: Msg) => boolean; done: (m: Msg) => void }[] = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw)) as Msg;
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) (waiters.splice(waiters.indexOf(w), 1), w.done(m));
  });
  await new Promise((r) => ws.on("open", r));
  const wait = (pred: (m: Msg) => boolean, ms = 2_000) =>
    new Promise<Msg>((res, rej) => {
      const hit = msgs.find(pred);
      if (hit) return res(hit);
      const t = setTimeout(() => rej(new Error("timeout waiting for message")), ms);
      waiters.push({ pred, done: (m) => (clearTimeout(t), res(m)) });
    });
  const send = (o: unknown) => ws.send(typeof o === "string" ? o : JSON.stringify(o));
  let seq = 0;
  /** Manda e espera a resposta com `re`. */
  const ask = async (t: string, d?: unknown) => {
    const id = `${t}-${++seq}`;
    send({ v: 1, t, id, ...(d === undefined ? {} : { d }) });
    return wait((m) => m.re === id);
  };
  send({ v: 1, t: "hello", id: "h1", d: { session_token: token, server_id: server, client: "web", ...(mode ? { mode } : {}) } });
  const first = await wait((m) => m.t === (mode === "observe" ? "space.presence" : "space.snapshot") || m.t === "hello.ok");
  return { ws, msgs, wait, send, ask, first };
}

const LOOK = { skin: 0, hair: 1, outfit: 2, trim: 3, cosmetic: null };

test("ws: snapshot diz que o jogo está ligado, e o herói nasce e volta pela WS", async () => {
  const ana = await join("token-ana-0000000000");
  const snap = await ana.wait((m) => m.t === "space.snapshot");
  assert.deepEqual(snap.d.game, { available: true, enabled: true });
  const empty = await ana.ask("game.open");
  assert.equal(empty.t, "game.state");
  assert.equal(empty.d.hero, null);
  const made = await ana.ask("game.create", { cls: "druida", look: LOOK });
  assert.equal(made.d.hero.cls, "druida");
  assert.equal(heroes.docs.get(ANA)?.cls, "druida");
  const again = await ana.ask("game.open");
  assert.equal(again.d.hero.cls, "druida");
  ana.ws.close();
});

test("ws: comando de jogo malformado é invalid_message sem derrubar a conexão", async () => {
  const bia = await join("token-bia-0000000000");
  bia.send({ v: 1, t: "game.buy", id: "b1", d: { offer: "espada", qty: 1 } });
  const err = await bia.wait((m) => m.t === "error" && m.d.code === "invalid_message");
  assert.ok(err);
  const pong = await bia.ask("ping");
  assert.equal(pong.t, "pong");
  bia.ws.close();
});

test("ws: um frame do mapa que só cita \"game. num texto segue o caminho do mapa", async () => {
  const bia = await join("token-bia-0000000000");
  const id = 'x "game.trap';
  bia.send({ v: 1, t: "ping", id });
  const pong = await bia.wait((m) => m.re === id);
  assert.equal(pong.t, "pong");
  bia.ws.close();
});

test("ws: sessão observe não joga", async () => {
  const obs = await join("token-bia-0000000000", SRV, "observe");
  obs.send({ v: 1, t: "game.open", id: "o1" });
  const err = await obs.wait((m) => m.re === "o1");
  assert.deepEqual(err.d, { code: "not_allowed" });
  obs.ws.close();
});

test("ws: servidor fora da lista do operador = desligado", async () => {
  const ana = await join("token-ana-0000000000", OFF);
  const snap = await ana.wait((m) => m.t === "space.snapshot");
  assert.deepEqual(snap.d.game, { available: false, enabled: false });
  assert.deepEqual((await ana.ask("game.open")).d, { code: "game_disabled" });
  ana.ws.close();
});

test("ws: de castigo (timeout) não joga", async () => {
  const cai = await join("token-cai-0000000000");
  const snap = await cai.wait((m) => m.t === "space.snapshot");
  assert.deepEqual(snap.d.game, { available: true, enabled: false });
  assert.deepEqual((await cai.ask("game.open")).d, { code: "not_allowed" });
  cai.ws.close();
});

test("ws: a dona desliga o jogo nas configurações, e salvar sem o campo (app antigo) não religa", async () => {
  const ana = await join("token-ana-0000000000");
  const bia = await join("token-bia-0000000000");
  const off = await ana.ask("decor.settings", { editors: "admins", roles: [], game: "off" });
  assert.equal(off.t, "decor.changed");
  assert.deepEqual((await bia.ask("game.open")).d, { code: "game_disabled" });
  // Um app que não conhece a chave salva só o intervalo da TV.
  const tv = await ana.ask("decor.settings", { editors: "admins", roles: [], tv_cooldown_s: 30 });
  assert.equal(tv.d.op.settings.game, "off");
  assert.equal(tv.d.op.settings.tv_cooldown_s, 30);
  assert.deepEqual((await bia.ask("game.open")).d, { code: "game_disabled" });
  // Bia não pode mexer na chave (ManageServer).
  const denied = await bia.ask("decor.settings", { editors: "admins", roles: [], game: "on" });
  assert.equal(denied.d.code, "not_allowed");
  const on = await ana.ask("decor.settings", { editors: "admins", roles: [], game: "on" });
  assert.equal(on.d.op.settings.game, "on");
  assert.equal((await bia.ask("game.open")).t, "game.state");
  ana.ws.close();
  bia.ws.close();
});

test("ws: expedição pela WS, com a luta chegando antes do estado e sem a chave", async () => {
  const bia = await join("token-bia-0000000000");
  const made = await bia.ask("game.create", { cls: "cavaleiro", look: LOOK });
  assert.equal(made.d.hero.cls, "cavaleiro");
  const start = await bia.ask("game.run.start", { degree: "normal" });
  assert.equal(start.d.hero.run.initiation, true);
  bia.send({ v: 1, t: "game.run.go", id: "go-1", d: { lane: 0 } });
  const state = await bia.wait((m) => m.re === "go-1" && m.t === "game.state");
  const order = bia.msgs.filter((m) => m.re === "go-1").map((m) => m.t);
  assert.deepEqual(order, ["game.fight", "game.state"]);
  assert.equal(state.d.hero.run.row, 0);
  const key = heroes.docs.get(BIA)!.run!.key;
  assert.match(key, /^[0-9a-f]{32}$/);
  for (const m of bia.msgs) assert.ok(!JSON.stringify(m).includes(key));
  bia.ws.close();
});
