/* global console, process */
// O que pesa na luta do chefe (28/11/2026, o dono: "atualmente o único golpe que tá importando é o golpe
// pesado… quero pensar em mais coisas desafiadoras na corrida contra o boss… vamo buffar o boss e medir
// pra ver como fica"). Compara cenários do chefe (D71) nos mesmos grupos que calibram o aperto de cada
// DG (sim/calibration.ts; o farm de Masmorra abaixo do limite, os 4 de Região no limite):
//   - folga: o maior múltiplo do golpe do aperto de hoje que o grupo ainda vence no modo esperado (passo
//     0,05; 1,00 = vence na beira de hoje, abaixo de 1 = perde no aperto de hoje);
//   - rolagem de verdade: vitórias em `--seeds` corridas no aperto de hoje;
//   - abaixo da referência (Região): o mesmo grupo com todos um degrau abaixo (raridade −1 e nível −5);
//   - na sala do chefe (modo esperado): o dano recebido por fonte e quem cai do quê.
// Cenários: hoje (antes da D71), dot (Pulso e DoT novos, a Invocação de antes), d71 (tudo), caça (d71
// com os invocados atrás dos não tanques, mas sem os heróis de dano trocarem de alvo) e, com --variants,
// cada variação em todo chefe (só-arcano, só-sanguinário, só-peçonhento).
//
//   node scripts/boss-pressure.ts [--seeds 20] [--workers N] [--scen hoje,dot,d71] [--variants]
//     [--dgs regiao-1,masmorra-110] [--out arquivo.json]
// Pesado: prioridade baixa e metade dos núcleos por padrão.
import { writeFileSync } from "node:fs";
import { availableParallelism, constants, setPriority } from "node:os";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

import { randomSource } from "../src/game/ot/balance/combat/fight.ts";
import type {
  BossVariant,
  FighterInput,
} from "../src/game/ot/balance/combat/types.ts";
import { FOE_BASE } from "../src/game/ot/balance/combat/types.ts";
import type { ClassId } from "../src/game/ot/balance/content.ts";
import {
  type DungeonDef,
  BOSS_VARIANTS,
  DUNGEONS,
  bossVariantOf,
  dungeonById,
  edgeOf,
} from "../src/game/ot/balance/dungeons/catalog.ts";
import { DUNGEON_EDGE } from "../src/game/ot/balance/dungeons/edge.generated.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import {
  FARM_TRIOS,
  REGION_PARTIES,
  belowLimitFighter,
  limitFighter,
} from "../src/game/ot/balance/sim/calibration.ts";
import { Rng } from "../src/game/rng.ts";

try {
  setPriority(constants.priority.PRIORITY_LOW);
} catch {
  // Sem permissão para baixar a prioridade: segue na normal.
}

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const SEEDS = Number(arg("seeds", "20"));

type Mech = typeof B.cfg.bossMechanics;
function deepMerge<T>(a: T, b: unknown): T {
  if (typeof b !== "object" || b === null || Array.isArray(b)) return b as T;
  const out = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
  return out as T;
}
const NEW: Mech = structuredClone(B.cfg.bossMechanics);
const LEGACY_SUMMON: Mech["summon"] = {
  everySeconds: 30,
  count: 2,
  countBySize: {},
  hpMult: 1,
  hunt: false,
  priority: false,
};

interface Scenario {
  id: string;
  label: string;
  mech: Partial<Mech>;
  /** Força a mesma variação em todo chefe. */
  only?: BossVariant;
}
const SCENARIOS: Scenario[] = [
  {
    id: "hoje",
    label: "hoje (antes da D71)",
    mech: { variants: false, summon: LEGACY_SUMMON },
  },
  {
    id: "dot",
    label: "Pulso e DoT novos, Invocação de antes",
    mech: { variants: true, summon: LEGACY_SUMMON },
  },
  {
    id: "d71",
    label: "D71 completo",
    mech: { variants: true, summon: NEW.summon },
  },
  {
    id: "caca",
    label: "D71, invocados caçam mas ninguém troca de alvo",
    mech: { variants: true, summon: { ...NEW.summon, priority: false } },
  },
  // --set JSON: um cenário à parte ("custom"), o config da D71 com estes campos por cima.
  ...(process.argv.includes("--set")
    ? [
        {
          id: "custom",
          label: `custom ${arg("set", "{}")}`,
          mech: deepMerge(structuredClone(NEW), JSON.parse(arg("set", "{}"))),
        },
      ]
    : []),
  ...BOSS_VARIANTS.map((v) => ({
    id: `so-${v}`,
    label: `D71 com todo chefe ${v}`,
    mech: { variants: true, summon: NEW.summon },
    only: v,
  })),
];

