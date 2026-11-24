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
  softCap,
  statCost,
  statCostTo,
  statPointsFree,
  statValue,
  statPointsTotal,
  validStats,
  vitDefRange,
  withVit,
} from "./attributes.ts";
import { DEFAULT_RATES, VOCATIONS } from "./data.ts";
import { trainingGain } from "./training.ts";
import { normalHitRange, spellRange, wandRange } from "./spells.ts";
import { JOB, addJobExp, jobExpGain, jobLevelFor, jobPoints, rebirthScale } from "./job.ts";
import { expForLevel } from "./progression.ts";
import { TIER_MAX_UPS, nodeUnits, treeNode, CRIT_MULT, cannotRebirth } from "./abilities.ts";

test("pontos de atributo: 5 por level, escada de custo a partir do 51, sem teto [decisão do dono, 24/11/2026]", () => {
  assert.equal(statPointsTotal(1), 5);
  assert.equal(statPointsTotal(20), 100);
  assert.equal(statPointsTotal(500), 2500);
  // Custo de subir de v para v+1: 1 até o 50; 2 do 51 ao 60, 3 do 61 ao 70... 16 do 191 ao 200.
  assert.deepEqual(
    [1, 50, 51, 60, 61, 100, 101, 191, 200].map(statCost),
    [1, 1, 2, 2, 3, 6, 7, 16, 16],
  );
  // A soma fechada bate com a soma passo a passo.
  for (const v of [1, 2, 10, 11, 12, 55, 100, 101, 250, 999]) {
    let sum = 0;
    for (let x = 1; x < v; x++) sum += statCost(x);
    assert.equal(statCostTo(v), sum, `até ${v}`);
  }
  const s = freshStats();
  assert.equal(statPointsFree(s, 1), 5);
  const r = addStats(s, { for: 3, vit: 2 }, 1);
  assert.ok(r.ok);
  assert.equal(r.ok && r.stats.for, 4);
  assert.equal(r.ok && statPointsFree(r.stats, 1), 0);
  assert.deepEqual(addStats(s, { for: 6 }, 1), {
    ok: false,
    reason: "no_points",
  });
  // Do 50 ao 52 custa 1 + 2 = 3 pontos; o level 11 tem 55, 49 já gastos em FOR 50.
  const fifty = { ...s, for: 50 };
  assert.equal(statPointsFree(fifty, 11), 6);
  const up = addStats(fifty, { for: 2 }, 11);
  assert.ok(up.ok && statPointsFree(up.stats, 11) === 3);
  // Sem teto: o 99 passa, se houver pontos (do 99 ao 100 custa 6; o 99 já custou 238).
  const high = addStats({ ...s, for: 99 }, { for: 1 }, 49);
  assert.ok(high.ok && high.stats.for === 100);
  assert.deepEqual(addStats(s, { for: -1 }, 5), {
    ok: false,
    reason: "bad_points",
  });
  assert.deepEqual(addStats(s, {}, 5), { ok: false, reason: "bad_points" });
  assert.ok(validStats(freshStats(), 1));
  assert.ok(
    !validStats({ ...freshStats(), for: 7 }, 1),
    "mais pontos que o level",
  );
  // FOR 100 custa 244 pontos: o level 49 (245 pontos) paga; o 48 (240) não.
  assert.equal(statCostTo(100), 244);
  assert.ok(validStats({ ...freshStats(), for: 100 }, 49));
  assert.ok(!validStats({ ...freshStats(), for: 100 }, 48));
  assert.ok(!validStats({ for: 1 }, 1));
});

