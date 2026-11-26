import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { randomSource } from "../combat/fight.ts";
import type { ClassId } from "../content.ts";
import { CLASS_IDS } from "../content.ts";
import { encounters as E } from "./encounters.ts";
import { GABARITO_SOLO_KITS } from "./kits.ts";

// Invariantes da §14 do spec rodando o motor de luta de verdade (modo esperado, como o gabarito que
// calibrou os números). O Monte Carlo completo da §14.9 (200 lutas por cenário, mecânicas sem [SIM]) é
// da Fase 7; aqui vai uma amostra do modo aleatório.

const LEVELS = [10, 20, 40, 70, 100, 150, 200, 300, 400, 500];

const FULL: ClassId[][] = [
  ["guerreiro", "padre", "mago", "cacador"],
  ["paladino", "druida", "assassino", "cacador"],
  ["guerreiro", "druida", "mago", "assassino"],
  ["paladino", "padre", "assassino", "mago"],
];
const TRIOS: ClassId[][] = [
  ["guerreiro", "padre", "cacador"],
  ["paladino", "druida", "mago"],
];
const MUST_LOSE: [string, ClassId[]][] = [
  ["sem tanque", ["padre", "mago", "cacador", "assassino"]],
  ["sem suporte (guerreiro)", ["guerreiro", "mago", "cacador", "assassino"]],
  ["sem suporte (paladino)", ["paladino", "mago", "cacador", "assassino"]],
  ["sem DPS", ["guerreiro", "padre", "druida", "paladino"]],
  ["só DPS", ["mago", "cacador", "assassino", "mago"]],
];

const name = (c: ClassId[]) => c.join("+");

test("§14.1: T/H/D/D vence em 75–100 s sem mortes, em todo nível", () => {
  for (const L of LEVELS)
    for (const comp of FULL) {
      const r = E.dungeonFight(comp, L);
      assert.ok(r.win, `${name(comp)} L${L} perdeu`);
      assert.equal(r.deaths, 0, `${name(comp)} L${L}: ${r.deaths} morte(s)`);
      assert.ok(
        r.seconds >= 75 && r.seconds <= 100,
        `${name(comp)} L${L}: ${r.seconds} s`,
      );
    }
});

test("§14.1: trio T/H/D vence sem mortes (97–112 s no gabarito)", () => {
  for (const L of LEVELS)
    for (const comp of TRIOS) {
      const r = E.dungeonFight(comp, L);
      assert.ok(r.win && r.deaths === 0, `${name(comp)} L${L}`);
      assert.ok(
        r.seconds >= 95 && r.seconds <= 115,
        `${name(comp)} L${L}: ${r.seconds} s`,
      );
    }
});

test("§14.1: sem tanque, sem suporte, sem DPS e só DPS perdem", () => {
  for (const L of LEVELS)
    for (const [label, comp] of MUST_LOSE)
      assert.ok(!E.dungeonFight(comp, L).win, `${label} L${L} venceu`);
});

test("§14.1: sem DPS perde para o Cataclismo", () => {
  for (const L of [40, 300]) {
    const r = E.dungeonFight(["guerreiro", "padre", "druida", "paladino"], L);
    assert.equal(r.firstDeath?.cause, "cataclismo", `L${L}`);
  }
});

test("§14.2: nível compensa a falta de suporte até certo ponto", () => {
  const comp: ClassId[] = ["guerreiro", "mago", "cacador", "assassino"];
  const at = (m: number, x: number) =>
    E.dungeonFight(comp, m, {}, [m + x, m + x, m + x, m + x]).win;
  for (const m of [40, 100, 300]) assert.ok(!at(m, 0), `m=${m} +0 venceu`);
  assert.ok(at(40, 10) && at(100, 10), "+10 não bastou em m=40/100");
  assert.ok(!at(300, 10), "+10 bastou em m=300");
  assert.ok(at(300, 20), "+20 não bastou em m=300");
});

