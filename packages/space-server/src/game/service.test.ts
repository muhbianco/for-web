import assert from "node:assert/strict";
import { test } from "node:test";

import { type GameCommand, rollItem, Rng, RULES } from "@muchat/space-core/game";

import { silentLog } from "../log.ts";
import type { SessionPort, Viewer } from "../space/runtime.ts";
import { BAG_MAX, docBytes, DOC_MAX_BYTES, type HeroDoc, PENDING_MAX } from "./hero.ts";
import { type GameHost, GameService } from "./service.ts";
import { type GameStore, MemoryGameStore } from "./store.ts";
import { gameSwitch } from "./switch.ts";

// Refúgio (ADR 0009, etapa E2): o herói no servidor.

const ANA = "01JANA00000000000000000000";
const SRV = "01JSRV00000000000000000000";
const H = 3_600_000;
const LOOK = { skin: 1, hair: 2, outfit: 3, trim: 4, cosmetic: null };

function session(userId = ANA) {
  const sent: Record<string, any>[] = [];
  const s: SessionPort = {
    viewer: { user: { _id: userId, username: "ana" }, member: { _id: { server: SRV, user: userId }, roles: [] } } as Viewer,
    send: (e) => void sent.push(e),
    close: () => {},
  };
  return { s, sent, last: () => sent[sent.length - 1]! };
}

function setup(over: { store?: GameStore; access?: ReturnType<GameHost["gameAccess"]> } = {}) {
  let clock = 1_800_000_000_000;
  const store = over.store ?? new MemoryGameStore();
  let access = over.access ?? "ok";
  const host: GameHost = { serverId: SRV, gameAccess: () => access };
  let n = 0;
  const svc = new GameService({ store, log: silentLog, now: () => clock, random: () => 12345 + n++ });
  let seq = 0;
  const cmd = <T extends GameCommand["t"]>(t: T, d?: unknown) => ({ v: 1, t, id: `c${++seq}`, ...(d === undefined ? {} : { d }) }) as GameCommand;
  const run = async (sess: SessionPort, c: GameCommand) => {
    svc.handle(sess, host, c);
    await svc.idle(sess.viewer.user._id);
  };
  return {
    svc,
    store,
    host,
    cmd,
    run,
    tick: (ms: number) => void (clock += ms),
    now: () => clock,
    setAccess: (a: typeof access) => void (access = a),
  };
}

test("herói: abrir sem herói, criar, criar de novo recusa", async () => {
  const g = setup();
  const a = session();
  await g.run(a.s, g.cmd("game.open"));
  assert.equal(a.last().t, "game.state");
  assert.equal(a.last().d.hero, null);
  await g.run(a.s, g.cmd("game.create", { cls: "cavaleiro", look: LOOK }));
  const st = a.last();
  assert.equal(st.t, "game.state");
  assert.equal(st.re, "c2");
  assert.equal(st.d.hero.cls, "cavaleiro");
  assert.equal(st.d.hero.level, 1);
  assert.equal(st.d.hero.potions, RULES.maxPotions);
  assert.equal(st.d.hero.training.skill, "espada");
  assert.equal(st.d.hero.hp, st.d.hero.max_hp);
  assert.equal(st.d.hero.initiation_done, false);
  assert.deepEqual(Object.keys(st.d.hero.gear).sort(), ["arma", "armadura", "botas", "elmo"]);
  await g.run(a.s, g.cmd("game.create", { cls: "druida", look: LOOK }));
  assert.deepEqual(a.last().d, { code: "game_invalid", reason: "exists" });
});

test("herói: o boneco treina pelo relógio, e abrir sem nada a assentar não grava", async () => {
  const g = setup();
  const a = session();
  await g.run(a.s, g.cmd("game.create", { cls: "cavaleiro", look: LOOK }));
  const store = g.store as MemoryGameStore;
  const writes = store.writes;
  await g.run(a.s, g.cmd("game.open"));
  assert.equal(store.writes, writes, "abrir logo depois não grava");
  g.tick(2 * H); // 360 tentativas no boneco de madeira
  await g.run(a.s, g.cmd("game.open"));
  assert.equal(store.writes, writes + 1);
  const espada = a.last().d.hero.skills.espada;
  assert.ok(espada.l > 1, `espada ${espada.l}`);
  // 60 + 69 + 79 + 91 = 299 tentativas levam ao 5; sobram 61.
  assert.deepEqual({ l: espada.l, p: espada.p }, { l: 5, p: 61 });
  g.tick(30 * H); // passou do teto de 12 h: só 12 h contam
  await g.run(a.s, g.cmd("game.train", { skill: "escudo" }));
  const after = a.last().d.hero;
  assert.equal(after.training.skill, "escudo");
  assert.ok(after.skills.espada.l >= 10);
  assert.equal(after.training.since, g.now());
});