test("escada de ganho: cheio até 100, depois cada ponto vale 100/v, sem teto", () => {
  assert.equal(statValue(50), 50);
  assert.equal(statValue(100), 100);
  assert.ok(Math.abs(statValue(200) - (100 + 100 * Math.log(2))) < 1e-9);
  // Sempre sobe, cada vez menos.
  let prev = statValue(100);
  let step = Infinity;
  for (const v of [150, 200, 300, 500, 1000, 5000]) {
    const now = statValue(v);
    assert.ok(now > prev, `${v} sobe`);
    const per = (now - prev) / v;
    assert.ok(per < step, `${v} rende menos por ponto`);
    prev = now;
    step = per;
  }
  // As curvas com limite: igual ao de antes no começo, nunca passa do teto.
  assert.ok(Math.abs(softCap(1, 60) - 1) < 0.02);
  assert.ok(softCap(1e9, 60) < 60);
  const big = derive({ ...freshStats(), agi: 5000, des: 5000, sor: 5000 }, 500);
  assert.ok(big.aspd >= 0.4, "velocidade no máximo 2,5×");
  assert.ok(big.crit < 60 && big.perfectDodge < 40);
  assert.ok(big.minRoll < 0.9 && big.cooldown > 0.5);
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
  // Com a curva (24/11/2026): perto dos números do Ragnarok, um pouco abaixo.
  assert.ok(Math.abs(d.perfectDodge - softCap(4, 40)) < 1e-9, "(SOR + 10)/10 %");
  assert.ok(Math.abs(d.crit - softCap(11, 60)) < 1e-9, "(10 + SOR·10/3)/10 %");
  assert.ok(d.crit > 9 && d.crit < 11);
  assert.ok(
    Math.abs(d.aspd - (1 - 0.6 * (1 - Math.exp(-220 / 600)))) < 1e-9,
    "amotion − (4·AGI + DES)/1000, com teto",
  );
  assert.ok(d.aspd > 0.78 && d.aspd < 0.82, "perto de 0,78 do Ragnarok");
  assert.equal(
    withVit(400, { ...freshStats(), vit: 50 }),
    600,
    "× (1 + VIT/100)",
  );
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
  // 24/11/2026: em ups; o cheio de antes de cada adereço vale 5 ups.
  const t = {
    "golpe-brutal.forca": 5,
    "golpe-brutal.economia": 5,
    "golpe-brutal.atordoar": 5,
    "golpe-brutal.forca2": 5,
    "golpe-brutal.duplo": 5,
    "golpe-brutal.ritmo": 5,
  };
  const now = abilityNow(brutal, t);
  assert.ok(Math.abs(now.power - 1.7) < 1e-9);
  assert.equal(now.mana, 21);
  // O Ritmo em 5 ups tira 2 s da recarga de base.
  assert.equal(now.cooldownMs, brutal.cooldownMs - 2000);
  assert.equal(now.echo, 0.5);
  assert.deepEqual(now.stun, { chance: 30, ms: 2000 });
  // A cura troca de fórmula e de mana.
  const patch = abilityDef("remendo")!;
  assert.equal(abilityNow(patch, {}).mana, 6);
  const heal = abilityNow(patch, {
    "remendo.cura-leve": 1,
    "remendo.intensa": 1,
  });
  assert.equal(heal.name, "Cura intensa");
  assert.equal(heal.mana, 70);
});

