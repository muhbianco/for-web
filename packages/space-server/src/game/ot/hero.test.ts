import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_RATES, TRAINING } from "@muchat/space-core/game/ot";

import {
  type RpgHeroDoc,
  applyVocation,
  bagWeight,
  creditTraining,
  inRun,
  markRun,
  newRpgHero,
  normalizeHero,
  RUN_STALE_MS,
  rpgHeroView,
  settleRun,
  staminaNow,
  startTraining,
  stopTraining,
  trainingExpired,
  unmarkRun,
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
  const view = rpgHeroView(d, DEFAULT_RATES, 0);
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

const MARK = { id: "run-1", dungeon: "cripta-do-musgo", ends_at: 10 * 60_000 };
const REWARD = {
  exp: 1_000,
  tries: { espada: 50, escudo: 20 },
  manaSpent: 0,
  loot: [{ item: "elmo-de-ferro", count: 1 }],
  gold: 12,
};

test("corrida no herói: marca uma vez, credita uma vez, gasta a stamina do tempo lá dentro", () => {
  const d = newRpgHero("u1", 0);
  assert.deepEqual(markRun(d, MARK, 0, DEFAULT_RATES), {
    ok: false,
    reason: "no_vocation",
  });
  applyVocation(d, 4);
  assert.deepEqual(markRun(d, MARK, 0, DEFAULT_RATES), { ok: true });
  assert.ok(inRun(d, 1_000));
  assert.deepEqual(markRun(d, { ...MARK, id: "run-2" }, 1_000, DEFAULT_RATES), {
    ok: false,
    reason: "in_run",
  });
  assert.deepEqual(startTraining(d, SPOT, "espada", 1_000, DEFAULT_RATES), {
    ok: false,
    reason: "in_run",
  });
  const out = settleRun(d, "run-1", REWARD, 3, MARK.ends_at);
  assert.equal(out.ok, true);
  assert.equal(d.run, null);
  assert.equal(d.experience, 1_000);
  assert.equal(d.level, 5, "1000 de experiência: level 5 (800 a 1499) [TFS player.h:146]");
  assert.equal(d.health_max, 150 + 4 * 15);
  assert.equal(d.gold, 12);
  assert.deepEqual(d.bag, [{ item: "elmo-de-ferro", count: 1 }]);
  assert.equal(d.stamina, 2520 - 3);
  assert.ok(d.skills.espada.tries > 0 || d.skills.espada.level > 10);
  // De novo (retomada, outro processo): nada muda.
  const snap = structuredClone(d);
  assert.deepEqual(settleRun(d, "run-1", REWARD, 3, MARK.ends_at), {
    ok: false,
    reason: "not_in_run",
  });
  assert.deepEqual(d, snap);
});

test("corrida no herói: quem caiu não leva; o que não cabe vira moedas; marca velha solta o herói", () => {
  const d = newRpgHero("u1", 0);
  applyVocation(d, 4);
  markRun(d, MARK, 0, DEFAULT_RATES);
  settleRun(d, "run-1", null, 2, MARK.ends_at);
  assert.equal(d.experience, 0);
  assert.equal(d.stamina, 2518);
  // Capacidade de 30 oz: o elmo (30 oz) cabe, o segundo não e vira 30 moedas.
  const e: RpgHeroDoc = newRpgHero("u2", 0);
  applyVocation(e, 4);
  e.cap = 30;
  markRun(e, MARK, 0, DEFAULT_RATES);
  const out = settleRun(
    e,
    "run-1",
    { ...REWARD, exp: 0, gold: 0, loot: [{ item: "elmo-de-ferro", count: 2 }] },
    1,
    MARK.ends_at,
  );
  assert.ok(out.ok);
  assert.deepEqual(e.bag, []);
  assert.equal(e.gold, 60);
  assert.equal(bagWeight([{ item: "elmo-de-ferro", count: 1 }]), 3000);
  // Uma marca de corrida que nunca fechou deixa de prender depois de 10 min do fim.
  const f = newRpgHero("u3", 0);
  applyVocation(f, 4);
  markRun(f, MARK, 0, DEFAULT_RATES);
  assert.ok(inRun(f, MARK.ends_at + RUN_STALE_MS - 1));
  assert.ok(!inRun(f, MARK.ends_at + RUN_STALE_MS));
  assert.deepEqual(unmarkRun(f, "outra"), { ok: false, reason: "not_in_run" });
  assert.deepEqual(unmarkRun(f, "run-1"), { ok: true });
});

test("herói de antes da O5 ganha os campos novos; a stamina recupera fora da dungeon", () => {
  const old = newRpgHero("u1", 0) as Partial<RpgHeroDoc>;
  delete old.gold;
  delete old.bag;
  delete old.stamina_at;
  delete old.run;
  const d = normalizeHero(old as RpgHeroDoc);
  assert.equal(d.gold, 0);
  assert.deepEqual(d.bag, []);
  assert.equal(d.run, null);
  d.stamina = 1_000;
  d.stamina_at = 0;
  // 10 min de carência, depois 1 min a cada 3 min [TFS regenerate_stamina.lua].
  assert.equal(staminaNow(d, 600_000), 1_000);
  assert.equal(staminaNow(d, 600_000 + 180_000 * 10), 1_010);
  const view = rpgHeroView(d, DEFAULT_RATES, 600_000 + 180_000 * 10);
  assert.equal(view.stamina, 1_010);
  assert.equal(view.gear.weapon, null, "sem vocação, sem kit");
});
