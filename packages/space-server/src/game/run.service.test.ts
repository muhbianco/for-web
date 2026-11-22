import assert from "node:assert/strict";
import { test } from "node:test";

import { fight, type GameCommand, RULES } from "@muchat/space-core/game";

import { silentLog } from "../log.ts";
import type { SessionPort, Viewer } from "../space/runtime.ts";
import { docBytes, DOC_MAX_BYTES } from "./hero.ts";
import { type GameHost, GameService } from "./service.ts";
import { MemoryGameStore } from "./store.ts";

// Refúgio (ADR 0009, etapa E3): a expedição no servidor.

const SRV = "01JSRV00000000000000000000";
const KEY = "00112233445566778899aabbccddeeff";
const LOOK = { skin: 0, hair: 0, outfit: 0, trim: 0, cosmetic: null };
const host: GameHost = { serverId: SRV, gameAccess: () => "ok" };

function rig(store = new MemoryGameStore(), clock = { t: 1_800_000_000_000 }) {
  const svc = new GameService({ store, log: silentLog, now: () => clock.t, random: () => 7, newKey: () => KEY });
  return { svc, store, clock };
}

function player(userId: string) {
  const sent: Record<string, any>[] = [];
  const s: SessionPort = {
    viewer: { user: { _id: userId, username: userId }, member: { _id: { server: SRV, user: userId }, roles: [] } } as Viewer,
    send: (e) => void sent.push(e),
    close: () => {},
  };
  let seq = 0;
  return {
    s,
    sent,
    // Respostas como `any`: o teste lê os campos do protocolo direto.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async ask(svc: GameService, t: GameCommand["t"], d?: unknown): Promise<{ state: any; fight: any; error: any }> {
      const id = `${t}-${++seq}`;
      svc.handle(s, host, { v: 1, t, id, ...(d === undefined ? {} : { d }) } as GameCommand);
      await svc.idle(userId);
      const mine = sent.filter((m) => m.re === id);
      return { state: mine.find((m) => m.t === "game.state"), fight: mine.find((m) => m.t === "game.fight"), error: mine.find((m) => m.t === "error") };
    },
  };
}

type Player = ReturnType<typeof player>;

/** Joga a expedição aberta até o fim com uma política simples; espera cada luta passar. */
async function finish(p: Player, r: ReturnType<typeof rig>, maxSteps = 60) {
  for (let i = 0; i < maxSteps; i++) {
    const st = p.sent.filter((m) => m.t === "game.state").at(-1)!;
    const run = st.d.hero.run;
    if (!run) return st.d.hero;
    const o = run.offer;
    const [t, d] =
      o && o.kind !== "loja"
        ? (["game.run.choose", { option: o.kind === "evento" ? 1 : o.kind === "descanso" ? 0 : 0 }] as const)
        : (["game.run.go", { lane: run.lanes[0] }] as const);
    let res = await p.ask(r.svc, t, d);
    if (res.error?.d.code === "game_busy") {
      r.clock.t += res.error.d.retry_after_ms;
      res = await p.ask(r.svc, t, d);
    }
    assert.ok(!res.error, `passo ${i}: ${JSON.stringify(res.error?.d)}`);
  }
  throw new Error("expedição não terminou");
}

test("expedição: a iniciação vai de ponta a ponta e libera o Normal de verdade", async () => {
  const r = rig();
  const p = player("01JANA00000000000000000000");
  await p.ask(r.svc, "game.create", { cls: "cavaleiro", look: LOOK });
  // Pedir Difícil no começo não importa: a primeira é a iniciação.
  const start = await p.ask(r.svc, "game.run.start", { degree: "dificil" });
  assert.ok(start.state, JSON.stringify(start.error?.d));
  const run = start.state.d.hero.run;
  assert.equal(run.initiation, true);
  assert.equal(run.degree, "normal");
  assert.equal(run.map.length, 5);
  assert.equal(start.state.d.hero.potions, 0, "as poções foram com o herói");
  assert.equal(run.potions, RULES.maxPotions);
  const hero = await finish(p, r);
  assert.equal(hero.last_run.end, "vitoria");
  assert.equal(hero.last_run.initiation, true);
  assert.equal(hero.initiation_done, true);
  assert.equal(hero.best, 0, "a iniciação não libera o Difícil");
  assert.ok(hero.level >= 2, `nível ${hero.level}`);
  assert.ok(hero.skills.espada.l > 1);
  assert.equal(hero.stats.runs, 1);
  assert.equal(hero.stats.wins, 1);
  // Começar outra também espera a última luta (o chefe) terminar de passar.
  const busy = await p.ask(r.svc, "game.run.start", { degree: "dificil" });
  assert.equal(busy.error.d.code, "game_busy");
  r.clock.t += busy.error.d.retry_after_ms;
  const locked = await p.ask(r.svc, "game.run.start", { degree: "dificil" });
  assert.deepEqual(locked.error.d, { code: "game_invalid", reason: "locked" });
});