/** As Regiões 1–10 e as 4 Masmorras das regiões 2, 5, 8 e 10 (as três variações em cada uma). */
const DEFAULT_DGS = DUNGEONS.filter(
  (d) =>
    d.kind === "regional" ||
    (d.kind === "masmorra" && [2, 5, 8, 10].includes(d.region.index)),
).map((d) => d.id);

const STEPS = ["raridade", "nivel"] as const;

interface Job {
  scen: string;
  dg: string;
  comp: ClassId[];
  step?: (typeof STEPS)[number];
}
interface JobResult extends Job {
  variant: BossVariant | "—";
  win: boolean;
  firstDeath: string | null;
  slack: number | null;
  luck: number;
  /** Na sala do chefe (modo esperado): dano recebido por fonte, em vidas máximas, por classe. */
  taken: Record<string, Record<string, number>>;
  deaths: Record<string, number>;
  bossSeconds: number;
}

function applyScenario(id: string): void {
  const s = SCENARIOS.find((x) => x.id === id)!;
  Object.assign(
    B.cfg.bossMechanics,
    structuredClone(NEW),
    structuredClone(s.mech),
  );
  const order = s.only
    ? [s.only, s.only, s.only]
    : ["arcano", "sanguinario", "peconhento"];
  (BOSS_VARIANTS as BossVariant[]).splice(0, 3, ...(order as BossVariant[]));
}

const heroCache = new Map<string, FighterInput>();
function hero(d: DungeonDef, cls: ClassId, step?: Job["step"]): FighterInput {
  const key = `${d.kind}|${d.level}|${cls}|${step ?? ""}`;
  let f = heroCache.get(key);
  if (!f) {
    f =
      d.kind === "masmorra"
        ? belowLimitFighter(
            cls,
            step === "nivel" ? d.level - 5 : d.level,
            {},
            B,
          )
        : limitFighter(cls, d.level, step ? { step } : {}, B);
    heroCache.set(key, f);
  }
  return f;
}

