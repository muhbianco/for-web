import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_RATES, TRAINING } from "@muchat/space-core/game/ot";

import {
  applyVocation,
  creditTraining,
  newRpgHero,
  rpgHeroView,
  startTraining,
  stopTraining,
  trainingExpired,
} from "./hero.ts";

const H = 3_600_000;
const SPOT = { instance: "dummy-1", server: "S1", zone: "room:R1" };

test("herói novo: level 1, vida 150, sem vocação, saldo de treino e stamina cheios", () => {
  const d = newRpgHero("u1", 1_000);
  assert.equal(d.vocation, 0);
  assert.equal(d.level, 1);
  assert.equal(d.health_max, 150);
  assert.equal(d.cap, 400);
  assert.equal(d.skills.espada.level, 10);
  assert.equal(d.magic.level, 0);
  assert.equal(d.stamina, 2520);
  assert.deepEqual(d.bank, { ms: TRAINING.maxBankMs, at: 1_000 });
});

test("vocação: escolhida uma vez, só entre as quatro base", () => {
  const d = newRpgHero("u1", 0);
  assert.deepEqual(applyVocation(d, 4), { ok: true });
  assert.deepEqual(applyVocation(d, 3), { ok: false, reason: "vocation_set" });
  const e = newRpgHero("u2", 0);
  assert.deepEqual(applyVocation(e, 8), { ok: false, reason: "bad_vocation" });
});

test("treino: exige vocação; 1 h de cavaleiro na espada rende 1800 tentativas de espada e de escudo", () => {
  const d = newRpgHero("u1", 0);
  assert.deepEqual(startTraining(d, SPOT, "espada", 0, DEFAULT_RATES), {
    ok: false,
    reason: "no_vocation",
  });
  applyVocation(d, 4);
  assert.deepEqual(startTraining(d, SPOT, "espada", 0, DEFAULT_RATES), {
    ok: true,
  });
  assert.ok(stopTraining(d, H, DEFAULT_RATES));
  // 1800 tentativas: 50+55+60+66+73+80+88+97+107+117+128+141+155+171+188+... até onde cabem
  const view = rpgHeroView(d, DEFAULT_RATES);
  assert.ok(view.skills.espada.level > 10);
  assert.ok(view.skills.escudo.level > 10);
  assert.equal(d.training, null);
  assert.deepEqual(d.bank, { ms: 11 * H, at: H });
});

test("treino: creditar no meio e fechar depois dá o mesmo que fechar de uma vez", () => {
  const a = newRpgHero("u1", 0);
  const b = newRpgHero("u1", 0);
  for (const d of [a, b]) {
    applyVocation(d, 3);
    startTraining(d, SPOT, "distancia", 0, DEFAULT_RATES);
  }
  creditTraining(a, 777_000, DEFAULT_RATES);
  creditTraining(a, 2_345_000, DEFAULT_RATES);
  stopTraining(a, 5 * H, DEFAULT_RATES);
  stopTraining(b, 5 * H, DEFAULT_RATES);
  assert.deepEqual(a.skills, b.skills);
  assert.deepEqual(a.bank, b.bank);
});

test("treino: para no fim do orçamento e o saldo volta a encher a partir dali", () => {
  const d = newRpgHero("u1", 0);
  applyVocation(d, 4);
  d.bank = { ms: 2 * H, at: 0 };
  startTraining(d, SPOT, "machado", 0, DEFAULT_RATES);
  assert.equal(trainingExpired(d, 2 * H - 1), false);
  assert.equal(trainingExpired(d, 2 * H), true);
  // Volta 10 h depois: treinou só as 2 h do orçamento; o saldo encheu 8 h desde o fim.
  stopTraining(d, 10 * H, DEFAULT_RATES);
  assert.deepEqual(d.bank, { ms: 0, at: 2 * H });
  const other = newRpgHero("u2", 0);
  applyVocation(other, 4);
  other.bank = { ms: 2 * H, at: 0 };
  startTraining(other, SPOT, "machado", 0, DEFAULT_RATES);
  stopTraining(other, 2 * H, DEFAULT_RATES);
  assert.deepEqual(d.skills, other.skills);
});

test("treino: sem saldo não começa; repetir o mesmo dummy não reinicia; trocar fecha o anterior", () => {
  const d = newRpgHero("u1", 0);
  applyVocation(d, 4);
  d.bank = { ms: 30_000, at: 0 };
  assert.deepEqual(startTraining(d, SPOT, "espada", 0, DEFAULT_RATES), {
    ok: false,
    reason: "no_bank",
  });
  d.bank = { ms: 4 * H, at: 0 };
  startTraining(d, SPOT, "espada", 0, DEFAULT_RATES);
  const started = d.training!.startedAt;
  assert.deepEqual(startTraining(d, SPOT, "espada", 60_000, DEFAULT_RATES), {
    ok: true,
  });
  assert.equal(d.training!.startedAt, started);
  // Outro dummy: o treino anterior (1 h) é creditado e um novo começa.
  startTraining(
    d,
    { ...SPOT, instance: "dummy-2" },
    "espada",
    H,
    DEFAULT_RATES,
  );
  assert.equal(d.training!.instance, "dummy-2");
  assert.equal(d.training!.budgetMs, 3 * H);
  assert.ok(d.skills.espada.level > 10);
});

test("treino de magia sobe o magic level", () => {
  const d = newRpgHero("u1", 0);
  applyVocation(d, 1);
  startTraining(d, SPOT, "magia", 0, DEFAULT_RATES);
  stopTraining(d, H, DEFAULT_RATES);
  // 9000 de mana: 1600 + 1760 + 1936 + 2129 = 7425 → magic level 4, sobram 1575
  assert.deepEqual(d.magic, { level: 4, manaSpent: 1_575 });
});