test("expedição: depois de uma luta, o próximo passo espera duração/4 (game_busy com retry_after_ms)", async () => {
  const r = rig();
  const p = player("01JB1A00000000000000000000");
  await p.ask(r.svc, "game.create", { cls: "arqueiro", look: LOOK });
  await p.ask(r.svc, "game.run.start", { degree: "normal" });
  const first = await p.ask(r.svc, "game.run.go", { lane: 0 }); // iniciação: linha 1 é combate
  assert.ok(first.fight, "a primeira sala é luta");
  const wait = Math.ceil(first.fight.d.result.durationMs / RULES.replaySpeedMax);
  assert.equal(first.fight.d.busy_until, r.clock.t + wait);
  assert.equal(first.state.d.hero.run.busy_until, r.clock.t + wait);
  const lane = first.state.d.hero.run.lanes[0];
  const early = await p.ask(r.svc, "game.run.go", { lane });
  assert.equal(early.error.d.code, "game_busy");
  assert.equal(early.error.d.retry_after_ms, wait);
  r.clock.t += wait - 1;
  assert.equal((await p.ask(r.svc, "game.run.go", { lane })).error.d.retry_after_ms, 1);
  r.clock.t += 1;
  const ok = await p.ask(r.svc, "game.run.go", { lane });
  assert.ok(ok.state, JSON.stringify(ok.error?.d));
  // O app reanima a luta com a mesma função e chega ao mesmo resultado.
  assert.deepEqual(fight(first.fight.d.input), first.fight.d.result);
});

test("expedição: a chave secreta fica no banco e não sai em nenhum evento", async () => {
  const r = rig();
  const p = player("01JCA100000000000000000000");
  await p.ask(r.svc, "game.create", { cls: "feiticeiro", look: LOOK });
  await p.ask(r.svc, "game.run.start", { degree: "normal" });
  assert.equal(r.store.docs.get("01JCA100000000000000000000")!.run!.key, KEY);
  await finish(p, r);
  assert.ok(p.sent.length > 5);
  for (const m of p.sent) assert.ok(!JSON.stringify(m).includes(KEY), `vazou em ${m.t}`);
  assert.ok(p.sent.some((m) => m.t === "game.fight"));
});

test("expedição: morrer guarda a experiência e metade do ouro, perde os itens, volta com 1 de vida", async () => {
  const r = rig();
  const id = "01JD00M0000000000000000000";
  const p = player(id);
  await p.ask(r.svc, "game.create", { cls: "druida", look: LOOK });
  const doc = r.store.docs.get(id)!;
  doc.initiation_done = true;
  doc.best = 40; // Abismo 37 liberado
  doc.gold = 10;
  doc.rev++;
  const fresh = rig(r.store, r.clock);
  const start = await p.ask(fresh.svc, "game.run.start", { degree: "abismo", abyss: 37 });
  assert.ok(start.state, JSON.stringify(start.error?.d));
  const stored = r.store.docs.get(id)!;
  stored.run!.state.bagGold = 101;
  stored.run!.state.bagItems = [structuredClone(stored.gear.elmo!)];
  stored.rev++;
  const again = rig(r.store, r.clock);
  const step = await p.ask(again.svc, "game.run.go", { lane: 0 });
  assert.ok(step.fight);
  assert.equal(step.fight.d.result.won, false);
  const hero = step.state.d.hero;
  assert.equal(hero.run, null);
  assert.equal(hero.last_run.end, "morte");
  assert.equal(hero.gold, 10 + 50);
  assert.equal(hero.bag.length, 0);
  assert.equal(hero.hp, 1);
  assert.equal(hero.stats.deaths, 1);
  // Primeiro a luta termina de passar; depois, com 1 de vida, não começa outra:
  // espera a regeneração (30% em 3 min).
  r.clock.t += Math.ceil(step.fight.d.result.durationMs / RULES.replaySpeedMax);
  const hurt = await p.ask(again.svc, "game.run.start", { degree: "normal" });
  assert.deepEqual(hurt.error.d, { code: "game_invalid", reason: "hurt" });
  r.clock.t += 3 * 60_000;
  const later = await p.ask(again.svc, "game.run.start", { degree: "normal" });
  assert.ok(later.state, JSON.stringify(later.error?.d));
});

