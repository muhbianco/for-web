import assert from "node:assert/strict";
import test from "node:test";

import {
  type Inventory,
  addGold,
  addItem,
  changeCoins,
  coinValue,
  equipItem,
  freeCapacity,
  gearOf,
  inventoryKey,
  inventoryWeight,
  packSize,
  STACK_MAX,
  starterInventory,
  unequipItem,
  validInventory,
} from "./inventory.ts";
import { itemDef } from "./items.ts";

const bag = (n = 0): Inventory => ({
  equip: { mochila: { item: n > 8 ? "mochila" : "bolsa", count: 1 } },
  pack: [],
});

test("pilha de até 100, espaços contados e o peso contra a capacidade [TFS game.h, items.xml]", () => {
  const inv = bag();
  assert.equal(packSize(inv), 8);
  assert.equal(addItem(inv, 1_000, "flecha", 250), 250);
  assert.deepEqual(
    inv.pack.map((x) => x.count),
    [50, 100, 100],
  );
  // Não empilhável: um espaço cada; a bolsa tem 8.
  assert.equal(addItem(inv, 1_000, "elmo-de-ferro", 9), 5);
  assert.equal(inv.pack.length, 8);
  assert.equal(
    addItem(inv, 1_000, "flecha", 50),
    50,
    "completa a pilha que existe",
  );
  assert.equal(
    addItem(inv, 1_000, "flecha", 1),
    0,
    "sem espaço nem pilha aberta",
  );
  // Peso: a bolsa (8 oz) e 300 flechas (210 oz) e 5 elmos (150 oz).
  assert.equal(inventoryWeight(inv), 800 + 300 * 70 + 5 * 3000);
  const light = bag();
  assert.equal(
    addItem(light, 10, "moeda-de-ouro", 500),
    20,
    "10 oz − 8 da bolsa = 2 oz = 20 moedas",
  );
  assert.equal(freeCapacity(light, 10), 0);
});

test("três moedas: a pilha de 100 vira a de cima; usar a de cima dá 100 da de baixo [TFS change_gold.lua]", () => {
  const inv = bag();
  // Na dungeon, o que cai entra como ouro e a pilha que fecha 100 vira platina.
  assert.equal(addGold(inv, 1_000, 12_345), 12_345);
  assert.equal(coinValue(inv), 12_345);
  const by = (id: string) =>
    inv.pack.filter((x) => x.item === id).reduce((n, x) => n + x.count, 0);
  assert.equal(by("moeda-de-cristal"), 1);
  assert.equal(by("moeda-de-platina"), 23);
  assert.equal(by("moeda-de-ouro"), 45);
  assert.equal(inv.pack.length, 3, "três espaços, não 124");
  // Usar: 100 de ouro → 1 de platina; platina → 100 de ouro; ouro solto não desce.
  const gold = inv.pack.findIndex((x) => x.item === "moeda-de-ouro");
  assert.deepEqual(changeCoins(inv, 1_000, gold), {
    ok: false,
    reason: "not_enough",
  });
  const plat = inv.pack.findIndex((x) => x.item === "moeda-de-platina");
  assert.deepEqual(changeCoins(inv, 1_000, plat), { ok: true });
  assert.equal(by("moeda-de-ouro"), 145);
  assert.equal(coinValue(inv), 12_345);
  const full = inv.pack.findIndex(
    (x) => x.item === "moeda-de-ouro" && x.count === STACK_MAX,
  );
  assert.deepEqual(changeCoins(inv, 1_000, full), { ok: true });
  assert.equal(by("moeda-de-platina"), 23);
  const crys = inv.pack.findIndex((x) => x.item === "moeda-de-cristal");
  assert.deepEqual(changeCoins(inv, 1_000, crys), { ok: true });
  assert.equal(by("moeda-de-platina"), 123);
  assert.equal(coinValue(inv), 12_345);
  // Sem capacidade para 100 de ouro, a platina não desce.
  const tight = bag();
  addItem(tight, 100, "moeda-de-platina", 1);
  assert.deepEqual(changeCoins(tight, 9, 0), { ok: false, reason: "no_room" });
});

