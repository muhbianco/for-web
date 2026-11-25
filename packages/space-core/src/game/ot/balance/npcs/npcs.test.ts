import assert from "node:assert/strict";
import test from "node:test";

import { trainDojo } from "../dojo.ts";
import type { ItemInstance } from "../equipment.ts";
import { balance as B } from "../formulas.ts";
import {
  goldTransferFee,
  itemTransferFee,
  planTransfer,
  vaultExpansionCost,
  vaultSlots,
} from "./bank.ts";
import {
  ammoPackPrice,
  buyBackPrice,
  commonItemPrice,
  potionPrice,
  sellNeedsConfirm,
} from "./merchant.ts";

// NPCs (spec §10) e Dojô (spec §2).

const item = (extra: Partial<ItemInstance> = {}): ItemInstance =>
  ({
    slot: "arma",
    family: "espada",
    ilvl: 100,
    rarity: "raro",
    refine: 0,
    affixes: [],
    ...extra,
  }) as ItemInstance;
const gold100 = B.lacaioGold(100);

test("Mercador: poção, munição e Comum pelo ouro do lacaio do tier", () => {
  // L100 está no tier 100; ouroLacaio(100) = 163 (§17).
  assert.equal(gold100, 163);
  assert.deepEqual(potionPrice(100), {
    hp: Math.ceil(0.25 * 163),
    mp: Math.ceil(0.3 * 163),
  });
  assert.deepEqual(ammoPackPrice("comum", 100), { units: 100, gold: 82 });
  assert.equal(ammoPackPrice("afiada", 100).gold, 163);
  assert.equal(ammoPackPrice("runica", 100).gold, 326);
  // No começo o pacote ainda custa pouco (o ouro do lacaio do 1 é 4).
  assert.equal(ammoPackPrice("comum", 1).gold, 2);
  // L120 ainda compra no tier 100.
  assert.deepEqual(commonItemPrice(120), { ilvl: 100, gold: 20 * 163 });
});

test("Mercador: do tier 300 em diante a poção sobe pela tabela da D30", () => {
  const at = (L: number, mult: number) => {
    const g = B.lacaioGold(L) * mult;
    return { hp: Math.ceil(0.25 * g), mp: Math.ceil(0.3 * g) };
  };
  assert.deepEqual(potionPrice(299), at(250, 1));
  assert.deepEqual(potionPrice(300), at(300, 1.35));
  assert.deepEqual(potionPrice(420), at(400, 2.6));
  assert.deepEqual(potionPrice(500), at(500, 3.7));
});

test("Mercador: compra por 10% do preço base, que sobe com a raridade; +7 pede confirmação", () => {
  assert.equal(
    buyBackPrice(item({ rarity: "comum" })),
    Math.floor(0.1 * 20 * 163),
  );
  assert.equal(
    buyBackPrice(item({ rarity: "raro" })),
    Math.floor(0.1 * 20 * 163 * 4),
  );
  assert.equal(
    buyBackPrice(item({ rarity: "raro", refine: 9 })),
    buyBackPrice(item({ rarity: "raro" })),
  );
  assert.ok(!sellNeedsConfirm(item({ refine: 6 })));
  assert.ok(sellNeedsConfirm(item({ refine: 7 })));
});

test("Banqueiro: cofre de 60 + 20 por expansão; expansão a 200 × ouro do lacaio", () => {
  assert.equal(vaultSlots(0), 60);
  assert.equal(vaultSlots(2), 100);
  assert.equal(vaultExpansionCost(100), 200 * 163);
});

test("Banqueiro: taxa de 2% no ouro (mínimo 1) e 5 × ouro do lacaio por item", () => {
  assert.equal(goldTransferFee(1000), 20);
  assert.equal(goldTransferFee(10), 1);
  assert.equal(itemTransferFee(item()), 5 * 163);
  const ok = planTransfer({
    from: "a",
    to: "b",
    gold: 1000,
    items: [item()],
    balance: 2000,
    confirmations: 1,
  });
  assert.deepEqual(ok, {
    ok: true,
    plan: { debit: 1000 + 20 + 815, credit: 1000, fee: 835 },
  });
});

test("Banqueiro: recusa para si, valor inválido, sem ouro, e +7 sem a 2ª confirmação", () => {
  const base = {
    from: "a",
    to: "b",
    gold: 100,
    items: [],
    balance: 1000,
    confirmations: 1,
  };
  assert.deepEqual(planTransfer({ ...base, to: "a" }), {
    ok: false,
    error: "para-si-mesmo",
  });
  assert.deepEqual(planTransfer({ ...base, gold: 1.5 }), {
    ok: false,
    error: "valor-invalido",
  });
  assert.deepEqual(planTransfer({ ...base, gold: 0 }), {
    ok: false,
    error: "valor-invalido",
  });
  assert.deepEqual(planTransfer({ ...base, balance: 100 }), {
    ok: false,
    error: "sem-ouro",
  });
  const risky = { ...base, gold: 0, items: [item({ refine: 7 })] };
  assert.deepEqual(planTransfer(risky), {
    ok: false,
    error: "confirmacao-dupla",
  });
  assert.equal(planTransfer({ ...risky, confirmations: 2 }).ok, true);
});

test("Dojô: 10 XP/s, +5% por outro herói até +25%; as horas batem com a curva do §2", () => {
  assert.equal(B.proficiencyXpPerSecond(0), 10);
  assert.ok(Math.abs(B.proficiencyXpPerSecond(2) - 11) < 1e-9);
  assert.ok(Math.abs(B.proficiencyXpPerSecond(10) - 12.5) < 1e-9);
  const hours = B.dojoHoursTo(500);
  const r = trainDojo({ proficiency: 1 }, hours * 3600 + 1, 0);
  assert.equal(r.hero.proficiency, 500);
  assert.equal(r.gained, 499);
  // Um segundo a menos não fecha o último nível.
  assert.equal(
    trainDojo({ proficiency: 1 }, hours * 3600 - 1, 0).hero.proficiency,
    499,
  );
});

test("Dojô: a Proficiência guardada passa do teto do nível e para em 5000", () => {
  const far = trainDojo({ proficiency: 4990 }, 1e9, 0);
  assert.equal(far.hero.proficiency, 5000);
  assert.equal(far.hero.proficiencyXp, 0);
  // Guardada acima do teto do nível 10 (10·10 + 250 = 350): a efetiva fica no teto até subir.
  assert.equal(B.effectiveProficiency(800, 10), 350);
  assert.equal(B.effectiveProficiency(800, 60), 800);
});
