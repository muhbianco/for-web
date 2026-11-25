import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { randomSource } from "../combat/fight.ts";
import { CLASS_IDS, CLASSES } from "../content.ts";
import { dungeonById } from "../dungeons/catalog.ts";
import { cannotEquip } from "../equipment.ts";
import { balance as B } from "../formulas.ts";
import { materialOf } from "../items/generate.ts";
import { LEGENDARIES } from "../items/legendary.ts";
import { encounters as E } from "../sim/encounters.ts";
import { lootFor, rollBase, rollItem, rollRarity, runLoot } from "./loot.ts";
import type { RewardKill } from "./rewards.ts";
import { simulateRun } from "./simulate.ts";

// Drops da corrida (spec §13).

const rng = (seed: number) => randomSource(new Rng(seed));
const kill = (
  archetype: RewardKill["archetype"],
  alive: boolean[],
  summoned = false,
): RewardKill => ({ archetype, level: 100, summoned, alive });

test("a raridade sai nas proporções da tabela", () => {
  const r = rng(1);
  const w = B.cfg.loot.sources.elite.rarity;
  const n = 40_000;
  const count: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const x = rollRarity(w, r);
    count[x] = (count[x] ?? 0) + 1;
  }
  for (const [id, p] of Object.entries(w))
    assert.ok(Math.abs((count[id] ?? 0) / n - p) < 0.01, `${id}`);
});

test("chance de item por fonte; chefe dá 1 por vivo; invocado e morto não levam", () => {
  const r = rng(2);
  const all = [true, true, true, true];
  const n = 20_000;
  const lacaios = lootFor(
    Array.from({ length: n }, () => kill("lacaio", all)),
    ["guerreiro", "padre", "mago", "cacador"],
    r,
  );
  assert.ok(Math.abs(lacaios.items.length / n - 0.06) < 0.006);
  const boss = lootFor(
    [kill("chefe", [true, false, true, true])],
    ["guerreiro", "padre", "mago", "cacador"],
    r,
  );
  assert.deepEqual(
    boss.items.map((d) => d.hero),
    [0, 2, 3],
  );
  assert.ok(boss.items.every((d) => d.item.ilvl === 100));
  const menor = lootFor([kill("chefeMenor", [true])], ["mago"], r);
  assert.equal(menor.items.length, 1);
  const none = lootFor(
    Array.from({ length: 200 }, () => kill("chefe", all, true)),
    ["guerreiro", "padre", "mago", "cacador"],
    r,
  );
  assert.equal(none.items.length, 0);
});

test("a Pedra de Proteção cai do chefe de masmorra em ~5% por herói vivo", () => {
  const n = 20_000;
  const r = lootFor(
    Array.from({ length: n }, () => kill("chefe", [true])),
    ["guerreiro"],
    rng(3),
  );
  assert.ok(Math.abs(r.protectionStones[0]! / n - 0.05) < 0.005);
  const menor = lootFor(
    Array.from({ length: 2000 }, () => kill("chefeMenor", [true])),
    ["guerreiro"],
    rng(3),
  );
  assert.equal(menor.protectionStones[0], 0);
});

test("o item que cai é de uma base que a classe de quem recebe veste", () => {
  const r = rng(4);
  for (const cls of CLASS_IDS) {
    const hero = {
      cls,
      level: 100,
      job: 50,
      proficiency: 1000,
      attrs: { FOR: 1, AGI: 1, VIT: 1, INT: 1, DES: 1, SOR: 1 },
      equipment: {},
    };
    const slots = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const base = rollBase(cls, r);
      slots.add(base.slot);
      const item = rollItem(cls, 100, "raro", r);
      const err = cannotEquip(hero, item);
      assert.ok(
        err === null ||
          err.startsWith("duas-maos") ||
          err.startsWith("focus") ||
          err.startsWith("aljava"),
        `${cls}: ${err}`,
      );
    }
    assert.equal(slots.has("secundaria"), CLASSES[cls].offhands.length > 0);
  }
});

test("o Lendário que cai é um dos lendários de efeito único, da classe quando há", () => {
  const r = rng(5);
  for (const cls of CLASS_IDS) {
    const item = rollItem(cls, 200, "lendario", r);
    const own = LEGENDARIES.filter((l) => l.cls === cls);
    assert.ok(item.rarity === "lendario" || item.rarity === "epico");
    if (item.rarity === "lendario") {
      assert.ok(item.legendary, cls);
      if (own.length > 0)
        assert.ok(
          own.some((l) => l.id === item.legendary),
          cls,
        );
    }
  }
});

test("a corrida dá minério da região por sala vencida a cada vivo, e os itens dos abates", () => {
  const d = dungeonById("masmorra-70")!;
  const classes = ["guerreiro", "padre", "mago", "cacador"] as const;
  const party = classes.map((c) =>
    E.fighter(c, 70, { source: "spec", referenceAi: "gabarito" }),
  );
  const run = simulateRun(d, party, { mode: "esperado" });
  const loot = runLoot(70, [...classes], run, rng(6));
  const mat = materialOf(70);
  assert.deepEqual(
    loot.ores.map((o) => o[mat]),
    [4, 4, 4, 4],
  );
  // O chefe dá 1 item para cada um dos 4.
  const fromBoss = loot.items.filter((x) => x.item.ilvl === 70).length;
  assert.ok(fromBoss >= 4);
});
