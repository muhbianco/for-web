import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RATES,
  TRAINING,
  coinValue,
  inventoryWeight,
} from "@muchat/space-core/game/ot";

import {
  type RpgHeroDoc,
  applyVocation,
  changeHeroCoins,
  creditTraining,
  discardHeroItem,
  equipHero,
  inRun,
  markRun,
  newRpgHero,
  normalizeHero,
  RUN_STALE_MS,
  rpgHeroView,
  setAutoEquip,
  settleRun,
  staminaNow,
  startTraining,
  stopTraining,
  trainingExpired,
  unequipHero,
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
  // Sem limite de treino (24/11/2026): o saldo continua cheio.
  assert.ok(d.bank.ms > 365 * 24 * H);
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

test("treino sem limite (24/11/2026): não acaba pelo saldo; a sessão de antes (2 h) segue sem fim na leitura", async () => {
  const { normalizeHero } = await import("./hero.ts");
  const d = newRpgHero("u1", 0);
  applyVocation(d, 4);
  d.bank = { ms: 2 * H, at: 0 };
  startTraining(d, SPOT, "machado", 0, DEFAULT_RATES);
  assert.equal(trainingExpired(d, 2 * H), false);
  assert.equal(trainingExpired(d, 72 * H), false);
  // 10 h seguidas contam inteiras (antes paravam nas 2 h do saldo).
  stopTraining(d, 10 * H, DEFAULT_RATES);
  const other = newRpgHero("u2", 0);
  applyVocation(other, 4);
  startTraining(other, SPOT, "machado", 0, DEFAULT_RATES);
  stopTraining(other, 2 * H, DEFAULT_RATES);
  assert.ok(d.skills.machado.level > other.skills.machado.level);
  // Um herói gravado com a sessão de 2 h aberta: a leitura estende o orçamento.
  const old = newRpgHero("u3", 0);
  applyVocation(old, 4);
  startTraining(old, SPOT, "machado", 0, DEFAULT_RATES);
  old.training!.budgetMs = 2 * H;
  old.bank = { ms: 0, at: 0 };
  normalizeHero(old);
  assert.ok(old.training!.budgetMs > 365 * 24 * H);
  assert.ok(old.bank.ms > 365 * 24 * H);
});

test("treino: começa com qualquer saldo; repetir o mesmo dummy não reinicia; trocar fecha o anterior", () => {
  const d = newRpgHero("u1", 0);
  applyVocation(d, 4);
  // Sem limite (24/11/2026): o saldo de antes (30 s) não impede mais.
  d.bank = { ms: 30_000, at: 0 };
  assert.deepEqual(startTraining(d, SPOT, "espada", 0, DEFAULT_RATES), {
    ok: true,
  });
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
  assert.ok(d.training!.budgetMs > 365 * 24 * H);
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
  assert.equal(coinValue(d.inv), 12, "as moedas entram como moedas de ouro");
  assert.equal(
    d.inv.equip.cabeca?.item,
    "elmo-de-ferro",
    "o automático veste o elmo",
  );
  assert.ok(d.inv.pack.some((x) => x.item === "capuz-de-couro"));
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

test("corrida no herói: quem caiu não leva; o que não cabe fica no corpo; marca velha solta o herói", () => {
  const d = newRpgHero("u1", 0);
  applyVocation(d, 4);
  markRun(d, MARK, 0, DEFAULT_RATES);
  settleRun(d, "run-1", null, 2, MARK.ends_at);
  assert.equal(d.experience, 0);
  assert.equal(d.stamina, 2518);
  // Capacidade de 300 oz: o kit pesa 270; o elmo (30 oz) cabe, o segundo não.
  const e: RpgHeroDoc = newRpgHero("u2", 0);
  applyVocation(e, 4);
  e.cap = 300;
  e.auto_equip = false;
  assert.equal(inventoryWeight(e.inv), 27_000);
  markRun(e, MARK, 0, DEFAULT_RATES);
  const out = settleRun(
    e,
    "run-1",
    { ...REWARD, exp: 0, gold: 0, loot: [{ item: "elmo-de-ferro", count: 2 }] },
    1,
    MARK.ends_at,
  );
  assert.ok(out.ok);
  assert.equal(
    e.inv.pack.filter((x) => x.item === "elmo-de-ferro").length,
    1,
    "um elmo entra, o outro fica no corpo",
  );
  assert.equal(coinValue(e.inv), 0, "nada vira moeda");
  // Uma marca de corrida que nunca fechou deixa de prender depois de 10 min do fim.
  const f = newRpgHero("u3", 0);
  applyVocation(f, 4);
  markRun(f, MARK, 0, DEFAULT_RATES);
  assert.ok(inRun(f, MARK.ends_at + RUN_STALE_MS - 1));
  assert.ok(!inRun(f, MARK.ends_at + RUN_STALE_MS));
  assert.deepEqual(unmarkRun(f, "outra"), { ok: false, reason: "not_in_run" });
  assert.deepEqual(unmarkRun(f, "run-1"), { ok: true });
});

test("[nosso] a mochila lida junta itens iguais; a corrida que começou antes fecha com o loot", () => {
  const d = newRpgHero("u9", 0);
  applyVocation(d, 3);
  d.auto_equip = false;
  // Como gravado antes: dois elmos em espaços separados.
  d.inv.pack.push(
    { item: "elmo-de-ferro", count: 1 },
    { item: "elmo-de-ferro", count: 1 },
  );
  const start = structuredClone(d.inv);
  markRun(d, MARK, 0, DEFAULT_RATES);
  const read = normalizeHero(structuredClone(d));
  const helms = (x: RpgHeroDoc) =>
    x.inv.pack.filter((p) => p.item === "elmo-de-ferro");
  assert.deepEqual(helms(read), [{ item: "elmo-de-ferro", count: 2 }]);
  // O fim da corrida veio da mochila de antes, com o loot.
  const alive = structuredClone(start);
  alive.pack.unshift({ item: "espada-de-ferro", count: 1 });
  const out = settleRun(read, "run-1", REWARD, 1, MARK.ends_at, {
    start,
    alive,
    bare: structuredClone(start),
  });
  assert.ok(out.ok && !out.settled.invMismatch, "sem perder o loot");
  assert.ok(read.inv.pack.some((p) => p.item === "espada-de-ferro"));
  assert.deepEqual(helms(read), [{ item: "elmo-de-ferro", count: 2 }]);
});

test("herói de antes da O7: kit vestido, mochila de 20, os itens de mais valor e o resto em moedas", () => {
  const old = newRpgHero("u1", 0) as unknown as Record<string, unknown>;
  applyVocation(old as unknown as RpgHeroDoc, 4);
  delete old.inv;
  delete old.auto_equip;
  old.v = 1;
  old.gold = 250;
  old.bag = [
    { item: "elmo-de-ferro", count: 1 },
    { item: "espada-larga", count: 1 },
    { item: "cota-de-malha", count: 30 },
    { item: "coisa-que-nao-existe", count: 1 },
  ];
  const d = normalizeHero(old as unknown as RpgHeroDoc);
  assert.equal(d.v, 3);
  assert.equal(d.auto_equip, true);
  assert.equal(d.inv.equip.mochila?.item, "mochila");
  assert.ok(d.inv.pack.length <= 20);
  assert.equal("gold" in d, false);
  assert.equal("bag" in d, false);
  // [nosso] Itens iguais juntam: as 30 cotas são uma pilha; tudo cabe nos 15 espaços livres
  // (20, menos 3 para as moedas e 2 do kit) e só o ouro vira moeda.
  const cotas =
    d.inv.pack
      .filter((x) => x.item === "cota-de-malha")
      .reduce((n, x) => n + x.count, 0) +
    (d.inv.equip.corpo?.item === "cota-de-malha" ? 1 : 0);
  assert.equal(d.inv.equip.corpo?.item, "cota-de-malha", "o automático veste a melhor");
  assert.equal(cotas, 30);
  assert.equal(d.inv.equip.cabeca?.item, "elmo-de-ferro", "o elmo coube");
  assert.ok(d.inv.pack.some((x) => x.item === "espada-larga"));
  assert.equal(coinValue(d.inv), 250);
  // Sem vocação: só a bolsa.
  const nov = newRpgHero("u9", 0) as unknown as Record<string, unknown>;
  delete nov.inv;
  const n = normalizeHero(nov as unknown as RpgHeroDoc);
  assert.equal(n.inv.equip.mochila?.item, "bolsa");
  assert.deepEqual(n.inv.pack, []);
});

test("a stamina recupera fora da dungeon; o herói sem vocação não veste nada", () => {
  const d = newRpgHero("u1", 0);
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

test("inventário: equipar, tirar, automático, trocar moedas e jogar fora; nada na dungeon", () => {
  const d = newRpgHero("u1", 0);
  assert.deepEqual(setAutoEquip(d, true, 0), { ok: false, reason: "no_vocation" });
  applyVocation(d, 4);
  // O kit: com as skills no 10, a machadinha (ataque 13) vestida; espada e porrete na bolsa.
  assert.equal(d.inv.equip.arma?.item, "machadinha");
  const i = d.inv.pack.findIndex((x) => x.item === "porrete");
  assert.deepEqual(equipHero(d, i, "espada-curta", 0), { ok: false, reason: "changed" });
  assert.deepEqual(equipHero(d, i, "porrete", 0), { ok: true });
  assert.equal(d.inv.equip.arma?.item, "porrete");
  assert.equal(d.auto_equip, false, "mexer à mão desliga o automático");
  assert.deepEqual(setAutoEquip(d, true, 0), { ok: true });
  assert.equal(d.inv.equip.arma?.item, "machadinha", "o automático volta a escolher");
  assert.deepEqual(unequipHero(d, "cabeca", 0), { ok: true });
  assert.equal(d.inv.equip.cabeca, undefined);
  assert.deepEqual(unequipHero(d, "mochila", 0), { ok: false, reason: "is_container" });
  // Moedas: 100 de ouro viram 1 de platina; a platina volta a 100 de ouro.
  d.inv.pack.unshift({ item: "moeda-de-ouro", count: 100 });
  assert.deepEqual(changeHeroCoins(d, 0, "moeda-de-ouro", 0), { ok: true });
  assert.equal(d.inv.pack[0]?.item, "moeda-de-platina");
  assert.equal(coinValue(d.inv), 100);
  assert.deepEqual(changeHeroCoins(d, 0, "moeda-de-platina", 0), { ok: true });
  assert.equal(coinValue(d.inv), 100);
  assert.ok(d.inv.pack.some((x) => x.item === "moeda-de-ouro" && x.count === 100));
  const g = d.inv.pack.findIndex((x) => x.item === "moeda-de-ouro");
  assert.deepEqual(discardHeroItem(d, g, "moeda-de-ouro", 0), { ok: true });
  assert.equal(coinValue(d.inv), 0);
  // Na dungeon, nada.
  markRun(d, MARK, 0, DEFAULT_RATES);
  assert.deepEqual(unequipHero(d, "pes", 1), { ok: false, reason: "in_run" });
  assert.deepEqual(setAutoEquip(d, false, 1), { ok: false, reason: "in_run" });
});

test("NPCs: compra paga das moedas e do banco; venda pelo valor; depósito e saque; promoção no 20", async () => {
  const {
    bankDeposit,
    bankWithdraw,
    buyFromMerchant,
    promoteHero,
    sellToMerchant,
  } = await import("./hero.ts");
  const d = newRpgHero("u1", 0);
  applyVocation(d, 3);
  assert.deepEqual(buyFromMerchant(d, "flecha", 100, 0), {
    ok: false,
    reason: "no_money",
  });
  d.inv.pack.unshift({ item: "moeda-de-platina", count: 2 });
  // 50 flechas a 2: paga com as 2 platinas e recebe 100 de troco.
  assert.deepEqual(buyFromMerchant(d, "flecha", 50, 0), { ok: true });
  assert.equal(coinValue(d.inv), 100);
  assert.deepEqual(buyFromMerchant(d, "espada-de-ferro", 1, 0), {
    ok: false,
    reason: "not_sold",
  });
  // Do banco quando falta: 100 em moedas + 100 do banco pagam 100 flechas (200).
  d.bank_gold = 150;
  assert.deepEqual(buyFromMerchant(d, "flecha", 100, 0), { ok: true });
  assert.equal(coinValue(d.inv), 0);
  assert.equal(d.bank_gold, 150 - 100);
  // Venda: o mercador paga o valor; o arco do kit, que ele vende, pela metade.
  d.inv.pack.unshift({ item: "besta-leve", count: 1 });
  assert.deepEqual(sellToMerchant(d, 0, "besta-leve", 1, 0), { ok: true });
  assert.equal(coinValue(d.inv), 80);
  const bow = d.inv.equip.arma!;
  d.inv.pack.unshift(bow);
  delete d.inv.equip.arma;
  assert.deepEqual(sellToMerchant(d, 0, "arco-de-caca", 1, 0), { ok: true });
  assert.equal(coinValue(d.inv), 180);
  const coin = d.inv.pack.findIndex((x) => x.item === "moeda-de-ouro");
  assert.deepEqual(sellToMerchant(d, coin, "moeda-de-ouro", 1, 0), {
    ok: false,
    reason: "not_bought",
  });
  // Banco: depositar tudo, sacar parte.
  assert.deepEqual(bankDeposit(d, 0, 0), { ok: true });
  assert.equal(coinValue(d.inv), 0);
  assert.equal(d.bank_gold, 230);
  assert.deepEqual(bankWithdraw(d, 300, 0), { ok: false, reason: "no_money" });
  assert.deepEqual(bankWithdraw(d, 30, 0), { ok: true });
  assert.equal(coinValue(d.inv), 30);
  assert.equal(d.bank_gold, 200);
  // Evolução para a 2ª classe (24/11/2026): level 20, 8 pontos na árvore e 20.000.
  assert.deepEqual(promoteHero(d, 0), { ok: false, reason: "level" });
  d.level = 20;
  assert.deepEqual(promoteHero(d, 0), { ok: false, reason: "points" });
  d.points = { points: 8, tries: 0 };
  d.tree = { "rajada-dupla.forca": 5, "rajada-dupla.economia": 3 };
  assert.deepEqual(promoteHero(d, 0), { ok: false, reason: "no_money" });
  d.bank_gold = 19_970;
  assert.deepEqual(promoteHero(d, 0), { ok: true });
  assert.equal(d.vocation, 7, "o arqueiro vira caçador");
  assert.equal(d.bank_gold + coinValue(d.inv), 0);
  // A 3ª pede level 50 e 24 pontos.
  assert.deepEqual(promoteHero(d, 0), { ok: false, reason: "level" });
});

test("transferência: sai do saldo para a fila; crédito uma vez só; devolução se o destino sumiu", async () => {
  const { transferIn, transferOut, transferSettled } = await import("./hero.ts");
  const a = newRpgHero("A", 0);
  applyVocation(a, 4);
  const b = newRpgHero("B", 0);
  applyVocation(b, 1);
  const t = { id: "t1", to: "B", amount: 500, at: 0 };
  assert.deepEqual(transferOut(a, t, 0), { ok: false, reason: "no_money" });
  a.bank_gold = 600;
  assert.deepEqual(transferOut(a, { ...t, to: "A" }, 0), { ok: false, reason: "self" });
  assert.deepEqual(transferOut(a, t, 0), { ok: true });
  assert.equal(a.bank_gold, 100);
  assert.equal(a.outbox.length, 1);
  transferIn(b, t);
  transferIn(b, t);
  assert.equal(b.bank_gold, 500, "a mesma transferência não credita duas vezes");
  assert.deepEqual(transferSettled(a, "t1", false), { ok: true });
  assert.equal(a.outbox.length, 0);
  transferOut(a, { ...t, id: "t2", amount: 100 }, 0);
  transferSettled(a, "t2", true);
  assert.equal(a.bank_gold, 100, "destino sem herói: volta");
});

test("poções e filtro: a escolha é guardada e vai para a corrida; moeda não se ignora", async () => {
  const { setLootSkip, setSupplies, heroRunSnapshot } = await import("./hero.ts");
  const d = newRpgHero("u1", 0);
  assert.deepEqual(d.supplies.health, { item: null, below: 50 });
  applyVocation(d, 2);
  assert.deepEqual(
    setSupplies(d, {
      health: { item: "pocao-de-mana", below: 40 },
      mana: { item: null, below: 30 },
    }),
    { ok: false, reason: "not_potion" },
  );
  assert.deepEqual(
    setSupplies(d, {
      health: { item: "pocao-de-vida", below: 40 },
      mana: { item: "pocao-de-mana", below: 60 },
    }),
    { ok: true },
  );
  assert.deepEqual(setLootSkip(d, "moeda-de-ouro", true), { ok: false, reason: "not_item" });
  assert.deepEqual(setLootSkip(d, "elmo-de-ferro", true), { ok: true });
  setLootSkip(d, "elmo-de-ferro", true);
  assert.deepEqual(d.loot_skip, ["elmo-de-ferro"]);
  const snap = heroRunSnapshot(d, "Ana", 0);
  assert.equal(snap.supplies?.mana.below, 60);
  assert.deepEqual(snap.lootSkip, ["elmo-de-ferro"]);
  setLootSkip(d, "elmo-de-ferro", false);
  assert.deepEqual(d.loot_skip, []);
  // Herói antigo: o padrão.
  const old = newRpgHero("u2", 0) as unknown as Record<string, unknown>;
  delete old.supplies;
  delete old.loot_skip;
  const n = normalizeHero(old as unknown as RpgHeroDoc);
  assert.deepEqual(n.supplies.mana, { item: null, below: 30 });
  assert.deepEqual(n.loot_skip, []);
});

test("herói 3 (24/11/2026): versão 2 vira 3 com atributos em 1 e os pontos do level livres", () => {
  const old = newRpgHero("V2", 0) as RpgHeroDoc & Record<string, unknown>;
  applyVocation(old, 4);
  old.level = 12;
  old.v = 2 as never;
  const raw = old as Partial<RpgHeroDoc>;
  delete raw.stats;
  delete raw.tree;
  delete raw.points;
  delete raw.third;
  delete raw.resets;
  const d = normalizeHero(old);
  assert.equal(d.v, 3);
  assert.deepEqual(d.stats, { for: 1, agi: 1, vit: 1, int: 1, des: 1, sor: 1 });
  const v = rpgHeroView(d, DEFAULT_RATES, 0);
  assert.equal(v.stat_points, 60);
  assert.equal(v.job, 1);
  assert.deepEqual(v.skill_points, { earned: 0, free: 0, tries: 0, next: 50 });
  // Árvore com nó que não existe, ou de outra classe: zera na leitura.
  const bad = { ...d, tree: { "golpe-de-raio.forca": 1 } };
  assert.deepEqual(normalizeHero(bad).tree, {});
});

test("atributos: põe fora da dungeon; VIT, INT e FOR mudam vida, mana e capacidade", async () => {
  const { allocateStats } = await import("./hero.ts");
  const d = newRpgHero("S", 0);
  assert.deepEqual(allocateStats(d, { for: 1 }, 0), { ok: false, reason: "no_vocation" });
  applyVocation(d, 4);
  // Level 10: 50 pontos; VIT 31 e FOR 21 custam 30 e 20 (até o 50 cada ponto custa 1).
  d.level = 10;
  assert.deepEqual(allocateStats(d, { vit: 30, for: 20 }, 0), { ok: true });
  assert.deepEqual(allocateStats(d, { vit: 1 }, 0), { ok: false, reason: "no_points" });
  const v = rpgHeroView(d, DEFAULT_RATES, 0);
  assert.equal(v.stat_points, 0);
  assert.equal(v.health_max, Math.floor(v.base.health * 1.31));
  assert.equal(v.cap, v.base.cap + 210);
  markRun(d, { id: "r", dungeon: "cripta-do-musgo", ends_at: 10 * H }, 1, DEFAULT_RATES);
  d.level = 11;
  assert.deepEqual(allocateStats(d, { vit: 1 }, 2), { ok: false, reason: "in_run" });
});

test("treino de habilidade: só no dummy de habilidade; os pontos vão para a árvore", async () => {
  const { learnNode } = await import("./hero.ts");
  const d = newRpgHero("T", 0);
  applyVocation(d, 1);
  assert.deepEqual(startTraining(d, SPOT, "habilidade", 0, DEFAULT_RATES, "vocacao"), {
    ok: false,
    reason: "wrong_dummy",
  });
  assert.deepEqual(startTraining(d, SPOT, "espada", 0, DEFAULT_RATES, "habilidade"), {
    ok: false,
    reason: "wrong_dummy",
  });
  assert.deepEqual(startTraining(d, SPOT, "habilidade", 0, DEFAULT_RATES, "habilidade"), { ok: true });
  const sword = d.skills.espada.tries;
  stopTraining(d, 10 * 60_000, DEFAULT_RATES);
  assert.equal(d.skills.espada.tries, sword, "nenhuma skill de arma");
  assert.equal(d.skills.escudo.tries, 0, "nem o escudo");
  // 10 min = 300 tentativas: 50 + 55 + 60 + 66 = 231 dão 4 pontos (o 5º pede 73).
  assert.equal(d.points.points, 4);
  assert.deepEqual(learnNode(d, "golpe-de-raio.forca", 0), { ok: true });
  assert.deepEqual(learnNode(d, "golpe-brutal.forca", 0), { ok: false, reason: "not_class" });
  assert.deepEqual(learnNode(d, "golpe-de-raio.corrente", 0), { ok: false, reason: "tier" });
  for (let i = 0; i < 3; i++) learnNode(d, "golpe-de-raio.forca", 0);
  assert.deepEqual(learnNode(d, "golpe-de-raio.forca", 0), { ok: false, reason: "no_points" });
  assert.equal(rpgHeroView(d, DEFAULT_RATES, 0).skill_points.free, 0);
});

test("Mestre: redistribuir é de graça na primeira vez e depois cobra 500 por level", async () => {
  const { allocateStats, learnNode, resetHero } = await import("./hero.ts");
  const d = newRpgHero("R", 0);
  applyVocation(d, 4);
  d.level = 10;
  assert.deepEqual(resetHero(d, "stats", 0), { ok: false, reason: "nothing_to_reset" });
  allocateStats(d, { for: 10 }, 0);
  assert.deepEqual(resetHero(d, "stats", 0), { ok: true });
  assert.equal(d.stats.for, 1);
  allocateStats(d, { for: 10 }, 0);
  assert.deepEqual(resetHero(d, "stats", 0), { ok: false, reason: "no_money" });
  d.bank_gold = 5_000;
  assert.deepEqual(resetHero(d, "stats", 0), { ok: true });
  assert.equal(d.bank_gold, 0);
  assert.deepEqual(d.resets, { stats: 2, tree: 0 });
  d.points = { points: 3, tries: 0 };
  learnNode(d, "desafio.presenca", 0);
  assert.deepEqual(resetHero(d, "tree", 0), { ok: true });
  assert.deepEqual(d.tree, {});
  assert.equal(rpgHeroView(d, DEFAULT_RATES, 0).skill_points.free, 3);
});

test("corrida: entra com a vida, a mana e a capacidade dos atributos, e com a árvore", async () => {
  const { allocateStats, heroRunSnapshot } = await import("./hero.ts");
  const d = newRpgHero("C", 0);
  applyVocation(d, 2);
  // INT 51 custa 50 pontos (a escada começa no 51): o level 10 tem 50.
  d.level = 10;
  allocateStats(d, { int: 50 }, 0);
  d.points = { points: 1, tries: 0 };
  d.tree = { "seiva.cura-leve": 1 };
  const r = heroRunSnapshot(d, "C", 0);
  assert.equal(r.manaMax, Math.floor(d.mana_max * 1.51));
  assert.equal(r.stats?.int, 51);
  assert.deepEqual(r.tree, { "seiva.cura-leve": 1 });
});

test("itens com atributos: o que veste soma na vida, na mana e na corrida; a capacidade fica nos pontos", async () => {
  const { heroRunSnapshot, capOf } = await import("./hero.ts");
  const d = newRpgHero("D", 0);
  applyVocation(d, 4);
  d.level = 20;
  const before = rpgHeroView(d, DEFAULT_RATES, 0);
  const cap = capOf(d);
  d.inv.equip.colar = { item: "colar-do-campeao", count: 1 };
  const view = rpgHeroView(d, DEFAULT_RATES, 0);
  assert.deepEqual(view.gear_stats, { for: 2, vit: 2 });
  assert.equal(view.stats.vit, before.stats.vit, "os pontos postos não mudam");
  assert.ok(view.health_max > before.health_max, "VIT do colar entra na vida");
  const r = heroRunSnapshot(d, "D", 0);
  assert.equal(r.stats?.for, d.stats.for + 2);
  assert.equal(r.healthMax, view.health_max);
  assert.equal(capOf(d), cap, "a FOR do item não mexe na capacidade");
});

test("refino no Ferreiro: só a arma empunhada, até +10; até o +4 não falha, acima volta um nível; cobra", async () => {
  const { refineWeapon } = await import("./hero.ts");
  const d = newRpgHero("R", 0);
  applyVocation(d, 4);
  delete d.inv.equip.arma;
  assert.deepEqual(refineWeapon(d, 0, 0), { ok: false, reason: "no_weapon" });
  d.inv.equip.arma = { item: "espada-de-ferro", count: 1 };
  d.bank_gold = 1_000_000;
  const one = refineWeapon(d, 99, 0);
  assert.ok(one.ok && one.result.success && one.result.to === 1, "100% no +1");
  assert.equal(d.inv.equip.arma?.refine, 1);
  assert.ok(d.bank_gold < 1_000_000, "cobrou");
  d.inv.equip.arma = { item: "espada-de-ferro", count: 1, refine: 5 };
  const fail = refineWeapon(d, 99, 0);
  assert.ok(fail.ok && !fail.result.success && fail.result.to === 4, "acima do +4 volta um");
  d.inv.equip.arma = { item: "espada-de-ferro", count: 1, refine: 4 };
  const keep = refineWeapon(d, 99, 0);
  assert.ok(keep.ok && keep.result.to === 4, "do +4 falhando fica no +4");
  d.inv.equip.arma = { item: "espada-de-ferro", count: 1, refine: 10 };
  assert.deepEqual(refineWeapon(d, 0, 0), { ok: false, reason: "max_refine" });
  d.bank_gold = 0;
  d.inv.equip.arma = { item: "espada-de-ferro", count: 1, refine: 3 };
  d.inv.pack = d.inv.pack.filter((x) => !x.item.startsWith("moeda"));
  assert.deepEqual(refineWeapon(d, 0, 0), { ok: false, reason: "no_money" });
});

test("renascimento da árvore: só na 3ª classe e com a árvore inteira cheia; qualquer adereço de uma habilidade ganha a maestria", async () => {
  const { rebirthTree, heroRunSnapshot } = await import("./hero.ts");
  const { TREE, abilityDef, abilityNow, VOCATIONS } = await import("@muchat/space-core/game/ot");
  const d = newRpgHero("N", 0);
  applyVocation(d, 3);
  d.level = 60;
  const fill = (tier: number) => {
    const t: Record<string, number> = {};
    for (const n of TREE) if (abilityDef(n.ability)?.cls === 3 && n.tier <= tier) t[n.id] = n.ranks;
    return t;
  };
  const all = fill(3);
  const spent = Object.values(all).reduce((a, b) => a + b, 0);
  d.points = { points: spent + 2, tries: 7 };
  // 24/11/2026: a árvore da 1ª classe cheia não basta (umas 2 h de dummy; quebrava o jogo).
  d.tree = fill(1);
  assert.deepEqual(rebirthTree(d, "rajada-dupla.forca", 0), { ok: false, reason: "not_last_tier" });
  // Na 3ª classe, só a parte da 1ª cheia: falta a árvore inteira.
  d.vocation = VOCATIONS[3].promotion!;
  d.third = true;
  assert.deepEqual(rebirthTree(d, "rajada-dupla.forca", 0), { ok: false, reason: "not_full" });
  d.tree = all;
  assert.deepEqual(rebirthTree(d, "golpe-brutal.forca", 0), { ok: false, reason: "not_class" });
  // Qualquer adereço vale, inclusive os de forma (Flecha perfurante).
  assert.deepEqual(rebirthTree(d, "rajada-dupla.perfurante", 0), { ok: true });
  assert.deepEqual(d.tree, {});
  assert.deepEqual(d.points, { points: 2, tries: 7 }, "os livres ficam; os postos voltam a ser treinados");
  assert.deepEqual(d.mastery, { "rajada-dupla.perfurante": 1 });
  assert.equal(d.rebirths, 1);
  assert.deepEqual(heroRunSnapshot(d, "N", 0).mastery, { "rajada-dupla.perfurante": 1 });
  assert.equal(rpgHeroView(d, DEFAULT_RATES, 0).rebirths, 1);
  // A maestria de um adereço de forma soma 0,5% ao poder da habilidade, com ele aprendido.
  const def = abilityDef("rajada-dupla")!;
  const tree = { "rajada-dupla.forca": 5, "rajada-dupla.perfurante": 1 };
  const plain = abilityNow(def, tree).power;
  const mastered = abilityNow(def, tree, d.mastery).power;
  assert.ok(Math.abs(mastered - plain * 1.005) < 1e-9, `${plain} → ${mastered}`);
  assert.equal(abilityNow(def, { "rajada-dupla.forca": 5 }, d.mastery).power, abilityNow(def, { "rajada-dupla.forca": 5 }).power, "sem o adereço aprendido, nada");
});

test("mana de um level já no 1 (24/11/2026): o mago de level 1 lança e bebe poção; o herói de antes ganha uma vez", async () => {
  const { normalizeHero } = await import("./hero.ts");
  const d = newRpgHero("M", 0);
  assert.equal(d.mana_max, 0);
  applyVocation(d, 1);
  assert.equal(d.mana_max, 30, "feiticeiro: a mana de um level");
  // Gravado antes da regra: mana 0 no level 1, sem a marca; a leitura soma uma vez só.
  const old = newRpgHero("O", 0);
  old.vocation = 2;
  old.mana_max = 0;
  delete old.mana_base;
  normalizeHero(old);
  normalizeHero(old);
  assert.equal(old.mana_max, 30);
});
