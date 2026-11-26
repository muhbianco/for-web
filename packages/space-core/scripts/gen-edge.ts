// O aperto de cada DG (D41, 25/11/2026, pedido do dono: "as dgs precisam exigir o limite de cada
// herói, equipamentos, skills e status"). Duas travas, para cada composição ficar no limite dela num
// eixo (o dono: "não estou pedindo que isso seja engessado"):
// 1. golpe: a busca binária do maior multiplicador (sobre todo monstro da DG) que cada grupo de
//    calibração no perfil do limite ainda vence no modo esperado, sem Cataclismo; vale o do grupo
//    mais frágil, menos `limit.edgeMargin`;
// 2. tempo (Masmorra e Região): com esse golpe, o tempo de cada grupo na sala do chefe; o Cataclismo
//    vem `limit.timeMargin` depois do mais lento. Na Caçada o Cataclismo fica o do config (o tanque e
//    o suporte precisam caçar sozinhos; no tempo do mago, nenhum dos dois venceria).
//
// Grupos de calibração:
// - Masmorra e Região: tanque + cura + 3 de dano; tanque + 2 curas + 2 de dano; 2 tanques + cura + 2
//   de dano (todos de 5);
// - Caçada: cada classe de dano sozinha.
//
// Rodar (no space-core), depois de mexer em fórmula, skill ou config:
//   node scripts/gen-monsters.ts && node scripts/gen-edge.ts --write
// Sem --write, só mostra os pontos. Com --fresh, calcula os monstros na hora (sem a tabela gerada).
import { writeFileSync } from "node:fs";

import { randomSource } from "../src/game/ot/balance/combat/fight.ts";
import type { ClassId } from "../src/game/ot/balance/content.ts";
import {
  type DungeonDef,
  DUNGEONS,
} from "../src/game/ot/balance/dungeons/catalog.ts";
import {
  type DungeonEdge,
  DUNGEON_EDGE,
} from "../src/game/ot/balance/dungeons/edge.generated.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import {
  LIMIT_GROUP_PARTIES,
  LIMIT_HUNT_GROUPS,
  LIMIT_HUNT_SOLO,
  limitFighter,
} from "../src/game/ot/balance/sim/calibration.ts";
import { Rng } from "../src/game/rng.ts";

const WRITE = process.argv.includes("--write");
const FRESH = process.argv.includes("--fresh");
const M = createMonsters(B, FRESH ? null : undefined);
const NO_TIMER = 1e9;

const GROUP_PARTIES = LIMIT_GROUP_PARTIES as ClassId[][];
const HUNT_PARTIES = LIMIT_HUNT_SOLO as ClassId[][];
const HUNT_GROUPS = LIMIT_HUNT_GROUPS as Record<number, ClassId[][]>;

function limitHero(cls: ClassId, L: number, solo: boolean) {
  return limitFighter(cls, L, { solo }, B);
}

function runWith(d: DungeonDef, comp: ClassId[], edge: DungeonEdge) {
  DUNGEON_EDGE[d.id] = edge;
  const party = comp.map((c) => limitHero(c, d.level, comp.length === 1));
  return simulateRun(d, party, { mode: "esperado" }, B, M);
}

const { mcRuns, mcSafety } = B.cfg.limit;
const winTarget = B.cfg.limit.winTarget + mcSafety;
/** Fração de vitórias em `mcRuns` corridas no modo aleatório (sementes fixas por DG). */
function winRate(d: DungeonDef, comp: ClassId[], edge: DungeonEdge): number {
  DUNGEON_EDGE[d.id] = edge;
  const party = comp.map((c) => limitHero(c, d.level, comp.length === 1));
  let w = 0;
  for (let i = 0; i < mcRuns; i++) {
    const random = randomSource(new Rng(17 + 7919 * i + 31 * d.level));
    if (
      simulateRun(d, party, { mode: "aleatorio", random }, B, M).outcome ===
      "vitoria"
    )
      w++;
  }
  return w / mcRuns;
}

/**
 * O golpe da primeira derrota do grupo, subindo em passos de `STEP` (modo esperado, sem Cataclismo).
 * Varredura e não busca binária: perto do limite a vitória vai e volta (a IA de cura e de poção muda
 * de decisão), e a busca binária caía numa ilha de vitória acima de uma derrota (medido em 25/11/2026).
 */
const STEP = 0.025;
function hitEdge(d: DungeonDef, comp: ClassId[]): number {
  const timer = d.kind === "cacada" ? {} : { cataclysmAt: NO_TIMER };
  const wins = (k: number) =>
    runWith(d, comp, { hit: k, ...timer }).outcome === "vitoria";
  let k = 0.3;
  if (!wins(k)) return k;
  while (k < 6 && wins(k + STEP)) k += STEP;
  return k + STEP;
}