test("aprender: classe, parte da árvore pela evolução, pré-requisito, pontos e teto", () => {
  assert.equal(cannotLearn({}, "golpe-brutal.forca", 4, 1, 1), null);
  assert.equal(cannotLearn({}, "golpe-brutal.forca", 1, 1, 1), "not_class");
  assert.equal(cannotLearn({}, "golpe-brutal.economia", 4, 1, 1), "requires");
  assert.equal(
    cannotLearn({ "golpe-brutal.forca": 1 }, "golpe-brutal.atordoar", 4, 1, 1),
    "tier",
  );
  assert.equal(
    cannotLearn({ "golpe-brutal.forca": 1 }, "golpe-brutal.atordoar", 4, 2, 1),
    null,
  );
  assert.equal(
    cannotLearn({ "golpe-brutal.forca": 5 }, "golpe-brutal.forca", 4, 1, 3),
    "max_rank",
  );
  assert.equal(cannotLearn({}, "golpe-brutal.forca", 4, 1, 0), "no_points");
  assert.equal(cannotLearn({}, "nada", 4, 1, 1), "not_node");
  assert.ok(validTree({ "golpe-brutal.forca": 2 }, 4, 1));
  assert.ok(
    !validTree({ "golpe-brutal.economia": 1 }, 4, 1),
    "sem o pré-requisito",
  );
  assert.ok(
    !validTree({ "golpe-brutal.forca": 1, "golpe-brutal.atordoar": 1 }, 4, 1),
    "parte da 2ª classe",
  );
  assert.ok(!validTree({ "golpe-brutal.forca": 9 }, 4, 1));
  // 24/11/2026: o teto sobe com a classe (5, 10, 20 ups).
  assert.deepEqual(TIER_MAX_UPS, { 1: 5, 2: 10, 3: 20 });
  assert.ok(validTree({ "golpe-brutal.forca": 20 }, 4, 3));
  assert.ok(!validTree({ "golpe-brutal.forca": 21 }, 4, 3));
  assert.equal(cannotLearn({ "golpe-brutal.forca": 5 }, "golpe-brutal.forca", 4, 2, 3), null);
  assert.equal(cannotLearn({ "golpe-brutal.forca": 10 }, "golpe-brutal.forca", 4, 2, 3), "max_rank");
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

test("nível de job (24/11/2026): 30% da experiência, na curva do level, um ponto por nível até o 150", () => {
  assert.equal(JOB.expShare, 0.3);
  assert.equal(JOB.maxLevel, 150);
  assert.equal(jobExpGain(1000), 300);
  assert.equal(jobLevelFor(0), 1);
  assert.equal(jobLevelFor(expForLevel(18)), 18);
  assert.equal(jobLevelFor(expForLevel(18) - 1), 17);
  assert.equal(jobLevelFor(Number.MAX_SAFE_INTEGER), 150);
  assert.equal(jobPoints(1), 0);
  assert.equal(jobPoints(18), 17);
  assert.equal(jobPoints(150), 149);
  // O job anda junto, mais devagar: com a experiência do level 27, o job fica no 18.
  const j = addJobExp({ level: 1, exp: 0 }, jobExpGain(expForLevel(27)));
  assert.equal(j.level, 18);
  // No máximo, para.
  assert.deepEqual(addJobExp({ level: 150, exp: 5 }, 999), { level: 150, exp: 5 });
  // O treino do dummy é só das armas e da magia (o de habilidade saiu).
  assert.deepEqual(trainingGain(VOCATIONS[4], "espada", 3600, DEFAULT_RATES), { main: 1800, escudo: 1800 });
});

test("ups (24/11/2026): o cheio de antes vale 5 ups; alvo em ups vira chance; crítico, perfurar e escudo do grupo", () => {
  const forca = treeNode("golpe-brutal.forca")!;
  assert.equal(nodeUnits(forca, 5), 5);
  // Os ups depois do 5º rendem LATE_UP (0,5): 5 + 15 × 0,5.
  assert.equal(nodeUnits(forca, 20), 12.5);
  const pierce = treeNode("rajada-dupla.perfurante")!;
  assert.equal(nodeUnits(pierce, 1), 0.2);
  const rajada = abilityDef("rajada-dupla")!;
  const base = { "rajada-dupla.forca": 5, "rajada-dupla.perfurante": 3 };
  assert.ok(Math.abs(abilityNow(rajada, base).targets - 0.6) < 1e-9);
  assert.ok(Math.abs(abilityNow(rajada, { ...base, "rajada-dupla.perfurante": 10 }).targets - 1.5) < 1e-9);
  // Os novos: crítico, perfurar e o escudo do grupo do desafio.
  assert.equal(abilityNow(rajada, { ...base, "rajada-dupla.certeira": 5 }).crit, 10);
  assert.equal(abilityNow(abilityDef("golpe-brutal")!, { "golpe-brutal.forca": 1, "golpe-brutal.quebra": 10 }).pierce, 22.5);
  assert.equal(abilityNow(abilityDef("desafio")!, { "desafio.presenca": 1, "desafio.escudo": 20 }).cover, 12.5);
  assert.equal(CRIT_MULT, 1.5);
  // Com 20 ups: 12,5 de peso (crítico 25%); os tetos são 60% e 75%.
  assert.equal(abilityNow(rajada, { ...base, "rajada-dupla.certeira": 20 }).crit, 25);
  // Cada habilidade ganhou um adereço.
  for (const ab of ABILITIES) assert.ok(TREE.filter((n) => n.ability === ab.id).length >= 5, ab.id);
});

test("renascimento (24/11/2026): na 3ª classe com o job no máximo; cada um deixa o job 1% mais lento", () => {
  assert.equal(cannotRebirth(4, 2, 150, "golpe-brutal.forca"), "not_last_tier");
  assert.equal(cannotRebirth(4, 3, 149, "golpe-brutal.forca"), "job_level");
  assert.equal(cannotRebirth(4, 3, 150, "golpe-brutal.forca"), null);
  assert.equal(cannotRebirth(4, 3, 150, "golpe-de-raio.forca"), "not_class");
  assert.equal(rebirthScale(0), 1);
  assert.ok(Math.abs(rebirthScale(2) - 1.0201) < 1e-12, "composto");
  assert.ok(jobExpGain(100_000, 10) < jobExpGain(100_000));
});

test("barra da dungeon: mana e recarga com os adereços e a DES, as mesmas da corrida", async () => {
  const { abilityBar } = await import("./run.ts");
  const bar = abilityBar({
    vocation: 4,
    level: 30,
    manaMax: 150,
    stats: { ...freshStats(), des: 61 },
    tree: { "golpe-brutal.forca": 5, "golpe-brutal.economia": 5 },
  });
  assert.deepEqual(
    bar.map((b) => b.id),
    ["golpe-brutal", "giro-da-lamina", "atadura", "desafio"],
  );
  // 30 de mana − 30% = 21; a recarga de base × (1 − a curva da DES 61), a mesma da corrida (derive).
  const base = abilityDef("golpe-brutal")!.cooldownMs;
  const cd = Math.round(base * derive({ ...freshStats(), des: 61 }, 30).cooldown);
  assert.ok(cd > base * 0.8 && cd < base * 0.9, `recarga ${cd}`);
  // Sai com o custo e uma Atadura guardada (10).
  assert.deepEqual(bar[0], { id: "golpe-brutal", mana: 21, cd_ms: cd, at: 31 });
  assert.equal(bar[3]!.at, 40 + 10, "o Desafio guarda a cura");
  // Sem atributos nem árvore (corrida antiga): os números de partida (a DES 1 tira 0,3%).
  const plain = abilityBar({ vocation: 1, level: 5, manaMax: 50 });
  assert.equal(plain[0]!.id, "golpe-de-raio");
  assert.equal(
    plain[0]!.cd_ms,
    Math.round(abilityDef("golpe-de-raio")!.cooldownMs * derive(freshStats(), 5).cooldown),
  );
});

test("teto da recarga: DES, Ritmo e maestria juntos não tiram mais que COOLDOWN_CUT_MAX", async () => {
  const { abilityCooldownMs, COOLDOWN_CUT_MAX } = await import("./run.ts");
  const brutal = abilityDef("golpe-brutal")!;
  // O Ritmo no máximo, com 10 mil renascimentos nele, e DES de level 500.
  const now = abilityNow(brutal, { "golpe-brutal.ritmo": 20 }, { "golpe-brutal.ritmo": 10_000 });
  const d = derive({ ...freshStats(), des: 400 }, 500);
  assert.equal(abilityCooldownMs(now, d), Math.round(brutal.cooldownMs * (1 - COOLDOWN_CUT_MAX)));
  // Sem nada, a recarga de base (a DES 1 tira quase nada).
  assert.ok(abilityCooldownMs(abilityNow(brutal, {}), derive(freshStats(), 1)) >= brutal.cooldownMs * 0.99);
});

test("fórmula golpe: a habilidade parte do golpe normal da classe e bate em cima", () => {
  const hit = (cls: number, weapon: Parameters<typeof normalHitRange>[0]["weapon"], ammoAttack: number | null) =>
    normalHitRange({
      level: 27,
      magicLevel: 30,
      cls,
      meleeDamage: 1,
      distDamage: 1.6,
      weapon,
      refine: 1,
      ammoAttack,
      skills: { punhos: 10, espada: 10, machado: 48, maca: 10, distancia: 50 },
      minRoll: 0.2,
      attackFactor: 1,
    });
  // Druida com varinha: a base é a varinha (que cresce com o magic level).
  const wand = hit(2, { kind: "varinha", wand: { min: 10, max: 20 } }, null);
  assert.equal(wand.kind, "wand");
  const [wMin, wMax] = wandRange({ min: 10, max: 20 }, 27, 30);
  assert.deepEqual([wand.lo, wand.hi], [wMin, wMax]);
  // Sem varinha, o mago segue o magic level (a conta da varinha sem o dano dela).
  assert.ok(hit(1, null, null).hi > 0);
  // Arqueiro com arco e flecha: o tiro; sem flecha, os punhos.
  assert.equal(hit(3, { kind: "distancia", attack: 5 }, 20).kind, "ranged");
  assert.equal(hit(3, { kind: "distancia", attack: 5 }, null).kind, "melee");
  // Cavaleiro de machado: a skill de machado.
  const axe = hit(4, { kind: "machado", attack: 30 }, null);
  const fist = hit(4, null, null);
  assert.ok(axe.hi > fist.hi * 3, `${axe.hi} x ${fist.hi}`);
  // Toda habilidade de ataque de um alvo bate acima do golpe normal; a de área, por monstro, abaixo.
  for (const a of ABILITIES) {
    if (a.formula.type !== "golpe") continue;
    const avg = (a.formula.min + a.formula.max) / 2;
    if (a.kind === "ataque") assert.ok(avg >= 1.5, `${a.id} ×${avg}`);
    if (a.kind === "area") assert.ok(avg < 1 && avg >= 0.3, `${a.id} ×${avg}`);
  }
  const [lo, hi] = spellRange({ formula: { type: "golpe", min: 1.5, max: 1.8 } }, { level: 27, magicLevel: 30, weaponSkill: 10, weaponAttack: 7, distance: 10, baseHit: [100, 200] });
  assert.deepEqual([lo, hi], [150, 360]);
});

test("maestria: cada vez escolhido, o adereço rende 0,5% a mais por ponto; alvos a mais não mudam", () => {
  const brutal = abilityDef("golpe-brutal")!;
  const t = { "golpe-brutal.forca": 5 };
  const plain = abilityNow(brutal, t).power;
  const twice = abilityNow(brutal, t, { "golpe-brutal.forca": 2 }).power;
  assert.ok(Math.abs(plain - 1.4) < 1e-9);
  assert.ok(Math.abs(twice - (1 + 0.4 * 1.01)) < 1e-9);
  const ray = abilityDef("golpe-de-raio")!;
  const t2 = { "golpe-de-raio.forca": 1, "golpe-de-raio.corrente": 1 };
  assert.equal(
    abilityNow(ray, t2, { "golpe-de-raio.corrente": 9 }).targets,
    abilityNow(ray, t2).targets,
  );
});

