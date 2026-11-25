import assert from "node:assert/strict";
import test from "node:test";

import { resetAllocation } from "./attributes.ts";
import { ARMOR_SLOTS, CLASS_IDS, CLASSES } from "./content.ts";
import {
  type BalanceHero,
  type ItemInstance,
  affixTotals,
  cannotEquip,
  canWearWeight,
  heroDerived,
  heroLoadout,
} from "./equipment.ts";
import { balance as B } from "./formulas.ts";
import { reference as R } from "./reference.ts";

// Item instanciado e derivados do herói (spec §9 e §4.2).

function hero(over: Partial<BalanceHero> = {}): BalanceHero {
  return {
    cls: "guerreiro",
    level: 50,
    job: 30,
    proficiency: 500,
    attrs: resetAllocation(),
    equipment: {},
    ...over,
  };
}

const raro = { ilvl: 50, rarity: "raro" as const, refine: 0, affixes: [] };

test("o perfil montado com itens dá o mesmo que o loadout montado à mão pelas fórmulas", () => {
  const L = 100;
  const rm = B.rarityMult("raro");
  const armorRm = rm * B.refineMult(4, false);
  for (const cls of CLASS_IDS) {
    const c = CLASSES[cls];
    const h = R.referenceBalanceHero(cls, L);
    const [main, second] = R.affixTargets(cls);
    const v = B.attributeAffix(L);
    const attrs = { ...h.attrs };
    attrs[main] += 5 * v;
    attrs[second] += 3 * v;
    let def = 0;
    let mdef = 0;
    for (const slot of ARMOR_SLOTS) {
      def += B.armorDefPiece(L, slot, c.armor);
      mdef += B.armorMdefPiece(L, slot, c.armor);
    }
    const direct = B.heroStats({
      cls: c,
      level: L,
      attrs,
      proficiency: 10 * L,
      family: c.referenceWeapon,
      weaponBase: B.weaponBaseValue(L) * rm * B.refineMult(4, true),
      offhand: c.referenceOffhand,
      shieldDef:
        c.referenceOffhand === "escudo" ? B.shieldDefValue(L) * armorRm : 0,
      armorDef: def * armorRm,
      armorMdef: mdef * armorRm,
    });
    const viaItems = heroDerived(h);
    for (const k of [
      "hp",
      "mp",
      "atk",
      "matk",
      "def",
      "mdef",
      "hit",
      "flee",
      "critRating",
    ] as const)
      assert.ok(
        Math.abs(viaItems[k] / direct[k] - 1) < 1e-12,
        `${cls} ${k}: ${viaItems[k]} contra ${direct[k]}`,
      );
    const sum = Object.values(affixTotals(h.equipment).attrs).reduce(
      (a, b) => a + b,
      0,
    );
    assert.ok(Math.abs(sum - 8 * v) < 1e-9, `${cls}: afixos somam ${sum}`);
  }
});

test("afixos em % multiplicam o derivado no fim; atributos somam aos pontos", () => {
  const base = hero({
    equipment: { armadura: { ...raro, slot: "armadura", weight: "pesada" } },
  });
  const plus = hero({
    equipment: {
      armadura: {
        ...raro,
        slot: "armadura",
        weight: "pesada",
        affixes: [
          { id: "hpPct", value: 0.1 },
          { id: "VIT", value: 10 },
        ],
      },
    },
  });
  const a = heroDerived(base);
  const b = heroDerived(plus);
  const vitOnly = heroDerived(
    hero({ attrs: { ...resetAllocation(), VIT: 11 } }),
  );
  assert.ok(Math.abs(b.hp / (vitOnly.hp * 1.1) - 1) < 1e-12);
  assert.ok(b.def > a.def, "VIT também dá DEF");
});

test("sem arma: base 0, o ATQ vem só do status; com arma, a família muda tudo", () => {
  const bare = heroDerived(hero());
  assert.equal(heroLoadout(hero()).weaponBase, 0);
  assert.ok(bare.atk > 0);
  const armed = heroDerived(
    hero({ equipment: { arma: { ...raro, slot: "arma", family: "machado" } } }),
  );
  assert.ok(armed.atk > bare.atk);
  assert.equal(armed.attacksPerSecond > 0, true);
});

test("refino e raridade entram na base da arma e das peças", () => {
  const w = (refine: number, rarity: "comum" | "lendario") =>
    heroLoadout(
      hero({
        equipment: {
          arma: { ...raro, rarity, refine, slot: "arma", family: "espada" },
        },
      }),
    ).weaponBase;
  assert.ok(Math.abs(w(0, "comum") - B.weaponBaseValue(50)) < 1e-9);
  assert.ok(Math.abs(w(10, "lendario") / w(0, "comum") - 1.2 * 1.65) < 1e-12);
});

test("peso de armadura: o da classe ou mais leve", () => {
  assert.ok(canWearWeight("guerreiro", "leve"));
  assert.ok(canWearWeight("guerreiro", "pesada"));
  assert.ok(canWearWeight("cacador", "media"));
  assert.ok(!canWearWeight("mago", "media"));
  assert.ok(!canWearWeight("cacador", "pesada"));
});

test("quem pode equipar o quê (classe, nível, mãos e mão secundária)", () => {
  const g = hero();
  const cajado: ItemInstance = { ...raro, slot: "arma", family: "cajado" };
  assert.equal(cannotEquip(g, cajado), "classe-nao-usa");
  assert.equal(
    cannotEquip(g, { ...raro, ilvl: 56, slot: "arma", family: "espada" }),
    "nivel-baixo",
  );
  assert.equal(
    cannotEquip(g, { ...raro, ilvl: 55, slot: "arma", family: "espada" }),
    null,
  );
  const withShield = hero({
    equipment: {
      secundaria: { ...raro, slot: "secundaria", offhand: "escudo" },
    },
  });
  assert.equal(
    cannotEquip(withShield, { ...raro, slot: "arma", family: "machado" }),
    "duas-maos-com-escudo",
  );
  const mage = hero({ cls: "mago" });
  const withStaff = hero({
    cls: "mago",
    equipment: { arma: { ...raro, slot: "arma", family: "cajado" } },
  });
  const focus: ItemInstance = { ...raro, slot: "secundaria", offhand: "focus" };
  assert.equal(
    cannotEquip(withStaff, focus),
    "focus-sem-arma-magica-de-uma-mao",
  );
  const withScepter = hero({
    cls: "mago",
    equipment: { arma: { ...raro, slot: "arma", family: "cetro" } },
  });
  assert.equal(cannotEquip(withScepter, focus), null);
  assert.equal(
    cannotEquip(mage, { ...raro, slot: "armadura", weight: "pesada" }),
    "peso-acima-da-classe",
  );
  const hunter = hero({ cls: "cacador" });
  assert.equal(
    cannotEquip(hunter, { ...raro, slot: "secundaria", offhand: "aljava" }),
    "aljava-sem-arma-de-distancia",
  );
  assert.equal(cannotEquip(hunter, { ...raro, slot: "colar" }), null);
});
