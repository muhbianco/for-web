import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { fight, randomSource } from "../combat/fight.ts";
import { AFFIXES } from "../content.ts";
import type { BalanceHero, ItemInstance } from "../equipment.ts";
import { heroFighter } from "../fighter.ts";
import { balance as B } from "../formulas.ts";
import { reference as R } from "../reference.ts";
import { referenceSkills } from "../sim/encounters.ts";
import { compileLoadout } from "../skills/compile.ts";
import { autoEquip } from "./autoequip.ts";
import {
  affixCount,
  affixRange,
  allowedAffixes,
  generateItem,
  itemName,
  materialOf,
  rollAffixes,
  rollAffixValue,
  upgradeAffixesToD64,
} from "./generate.ts";
import { jobXpBonus, LEGENDARIES, legendaryMods } from "./legendary.ts";
import { perkMods } from "./perks.ts";
import {
  dismantle,
  refinable,
  refineAttempt,
  refineCostOf,
  reforge,
} from "./smith.ts";
import { itemTooltip, itemVisual } from "./view.ts";

// Itens (spec §9): geração, Ferreiro, lendários, auto-equipar e tooltip.

const rng = (seed: number) => randomSource(new Rng(seed));

test("material por faixa de iL, nome e sufixo do afixo principal", () => {
  assert.equal(materialOf(1), "Ferro");
  assert.equal(materialOf(50), "Ferro");
  assert.equal(materialOf(51), "Bronze");
  assert.equal(materialOf(500), "Vazio");
  const it: ItemInstance = {
    slot: "arma",
    family: "machado",
    ilvl: 120,
    rarity: "raro",
    refine: 0,
    affixes: [
      { id: "VIT", value: 2 },
      { id: "FOR", value: 4 },
    ],
  };
  assert.equal(itemName(it), "Machado de Aço do Touro");
  assert.equal(itemName({ ...it, affixes: [] }), "Machado de Aço");
  assert.equal(itemName(it, "Machado do Rugido"), "Machado do Rugido");
});

test("afixos: quantos (raridade + 1 em colar e anel), onde saem e dentro da faixa", () => {
  assert.equal(affixCount("arma", "comum"), 0);
  assert.equal(affixCount("elmo", "raro"), 2);
  assert.equal(affixCount("colar", "raro"), 3);
  assert.equal(affixCount("anel", "lendario"), 4);
  assert.ok(allowedAffixes("secundaria", "escudo").includes("defPct"));
  assert.ok(!allowedAffixes("secundaria", "focus").includes("defPct"));
  assert.ok(allowedAffixes("elmo", undefined).includes("cooldownPct"));
  assert.ok(!allowedAffixes("arma", undefined).includes("hpPct"));
  const r = rng(11);
  for (let i = 0; i < 300; i++) {
    const affixes = rollAffixes("anel", 200, 4, r);
    assert.equal(
      new Set(affixes.map((a) => a.id)).size,
      affixes.length,
      "afixo repetido",
    );
    for (const a of affixes) {
      const def = AFFIXES[a.id];
      if (def.scale === "pct")
        assert.ok(
          a.value >= def.min! - 1e-9 && a.value <= def.max! + 1e-9,
          a.id,
        );
      else {
        const nominal =
          def.scale === "atributo" ? B.attributeAffix(200) : B.ratingAffix(200);
        assert.ok(
          a.value >= nominal * 0.8 - 0.01 && a.value <= nominal * 1.2 + 0.01,
          `${a.id}: ${a.value}`,
        );
      }
    }
  }
});

test("gerar item: mesma semente, mesmo item", () => {
  const a = generateItem(
    { slot: "armadura", weight: "media" },
    77,
    "epico",
    rng(5),
  );
  const b = generateItem(
    { slot: "armadura", weight: "media" },
    77,
    "epico",
    rng(5),
  );
  assert.deepEqual(a, b);
  assert.equal(a.affixes.length, 3);
  assert.equal(a.refine, 0);
});

