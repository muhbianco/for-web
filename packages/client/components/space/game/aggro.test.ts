import assert from "node:assert/strict";
import test from "node:test";

import {
  AGGRO_SWITCH_PCT,
  aggroFill,
  aggroLevel,
  aggroViews,
} from "./aggro.ts";

test("o nível da ameaça de quem não é o alvo: seguro, alerta a partir de 80%, perigo a partir de 100%", () => {
  assert.equal(aggroLevel(0), "seguro");
  assert.equal(aggroLevel(79), "seguro");
  assert.equal(aggroLevel(80), "alerta");
  assert.equal(aggroLevel(99), "alerta");
  assert.equal(aggroLevel(100), "perigo");
  assert.equal(AGGRO_SWITCH_PCT, 110);
  assert.equal(aggroFill(55), 0.5);
  assert.equal(aggroFill(200), 1);
});

test("por monstro vivo: o alvo, quem está mais perto de puxar e todos em ordem", () => {
  const v = aggroViews(
    [
      { a: 0, p: [100, 92, 40] },
      null,
      { a: 2, p: [0, 0, 100] },
      { a: 1, p: [30, 100, 0] },
    ],
    [500, 0, 200, 0],
  );
  // O 2º caiu (null) e o 4º está com vida 0: ficam de fora.
  assert.deepEqual(
    v.map((x) => x.i),
    [0, 2],
  );
  assert.equal(v[0]!.target, 0);
  assert.deepEqual(v[0]!.rival, { i: 1, pct: 92 });
  assert.equal(v[0]!.level, "alerta");
  assert.deepEqual(
    v[0]!.all.map((r) => r.i),
    [0, 1, 2],
  );
  // Só o alvo tem ameaça: ninguém perto de puxar.
  assert.equal(v[1]!.rival, null);
  assert.equal(v[1]!.level, "seguro");
  assert.deepEqual(v[1]!.all, [{ i: 2, pct: 100 }]);
});

test("quadro sem ameaça (servidor de antes): nada", () => {
  assert.deepEqual(aggroViews(undefined, [100]), []);
});
