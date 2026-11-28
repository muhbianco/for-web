import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { randomSource } from "../combat/fight.ts";
import { type ClassId, RARITY_IDS } from "../content.ts";
import { dungeonById, dungeonRooms, dungeonType } from "../dungeons/catalog.ts";
import { balance as B } from "../formulas.ts";
import { LEGENDARIES } from "../items/legendary.ts";
import { createMonsters } from "../monsters/generate.ts";
import { lootFor } from "./loot.ts";
import { dungeonLootOdds } from "./lootOdds.ts";
import type { RewardKill } from "./rewards.ts";

// As chances que a TV mostra (lootOdds.ts) contra o sorteio de verdade (lootFor), corrida a corrida.

const M = createMonsters(B);
const dg = (id: string) => dungeonById(id)!;

/** Os abates de uma corrida vencida com todos vivos: os monstros das 4 salas, na ordem. */
function kills(id: string, n: number): RewardKill[] {
  return dungeonRooms(dg(id), n, M)
    .flat()
    .map((e) => ({
      archetype: e.archetype,
      level: e.level,
      summoned: false,
      alive: Array.from({ length: n }, () => true),
    }));
}

/** O herói 0 em `runs` corridas: chance de ≥ 1 item de cada raridade, itens por corrida e pedras. */
function sample(id: string, classes: ClassId[], runs: number, seed: number) {
  const rng = randomSource(new Rng(seed));
  const list = kills(id, classes.length);
  const hit = Object.fromEntries(RARITY_IDS.map((r) => [r, 0]));
  let items = 0;
  let stones = 0;
  for (let i = 0; i < runs; i++) {
    const out = lootFor(list, classes, rng, B, dungeonType(dg(id)));
    const mine = out.items.filter((x) => x.hero === 0);
    items += mine.length;
    for (const r of new Set(mine.map((x) => x.item.rarity))) hit[r]!++;
    if (out.protectionStones[0]! > 0) stones++;
  }
  return {
    atLeastOne: Object.fromEntries(
      Object.entries(hit).map(([r, c]) => [r, c / runs]),
    ),
    items: items / runs,
    stones: stones / runs,
  };
}

function near(got: number, want: number, tol: number, what: string) {
  assert.ok(
    Math.abs(got - want) <= tol,
    `${what}: sorteio ${got.toFixed(4)} × conta ${want.toFixed(4)}`,
  );
}

for (const [id, classes] of [
  ["cacada-40", ["mago"]],
  ["cacada-40", ["mago", "guerreiro", "padre"]],
  ["cacada-40", ["mago", "guerreiro", "padre", "cacador"]],
  ["cacada-130", ["mago", "guerreiro", "padre", "cacador", "druida"]],
  ["masmorra-40", ["mago", "guerreiro", "padre"]],
  ["regiao-1", ["cacador", "paladino"]],
] as [string, ClassId[]][]) {
  test(`${id} com ${classes.length}: a conta bate com o sorteio do servidor`, () => {
    const odds = dungeonLootOdds(dg(id), classes.length, classes[0]);
    const s = sample(id, classes, 12_000, 7 + classes.length);
    for (const r of RARITY_IDS)
      near(s.atLeastOne[r]!, odds.perHero.atLeastOne[r], 0.015, r);
    near(s.items, odds.perHero.items, 0.04, "itens");
    near(s.stones, odds.protectionStone, 0.01, "pedra");
  });
}

test("as fontes de uma corrida: 12 lacaios, 1 elite e o chefe do tipo", () => {
  const arch = (id: string) =>
    dungeonLootOdds(dg(id), 1).sources.map((s) => [s.archetype, s.count]);
  assert.deepEqual(arch("cacada-40"), [
    ["lacaio", 12],
    ["elite", 1],
    ["chefeMenor", 1],
  ]);
  assert.deepEqual(arch("masmorra-40"), [
    ["lacaio", 12],
    ["elite", 1],
    ["chefe", 1],
  ]);
  assert.deepEqual(arch("regiao-1"), [
    ["lacaio", 12],
    ["elite", 1],
    ["regional", 1],
  ]);
});

