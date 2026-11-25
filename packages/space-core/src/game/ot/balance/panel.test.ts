import assert from "node:assert/strict";
import test from "node:test";

import { resetAllocation } from "./attributes.ts";
import { CLASS_IDS } from "./content.ts";
import { type BalanceHero } from "./equipment.ts";
import { attributePanel, previewRaise } from "./panel.ts";
import { reference as R } from "./reference.ts";

// O painel de atributos como dado (spec §16, Fase 2).

test("os % do painel são os mesmos da referência contra os monstros do nível", () => {
  for (const cls of CLASS_IDS)
    for (const L of [40, 100, 500]) {
      const p = attributePanel(R.referenceBalanceHero(cls, L));
      const v = R.versus(R.referenceHero(cls, L));
      const boss = p.versus.find((r) => r.archetype === "chefe")!;
      const lacaio = p.versus.find((r) => r.archetype === "lacaio")!;
      assert.equal(boss.crit, v.critVsBoss, `${cls} L${L} crítico`);
      assert.equal(boss.avoid, v.avoidVsBoss, `${cls} L${L} evasão`);
      assert.equal(lacaio.miss, v.missVsLacaio, `${cls} L${L} erro`);
      assert.equal(boss.physicalReduction, v.physicalReduction);
      assert.ok(boss.avoidSurrounded <= boss.avoid, "cercado esquiva menos");
      assert.equal(boss.levelDiff, 0);
      assert.ok(p.points.free >= 0 && p.points.free < 25);
    }
});

test("linhas de atributo: pontos, afixos, custo do próximo e se dá para subir", () => {
  const p = attributePanel(R.referenceBalanceHero("cacador", 100));
  const des = p.rows.find((r) => r.stat === "DES")!;
  assert.ok(des.gear > 0, "o caçador tem afixos de DES");
  assert.equal(des.total, des.points + des.gear);
  assert.ok(des.nextCost >= 2, "a DES do caçador L100 já passou do 50");
  for (const r of p.rows) assert.equal(r.canRaise, r.nextCost <= p.points.free);
});

test("título pelo tier, nome da linha e proficiência guardada acima do teto", () => {
  const h: BalanceHero = {
    cls: "guerreiro",
    level: 10,
    job: 11,
    proficiency: 1000,
    attrs: resetAllocation(),
    equipment: {},
  };
  const p = attributePanel(h);
  assert.equal(p.tier, 1);
  assert.equal(p.title, "Recruta");
  assert.equal(p.className, "Guerreiro");
  assert.equal(p.proficiency.effective, 350);
  assert.equal(p.proficiency.recommended, 100);
  assert.equal(p.proficiency.held, 650);
  assert.equal(p.points.free, 45);
});

test("magia não erra; o painel aceita o nível do monstro", () => {
  const mage = R.referenceBalanceHero("mago", 100);
  for (const r of attributePanel(mage).versus) assert.equal(r.miss, 0);
  const up = attributePanel(mage, { monsterLevel: 110 });
  const boss = up.versus.find((r) => r.archetype === "chefe")!;
  assert.equal(boss.monsterLevel, 110);
  assert.ok(Math.abs(boss.levelDiff - -0.12) < 1e-12);
});

test("prévia dos pontos marcados: antes e depois, e a mesma recusa do servidor", () => {
  const h: BalanceHero = {
    cls: "guerreiro",
    level: 20,
    job: 17,
    proficiency: 200,
    attrs: resetAllocation(),
    equipment: {},
  };
  const before = attributePanel(h);
  const r = previewRaise(h, { VIT: 10 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.ok(r.panel.derived.hp > before.derived.hp);
    assert.equal(r.panel.points.free, before.points.free - 10);
  }
  assert.deepEqual(previewRaise(h, { VIT: 96 }), {
    ok: false,
    error: "sem-pontos",
  });
});
