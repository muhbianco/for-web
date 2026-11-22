import assert from "node:assert/strict";
import { test } from "node:test";

import { freshHero } from "../testing/game.ts";
import {
  addSkillTries,
  addXp,
  CLASS_IDS,
  currentVitals,
  DUMMIES,
  equipError,
  heroCombat,
  itemScore,
  pauseTraining,
  RARITIES,
  requiredLevel,
  resumeTraining,
  RULES,
  Rng,
  rollItem,
  seedOf,
  settleTraining,
  shortId,
  skillTriesToNext,
  SLOTS,
  type Training,
  xpToNext,
} from "./index.ts";

// Refúgio (ADR 0009): curvas, treino pelo relógio, itens.

const H = 3_600_000;

test("curvas: inteiras, crescentes e iguais às fórmulas do GDD (±0,5%)", () => {
  for (let l = 1; l <= 80; l++) {
    const s = skillTriesToNext(l, 10);
    const sFloat = 60 * 1.15 ** (l - 1);
    assert.ok(Number.isSafeInteger(s));
    assert.ok(Math.abs(s - sFloat) / sFloat < 0.005, `skill ${l}: ${s} × ${sFloat}`);
    if (l > 1) assert.ok(s > skillTriesToNext(l - 1, 10));
  }
  for (let l = 1; l <= 100; l++) {
    const x = xpToNext(l);
    const xFloat = 100 * l ** 1.5 * 1.06 ** (l - 1);
    assert.ok(Number.isSafeInteger(x));
    assert.ok(Math.abs(x - xFloat) / xFloat < 0.005, `nível ${l}: ${x} × ${xFloat}`);
  }
  // Valores do GDD §5.1 e §6.
  assert.equal(skillTriesToNext(1, 10), 60);
  assert.equal(skillTriesToNext(10, 10), 211);
  assert.equal(xpToNext(1), 100);
  assert.equal(xpToNext(10), 5342);
  // Custo da classe: 4× para o cavaleiro em magia.
  assert.equal(skillTriesToNext(10, 40), 844);
});

test("curvas: subir skill e nível passa vários níveis de uma vez e para no teto", () => {
  assert.deepEqual(addSkillTries(1, 0, 60 + 69, 10), { level: 3, progress: 0 });
  assert.deepEqual(addSkillTries(1, 0, 59, 10), { level: 1, progress: 59 });
  assert.equal(addSkillTries(1, 0, Number.MAX_SAFE_INTEGER, 10).level, RULES.maxSkill);
  assert.deepEqual(addXp(1, 0, 100), { level: 2, xp: 0 });
  assert.equal(addXp(1, 0, Number.MAX_SAFE_INTEGER).level, RULES.maxLevel);
  assert.deepEqual(addXp(5, 10, -50), { level: 5, xp: 10 });
});

test("treino: boneco de madeira rende 3/min até o teto de 12 h", () => {
  const t: Training = { skill: "espada", since: 0, tier: 0, rem: 0 };
  assert.equal(settleTraining(t, 60_000).tries, 3);
  assert.equal(settleTraining(t, 10 * H).tries, 1800);
  assert.equal(settleTraining(t, 12 * H).tries, 2160);
  assert.equal(settleTraining(t, 30 * H).tries, 2160, "teto");
  assert.equal(settleTraining(t, -5000).tries, 0, "relógio para trás");
  assert.equal(settleTraining({ ...t, tier: 4 }, 24 * H).tries, 14_400);
  assert.equal(DUMMIES.length, 5);
});

test("treino: coletar a cada poucos segundos rende o mesmo que coletar uma vez", () => {
  for (const tier of [0, 1, 2, 3, 4]) {
    let t: Training = { skill: "magia", since: 0, tier, rem: 0 };
    let total = 0;
    const end = 9 * H + 12_345;
    for (let now = 7_001; now <= end; now += 7_001) {
      const r = settleTraining(t, now);
      total += r.tries;
      t = r.training;
    }
    const last = settleTraining(t, end);
    total += last.tries;
    assert.equal(total, settleTraining({ skill: "magia", since: 0, tier, rem: 0 }, end).tries, `boneco ${tier}`);
  }
});

