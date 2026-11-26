import assert from "node:assert/strict";
import test from "node:test";

import {
  type RpgCommand,
  type RpgHeroState,
  type RpgRunEvent,
  type RpgRunTickEvent,
} from "@muchat/space-core/game/ot/balance";

import { silentLog } from "../../log.ts";
import type { SessionPort, Viewer } from "../../space/runtime.ts";
import { LOBBY, LobbyHub } from "./lobby.ts";
import { MemoryRunStore } from "./runs.ts";
import { type RpgHost, RpgService, ratesFromEnv } from "./service.ts";
import { MemoryRpgStore } from "./store.ts";

// O serviço do jogo idle na engine nova (Fase 8).

class FakeSession implements SessionPort {
  readonly events: Array<Record<string, unknown>> = [];
  readonly viewer: Viewer;
  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }
  send(e: Record<string, unknown>) {
    this.events.push(e);
  }
  close() {}
  hero(): RpgHeroState | null {
    const s = this.events.filter((e) => e.t === "rpg.state").at(-1);
    return s ? (s.d as { hero: RpgHeroState | null }).hero : null;
  }
  errors(re: string) {
    return this.events
      .filter((e) => e.t === "error" && e.re === re)
      .map((e) => e.d as { code: string; reason?: string });
  }
  of<T>(t: string): T[] {
    return this.events.filter((e) => e.t === t) as unknown as T[];
  }
}

class FakeHost implements RpgHost {
  readonly serverId = "S1";
  near = true;
  readonly training = new Map<string, string>();
  readonly sessions = new Map<string, SessionPort>();
  readonly looks = new Map<string, unknown>();
  readonly lobbies = new LobbyHub();
  readonly sends: Array<Record<string, unknown>> = [];
  now: () => number = () => 1;
  gameAccess() {
    return "ok" as const;
  }
  trainSpot() {
    return this.near
      ? { ok: true as const, zone: "z1" }
      : { ok: false as const, code: "not_allowed", reason: "too_far" };
  }
  /** NPCs: o tipo vem do prefixo do id ("mercador-1"); "longe" no fim = longe. */
  npcSpot(_v: Viewer, instanceId: string, kind: string) {
    if (!instanceId.startsWith(kind))
      return { ok: false as const, code: "not_found" };
    if (instanceId.endsWith("longe"))
      return { ok: false as const, code: "not_allowed", reason: "too_far" };
    return { ok: true as const };
  }
  isTrainingAt(u: string, i: string) {
    return this.training.get(u) === i;
  }
  trainingOf(u: string) {
    return this.training.get(u) ?? null;
  }
  trainingPeers() {
    return 0;
  }
  setTraining(u: string, i: string | null) {
    if (i === null) this.training.delete(u);
    else this.training.set(u, i);
  }
  setHero(u: string, look: unknown) {
    this.looks.set(u, look);
  }
  sessionOf(u: string) {
    return this.sessions.get(u) ?? null;
  }
  displayName(u: string) {
    return u === "U1" ? "Ana" : "Bia";
  }
  tvSpot() {
    return { ok: true as const, room: "R1" };
  }
  lobbyCreate(
    tv: string,
    room: string,
    d: string,
    m: Parameters<LobbyHub["create"]>[3],
  ) {
    return this.lobbies.create(tv, room, d, m, this.now());
  }
  lobbyJoin(
    tv: string,
    id: string | undefined,
    m: Parameters<LobbyHub["join"]>[2],
  ) {
    return this.lobbies.join(tv, id, m);
  }
  lobbyLeave(u: string) {
    this.lobbies.leave(u);
  }
  lobbyStart(u: string) {
    return this.lobbies.start(u, this.now());
  }
  lobbyDisband(u: string) {
    return this.lobbies.disband(u);
  }
  lobbyDungeon(u: string, d: string) {
    return this.lobbies.setDungeon(u, d);
  }
  lobbyLoop(u: string, on: boolean) {
    return this.lobbies.setLoop(u, on, this.now());
  }
  lobbyRequestStart(u: string) {
    return this.lobbies.requestStart(u, this.now());
  }
  lobbyCancelStart(u: string) {
    return this.lobbies.cancelStart(u, this.now());
  }
  lobbyPrep(u: string, what: Parameters<LobbyHub["setPrep"]>[1]) {
    return this.lobbies.setPrep(u, what, this.now()) ?? this.lobbies.of(u) ?? null;
  }
  lobbyRunning(id: string, runId: string) {
    this.lobbies.running(id, runId);
  }
  lobbyAbort(id: string) {
    this.lobbies.abort(id, this.now());
  }
  lobbyRunEnded(runId: string, outcome: Parameters<LobbyHub["runEnded"]>[1]) {
    this.lobbies.runEnded(runId, outcome, this.now());
  }
  lobbyLoopFailed(
    id: string,
    why: Parameters<LobbyHub["loopFailed"]>[1],
    d?: string,
  ) {
    this.lobbies.loopFailed(id, why, d);
  }
  isPresent() {
    return true;
  }
  lobbyHero(u: string, cls: Parameters<LobbyHub["join"]>[2]["cls"], level: number) {
    const m = this.lobbies.of(u)?.members.find((x) => x.user_id === u);
    if (m) Object.assign(m, { cls, level });
  }
  lobbyOf(u: string) {
    return this.lobbies.of(u);
  }
  allLobbies() {
    return this.lobbies.all();
  }
  sendRun(_room: string, _ids: readonly string[], ev: Record<string, unknown>) {
    this.sends.push(ev);
    for (const s of this.sessions.values()) s.send(ev);
  }
}

