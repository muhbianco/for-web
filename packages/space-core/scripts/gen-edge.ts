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
// Grupos de calibração (D53, 26/11/2026):
// - Masmorra (farm): o trio tanque + cura + dano ABAIXO do limite vence a do próprio nível ~9 em 10;
// - Região (o chefe de cada 50 níveis, até o do 500): 4 heróis no limite perfeito — tanque, tanque,
//   cura, dano; tanque, cura, cura, dano; tanque, cura, dano, dano — vencem, apertado;
// - Caçada: cada classe de dano sozinha (D53: o herói 10 níveis acima, e ~50% no próprio nível) e a
//   dupla e o trio no próprio nível.
//
// Rodar (no space-core), depois de mexer em fórmula, skill ou config:
//   node scripts/gen-monsters.ts && node scripts/gen-edge.ts --write
// Sem --write, só mostra os pontos. Com --fresh, calcula os monstros na hora (sem a tabela gerada).
// Com --only masmorra,regiao, só esses tipos são recalculados; os outros ficam como estão gravados
// (D47: as Caçadas 40–90 não se regeram sem rever a jornada do mago solo).
// D53 (26/11/2026, pedido do dono: "o jogo é difícil e precisa de grupo; farmar sozinho exige DG de
// nível mais baixo"): o golpe solo de cada Caçada (`hit`) é o menor entre (a) o maior que o herói
// sozinho no limite 10 níveis ACIMA dela vence em `winTarget` das corridas (farmar 10 abaixo é
// seguro) e (b) o que deixa o herói sozinho do próprio nível vencendo ~50% (média dos três de dano;
// o dono: "50% só para não ficar tão apertado"). A dupla e o trio (`party`) seguem no próprio nível.
// Substitui o ajuste à mão das Caçadas 51–90 da D51; a jornada solo farma 10 abaixo
// (`node scripts/balance-journey.ts solo dojo 100`).
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
  FARM_TRIOS,
  LIMIT_HUNT_GROUPS,
  LIMIT_HUNT_SOLO,
  REGION_PARTIES,
  belowLimitFighter,
  limitFighter,
} from "../src/game/ot/balance/sim/calibration.ts";
import { Rng } from "../src/game/rng.ts";

const WRITE = process.argv.includes("--write");
const FRESH = process.argv.includes("--fresh");
const onlyArg = process.argv.indexOf("--only");
const ONLY =
  onlyArg >= 0 ? new Set(process.argv[onlyArg + 1]!.split(",")) : null;
/**
 * Com --hunt-parties 4,5, só o golpe desses tamanhos de grupo nas Caçadas com aperto (27/11/2026: a
 * Caçada abriu para 5); o resto de cada DG fica como está gravado (D47).
 */
const huntArg = process.argv.indexOf("--hunt-parties");
const HUNT_SIZES =
  huntArg >= 0 ? process.argv[huntArg + 1]!.split(",").map(Number) : null;
const M = createMonsters(B, FRESH ? null : undefined);
const NO_TIMER = 1e9;

const MASMORRA_PARTIES = FARM_TRIOS as ClassId[][];
const REGIAO_PARTIES = REGION_PARTIES as ClassId[][];
const HUNT_PARTIES = LIMIT_HUNT_SOLO as ClassId[][];
const HUNT_GROUPS = LIMIT_HUNT_GROUPS as Record<number, ClassId[][]>;

function limitHero(cls: ClassId, L: number, solo: boolean) {
  return limitFighter(cls, L, { solo }, B);
}
/** D53: a Masmorra é calibrada pelo herói abaixo do limite (o farm); o resto, pelo do limite. */
function heroFor(d: DungeonDef, cls: ClassId, L: number, solo: boolean) {
  return d.kind === "masmorra"
    ? belowLimitFighter(cls, L, { solo }, B)
    : limitHero(cls, L, solo);
}

/** O herói solo da Caçada que farma: este tanto acima dela (D53). */
const FARM_ABOVE = 10;
/** A vitória do herói solo do próprio nível que o golpe busca (D53). */
const SOLO_OWN_WIN = 0.5;

function runWith(
  d: DungeonDef,
  comp: ClassId[],
  edge: DungeonEdge,
  level = d.level,
) {
  DUNGEON_EDGE[d.id] = edge;
  const party = comp.map((c) => heroFor(d, c, level, comp.length === 1));
  return simulateRun(d, party, { mode: "esperado" }, B, M);
}