test("herói: duas abas vendendo o mesmo item ao mesmo tempo vendem uma vez", async () => {
  const g = setup();
  const a = session();
  const b = session();
  await g.run(a.s, g.cmd("game.create", { cls: "arqueiro", look: LOOK }));
  // Um item na bolsa (como se tivesse vindo de uma expedição).
  const store = g.store as MemoryGameStore;
  const doc = store.docs.get(ANA)!;
  const it = rollItem(new Rng(1), 5, "raro", "arqueiro", "anel");
  doc.bag.push(it);
  doc.rev++;
  const fresh = new GameService({ store, log: silentLog, now: g.now }); // sem cache velho
  fresh.handle(a.s, g.host, g.cmd("game.sell", { items: [it.id] }));
  fresh.handle(b.s, g.host, g.cmd("game.sell", { items: [it.id] }));
  await fresh.idle(ANA);
  const results = [a.last(), b.last()];
  assert.equal(results.filter((m) => m.t === "game.state").length, 1);
  assert.deepEqual(results.find((m) => m.t === "error")!.d, { code: "game_invalid", reason: "not_found" });
  assert.equal(store.docs.get(ANA)!.gold, 18, "venda de um anel raro ilvl 5: (3 + 2×5) × 135% = 17,55 → 18, uma vez só");
});

test("herói: dois create ao mesmo tempo criam um herói só", async () => {
  const g = setup();
  const a = session();
  const b = session();
  g.svc.handle(a.s, g.host, g.cmd("game.create", { cls: "feiticeiro", look: LOOK }));
  g.svc.handle(b.s, g.host, g.cmd("game.create", { cls: "druida", look: LOOK }));
  await g.svc.idle(ANA);
  assert.equal((g.store as MemoryGameStore).docs.get(ANA)!.cls, "feiticeiro");
  assert.deepEqual(b.last().d, { code: "game_invalid", reason: "exists" });
});

test("herói: jogo desligado e sem permissão recusam sem tocar no banco", async () => {
  const store = new MemoryGameStore();
  const g = setup({ store, access: "disabled" });
  const a = session();
  await g.run(a.s, g.cmd("game.create", { cls: "cavaleiro", look: LOOK }));
  assert.deepEqual(a.last().d, { code: "game_disabled" });
  g.setAccess("not_allowed");
  await g.run(a.s, g.cmd("game.open"));
  assert.deepEqual(a.last().d, { code: "not_allowed" });
  assert.equal(store.docs.size, 0);
  assert.equal(store.writes, 0);
});

test("herói: sobrevive ao restart (outro GameService, mesmo store)", async () => {
  const store = new MemoryGameStore();
  const g = setup({ store });
  const a = session();
  await g.run(a.s, g.cmd("game.create", { cls: "druida", look: LOOK }));
  await g.run(a.s, g.cmd("game.tactics", { order: ["seiva", "espinheiro"], potion_at: 40, heal_at: 70 }));
  const g2 = setup({ store });
  await g2.run(a.s, g2.cmd("game.open"));
  assert.equal(a.last().d.hero.cls, "druida");
  assert.deepEqual(a.last().d.hero.tactics, { order: ["seiva", "espinheiro"], potion_at: 40, heal_at: 70 });
});

test("herói: o mesmo comando reenviado (reconexão) não age duas vezes", async () => {
  const g = setup();
  const a = session();
  await g.run(a.s, g.cmd("game.create", { cls: "cavaleiro", look: LOOK }));
  const store = g.store as MemoryGameStore;
  store.docs.get(ANA)!.gold = 1000;
  store.docs.get(ANA)!.potions = 0;
  store.docs.get(ANA)!.rev++;
  const fresh = new GameService({ store, log: silentLog, now: g.now });
  const buy = { v: 1, t: "game.buy", id: "buy-1", d: { offer: "potion", qty: 1 } } as GameCommand;
  fresh.handle(a.s, g.host, buy);
  fresh.handle(a.s, g.host, buy);
  await fresh.idle(ANA);
  assert.equal(store.docs.get(ANA)!.potions, 1);
  assert.equal(store.docs.get(ANA)!.gold, 1000 - 22);
  assert.equal(a.last().t, "game.state");
});

test("herói: limite de comandos por pessoa", async () => {
  const g = setup();
  const a = session();
  await g.run(a.s, g.cmd("game.create", { cls: "cavaleiro", look: LOOK }));
  for (let i = 0; i < 12; i++) g.svc.handle(a.s, g.host, g.cmd("game.open"));
  await g.svc.idle(ANA);
  assert.ok(a.sent.some((m) => m.d?.code === "rate_limited"));
});

