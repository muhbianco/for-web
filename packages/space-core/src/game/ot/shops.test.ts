import assert from "node:assert/strict";
import test from "node:test";

import { COINS, itemDef, ITEMS } from "./items.ts";
import {
  MERCHANT_SELLS,
  merchantBuys,
  supplyPrice,
} from "./shops.ts";

test("mercador: preços do TFS onde há; compra pelo valor; moedas não [TFS Tyoric.xml, Riona.xml]", () => {
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
  assert.equal(merchantBuys("espada-curta"), 10, "o kit vale pouco");
  // [nosso] munição volta pela metade do preço, para baixo
  assert.equal(merchantBuys("flecha"), 1);
  assert.equal(merchantBuys("virote"), 1);
  assert.equal(merchantBuys("flecha-afiada"), 2);
  assert.equal(merchantBuys("virote-perfurante"), 2);
  // [nosso] o kit pelo valor pequeno; o resto que ele vende, pela metade
  assert.equal(merchantBuys("gibao-de-couro"), 12);
  assert.equal(merchantBuys("capuz-de-couro"), 4);
  assert.equal(merchantBuys("botas-de-couro"), 2);
  assert.equal(merchantBuys("arco-de-caca"), 100);
  assert.equal(merchantBuys("mochila"), 10);
  assert.equal(merchantBuys("bolsa"), 2);
  assert.equal(merchantBuys("pocao-pequena-de-vida"), 10);
  // Todo item que não é moeda tem comprador.
  for (const d of Object.values(ITEMS))
    if (!COINS.includes(d.id)) assert.ok(merchantBuys(d.id) !== null, d.id);
  // Nada se compra mais barato do que ele paga (senão daria lucro sem caçar).
  for (const o of MERCHANT_SELLS)
    assert.ok((merchantBuys(o.item) ?? 0) <= o.price, o.item);
  assert.equal(supplyPrice("flecha"), 2);
  assert.equal(
    supplyPrice("amuleto-de-pedra"),
    itemDef("amuleto-de-pedra")!.value,
  );
});

