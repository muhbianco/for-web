import assert from "node:assert/strict";
import test from "node:test";

import { itemDef } from "./items.ts";
import {
  cannotPromote,
  MERCHANT_SELLS,
  merchantBuys,
  PROMOTION,
  supplyPrice,
} from "./shops.ts";

test("mercador: preços do TFS onde há; compra pelo valor; moedas e kit não [TFS Tyoric.xml, Riona.xml]", () => {
  const price = (id: string) =>
    MERCHANT_SELLS.find((o) => o.item === id)?.price;
  assert.equal(price("flecha"), 2);
  assert.equal(price("virote"), 3);
  assert.equal(price("arco-de-caca"), 200);
  assert.equal(price("besta-leve"), 360);
  assert.equal(price("mochila"), 20);
  for (const o of MERCHANT_SELLS) assert.ok(itemDef(o.item), o.item);
  assert.equal(merchantBuys("espada-de-ferro"), 60);
  assert.equal(merchantBuys("moeda-de-ouro"), null);
  assert.equal(merchantBuys("espada-curta"), null, "o kit não vale nada");
  assert.equal(merchantBuys("flecha"), null, "munição ele só vende");
  // Nada se compra mais barato do que ele paga (senão daria lucro sem caçar).
  for (const o of MERCHANT_SELLS)
    assert.ok((merchantBuys(o.item) ?? 0) <= o.price, o.item);
  assert.equal(supplyPrice("flecha"), 2);
  assert.equal(
    supplyPrice("amuleto-de-pedra"),
    itemDef("amuleto-de-pedra")!.value,
  );
});

test("promoção: level 20 e 20.000 de ouro, uma vez [TFS promotion.lua]", () => {
  assert.deepEqual(PROMOTION, { level: 20, cost: 20_000 });
  assert.equal(cannotPromote(0, 30), "no_vocation");
  assert.equal(cannotPromote(4, 19), "level");
  assert.equal(cannotPromote(4, 20), null);
  assert.equal(cannotPromote(8, 40), "promoted");
});