const sword = (refine: number): ItemInstance => ({
  slot: "arma",
  family: "espada",
  ilvl: 100,
  rarity: "raro",
  refine,
  affixes: [],
});

test("refino: o que refina, custo em ouro + minério da região", () => {
  assert.ok(refinable(sword(0)));
  assert.ok(
    refinable({
      slot: "secundaria",
      offhand: "escudo",
      ilvl: 1,
      rarity: "comum",
      refine: 0,
      affixes: [],
    }),
  );
  assert.ok(
    !refinable({
      slot: "secundaria",
      offhand: "focus",
      ilvl: 1,
      rarity: "comum",
      refine: 0,
      affixes: [],
    }),
  );
  assert.ok(
    !refinable({
      slot: "anel",
      ilvl: 1,
      rarity: "comum",
      refine: 0,
      affixes: [],
    }),
  );
  assert.deepEqual(refineCostOf(sword(4)), {
    gold: 50 * 6 * 25,
    ore: { material: "Bronze", count: 5 },
  });
  assert.equal(refineCostOf(sword(10)), null);
});

test("refino: chances do spec; até o +7 a falha só custa; do +8 ao +10 cai 1 (ou gasta a Pedra)", () => {
  const r = rng(99);
  const rate = (from: number) => {
    let up = 0;
    for (let i = 0; i < 20_000; i++) {
      const out = refineAttempt(sword(from), r);
      if (out.ok && out.outcome.kind === "subiu") up++;
    }
    return up / 20_000;
  };
  assert.equal(rate(3), 1);
  assert.ok(Math.abs(rate(4) - 0.9) < 0.01);
  assert.ok(Math.abs(rate(9) - 0.2) < 0.01);
  let sawFail = false;
  let sawDrop = false;
  let sawProtect = false;
  for (let i = 0; i < 200; i++) {
    const six = refineAttempt(sword(6), r);
    if (six.ok && six.outcome.kind === "falhou") {
      sawFail = true;
      assert.equal(six.outcome.item.refine, 6);
    }
    const seven = refineAttempt(sword(7), r);
    if (seven.ok && seven.outcome.kind === "caiu") {
      sawDrop = true;
      assert.equal(seven.outcome.item.refine, 6);
    }
    const prot = refineAttempt(sword(8), r, { protect: true });
    if (prot.ok && prot.outcome.kind === "protegido") {
      sawProtect = true;
      assert.ok(prot.stoneUsed);
      assert.equal(prot.outcome.item.refine, 8);
    }
  }
  assert.ok(sawFail && sawDrop && sawProtect);
  assert.deepEqual(refineAttempt(sword(10), r), {
    ok: false,
    error: "no-maximo",
  });
});

test("reforja mantém raridade, refino e lendário; desmonte dá minério pela raridade", () => {
  const item: ItemInstance = {
    ...generateItem({ slot: "anel" }, 300, "lendario", rng(3)),
    refine: 0,
    legendary: "x",
  };
  const again = reforge(item, rng(4));
  assert.equal(again.rarity, "lendario");
  assert.equal(again.legendary, "x");
  assert.equal(again.affixes.length, item.affixes.length);
  assert.notDeepEqual(again.affixes, item.affixes);
  assert.deepEqual(dismantle(item), {
    ore: { material: "Obsidiana", count: 16 },
    essence: 2,
  });
  assert.deepEqual(dismantle(sword(0)), {
    ore: { material: "Bronze", count: 4 },
    essence: 0,
  });
});

