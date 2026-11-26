import assert from "node:assert/strict";
import test from "node:test";

import { statusTone } from "./status.ts";

test("o ícone do DoT segue o tipo que o motor manda, o mesmo do número (26/11/2026)", () => {
  // A Queimadura vem da mecânica da Explosão de Fogo: sem o tipo, saía como veneno.
  assert.equal(
    statusTone(
      { s: "explosao-de-fogo", k: "dot", t: 4, a: 0, dk: "queimadura" },
      "mago",
    ),
    "burn",
  );
  // Nevasca e Espinhos são DoT mágico sem tipo: saíam como queimadura; agora magenta, como o número.
  assert.equal(
    statusTone({ s: "nevasca", k: "dot", t: 6, a: 0, dk: "dot" }, "mago"),
    "magic",
  );
  assert.equal(
    statusTone({ s: "espinhos", k: "dot", t: 8, a: 0, dk: "dot" }, "druida"),
    "magic",
  );
  assert.equal(
    statusTone(
      { s: "lamina-envenenada", k: "dot", t: 6, a: 0, dk: "veneno" },
      "assassino",
    ),
    "poison",
  );
  assert.equal(
    statusTone(
      { s: "fumaca", k: "dot", t: 8, a: 0, dk: "veneno" },
      "assassino",
    ),
    "poison",
  );
});

test("quadro sem o tipo (servidor de antes): o jeito antigo", () => {
  assert.equal(
    statusTone({ s: "lamina-envenenada", k: "dot", t: 6 }, "assassino"),
    "poison",
  );
  assert.equal(
    statusTone({ s: "provocar", k: "provocado", t: 3, a: 0 }, null),
    "taunt",
  );
});