function runJob(j: Job): JobResult {
  applyScenario(j.scen);
  const scen = SCENARIOS.find((x) => x.id === j.scen)!;
  const d = dungeonById(j.dg)!;
  const regionVariant = d.region.bossVariant;
  if (scen.only) d.region.bossVariant = scen.only;
  const M = createMonsters(B);
  const party = j.comp.map((c) => hero(d, c, j.step));
  const base = edgeOf(d);
  const runAt = (k: number, opts: Parameters<typeof simulateRun>[2]) => {
    if (base) DUNGEON_EDGE[d.id] = { ...base, hit: base.hit * k };
    try {
      return simulateRun(d, party, opts, B, M);
    } finally {
      if (base) DUNGEON_EDGE[d.id] = base;
    }
  };
  const rec = runAt(1, { mode: "esperado", record: true });
  // Folga: só para o grupo inteiro no perfil da calibração (sem degrau).
  let slack: number | null = null;
  if (!j.step && base) {
    const wins = (k: number) =>
      runAt(k, { mode: "esperado" }).outcome === "vitoria";
    let k = rec.outcome === "vitoria" ? 1 : 0.95;
    if (rec.outcome === "vitoria") {
      while (k < 2 && wins(k + 0.05)) k += 0.05;
    } else {
      while (k > 0.3 && !wins(k)) k -= 0.05;
    }
    slack = Math.round(k * 100) / 100;
  }
  let luck = 0;
  for (let i = 0; i < SEEDS; i++) {
    const random = randomSource(new Rng(17 + 7919 * i + 31 * d.level));
    if (runAt(1, { mode: "aleatorio", random }).outcome === "vitoria") luck++;
  }
  // Sala do chefe: dano recebido por fonte (por classe, em vidas máximas) e as quedas.
  const taken: JobResult["taken"] = {};
  const deaths: Record<string, number> = {};
  const frames = (rec.frames ?? []).filter((f) => f.st === 3);
  const names = j.comp;
  for (const f of frames)
    for (const e of f.e) {
      if (
        (e.k === "golpe" || e.k === "magia") &&
        e.b < FOE_BASE &&
        e.a >= FOE_BASE &&
        !("cura" in e && e.cura)
      ) {
        const src =
          e.k === "golpe"
            ? e.a === FOE_BASE
              ? "golpe"
              : "invocados"
            : [
                  "golpe-pesado",
                  "pulso",
                  "talho",
                  "maldicao",
                  "sangramento",
                  "veneno",
                  "investida",
                ].includes(e.s)
              ? e.s
              : e.a === FOE_BASE
                ? "devocao"
                : "invocados";
        const cls = names[e.b]!;
        const per = (taken[cls] ??= {});
        per[src] = (per[src] ?? 0) + e.v / party[e.b]!.stats.hp;
      }
    }
  const bossRoom = rec.rooms[3];
  if (bossRoom?.firstDeath)
    deaths[`${bossRoom.firstDeath.cls}:${bossRoom.firstDeath.cause}`] = 1;
  const fd = rec.rooms.findIndex((r) => r.firstDeath);
  // A variação que lutou (antes de devolver o tema da Região).
  const variant = bossVariantOf(d);
  d.region.bossVariant = regionVariant;
  return {
    ...j,
    variant,
    win: rec.outcome === "vitoria",
    firstDeath:
      fd >= 0
        ? `sala ${fd + 1}: ${rec.rooms[fd]!.firstDeath!.cls} aos ${rec.rooms[fd]!.firstDeath!.seconds} s (${rec.rooms[fd]!.firstDeath!.cause})`
        : null,
    slack,
    luck,
    taken,
    deaths,
    bossSeconds: bossRoom?.seconds ?? 0,
  };
}