const { edgeMargin, timeMargin } = B.cfg.limit;
const out: Record<string, DungeonEdge> = {};
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const short = (c: ClassId[]) => c.map((x) => x.slice(0, 3)).join("+");
for (const d of DUNGEONS) {
  if (B.cfg.limit.exempt.includes(d.id)) {
    delete DUNGEON_EDGE[d.id];
    console.log(`${d.id.padEnd(14)} fora do aperto (limit.exempt)`);
    continue;
  }
  const parties = d.kind === "cacada" ? HUNT_PARTIES : GROUP_PARTIES;
  const ks = parties.map((p) => hitEdge(d, p));
  const timerOff = d.kind === "cacada" ? {} : { cataclysmAt: NO_TIMER };
  /**
   * O golpe gravado: o ponto do mais frágil menos a margem, descendo até todos vencerem nele no modo
   * esperado e `winTarget` das corridas no aleatório ("vence 9 em 10", decisão do dono).
   */
  const settle = (
    group: ClassId[][],
    k: number,
    extra: Partial<DungeonEdge> = {},
  ) => {
    let h = r3(k * (1 - edgeMargin));
    const ok = (e: DungeonEdge) =>
      group.every((p) => runWith(d, p, e).outcome === "vitoria") &&
      group.every((p) => winRate(d, p, e) >= winTarget);
    for (let i = 0; i < 40 && h > STEP; i++) {
      if (ok({ hit: h, ...timerOff, ...extra })) break;
      h = r3(h - STEP);
    }
    return h;
  };
  const hit = settle(parties, Math.min(...ks));
  const edge: DungeonEdge = { hit };
  if (d.kind === "cacada") {
    const party: Record<number, number> = {};
    for (const [n, group] of Object.entries(HUNT_GROUPS)) {
      // O golpe do solo fica no hit; o do grupo sobe sozinho (party[n]) até o mais frágil dele cair.
      const kn = Math.min(...group.map((p) => hitEdge(d, p)));
      party[Number(n)] = settle(group, kn, {});
    }
    edge.party = party;
  }
  let times: number[] = [];
  if (d.kind !== "cacada") {
    times = parties.map((p) => {
      const r = runWith(d, p, { hit, cataclysmAt: NO_TIMER });
      return r.outcome === "vitoria" ? (r.rooms[3]?.seconds ?? 0) : NaN;
    });
    edge.cataclysmAt = Math.ceil(
      Math.max(...times.filter(Number.isFinite)) * (1 + timeMargin),
    );
    // No aleatório o grupo lento às vezes chega no Cataclismo: empurra até todos vencerem `winTarget`.
    for (let i = 0; i < 12; i++) {
      if (parties.every((p) => winRate(d, p, edge) >= winTarget)) break;
      edge.cataclysmAt = Math.ceil(edge.cataclysmAt * 1.05);
    }
  }
  out[d.id] = edge;
  // Conferência: cada grupo no limite vence com as duas travas.
  const check = parties.map((p) =>
    runWith(d, p, edge).outcome === "vitoria" ? "" : "✗",
  );
  console.log(
    `${d.id.padEnd(14)} golpe ${ks.map((x, i) => `${short(parties[i]!)} ${x.toFixed(2)}${check[i]}`).join("  ")}  → ${hit}` +
      (times.length
        ? `  chefe ${times.map((t) => `${Math.round(t)}s`).join(" ")} → Cataclismo ${edge.cataclysmAt}s`
        : ""),
  );
}

if (WRITE) {
  const body = Object.entries(out)
    .map(
      ([id, v]) =>
        `  ${JSON.stringify(id)}: ${JSON.stringify(v)
          .replace(/"(\w+)":/g, "$1: ")
          .replace(/,/g, ", ")},`,
    )
    .join("\n");
  writeFileSync(
    new URL(
      "../src/game/ot/balance/dungeons/edge.generated.ts",
      import.meta.url,
    ),
    `// GERADO por scripts/gen-edge.ts — não editar à mão.

/** D41: o aperto de uma DG. */
export interface DungeonEdge {
  /** Multiplicador do golpe de todo monstro dela (lacaio, elite, chefe, pulso e invocados). */
  hit: number;
  /** Segundo do Cataclismo do chefe (Masmorra e Região); sem ele, o do config. */
  cataclysmAt?: number;
  /** Caçada em dupla e em trio: o golpe de cada tamanho de grupo (sem a entrada, vale o \`hit\`). */
  party?: Record<number, number>;
}

/**
 * O golpe é o maior que o grupo de calibração mais frágil no perfil do limite ainda vence no modo
 * esperado, menos \`limit.edgeMargin\`; o Cataclismo vem \`limit.timeMargin\` depois do grupo mais
 * lento na sala do chefe. DG sem entrada fica com os números do config.
 */
export const DUNGEON_EDGE: Record<string, DungeonEdge> = {
${body}
};
`,
  );
  console.log(
    `gravado: ${Object.keys(out).length} DGs (margem de golpe ${edgeMargin}, de tempo ${timeMargin})`,
  );
}
