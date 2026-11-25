// A jornada de um jogador do L1 ao L100 (P81): corridas até cada nível contra a tabela do spec, quanto o
// equipamento fica atrás do nível, refino, ouro em poção e onde empaca.
//   node scripts/balance-journey.ts [solo|grupo] [dojo|nenhuma] [até]
import { CLASS_IDS } from "../src/game/ot/balance/content.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { simulateJourney } from "../src/game/ot/balance/sim/journey.ts";

const mode = (process.argv[2] ?? "solo") as "solo" | "grupo";
const proficiency = (process.argv[3] ?? "dojo") as "dojo" | "nenhuma";
const to = Number(process.argv[4] ?? 100);

console.log(`Jornada ${mode}, Proficiência ${proficiency}, até o L${to}`);
console.log(
  "(corridas acumuladas até o nível; entre parênteses a tabela do §17; lag = iL médio vestido − nível; rf = refino médio)",
);
for (const cls of CLASS_IDS) {
  const t0 = Date.now();
  const r = simulateJourney(cls, { mode, proficiency, to });
  const marks = r.marks
    .map(
      (m) =>
        `L${m.level} ${m.runs} (${Math.round(B.runsTo(m.level))}) lag ${m.gearLag} rf ${m.refine}`,
    )
    .join(" · ");
  console.log(
    `${cls}: chegou ao L${r.reached} em ${r.runs} corridas, ${r.losses} derrotas${r.stuckAt ? `, EMPACOU no L${r.stuckAt}` : ""}; poção ${(r.potionShare * 100).toFixed(0)}% do ouro (${((Date.now() - t0) / 1000).toFixed(0)} s)\n  ${marks}`,
  );
}
