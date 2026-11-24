import assert from "node:assert/strict";
import test from "node:test";

import {
  ABILITIES,
  EVOLUTION,
  TREE,
  abilitiesOf,
  abilityDef,
  abilityNow,
  cannotEvolve,
  cannotLearn,
  jobName,
  jobTier,
  treeOf,
  treePointsSpent,
  validTree,
} from "./abilities.ts";
import {
  addStats,
  baseAtk,
  baseMatk,
  derive,
  freshStats,
  monsterHitChance,
  statPointsFree,
  statPointsTotal,
  validStats,
  vitDefRange,
  withVit,
} from "./attributes.ts";
import { DEFAULT_RATES, VOCATIONS } from "./data.ts";
import {
  addPointTries,
  dummyTrains,
  reqPointTries,
  trainingGain,
} from "./training.ts";

test("pontos de atributo: 5 por level, +1 por ponto, teto 99 [decisão do dono, RO pré-renovação]", () => {
  assert.equal(statPointsTotal(1), 5);
  assert.equal(statPointsTotal(20), 100);
  const s = freshStats();
  assert.equal(statPointsFree(s, 1), 5);
  const r = addStats(s, { for: 3, vit: 2 }, 1);
  assert.ok(r.ok);
  assert.equal(r.ok && r.stats.for, 4);
  assert.equal(r.ok && statPointsFree(r.stats, 1), 0);
  assert.deepEqual(addStats(s, { for: 6 }, 1), { ok: false, reason: "no_points" });
  assert.deepEqual(addStats({ ...s, for: 98 }, { for: 2 }, 99), { ok: false, reason: "stat_max" });
  assert.deepEqual(addStats(s, { for: -1 }, 5), { ok: false, reason: "bad_points" });
  assert.deepEqual(addStats(s, {}, 5), { ok: false, reason: "bad_points" });
  assert.ok(validStats(freshStats(), 1));
  assert.ok(!validStats({ ...freshStats(), for: 7 }, 1), "mais pontos que o level");
  assert.ok(!validStats({ ...freshStats(), for: 100 }, 99), "teto 99");
  assert.ok(!validStats({ for: 1 }, 1));
});

test("fórmulas do Ragnarok pré-renovação [rAthena status.cpp, battle.cpp]", () => {
  // ATQ base: FOR + (FOR/10)² + DES/5 + SOR/5; à distância a DES manda.
  const s = { ...freshStats(), for: 50, des: 30, sor: 10 };
  assert.equal(baseAtk(s, false), 50 + 25 + 6 + 2);
  assert.equal(baseAtk(s, true), 30 + 9 + 10 + 2);
  // MATQ: INT + (INT/7)² ~ INT + (INT/5)².
  assert.deepEqual(baseMatk({ ...freshStats(), int: 50 }), [50 + 49, 50 + 100]);
  // Defesa da VIT: VIT·0,3 + rnd(0, VIT²/150 − VIT·0,3 − 1) + VIT·0,5.
  assert.deepEqual(vitDefRange(50), [15 + 25, 15 + 0 + 25]);
  assert.deepEqual(vitDefRange(99), [29 + 49, 29 + 35 + 49]);
  const d = derive({ ...freshStats(), agi: 50, des: 20, sor: 30 }, 20);
  assert.equal(d.flee, 70, "level + AGI");
  assert.equal(d.perfectDodge, 4, "(SOR + 10)/10 %");
  assert.equal(d.crit, 11, "(10 + SOR·10/3)/10 %");
  assert.equal(d.aspd, 1 - (200 + 20) / 1000, "amotion − (4·AGI + DES)/1000");
  assert.equal(withVit(400, { ...freshStats(), vit: 50 }), 600, "× (1 + VIT/100)");
  // HIT do monstro (2 × level) contra a esquiva: 80 + HIT − FLEE, entre 5 e 100.
  assert.equal(monsterHitChance(20, 21), 99);
  assert.equal(monsterHitChance(20, 70), 50);
  assert.equal(monsterHitChance(1, 200), 5);
  assert.equal(monsterHitChance(60, 10), 100);
  // Três ou mais em cima: a esquiva cai 10% por monstro além do segundo.
  assert.equal(monsterHitChance(20, 70, 3), 80 + 40 - 63);
});

test("4 habilidades fixas por classe; a árvore só dá adereços a elas", () => {
  for (const cls of [1, 2, 3, 4] as const) {
    const list = abilitiesOf(cls);
    assert.equal(list.length, 4, `classe ${cls}`);
    for (const a of list) assert.ok(treeOf(a.id).length >= 5, a.id);
  }
  for (const n of TREE) {
    assert.ok(abilityDef(n.ability), n.id);
    if (n.requires) {
      const req = TREE.find((x) => x.id === n.requires);
      assert.ok(req, `${n.id} pede ${n.requires}`);
      assert.equal(req!.ability, n.ability);
      assert.ok(req!.tier <= n.tier);
    }
  }
  assert.equal(new Set(ABILITIES.map((a) => a.id)).size, ABILITIES.length);
  assert.equal(new Set(TREE.map((n) => n.id)).size, TREE.length);
});

