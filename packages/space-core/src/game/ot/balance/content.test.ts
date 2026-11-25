import assert from "node:assert/strict";
import test from "node:test";

import {
  CLASS_IDS,
  CLASSES,
  ClassSchema,
  FAMILIES,
  FAMILY_IDS,
  FamilySchema,
  RARITIES,
  RARITY_IDS,
  RaritySchema,
} from "./content.ts";

// O conteúdo é dado validado por schema (spec §0.3).

test("as 7 classes passam no schema e são coerentes", () => {
  for (const id of CLASS_IDS) {
    const c = ClassSchema.parse(CLASSES[id]);
    assert.equal(c.id, id);
    assert.ok(
      c.weapons.includes(c.referenceWeapon),
      `${id}: arma de referência fora das armas da classe`,
    );
    if (c.referenceOffhand)
      assert.ok(
        c.offhands.includes(c.referenceOffhand),
        `${id}: mão secundária`,
      );
    let share = 0;
    for (const [, w] of c.referenceBuild) share += w;
    assert.equal(share, 100, `${id}: a build de referência soma ${share}`);
    const stats = c.referenceBuild.map(([s]) => s);
    assert.equal(
      new Set(stats).size,
      stats.length,
      `${id}: atributo repetido na build`,
    );
  }
});

test("as 12 famílias de arma e as 5 raridades passam no schema", () => {
  for (const id of FAMILY_IDS)
    assert.equal(FamilySchema.parse(FAMILIES[id]).id, id);
  for (const id of RARITY_IDS)
    assert.equal(RaritySchema.parse(RARITIES[id]).id, id);
  for (const id of FAMILY_IDS) {
    const f = FAMILIES[id];
    if (f.kind === "magic")
      assert.ok(f.matk > 0, `${id}: arma mágica sem MATQ`);
    if (f.ammo)
      assert.equal(
        f.kind,
        "ranged",
        `${id}: munição em arma que não é de distância`,
      );
  }
});