test("expedição: durante a expedição o boneco para e o Refúgio recusa equipar, comprar e treinar", async () => {
  const r = rig();
  const id = "01JE00000000000000000000AA";
  const p = player(id);
  await p.ask(r.svc, "game.create", { cls: "cavaleiro", look: LOOK });
  await p.ask(r.svc, "game.run.start", { degree: "normal" });
  const before = r.store.docs.get(id)!.skills.espada;
  r.clock.t += 6 * 3_600_000;
  const open = await p.ask(r.svc, "game.open");
  assert.deepEqual(open.state.d.hero.skills.espada.l, before.l, "o boneco não treinou");
  const kit = open.state.d.hero.gear.elmo.id;
  for (const [t, d] of [
    ["game.unequip", { slot: "elmo" }],
    ["game.equip", { item: kit }],
    ["game.buy", { offer: "potion", qty: 1 }],
    ["game.train", { skill: "escudo" }],
    ["game.run.start", { degree: "normal" }],
  ] as const) {
    const res = await p.ask(r.svc, t, d);
    assert.equal(res.error?.d.reason, "on_run", t);
  }
  // Terminar retoma o boneco a partir de agora (as 6 h da expedição não contam).
  await p.ask(r.svc, "game.run.abandon");
  const back = r.store.docs.get(id)!;
  assert.equal(back.run, null);
  assert.equal(back.training.since, r.clock.t);
  assert.equal(back.last_run!.end, "morte", "abandonar conta como morte");
});

test("expedição: o restart no meio da expedição continua de onde parou, com a espera da luta", async () => {
  const store = new MemoryGameStore();
  const clock = { t: 1_800_000_000_000 };
  const a = rig(store, clock);
  const id = "01JF00000000000000000000AA";
  const p = player(id);
  await p.ask(a.svc, "game.create", { cls: "arqueiro", look: LOOK });
  await p.ask(a.svc, "game.run.start", { degree: "normal" });
  const first = await p.ask(a.svc, "game.run.go", { lane: 1 });
  assert.ok(first.fight);
  // Processo novo (deploy): mesmo store, sem cache.
  const b = rig(store, clock);
  const busy = await p.ask(b.svc, "game.run.go", { lane: 1 });
  assert.equal(busy.error.d.code, "game_busy", "a espera sobrevive ao restart");
  clock.t += busy.error.d.retry_after_ms;
  const open = await p.ask(b.svc, "game.open");
  assert.equal(open.state.d.hero.run.row, 0);
  const hero = await finish(p, b);
  assert.equal(hero.last_run.initiation, true);
});

test("expedição: retirada só no descanso permitido, e guarda a bolsa inteira", async () => {
  const r = rig();
  const id = "01JG00000000000000000000AA";
  const p = player(id);
  await p.ask(r.svc, "game.create", { cls: "cavaleiro", look: LOOK });
  const no = await p.ask(r.svc, "game.run.retreat");
  assert.deepEqual(no.error.d, { code: "game_invalid", reason: "no_run" });
  await p.ask(r.svc, "game.run.start", { degree: "normal" });
  const d = r.store.docs.get(id)!;
  d.run!.state.offer = { kind: "descanso", retreat: false };
  d.rev++;
  const r2 = rig(r.store, r.clock);
  assert.deepEqual((await p.ask(r2.svc, "game.run.retreat")).error.d, { code: "game_invalid", reason: "no_retreat" });
  const d2 = r.store.docs.get(id)!;
  d2.run!.state.offer = { kind: "descanso", retreat: true };
  d2.run!.state.bagGold = 77;
  d2.run!.state.bagItems = [structuredClone(d2.gear.botas!)];
  d2.rev++;
  const r3 = rig(r.store, r.clock);
  const out = await p.ask(r3.svc, "game.run.retreat");
  const hero = out.state.d.hero;
  assert.equal(hero.last_run.end, "retirada");
  assert.equal(hero.gold, 77);
  assert.equal(hero.bag.length, 1);
  assert.equal(hero.initiation_done, false, "retirar-se da iniciação não conta como vencer");
});