test("cada fonte soma 1 na raridade; o item do chefe de Masmorra e de Região é de cada um", () => {
  for (const id of ["cacada-1", "masmorra-40", "regiao-1"])
    for (const s of dungeonLootOdds(dg(id), 3, "druida").sources) {
      const sum = RARITY_IDS.reduce((a, r) => a + s.rarity[r], 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${id} ${s.archetype}`);
      assert.equal(
        s.perPlayer,
        s.archetype === "chefe" || s.archetype === "regional",
      );
    }
});

test("nível e material dos itens, minério da região e Pedra só na Masmorra", () => {
  const m40 = dungeonLootOdds(dg("masmorra-40"), 1);
  assert.deepEqual(m40.itemLevels, { min: 36, max: 40 });
  assert.deepEqual(m40.materials, ["Ferro"]);
  assert.deepEqual(m40.ore, { material: "Ferro", perHero: 4 });
  near(m40.protectionStone, B.cfg.loot.protectionStoneChance, 1e-12, "pedra");
  assert.equal(dungeonLootOdds(dg("regiao-1"), 1).protectionStone, 0);
  assert.equal(dungeonLootOdds(dg("cacada-40"), 1).protectionStone, 0);
  // A Caçada 51 tem lacaios do 47 ao 51: Ferro e Bronze; o minério é o da região (Bronze).
  const c51 = dungeonLootOdds(dg("cacada-51"), 1);
  assert.deepEqual(c51.materials, ["Ferro", "Bronze"]);
  assert.equal(c51.ore.material, "Bronze");
});

test("com a classe: os lugares que caem e os lendários com nome", () => {
  const mago = dungeonLootOdds(dg("masmorra-40"), 1, "mago");
  assert.ok(mago.slots.includes("arma") && mago.slots.includes("anel"));
  // Os lendários com nome, de qualquer classe (desde 27/11/2026 o Lendário é qualquer item do jogo).
  assert.deepEqual(
    mago.legendaries,
    LEGENDARIES.map((l) => l.id),
  );
  assert.ok(mago.perHero.atLeastOne.lendario > 0);
  const semClasse = dungeonLootOdds(dg("masmorra-40"), 1);
  assert.deepEqual(semClasse.slots, []);
  assert.deepEqual(semClasse.legendaries, []);
});

test("mais gente no grupo divide o item dos lacaios, da elite e do chefe menor", () => {
  const solo = dungeonLootOdds(dg("cacada-40"), 1);
  const trio = dungeonLootOdds(dg("cacada-40"), 3);
  near(trio.perHero.items, solo.perHero.items / 3, 1e-9, "itens");
  // O chefe de Masmorra dá um para cada um: até o trio o Lendário não muda com o grupo; desde
  // 27/11/2026 ele sobe com o 4º e o 5º (3% → 4% → 5%, `loot.masmorraLegendary`).
  const leg = (n: number) => dungeonLootOdds(dg("masmorra-40"), n).perHero.atLeastOne.lendario;
  near(leg(3), leg(1), 1e-9, "lendário até o trio");
  assert.ok(leg(4) > leg(3) && leg(5) > leg(4), `lendário ${leg(3)} ${leg(4)} ${leg(5)}`);
  const boss = (n: number) =>
    dungeonLootOdds(dg("masmorra-40"), n).sources.find((x) => x.archetype === "chefe")!.rarity.lendario;
  near(boss(4), 0.04, 1e-12, "chefe com 4");
  near(boss(5), 0.05, 1e-12, "chefe com 5");
});

test("Caçada de 4 e 5: o drop cresce na proporção do grupo sobre o trio e o Lendário entra com 1% e 2%", () => {
  const at = (n: number) => dungeonLootOdds(dg("cacada-130"), n, "mago");
  const trio = at(3);
  // Por herói, o de 4 e o de 5 levam o mesmo número de itens que o trio (o drop cresce n ÷ 3).
  near(at(4).perHero.items, trio.perHero.items, 1e-9, "itens com 4");
  near(at(5).perHero.items, trio.perHero.items, 1e-9, "itens com 5");
  assert.equal(trio.perHero.atLeastOne.lendario, 0);
  const menor = (n: number) =>
    at(n).sources.find((s) => s.archetype === "chefeMenor")!;
  near(menor(4).chance, 4 / 3, 1e-12, "chefe menor com 4");
  near(menor(5).chance, 5 / 3, 1e-12, "chefe menor com 5");
  for (const [n, bonus] of [
    [4, 0.01],
    [5, 0.02],
  ] as const)
    for (const s of at(n).sources) {
      near(s.rarity.lendario, bonus, 1e-12, `lendário ${s.archetype} com ${n}`);
      const sum = RARITY_IDS.reduce((a, r) => a + s.rarity[r], 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `${s.archetype} com ${n}`);
    }
  // A Masmorra e a Região não mudam com o 4º e o 5º.
  for (const id of ["masmorra-130", "regiao-3"])
    for (const n of [4, 5]) {
      const base = dungeonLootOdds(dg(id), n, "mago");
      for (const s of base.sources)
        assert.equal(
          s.chance,
          B.cfg.loot.sources[s.archetype].chance,
          `${id} ${s.archetype} com ${n}`,
        );
    }
});
