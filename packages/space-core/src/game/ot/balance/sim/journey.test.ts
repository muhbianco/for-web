import assert from "node:assert/strict";
import test from "node:test";

import { simulateJourney } from "./journey.ts";

// A jornada do jogador (P81): o simulador roda e o herói novo sai do lugar com o kit de referência (D37).

test("jornada: o guerreiro e o padre novos chegam ao L20 sem empacar, com o equipamento refinado", () => {
  for (const cls of ["guerreiro", "padre"] as const) {
    const r = simulateJourney(cls, { to: 20, maxRuns: 400 });
    assert.equal(r.stuckAt, null, cls);
    assert.ok(r.reached >= 20, `${cls}: L${r.reached}`);
    const l20 = r.marks.find((m) => m.level === 20)!;
    assert.ok(l20.refine >= 3, `${cls}: refino ${l20.refine}`);
  }
});
