import assert from "node:assert/strict";
import test from "node:test";

import { skillSlotState } from "./skillSlot.ts";

const base = {
  dead: false,
  nowS: 79,
  castAt: undefined as number | undefined,
  cooldownLeftMs: 0,
  mana: 100,
  cost: 19,
};

test("no segundo em que sai, a habilidade conta como saída, mesmo com a mana do fim abaixo do custo", () => {
  // Corrida do Pandemonio (26/11/2026): tinha 24, soltou Chuva de Flechas (19), o quadro trouxe 5.
  assert.equal(
    skillSlotState({ ...base, castAt: 79, cooldownLeftMs: 7000, mana: 5 }),
    "saiu",
  );
});

test("fora do segundo da saída: recarga, sem mana ou pronta, nessa ordem; caído vem antes de tudo", () => {
  assert.equal(skillSlotState({ ...base, castAt: 78, cooldownLeftMs: 6000, mana: 5 }), "recarga");
  assert.equal(skillSlotState({ ...base, mana: 5 }), "semMana");
  assert.equal(skillSlotState({ ...base, mana: 19 }), "pronta");
  assert.equal(skillSlotState({ ...base, dead: true, castAt: 79 }), "caiu");
});