test("lendários: o efeito único muda a skill na compilação", () => {
  const legendary = (id: string): ItemInstance => {
    const def = LEGENDARIES.find((l) => l.id === id)!;
    return {
      ...def.base,
      ilvl: 100,
      rarity: "lendario",
      refine: 0,
      affixes: [],
      legendary: id,
    } as ItemInstance;
  };
  const arco = legendaryMods({ arma: legendary("arco-do-vendaval") as never });
  const hs = referenceSkills("cacador", 4, 49, false, B);
  hs.slots = ["chuva-de-flechas"];
  const plain = compileLoadout("cacador", hs, B)[0]!;
  const withBow = compileLoadout("cacador", hs, B, arco)[0]!;
  assert.ok(
    Math.abs(withBow.ownCooldownCut! - plain.ownCooldownCut! - 0.2) < 1e-12,
  );

  const bastao = legendaryMods({
    arma: legendary("bastao-do-carvalho-velho") as never,
  });
  const dhs = referenceSkills("druida", 4, 49, false, B);
  dhs.slots = ["rejuvenescer"];
  const rej = compileLoadout("druida", dhs, B, bastao)[0]!.effects[0]!;
  assert.ok(rej.type === "hot" && rej.stacks === 3);

  const machado = legendaryMods({
    arma: legendary("machado-do-rugido") as never,
  });
  const ghs = referenceSkills("guerreiro", 4, 49, false, B);
  ghs.slots = ["grito-de-guerra"];
  assert.ok(
    compileLoadout("guerreiro", ghs, B, machado)[0]!.effects.some(
      (e) => e.type === "dano",
    ),
  );

  assert.equal(
    jobXpBonus({ elmo: legendary("coroa-do-mentor") as never }),
    0.05,
  );
});

test("Cajado da Aurora: a chance de não gastar mana dá mais Curar quando a mana acaba", () => {
  const casts = (mods: boolean) => {
    const hero = R.referenceBalanceHero("padre", 100);
    const hs = referenceSkills("padre", 4, 49, false, B);
    hs.slots = ["curar"];
    hs.ai["curar"] = [{ kind: "sempre" }];
    if (mods)
      hero.equipment.arma = {
        ...hero.equipment.arma!,
        legendary: "cajado-da-aurora",
      };
    const f = {
      ...heroFighter(hero, hs, { potions: { hp: 0, mp: 0, stock: 0 } }),
      // Curar caro de propósito, para a mana acabar e a chance fazer diferença.
      skills: compileLoadout(
        "padre",
        hs,
        B,
        mods ? { curar: perkMods(LEGENDARIES[2]!.perk) } : {},
      ).map((s) => ({
        ...s,
        manaPct: 0.5,
      })),
    };
    const r = fight(
      [f],
      [
        {
          archetype: "chefe",
          level: 100,
          hp: 1e15,
          autoRaw: 0,
          attacksPerSecond: 0.5,
        },
      ],
      {
        maxSeconds: 120,
        mode: "esperado",
      },
    );
    return r.heroes[0]!.casts["curar"] ?? 0;
  };
  assert.ok(casts(true) > casts(false));
});

test("auto-equipar: troca pelo que dá mais dano; não mexe em colar/anel; +7 só com confirmação", () => {
  const hero: BalanceHero = R.referenceBalanceHero("cacador", 100);
  const hs = referenceSkills("cacador", 4, 49, false, B);
  const weak: ItemInstance = {
    slot: "arma",
    family: "arco",
    ilvl: 60,
    rarity: "comum",
    refine: 0,
    affixes: [],
  };
  const strong: ItemInstance = {
    slot: "arma",
    family: "arco",
    ilvl: 100,
    rarity: "epico",
    refine: 6,
    affixes: [],
  };
  const ring: ItemInstance = {
    slot: "anel",
    ilvl: 100,
    rarity: "lendario",
    refine: 0,
    affixes: [{ id: "DES", value: 50 }],
  };
  const start = { ...hero, equipment: { ...hero.equipment, arma: weak } };
  const r = autoEquip(start, hs, [strong, ring]);
  assert.equal(r.equipment.arma, strong);
  assert.equal(r.equipment.anel, hero.equipment.anel, "mexeu no anel");
  assert.equal(r.changes.length, 1);

  const keep = {
    ...hero,
    equipment: { ...hero.equipment, arma: { ...weak, refine: 7 } },
  };
  const k = autoEquip(keep, hs, [strong]);
  assert.equal(k.equipment.arma!.refine, 7);
  assert.equal(k.needsConfirmation.length, 1);
  assert.equal(
    autoEquip(hero, hs, [weak]).changes.length,
    0,
    "trocou por um pior",
  );
});