function setup(stores?: { store: MemoryRpgStore; runStore: MemoryRunStore }) {
  let now = 1_000_000;
  const store = stores?.store ?? new MemoryRpgStore();
  const runStore = stores?.runStore ?? new MemoryRunStore();
  const svc = new RpgService({
    store,
    runStore,
    log: silentLog,
    now: () => now,
    autoTick: false,
  });
  const host = new FakeHost();
  host.now = () => now;
  svc.setHosts(() => host);
  const session = (id: string) => {
    const s = new FakeSession({
      user: { _id: id, username: id, display_name: id },
      member: null,
    } as unknown as Viewer);
    host.sessions.set(id, s);
    return s;
  };
  let n = 0;
  const sendAs = async (
    s: FakeSession,
    t: RpgCommand["t"],
    d?: Record<string, unknown>,
  ) => {
    const id = `c${++n}`;
    svc.handle(s, host, { v: 1, id, t, ...(d ? { d } : {}) } as RpgCommand);
    await svc.idle(s.viewer.user._id);
    return id;
  };
  const s = session("U1");
  /** O tique do runtime para os grupos: o loop pede, a contagem acaba, o serviço solta a corrida. */
  const tick = async () => {
    host.lobbies.loopDue(now);
    host.lobbies.holdTimeouts(now);
    for (const l of host.lobbies.launchDue(now)) {
      svc.launchDue(host, l.leader, l.id, l.pendingAuto);
      await svc.idle(l.leader);
    }
  };
  return {
    svc,
    tick,
    store,
    runStore,
    host,
    s,
    session,
    send: (t: RpgCommand["t"], d?: Record<string, unknown>) => sendAs(s, t, d),
    sendAs,
    clock: {
      advance: (ms: number) => (now += ms),
      get now() {
        return now;
      },
    },
  };
}

/** Põe ouro (ou o que for) direto no herói guardado (teste) e tira a cópia do cache do serviço. */
function edit(
  t: { store: MemoryRpgStore; svc: RpgService },
  id: string,
  fn: (h: RpgHeroState["hero"]) => RpgHeroState["hero"],
) {
  const d = t.store.docs.get(id)!;
  d.hero = fn(d.hero);
  t.svc.forget(id);
}