const { mcRuns, mcSafety } = B.cfg.limit;
const winTarget = B.cfg.limit.winTarget + mcSafety;
/** Fração de vitórias em `mcRuns` corridas no modo aleatório (sementes fixas por DG). */
function winRate(
  d: DungeonDef,
  comp: ClassId[],
  edge: DungeonEdge,
  level = d.level,
): number {
  DUNGEON_EDGE[d.id] = edge;
  const party = comp.map((c) => heroFor(d, c, level, comp.length === 1));
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
/** O teto da varredura: o grupo de 5 da Caçada passa de ×6 (27/11/2026; com 6, o golpe dele parava no teto). */
const MAX_HIT = 12;
function hitEdge(d: DungeonDef, comp: ClassId[], level = d.level): number {
  const timer = d.kind === "cacada" ? {} : { cataclysmAt: NO_TIMER };
  const wins = (k: number) =>
    runWith(d, comp, { hit: k, ...timer }, level).outcome === "vitoria";
  let k = 0.3;
  if (!wins(k)) return k;
  while (k < MAX_HIT && wins(k + STEP)) k += STEP;
  return k + STEP;
}

const { edgeMargin, timeMargin } = B.cfg.limit;
const out: Record<string, DungeonEdge> = {};
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const short = (c: ClassId[]) => c.map((x) => x.slice(0, 3)).join("+");
for (const d of DUNGEONS) {
  if ((ONLY && !ONLY.has(d.kind)) || (HUNT_SIZES && d.kind !== "cacada")) {
    if (DUNGEON_EDGE[d.id]) out[d.id] = DUNGEON_EDGE[d.id]!;
    continue;
  }
  if (d.kind === "cacada" && d.level <= B.cfg.limit.entryHuntsUpTo) {
    delete DUNGEON_EDGE[d.id];
    console.log(`${d.id.padEnd(14)} zona de entrada, fora do aperto`);
    continue;
  }
  const parties =
    d.kind === "cacada"
      ? HUNT_PARTIES
      : d.kind === "masmorra"
        ? MASMORRA_PARTIES
        : REGIAO_PARTIES;
  // Na Caçada o solo é medido no herói que farma (10 acima; D53); o grupo no próprio nível.
  const soloLevel = d.kind === "cacada" ? d.level + FARM_ABOVE : d.level;
  const timerOff = d.kind === "cacada" ? {} : { cataclysmAt: NO_TIMER };
  /**
   * O golpe gravado: o ponto do mais frágil menos a margem, descendo até todos vencerem nele no modo
   * esperado e `winTarget` das corridas no aleatório ("vence 9 em 10", decisão do dono).
   */
  const settle = (
    group: ClassId[][],
    k: number,
    extra: Partial<DungeonEdge> = {},
    level = d.level,
  ) => {
    const margin = d.kind === "regional" ? B.cfg.limit.regionEdgeMargin : edgeMargin;
    let h = r3(k * (1 - margin));
    const ok = (e: DungeonEdge) =>
      group.every((p) => runWith(d, p, e, level).outcome === "vitoria") &&
      group.every((p) => winRate(d, p, e, level) >= winTarget);
    for (let i = 0; i < 40 && h > STEP; i++) {
      if (ok({ hit: h, ...timerOff, ...extra })) break;
      h = r3(h - STEP);
    }
    return h;
  };
  if (HUNT_SIZES && d.kind === "cacada") {
    // Só os tamanhos pedidos, no Cataclismo gravado; o golpe solo, o tempo e os outros tamanhos ficam.
    const stored = DUNGEON_EDGE[d.id]!;
    const timer = stored.cataclysmAt ? { cataclysmAt: stored.cataclysmAt } : {};
    const party: Record<number, number> = { ...stored.party };
    const notes: string[] = [];
    for (const n of HUNT_SIZES) {
      const group = HUNT_GROUPS[n]!;
      const each = group.map((p) => hitEdge(d, p));
      party[n] = settle(group, Math.min(...each), timer);
      notes.push(`${n}: ${group.map((p, i) => `${short(p)} ${each[i]!.toFixed(2)}`).join("  ")} → ${party[n]}`);
    }
    out[d.id] = { ...stored, party };
    DUNGEON_EDGE[d.id] = out[d.id]!;
    const fail = Object.values(HUNT_GROUPS)
      .flat()
      .filter((p) => runWith(d, p, out[d.id]!).outcome !== "vitoria")
      .map(short);
    console.log(
      `${d.id.padEnd(14)} ${notes.join("  |  ")}  (2 ${party[2]}, 3 ${party[3]})${fail.length ? `  ✗ ${fail.join(" ")}` : ""}`,
    );
    continue;
  }
  const ks = parties.map((p) => hitEdge(d, p, soloLevel));
  let hit = settle(parties, Math.min(...ks), {}, soloLevel);
  let ownWin = NaN;
  if (d.kind === "cacada") {
    // (b) O golpe em que o herói solo do próprio nível vence ~50% (média dos três de dano), por busca
    // binária entre um golpe fácil e um impossível; vale o menor dos dois (o mais fácil).
    const own = (h: number) =>
      parties.reduce((a, p) => a + winRate(d, p, { hit: h }), 0) /
      parties.length;
    let lo = 0.3;
    let hi = Math.max(...ks) * 1.5;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (own(mid) > SOLO_OWN_WIN) lo = mid;
      else hi = mid;
    }
    hit = Math.min(hit, r3(lo));
    ownWin = own(hit);
  }
  const edge: DungeonEdge = { hit };
  if (d.kind === "cacada") {
    const party: Record<number, number> = {};
    for (const [n, group] of Object.entries(HUNT_GROUPS)) {
      // O golpe do solo fica no hit; o do grupo sobe sozinho (party[n]) até o mais frágil dele cair.
      const kn = Math.min(...group.map((p) => hitEdge(d, p)));
      party[Number(n)] = settle(group, kn, {});
    }
    edge.party = party;
    // D53: o tempo do chefe da Caçada sozinho — o da classe mais lenta das 7, sozinha no limite 10
    // acima, mais a margem; quem mata devagar abaixo do limite (tanque e suporte) esbarra nele.
    const ALL: ClassId[] = ["guerreiro", "paladino", "padre", "druida", "mago", "cacador", "assassino"];
    const soloTimes = ALL.map((c) => {
      const r = runWith(d, [c], { ...edge, cataclysmAt: NO_TIMER }, soloLevel);
      return r.outcome === "vitoria" ? (r.rooms.at(-1)?.seconds ?? 0) : NaN;
    }).filter(Number.isFinite);
    if (soloTimes.length > 0) {
      edge.cataclysmAt = Math.ceil(Math.max(...soloTimes) * (1 + timeMargin));
      for (let i = 0; i < 12; i++) {
        if (ALL.every((c) => winRate(d, [c], edge, soloLevel) >= winTarget)) break;
        edge.cataclysmAt = Math.ceil(edge.cataclysmAt * 1.05);
      }
    }
  }
  let times: number[] = [];
  if (d.kind !== "cacada") {
    times = parties.map((p) => {
      const r = runWith(d, p, { hit, cataclysmAt: NO_TIMER });
      return r.outcome === "vitoria" ? (r.rooms[3]?.seconds ?? 0) : NaN;
    });
    const tm =
      d.kind === "regional"
        ? B.cfg.limit.regionTimeMargin
        : d.kind === "masmorra"
          ? B.cfg.limit.farmTimeMargin
          : timeMargin;
    edge.cataclysmAt = Math.ceil(
      Math.max(...times.filter(Number.isFinite)) * (1 + tm),
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
    runWith(d, p, edge, soloLevel).outcome === "vitoria" ? "" : "✗",
  );
  console.log(
    `${d.id.padEnd(14)} golpe ${ks.map((x, i) => `${short(parties[i]!)} ${x.toFixed(2)}${check[i]}`).join("  ")}  → ${hit}` +
      (Number.isFinite(ownWin) ? `  solo no nível ${Math.round(ownWin * 100)}%` : "") +
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
  /** Segundo do Cataclismo do chefe (Masmorra, Região e, desde a D53, Caçada); sem ele, o do config. */
  cataclysmAt?: number;
  /** Caçada em grupo (2 a 5): o golpe de cada tamanho (sem a entrada, vale o \`hit\`). */
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
