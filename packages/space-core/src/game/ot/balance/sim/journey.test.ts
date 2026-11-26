import assert from "node:assert/strict";
import test from "node:test";

import { simulateJourney } from "./journey.ts";

// A jornada do jogador (P81): o simulador roda e o herói novo sai do lugar com o kit de referência (D37).

test("P86: o mago solo (com Dojô) passa das Caçadas 30 e 40 sem empacar", () => {
  // Com as faixas de poção antigas (20–34) o mago morria na Caçada 30 e a jornada parava no L30.
  // Com as de 10 em 10, regerar o aperto das Caçadas do 40 ao 90 (gen-edge --write) endurece os
  // monstros pelo herói no limite e o mago volta a parar, no L41: as Caçadas do aperto ficaram como
  // estavam (26/11/2026). Se este teste cair depois de um gen-edge, é isso.
  const r = simulateJourney("mago", { proficiency: "dojo", to: 50, maxRuns: 900 });
  assert.equal(r.stuckAt, null, `o mago empacou no L${r.stuckAt}`);
  assert.ok(r.reached >= 50, `mago: L${r.reached}`);
});

test("jornada: o guerreiro e o padre novos chegam ao L20 sem empacar, com o equipamento refinado", () => {
  for (const cls of ["guerreiro", "padre"] as const) {
    const r = simulateJourney(cls, { to: 20, maxRuns: 400 });
    assert.equal(r.stuckAt, null, cls);
    assert.ok(r.reached >= 20, `${cls}: L${r.reached}`);
    const l20 = r.marks.find((m) => m.level === 20)!;
    assert.ok(l20.refine >= 3, `${cls}: refino ${l20.refine}`);
  }
});
