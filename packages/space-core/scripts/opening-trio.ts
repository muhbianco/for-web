/* global console, process */
// O trio das corridas reais de 26/11/2026 (mago 56, druida 54, guerreiro 51 na Caçada 51; o mago
// criou o grupo e morreu sozinho em 3 vitórias): o mesmo trio, heróis abaixo do limite, com o mago e
// com o guerreiro na frente, mostrando os 3 primeiros segundos de cada sala (golpe ≥ 10% da vida
// máxima do alvo e quedas). Ver scripts/opening-aggro.ts.
//
//   node scripts/opening-trio.ts [dg] [mago,druida,guerreiro] [56,54,51]
import type { ClassId } from "../src/game/ot/balance/content.ts";
import { FOE_BASE } from "../src/game/ot/balance/combat/types.ts";
import { randomSource } from "../src/game/ot/balance/combat/fight.ts";
import { Rng } from "../src/game/rng.ts";
import { dungeonById } from "../src/game/ot/balance/dungeons/catalog.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import { belowLimitFighter } from "../src/game/ot/balance/sim/calibration.ts";

const [dgId = "cacada-51", clsArg = "mago,druida,guerreiro", lvArg = "56,54,51"] = process.argv.slice(2);
const D = dungeonById(dgId)!;
const CLS = clsArg.split(",") as ClassId[];
const LV = lvArg.split(",").map(Number);
const M = createMonsters(B);

function show(order: number[]) {
  const names = order.map((i) => `${CLS[i]}${LV[i]}`);
  const party = order.map((i) => belowLimitFighter(CLS[i]!, LV[i]!, {}, B));
  const maxHp = party.map((f) => f.stats.hp);
  const r = simulateRun(D, party, { mode: "esperado", record: true }, B, M);
  console.log(`\n=== ${D.id}, na frente: ${names[0]} → ${r.outcome}, mortos: ${r.heroes.map((h, j) => (h.alive ? null : names[j])).filter(Boolean).join(", ") || "nenhum"}`);
  const start = new Map<number, number>();
  for (const f of r.frames ?? []) {
    if (!start.has(f.st)) start.set(f.st, f.s);
    const rel = f.s - start.get(f.st)! + 1;
    if (rel > 3) continue;
    const notes: string[] = [];
    const sum = new Map<number, number>();
    let hits = 0;
    for (const e of f.e) {
      if ((e.k === "golpe" || e.k === "magia") && e.b < FOE_BASE && e.a >= FOE_BASE && !("cura" in e && e.cura)) {
        sum.set(e.b, (sum.get(e.b) ?? 0) + e.v);
        if (e.b === 0) hits++;
      }
      if (e.k === "queda" && e.b < FOE_BASE) notes.push(`✖ cai ${names[e.b]}`);
      if (e.k === "mecanica" && e.s === "provocar") notes.push(`provocação`);
    }
    for (const [b, v] of sum) if (v / maxHp[b]! >= 0.1) notes.unshift(`${names[b]} leva ${Math.round((100 * v) / maxHp[b]!)}%${b === 0 ? ` (${hits} golpes)` : ""}`);
    const life = f.h.map((h, j) => `${Math.round((100 * Math.max(0, h)) / maxHp[j]!)}%`).join(" ");
    console.log(`  sala ${f.st + 1} ${rel} s | ${notes.join(" | ") || "—"} | vida ${life}`);
  }
}
/** Com as rolagens de verdade (como o servidor): quantas vezes o mago morre, e quantas na largada. */
function mc(order: number[], n = 400) {
  const names = order.map((i) => `${CLS[i]}${LV[i]}`);
  const mage = order.findIndex((i) => CLS[i] === "mago");
  const party = order.map((i) => belowLimitFighter(CLS[i]!, LV[i]!, {}, B));
  let wins = 0, dead = 0, opening = 0, onlyMage = 0;
  for (let seed = 1; seed <= n; seed++) {
    const r = simulateRun(D, party, { mode: "aleatorio", random: randomSource(new Rng(seed * 7919)), record: true }, B, M);
    if (r.outcome === "vitoria") wins++;
    if (mage >= 0 && !r.heroes[mage]!.alive) {
      dead++;
      if (r.outcome === "vitoria" && r.heroes.every((h, j) => j === mage || h.alive)) onlyMage++;
      const start = new Map<number, number>();
      for (const f of r.frames ?? []) {
        if (!start.has(f.st)) start.set(f.st, f.s);
        if (f.e.some((e) => e.k === "queda" && e.b === mage)) {
          if (f.s - start.get(f.st)! + 1 <= 2) opening++;
          break;
        }
      }
    }
  }
  console.log(`  ${names.join(", ")}: vence ${wins}/${n} · mago morre ${dead} (${opening} nos 2 primeiros s de uma sala; ${onlyMage} vitórias com só ele morto)`);
}
show([0, 1, 2]);
show([2, 1, 0]);
console.log(`\n=== Rolagens de verdade (${D.id})`);
mc([0, 1, 2]);
mc([2, 1, 0]);
process.exit(0);
