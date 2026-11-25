import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { randomSource } from "../combat/fight.ts";
import type { FighterInput } from "../combat/types.ts";
import type { ClassId } from "../content.ts";
import { DUNGEONS, dungeonById } from "../dungeons/catalog.ts";
import { encounters as E } from "../sim/encounters.ts";
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

test("um quadro por segundo, sala anunciada, descanso sem monstros e XP em cada abate", () => {
  const d = dungeonById("masmorra-70")!;
  const r = simulateRun(d, party(REF, 70), { mode: "esperado", record: true });
  const f = r.frames!;
  assert.equal(r.outcome, "vitoria");
  f.forEach((x, i) => assert.equal(x.s, i + 1, `quadro ${i}`));
  // A corrida inteira cabe nos quadros (salas e descansos, segundos inteiros).
  assert.ok(
    f.length >= Math.floor(r.seconds) && f.length <= Math.ceil(r.seconds) + 4,
  );
  const rooms = f.flatMap((x) => x.e).filter((e) => e.k === "sala");
  assert.deepEqual(
    rooms.map((e) => (e.k === "sala" ? e.st : -1)),
    [0, 1, 2, 3],
  );
  const rests = f.filter((x) => x.e.some((e) => e.k === "descanso"));
  assert.equal(rests.length, 3);
  assert.ok(f.filter((x) => x.x.length === 0).length >= 9);
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
