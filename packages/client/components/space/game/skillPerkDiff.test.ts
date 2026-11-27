import assert from "node:assert/strict";
import test from "node:test";

import { diffSkillLines, factDelta } from "./skillPerkDiff.ts";

test("perk na skill: frase igual, número fortalecido com a diferença, frase acrescentada", () => {
  const base = [
    "Causa ≈ 650 de dano físico em todos os inimigos.",
    "Cada inimigo atingido cura você em 1% da vida máxima.",
    "Gera ×1,6 de ameaça: o monstro tende a mirar você.",
  ];
  const withPerks = [
    "Causa ≈ 1.040 de dano físico em todos os inimigos.",
    "Cada inimigo atingido cura você em 1% da vida máxima.",
    "Cada inimigo atingido cura você em 0,6% da vida máxima.",
    "Gera ×1,6 de ameaça: o monstro tende a mirar você.",
  ];
  const d = diffSkillLines(base, withPerks);
  assert.deepEqual(
    d.map((x) => x.kind),
    ["changed", "same", "added", "same"],
  );
  // O número que mudou leva a diferença no formato da ficha (milhar com ponto).
  const num = d[0]!.parts.find((p) => p.delta);
  assert.deepEqual(num, { text: "1.040", delta: "+390", up: true });
  // A frase igual à de antes e a de ameaça não ganham marca.
  assert.ok(d[1]!.parts.every((p) => !p.delta));
});

test("perk na skill: decimal com vírgula, porcentagem e segundos; o que o perk tirou aparece", () => {
  const d = diffSkillLines(
    ["Lentidão de 20% por 3 s.", "Some depois de 6 s."],
    ["Lentidão de 26% por 4,5 s."],
  );
  assert.deepEqual(
    d.map((x) => x.kind),
    ["changed", "removed"],
  );
  assert.deepEqual(
    d[0]!.parts.filter((p) => p.delta).map((p) => [p.text, p.delta]),
    [
      ["26%", "+6%"],
      ["4,5 s", "+1,5 s"],
    ],
  );
  // A unidade vai com o número: o texto da frase continua inteiro.
  assert.equal(
    d[0]!.parts.map((p) => p.text).join(""),
    "Lentidão de 26% por 4,5 s.",
  );
  assert.equal(factDelta(9.5, 8, 1, " s"), "−1,5 s");
  assert.equal(factDelta(23, 23, 0), null);
});

test("sem perk: tudo igual, nada marcado", () => {
  const lines = ["Causa ≈ 740 de dano.", "Dispara 2×."];
  assert.ok(diffSkillLines(lines, lines).every((x) => x.kind === "same"));
});
