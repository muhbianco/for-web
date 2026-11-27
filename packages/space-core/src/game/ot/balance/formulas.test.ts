import assert from "node:assert/strict";
import test from "node:test";

import { BALANCE } from "./config.ts";
import { CLASS_IDS, CLASSES } from "./content.ts";
import { balance as B, createBalance, hyper } from "./formulas.ts";
import { heroLoadout } from "./equipment.ts";
import { reference as R } from "./reference.ts";

// Fórmulas e tetos do rebalanceamento (spec §3, §4 e §4.4). As tabelas da §17 estão em reference.test.ts.

function near(actual: number, expected: number, tol: number, what: string) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${what}: ${actual} (esperado ${expected} ± ${tol})`,
  );
}

test("hyper nunca chega no teto e é zero sem investimento", () => {
  assert.equal(hyper(0, 10, 0.5), 0);
  assert.equal(hyper(-5, 10, 0.5), 0);
  assert.ok(hyper(1e9, 1, 0.5) < 0.5);
  near(hyper(10, 10, 0.5), 0.25, 1e-12, "x = y dá metade do teto");
});

test("§3: escada de custo do atributo e o máximo de 256 num só atributo no nível 500", () => {
  assert.equal(B.statRaiseCost(2), 1);
  assert.equal(B.statRaiseCost(50), 1);
  assert.equal(B.statRaiseCost(51), 2);
  assert.equal(B.statRaiseCost(60), 2);
  assert.equal(B.statRaiseCost(61), 3);
  assert.equal(B.statRaiseCost(251), 22);
  assert.equal(B.statRaiseCost(260), 22);
  assert.equal(B.statCostTo(50), 49);
  assert.equal(B.statCostTo(60), 69);
  assert.equal(B.attributePoints(1), 0);
  assert.equal(B.attributePoints(500), 2495);
  assert.equal(B.maxSingleStat(B.attributePoints(500)), 256);
});

test("§3: o alocador gasta todos os pontos que cabem na build de referência", () => {
  for (const cls of CLASS_IDS) {
    const pts = B.attributePoints(500);
    const a = B.allocateByWeights(pts, CLASSES[cls].referenceBuild);
    let spent = 0;
    for (const v of Object.values(a)) spent += B.statCostTo(v);
    assert.ok(pts - spent < 25, `${cls}: sobraram ${pts - spent} pontos`);
  }
});

test("§2: proficiência efetiva, multiplicador e Dojô com bônus social", () => {
  assert.equal(B.effectiveProficiency(5000, 10), 350);
  assert.equal(B.effectiveProficiency(0, 10), 1);
  assert.equal(B.effectiveProficiency(9999, 500), 5000);
  assert.equal(B.recommendedProficiency(40), 400);
  near(
    B.proficiencyMult(0.8, 5000),
    1.8,
    1e-12,
    "peso cheio na Proficiência 5000",
  );
  assert.equal(B.proficiencyXpPerSecond(0), 10);
  near(B.proficiencyXpPerSecond(2), 11, 1e-12, "+5% por herói");
  near(B.proficiencyXpPerSecond(10), 12.5, 1e-12, "teto de +25%");
  assert.equal(B.proficiencyXpToNext(5000), 0);
});

test("§4.4: crítico no teto de 70% com a build extrema (tudo em SOR, katar, Lendário +10, nível 500)", () => {
  const L = 500;
  const v = B.attributeAffix(L);
  const attrs = B.allocateByWeights(B.attributePoints(L), [["SOR", 1]]);
  attrs.SOR += 25 * v; // 5 afixos do perfil + 20 de equipamento
  attrs.FOR += 3 * v;
  const h = R.referenceHero("assassino", L, {
    proficiency: 5000,
    refine: 10,
    rarity: "lendario",
    attrs,
    gearAttrs: false,
  });
  const c = B.critChance(
    h.critRating,
    B.monsterStats("lacaio", L).critRes,
    0.25,
  );
  near(c, BALANCE.crit.hardCap, 1e-12, "crítico");
  assert.ok(B.critChance(1e12, 1, 1) <= BALANCE.crit.hardCap);
});

test("§4.4: evasão total abaixo de 60% (tudo em AGI + Esquiva Sombria) e esquiva sob cerco", () => {
  const L = 500;
  const attrs = B.allocateByWeights(B.attributePoints(L), [["AGI", 1]]);
  const h = R.referenceHero("assassino", L, {
    proficiency: 5000,
    refine: 10,
    rarity: "lendario",
    attrs,
  });
  const flee = h.flee + 20 * B.attributeAffix(L);
  const avoid = B.avoidChance(
    flee,
    h.luck,
    B.monsterStats("lacaio", L).hit,
    L,
    { fleeMult: 1.5, flat: 0.1 },
  );
  near(avoid, 0.597, 0.001, "evasão extrema");
  assert.ok(avoid <= BALANCE.avoid.hardCap);
  assert.ok(
    B.avoidChance(1e12, 1e12, 1, L, { flat: 1 }) <= BALANCE.avoid.hardCap,
  );
  const alone = B.avoidChance(300, 0, 200, L);
  const crowded = B.avoidChance(300, 0, 200, L, { attackers: 4 });
  const floor = B.avoidChance(150, 0, 200, L);
  assert.ok(crowded < alone, "cercado por 4 esquiva menos");
  near(
    B.avoidChance(300, 0, 200, L, { attackers: 99 }),
    floor,
    1e-12,
    "a Fuga cai no máximo à metade",
  );
});

test("§4.4: redução física do guerreiro Lendário +10 abaixo de 75%, e os tetos de redução", () => {
  const g = R.referenceHero("guerreiro", 500, {
    proficiency: 5000,
    refine: 10,
    rarity: "lendario",
  });
  const red = B.heroPhysicalReduction(g.def, 500);
  near(red, 0.745, 0.001, "redução física");
  assert.ok(
    B.heroPhysicalReduction(1e12, 1) <= BALANCE.defense.heroPhysicalCap,
  );
  assert.ok(B.magicReduction(1e12, 1) <= BALANCE.defense.magicCap);
  assert.ok(
    B.monsterReduction("chefe", 500, 1, false) <=
      BALANCE.defense.monsterPhysicalCap,
  );
  assert.equal(B.capTakenMultiplier(0.05), 1 - BALANCE.defense.finalCap);
  assert.equal(B.capTakenMultiplier(0.5), 0.5);
});

test("§4.4: velocidade (+82% com tudo em AGI) e recarga (−20,5% com tudo em DES) dentro dos tetos", () => {
  const agi = R.referenceHero("assassino", 500, {
    attrs: B.allocateByWeights(2495, [["AGI", 1]]),
  });
  near(agi.haste, 0.82, 0.005, "velocidade");
  assert.ok(agi.haste <= BALANCE.haste.hardCap);
  const des = R.referenceHero("cacador", 500, {
    attrs: B.allocateByWeights(2495, [["DES", 1]]),
  });
  near(des.cooldownCut, 0.205, 0.001, "recarga");
  assert.ok(des.cooldownCut <= BALANCE.cooldown.hardCap);
});

test("§7: recarga final nunca abaixo de 50% da base; custo de mana pela mana-base", () => {
  assert.equal(B.skillCooldown(10_000, 0.4, 0.5), 5000);
  near(B.skillCooldown(10_000, 0.2, 0.1), 7200, 1e-9, "recarga com cortes");
  near(B.skillManaCost(0.04, 1000, 5), 32, 1e-9, "Eficiência 5/5");
  near(B.potencyMult(20), 1.95, 1e-12, "Potência 20");
});

test("§5: diferença de nível ±1,2% por nível, até ±36%", () => {
  near(B.levelDiffMod(10), 0.12, 1e-12, "+10 níveis");
  near(B.levelDiffMod(-5), -0.06, 1e-12, "−5 níveis");
  assert.equal(B.levelDiffMod(100), 0.36);
  assert.equal(B.levelDiffMod(-100), -0.36);
});

test("§4.3: magia nunca erra; o erro físico fica abaixo de 40%", () => {
  assert.equal(B.heroMissChance(1, 1e9, true), 0);
  assert.ok(B.heroMissChance(1, 1e9, false) < BALANCE.heroMiss.curveCap);
});

test("§13: XP por diferença de nível, escala do grupo e XP por criatura", () => {
  assert.equal(B.xpLevelDiffMult(5), 1);
  assert.equal(B.xpLevelDiffMult(0), 1);
  near(B.xpLevelDiffMult(6), 0.94, 1e-12, "Δ 6");
  assert.equal(B.xpLevelDiffMult(40), 0.1);
  near(B.xpLevelDiffMult(-5), 1.1, 1e-12, "Δ −5");
  near(B.xpLevelDiffMult(-30), 1.2, 1e-12, "teto de +20%");
  assert.equal(B.partyScale(1, "cacada"), 1);
  assert.equal(B.partyScale(2, "cacada"), 1.75);
  assert.equal(B.partyScale(2, "masmorra"), 2.5);
  assert.equal(B.partyScale(4, "masmorra"), 3.25);
  const solo = B.creatureXpEach(40, "lacaio", 1, "cacada");
  near(solo, B.lacaioXp(40), 1e-9, "lacaio sozinho na Caçada");
  const four = B.creatureXpEach(40, "chefe", 4, "masmorra");
  near(
    four,
    (B.lacaioXp(40) * 25 * 3.25 * 1.5 * 1.3) / 4,
    1e-9,
    "chefe de masmorra em 4",
  );
});

test("§9.6: refino do spec (decisão do dono de 25/11/2026)", () => {
  near(B.refineMult(10, true), 1.65, 1e-12, "arma +10");
  near(B.refineMult(10, false), 1.5, 1e-12, "armadura +10");
  near(B.refineMult(4, true), 1.2, 1e-12, "arma +4");
  assert.equal(B.refineChance(3), 1);
  assert.equal(B.refineChance(4), 0.9);
  assert.equal(B.refineChance(9), 0.2);
  assert.equal(B.refineChance(10), 0);
  assert.equal(B.refineFailure(6), "custo");
  assert.equal(B.refineFailure(7), "cai");
  assert.deepEqual(B.refineCost(100, 5), { gold: 7500, ore: 5 });
});

test("§9 e §10: base de equipamento, requisito e preço de poção", () => {
  assert.equal(B.weaponBaseValue(100), 252);
  near(
    B.armorDefPiece(100, "armadura", "pesada"),
    104 * 1.5 * 1.2,
    1e-9,
    "armadura pesada",
  );
  assert.equal(B.shieldDefValue(100), 166);
  assert.ok(B.canEquip(95, 100));
  assert.ok(!B.canEquip(94, 100));
  assert.deepEqual(B.potionPrices(1), { hp: 1, mp: 2 });
  // D25: a 1ª é grátis; as próximas, 5.000 fixos.
  assert.equal(B.respecCost(0), 0);
  assert.equal(B.respecCost(1), 5000);
  assert.equal(B.respecCost(7), 5000);
});

test("createBalance com um config afinado não mexe no do jogo", () => {
  const cfg = structuredClone(BALANCE);
  cfg.crit.hardCap = 0.5;
  const tuned = createBalance(cfg);
  assert.equal(tuned.critChance(1e9, 1, 0.5), 0.5);
  assert.equal(B.critChance(1e9, 1, 0.5), BALANCE.crit.hardCap);
  assert.equal(BALANCE.crit.hardCap, 0.7);
});

test("D62: a VIT cura mais na poção de vida, regenera vida e segura o monstro; não mexe na mana (27/11/2026)", () => {
  const stats = (cls: (typeof CLASS_IDS)[number], vit: number) => {
    const h = R.referenceBalanceHero(cls, 160);
    return B.heroStats(heroLoadout({ ...h, attrs: { ...h.attrs, VIT: vit } }));
  };
  // Poção de vida: +0,2% de cura por ponto; regeneração de vida por segundo por ponto.
  const s100 = stats("assassino", 100);
  assert.ok(Math.abs(s100.potionMult - 1.2) < 1e-9);
  assert.ok(Math.abs(s100.hpRegenPct - 0.001) < 1e-12);
  // A mana é da INT: VIT a mais não muda nada nela (o dono: "VIT não pode mexer na mana").
  const s1 = stats("assassino", 1);
  assert.equal(s100.mp, s1.mp);
  assert.ok(!("manaPotionMult" in s100) && !("mpRegenPct" in s100));
  // Ameaça: na VIT da build de referência (sem afixo), o multiplicador da classe; sem VIT, 40%; teto 1,6.
  for (const cls of ["guerreiro", "paladino", "assassino"] as const) {
    const refVit = B.allocateByWeights(B.attributePoints(160), CLASSES[cls].referenceBuild).VIT;
    const bare = R.referenceBalanceHero(cls, 160, { gearAttrs: false });
    const at = (vit: number) =>
      B.heroStats(heroLoadout({ ...bare, attrs: { ...bare.attrs, VIT: vit } })).threat;
    assert.ok(Math.abs(at(refVit) - CLASSES[cls].threat) < 1e-9, cls);
    assert.ok(Math.abs(at(1) / CLASSES[cls].threat - (0.4 + 0.6 / refVit)) < 1e-9, cls);
    assert.equal(at(refVit * 10), CLASSES[cls].threat * 1.6, cls);
  }
});