test("treino: pausa na expedição e volta contando de novo", () => {
  const t: Training = { skill: "escudo", since: 0, tier: 0, rem: 0 };
  const p = pauseTraining(t, 2 * H);
  assert.equal(p.tries, 360);
  const back = resumeTraining(p.training, 5 * H);
  assert.equal(settleTraining(back, 6 * H).tries, 180, "as 3 h da expedição não contam");
});

test("vitais: voltam de 0 ao máximo em 10 min, sem passar", () => {
  assert.deepEqual(currentVitals({ hp: 1, mp: 0, at: 0 }, 200, 100, 0), { hp: 1, mp: 0 });
  assert.deepEqual(currentVitals({ hp: 0, mp: 0, at: 0 }, 200, 100, 300_000), { hp: 100, mp: 50 });
  assert.deepEqual(currentVitals({ hp: 150, mp: 90, at: 0 }, 200, 100, 3_600_000), { hp: 200, mp: 100 });
  assert.deepEqual(currentVitals({ hp: 10, mp: 10, at: 1000 }, 200, 100, 0), { hp: 10, mp: 10 });
});

test("itens: dentro dos limites, requisito de nível e classe", () => {
  const rng = new Rng(9);
  for (let i = 0; i < 2000; i++) {
    const cls = CLASS_IDS[i % 4]!;
    const rarity = RARITIES[i % RARITIES.length]!;
    const it = rollItem(rng, 1 + (i % 80), rarity, cls);
    assert.ok(SLOTS.includes(it.slot));
    assert.equal(it.id.length, 8);
    for (const v of [it.atk, it.armor, it.critBp, it.speedPct, it.hp, it.mp, it.blockBp]) assert.ok(Number.isSafeInteger(v) && v >= 0);
    assert.ok(JSON.stringify(it).length < 300);
    assert.equal(requiredLevel(it.ilvl), Math.max(1, it.ilvl - 2));
  }
  const bow = rollItem(new Rng(1), 10, "raro", "arqueiro", "arma");
  bow.type = "arco";
  assert.equal(equipError("arqueiro", 8, bow), null);
  assert.equal(equipError("arqueiro", 7, bow), "level");
  assert.equal(equipError("cavaleiro", 50, bow), "class");
  assert.equal(itemScore(bow, "cavaleiro"), -1);
  const off = rollItem(new Rng(2), 5, "comum", "cavaleiro", "secundaria");
  assert.equal(off.type, "escudo");
  assert.equal(equipError("feiticeiro", 50, off), "class");
});

test("herói novo: status do GDD §3", () => {
  const cav = heroCombat(freshHero("cavaleiro"));
  assert.equal(cav.maxHp, 170 + 2 * 6);
  assert.equal(cav.maxMp, 30);
  assert.equal(cav.weapon, "espada");
  assert.equal(cav.blockBp, 0, "sem escudo no kit");
  const arq = heroCombat(freshHero("arqueiro"));
  assert.equal(arq.dodgeBp, 1000 + 2 * 15, "passo leve + destreza");
  const fei = heroCombat(freshHero("feiticeiro"));
  assert.equal(fei.maxMp, 100 + 3 * 3);
});

test("rng: sequência fixa, misturas sem colisão nem zero", () => {
  const r = new Rng(1);
  assert.deepEqual([r.u32(), r.u32(), r.u32()], [24724473, 838574162, 2522700496]);
  const seen = new Set<number>();
  for (let s = 0; s < 200; s++) for (let p = 0; p < 200; p++) seen.add(seedOf(s, p));
  assert.equal(seen.size, 40_000);
  assert.notEqual(seedOf(2, 2), 0);
  assert.match(shortId(new Rng(3)), /^[0-9A-HJKMNP-TV-Z]{8}$/);
});
