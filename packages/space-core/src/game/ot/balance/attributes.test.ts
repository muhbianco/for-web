import assert from "node:assert/strict";
import test from "node:test";

import {
  pointsFree,
  resetAttributes,
  pointsSpent,
  raiseStats,
  resetAllocation,
  validAllocation,
} from "./attributes.ts";
import { CLASS_IDS, CLASSES } from "./content.ts";
import { balance as B } from "./formulas.ts";

// Regras de distribuição de atributos (spec §3).

test("pontos: começa tudo em 1, 5 por nível acima do 1", () => {
  const fresh = resetAllocation();
  assert.equal(pointsSpent(fresh), 0);
  assert.equal(pointsFree(1, fresh), 0);
  assert.equal(pointsFree(10, fresh), 45);
  assert.ok(validAllocation(1, fresh));
});

test("subir atributos respeita os pontos livres e a escada de custo", () => {
  const fresh = resetAllocation();
  const ok = raiseStats(10, fresh, { FOR: 45 });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.stats.FOR, 46);
    assert.equal(ok.spent, 45);
  }
  assert.deepEqual(raiseStats(10, fresh, { FOR: 46 }), {
    ok: false,
    error: "sem-pontos",
  });
  // L20: 95 pontos. Com a FOR em 50 (49 gastos), o 51 custa 2.
  const at50 = { ...fresh, FOR: 50 };
  const r = raiseStats(20, at50, { FOR: 1 });
  assert.ok(r.ok && r.spent === 2);
  const ten = raiseStats(20, at50, { FOR: 10 });
  assert.ok(ten.ok && ten.spent === 20 && ten.stats.FOR === 60);
});

test("pedidos inválidos são recusados sem mexer em nada", () => {
  const fresh = resetAllocation();
  assert.deepEqual(raiseStats(10, fresh, {}), {
    ok: false,
    error: "pedido-vazio",
  });
  assert.deepEqual(raiseStats(10, fresh, { FOR: -1 }), {
    ok: false,
    error: "valor-invalido",
  });
  assert.deepEqual(raiseStats(10, fresh, { FOR: 1.5 }), {
    ok: false,
    error: "valor-invalido",
  });
  assert.deepEqual(
    raiseStats(10, fresh, { XYZ: 1 } as unknown as { FOR: number }),
    { ok: false, error: "atributo-invalido" },
  );
  assert.deepEqual(raiseStats(10, { ...fresh, VIT: 0 }, { FOR: 1 }), {
    ok: false,
    error: "valor-invalido",
  });
  assert.equal(fresh.FOR, 1);
});

test("distribuição acima dos pontos do nível é inválida", () => {
  assert.ok(!validAllocation(5, { ...resetAllocation(), INT: 30 }));
  assert.ok(validAllocation(10, { ...resetAllocation(), INT: 30 }));
});

test("a build de referência de toda classe é válida em todo nível", () => {
  for (const cls of CLASS_IDS)
    for (const L of [1, 2, 20, 70, 150, 333, 500]) {
      const a = B.allocateByWeights(
        B.attributePoints(L),
        CLASSES[cls].referenceBuild,
      );
      assert.ok(validAllocation(L, a), `${cls} L${L}`);
      assert.ok(pointsFree(L, a) >= 0);
    }
});

test("redistribuir os atributos no Mestre: tudo volta ao 1; a 1ª é grátis, depois 5.000 (D25)", () => {
  const hero = { attrs: { ...resetAllocation(), FOR: 40, VIT: 30 } };
  const first = resetAttributes(hero);
  assert.equal(first.cost, 0);
  assert.deepEqual(first.hero.attrs, resetAllocation());
  assert.equal(first.hero.attrResets, 1);
  const second = resetAttributes(first.hero);
  assert.equal(second.cost, 5000);
  assert.equal(second.hero.attrResets, 2);
  assert.equal(pointsFree(30, second.hero.attrs), B.attributePoints(30));
});