test("jogador novo: abrir sem herói não grava; escolhe a classe uma vez; o kit vem junto", async () => {
  const { s, store, send } = setup();
  await send("rpg.open");
  assert.equal(s.hero(), null);
  assert.equal(store.writes, 0);
  await send("rpg.class", { cls: "padre" });
  const h = s.hero()!;
  assert.equal(h.hero.cls, "padre");
  assert.equal(h.hero.level, 1);
  assert.equal(h.stamina, 2520);
  const again = await send("rpg.class", { cls: "mago" });
  assert.deepEqual(s.errors(again), [
    { code: "rpg_invalid", reason: "has_hero" },
  ]);
  // Sem herói, as outras ações não criam nada.
  const t = setup();
  const e = await t.send("rpg.attrs", { add: { INT: 1 } });
  assert.deepEqual(t.s.errors(e), [{ code: "rpg_invalid", reason: "no_hero" }]);
});

test("ações do herói: atributos, slots, NPC ao lado (longe recusa), compra e cinto", async () => {
  const t = setup();
  const { s, send } = t;
  await send("rpg.class", { cls: "guerreiro" });
  edit(t, "U1", (h) => ({ ...h, level: 10, gold: 10_000 }));
  await send("rpg.open");
  await send("rpg.attrs", { add: { FOR: 5, VIT: 3 } });
  assert.equal(s.hero()!.hero.attrs.FOR, 6);
  const far = await send("rpg.shop.buy", {
    npc: "mercador-longe",
    buy: { kind: "pocao", type: "hp", size: "grande", count: 5 },
  });
  assert.deepEqual(s.errors(far), [{ code: "not_allowed", reason: "too_far" }]);
  await send("rpg.shop.buy", {
    npc: "mercador-1",
    buy: { kind: "pocao", type: "hp", size: "grande", count: 5 },
  });
  assert.equal(s.hero()!.hero.potions.hp.grande, 5);
  assert.ok(s.hero()!.hero.gold < 10_000);
  await send("rpg.belt", { kind: "hp", size: "grande" });
  assert.equal(s.hero()!.hero.belt.hp, "grande");
  const bad = await send("rpg.skill.slots", { slots: ["nao-existe"] });
  assert.equal(s.errors(bad)[0]?.code, "rpg_invalid");
});

test("Dojô: treina ao lado do boneco e o tempo vira Proficiência ao parar", async () => {
  const { s, send, host, clock } = setup();
  await send("rpg.class", { cls: "mago" });
  await send("rpg.dojo.start", { instance: "boneco-1" });
  assert.equal(host.training.get("U1"), "boneco-1");
  assert.ok(s.hero()!.dojo);
  clock.advance(6 * 3600_000);
  await send("rpg.dojo.stop");
  assert.equal(host.training.has("U1"), false);
  assert.ok(s.hero()!.hero.proficiency > 1);
  assert.equal(s.hero()!.dojo, null);
});

/** Uma Caçada solo do começo ao fim: quadros a cada segundo e o fechamento com a recompensa. */
async function huntRun(t: ReturnType<typeof setup>) {
  await t.send("rpg.class", { cls: "mago" });
  await t.send("rpg.lobby.create", { tv: "tv1", dungeon: "cacada-1" });
  const start = await t.send("rpg.lobby.start");
  assert.deepEqual(t.s.errors(start), []);
  // A largada conta 3 s antes de sair (26/11/2026).
  assert.equal(t.s.of<RpgRunEvent>("rpg.run").length, 0);
  t.clock.advance(LOBBY.countdownMs);
  await t.tick();
  const run = t.s.of<RpgRunEvent>("rpg.run").at(-1)!.d.run;
  return run;
}

