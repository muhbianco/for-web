import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { randomSource } from "../combat/fight.ts";
import { type FighterInput, FOE_BASE } from "../combat/types.ts";
import type { ClassId } from "../content.ts";
import { DUNGEONS, dungeonById } from "../dungeons/catalog.ts";
import { limitEncounters as E } from "../sim/encounters.ts";
import { addFrame, cloneMeter, meterOf } from "./meter.ts";
import { simulateRun } from "./simulate.ts";

// Quadros da corrida para a tela (Fase 8): um por segundo, com os eventos daquele segundo.

const SPEC = { source: "spec", referenceAi: "gabarito" } as const;
const party = (classes: ClassId[], L: number): FighterInput[] =>
  classes.map((c) => E.fighter(c, L, SPEC));
const REF: ClassId[] = ["guerreiro", "padre", "mago", "cacador"];

test("gravar os quadros não muda a corrida", () => {
  const d = dungeonById("masmorra-110")!;
  for (const mode of ["esperado", "aleatorio"] as const) {
    const opts = (seed: number) =>
      mode === "esperado"
        ? { mode }
        : { mode, random: randomSource(new Rng(seed)) };
    const plain = simulateRun(d, party(REF, 110), opts(7));
    const rec = simulateRun(d, party(REF, 110), { ...opts(7), record: true });
    assert.equal(rec.outcome, plain.outcome, mode);
    assert.equal(rec.seconds, plain.seconds, mode);
    assert.deepEqual(rec.heroes, plain.heroes, mode);
    assert.deepEqual(
      rec.rooms.map((r) => r.kills),
      plain.rooms.map((r) => r.kills),
      mode,
    );
    assert.equal(plain.frames, undefined);
  }
});

test("um quadro por segundo, sala anunciada, sem descanso entre as salas e XP em cada abate", () => {
  const d = dungeonById("masmorra-70")!;
  const r = simulateRun(d, party(REF, 70), { mode: "esperado", record: true });
  const f = r.frames!;
  assert.equal(r.outcome, "vitoria");
  f.forEach((x, i) => assert.equal(x.s, i + 1, `quadro ${i}`));
  // A corrida inteira cabe nos quadros (só as salas, em segundos inteiros).
  assert.ok(
    f.length >= Math.floor(r.seconds) && f.length <= Math.ceil(r.seconds) + 4,
  );
  const rooms = f.flatMap((x) => x.e).filter((e) => e.k === "sala");
  assert.deepEqual(
    rooms.map((e) => (e.k === "sala" ? e.st : -1)),
    [0, 1, 2, 3],
  );
  // D40: a próxima sala começa no segundo seguinte ao fim da anterior, sem pausa.
  assert.equal(f.filter((x) => x.e.some((e) => e.k === "descanso")).length, 0);
  // O tempo da corrida é só o das lutas: nenhum segundo entre uma sala e a outra.
  const fought = r.rooms.reduce((a, room) => a + room.seconds, 0);
  assert.ok(Math.abs(r.seconds - fought) < 0.11, `${r.seconds} × ${fought}`);
  const kills = r.rooms.flatMap((room) => room.kills);
  const abates = f.flatMap((x) => x.e).filter((e) => e.k === "abate");
  assert.equal(abates.length, kills.length);
  const own = abates.filter((e) => e.k === "abate" && e.xp);
  assert.equal(own.length, kills.filter((k) => !k.summoned).length);
  assert.ok(own.every((e) => e.k === "abate" && e.xp!.every((x) => x > 0)));
  // Dano e cura aparecem; as skills soltas também.
  const kinds = new Set(f.flatMap((x) => x.e.map((e) => e.k)));
  for (const k of ["golpe", "magia", "lanca"])
    assert.ok(kinds.has(k as "golpe"), k);
  // Vida e mana de todos em todo quadro.
  assert.ok(f.every((x) => x.h.length === 4 && x.m.length === 4));
});

test("mesma semente, mesmos quadros", () => {
  const d = dungeonById("masmorra-160")!;
  const run = () =>
    simulateRun(d, party(REF, 160), {
      mode: "aleatorio",
      random: randomSource(new Rng(42)),
      record: true,
    });
  assert.deepEqual(run().frames, run().frames);
});

test("o chefe anuncia as mecânicas e o Cataclismo cresce como buff até o fim", () => {
  const d = DUNGEONS.find((x) => x.kind === "masmorra" && x.level === 110)!;
  // Sem DPS a sala do chefe passa dos 150 s: o Cataclismo entra e cresce a cada pulso.
  const r = simulateRun(
    d,
    party(["guerreiro", "padre", "druida", "paladino"], 110),
    {
      mode: "esperado",
      record: true,
    },
  );
  assert.equal(r.outcome, "derrota");
  const ev = r.frames!.flatMap((x) => x.e);
  const mech = new Set(ev.flatMap((e) => (e.k === "mecanica" ? [e.s] : [])));
  for (const m of [
    "golpe-pesado",
    "pulso",
    "maldicao",
    "invocacao",
    "dreno",
    "investida",
  ])
    assert.ok(mech.has(m as "pulso"), m);
  const stacks = ev.flatMap((e) => (e.k === "cataclismo" ? [e.n] : []));
  assert.ok(stacks.length >= 2);
  stacks.forEach((n, i) => assert.equal(n, i + 1));
  // Quem caiu aparece com 0 de vida e com a queda no registro.
  const last = r.frames!.at(-1)!;
  assert.ok(last.h.every((hp) => hp === 0));
  assert.equal(ev.filter((e) => e.k === "queda").length, 4);
});

