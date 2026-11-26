// Laboratório de recarga × duração da corrida (D52, 26/11/2026, pedido do dono: "tem habilidade com
// CD MUITO alto, tá desproporcional com os tempos da corrida"). Para cada DG da amostra, roda a corrida
// inteira no modo esperado com os heróis do limite e imprime: duração da corrida e das salas, e por
// skill a recarga (com os cortes fixos) e quantas vezes ela saiu na corrida.
//
// Rodar (no space-core): node scripts/cd-lab.ts [--levels 20,40,70,100,200,350] [--json saida.json]
import { writeFileSync } from "node:fs";
import { DUNGEONS } from "../src/game/ot/balance/dungeons/catalog.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import {
  LIMIT_GROUP_PARTIES,
  limitFighter,
} from "../src/game/ot/balance/sim/calibration.ts";
import { SKILLS_BY_CLASS } from "../src/game/ot/balance/skills/index.ts";
import type { ClassId } from "../src/game/ot/balance/content.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : def;
};
const LEVELS = opt("levels", "20,40,70,100,200,350").split(",").map(Number);
const CLASSES = Object.keys(SKILLS_BY_CLASS) as ClassId[];

interface Row {
  dg: string;
  party: string;
  outcome: string;
  seconds: number;
  rooms: number[];
  casts: Record<string, number>;
  cds: Record<string, number>;
}
const rows: Row[] = [];

function run(dgId: string, party: ClassId[], solo: boolean) {
  const d = DUNGEONS.find((x) => x.id === dgId)!;
  const fighters = party.map((c) => limitFighter(c, d.level, { solo }, B));
  const r = simulateRun(d, fighters, { mode: "esperado" }, B);
  const casts: Record<string, number> = {};
  const cds: Record<string, number> = {};
  fighters.forEach((f, i) => {
    for (const s of f.skills) cds[`${party[i]}:${s.id}`] = s.cooldownMs;
  });
  for (const room of r.rooms)
    room.heroes.forEach((h, i) => {
      for (const [id, n] of Object.entries(h.casts))
        casts[`${party[i]}:${id}`] = (casts[`${party[i]}:${id}`] ?? 0) + n;
    });
  rows.push({
    dg: dgId,
    party: party.join("+"),
    outcome: r.outcome,
    seconds: r.seconds,
    rooms: r.rooms.map((x) => Math.round(x.seconds)),
    casts,
    cds,
  });
}

for (const L of LEVELS) {
  const hunt = DUNGEONS.find((d) => d.kind === "cacada" && d.level >= L);
  if (hunt) for (const c of CLASSES) run(hunt.id, [c], true);
  const group = DUNGEONS.find((d) => d.kind !== "cacada" && d.level >= L);
  if (group) for (const p of LIMIT_GROUP_PARTIES) run(group.id, [...p], false);
}

for (const r of rows) {
  console.log(
    `${r.dg.padEnd(14)} ${r.party.padEnd(40)} ${r.outcome.padEnd(8)} ${String(r.seconds).padStart(6)} s  salas ${r.rooms.join("/")}`,
  );
  for (const [k, cd] of Object.entries(r.cds)) {
    const n = r.casts[k] ?? 0;
    console.log(
      `    ${k.padEnd(34)} recarga ${(cd / 1000).toFixed(1).padStart(6)} s  saiu ${String(n).padStart(3)}×  (corrida/recarga ${(r.seconds / (cd / 1000)).toFixed(1)})`,
    );
  }
}
const json = opt("json", "");
if (json) writeFileSync(json, JSON.stringify(rows, null, 1));
