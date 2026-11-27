/* global console, process */
// O peso da mana por classe (27/11/2026): poções de mana por corrida dos grupos de calibração.
//
//   node scripts/mana-pressure.ts [--levels 90,190,290,490] [--cost-scale 1.3]
//
// Cada grupo do limite (LIMIT_GROUP_PARTIES) e cada trio do farm abaixo do limite (FARM_TRIOS) joga a
// Masmorra dos níveis dados no modo esperado, com estoques separados de vida e de mana (sobra de 500
// de cada: o que mede é o consumo, não a falta). Imprime a média de poções de mana por corrida de
// cada classe. Serve para recalibrar o custo das skills quando a mana muda de fonte (a D44 mediu ~
// guerreiro 9, paladino 3, caçador 17, assassino 20, mago 2, padre 19): a mana tem de continuar
// sendo um problema.
import type { FighterInput } from "../src/game/ot/balance/combat/types.ts";
import type { ClassId } from "../src/game/ot/balance/content.ts";
import { DUNGEONS } from "../src/game/ot/balance/dungeons/catalog.ts";
import { BALANCE } from "../src/game/ot/balance/config.ts";
import { createBalance } from "../src/game/ot/balance/formulas.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import {
  FARM_TRIOS,
  LIMIT_GROUP_PARTIES,
  belowLimitFighter,
  limitFighter,
} from "../src/game/ot/balance/sim/calibration.ts";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const LEVELS = arg("levels", "90,190,290,490").split(",").map(Number);
const STOCK = 500;
// --cost-scale: a escala do custo das skills (cfg.mana.costScale) para testar sem mexer no config.
const scale = arg("cost-scale", "");
const B = createBalance(
  scale ? { ...BALANCE, mana: { ...BALANCE.mana, costScale: Number(scale) } } : BALANCE,
);
const M = createMonsters(B);

const withStocks = (f: FighterInput): FighterInput => ({
  ...f,
  potions: { ...f.potions, hpStock: STOCK, mpStock: STOCK },
});

for (const [label, parties, make] of [
  ["limite (5)", LIMIT_GROUP_PARTIES, limitFighter],
  ["farm (abaixo do limite)", FARM_TRIOS, belowLimitFighter],
] as const) {
  const sum: Partial<Record<ClassId, { mp: number; hp: number; n: number }>> = {};
  let runs = 0;
  let wins = 0;
  for (const L of LEVELS) {
    const dg = DUNGEONS.find((d) => d.kind === "masmorra" && d.level === L);
    if (!dg) continue;
    for (const p of parties) {
      const fighters = p.map((c) => withStocks(make(c, L, {}, B)));
      const r = simulateRun(dg, fighters, { mode: "esperado" }, B, M);
      runs++;
      if (r.outcome === "vitoria") wins++;
      r.heroes.forEach((h, i) => {
        const c = p[i]!;
        const s = (sum[c] ??= { mp: 0, hp: 0, n: 0 });
        s.mp += STOCK - (h.mpPots ?? STOCK);
        s.hp += STOCK - (h.hpPots ?? STOCK);
        s.n++;
      });
    }
  }
  console.log(`${label}: ${wins}/${runs} vitórias nas Masmorras ${LEVELS.join(", ")}`);
  for (const [c, s] of Object.entries(sum))
    console.log(
      `  ${c.padEnd(10)} mana ${(s.mp / s.n).toFixed(1).padStart(5)} · vida ${(s.hp / s.n).toFixed(1).padStart(5)} poções por corrida`,
    );
}