test("adereços: força, economia, recarga, alvo, eco e fórmula nova", () => {
  const brutal = abilityDef("golpe-brutal")!;
  assert.equal(abilityNow(brutal, {}).power, 1);
  const t = {
    "golpe-brutal.forca": 5,
    "golpe-brutal.economia": 3,
    "golpe-brutal.atordoar": 1,
    "golpe-brutal.forca2": 5,
    "golpe-brutal.duplo": 1,
    "golpe-brutal.ritmo": 2,
  };
  const now = abilityNow(brutal, t);
  assert.ok(Math.abs(now.power - 1.7) < 1e-9);
  assert.equal(now.mana, 21);
  assert.equal(now.cooldownMs, 4000);
  assert.equal(now.echo, 0.5);
  assert.deepEqual(now.stun, { chance: 30, ms: 2000 });
  // A cura troca de fórmula e de mana.
  const patch = abilityDef("remendo")!;
  assert.equal(abilityNow(patch, {}).mana, 6);
  const heal = abilityNow(patch, { "remendo.cura-leve": 1, "remendo.intensa": 1 });
  assert.equal(heal.name, "Cura intensa");
  assert.equal(heal.mana, 70);
});

test("aprender: classe, parte da árvore pela evolução, pré-requisito, pontos e teto", () => {
  assert.equal(cannotLearn({}, "golpe-brutal.forca", 4, 1, 1), null);
  assert.equal(cannotLearn({}, "golpe-brutal.forca", 1, 1, 1), "not_class");
  assert.equal(cannotLearn({}, "golpe-brutal.economia", 4, 1, 1), "requires");
  assert.equal(cannotLearn({ "golpe-brutal.forca": 1 }, "golpe-brutal.atordoar", 4, 1, 1), "tier");
  assert.equal(cannotLearn({ "golpe-brutal.forca": 1 }, "golpe-brutal.atordoar", 4, 2, 1), null);
  assert.equal(cannotLearn({ "golpe-brutal.forca": 5 }, "golpe-brutal.forca", 4, 1, 3), "max_rank");
  assert.equal(cannotLearn({}, "golpe-brutal.forca", 4, 1, 0), "no_points");
  assert.equal(cannotLearn({}, "nada", 4, 1, 1), "not_node");
  assert.ok(validTree({ "golpe-brutal.forca": 2 }, 4, 1));
  assert.ok(!validTree({ "golpe-brutal.economia": 1 }, 4, 1), "sem o pré-requisito");
  assert.ok(!validTree({ "golpe-brutal.forca": 1, "golpe-brutal.atordoar": 1 }, 4, 1), "parte da 2ª classe");
  assert.ok(!validTree({ "golpe-brutal.forca": 9 }, 4, 1));
  assert.equal(treePointsSpent({ a: 2, b: 3 }), 5);
});

test("evolução: a promovida é a 2ª classe; a 3ª pede level 50 e 24 pontos", () => {
  assert.equal(jobTier(4, false), 1);
  assert.equal(jobTier(8, false), 2);
  assert.equal(jobTier(8, true), 3);
  assert.equal(jobName(4, 1), "Cavaleiro");
  assert.equal(jobName(8, 3), "Senhor da guerra");
  assert.equal(cannotEvolve(0, 1, 50, 50), "no_vocation");
  assert.equal(cannotEvolve(4, 1, 19, 50), "level");
  assert.equal(cannotEvolve(4, 1, 20, EVOLUTION[2].points - 1), "points");
  assert.equal(cannotEvolve(4, 1, 20, EVOLUTION[2].points), null);
  assert.equal(cannotEvolve(8, 2, 49, 99), "level");
  assert.equal(cannotEvolve(8, 2, 50, 24), null);
  assert.equal(cannotEvolve(8, 3, 99, 99), "max_tier");
});

test("treino de habilidade: só no dummy de habilidade, um ponto a cada 50 × 1,1^(n−1) tentativas", () => {
  assert.ok(dummyTrains("habilidade", "habilidade"));
  assert.ok(!dummyTrains("habilidade", "espada"));
  assert.ok(!dummyTrains("vocacao", "habilidade"));
  assert.ok(dummyTrains("vocacao", "magia"));
  assert.equal(reqPointTries(1), 50);
  assert.equal(reqPointTries(11), Math.floor(50 * 1.1 ** 10));
  // Como o treino de uma arma corpo a corpo, sem tentativa de escudo.
  const g = trainingGain(VOCATIONS[4], "habilidade", 100, DEFAULT_RATES);
  assert.deepEqual(g, { main: 50, escudo: 0 });
  assert.deepEqual(addPointTries({ points: 0, tries: 0 }, 50), { points: 1, tries: 0 });
  assert.deepEqual(addPointTries({ points: 0, tries: 40 }, 70), { points: 2, tries: 5 });
  // 12 h de treino com a taxa 2: uns 40 pontos.
  const day = trainingGain(VOCATIONS[4], "habilidade", 12 * 3600, DEFAULT_RATES).main;
  const p = addPointTries({ points: 0, tries: 0 }, day).points;
  assert.ok(p >= 38 && p <= 41, `pontos em 12 h: ${p}`);
});