test("herói: equipar, tirar, comprar boneco e tática da outra classe", async () => {
  const g = setup();
  const a = session();
  await g.run(a.s, g.cmd("game.create", { cls: "cavaleiro", look: LOOK }));
  const store = g.store as MemoryGameStore;
  const doc = store.docs.get(ANA)!;
  const shield = rollItem(new Rng(4), 1, "incomum", "cavaleiro", "secundaria");
  const bow = rollItem(new Rng(5), 1, "comum", "arqueiro", "arma");
  bow.type = "arco";
  const high = rollItem(new Rng(6), 30, "raro", "cavaleiro", "elmo");
  doc.bag.push(shield, bow, high);
  doc.gold = 2000;
  doc.rev++;
  const svc = new GameService({ store, log: silentLog, now: g.now });
  const run = async (c: GameCommand) => {
    svc.handle(a.s, g.host, c);
    await svc.idle(ANA);
    return a.last();
  };
  assert.equal((await run(g.cmd("game.equip", { item: shield.id }))).d.hero.combat.blockBp > 0, true);
  assert.deepEqual((await run(g.cmd("game.equip", { item: bow.id }))).d, { code: "game_invalid", reason: "class" });
  assert.deepEqual((await run(g.cmd("game.equip", { item: high.id }))).d, { code: "game_invalid", reason: "level" });
  const off = await run(g.cmd("game.unequip", { slot: "secundaria" }));
  assert.equal(off.d.hero.gear.secundaria, undefined);
  assert.ok(off.d.hero.bag.some((x: any) => x.id === shield.id));
  const dummy = await run(g.cmd("game.buy", { offer: "dummy", qty: 1 }));
  assert.equal(dummy.d.hero.training.tier, 1);
  assert.equal(dummy.d.hero.gold, 500);
  assert.deepEqual((await run(g.cmd("game.buy", { offer: "dummy", qty: 1 }))).d, { code: "game_invalid", reason: "no_gold" });
  assert.deepEqual((await run(g.cmd("game.tactics", { order: ["raio"], potion_at: 30, heal_at: 50 }))).d, { code: "game_invalid", reason: "spell" });
  assert.deepEqual((await run(g.cmd("game.look", { look: { ...LOOK, cosmetic: "coroa" } }))).d, { code: "game_invalid", reason: "cosmetic_locked" });
});

test("herói: o serviço grava no store que recebeu, e retenta quando outro processo gravou antes", async () => {
  const inner = new MemoryGameStore();
  let failNext = false;
  const calls: string[] = [];
  const spy: GameStore = {
    get: (id) => (calls.push("get"), inner.get(id)),
    create: (d) => (calls.push("create"), inner.create(d)),
    async save(d, rev) {
      calls.push("save");
      if (failNext) {
        failNext = false;
        // Outro processo gravou: o rev guardado andou.
        const cur = inner.docs.get(d._id)!;
        cur.rev++;
        cur.gold += 7;
        return false;
      }
      return inner.save(d, rev);
    },
  };
  const g = setup({ store: spy });
  const a = session();
  await g.run(a.s, g.cmd("game.create", { cls: "cavaleiro", look: LOOK }));
  assert.ok(calls.includes("create"), "o store passado ao serviço é o que grava");
  failNext = true;
  await g.run(a.s, g.cmd("game.tactics", { order: ["golpe_pesado"], potion_at: 30, heal_at: 50 }));
  assert.equal(a.last().t, "game.state");
  assert.equal(a.last().d.hero.gold, 7, "a segunda tentativa partiu do documento novo");
  assert.deepEqual(a.last().d.hero.tactics.order, ["golpe_pesado"]);
});

test("herói: documento cheio (bolsa e fila no máximo, itens míticos) cabe em 32 KB", async () => {
  const g = setup();
  const a = session();
  await g.run(a.s, g.cmd("game.create", { cls: "feiticeiro", look: LOOK }));
  const doc = structuredClone((g.store as MemoryGameStore).docs.get(ANA)!) as HeroDoc;
  const rng = new Rng(77);
  for (let i = 0; i < BAG_MAX; i++) doc.bag.push(rollItem(rng, 250, "mitico", "feiticeiro", "anel"));
  for (let i = 0; i < PENDING_MAX; i++) doc.pending.push(rollItem(rng, 250, "mitico", "feiticeiro", "amuleto"));
  for (let i = 0; i < 50; i++) doc.servers_seen.push(`01JSRV${String(i).padStart(20, "0")}`);
  assert.ok(docBytes(doc) < DOC_MAX_BYTES, `${docBytes(doc)} bytes`);
});

test("chave do operador: ausente ou vazia = desligado; * = todos; lista = só os listados", () => {
  assert.equal(gameSwitch(undefined).available(SRV), false);
  assert.equal(gameSwitch("").available(SRV), false);
  assert.equal(gameSwitch(" , ").count, 0);
  assert.equal(gameSwitch("*").available(SRV), true);
  const sw = gameSwitch(` ${SRV} ,01JOUTRO0000000000000000000`);
  assert.equal(sw.available(SRV), true);
  assert.equal(sw.available("01JNADA00000000000000000000"), false);
  assert.equal(sw.count, 2);
});
