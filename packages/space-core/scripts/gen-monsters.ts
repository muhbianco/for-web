// Gera a tabela de monstros do rebalanceamento do Idle Hunt (spec §0.4): o DPS de referência e os
// golpes por nível, das mesmas fórmulas de jogador. Rodar depois de mexer em fórmula, skill ou config:
//   node scripts/gen-monsters.ts
// e conferir o diff de src/game/ot/balance/monsters/table.generated.ts no commit.
import { writeFileSync } from "node:fs";

import { BALANCE } from "../src/game/ot/balance/config.ts";
import { computeMonsterRow } from "../src/game/ot/balance/monsters/generate.ts";

const rows: string[] = [];
const r6 = (v: number) => Number(v.toPrecision(10));
for (let L = 1; L <= BALANCE.levels.maxLevel; L++) {
  const r = computeMonsterRow(L);
  rows.push(
    `  [${L}, ${r6(r.soloDps)}, ${r6(r.partyDps)}, ${r6(r.lacaioHit)}, ${r6(r.menorHit)}, ${r6(r.bossHit)}, ${r6(r.pulse)}],`,
  );
}
const out = `// GERADO por scripts/gen-monsters.ts — não editar à mão.
import type { MonsterRow } from "./generate.ts";

/** [nível, DPS solo de referência, DPS de grupo de referência, golpe lacaio, golpe chefe menor, golpe chefe, pulso] */
const RAW: ReadonlyArray<readonly [number, number, number, number, number, number, number]> = [
${rows.join("\n")}
];

/** Índice = nível (o 0 fica vazio). */
export const MONSTER_TABLE: readonly MonsterRow[] = (() => {
  const t: MonsterRow[] = [];
  for (const [L, soloDps, partyDps, lacaioHit, menorHit, bossHit, pulse] of RAW)
    t[L] = { soloDps, partyDps, lacaioHit, menorHit, bossHit, pulse };
  return t;
})();
`;
writeFileSync(
  new URL(
    "../src/game/ot/balance/monsters/table.generated.ts",
    import.meta.url,
  ),
  out,
);
console.log(`tabela gerada: ${BALANCE.levels.maxLevel} níveis`);