test("os quadros mostram os efeitos ativos: o veneno do assassino no monstro, a Canção do druida no grupo (26/11/2026)", () => {
  const d = dungeonById("masmorra-110")!;
  const r = simulateRun(
    d,
    party(["guerreiro", "druida", "assassino", "mago"], 110),
    { mode: "esperado", record: true },
  );
  const f = r.frames!;
  const foe = f.flatMap((x) => x.u?.x.flat() ?? []);
  const hero = f.flatMap((x) => x.u?.h.flat() ?? []);
  assert.ok(foe.some((s) => s.k === "dot" && s.a === 2), "DoT do assassino");
  assert.ok(
    hero.some((s) => s.k === "buff" && s.s === "cancao-da-floresta"),
    "Canção de Guerra",
  );
  for (const s of [...foe, ...hero]) {
    assert.ok(s.t >= 1, "tempo que falta, para cima");
    assert.ok(s.s.length > 0);
  }
  // O tamanho bate com o quadro: um por herói e um por inimigo.
  for (const x of f)
    if (x.u) {
      assert.equal(x.u.h.length, x.h.length);
      assert.equal(x.u.x.length, x.x.length);
    }
});

test("medidor: dano, dano recebido e cura de cada herói somam os eventos; quadro repetido não conta duas vezes", () => {
  const d = dungeonById("masmorra-70")!;
  const r = simulateRun(d, party(REF, 70), { mode: "esperado", record: true });
  const f = r.frames!;
  const m = meterOf(f, 4);
  assert.equal(m.s, f.at(-1)!.s);
  // O dano do medidor é o que tirou de vida (sem o excesso do golpe que mata), até o total do herói.
  r.rooms
    .reduce(
      (acc, room) => acc.map((v, i) => v + room.heroes[i]!.damage),
      [0, 0, 0, 0],
    )
    .forEach((total, i) =>
      assert.ok(
        m.dmg[i]! <= total + 5 && m.dmg[i]! >= total * 0.85,
        `${i}: ${m.dmg[i]} × ${total}`,
      ),
    );
  assert.ok(m.taken[0]! > m.taken[2]!, "o tanque apanha mais que o mago");
  assert.ok(m.heal[1]! > 0, "o padre cura");
  assert.ok((m.dmgBy[2]!.auto ?? 0) >= 0);
  const again = cloneMeter(m);
  addFrame(again, f.at(-1)!);
  assert.deepEqual(again, m);
  const half = meterOf(f, 4, 10);
  assert.equal(half.s, 10);
  assert.ok(half.dmg[2]! < m.dmg[2]!);
});

test("o erro do herói aparece nos quadros (ataque básico e skill), sem mudar a corrida (26/11/2026)", () => {
  // Precisão baixa contra a Fuga dos monstros: o herói erra; antes o golpe sumia da tela.
  const d = dungeonById("masmorra-70")!;
  const clumsy = party(REF, 70).map((f) => ({
    ...f,
    stats: { ...f.stats, hit: f.stats.hit * 0.1 },
  }));
  const opts = { mode: "aleatorio" as const, random: randomSource(new Rng(11)) };
  const rec = simulateRun(d, clumsy, { ...opts, record: true });
  const plain = simulateRun(d, clumsy, {
    mode: "aleatorio",
    random: randomSource(new Rng(11)),
  });
  assert.equal(rec.outcome, plain.outcome);
  assert.equal(rec.seconds, plain.seconds);
  const evs = rec.frames!.flatMap((x) => x.e);
  const heroMiss = (k: string) =>
    evs.filter(
      (e) =>
        e.k === k &&
        "bl" in e &&
        e.bl === "erro" &&
        e.a < FOE_BASE &&
        e.b >= FOE_BASE,
    ).length;
  assert.ok(heroMiss("golpe") > 0, "ataque básico que errou");
  assert.ok(heroMiss("magia") > 0, "skill que errou");
  // Errar não vira dano no medidor.
  for (const e of evs)
    if ("bl" in e && e.bl === "erro") assert.equal(e.v, 0);
  // No modo esperado (a calibração) nada muda: o erro já entra na média, sem evento.
  const exp = simulateRun(d, party(REF, 70), { mode: "esperado", record: true });
  assert.equal(
    exp.frames!.flatMap((x) => x.e).filter(
      (e) => "bl" in e && e.bl === "erro" && e.a < FOE_BASE,
    ).length,
    0,
  );
});
