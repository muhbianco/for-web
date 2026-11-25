import assert from "node:assert/strict";
import test from "node:test";

import { DUNGEONS, dungeonById } from "../dungeons/catalog.ts";
import { balance as B } from "../formulas.ts";
import { encounters as E } from "../sim/encounters.ts";
import {
  type RewardKill,
  creatureGoldTotal,
  creatureXpTotal,
  rewardsFor,
  runRewards,
  xpDeltas,
} from "./rewards.ts";
import { simulateRun } from "./simulate.ts";

// Recompensas da corrida (spec §13 e D4).

const SPEC = { source: "spec", referenceAi: "gabarito" } as const;
const kill = (
  alive: boolean[],
  extra: Partial<RewardKill> = {},
): RewardKill => ({
  archetype: "lacaio",
  level: 100,
  summoned: false,
  alive,
  ...extra,
});
const all4 = [true, true, true, true];
const levels4 = [100, 100, 100, 100];

test("XP e ouro divididos entre os vivos; bônus de fim só na vitória; job = 30%", () => {
  const each = creatureXpTotal(100, "lacaio", 4, "masmorra") / 4;
  const win = rewardsFor([kill(all4)], levels4, "masmorra", true);
  const lose = rewardsFor([kill(all4)], levels4, "masmorra", false);
  assert.equal(win.heroes[0]!.xp, Math.floor(each * 1.2));
  assert.equal(lose.heroes[0]!.xp, Math.floor(each));
  assert.equal(win.heroes[0]!.jobXp, Math.floor(win.heroes[0]!.xp * 0.3));
  assert.equal(
    win.heroes[0]!.gold,
    Math.floor(creatureGoldTotal(100, "lacaio", 4, "masmorra") / 4),
  );
  // O XP do grupo: escala(4) × (1 + 0,1·3) dividido por 4, e a Masmorra vale 1,5×.
  assert.ok(Math.abs(each - (B.lacaioXp(100) * 3.25 * 1.3 * 1.5) / 4) < 1e-9);
});

test("D4: quem morreu não recebe dos abates seguintes; a parte dele vai para os vivos", () => {
  const first = kill(all4);
  const second = kill([true, true, true, false]);
  const r = rewardsFor([first, second], levels4, "masmorra", false);
  const total = creatureXpTotal(100, "lacaio", 4, "masmorra");
  assert.equal(r.heroes[3]!.xp, Math.floor(total / 4));
  assert.equal(r.heroes[0]!.xp, Math.floor(total / 4 + total / 3));
  // Ninguém vivo: o abate não rende para ninguém (ex.: o último golpe veio de um DoT).
  const none = rewardsFor([kill([false, false])], [100, 100], "cacada", false);
  assert.deepEqual(
    none.heroes.map((h) => h.xp),
    [0, 0],
  );
});

test("P65: o lacaio da Invocação não dá XP nem ouro", () => {
  const r = rewardsFor(
    [kill(all4, { summoned: true })],
    levels4,
    "masmorra",
    true,
  );
  assert.ok(r.heroes.every((h) => h.xp === 0 && h.gold === 0));
});

test("diferença de nível: PT de até 20 níveis usa a média; acima disso, cada um o seu (P66)", () => {
  assert.deepEqual(xpDeltas([100, 110], 100), [5, 5]);
  assert.deepEqual(xpDeltas([100, 130], 100), [0, 30]);
  const r = rewardsFor([kill([true, true])], [100, 130], "cacada", false);
  const each = creatureXpTotal(100, "lacaio", 2, "cacada") / 2;
  assert.equal(r.heroes[0]!.xp, Math.floor(each));
  // Δ = 30: −6% por nível acima de 5, no mínimo 10%.
  assert.equal(r.heroes[1]!.xp, Math.floor(each * 0.1));
  // Monstro acima: +2% por nível, até +20%.
  const up = rewardsFor([kill([true], { level: 120 })], [100], "cacada", false);
  assert.equal(
    up.heroes[0]!.xp,
    Math.floor(creatureXpTotal(120, "lacaio", 1, "cacada") * 1.2),
  );
});

// A curva do §2 conta 28 lacaios do nível L por corrida; com os lacaios de R−4 a R (D14) a Caçada rende
// um pouco menos no começo (89% no L10, 94% no L20) e 96–100% do 30 em diante (P68).
// D40: sem descanso entre as salas, o mago solo perde a Caçada do próprio nível nestas faixas.
const D40_MAGO_SOLO = new Set([30, 70, 120, 130, 140, 190]);
test("§2: toda Caçada solo do próprio nível rende o XP de 1 corrida da curva", () => {
  for (const d of DUNGEONS.filter((x) => x.kind === "cacada")) {
    const L = d.level;
    if (D40_MAGO_SOLO.has(L)) continue;
    const party = [E.fighter("mago", L, { ...SPEC, solo: true })];
    const run = simulateRun(d, party, { mode: "esperado" });
    assert.equal(run.outcome, "vitoria", `L${L}`);
    const r = runRewards(d, [L], run);
    const ratio = r.heroes[0]!.xp / (B.xpToNext(L) / B.runsPerLevel(L));
    const floor = L >= 30 ? 0.96 : 0.88;
    assert.ok(ratio > floor && ratio <= 1, `L${L}: ${ratio.toFixed(3)}`);
  }
});

test("a corrida conta cada criatura da sala uma vez e marca os invocados", () => {
  const d = dungeonById("masmorra-70")!;
  const party = ["guerreiro", "padre", "mago", "cacador"].map((c) =>
    E.fighter(c as "mago", 70, SPEC),
  );
  const run = simulateRun(d, party, { mode: "esperado" });
  assert.equal(run.outcome, "vitoria");
  const kills = run.rooms.flatMap((r) => r.kills);
  const own = kills.filter((k) => !k.summoned);
  // Salas 4 / 5 / 3 + elite / chefe.
  assert.deepEqual(
    run.rooms.map((r) => r.kills.filter((k) => !k.summoned).length),
    [4, 5, 4, 1],
  );
  assert.ok(
    kills.some((k) => k.summoned),
    "a Invocação do 70 não apareceu",
  );
  assert.ok(own.every((k) => k.alive.every(Boolean)));
  const r = runRewards(d, [70, 70, 70, 70], run);
  assert.ok(r.success && r.heroes.every((h) => h.xp > 0 && h.gold > 0));
});