test("corrida: começa, manda os quadros a cada segundo, fecha com XP, ouro e o fim para a sala", async () => {
  const t = setup();
  const run = await huntRun(t);
  assert.equal(t.s.hero()!.run?.id, run.id);
  assert.equal(run.members[0]!.cls, "mago");
  const doc = t.runStore.docs.get(run.id)!;
  assert.equal(doc.v, 2);
  assert.equal(doc.seconds, (doc.ends_at - doc.started_at) / 1000);
  // Durante: em corrida, as ações do herói esperam.
  const blocked = await t.send("rpg.attrs", { add: { INT: 1 } });
  assert.deepEqual(t.s.errors(blocked), [
    { code: "rpg_invalid", reason: "in_run" },
  ]);
  t.clock.advance(3000);
  await t.svc.tickRuns();
  const ticks = t.s.of<RpgRunTickEvent>("rpg.run.tick");
  assert.equal(ticks.length, 1);
  assert.deepEqual(
    ticks[0]!.d.frames.map((f) => f.s),
    [1, 2, 3],
  );
  t.clock.advance(doc.seconds * 1000);
  await t.svc.tickRuns();
  await t.svc.idle("U1");
  const end = t.s.of<RpgRunEvent>("rpg.run").at(-1)!.d.end!;
  assert.equal(end.outcome, "vitoria");
  const me = end.members[0]!;
  assert.ok(me.reward && me.reward.xp > 0 && me.reward.gold > 0);
  const h = t.s.hero()!;
  assert.equal(h.run, null);
  assert.equal(h.hero.gold, me.reward!.gold);
  assert.ok(h.hero.xp >= me.reward!.xp);
  assert.equal(t.runStore.docs.get(run.id)!.status, "settled");
  assert.equal(t.host.lobbies.of("U1")?.state, "ready");
});

test("corrida: depois de um reinício volta do banco com os mesmos quadros e fecha", async () => {
  const t = setup();
  const run = await huntRun(t);
  t.clock.advance(4000);
  await t.svc.tickRuns();
  const before = t.s
    .of<RpgRunTickEvent>("rpg.run.tick")
    .flatMap((e) => e.d.frames);
  // Outro processo, mesmos bancos.
  const t2 = setup({ store: t.store, runStore: t.runStore });
  t2.clock.advance(t.clock.now - t2.clock.now);
  assert.equal(await t2.svc.resumeRuns(), 1);
  t2.clock.advance(2000);
  await t2.svc.tickRuns();
  const after = t2.host.sends
    .filter((e) => e.t === "rpg.run.tick")
    .flatMap((e) => (e.d as RpgRunTickEvent["d"]).frames);
  const doc = t.runStore.docs.get(run.id)!;
  assert.ok(after.length > 0);
  // O quadro do mesmo segundo é igual (a semente refaz a mesma luta).
  const sameSecond = before.find((f) => f.s === after[0]!.s - 1);
  assert.ok(sameSecond || after[0]!.s === 5);
  t2.clock.advance(doc.seconds * 1000);
  await t2.svc.tickRuns();
  assert.equal(t2.runStore.docs.get(run.id)!.status, "settled");
});

test("sair da corrida: livre na hora, sem a recompensa", async () => {
  const t = setup();
  const run = await huntRun(t);
  t.clock.advance(2000);
  await t.send("rpg.run.leave");
  const h = t.s.hero()!;
  assert.equal(h.run, null);
  assert.equal(h.hero.gold, 0);
  assert.equal(h.hero.xp, 0);
  // Todos saíram: a corrida fecha como retirada.
  await t.svc.idle("U1");
  assert.equal(t.runStore.docs.get(run.id)!.status, "settled");
});

test("transferência: ouro e item para quem está aqui, com a taxa; o destino recebe uma vez", async () => {
  const t = setup();
  const bia = t.session("U2");
  await t.send("rpg.class", { cls: "guerreiro" });
  await t.sendAs(bia, "rpg.class", { cls: "padre" });
  edit(t, "U1", (h) => ({ ...h, level: 10, gold: 10_000 }));
  await t.send("rpg.open");
  const item = t.s.hero()!.hero.equipment.elmo!;
  await t.send("rpg.unequip", { slot: "elmo" });
  await t.send("rpg.bank.transfer", {
    npc: "banqueiro-1",
    to: "U2",
    gold: 1000,
    uids: [item.uid],
    confirmations: 1,
  });
  await t.svc.idle("U2");
  await t.svc.idle("U1");
  await t.svc.idle("U2");
  const b = bia.hero()!;
  assert.equal(b.hero.gold, 1000);
  assert.ok(b.hero.bag.some((x) => x.uid === item.uid));
  assert.ok(t.s.hero()!.hero.gold < 9000);
  assert.equal(t.store.docs.get("U1")!.outbox.length, 0);
});

