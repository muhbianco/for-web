import assert from "node:assert/strict";
import test from "node:test";

import { fight } from "../combat/fight.ts";
import type { EnemyInput, FighterInput } from "../combat/types.ts";
import { DUNGEONS, dungeonById, dungeonRooms } from "../dungeons/catalog.ts";
import { balance as B } from "../formulas.ts";
import { simulateRun } from "../run/simulate.ts";
import { encounters as E } from "../sim/encounters.ts";
import { computeMonsterRow, createMonsters } from "./generate.ts";
import { MONSTER_TABLE } from "./table.generated.ts";

// Monstros gerados (spec §11), catálogo (§12), mecânicas de chefe (§12.3) e a corrida inteira.

const M = createMonsters();
const SPEC = { source: "spec", referenceAi: "gabarito" } as const;

test("a tabela gerada está em dia com as fórmulas (rodar scripts/gen-monsters.ts se mudar)", () => {
  for (const L of [1, 37, 100, 251, 500]) {
    const live = computeMonsterRow(L);
    const row = MONSTER_TABLE[L]!;
    for (const k of Object.keys(live) as (keyof typeof live)[])
      assert.ok(
        Math.abs(row[k] / live[k] - 1) < 1e-8,
        `L${L} ${k}: tabela ${row[k]} × agora ${live[k]}`,
      );
  }
});

test("§11.2: lacaio, elite, chefe menor e chefe de masmorra pelas fórmulas", () => {
  const L = 120;
  const r = M.row(L);
  const solo = { partySize: 1, type: "cacada" as const };
  const four = { partySize: 4, type: "masmorra" as const };
  const lac = M.lacaio(L, solo);
  assert.equal(lac.hp, 3 * r.soloDps);
  assert.equal(lac.autoRaw, r.lacaioHit);
  assert.equal(M.elite(L, solo).hp, 4 * lac.hp);
  assert.equal(M.elite(L, solo).autoRaw, 1.8 * lac.autoRaw);
  assert.equal(
    M.lacaio(L, four).hp,
    3 * r.soloDps * B.partyScale(4, "masmorra"),
  );
  assert.equal(M.chefeMenor(L, solo).hp, 25 * r.soloDps);
  assert.ok(Math.abs(M.chefe(L, four).hp - 80 * r.partyDps) < 1e-6);
  assert.ok(
    Math.abs(
      M.chefe(L, { partySize: 2, type: "masmorra" }).hp -
        (80 * r.partyDps * 2.5) / 3.25,
    ) < 1e-6,
  );
});

test("§12.3: mecânicas do chefe entram por faixa", () => {
  const o = { partySize: 4, type: "masmorra" as const };
  const at = (L: number) => M.chefe(L, o);
  assert.ok(!at(39).curse && at(40).curse);
  assert.ok(!at(69).summon && at(70).summon);
  assert.ok(!at(99).manaDrain && at(100).manaDrain && at(100).charge);
  assert.ok(!at(149).phase && at(150).phase);
  const reg = M.regional(50, o);
  assert.equal(reg.archetype, "regional");
  assert.ok(reg.phase && reg.finalPhase);
});

test("§12.2: catálogo com 50 Caçadas, 39 Masmorras e 10 Chefes de Região", () => {
  const count = (k: string) => DUNGEONS.filter((d) => d.kind === k).length;
  assert.equal(count("cacada"), 50);
  assert.equal(count("masmorra"), 39);
  assert.equal(count("regional"), 10);
  assert.equal(new Set(DUNGEONS.map((d) => d.id)).size, DUNGEONS.length);
  assert.equal(dungeonById("toca")?.id, "cacada-1");
  assert.ok(!DUNGEONS.some((d) => d.kind === "masmorra" && d.level < 20));
  const m = dungeonById("masmorra-130")!;
  assert.equal(m.minLevel, 125);
  assert.deepEqual(m.party, { min: 3, max: 4 });
});