test("§14.3: DPS em alvo único — DPS a ±20%, tanques 20–45% e suportes 15–40% do mago", () => {
  for (const L of [10, 40, 100, 200, 300, 500]) {
    const v = Object.fromEntries(
      CLASS_IDS.map((c) => [c, E.soloDps(c, L, 90)]),
    ) as Record<ClassId, number>;
    const mage = v.mago;
    const dps = [v.mago, v.cacador, v.assassino];
    assert.ok(
      Math.max(...dps) / Math.min(...dps) <= 1.25,
      `L${L}: DPS fora da faixa`,
    );
    for (const c of ["guerreiro", "paladino"] as const)
      assert.ok(
        v[c] / mage >= 0.2 && v[c] / mage <= 0.45,
        `L${L} ${c}: ${(v[c] / mage).toFixed(2)}`,
      );
    for (const c of ["padre", "druida"] as const)
      assert.ok(
        v[c] / mage >= 0.15 && v[c] / mage <= 0.4,
        `L${L} ${c}: ${(v[c] / mage).toFixed(2)}`,
      );
  }
});

test("§14.4: toda classe vence o chefe menor sozinha em ≤ 120 s, em TODO nível de 1 a 500", () => {
  const solo = { kits: GABARITO_SOLO_KITS };
  for (let L = 1; L <= 500; L++)
    for (const cls of CLASS_IDS) {
      const r = E.huntFight(cls, L, solo);
      assert.ok(
        r.win && r.seconds <= 120,
        `${cls} L${L}: ${r.win ? `${r.seconds} s` : "perdeu"}`,
      );
    }
});

test("§14.8: a PT de referência sem nenhuma proficiência (b = 1) ainda vence até o L100", () => {
  for (const L of [10, 40, 70, 100]) {
    const r = E.dungeonFight(["guerreiro", "padre", "mago", "cacador"], L, {
      proficiency: () => 1,
    });
    assert.ok(r.win, `L${L} perdeu`);
  }
});

test("modo aleatório: mesma semente dá a mesma luta, e a amostra segue os invariantes", () => {
  const comp: ClassId[] = ["guerreiro", "padre", "mago", "cacador"];
  const once = (seed: number) =>
    E.dungeonFight(comp, 100, {
      mode: "aleatorio",
      random: randomSource(new Rng(seed)),
    });
  assert.deepEqual(once(7), once(7));
  const N = 40;
  let wins = 0;
  let lostWins = 0;
  for (let s = 1; s <= N; s++) {
    if (once(s).win) wins++;
    const lose = E.dungeonFight(
      ["padre", "mago", "cacador", "assassino"],
      100,
      {
        mode: "aleatorio",
        random: randomSource(new Rng(s)),
      },
    );
    if (lose.win) lostWins++;
  }
  assert.ok(wins / N >= 0.95, `vitórias da PT completa: ${wins}/${N}`);
  assert.ok(lostWins / N <= 0.05, `vitórias sem tanque: ${lostWins}/${N}`);
});

// ------------------------------------------------------------ com as 42 skills de verdade (Fase 4)

/**
 * As skills do spec compiladas (texto do §8, regras de tier, traços do §6 inteiros), com a Potência
 * esperada e a IA do gabarito no perfil (dano "Sempre"; cura e defesa com a IA do spec). Valem do T3
 * (L40) em diante; o T1/T2 tem as lacunas registradas abaixo (P41) e é calibrado na Fase 6.
 */
const SPEC = { source: "spec", referenceAi: "gabarito" } as const;
const SPEC_LEVELS = [40, 70, 100, 150, 200, 300, 400, 500];
// D42 (25/11/2026): o druida virou suporte de batalha (dano mágico em área, dano que cura, buff de
// poder no grupo): com ele o chefe cai um pouco antes, ele bate 36–44% do mago (o padre 18–30%) e
// soma dano, então o "sem DPS" do spec leva dois padres.
const hasDruid = (c: ClassId[]) => c.includes("druida");
const MUST_LOSE_SPEC: [string, ClassId[]][] = MUST_LOSE.map(([label, c]) =>
  label === "sem DPS"
    ? [label, ["guerreiro", "padre", "paladino", "padre"]]
    : [label, c],
);