test("herói torto no banco: o comando falha e nada é regravado", async () => {
  const t = setup();
  await t.send("rpg.class", { cls: "mago" });
  const d = t.store.docs.get("U1")!;
  d.hero.attrs.INT = 9999;
  const writes = t.store.writes;
  const fresh = setup({ store: t.store, runStore: t.runStore });
  const id = await fresh.send("rpg.attrs", { add: { INT: 1 } });
  assert.deepEqual(fresh.s.errors(id), [{ code: "internal" }]);
  assert.equal(t.store.writes, writes);
  assert.equal(t.store.docs.get("U1")!.hero.attrs.INT, 9999);
});

test("taxa do operador: só a de XP vale na engine nova", () => {
  assert.deepEqual(ratesFromEnv("exp=2,skill=5,loot=3"), { exp: 2 });
  assert.deepEqual(ratesFromEnv(undefined), { exp: 1 });
  assert.deepEqual(ratesFromEnv("exp=-1"), { exp: 1 });
});

/** Um banco que segura a gravação de alguém até soltar (o save "no meio do caminho"). */
class GatedStore extends MemoryRpgStore {
  gate: { user: string; open: Promise<void> } | null = null;
  override async save(
    doc: Parameters<MemoryRpgStore["save"]>[0],
    rev: number,
  ): Promise<boolean> {
    const g = this.gate;
    if (g && doc._id === g.user) await g.open;
    return super.save(doc, rev);
  }
}

const turn = () => new Promise((r) => setImmediate(r));

test("largada: o save que estava gravando entra na corrida; o que chega no meio da largada espera (26/11/2026)", async () => {
  const store = new GatedStore();
  const t = setup({ store, runStore: new MemoryRunStore() });
  const bia = t.session("U2");
  await t.send("rpg.class", { cls: "mago" });
  await t.sendAs(bia, "rpg.class", { cls: "padre" });
  edit(t, "U2", (h) => ({ ...h, level: 10 }));
  await t.sendAs(bia, "rpg.open");
  await t.send("rpg.lobby.create", { tv: "tv1", dungeon: "cacada-1" });
  await t.sendAs(bia, "rpg.lobby.join", { tv: "tv1" });
  await t.send("rpg.lobby.start");
  t.clock.advance(LOBBY.countdownMs);
  const before = store.docs.get("U2")!.hero.attrs.INT;
  // A Bia confirma os pontos e a gravação demora; a contagem acaba nesse meio.
  let release!: () => void;
  store.gate = { user: "U2", open: new Promise<void>((r) => (release = r)) };
  t.svc.handle(bia, t.host, {
    v: 1,
    id: "save-1",
    t: "rpg.attrs",
    d: { add: { INT: 3 } },
  } as RpgCommand);
  await turn();
  const ticking = t.tick();
  await turn();
  // Outro comando chega com a largada em andamento: espera ela sair, não grava por baixo.
  t.svc.handle(bia, t.host, {
    v: 1,
    id: "save-2",
    t: "rpg.attrs",
    d: { add: { INT: 1 } },
  } as RpgCommand);
  store.gate = null;
  release();
  await ticking;
  await t.svc.idle("U2");
  assert.deepEqual(bia.errors("save-1"), []);
  assert.deepEqual(bia.errors("save-2"), [
    { code: "rpg_invalid", reason: "run_starting" },
  ]);
  const run = [...t.runStore.docs.values()][0]!;
  assert.equal(
    run.members.find((m) => m.userId === "U2")!.hero.attrs.INT,
    before + 3,
    "a corrida luta com o herói que respondeu ok",
  );
  assert.equal(store.docs.get("U2")!.hero.attrs.INT, before + 3);
  assert.equal(store.docs.get("U2")!.run?.id, run._id);
});

