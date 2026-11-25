import assert from "node:assert/strict";
import test from "node:test";

import { CLASS_IDS } from "../content.ts";
import { compileSkill } from "./compile.ts";
import {
  REFERENCE_KITS,
  REFERENCE_SOLO_KITS,
  SKILLS,
  SKILLS_BY_CLASS,
  SkillSchema,
} from "./index.ts";
import { freshBuild, totalAbsorbable } from "./tree.ts";

// As 42 skills como conteúdo (spec §7 e §8): estrutura, adereços e o total absorvível.

test("42 skills, 6 por classe: 2 no T1, 2 no T2, 1 no T3, 1 no T4, todas no schema", () => {
  assert.equal(SKILLS.length, 42);
  for (const cls of CLASS_IDS) {
    const list = SKILLS_BY_CLASS[cls];
    assert.deepEqual(list.map((s) => s.tier).sort(), [1, 1, 2, 2, 3, 4], cls);
    assert.equal(new Set(list.map((s) => s.id)).size, 6, `${cls}: id repetido`);
    for (const s of list) {
      SkillSchema.parse(s);
      assert.equal(s.cls, cls);
    }
  }
});

test("adereços: T1 com 3 (T2, T3, T4), T2 com 2 (T3, T4), T3 e T4 com 1 (T4)", () => {
  const expected: Record<number, number[]> = {
    1: [2, 3, 4],
    2: [3, 4],
    3: [4],
    4: [4],
  };
  for (const s of SKILLS)
    assert.deepEqual(
      s.mechanics.map((m) => m.unlockTier),
      expected[s.tier],
      `${s.cls}/${s.id}`,
    );
});

test("§7: 204 pontos absorvíveis por classe (114 Potência + 30 Eficiência + 60 Mecânicas)", () => {
  for (const cls of CLASS_IDS) assert.equal(totalAbsorbable(cls), 204, cls);
});

test("cada adereço muda a skill compilada (no 1 e no 5/5) e os índices de efeito existem", () => {
  for (const s of SKILLS) {
    const base = JSON.stringify(compileSkill(s, freshBuild()));
    for (const m of s.mechanics) {
      for (const mod of [...m.mods, ...(m.atMax ?? [])]) {
        const idx =
          mod.kind === "duracao" || mod.kind === "potencia"
            ? mod.effects
            : mod.kind === "valor"
              ? [mod.effect]
              : [];
        for (const i of idx)
          assert.ok(
            i < s.effects.length,
            `${s.id}/${m.id}: efeito ${i} não existe`,
          );
      }
      const one = JSON.stringify(
        compileSkill(s, { ...freshBuild(), mechanics: { [m.id]: 1 } }),
      );
      const five = JSON.stringify(
        compileSkill(s, { ...freshBuild(), mechanics: { [m.id]: 5 } }),
      );
      assert.notEqual(one, base, `${s.id}/${m.id}: 1 up não muda nada`);
      assert.notEqual(five, one, `${s.id}/${m.id}: 5 ups igual a 1`);
    }
  }
});

test("os kits de referência do §8 existem e cabem nos 4 slots", () => {
  for (const kits of [REFERENCE_KITS, REFERENCE_SOLO_KITS])
    for (const cls of CLASS_IDS) {
      assert.equal(kits[cls].length, 4, cls);
      for (const id of kits[cls])
        assert.ok(
          SKILLS_BY_CLASS[cls].some((s) => s.id === id),
          `${cls}: ${id}`,
        );
    }
});
