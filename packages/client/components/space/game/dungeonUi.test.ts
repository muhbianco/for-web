import assert from "node:assert/strict";
import test from "node:test";

import {
  bossPrereqs,
  dungeonById,
  dungeonLootOdds,
} from "@muchat/space-core/game/ot/balance";

import {
  bossLoot,
  dungeonCatalog,
  dungeonLock,
  dungeonRow,
  kindParty,
  membersWithoutRegion,
  partySizeFor,
  partySizes,
  rarityRows,
  recommendedDungeons,
  topRarities,
} from "./dungeonUi.ts";

const dg = (id: string) => dungeonById(id)!;
const ids = (list: { id: string }[]) => list.map((d) => d.id);

test("recomendadas: a mais alta de cada tipo que o nível já entra", () => {
  assert.deepEqual(ids(recommendedDungeons(1)), ["cacada-1"]);
  assert.deepEqual(ids(recommendedDungeons(45)), [
    "cacada-40",
    "masmorra-40",
    "regiao-1",
  ]);
  assert.deepEqual(ids(recommendedDungeons(44)), ["cacada-40", "masmorra-40"]);
});

test("trava: o nível não trava (27/11/2026); o chefe pede o resto da região", () => {
  assert.equal(dungeonLock(dg("masmorra-40"), 30, []), null);
  assert.equal(dungeonLock(dg("masmorra-590"), 1, []), null);
  assert.equal(dungeonLock(dg("masmorra-40"), 35, []), null);
  const boss = dungeonLock(dg("regiao-1"), 45, ["cacada-1", "cacada-10"]);
  assert.equal(boss?.why, "region");
  assert.deepEqual(boss?.why === "region" ? ids(boss.missing) : [], [
    "cacada-20",
    "cacada-30",
    "cacada-40",
    "masmorra-40",
  ]);
  const all = ids(bossPrereqs(dg("regiao-1")));
  assert.equal(dungeonLock(dg("regiao-1"), 45, all), null);
  // Abaixo do nível recomendado, com a região concluída, o chefe abre.
  assert.equal(dungeonLock(dg("regiao-1"), 40, all), null);
});

test("catálogo: concluídas por região, filtro por tipo, a região do nível marcada", () => {
  const g = dungeonCatalog(45, ["toca", "cacada-10", "masmorra-40"], "todas");
  // As 10 regiões calibradas e as 2 do fim de jogo (501–600).
  assert.equal(g.length, 12);
  assert.equal(g.at(-1)!.rows.at(-1)!.def.id, "regiao-12");
  const r1 = g[0]!;
  assert.equal(r1.current, true);
  assert.deepEqual([r1.done, r1.total], [3, 7]);
  assert.deepEqual(
    r1.rows.filter((r) => r.done).map((r) => r.def.id),
    ["cacada-1", "cacada-10", "masmorra-40"],
  );
  assert.deepEqual(
    r1.rows.filter((r) => r.recommended).map((r) => r.def.id),
    ["cacada-40", "masmorra-40", "regiao-1"],
  );
  // O filtro tira linhas, não muda a conta da região.
  const only = dungeonCatalog(45, ["masmorra-40"], "masmorra");
  assert.ok(only[0]!.rows.every((r) => r.def.kind === "masmorra"));
  assert.deepEqual([only[0]!.done, only[0]!.total], [1, 7]);
  assert.equal(dungeonRow(dg("cacada-40"), 45, []).recommended, true);
});

test("grupo: os tamanhos da DG e o de saída (o meu grupo dentro do que ela aceita)", () => {
  assert.deepEqual(partySizes(dg("cacada-40")), [1, 2, 3, 4, 5]);
  assert.deepEqual(partySizes(dg("masmorra-40")), [1, 2, 3, 4, 5]);
  assert.equal(partySizeFor(dg("cacada-40")), 1);
  assert.equal(partySizeFor(dg("cacada-40"), 5), 5);
  assert.equal(partySizeFor(dg("cacada-40"), 7), 5);
  assert.equal(partySizeFor(dg("masmorra-40"), 4), 4);
  assert.deepEqual(kindParty("cacada"), { min: 1, max: 5 });
  assert.deepEqual(kindParty("regional"), { min: 1, max: 5 });
});

test("raridades: as 5 em ordem; o destaque são as duas mais altas que saem", () => {
  const o = dungeonLootOdds(dg("masmorra-40"), 3, "mago");
  const rows = rarityRows(o);
  assert.deepEqual(
    rows.map((r) => r.rarity),
    ["comum", "incomum", "raro", "epico", "lendario"],
  );
  assert.deepEqual(
    topRarities(o).map((r) => r.rarity),
    ["lendario", "epico"],
  );
  const c = dungeonLootOdds(dg("cacada-40"), 1, "mago");
  assert.deepEqual(
    topRarities(c).map((r) => r.rarity),
    ["epico", "raro"],
  );
});

test("o chefe de cada tipo: um para o grupo ou um para cada, e a raridade mínima", () => {
  assert.deepEqual(bossLoot("cacada"), { perPlayer: false, floor: "incomum" });
  assert.deepEqual(bossLoot("masmorra"), { perPlayer: true, floor: "raro" });
  assert.deepEqual(bossLoot("regional"), { perPlayer: true, floor: "epico" });
});

test("no grupo do chefe: quem ainda não concluiu a região (sem dado, ninguém)", () => {
  const m = (id: string, regions?: number[]) => ({
    user_id: id,
    name: id,
    cls: "mago" as const,
    level: 50,
    ...(regions ? { regions } : {}),
  });
  const members = [m("a", [1]), m("b", []), m("c"), m("d", [2])];
  assert.deepEqual(
    membersWithoutRegion(members, dg("regiao-1")).map((x) => x.user_id),
    ["b", "d"],
  );
  assert.deepEqual(membersWithoutRegion(members, dg("masmorra-40")), []);
});
