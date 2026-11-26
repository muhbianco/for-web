import assert from "node:assert/strict";
import test from "node:test";

import { DUNGEONS, dungeonById } from "./catalog.ts";
import {
  bossMissing,
  bossPrereqs,
  bossRegions,
  normalizeCleared,
  withCleared,
} from "./clears.ts";

// DG concluída e a trava do Chefe de Região (pedido do dono, 26/11/2026).

const dg = (id: string) => dungeonById(id)!;
const ids = (list: { id: string }[]) => list.map((d) => d.id);

test("o chefe da região 1 pede as 5 Caçadas e a Masmorra 40", () => {
  assert.deepEqual(ids(bossPrereqs(dg("regiao-1"))), [
    "cacada-1",
    "cacada-10",
    "cacada-20",
    "cacada-30",
    "cacada-40",
    "masmorra-40",
  ]);
});

test("das outras regiões, as Caçadas e as Masmorras dela (9), nunca um chefe", () => {
  for (const boss of DUNGEONS.filter((d) => d.kind === "regional")) {
    const pre = bossPrereqs(boss);
    if (boss.region.index > 1) assert.equal(pre.length, 9, boss.id);
    assert.ok(pre.every((d) => d.region.index === boss.region.index));
    assert.ok(pre.every((d) => d.kind !== "regional"));
  }
  assert.deepEqual(bossPrereqs(dg("cacada-40")), []);
  assert.deepEqual(bossPrereqs(dg("masmorra-40")), []);
});

test("o que falta sai na ordem do catálogo; o id antigo conta", () => {
  const boss = dg("regiao-1");
  assert.equal(bossMissing(boss, []).length, 6);
  assert.deepEqual(
    ids(bossMissing(boss, ["toca", "cacada-10", "cacada-20", "cacada-30"])),
    ["cacada-40", "masmorra-40"],
  );
  assert.deepEqual(
    bossMissing(boss, ids(bossPrereqs(boss))),
    [],
    "tudo concluído libera",
  );
  assert.deepEqual(bossMissing(dg("masmorra-40"), []), [], "só o chefe trava");
});

test("as regiões liberadas são as que têm tudo concluído (o chefe não conta)", () => {
  const r1 = ids(bossPrereqs(dg("regiao-1")));
  const r2 = ids(bossPrereqs(dg("regiao-2")));
  assert.deepEqual(bossRegions([]), []);
  assert.deepEqual(bossRegions(r1), [1]);
  assert.deepEqual(bossRegions([...r1, ...r2.slice(1)]), [1]);
  assert.deepEqual(bossRegions([...r2, ...r1, "regiao-1"]), [1, 2]);
});

test("a lista guardada: canônica, sem repetidos, sem lixo, na ordem do catálogo", () => {
  assert.deepEqual(normalizeCleared(["masmorra-40", "toca", "x", "cacada-1"]), [
    "cacada-1",
    "masmorra-40",
  ]);
  assert.deepEqual(withCleared(undefined, "toca"), ["cacada-1"]);
  assert.deepEqual(withCleared(["cacada-10"], "cacada-1"), [
    "cacada-1",
    "cacada-10",
  ]);
  assert.deepEqual(withCleared(["cacada-1"], "cacada-1"), ["cacada-1"]);
});
