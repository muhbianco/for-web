import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { randomSource } from "../combat/fight.ts";
import { CLASS_IDS, CLASSES } from "../content.ts";
import { dungeonById } from "../dungeons/catalog.ts";
import { cannotEquip } from "../equipment.ts";
import { balance as B } from "../formulas.ts";
import { materialOf } from "../items/generate.ts";
import { itemPerks } from "../items/legendary.ts";
import { limitEncounters as E } from "../sim/encounters.ts";
import { SKILLS_BY_CLASS } from "../skills/index.ts";
import { lootFor, lootSource, rollBase, rollItem, rollRarity, runLoot } from "./loot.ts";
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
          err.startsWith("aljava") ||
          err.startsWith("punhal"),
        `${cls}: ${err}`,
      );
    }
    assert.equal(slots.has("secundaria"), CLASSES[cls].offhands.length > 0);
  }
});

test("o Lendário que cai é qualquer item do jogo, com o perk da classe de quem dropou (27/11/2026)", () => {
  const r = rng(5);
  const n = 6000;
  for (const cls of CLASS_IDS) {
    const own = new Set(SKILLS_BY_CLASS[cls].map((s) => s.id));
    let crown = 0;
    let named = 0;
    let other = 0;
    const slots = new Set<string>();
    for (let i = 0; i < n; i++) {
      const item = rollItem(cls, 200, "lendario", r);
      assert.equal(item.rarity, "lendario", cls);
      slots.add(
        item.slot === "arma"
          ? item.family
          : item.slot === "secundaria"
            ? item.offhand
            : "weight" in item
              ? `${item.slot}-${item.weight}`
              : item.slot,
      );
      const perks = itemPerks(item);
      assert.equal(perks.length, 1, `${cls} ${item.legendary}`);
      if (item.legendary === "coroa-do-mentor") {
        crown++;
        assert.equal(perks[0]!.skill, "xp-de-job");
        continue;
      }
      // O perk é sempre de uma skill da classe de quem dropou (o de origem só quando é dela).
      assert.ok(own.has(perks[0]!.skill), `${cls}: perk ${perks[0]!.skill}`);
      if (item.legendary) named++;
      else other++;
    }
    const near = (got: number, want: number, what: string) =>
      assert.ok(
        Math.abs(got / n - want) < 0.025,
        `${cls} ${what}: ${((got / n) * 100).toFixed(1)}%`,
      );
    near(crown, B.cfg.loot.sharedLegendaryShare, "Coroa");
    near(named, B.cfg.loot.namedLegendaryShare, "com nome");
    near(
      other,
      1 - B.cfg.loot.sharedLegendaryShare - B.cfg.loot.namedLegendaryShare,
      "base qualquer",
    );
    // Qualquer item do jogo: as 30 bases saem para toda classe (inclusive as que ela não veste;
    // o punhal entrou em 27/11/2026).
    assert.equal(slots.size, 30, `${cls}: ${slots.size} bases`);
  }
  // O lendário com nome da própria classe vem com o perk de origem.
  let seen = false;
  for (let i = 0; i < 4000 && !seen; i++) {
    const it = rollItem("guerreiro", 100, "lendario", r);
    if (it.legendary === "machado-do-rugido") {
      assert.deepEqual(itemPerks(it), [
        { skill: "grito-de-guerra", value: 0.8 },
      ]);
      seen = true;
    }
  }
  assert.ok(seen);
});

test("a corrida dá minério da região por sala vencida a cada vivo, e os itens dos abates", () => {
  const d = dungeonById("masmorra-70")!;
  const classes = ["guerreiro", "padre", "mago", "cacador"] as const;
  const party = classes.map((c) =>
    E.fighter(c, 70, { source: "spec", referenceAi: "gabarito" }),
  );
  const run = simulateRun(d, party, { mode: "esperado" });
  const loot = runLoot(d, [...classes], run, rng(6));
  const mat = materialOf(70);
  assert.deepEqual(
    loot.ores.map((o) => o[mat]),
    [4, 4, 4, 4],
  );
  // O chefe dá 1 item para cada um dos 4.
  const fromBoss = loot.items.filter((x) => x.item.ilvl === 70).length;
  assert.ok(fromBoss >= 4);
});

test("Caçada de 4 e 5: mais itens por abate e a chance de Lendário; até o trio, o sorteio de sempre", () => {
  const n = 30_000;
  const five = ["guerreiro", "padre", "mago", "cacador", "assassino"] as const;
  const all5 = [true, true, true, true, true];
  const menor = lootFor(
    Array.from({ length: n }, () => kill("chefeMenor", all5)),
    [...five],
    rng(11),
    B,
    "cacada",
  );
  assert.ok(Math.abs(menor.items.length / n - 5 / 3) < 0.02);
  const legendary = menor.items.filter(
    (d) => d.item.rarity === "lendario",
  ).length;
  assert.ok(Math.abs(legendary / menor.items.length - 0.02) < 0.004);
  // Na Masmorra, o 5º não muda o chefe menor (a fonte não cresce) nem a raridade.
  const masmorra = lootFor(
    Array.from({ length: 2000 }, () => kill("elite", all5)),
    [...five],
    rng(11),
    B,
    "masmorra",
  );
  assert.ok(masmorra.items.every((d) => d.item.rarity !== "lendario"));
  // Trio na Caçada: a mesma semente dá o mesmo drop com ou sem o tipo (as corridas gravadas não mudam).
  const trio = ["guerreiro", "padre", "mago"] as const;
  const kills3 = Array.from({ length: 500 }, (_, i) =>
    kill(i % 7 === 0 ? "chefeMenor" : "lacaio", [true, true, true]),
  );
  assert.deepEqual(
    lootFor(kills3, [...trio], rng(5), B, "cacada"),
    lootFor(kills3, [...trio], rng(5), B),
  );
});

test("Masmorra (27/11/2026): o Lendário do chefe é 3% até o trio, 4% com 4 e 5% com 5; Caçada e Região seguem", () => {
  const five = ["guerreiro", "padre", "mago", "cacador", "assassino"] as const;
  for (const [n, want] of [[2, 0.03], [3, 0.03], [4, 0.04], [5, 0.05]] as const) {
    const src = lootSource("chefe", "masmorra", n, B);
    assert.ok(Math.abs((src.rarity.lendario ?? 0) - want) < 1e-12, `${n}: ${src.rarity.lendario}`);
    const sum = Object.values(src.rarity).reduce((a, x) => a + (x ?? 0), 0);
    assert.ok(Math.abs(sum - 1) < 1e-12, `${n}: soma ${sum}`);
    // O raro e o épico encolhem na mesma proporção (70 : 27).
    assert.ok(Math.abs((src.rarity.raro ?? 0) / (src.rarity.epico ?? 1) - 70 / 27) < 1e-9);
  }
  // O sorteio: 5 no grupo, um item do chefe para cada vivo.
  const kills = Array.from({ length: 20_000 }, () => kill("chefe", [true, true, true, true, true]));
  const got = lootFor(kills, [...five], rng(17), B, "masmorra").items;
  const leg = got.filter((d) => d.item.rarity === "lendario").length / got.length;
  assert.ok(Math.abs(leg - 0.05) < 0.004, `Lendário ${leg}`);
  // Chefe de Região e Caçada como estavam.
  assert.equal(lootSource("regional", "regional", 5, B), B.cfg.loot.sources.regional);
  assert.equal(lootSource("chefe", "cacada", 3, B), B.cfg.loot.sources.chefe);
  assert.equal(lootSource("lacaio", "masmorra", 5, B), B.cfg.loot.sources.lacaio);
});