if (!isMainThread) {
  parentPort!.on("message", (j: Job) => parentPort!.postMessage(runJob(j)));
} else {
  const scenIds = arg(
    "scen",
    process.argv.includes("--variants")
      ? SCENARIOS.map((s) => s.id).join(",")
      : "hoje,dot,d71,caca",
  ).split(",");
  const dgs = arg("dgs", DEFAULT_DGS.join(",")).split(",");
  const WORKERS = Number(
    arg("workers", String(Math.max(1, Math.floor(availableParallelism() / 2)))),
  );
  const OUT = arg("out", "");
  const jobs: Job[] = [];
  for (const scen of scenIds)
    for (const dg of dgs) {
      const d = dungeonById(dg)!;
      const comps = (
        d.kind === "masmorra" ? FARM_TRIOS : REGION_PARTIES
      ) as ClassId[][];
      for (const comp of comps) {
        jobs.push({ scen, dg, comp });
        // O herói de farm da Masmorra não tem degrau de raridade (só o de nível).
        for (const step of STEPS)
          if (d.kind !== "masmorra" || step === "nivel")
            jobs.push({ scen, dg, comp, step });
      }
    }
  const t0 = Date.now();
  process.stderr.write(
    `${jobs.length} lutas-base, ${WORKERS} processos, ${SEEDS} corridas com rolagem cada\n`,
  );
  const pool = Array.from(
    { length: WORKERS },
    () => new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) }),
  );
  const results: JobResult[] = await new Promise((resolve) => {
    const out: JobResult[] = [];
    let next = 0;
    const feed = (w: Worker) => {
      if (next < jobs.length) w.postMessage(jobs[next++]);
    };
    for (const w of pool) {
      w.on("message", (r: JobResult) => {
        out.push(r);
        if (out.length % 50 === 0 || out.length === jobs.length)
          process.stderr.write(
            `  ${out.length}/${jobs.length} · ${Math.round((Date.now() - t0) / 1000)} s\n`,
          );
        if (out.length === jobs.length) resolve(out);
        else feed(w);
      });
      feed(w);
    }
  });
  for (const w of pool) void w.terminate();

  const pct = (x: number) => `${Math.round(100 * x)}%`;
  for (const scen of scenIds) {
    const rs = results.filter((r) => r.scen === scen);
    const full = rs.filter((r) => !r.step);
    console.log(`\n## ${SCENARIOS.find((s) => s.id === scen)!.label}`);
    for (const kind of ["masmorra", "regional"] as const) {
      const xs = full.filter((r) => dungeonById(r.dg)!.kind === kind);
      if (xs.length === 0) continue;
      const slacks = xs.map((r) => r.slack ?? 0).sort((a, b) => a - b);
      const luck = xs.reduce((a, r) => a + r.luck, 0) / (xs.length * SEEDS);
      const lose = xs.filter((r) => !r.win).length;
      console.log(
        `${kind === "masmorra" ? "Masmorra (farm abaixo do limite)" : "Região (4 no limite)"}: ${xs.length} lutas · perde no esperado ${lose} · rolagem ${pct(luck)} · folga mín ${slacks[0]!.toFixed(2)} mediana ${slacks[Math.floor(slacks.length / 2)]!.toFixed(2)}`,
      );
      for (const step of STEPS) {
        const ys = rs.filter(
          (r) => r.step === step && dungeonById(r.dg)!.kind === kind,
        );
        if (!ys.length) continue;
        const yc = new Map<string, number>();
        for (const r of ys)
          for (const k of Object.keys(r.deaths))
            yc.set(k, (yc.get(k) ?? 0) + 1);
        console.log(
          `   todos ${step === "nivel" ? "nível −5" : "raridade −1"}: rolagem ${pct(ys.reduce((a, r) => a + r.luck, 0) / (ys.length * SEEDS))} · perde no esperado ${ys.filter((r) => !r.win).length}/${ys.length}${
            yc.size
              ? ` · 1ª queda no chefe: ${[...yc.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")}`
              : ""
          }`,
        );
      }
      // Dano recebido na sala do chefe, por fonte (soma das vidas do grupo).
      const by = new Map<string, number>();
      for (const r of xs)
        for (const per of Object.values(r.taken))
          for (const [k, v] of Object.entries(per))
            by.set(k, (by.get(k) ?? 0) + v);
      const tot = [...by.values()].reduce((a, v) => a + v, 0);
      console.log(
        `   dano no chefe por fonte: ${[...by.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${pct(v / tot)}`)
          .join(" · ")}`,
      );
      const tanks = new Set(["guerreiro", "paladino"]);
      for (const side of ["tanque", "resto"] as const) {
        const bs = new Map<string, number>();
        for (const r of xs)
          for (const [cls, per] of Object.entries(r.taken))
            if (tanks.has(cls) === (side === "tanque"))
              for (const [k, v] of Object.entries(per))
                bs.set(k, (bs.get(k) ?? 0) + v);
        const t = [...bs.values()].reduce((a, v) => a + v, 0);
        console.log(
          `     ${side === "tanque" ? "tanques" : "não tanques"}: ${[
            ...bs.entries(),
          ]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${pct(v / t)}`)
            .join(" · ")}`,
        );
      }
      const causes = new Map<string, number>();
      for (const r of xs)
        for (const k of Object.keys(r.deaths))
          causes.set(k, (causes.get(k) ?? 0) + 1);
      const secs = xs.map((r) => r.bossSeconds).sort((a, b) => a - b);
      console.log(
        `   sala do chefe: mediana ${Math.round(secs[Math.floor(secs.length / 2)]!)} s`,
      );
      if (causes.size)
        console.log(
          `   1ª queda no chefe: ${[...causes.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ")}`,
        );
    }
    // Por variação (só nos cenários com variação).
    if (scen !== "hoje") {
      const byVar = new Map<string, JobResult[]>();
      for (const r of full)
        byVar.set(r.variant, [...(byVar.get(r.variant) ?? []), r]);
      for (const [v, xs] of byVar)
        console.log(
          `   ${v}: ${xs.length} lutas · rolagem ${pct(xs.reduce((a, r) => a + r.luck, 0) / (xs.length * SEEDS))} · folga mediana ${xs
            .map((r) => r.slack ?? 0)
            .sort((a, b) => a - b)
            [Math.floor(xs.length / 2)]!.toFixed(2)}`,
        );
    }
  }
  console.log(`\n${Math.round((Date.now() - t0) / 1000)} s`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ seeds: SEEDS, results }));
  process.exit(0);
}
