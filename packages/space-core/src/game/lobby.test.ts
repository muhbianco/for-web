import assert from "node:assert/strict";
import { test } from "node:test";

import { CATALOG } from "../decor/catalog.ts";
import { LOBBY, type LobbyItem, lobbyAllowed, lobbyCatalog, lobbyItemOf, lobbyPlacementError, lobbyPrice, placedCount, STARTER_LOBBY } from "./lobby.ts";

// Refúgio (ADR 0009, etapa E4b): a decoração do quarto.

test("loja do Refúgio: só itens sem configuração nem sala, com preço de 50 a 50 mil", () => {
  const items = lobbyCatalog();
  assert.ok(items.length >= 50, `${items.length} itens`);
  for (const it of items) {
    assert.equal(it.interaction, undefined, it.id);
    assert.notEqual(it.layer, "floor", it.id);
    const p = lobbyPrice(it);
    assert.ok(Number.isInteger(p) && p >= 50 && p <= 50_000, `${it.id}: ${p}`);
  }
  // Fora: objetos interativos e a TV.
  for (const id of ["desk-pc", "tv-stand", "tv-wall", "arcade", "portal-pad", "whiteboard", "floor-wood"]) assert.equal(lobbyItemOf(id), undefined, id);
  assert.equal(CATALOG.items.filter(lobbyAllowed).length, items.length);
  // Faixas do GDD §11.1: comum na faixa de 300 a 800, luxo acima de 20 mil.
  assert.equal(lobbyPrice(lobbyItemOf("chair")!), 400);
  assert.equal(lobbyPrice(lobbyItemOf("rug-round")!), 750);
  assert.ok(lobbyPrice(lobbyItemOf("statue")!) >= 20_000);
  assert.ok(lobbyPrice(lobbyItemOf("fountain")!) >= 20_000);
});

const at = (item: string, x: number, y: number, rot: 0 | 1 | 2 | 3 = 0, id = `${item}@${x},${y}`): LobbyItem => ({ id, item, x, y, rot });

test("quarto: parede, piso, bordas, camadas, lugares do boneco e do herói", () => {
  const none: LobbyItem[] = [];
  assert.equal(lobbyPlacementError(none, at("poster", 3, 0)), null);
  assert.equal(lobbyPlacementError(none, at("poster", 3, 1)), null);
  assert.equal(lobbyPlacementError(none, at("poster", 3, 2)), "out_of_bounds", "parede só nas linhas 0 e 1");
  assert.equal(lobbyPlacementError(none, at("poster", 3, 4)), "out_of_bounds", "quadro no piso");
  assert.equal(lobbyPlacementError(none, at("chair", 3, 2)), "out_of_bounds", "cadeira na parede");
  assert.equal(lobbyPlacementError(none, at("chair", 3, 7)), null);
  assert.equal(lobbyPlacementError(none, at("sofa-3", 10, 4)), "out_of_bounds", "passa da borda direita");
  assert.equal(lobbyPlacementError(none, at("rug-living", 0, 6)), "out_of_bounds", "passa do fundo");
  assert.equal(lobbyPlacementError(none, at("chair", 9, 5)), "reserved", "lugar do boneco");
  assert.equal(lobbyPlacementError(none, at("chair", 6, 5)), "reserved", "lugar do herói");
  assert.equal(lobbyPlacementError(none, at("rug-round", 5, 4)), null, "tapete passa sob o herói");
  assert.equal(lobbyPlacementError(none, at("ceiling-lamp", 6, 5)), null, "luz de teto sobre o herói");
  const placed = [at("sofa-2", 2, 4), at("rug-living", 1, 4)];
  assert.equal(lobbyPlacementError(placed, at("chair", 3, 4)), "overlap", "móvel sobre móvel");
  assert.equal(lobbyPlacementError(placed, at("rug-round", 3, 5)), "overlap", "tapete sobre tapete");
  assert.equal(lobbyPlacementError(placed, at("chair", 4, 4)), null, "ao lado do sofá, sobre o tapete");
  assert.equal(lobbyPlacementError(placed, at("sofa-2", 2, 4), "sofa-2@2,4"), null, "mover o próprio item para o mesmo lugar");
});

test("quarto: rotação, variante e item desconhecido", () => {
  assert.equal(lobbyPlacementError([], at("nao-existe", 1, 4)), "unknown_item");
  assert.equal(lobbyPlacementError([], at("desk-pc", 1, 4)), "unknown_item", "objeto interativo fica fora");
  const one = CATALOG.items.find((i) => lobbyAllowed(i) && i.rotations === 1)!;
  assert.equal(lobbyPlacementError([], at(one.id, 1, one.layer === "wall" ? 0 : 4, 1)), "bad_rotation");
  const withVariants = lobbyCatalog().find((i) => (i.variants?.length ?? 0) > 1 && i.layer === "furniture" && i.w === 1 && i.h === 1)!;
  assert.equal(lobbyPlacementError([], { item: withVariants.id, x: 1, y: 4, rot: 0, variant: withVariants.variants![1]! }), null);
  assert.equal(lobbyPlacementError([], { item: withVariants.id, x: 1, y: 4, rot: 0, variant: "dourado-inexistente" }), "bad_variant");
});

test("quarto inicial: cabe inteiro, sem conflito, e cada item colocado é um item que o herói tem", () => {
  const placed: LobbyItem[] = [];
  STARTER_LOBBY.items.forEach((it, i) => {
    assert.equal(lobbyPlacementError(placed, it), null, it.item);
    placed.push({ ...it, id: `s${i}` });
  });
  for (const it of placed) assert.ok(placedCount(placed, it.item) <= (STARTER_LOBBY.owned[it.item] ?? 0), it.item);
  assert.ok(placed.length <= LOBBY.maxItems);
});
