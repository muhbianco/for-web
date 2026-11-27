import assert from "node:assert/strict";
import test from "node:test";

import {
  CLASS_IDS,
  CLASSES,
  ClassSchema,
  FAMILIES,
  FAMILY_IDS,
  OFFHAND_IDS,
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

// Pacotes A, B e C (27/11/2026, o dono: "quero ser mais permissivo pros players inventarem build"):
// as listas das classes seguem regras, para nenhuma mão secundária ficar de fora de uma arma que a
// classe usa (a aljava do Caçador sem o arco do Assassino foi o achado que abriu isso).
test("armas e mãos secundárias de cada classe são coerentes entre si", () => {
  for (const id of CLASS_IDS) {
    const c = CLASSES[id];
    const fams = c.weapons.map((w) => FAMILIES[w]);
    if (fams.some((f) => f.kind === "ranged"))
      assert.ok(c.offhands.includes("aljava"), `${id}: arco/besta sem aljava`);
    if (fams.some((f) => f.kind === "magic" && f.hands === 1))
      assert.ok(c.offhands.includes("focus"), `${id}: cetro sem focus`);
    if (fams.some((f) => f.hands === 1))
      assert.ok(c.offhands.includes("escudo"), `${id}: arma de 1 mão sem escudo`);
    for (const off of c.offhands) {
      const fits = fams.some((f) =>
        off === "escudo"
          ? f.hands === 1
          : off === "focus"
            ? f.kind === "magic" && f.hands === 1
            : off === "aljava"
              ? f.kind === "ranged"
              : f.kind === "melee" && f.hands === 1,
      );
      assert.ok(fits, `${id}: ${off} sem nenhuma arma que combine`);
    }
  }
  // O punhal é a segunda lâmina do Assassino (Lâminas Gêmeas); ninguém mais.
  assert.deepEqual(
    CLASS_IDS.filter((c) => CLASSES[c].offhands.includes("punhal")),
    ["assassino"],
  );
  assert.equal(OFFHAND_IDS.length, 4);
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