test("skills do spec — §14.1: T/H/D/D vence em 75–100 s sem mortes; trios vencem sem mortes", () => {
  for (const L of SPEC_LEVELS) {
    for (const comp of FULL) {
      const r = E.dungeonFight(comp, L, SPEC);
      assert.ok(r.win && r.deaths === 0, `${name(comp)} L${L}`);
      assert.ok(
        r.seconds >= (hasDruid(comp) ? 65 : 75) && r.seconds <= 100,
        `${name(comp)} L${L}: ${r.seconds} s`,
      );
    }
    for (const comp of TRIOS) {
      const r = E.dungeonFight(comp, L, SPEC);
      assert.ok(
        r.win && r.deaths === 0 && r.seconds <= 120,
        `${name(comp)} L${L}: ${r.seconds} s`,
      );
    }
  }
});

test("skills do spec — §14.1: sem tanque, sem suporte, sem DPS e só DPS perdem", () => {
  for (const L of SPEC_LEVELS)
    for (const [label, comp] of MUST_LOSE_SPEC)
      assert.ok(!E.dungeonFight(comp, L, SPEC).win, `${label} L${L}`);
});

test("skills do spec — §14.2 e §14.8", () => {
  const comp: ClassId[] = ["guerreiro", "mago", "cacador", "assassino"];
  const at = (m: number, x: number) =>
    E.dungeonFight(comp, m, SPEC, [m + x, m + x, m + x, m + x]).win;
  assert.ok(!at(40, 0) && at(40, 10) && !at(100, 0) && at(100, 10));
  assert.ok(!at(300, 0) && !at(300, 10) && at(300, 20));
  for (const L of [40, 70, 100])
    assert.ok(
      E.dungeonFight(["guerreiro", "padre", "mago", "cacador"], L, {
        ...SPEC,
        proficiency: () => 1,
      }).win,
    );
});

test("skills do spec — §14.3: DPS a ±20%, tanques 20–45% e suportes 15–40% do mago", () => {
  for (const L of [40, 100, 300, 500]) {
    const v = Object.fromEntries(
      CLASS_IDS.map((c) => [c, E.soloDps(c, L, 90, SPEC)]),
    ) as Record<ClassId, number>;
    const dps = [v.mago, v.cacador, v.assassino];
    assert.ok(Math.max(...dps) / Math.min(...dps) <= 1.25, `L${L}`);
    for (const c of ["guerreiro", "paladino"] as const)
      assert.ok(v[c] / v.mago >= 0.2 && v[c] / v.mago <= 0.45, `L${L} ${c}`);
    assert.ok(
      v.padre / v.mago >= 0.15 && v.padre / v.mago <= 0.4,
      `L${L} padre`,
    );
    // D42: o druida de batalha bate mais que o padre, mas longe do DPS (não faz o papel dele).
    assert.ok(
      v.druida / v.mago >= 0.3 && v.druida / v.mago <= 0.5,
      `L${L} druida`,
    );
  }
});

test("skills do spec — §14.4: solo em todo nível do 20 ao 500", () => {
  const solo = { ...SPEC, solo: true };
  for (let L = 20; L <= 500; L++)
    for (const cls of CLASS_IDS) {
      const r = E.huntFight(cls, L, solo);
      assert.ok(r.win && r.seconds <= 120, `${cls} L${L}`);
    }
});

test.todo(
  "P41 (resto): no T1/T2 o padre bate como DPS (70–80% do mago) — as Masmorras antes do L40 saíram (D19); falta o dono dizer se o §14.3 vale antes do T3",
);
