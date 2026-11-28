/* global console, process */
// D66 (27/11/2026): o kit de referência do Cruzado (paladino T4) no relatório do CI inteiro. Cada
// variante troca o REFERENCE_KITS_T4.paladino e roda o balanceReport; imprime o placar e as linhas com
// paladino.
//
//   node scripts/kit-report.ts [--mc 200]
import { balanceReport } from "../src/game/ot/balance/sim/report.ts";
import { REFERENCE_KITS_T4 } from "../src/game/ot/balance/skills/index.ts";

const i = process.argv.indexOf("--mc");
const mcRuns = i > 0 ? Number(process.argv[i + 1]) : 200;
const VARIANTS: [string, string[]][] = [
  ["devoção no lugar da Égide", ["golpe-sagrado", "consagracao", "escudo-da-fe", "intervencao-divina"]],
  ["kit antigo (Égide, sem Devoção)", ["golpe-sagrado", "consagracao", "escudo-da-fe", "bencao-da-egide"]],
];
for (const [name, kit] of VARIANTS) {
  REFERENCE_KITS_T4.paladino = kit;
  const lines = balanceReport({ mcRuns });
  const n = (s: string) => lines.filter((l) => l.status === s).length;
  console.log(`\n## ${name}: ${n("ok")} ok · ${n("falha")} falha · ${n("aceita")} aceita`);
  for (const l of lines)
    if (/pal\b|pal\+|\+pal|paladino/.test(`${l.label} ${l.detail}`) || l.status === "falha")
      console.log(`  [${l.status}] ${l.label}: ${l.detail}`);
}
process.exit(0);