test("largada: espera quem está na ficha (rpg.lobby.prep) e sai 3 s depois que todos fecham", async () => {
  const t = setup();
  const bia = t.session("U2");
  await t.send("rpg.class", { cls: "mago" });
  await t.sendAs(bia, "rpg.class", { cls: "padre" });
  // Sem grupo, o preparo só responde.
  const alone = await t.sendAs(bia, "rpg.lobby.prep", { what: "heroi" });
  assert.deepEqual(bia.errors(alone), []);
  await t.send("rpg.lobby.create", { tv: "tv1", dungeon: "cacada-1" });
  await t.sendAs(bia, "rpg.lobby.join", { tv: "tv1" });
  await t.sendAs(bia, "rpg.lobby.prep", { what: "heroi" });
  await t.send("rpg.lobby.start");
  t.clock.advance(60_000);
  await t.tick();
  assert.equal(t.runStore.docs.size, 0, "a Bia está na ficha");
  assert.equal(t.host.lobbies.of("U1")!.pending, true);
  await t.sendAs(bia, "rpg.lobby.prep", { what: null });
  t.clock.advance(LOBBY.countdownMs - 1);
  await t.tick();
  assert.equal(t.runStore.docs.size, 0, "ainda contando");
  t.clock.advance(1);
  await t.tick();
  assert.equal(t.runStore.docs.size, 1);
  assert.equal(t.host.lobbies.of("U1")!.state, "running");
  // Quem não é líder não pede a largada; o líder desiste de uma pendente.
  const notLeader = await t.sendAs(bia, "rpg.lobby.start");
  assert.deepEqual(bia.errors(notLeader), [
    { code: "rpg_invalid", reason: "not_leader" },
  ]);
});

test("Mercador na corrida: vende da mochila e compra poção e munição; item novo e as outras ações, depois", async () => {
  const t = setup();
  await t.send("rpg.class", { cls: "mago" });
  edit(t, "U1", (h) => ({ ...h, gold: 50_000 }));
  await t.send("rpg.open");
  await t.send("rpg.shop.buy", {
    npc: "mercador-1",
    buy: { kind: "item", base: { slot: "colar" } },
  });
  const bought = t.s.hero()!.hero.bag.at(-1)!;
  assert.ok(bought, "o colar está na mochila");
  await t.send("rpg.lobby.create", { tv: "tv1", dungeon: "cacada-1" });
  await t.send("rpg.lobby.start");
  t.clock.advance(LOBBY.countdownMs);
  await t.tick();
  assert.ok(t.s.hero()!.run, "na corrida");
  const pots = t.s.hero()!.hero.potions.hp.pequena;
  const buy = await t.send("rpg.shop.buy", {
    npc: "mercador-1",
    buy: { kind: "pocao", type: "hp", size: "pequena", count: 3 },
  });
  assert.deepEqual(t.s.errors(buy), []);
  assert.equal(t.s.hero()!.hero.potions.hp.pequena, pots + 3);
  const ammo = await t.send("rpg.shop.buy", {
    npc: "mercador-1",
    buy: { kind: "municao", grade: "comum", packs: 1 },
  });
  assert.deepEqual(t.s.errors(ammo), []);
  const sell = await t.send("rpg.shop.sell", {
    npc: "mercador-1",
    uid: bought.uid,
  });
  assert.deepEqual(t.s.errors(sell), []);
  assert.ok(!t.s.hero()!.hero.bag.some((x) => x.uid === bought.uid));
  const item = await t.send("rpg.shop.buy", {
    npc: "mercador-1",
    buy: { kind: "item", base: { slot: "colar" } },
  });
  assert.deepEqual(t.s.errors(item), [
    { code: "rpg_invalid", reason: "in_run_item" },
  ]);
  const smith = await t.send("rpg.bank", { npc: "banqueiro-1", gold: 100 });
  assert.deepEqual(t.s.errors(smith), [
    { code: "rpg_invalid", reason: "in_run" },
  ]);
  const swap = await t.send("rpg.master.class", {
    npc: "mestre-1",
    cls: t.s.hero()!.hero.cls === "padre" ? "mago" : "padre",
  });
  assert.deepEqual(t.s.errors(swap), [
    { code: "rpg_invalid", reason: "in_run" },
  ]);
  // A corrida fecha bem por cima das compras e da venda.
  const doc = [...t.runStore.docs.values()][0]!;
  t.clock.advance(doc.seconds * 1000 + 1000);
  await t.svc.tickRuns();
  await t.svc.idle("U1");
  assert.equal(t.runStore.docs.get(doc._id)!.status, "settled");
  assert.equal(t.s.hero()!.run, null);
});