test("as duas mãos, o recipiente e o que a vocação e o level permitem", () => {
  const inv = starterInventory(4);
  assert.equal(
    inv.equip.mochila?.item,
    "bolsa",
    "a bolsa do primeiro dia [TFS first_items.lua]",
  );
  assert.equal(inv.equip.escudo?.item, "escudo-de-tabuas");
  assert.equal(inv.pack.length, 2, "as outras armas do kit");
  addItem(inv, 1_000, "arco-de-caca", 1);
  assert.deepEqual(equipItem(inv, 4, 1, 0), { ok: false, reason: "vocation" });
  addItem(inv, 1_000, "espada-larga", 1);
  assert.deepEqual(equipItem(inv, 4, 1, 0), { ok: false, reason: "level" });
  // O arqueiro: arco de duas mãos não entra com escudo.
  const a = starterInventory(3);
  assert.equal(a.equip.municao?.count, 100);
  assert.equal(gearOf(a).ammoCount, 100);
  delete a.equip.arma;
  a.equip.escudo = { item: "escudo-de-bronze", count: 1 };
  addItem(a, 1_000, "arco-de-caca", 1);
  assert.deepEqual(equipItem(a, 3, 1, 0), { ok: false, reason: "both_hands" });
  assert.deepEqual(unequipItem(a, "escudo"), { ok: true });
  const bow = a.pack.findIndex((x) => x.item === "arco-de-caca");
  assert.deepEqual(equipItem(a, 3, 1, bow), { ok: true });
  // Trocar a bolsa pela mochila leva tudo junto, com a bolsa dentro.
  const k = starterInventory(4);
  addItem(k, 1_000, "mochila", 1);
  const before = k.pack.length;
  assert.deepEqual(equipItem(k, 4, 1, 0), { ok: true });
  assert.equal(k.equip.mochila?.item, "mochila");
  assert.equal(k.pack.length, before, "sai a mochila, entra a bolsa vazia");
  assert.ok(k.pack.some((x) => x.item === "bolsa"));
  assert.deepEqual(unequipItem(k, "mochila"), {
    ok: false,
    reason: "is_container",
  });
});

test("colar e anel nascem com cargas e tempo cheios; a chave compara inventários", () => {
  const inv = bag();
  addItem(inv, 1_000, "amuleto-de-pedra", 1);
  addItem(inv, 1_000, "anel-do-folego", 1);
  assert.equal(inv.pack[1]!.charges, itemDef("amuleto-de-pedra")!.charges);
  assert.equal(inv.pack[0]!.duration, 1200);
  const other: Inventory = JSON.parse(JSON.stringify(inv));
  assert.equal(inventoryKey(inv), inventoryKey(other));
  other.pack[0]!.duration = 1199;
  assert.notEqual(inventoryKey(inv), inventoryKey(other));
  assert.ok(validInventory(inv));
  assert.ok(
    !validInventory({ equip: {}, pack: [{ item: "x", count: 1 }] }),
    "sem recipiente, mochila vazia",
  );
  assert.ok(!validInventory({ equip: {}, pack: "x" }));
});

test("dinheiro como no OT: moedas das maiores para as menores; pagar devolve o troco [TFS Game::addMoney, removeMoney]", async () => {
  const { addMoney, payCoins } = await import("./inventory.ts");
  const inv = bag();
  assert.equal(addMoney(inv, 1_000, 12_345), 0);
  const by = (id: string) =>
    inv.pack.filter((x) => x.item === id).reduce((n, x) => n + x.count, 0);
  assert.deepEqual(
    [by("moeda-de-cristal"), by("moeda-de-platina"), by("moeda-de-ouro")],
    [1, 23, 45],
  );
  // Pagar 30 com o que carrega: o troco volta nas maiores.
  assert.equal(payCoins(inv, 1_000, 30), 0);
  assert.equal(coinValue(inv), 12_315);
  assert.equal(by("moeda-de-ouro"), 15);
  assert.equal(payCoins(inv, 1_000, 99_999), null, "não tem");
  assert.equal(coinValue(inv), 12_315, "recusa sem mexer");
  // Sem espaço: o que não coube volta para quem chamou.
  const full = bag();
  for (let i = 0; i < 8; i++)
    full.pack.push({ item: "elmo-de-ferro", count: 1 });
  assert.equal(addMoney(full, 1_000, 250), 250);
});

test("munição que falta: a besta com flecha, o arco sem flecha; varinha e espada não usam", async () => {
  const { missingAmmo } = await import("./inventory.ts");
  const inv = starterInventory(3);
  assert.equal(missingAmmo(inv, 3, 9), null, "arco com as flechas do kit");
  inv.equip.arma = { item: "besta-leve", count: 1 };
  assert.equal(missingAmmo(inv, 3, 9), "virote");
  addItem(inv, 1_000, "virote", 10);
  assert.equal(missingAmmo(inv, 3, 9), null, "o virote na mochila serve (o herói repõe)");
  const k = starterInventory(4);
  assert.equal(missingAmmo(k, 4, 1), null);
});