test("§12.1 e D14: salas 4 / 5 / 3 + elite / chefe; lacaios de R−4 a R; elite e chefe em R", () => {
  const d = dungeonById("masmorra-230")!;
  const rooms = dungeonRooms(d, 4, M);
  assert.deepEqual(
    rooms.map((r) => r.length),
    [4, 5, 4, 1],
  );
  for (const e of rooms.flat())
    if (e.archetype === "lacaio")
      assert.ok(e.level >= 226 && e.level <= 230, `lacaio ${e.level}`);
    else assert.equal(e.level, 230);
  // Região 5 (Terras Congeladas): metade dos lacaios bate com magia.
  const lacaios = rooms.flat().filter((e) => e.archetype === "lacaio");
  assert.ok(lacaios.filter((e) => e.magicAuto).length >= 5);
});

const hero = (cls: FighterInput["cls"], L = 120): FighterInput =>
  E.fighter(cls, L, SPEC);
const dummy = (extra: Partial<EnemyInput>): EnemyInput => ({
  archetype: "chefe",
  level: 120,
  hp: 1e15,
  autoRaw: 0,
  attacksPerSecond: 0.5,
  ...extra,
});

test("Maldição tira 3%/s de um não tanque; o Santuário do padre purifica", () => {
  const curse = {
    curse: { everySeconds: 20, pctPerSecond: 0.03, maxSeconds: 15 },
  };
  const noCleanse = fight([{ ...hero("mago"), skills: [] }], [dummy(curse)], {
    maxSeconds: 36,
    mode: "esperado",
  });
  assert.ok(
    noCleanse.heroes[0]!.hpPct < 0.6,
    `sem purificar: ${noCleanse.heroes[0]!.hpPct}`,
  );
  const withPriest = fight(
    [{ ...hero("mago"), skills: [] }, hero("padre")],
    [dummy(curse)],
    { maxSeconds: 36, mode: "esperado" },
  );
  assert.ok(withPriest.heroes[0]!.hpPct > noCleanse.heroes[0]!.hpPct);
});

test("Invocação traz lacaios; Drenar Mana seca o conjurador", () => {
  const minion = M.lacaio(120, { partySize: 1, type: "masmorra" });
  const s = fight(
    [hero("guerreiro")],
    [dummy({ summon: { everySeconds: 5, count: 2, minion } })],
    {
      maxSeconds: 11,
      mode: "esperado",
    },
  );
  assert.equal(s.enemiesLeft.length, 1 + 4);
  const drained = fight(
    [{ ...hero("mago"), skills: [], potions: { hp: 0, mp: 0, stock: 0 } }],
    [
      dummy({
        manaDrain: { everySeconds: 5, pctPerSecond: 0.03, durationSeconds: 6 },
      }),
    ],
    { maxSeconds: 12, mode: "esperado" },
  );
  assert.ok(drained.heroes[0]!.carry.mp < 0.9 * hero("mago").stats.mp);
});

test("a corrida leva HP e recargas de uma sala para a outra e acaba em vitória, derrota ou tempo", () => {
  const d = dungeonById("masmorra-70")!;
  const party = ["guerreiro", "padre", "mago", "cacador"].map((c) =>
    hero(c as FighterInput["cls"], 70),
  );
  const win = simulateRun(d, party, { mode: "esperado" });
  assert.equal(win.outcome, "vitoria");
  assert.equal(win.rooms.length, 4);
  assert.ok(win.seconds >= win.rooms.reduce((a, r) => a + r.seconds, 0));
  const lose = simulateRun(
    d,
    ["padre", "mago", "cacador", "assassino"].map((c) =>
      hero(c as FighterInput["cls"], 70),
    ),
    {
      mode: "esperado",
    },
  );
  assert.equal(lose.outcome, "derrota");
  const slow = simulateRun({ ...d, maxSeconds: 20 }, party, {
    mode: "esperado",
  });
  assert.equal(slow.outcome, "tempo");
});
