import assert from "node:assert/strict";
import test from "node:test";

import type { RpgCommand, RpgHeroView } from "@muchat/space-core/game/ot";

import { silentLog } from "../../log.ts";
import type { SessionPort, Viewer } from "../../space/runtime.ts";
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
  readonly sessions = new Map<string, SessionPort>();
  gameAccess() {
    return this.access;
  }
  trainSpot(_v: Viewer, instanceId: string) {
    if (instanceId === "nope") return { ok: false as const, code: "not_found" };
    return this.near
      ? { ok: true as const, zone: "room:R1" }
      : { ok: false as const, code: "not_allowed", reason: "too_far" };
  }
  isTrainingAt(userId: string, instanceId: string) {
    return this.training.get(userId) === instanceId;
  }
  setTraining(userId: string, instanceId: string | null) {
    if (instanceId === null) this.training.delete(userId);
    else this.training.set(userId, instanceId);
  }
  sessionOf(userId: string) {
    return this.sessions.get(userId) ?? null;
  }
}

function setup() {
  let now = 1_000_000;
  const store = new MemoryRpgStore();
  const svc = new RpgService({ store, log: silentLog, now: () => now });
  const host = new FakeHost();
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
    host,
    s,
    send,
    clock: {
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
  assert.equal(h.bank_ms, 9 * H);
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
  assert.deepEqual(ratesFromEnv(undefined), {
    exp: 5,
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
    exp: 5,
    skill: 2,
    magic: 2,
    loot: 2,
  });
});
