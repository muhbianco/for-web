import assert from "node:assert/strict";
import test from "node:test";

import {
  type HeroV5,
  createHero,
  generateItem,
  raiseAttributes,
} from "@muchat/space-core/game/ot/balance";

import {
  autoPlan,
  bagMarks,
  beltOptions,
  dungeonGroups,
  evolveCheck,
  heroBars,
  pending,
  runRooms,
  skillBudget,
  skillRows,
  stageSpend,
  suggestRaise,
} from "./heroModel.ts";
import { ICON, iconPixels, OUTLINE } from "./pixelArt.ts";

let n = 0;
const id = () => `t${n++}`;
const half = { next: () => 0.5 };

function at(cls: HeroV5["cls"], level: number, job: number): HeroV5 {
  return { ...createHero(cls, id), level, job, xp: 0, jobXp: 0 };
}

test("a new hero has its points pending and the T1 skills in the slots", () => {
  const h = at("mago", 10, 8);
  const p = pending(h);
  assert.equal(p.attrPoints, 45);
  assert.equal(p.skillPoints, 7);
  assert.equal(heroBars(h).title, "Aprendiz");
  assert.equal(skillRows(h).filter((r) => r.slot >= 0).length, 2);
});

test("the suggestion spends the free points on the class build without going over", () => {
  const h = at("guerreiro", 30, 10);
  const add = suggestRaise(h, pending(h).attrPoints);
  const r = raiseAttributes(h, add);
  assert.ok(r.ok);
  assert.ok((add.VIT ?? 0) > (add.DES ?? 0));
  assert.equal(add.INT ?? 0, 0);
  if (r.ok) assert.ok(pending(r.hero).attrPoints < 2);
});

test("staging a Potency point raises the main number of the skill", () => {
  const h = at("mago", 10, 8);
  const row = skillRows(h).find(
    (r) => r.learned && r.numbers.main.kind === "dano",
  )!;
  const s = stageSpend(h, h.skills, row.content.id, "potencia");
  assert.ok(s.ok);
  if (!s.ok) return;
  const after = skillRows(h, s.skills).find(
    (r) => r.content.id === row.content.id,
  )!;
  assert.ok(after.numbers.main.value > row.numbers.main.value);
  assert.equal(skillBudget(h, s.skills).spent, 1);
});

test("bag marks: a better weapon is ▲, a weapon of another class is blocked", () => {
  const h = at("guerreiro", 20, 10);
  const better = {
    ...generateItem({ slot: "arma", family: "espada" }, 20, "epico", half),
    uid: "best",
  };
  const staff = {
    ...generateItem({ slot: "arma", family: "cajado" }, 5, "comum", half),
    uid: "staff",
  };
  const m = bagMarks({ ...h, bag: [better, staff] });
  assert.equal(m.best?.mark, "up");
  assert.equal(m.staff?.mark, "blocked");
  assert.equal(m.staff?.reason, "classe-nao-usa");
  assert.equal(pending({ ...h, bag: [better, staff] }).upgrades, 1);
});

test("auto-equip preview never swaps a +7 without asking", () => {
  const h = at("guerreiro", 30, 10);
  const worn = { ...h.equipment.arma!, refine: 8 };
  const better = {
    ...generateItem({ slot: "arma", family: "espada" }, 30, "lendario", half),
    uid: "leg",
  };
  const plan = autoPlan({
    ...h,
    equipment: { ...h.equipment, arma: worn },
    bag: [better],
  });
  assert.ok(plan);
  assert.ok(!plan!.changes.some((c) => c.slot === "arma"));
  assert.equal(plan!.confirm[0]?.candidate.uid, "leg");
});

test("belt: the three sizes heal the same per second (D35)", () => {
  const rows = beltOptions(at("cacador", 40, 20), "hp");
  assert.equal(rows.length, 3);
  const ps = rows.map((r) => Math.round(r.perSecond));
  assert.ok(Math.max(...ps) - Math.min(...ps) <= 1);
  assert.equal(rows.find((r) => r.equipped)?.size, "pequena");
});

test("evolution: the milestone and the points that still fit", () => {
  const h = at("padre", 15, 20);
  const c = evolveCheck(h);
  assert.equal(c.next, 2);
  assert.equal(c.milestone?.ok, true);
  assert.ok(c.pointsLeft > 0);
  assert.equal(c.ok, false);
});

test("dungeons: Masmorras only from the 40 (D19) and one 'best' per kind", () => {
  const g = dungeonGroups(41, "todas");
  const r1 = g[0]!;
  assert.ok(
    r1.rows.every((r) => r.def.kind !== "masmorra" || r.def.level >= 40),
  );
  const best = g.flatMap((x) => x.rows).filter((r) => r.best);
  assert.deepEqual(new Set(best.map((b) => b.def.kind)).size, best.length);
  assert.equal(runRooms("cacada-1", 1).length, 4);
});

test("item icons: 32×32, every family drawn, outline around the shape", () => {
  for (const s of [
    "espada",
    "arco",
    "cajado",
    "escudo",
    "elmo-pesada",
    "botas-leve",
    "anel",
    "colar",
  ]) {
    const px = iconPixels({ silhouette: s, material: "Bronze" });
    assert.equal(px.length, ICON * ICON);
    const filled = px.filter((p) => p && p !== OUTLINE).length;
    assert.ok(filled > 40, `${s} has a body`);
    assert.ok(px.includes(OUTLINE), `${s} has an outline`);
  }
});

test("rarity and comparison colors pass 4.5:1 on every game background", async () => {
  const { GAME_BG, GAME_DOWN, GAME_UP, RARITY, contrast } =
    await import("./gameTheme.ts");
  for (const bg of GAME_BG)
    for (const c of [
      GAME_UP,
      GAME_DOWN,
      ...Object.values(RARITY).map((r) => r.color),
    ])
      assert.ok(
        contrast(c, bg) >= 4.5,
        `${c} on ${bg}: ${contrast(c, bg).toFixed(2)}`,
      );
  // Forma além da cor: cada raridade tem marcador ou moldura diferente.
  assert.equal(new Set(Object.values(RARITY).map((r) => r.frame)).size, 5);
});