test("tooltip e visual: base, refino, afixos com diferença para o vestido", () => {
  const it: ItemInstance = {
    slot: "arma",
    family: "cajado",
    ilvl: 100,
    rarity: "epico",
    refine: 9,
    affixes: [
      { id: "INT", value: 4 },
      { id: "matkPct", value: 0.03 },
    ],
  };
  const t = itemTooltip(it, {
    ...it,
    refine: 0,
    affixes: [{ id: "INT", value: 3 }],
  });
  assert.equal(t.requiredLevel, 95);
  assert.equal(
    t.base.find((b) => b.label === "MATQ")!.value,
    Math.round(252 * 1.15 * 1.57 * 1.6),
  );
  assert.equal(t.affixes[0]!.delta, 1);
  assert.equal(t.affixes[1]!.text, "+3,0% MATQ");
  assert.deepEqual(itemVisual(it), {
    silhouette: "cajado",
    material: "Bronze",
    rarityColor: "roxo",
    refineGlow: "particulas",
  });
});

test("D64: a raridade sobe a faixa do afixo; o raro sorteia igual a antes; o item antigo vai para a faixa nova no mesmo ponto", () => {
  // Atributo no iL 40: indicado 2,0 → raro 1,6–2,4, épico 1,8–2,6, lendário 2,0–2,8.
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  const r = (rar: "raro" | "epico" | "lendario") => affixRange("VIT", 40, rar, B);
  near(r("raro").min, 1.6);
  near(r("raro").max, 2.4);
  near(r("epico").min, 1.8);
  near(r("epico").max, 2.6);
  near(r("lendario").min, 2.0);
  near(r("lendario").max, 2.8);
  // Afixo de %: a faixa da tabela × (1 + desvio).
  near(affixRange("mpPct", 40, "epico", B).max, 0.04 * 1.1);
  // O mesmo número do sorteio: raro igual ao de antes (indicado × (0,8 + 0,4 × u)); épico +10% do indicado.
  const fixed = (u: number) => ({ next: () => u });
  assert.equal(rollAffixValue("VIT", 40, fixed(0.25), B), Math.round(2 * (0.8 + 0.4 * 0.25) * 100) / 100);
  assert.equal(rollAffixValue("VIT", 40, fixed(0.25), B, "epico"), 2);
  // No mesmo iL, o épico nunca sai abaixo do piso do raro (e tem um afixo a mais).
  for (let i = 0; i < 200; i++) {
    const it = generateItem({ slot: "colar" }, 70, "epico", randomSource(new Rng(i + 1)), B);
    for (const a of it.affixes) {
      const f = affixRange(a.id, 70, "epico", B);
      assert.ok(a.value >= f.min - 0.01 && a.value <= f.max + 0.01, `${a.id} ${a.value}`);
    }
  }
  // O colar épico do iL 40 sorteado antes da D64 (VIT 1,7, quase no piso de 1,6–2,4) vai para 1,9
  // (o mesmo ponto em 1,8–2,6); o % sobe 10%; o raro não muda.
  const old: ItemInstance = {
    slot: "colar",
    ilvl: 40,
    rarity: "epico",
    refine: 0,
    affixes: [
      { id: "VIT", value: 1.7 },
      { id: "mpPct", value: 0.032 },
    ],
  };
  const up = upgradeAffixesToD64(old, B);
  near(up.affixes[0]!.value, 1.9);
  near(up.affixes[1]!.value, 0.0352);
  const rare = { ...old, rarity: "raro" as const };
  assert.equal(upgradeAffixesToD64(rare, B), rare);
  // A dica mostra a faixa do afixo.
  assert.equal(itemTooltip(up).affixes[0]!.range, "1,8–2,6");
});