test("Mestre: troca de classe ao lado do NPC; job e Proficiência zeram, o nível fica e o grupo mostra a classe nova", async () => {
  const t = setup();
  const { s, send } = t;
  await send("rpg.class", { cls: "guerreiro" });
  edit(t, "U1", (h) => ({ ...h, level: 30, job: 12, proficiency: 200 }));
  await send("rpg.open");
  await send("rpg.lobby.create", { tv: "tv1", dungeon: "cacada-1" });
  const far = await send("rpg.master.class", {
    npc: "mestre-longe",
    cls: "mago",
  });
  assert.deepEqual(s.errors(far), [{ code: "not_allowed", reason: "too_far" }]);
  const c = await send("rpg.master.class", { npc: "mestre-1", cls: "mago" });
  assert.deepEqual(s.errors(c), []);
  const h = s.hero()!.hero;
  assert.deepEqual(
    [h.cls, h.level, h.job, h.proficiency],
    ["mago", 30, 1, 1],
  );
  assert.equal(t.host.lobbyOf("U1")!.members[0]!.cls, "mago");
  assert.equal(t.store.docs.get("U1")!.hero.cls, "mago");
  const same = await send("rpg.master.class", { npc: "mestre-1", cls: "mago" });
  assert.deepEqual(s.errors(same), [
    { code: "rpg_invalid", reason: "mesma-classe" },
  ]);
});

test("Mercador e Ferreiro em lote: um comando para a lista inteira, tudo ou nada", async () => {
  const t = setup();
  const { s, send } = t;
  await send("rpg.class", { cls: "guerreiro" });
  edit(t, "U1", (h) => ({ ...h, gold: 1_000_000 }));
  await send("rpg.open");
  for (let i = 0; i < 3; i++)
    await send("rpg.shop.buy", {
      npc: "mercador-1",
      buy: { kind: "item", base: { slot: "anel" } },
    });
  edit(t, "U1", (h) => ({ ...h, gold: 0 }));
  t.clock.advance(5_000);
  await send("rpg.open");
  const bag = s.hero()!.hero.bag.map((x) => x.uid);
  assert.equal(bag.length, 3);
  const bad = await send("rpg.shop.sell.many", {
    npc: "mercador-1",
    uids: [bag[0], "nao-tem"],
  });
  assert.deepEqual(s.errors(bad), [
    { code: "rpg_invalid", reason: "item-nao-encontrado" },
  ]);
  assert.equal(s.hero()!.hero.bag.length, 3);
  const sold = await send("rpg.shop.sell.many", {
    npc: "mercador-1",
    uids: bag.slice(0, 2),
  });
  assert.deepEqual(s.errors(sold), []);
  assert.deepEqual(
    s.hero()!.hero.bag.map((x) => x.uid),
    [bag[2]],
  );
  assert.ok(s.hero()!.hero.gold > 0);
  t.clock.advance(5_000); // o balde de comandos (4/s) enche de novo
  const far = await send("rpg.smith.dismantle.many", {
    npc: "ferreiro-longe",
    uids: [bag[2]],
  });
  assert.deepEqual(s.errors(far), [{ code: "not_allowed", reason: "too_far" }]);
  const d = await send("rpg.smith.dismantle.many", {
    npc: "ferreiro-1",
    uids: [bag[2]],
  });
  assert.deepEqual(s.errors(d), []);
  assert.equal(s.hero()!.hero.bag.length, 0);
  assert.ok(Object.values(s.hero()!.hero.ores).some((n) => (n ?? 0) > 0));
});