test("expedição: robô joga 1.000 expedições sem erro, o documento fica no limite e o comando é barato", async () => {
  const r = rig();
  const players = ["01JR0B0T000000000000000001", "01JR0B0T000000000000000002", "01JR0B0T000000000000000003", "01JR0B0T000000000000000004"].map(player);
  const classes = ["cavaleiro", "arqueiro", "feiticeiro", "druida"] as const;
  for (const [i, p] of players.entries()) await p.ask(r.svc, "game.create", { cls: classes[i], look: LOOK });
  const times: number[] = [];
  let runs = 0;
  let maxBytes = 0;
  const ends = { vitoria: 0, morte: 0, retirada: 0 } as Record<string, number>;
  const timed = async (p: Player, t: GameCommand["t"], d?: unknown) => {
    const t0 = process.hrtime.bigint();
    const res = await p.ask(r.svc, t, d);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    return res;
  };
  while (runs < 1000) {
    for (const [i, p] of players.entries()) {
      const id = p.s.viewer.user._id;
      const doc = r.store.docs.get(id)!;
      // Joga no Normal, com a vida cheia (espera os 10 min da regeneração), e vende o que sobra.
      if (doc.bag.length > 30) await timed(p, "game.sell", { items: doc.bag.slice(0, 20).map((x) => x.id) });
      if (doc.pending.length) await timed(p, "game.sell", { items: doc.pending.map((x) => x.id) });
      if (doc.potions < 3 && doc.gold > 100) await timed(p, "game.buy", { offer: "potion", qty: 3 - doc.potions });
      const degree = "normal";
      r.clock.t += RULES.regenFullMs;
      let st = await timed(p, "game.run.start", { degree });
      if (st.error?.d.reason === "hurt" || st.error?.d.code === "game_busy") {
        r.clock.t += 11 * 60_000;
        st = await timed(p, "game.run.start", { degree });
      }
      assert.ok(st.state, `robô ${i}: ${JSON.stringify(st.error?.d)}`);
      for (let step = 0; step < 60; step++) {
        const hero = p.sent.filter((m) => m.t === "game.state").at(-1)!.d.hero;
        if (!hero.run) break;
        const o = hero.run.offer;
        const [t, d] =
          o && o.kind !== "loja"
            ? (["game.run.choose", { option: o.kind === "bencao" ? 0 : o.kind === "descanso" ? (hero.run.hp * 100 < hero.run.max_hp * 70 ? 0 : 1) : 1 }] as const)
            : (["game.run.go", { lane: hero.run.lanes[step % hero.run.lanes.length] }] as const);
        let res = await timed(p, t, d);
        if (res.error?.d.code === "game_busy") {
          r.clock.t += res.error.d.retry_after_ms;
          res = await timed(p, t, d);
        }
        assert.ok(!res.error, `robô ${i}, passo ${step}: ${JSON.stringify(res.error?.d)}`);
      }
      maxBytes = Math.max(maxBytes, docBytes(r.store.docs.get(id)!));
      const end = r.store.docs.get(id)!.last_run?.end;
      if (end) ends[end] = (ends[end] ?? 0) + 1;
      runs++;
      // A memória das respostas não precisa crescer no teste.
      p.sent.splice(0, Math.max(0, p.sent.length - 5));
    }
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)]!;
  const p99 = times[Math.floor(times.length * 0.99)]!;
  const levels = players.map((p) => r.store.docs.get(p.s.viewer.user._id)!.level);
  console.log(`ROBO ${runs} expedições (${JSON.stringify(ends)}), ${times.length} comandos, p50 ${p50.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, máx ${times[times.length - 1]!.toFixed(1)} ms, documento máx ${maxBytes} B, níveis ${levels}`);
  assert.ok(maxBytes < DOC_MAX_BYTES, `${maxBytes} bytes`);
  // Folgado (máquina do CI e store em memória): a meta da ADR é < 1 ms de CPU por comando.
  assert.ok(p99 < 20, `p99 ${p99} ms`);
  assert.ok(levels.every((l) => l > 5), `níveis ${levels}`);
  assert.ok(ends.vitoria! > runs / 2, `vitórias ${ends.vitoria}`);
});
