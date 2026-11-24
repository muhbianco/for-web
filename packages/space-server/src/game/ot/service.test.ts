import assert from "node:assert/strict";
import test from "node:test";

import {
  type RpgCommand,
  type RpgHeroView,
  DEFAULT_SUPPLIES,
  coinValue,
  potionCounts,
  potionsAt,
  simulateRun,
} from "@muchat/space-core/game/ot";

import { silentLog } from "../../log.ts";
import type { SessionPort, Viewer } from "../../space/runtime.ts";
import { LobbyHub } from "./lobby.ts";
import { MemoryRunStore } from "./runs.ts";
import { type RpgHost, RpgService, ratesFromEnv } from "./service.ts";
import { MemoryRpgStore } from "./store.ts";

const H = 3_600_000;

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
  states() {
    return this.events
      .filter((e) => e.t === "rpg.state")
      .map((e) => (e.d as { hero: RpgHeroView | null }).hero);
  }
  lastHero() {
    return this.states().at(-1) ?? null;
  }
  errors(re: string) {
    return this.events
      .filter((e) => e.t === "error" && e.re === re)
      .map((e) => e.d);
  }
}

class FakeHost implements RpgHost {
  readonly serverId = "S1";
  access: "ok" | "disabled" | "not_allowed" = "ok";
  near = true;
  readonly training = new Map<string, string>();
  /** Treino nos dois dummies: o outro dummy de cada um. */
  readonly trainingAlso = new Map<string, string>();
  readonly sessions = new Map<string, SessionPort>();
  gameAccess() {
    return this.access;
  }
  /**
   * Dummies: "nope" não existe; "hab…" é de habilidade; "…outra" fica em outra sala; "…longe"
   * fica além do alcance do segundo dummy (só o "near" olha isso).
   */
  trainSpot(_v: Viewer, instanceId: string, reach: "beside" | "near" = "beside") {
    if (instanceId === "nope") return { ok: false as const, code: "not_found" };
    const far = reach === "near" ? instanceId.endsWith("longe") : !this.near;
    if (far) return { ok: false as const, code: "not_allowed", reason: "too_far" };
    return {
      ok: true as const,
      zone: instanceId.endsWith("outra") ? "room:R2" : "room:R1",
      dummy: instanceId.startsWith("hab") ? ("habilidade" as const) : ("vocacao" as const),
    };
  }
  /** NPCs: "nope" não existe; "longe" fica longe; o tipo vem do prefixo ("banqueiro-1"). */
  npcSpot(_v: Viewer, instanceId: string, kind: string) {
    if (instanceId === "nope" || !instanceId.startsWith(kind))
      return { ok: false as const, code: "not_found" };
    if (instanceId.endsWith("longe"))
      return { ok: false as const, code: "not_allowed", reason: "too_far" };
    return { ok: true as const };
  }
  isTrainingAt(userId: string, instanceId: string, also?: string) {
    return (
      this.training.get(userId) === instanceId &&
      (this.trainingAlso.get(userId) ?? null) === (also ?? null)
    );
  }
  setTraining(userId: string, instanceId: string | null, also?: string) {
    if (instanceId === null) this.training.delete(userId);
    else this.training.set(userId, instanceId);
    if (instanceId !== null && also) this.trainingAlso.set(userId, also);
    else this.trainingAlso.delete(userId);
  }
  readonly levels = new Map<string, number | null>();
  readonly looks = new Map<string, unknown>();
  setHero(userId: string, look: { level: number } | null) {
    this.levels.set(userId, look?.level ?? null);
    this.looks.set(userId, look);
  }
  tvNear = true;
  readonly lobbies = new LobbyHub();
  displayName(userId: string) {
    return userId === "U1" ? "Ana" : "Bia";
  }
  tvSpot(_v: Viewer, tv: string) {
    if (tv === "nope") return { ok: false as const, code: "not_found" };
    return this.tvNear
      ? { ok: true as const, room: "R1" }
      : { ok: false as const, code: "not_allowed", reason: "too_far" };
  }
  lobbyCreate(
    tv: string,
    room: string,
    dungeon: string,
    member: Parameters<LobbyHub["create"]>[3],
  ) {
    return this.lobbies.create(tv, room, dungeon, member, this.now());
  }
  lobbyJoin(tv: string, id: string | undefined, member: Parameters<LobbyHub["join"]>[2]) {
    return this.lobbies.join(tv, id, member);
  }
  lobbyLeave(userId: string) {
    this.lobbies.leave(userId);
  }
  /** O relógio do serviço (o setup liga). */
  now: () => number = () => 1;
  lobbyStart(userId: string, _auto?: boolean) {
    return this.lobbies.start(userId, this.now());
  }
  lobbyDisband(userId: string) {
    return this.lobbies.disband(userId);
  }
  lobbyDungeon(userId: string, dungeon: string) {
    return this.lobbies.setDungeon(userId, dungeon);
  }
  lobbyLoop(userId: string, on: boolean) {
    return this.lobbies.setLoop(userId, on, this.now());
  }
  lobbyRunning(id: string, runId: string) {
    this.lobbies.running(id, runId);
  }
  lobbyAbort(id: string) {
    this.lobbies.abort(id, this.now());
  }
  lobbyRunEnded(runId: string, outcome: "vitoria" | "derrota" | "retirada", levels: Record<string, number>) {
    const l = this.lobbies.runEnded(runId, outcome, this.now());
    if (l) for (const m of l.members) if (levels[m.user_id] !== undefined) m.level = levels[m.user_id]!;
  }
  lobbyLoopFailed(id: string, why: "derrota" | "retirada" | "start_failed" | "offline" | "leader_left" | "retreat", detail?: string) {
    this.lobbies.loopFailed(id, why, detail);
  }
  /** Quem está "no mapa" (sessão aberta); `absent` tira alguém. */
  readonly absent = new Set<string>();
  isPresent(userId: string) {
    return !this.absent.has(userId);
  }
  lobbyOf(userId: string) {
    return this.lobbies.of(userId);
  }
  allLobbies() {
    return this.lobbies.all();
  }
  /** Todas as sessões estão na sala R1. */
  readonly runSends: Array<{ room: string; ev: Record<string, unknown> }> = [];
  sendRun(room: string, userIds: readonly string[], ev: Record<string, unknown>) {
    this.runSends.push({ room, ev });
    const seen = new Set<SessionPort>();
    for (const s of this.sessions.values()) {
      seen.add(s);
      s.send(ev);
    }
    for (const id of userIds) {
      const s = this.sessions.get(id);
      if (s && !seen.has(s)) s.send(ev);
    }
  }
  sessionOf(userId: string) {
    return this.sessions.get(userId) ?? null;
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
  const viewer = {
    user: { _id: "U1", username: "ana", display_name: "Ana" },
    member: null,
  } as unknown as Viewer;
  const s = new FakeSession(viewer);
  host.sessions.set("U1", s);
  let n = 0;
  const send = async (t: RpgCommand["t"], d?: Record<string, unknown>) => {
    const id = `c${++n}`;
    svc.handle(s, host, { v: 1, id, t, ...(d ? { d } : {}) } as RpgCommand);
    await svc.idle("U1");
    return id;
  };
  return {
    svc,
    store,
    runStore,
    host,
    s,
    send,
    clock: {
      set: (t: number) => (now = t),
      advance: (ms: number) => (now += ms),
      get now() {
        return now;
      },
    },
  };
}

test("abrir sem herói não grava nada; o herói nasce no primeiro uso", async () => {
  const { s, store, send } = await setup();
  await send("rpg.open");
  assert.equal(s.lastHero(), null);
  assert.equal(store.writes, 0);
  await send("rpg.vocation", { vocation: 4 });
  assert.equal(s.lastHero()?.vocation, 4);
  assert.equal(store.writes, 1);
});

test("treinar: perto do dummy começa; longe ou sem vocação é recusado", async () => {
  const { s, host, send } = await setup();
  const a = await send("rpg.train.start", { instance: "d1", skill: "espada" });
  assert.deepEqual(s.errors(a), [
    { code: "rpg_invalid", reason: "no_vocation" },
  ]);
  await send("rpg.vocation", { vocation: 4 });
  host.near = false;
  const b = await send("rpg.train.start", { instance: "d1", skill: "espada" });
  assert.deepEqual(s.errors(b), [{ code: "not_allowed", reason: "too_far" }]);
  const c = await send("rpg.train.start", {
    instance: "nope",
    skill: "espada",
  });
  assert.deepEqual(s.errors(c), [{ code: "not_found" }]);
  host.near = true;
  await send("rpg.train.start", { instance: "d1", skill: "espada" });
  assert.equal(s.lastHero()?.training?.instance, "d1");
  assert.equal(host.training.get("U1"), "d1");
});

test("treinar nos dois dummies: o outro na mesma sala e perto, de outro tipo; o mapa sabe dos dois", async () => {
  const { s, host, send, clock } = await setup();
  await send("rpg.vocation", { vocation: 4 });
  const far = await send("rpg.train.start", { instance: "d1", skill: "espada", with: "hab-longe" });
  assert.deepEqual(s.errors(far), [{ code: "not_allowed", reason: "too_far" }]);
  const room = await send("rpg.train.start", { instance: "d1", skill: "espada", with: "hab-outra" });
  assert.deepEqual(s.errors(room), [{ code: "not_allowed", reason: "too_far" }]);
  const same = await send("rpg.train.start", { instance: "d1", skill: "espada", with: "d2" });
  assert.deepEqual(s.errors(same), [{ code: "rpg_invalid", reason: "same_dummy" }]);
  const gone = await send("rpg.train.start", { instance: "d1", skill: "espada", with: "nope" });
  assert.deepEqual(s.errors(gone), [{ code: "not_found" }]);
  assert.equal(host.training.has("U1"), false);
  // Ao lado do dummy de habilidade, com o de vocação perto: vale também.
  await send("rpg.train.start", { instance: "hab-1", skill: "espada", with: "d1" });
  const hero = s.lastHero()!;
  assert.equal(hero.training?.instance, "hab-1");
  assert.equal(hero.training?.also, "d1");
  assert.equal(host.training.get("U1"), "hab-1");
  assert.equal(host.trainingAlso.get("U1"), "d1");
  // Reabrir com o runtime vendo os dois: o treino segue.
  clock.advance(H);
  await send("rpg.open");
  assert.equal(s.lastHero()?.training?.also, "d1");
  // O runtime perdeu o segundo dummy (reinício, outro caminho): fecha ao abrir, creditando.
  host.trainingAlso.delete("U1");
  await send("rpg.open");
  const closed = s.lastHero()!;
  assert.equal(closed.training, null);
  assert.ok(closed.skills.espada.level > 10);
  assert.ok(closed.skill_points.earned > 0);
});

test("parar credita o tempo treinado; sair de perto do dummy também", async () => {
  const { s, host, send, svc, clock } = await setup();
  await send("rpg.vocation", { vocation: 4 });
  await send("rpg.train.start", { instance: "d1", skill: "espada" });
  clock.advance(H);
  await send("rpg.train.stop");
  const after = s.lastHero()!;
  assert.equal(after.training, null);
  assert.ok(after.skills.espada.level > 10);
  assert.equal(host.training.has("U1"), false);
  // De novo, e desta vez o runtime avisa que ele saiu de perto.
  await send("rpg.train.start", { instance: "d1", skill: "espada" });
  clock.advance(H);
  host.training.delete("U1");
  svc.trainingLeft(host, "U1");
  await svc.idle("U1");
  const left = s.lastHero()!;
  assert.equal(left.training, null);
  assert.ok(left.skills.espada.level > after.skills.espada.level);
});

test("treino que ficou para trás (reconexão, reinício) fecha ao abrir, creditando até agora", async () => {
  const { s, host, send, clock } = await setup();
  await send("rpg.vocation", { vocation: 3 });
  await send("rpg.train.start", { instance: "d1", skill: "distancia" });
  // A pessoa desconecta e o servidor reinicia: o runtime não sabe mais do treino.
  host.training.clear();
  clock.advance(3 * H);
  await send("rpg.open");
  const h = s.lastHero()!;
  assert.equal(h.training, null);
  assert.ok(h.skills.distancia.level > 10);
  // Sem limite de treino (24/11/2026): o saldo continua cheio.
  assert.ok(h.bank_ms > 365 * 24 * H);
});

test("reenvio do mesmo comando não age de novo; jogo desligado e sem permissão recusam", async () => {
  const { s, host, svc, store } = await setup();
  const cmd = {
    v: 1,
    id: "same",
    t: "rpg.vocation",
    d: { vocation: 2 },
  } as RpgCommand;
  svc.handle(s, host, cmd);
  await svc.idle("U1");
  svc.handle(s, host, cmd);
  await svc.idle("U1");
  assert.equal(store.writes, 1);
  assert.equal(s.errors("same").length, 0);
  host.access = "disabled";
  svc.handle(s, host, { v: 1, id: "x1", t: "rpg.open" } as RpgCommand);
  assert.deepEqual(s.errors("x1"), [{ code: "game_disabled" }]);
  host.access = "not_allowed";
  svc.handle(s, host, { v: 1, id: "x2", t: "rpg.open" } as RpgCommand);
  assert.deepEqual(s.errors("x2"), [{ code: "not_allowed" }]);
});

test("taxas do operador pelo ambiente; valores ruins ficam no padrão", () => {
  // A experiência padrão é 1,5 desde 24/11/2026 (a curva de anos, até o 500).
  assert.deepEqual(ratesFromEnv(undefined), {
    exp: 1.5,
    skill: 2,
    magic: 2,
    loot: 2,
  });
  assert.deepEqual(ratesFromEnv("skill=1, magic=3,exp=10"), {
    exp: 10,
    skill: 1,
    magic: 3,
    loot: 2,
  });
  assert.deepEqual(ratesFromEnv("skill=0,loot=abc,foo=9,exp=99999"), {
    exp: 1.5,
    skill: 2,
    magic: 2,
    loot: 2,
  });
});

test("o level do herói vai para o avatar: ao mudar e quando a pessoa entra", async () => {
  const { host, send, svc } = await setup();
  host.levels.clear();
  svc.avatarJoined(host, "U1");
  await svc.idle("U1");
  assert.equal(host.levels.get("U1"), null);
  await send("rpg.vocation", { vocation: 4 });
  assert.equal(host.levels.get("U1"), 1);
  host.levels.clear();
  svc.avatarJoined(host, "U1");
  await svc.idle("U1");
  assert.equal(host.levels.get("U1"), 1);
});

test("grupo na TV: exige vocação e estar ao lado; cria, outra pessoa entra, só o líder começa", async () => {
  const { s: ana, host, send, svc } = await setup();
  const a = await send("rpg.lobby.create", {
    tv: "tv1",
    dungeon: "cripta-do-musgo",
  });
  assert.deepEqual(ana.errors(a), [
    { code: "rpg_invalid", reason: "no_vocation" },
  ]);
  await send("rpg.vocation", { vocation: 4 });
  host.tvNear = false;
  const b = await send("rpg.lobby.create", {
    tv: "tv1",
    dungeon: "cripta-do-musgo",
  });
  assert.deepEqual(ana.errors(b), [{ code: "not_allowed", reason: "too_far" }]);
  host.tvNear = true;
  const c = await send("rpg.lobby.create", {
    tv: "tv1",
    dungeon: "galerias-afogadas",
  });
  assert.deepEqual(ana.errors(c), [{ code: "rpg_invalid", reason: "level" }]);
  await send("rpg.lobby.create", { tv: "tv1", dungeon: "cripta-do-musgo" });
  assert.equal(host.lobbies.of("U1")?.leader, "U1");
  assert.deepEqual(
    host.lobbies.of("U1")?.members.map((m) => [m.name, m.vocation, m.level]),
    [["Ana", 4, 1]],
  );
  // Bia (outra conta) entra pelo mesmo serviço.
  const biaViewer = {
    user: { _id: "U2", username: "bia", display_name: "Bia" },
    member: null,
  } as unknown as Viewer;
  const bia = new FakeSession(biaViewer);
  svc.handle(bia, host, {
    v: 1,
    id: "b1",
    t: "rpg.vocation",
    d: { vocation: 3 },
  } as RpgCommand);
  await svc.idle("U2");
  svc.handle(bia, host, {
    v: 1,
    id: "b2",
    t: "rpg.lobby.join",
    d: { tv: "tv1" },
  } as RpgCommand);
  await svc.idle("U2");
  assert.deepEqual(
    host.lobbies.of("U1")?.members.map((m) => m.user_id),
    ["U1", "U2"],
  );
  svc.handle(bia, host, { v: 1, id: "b3", t: "rpg.lobby.start" } as RpgCommand);
  await svc.idle("U2");
  assert.deepEqual(bia.errors("b3"), [
    { code: "rpg_invalid", reason: "not_leader" },
  ]);
  await send("rpg.lobby.start");
  // 24/11/2026: o grupo fica montado, correndo.
  assert.equal(host.lobbies.of("U1")?.state, "running");
  assert.ok(host.lobbies.of("U1")?.runId, "a corrida gravada fica no grupo");
  const started = ana.events.filter((e) => e.t === "rpg.lobby").at(-1)!.d as {
    ended?: string;
    lobby?: { state?: string } | null;
  };
  assert.equal(started.ended, "started");
  assert.equal(started.lobby?.state, "running");
});

test("grupo que fica: a corrida fecha e ele volta pronto; o loop começa a próxima sozinho e para sem ninguém", async () => {
  const env = await startedRun();
  const { svc, host, clock, send, ana, biaSend, bia } = env;
  const [first] = svc.activeRuns();
  clock.advance(first!.seconds * 1000 + 1000);
  await svc.tickRuns();
  await svc.idle("U1");
  await svc.idle("U2");
  const l = host.lobbies.of("U1")!;
  assert.equal(l.state, "ready");
  assert.equal(l.runs, 1);
  assert.equal(l.last, first!.outcome);
  // Só o líder liga o loop e troca a dungeon.
  await biaSend("b20", "rpg.lobby.loop", { on: true });
  assert.deepEqual(bia.errors("b20"), [{ code: "rpg_invalid", reason: "not_leader" }]);
  const d = await send("rpg.lobby.dungeon", { dungeon: "galerias-afogadas" });
  assert.deepEqual(ana.errors(d), [{ code: "rpg_invalid", reason: "level" }]);
  await send("rpg.lobby.loop", { on: true });
  assert.equal(l.loop, true);
  assert.ok(l.nextAt !== null, "pronto e com loop: a próxima marcada");
  // O loop venceu: começa pelo líder, marcada como automática.
  svc.loopDue(host, "U1", host.lobbies.of("U1")!.id);
  await svc.idle("U1");
  await svc.idle("U2");
  const runs = svc.activeRuns();
  assert.equal(runs.length, 1);
  assert.notEqual(runs[0]!._id, first!._id);
  assert.equal(runs[0]!.auto, true);
  assert.equal(l.state, "running");
  // Fecha; ninguém do grupo no mapa na hora da próxima: o loop para, com o motivo.
  clock.advance(runs[0]!.seconds * 1000 + 1000);
  await svc.tickRuns();
  await svc.idle("U1");
  await svc.idle("U2");
  if (l.loop) {
    host.absent.add("U1");
    host.absent.add("U2");
    svc.loopDue(host, "U1", host.lobbies.of("U1")!.id);
    await svc.idle("U1");
    assert.deepEqual([l.loop, l.stopped], [false, "offline"]);
    assert.equal(svc.activeRuns().length, 0);
  } else {
    // A segunda corrida perdeu: o loop parou sozinho pelo resultado.
    assert.ok(l.stopped === "derrota" || l.stopped === "retirada");
  }
  // Desfazer: só o líder; solta os dois.
  await send("rpg.lobby.leave", { disband: true });
  assert.equal(host.lobbies.of("U1"), undefined);
});

/** Ana (cavaleiro) e Bia (feiticeira) montam o grupo na TV; Ana começa. */
async function startedRun(env = setup()) {
  const { s: ana, host, send, svc } = env;
  await send("rpg.vocation", { vocation: 4 });
  await send("rpg.lobby.create", { tv: "tv1", dungeon: "cripta-do-musgo" });
  const bia = new FakeSession({
    user: { _id: "U2", username: "bia", display_name: "Bia" },
    member: null,
  } as unknown as Viewer);
  host.sessions.set("U2", bia);
  const biaSend = async (id: string, t: RpgCommand["t"], d?: Record<string, unknown>) => {
    svc.handle(bia, host, { v: 1, id, t, ...(d ? { d } : {}) } as RpgCommand);
    await svc.idle("U2");
  };
  await biaSend("b1", "rpg.vocation", { vocation: 1 });
  await biaSend("b2", "rpg.lobby.join", { tv: "tv1" });
  await send("rpg.lobby.start");
  await svc.idle("U2");
  return { ...env, ana, bia, biaSend };
}

test("corrida: começa marcando os dois, chega à sala e só manda o segundo quando ele chega", async () => {
  const { ana, bia, svc, store, runStore, clock, send, biaSend } = await startedRun();
  const [run] = svc.activeRuns();
  assert.ok(run, "a corrida está em andamento");
  assert.equal(runStore.docs.get(run._id)?.status, "running");
  assert.equal(run.heroes.length, 2);
  assert.deepEqual(
    run.heroes.map((h) => [h.name, h.vocation, h.gear.weapon]),
    [
      ["Ana", 4, "machadinha"],
      ["Bia", 1, "varinha-de-faiscas"],
    ],
  );
  for (const id of ["U1", "U2"])
    assert.equal((await store.get(id))?.run?.id, run._id, `${id} marcado`);
  assert.equal(ana.lastHero()?.run?.id, run._id);
  // Os dois recebem a corrida com o segundo 0.
  const first = ana.events.find((e) => e.t === "rpg.run")!.d as {
    run: { members: { supplies?: unknown }[] };
    frame: { s: number } | null;
    potions?: Record<string, number>[];
  };
  assert.equal(first.run.members.length, 2);
  assert.equal(first.frame?.s, 0);
  // O cinto (24/11/2026): o limite de cada um e as poções no segundo do quadro.
  assert.deepEqual(
    first.run.members.map((m) => m.supplies),
    run.heroes.map((h) => h.supplies ?? DEFAULT_SUPPLIES),
  );
  assert.equal(first.potions?.length, 2);
  assert.ok(bia.events.some((e) => e.t === "rpg.run"));
  // Na dungeon não dá para treinar nem montar outro grupo.
  const tr = await send("rpg.train.start", { instance: "d1", skill: "espada" });
  assert.deepEqual(ana.errors(tr), [{ code: "rpg_invalid", reason: "in_run" }]);
  await biaSend("b9", "rpg.lobby.create", { tv: "tv2", dungeon: "cripta-do-musgo" });
  assert.deepEqual(bia.errors("b9"), [{ code: "rpg_invalid", reason: "in_run" }]);
  // Sem o relógio andar, nada novo; três segundos depois, três quadros de uma vez.
  await svc.tickRuns();
  assert.equal(ana.events.filter((e) => e.t === "rpg.run.tick").length, 0);
  clock.advance(3_000);
  await svc.tickRuns();
  const tick = ana.events.find((e) => e.t === "rpg.run.tick")!.d as {
    frames: { s: number }[];
  };
  assert.deepEqual(
    tick.frames.map((f) => f.s),
    [1, 2, 3].filter((s) => s < run.seconds),
  );
});

test("corrida: fecha no fim uma vez só, com a recompensa gravada no início", async () => {
  const env = await startedRun();
  const { svc, store, runStore, clock, ana } = env;
  const [run] = svc.activeRuns();
  const before = await store.get("U1");
  clock.set(run!.ends_at);
  await svc.tickRuns();
  assert.equal(svc.activeRuns().length, 0);
  assert.equal(runStore.docs.get(run!._id)?.status, "settled");
  const after = (await store.get("U1"))!;
  assert.equal(after.run, null);
  const reward = run!.rewards[0];
  assert.equal(after.experience, before!.experience + (reward?.exp ?? 0));
  assert.equal(
    coinValue(after.inv),
    coinValue(before!.inv) + (reward?.gold ?? 0),
  );
  assert.equal(after.stamina, before!.stamina - Math.ceil(run!.seconds / 60));
  const end = ana.events.filter((e) => e.t === "rpg.run").at(-1)!.d as {
    end?: { outcome: string; members: { user_id: string; reward: unknown }[] };
  };
  assert.equal(end.end?.outcome, run!.outcome);
  assert.deepEqual(
    end.end?.members.map((m) => m.user_id),
    ["U1", "U2"],
  );
  // Um segundo fechamento (outro processo, retomada) não credita de novo.
  const second = setup({ store, runStore });
  runStore.docs.get(run!._id)!.status = "running";
  assert.equal(await second.svc.resumeRuns(), 1);
  second.clock.set(run!.ends_at + 1);
  await second.svc.tickRuns();
  const again = (await store.get("U1"))!;
  assert.equal(again.experience, after.experience);
  assert.equal(coinValue(again.inv), coinValue(after.inv));
  assert.equal(again.stamina, after.stamina);
});

test("corrida: volta depois de reinício com os mesmos quadros e fecha na hora", async () => {
  const env = await startedRun();
  const [run] = env.svc.activeRuns();
  // Outro processo sobe com os mesmos bancos no meio da corrida.
  const next = setup({ store: env.store, runStore: env.runStore });
  next.clock.set(run!.started_at + 2_000);
  assert.equal(await next.svc.resumeRuns(), 1);
  // Quem entra na sala recebe a corrida até o segundo de agora.
  const caio = new FakeSession({
    user: { _id: "U3", username: "caio", display_name: "Caio" },
    member: null,
  } as unknown as Viewer);
  next.host.sessions.set("U3", caio);
  next.svc.roomEntered(next.host, "U3", "R1");
  const snap = caio.events.find((e) => e.t === "rpg.run")!.d as {
    frame: { s: number } | null;
    feed: { at: number }[];
    potions?: Record<string, number>[];
  };
  assert.equal(snap.frame?.s, Math.min(2, run!.seconds - 1));
  assert.ok(snap.feed.every((f) => f.at <= 2));
  // Quem chega no meio recebe as poções do segundo de agora, não as do começo.
  const frames = simulateRun({
    seed: run!.seed,
    dungeon: run!.dungeon,
    heroes: run!.heroes,
    rateLoot: run!.rate_loot,
  }).frames;
  assert.deepEqual(snap.potions, potionsAt(run!.heroes, frames, snap.frame!.s));
  assert.deepEqual(
    potionsAt(run!.heroes, frames, -1),
    run!.heroes.map((h) => potionCounts(h.inv.pack)),
  );
  next.svc.roomEntered(next.host, "U3", "OUTRA");
  assert.equal(caio.events.filter((e) => e.t === "rpg.run").length, 1);
  next.clock.set(run!.ends_at);
  await next.svc.tickRuns();
  assert.equal((await env.store.get("U2"))?.run, null);
  assert.equal(env.runStore.docs.get(run!._id)?.status, "settled");
});

test("inventário pelo serviço: veste, recusa a pilha que mudou e a dungeon; o fim grava o inventário da corrida", async () => {
  const env = setup();
  const { s, send, store, svc, clock } = env;
  await send("rpg.vocation", { vocation: 4 });
  const i = s.lastHero()!.inventory.pack.findIndex((x) => x.item === "porrete");
  const bad = await send("rpg.equip", { index: i, item: "espada-curta" });
  assert.deepEqual(s.errors(bad), [{ code: "rpg_invalid", reason: "changed" }]);
  await send("rpg.equip", { index: i, item: "porrete" });
  assert.equal(s.lastHero()?.inventory.equip.arma?.item, "porrete");
  assert.equal(s.lastHero()?.auto_equip, false);
  await send("rpg.auto", { on: true });
  assert.equal(s.lastHero()?.auto_equip, true);
  await startedRun(env);
  const [run] = svc.activeRuns();
  const u = await send("rpg.unequip", { slot: "pes" });
  assert.deepEqual(s.errors(u), [{ code: "rpg_invalid", reason: "in_run" }]);
  clock.set(run!.ends_at);
  await svc.tickRuns();
  const after = (await store.get("U1"))!;
  const res = run!.results[0]!;
  const expected = run!.rewards[0] ? res.inv : res.invBare;
  // O automático só troca de lugar: as mesmas coisas, nas mesmas quantidades.
  const totals = (inv: typeof expected) => {
    const m = new Map<string, number>();
    for (const x of [...Object.values(inv.equip), ...inv.pack])
      if (x) m.set(x.item, (m.get(x.item) ?? 0) + x.count);
    return [...m.entries()].sort();
  };
  assert.deepEqual(totals(after.inv), totals(expected));
});

/** Põe ouro no banco direto no banco de dados (como se tivesse caçado). */
async function fund(store: MemoryRpgStore, id: string, gold: number) {
  const d = (await store.get(id))!;
  d.bank_gold = gold;
  assert.ok(await store.save({ ...d, rev: d.rev + 1 }, d.rev));
}

function biaIn(host: FakeHost) {
  const bia = new FakeSession({
    user: { _id: "U2", username: "bia", display_name: "Bia" },
    member: null,
  } as unknown as Viewer);
  host.sessions.set("U2", bia);
  return bia;
}

async function settleAll(svc: RpgService) {
  for (let i = 0; i < 4; i++) {
    await svc.idle("U1");
    await svc.idle("U2");
  }
}

test("NPCs pelo serviço: o NPC certo e ao lado; compra, banco e transferência entregue uma vez", async () => {
  const first = setup();
  await first.send("rpg.vocation", { vocation: 3 });
  const bia0 = biaIn(first.host);
  first.svc.handle(bia0, first.host, {
    v: 1,
    id: "b1",
    t: "rpg.vocation",
    d: { vocation: 2 },
  } as RpgCommand);
  await first.svc.idle("U2");
  await fund(first.store, "U1", 1_000);
  // Outro processo, com o banco já atualizado.
  const env = setup({ store: first.store, runStore: first.runStore });
  const { s: ana, send, store, svc, host } = env;
  const far = await send("rpg.shop.buy", {
    npc: "mercador-longe",
    item: "flecha",
    count: 10,
  });
  assert.deepEqual(ana.errors(far), [
    { code: "not_allowed", reason: "too_far" },
  ]);
  const wrong = await send("rpg.shop.buy", {
    npc: "banqueiro-1",
    item: "flecha",
    count: 10,
  });
  assert.deepEqual(ana.errors(wrong), [{ code: "not_found" }]);
  await send("rpg.shop.buy", { npc: "mercador-1", item: "flecha", count: 100 });
  assert.equal(ana.lastHero()?.bank_gold, 800);
  await send("rpg.bank.withdraw", { npc: "banqueiro-1", amount: 300 });
  assert.equal(ana.lastHero()?.gold, 300);
  assert.equal(ana.lastHero()?.bank_gold, 500);
  // Transferência: só para quem está no Espaço agora.
  const nobody = await send("rpg.bank.transfer", {
    npc: "banqueiro-1",
    amount: 100,
    to: "U2",
  });
  assert.deepEqual(ana.errors(nobody), [
    { code: "rpg_invalid", reason: "not_here" },
  ]);
  const bia = biaIn(host);
  const self = await send("rpg.bank.transfer", {
    npc: "banqueiro-1",
    amount: 100,
    to: "U1",
  });
  assert.deepEqual(ana.errors(self), [{ code: "rpg_invalid", reason: "self" }]);
  await send("rpg.bank.transfer", { npc: "banqueiro-1", amount: 200, to: "U2" });
  await settleAll(svc);
  assert.equal((await store.get("U2"))?.bank_gold, 200);
  const a = (await store.get("U1"))!;
  assert.equal(a.bank_gold, 300);
  assert.deepEqual(a.outbox, [], "entregue, sai da fila");
  assert.equal(bia.lastHero()?.bank_gold, 200, "quem recebe vê na hora");
});

test("transferência: duas cruzadas não travam; caída no meio é entregue na volta, uma vez só", async () => {
  const first = setup();
  await first.send("rpg.vocation", { vocation: 4 });
  const bia0 = biaIn(first.host);
  first.svc.handle(bia0, first.host, {
    v: 1,
    id: "b1",
    t: "rpg.vocation",
    d: { vocation: 1 },
  } as RpgCommand);
  await first.svc.idle("U2");
  await fund(first.store, "U1", 500);
  await fund(first.store, "U2", 500);
  const env = setup({ store: first.store, runStore: first.runStore });
  const { store, svc, host } = env;
  const bia = biaIn(host);
  // Ao mesmo tempo, uma para a outra.
  svc.handle(env.s, host, {
    v: 1,
    id: "x1",
    t: "rpg.bank.transfer",
    d: { npc: "banqueiro-1", amount: 100, to: "U2" },
  } as RpgCommand);
  svc.handle(bia, host, {
    v: 1,
    id: "x2",
    t: "rpg.bank.transfer",
    d: { npc: "banqueiro-1", amount: 300, to: "U1" },
  } as RpgCommand);
  await settleAll(svc);
  assert.equal((await store.get("U1"))?.bank_gold, 700);
  assert.equal((await store.get("U2"))?.bank_gold, 300);
  // Caiu entre o débito e o crédito: a transferência ficou na fila de saída.
  const a = (await store.get("U1"))!;
  a.bank_gold -= 50;
  a.outbox = [{ id: "caiu", to: "U2", amount: 50, at: 0 }];
  assert.ok(await store.save({ ...a, rev: a.rev + 1 }, a.rev));
  const next = setup({ store, runStore: env.runStore });
  await next.send("rpg.open");
  await settleAll(next.svc);
  assert.equal((await store.get("U2"))?.bank_gold, 350);
  assert.deepEqual((await store.get("U1"))?.outbox, []);
  // A mesma fila de novo (se a baixa tivesse falhado): não credita duas vezes.
  const b = (await store.get("U1"))!;
  b.outbox = [{ id: "caiu", to: "U2", amount: 50, at: 0 }];
  assert.ok(await store.save({ ...b, rev: b.rev + 1 }, b.rev));
  const again = setup({ store, runStore: env.runStore });
  await again.send("rpg.open");
  await settleAll(again.svc);
  assert.equal((await store.get("U2"))?.bank_gold, 350);
  assert.equal((await store.get("U1"))?.bank_gold, 650);
});

test("dungeon começa: quem treinava para de treinar também no mapa (a marca não fica para trás)", async () => {
  const env = setup();
  const { send, host, svc } = env;
  await send("rpg.vocation", { vocation: 4 });
  // Ana treina e, sem sair do treino, monta o grupo na TV (o dojo tem a TV a poucos tiles do dummy).
  await send("rpg.train.start", { instance: "d1", skill: "espada" });
  assert.equal(host.training.get("U1"), "d1");
  await send("rpg.lobby.create", { tv: "tv1", dungeon: "cripta-do-musgo" });
  const bia = new FakeSession({
    user: { _id: "U2", username: "bia", display_name: "Bia" },
    member: null,
  } as unknown as Viewer);
  host.sessions.set("U2", bia);
  const biaSend = async (id: string, t: RpgCommand["t"], d?: Record<string, unknown>) => {
    svc.handle(bia, host, { v: 1, id, t, ...(d ? { d } : {}) } as RpgCommand);
    await svc.idle("U2");
  };
  await biaSend("b1", "rpg.vocation", { vocation: 1 });
  await biaSend("b2", "rpg.train.start", { instance: "d2", skill: "magia" });
  assert.equal(host.training.get("U2"), "d2");
  await biaSend("b3", "rpg.lobby.join", { tv: "tv1" });
  await send("rpg.lobby.start");
  await svc.idle("U2");
  assert.equal(svc.activeRuns().length, 1);
  assert.equal(host.training.has("U1"), false, "a líder");
  assert.equal(host.training.has("U2"), false, "quem entrou no grupo");
});

test("quadro do Idle Hunt: partidas rodando e grupos abertos no Espaço; assistir de outra sala", async () => {
  const env = await startedRun();
  const { svc, host, clock } = env;
  const caio = new FakeSession({
    user: { _id: "U3", username: "caio", display_name: "Caio" },
    member: null,
  } as unknown as Viewer);
  host.sessions.set("U3", caio);
  const caioSend = async (id: string, t: RpgCommand["t"], d?: Record<string, unknown>) => {
    svc.handle(caio, host, { v: 1, id, t, ...(d ? { d } : {}) } as RpgCommand);
    await svc.idle("U3");
  };
  await caioSend("c1", "rpg.vocation", { vocation: 2 });
  await caioSend("c2", "rpg.lobby.create", { tv: "tv2", dungeon: "cripta-do-musgo" });
  await caioSend("c3", "rpg.board");
  const board = caio.events.find((e) => e.t === "rpg.board" && e.re === "c3")!.d as {
    lobbies: { tv: string; members: { name: string }[] }[];
    runs: { id: string; dungeon: string; members: { name: string }[] }[];
  };
  const [run] = svc.activeRuns();
  assert.deepEqual(
    board.runs.map((r) => [r.id, r.dungeon, r.members.map((m) => m.name)]),
    [[run!._id, "cripta-do-musgo", ["Ana", "Bia"]]],
  );
  assert.deepEqual(board.lobbies.map((l) => l.tv), ["tv2"]);
  // Assistir: a corrida inteira até agora, e "sem partida" para o que não existe.
  await caioSend("c4", "rpg.run.watch", { id: run!._id });
  const snap = caio.events.find((e) => e.t === "rpg.run" && e.re === "c4");
  assert.ok(snap, "a partida chega para quem assiste");
  await caioSend("c5", "rpg.run.watch", { id: "nada" });
  assert.deepEqual(caio.errors("c5"), [{ code: "rpg_invalid", reason: "no_run" }]);
  clock.advance(2_000);
  await svc.tickRuns();
  assert.ok(caio.events.some((e) => e.t === "rpg.run.tick"));
});

test("sair da corrida: livre na hora, sem a recompensa e com a mochila do começo; todos saindo, ela acaba", async () => {
  const env = await startedRun();
  const { svc, store, host, clock, send, ana, bia, biaSend } = env;
  const [run] = svc.activeRuns();
  const before = structuredClone((await store.get("U2"))!);
  host.lobbies.setLoop("U1", true, clock.now);
  clock.advance(5_000);
  await biaSend("b30", "rpg.run.leave");
  assert.deepEqual(bia.errors("b30"), []);
  // O loop para: a próxima traria Bia de volta.
  assert.deepEqual(
    [host.lobbies.of("U1")!.loop, host.lobbies.of("U1")!.stopped],
    [false, "retreat"],
  );
  const b = (await store.get("U2"))!;
  assert.equal(b.run, null, "Bia livre");
  assert.equal(b.experience, before.experience);
  assert.equal(b.level, before.level);
  assert.deepEqual(b.inv, before.inv, "a mochila do começo");
  assert.ok(b.stamina <= before.stamina);
  // Ana segue na corrida; Bia de novo: não está em corrida.
  assert.equal((await store.get("U1"))!.run?.id, run!._id);
  await biaSend("b31", "rpg.run.leave");
  assert.deepEqual(bia.errors("b31"), [{ code: "rpg_invalid", reason: "no_run" }]);
  // Ana sai também: a corrida acaba agora, como retirada, sem recompensa para ninguém.
  await send("rpg.run.leave");
  await svc.idle("U1");
  await svc.idle("U2");
  assert.equal(svc.activeRuns().length, 0);
  const end = ana.events.filter((e) => e.t === "rpg.run").at(-1)!.d as {
    end?: { outcome: string; members: { retreated?: boolean; reward: unknown }[] };
  };
  assert.equal(end.end?.outcome, "retirada");
  assert.deepEqual(
    end.end?.members.map((m) => [m.retreated, m.reward]),
    [
      [true, null],
      [true, null],
    ],
  );
  const l = host.lobbies.of("U1")!;
  assert.deepEqual([l.state, l.last], ["ready", "retirada"]);
});

test("vários grupos na mesma TV: com o grupo de Ana em corrida, Caio monta o dele ali", async () => {
  const env = await startedRun();
  const { svc, host } = env;
  const caio = new FakeSession({
    user: { _id: "U3", username: "caio", display_name: "Caio" },
    member: null,
  } as unknown as Viewer);
  host.sessions.set("U3", caio);
  const caioSend = async (id: string, t: RpgCommand["t"], d?: Record<string, unknown>) => {
    svc.handle(caio, host, { v: 1, id, t, ...(d ? { d } : {}) } as RpgCommand);
    await svc.idle("U3");
  };
  await caioSend("c1", "rpg.vocation", { vocation: 2 });
  await caioSend("c2", "rpg.lobby.create", { tv: "tv1", dungeon: "cripta-do-musgo" });
  assert.deepEqual(caio.errors("c2"), []);
  assert.equal(host.lobbies.atTv("tv1").length, 2);
  assert.notEqual(host.lobbies.of("U3")!.id, host.lobbies.of("U1")!.id);
  // A resposta traz o id do grupo dele.
  const ev = caio.events.find((e) => e.t === "rpg.lobby" && e.re === "c2")!.d as { id?: string };
  assert.equal(ev.id, host.lobbies.of("U3")!.id);
});
