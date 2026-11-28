/* global console, process */
// Busca da composição mais forte no fim de jogo (27/11/2026, o dono: "os melhores grupos no limite
// completam o chefe 500 sem contar o segundo perk; o segundo perk, em algumas comps com algumas builds,
// passa do 500; fechar o 600, nenhuma comp nem com os melhores conjuntos de build deve conseguir. Mede
// com o maior número de variações possíveis, não deixe escapar nenhuma").
//
// Todos no topo: nível 500, Lendário iL 500 +10, afixos do plano no teto e perks no valor máximo; com
// `--perks 1` cada item tem 1 perk, com `--perks 2`, 2. Cada herói escolhe uma opção = build (arma,
// secundária, peso da armadura, atributos, kit) × plano de perks (todos os itens nas mesmas skills, ou
// metade dos itens num par e metade no outro). A busca, para cada composição (todas as de 4 e 5 das 7
// classes, com repetição):
//   1. parte de 3 pontos (todos na build da classe, todos na do solo, e o melhor de cada herói sozinho);
//   2. melhora um herói por vez, testando todas as opções dele com os outros fixos, até nenhuma troca
//      melhorar (subida por coordenadas);
//   3. nas `--pairs` melhores composições, troca dois heróis ao mesmo tempo (todas as opções × todas).
// A nota é a distância da vitória na DG alvo: vitória vale 10 + vida que sobrou; derrota, as salas
// vencidas + o quanto tirou da sala em que caiu. No fim: as melhores, a escada (Região do 450 ao 600 e
// Masmorras do 490 ao 590) e `--seeds` corridas com rolagem de verdade na DG alvo.
//
//   node scripts/endgame-search.ts [--perks 2] [--dg regiao-12] [--sizes 4,5] [--workers 8] [--pairs 5]
//     [--seeds 200] [--top 40] [--out arquivo.json]
// Pesado: roda com prioridade baixa e metade dos núcleos por padrão.
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism, constants, setPriority } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import { randomSource } from "../src/game/ot/balance/combat/fight.ts";
import type { FighterInput } from "../src/game/ot/balance/combat/types.ts";
import {
  type ArmorWeight,
  type ClassId,
  type FamilyId,
  type OffhandId,
  type Stat,
  ARMOR_SLOTS,
  CLASS_IDS,
  CLASSES,
  STATS,
} from "../src/game/ot/balance/content.ts";
import { type DungeonDef, ALL_DUNGEONS, dungeonById } from "../src/game/ot/balance/dungeons/catalog.ts";
import type { BalanceHero, Equipment, ItemInstance } from "../src/game/ot/balance/equipment.ts";
import { heroFighter } from "../src/game/ot/balance/fighter.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { affixCount, affixRange } from "../src/game/ot/balance/items/generate.ts";
import { PERKS } from "../src/game/ot/balance/items/perks.ts";
import { refinable } from "../src/game/ot/balance/items/smith.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { createReference } from "../src/game/ot/balance/reference.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import { limitMechanics, referenceSkills } from "../src/game/ot/balance/sim/encounters.ts";
import { SKILLS_BY_CLASS } from "../src/game/ot/balance/skills/index.ts";
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
// Para calibrar o D67 sem mexer no config: --growth 1.4 vale para esta rodada (e os processos dela).
if (process.argv.includes("--growth"))
  (B.cfg.monsters as { endgameGrowth: number }).endgameGrowth = Number(arg("growth", "1"));

// ------------------------------------------------------------------ opções de cada herói

interface Spec {
  weapon: FamilyId;
  off: OffhandId | null;
  weight: ArmorWeight;
  attrs: string;
  /** Kit; vazio: o de grupo de referência (com o do T4, quando houver). */
  kit: string[];
}
const ATTR_BUILDS: Record<string, readonly (readonly [Stat, number])[] | null> = {
  classe: null,
  forca: [["FOR", 70], ["VIT", 30]],
  destreza: [["DES", 70], ["AGI", 30]],
  inteligencia: [["INT", 70], ["VIT", 30]],
  critico: [["AGI", 50], ["SOR", 50]],
  tanque: [["VIT", 70], ["FOR", 30]],
  misto: STATS.map((s) => [s, 1] as const),
};
const g = (weapon: FamilyId, off: OffhandId | null, weight: ArmorWeight, attrs: string, kit: string[] = []): Spec => ({ weapon, off, weight, attrs, kit });
/** As builds de cada classe: a da classe, a vencedora do solo e alternativas (armas, atributos, kit e o peso acima). */
export const BUILDS: Record<ClassId, Record<string, Spec>> = {
  guerreiro: {
    classe: g("espada", "escudo", "pesada", "classe"),
    solo: g("martelo", null, "pesada", "misto", ["golpe-provocador", "grito-de-guerra", "redemoinho", "estandarte-de-guerra"]),
    VIT: g("espada", "escudo", "pesada", "tanque"),
    "força machado": g("machado", null, "pesada", "forca"),
    "estandarte": g("espada", "escudo", "pesada", "classe", ["golpe-provocador", "grito-de-guerra", "muralha-de-ferro", "estandarte-de-guerra"]),
  },
  paladino: {
    classe: g("espada", "escudo", "pesada", "classe"),
    "égide (kit antigo)": g("espada", "escudo", "pesada", "classe", ["golpe-sagrado", "consagracao", "escudo-da-fe", "bencao-da-egide"]),
    "devoção+égide": g("espada", "escudo", "pesada", "classe", ["golpe-sagrado", "consagracao", "intervencao-divina", "bencao-da-egide"]),
    solo: g("besta", "aljava", "pesada", "destreza", ["golpe-sagrado", "escudo-da-fe", "consagracao", "imposicao-de-maos"]),
    VIT: g("espada", "escudo", "pesada", "tanque"),
    "força martelo": g("martelo", null, "pesada", "forca"),
  },
  padre: {
    classe: g("cajado", null, "leve", "classe"),
    solo: g("cetro", "escudo", "media", "classe", ["curar", "luz-sagrada", "escudo-sagrado", "bencao"]),
    INT: g("cajado", null, "leve", "inteligencia"),
    "maça+escudo": g("maca", "escudo", "leve", "classe"),
    "cajado média (acima)": g("cajado", null, "media", "classe"),
  },
  druida: {
    classe: g("bastao", null, "media", "classe"),
    solo: g("cetro", "escudo", "pesada", "classe", ["rejuvenescer", "espinhos", "cancao-da-floresta", "raizes"]),
    cajado: g("cajado", null, "media", "classe"),
    "cajado pesada (acima)": g("cajado", null, "pesada", "classe"),
    "cetro+escudo média": g("cetro", "escudo", "media", "classe"),
    "katar misto": g("katar", null, "media", "misto"),
  },
  mago: {
    classe: g("cajado", null, "leve", "classe"),
    solo: g("cetro", "escudo", "leve", "inteligencia", ["seta-arcana", "nevasca", "escudo-de-mana", "raio-em-cadeia"]),
    INT: g("cajado", null, "leve", "inteligencia"),
    "cetro+foco": g("cetro", "focus", "leve", "classe"),
    "cajado média (acima)": g("cajado", null, "media", "classe"),
  },
  cacador: {
    classe: g("arco", "aljava", "media", "classe"),
    solo: g("besta", "aljava", "pesada", "classe", ["rajada-dupla", "marca-do-cacador", "foco-mortal", "tiro-perfurante"]),
    DES: g("arco", "aljava", "media", "destreza"),
    "crítico (arco)": g("arco", "aljava", "media", "critico"),
    "arco pesada (acima)": g("arco", "aljava", "pesada", "classe"),
  },
  assassino: {
    classe: g("katar", null, "media", "classe"),
    solo: g("arco", "aljava", "media", "misto", ["lamina-envenenada", "sequencia-letal", "emboscada", "danca-das-laminas"]),
    "crítico": g("katar", null, "media", "critico"),
    "adaga+punhal": g("adaga", "punhal", "media", "classe"),
    "katar pesada (acima)": g("katar", null, "pesada", "classe"),
  },
};

const L = 500;
const PERKS_PER_ITEM = Number(arg("perks", "1"));
/**
 * D68: com `--supreme 0.15` (a média) ou `0.2` (a melhor rolagem), a arma é a Suprema: o poder no dano
 * dela e 2 perks (o do plano e outra skill do kit); os outros itens seguem com `--perks`.
 */
const SUPREME = Number(arg("supreme", "0"));
const R0 = createReference(B);
const hs0Cache = new Map<ClassId, ReturnType<typeof limitMechanics>>();
const hs0 = (cls: ClassId) => {
  let h = hs0Cache.get(cls);
  if (!h) {
    h = limitMechanics(cls, referenceSkills(cls, B.tierFor(B.jobForLevel(L)), B.jobForLevel(L), false, B, "gabarito"));
    hs0Cache.set(cls, h);
  }
  return h;
};
const kitOf = (cls: ClassId, s: Spec) => (s.kit.length ? s.kit : hs0(cls).slots);

/**
 * Os planos de perk de um kit de 4: com 2 perks por item, cada par de skills em todos os itens (6) e
 * os 3 jeitos de dividir o kit em 2 pares (metade dos itens em cada); com 1 perk, cada skill em todos
 * (4) e cada par dividido meio a meio (6).
 */
function perkPlans(kit: string[]): string[][][] {
  const k = kit.slice(0, 4);
  const pairs: [string, string][] = [];
  for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) pairs.push([k[i]!, k[j]!]);
  if (PERKS_PER_ITEM === 1) return [...k.map((a) => [[a]]), ...pairs.map(([a, b]) => [[a], [b]])];
  const [a, b, c, d] = k;
  const splits: string[][][] =
    k.length === 4
      ? [
          [[a!, b!], [c!, d!]],
          [[a!, c!], [b!, d!]],
          [[a!, d!], [b!, c!]],
        ]
      : [];
  return [...pairs.map((p) => [p]), ...splits];
}

export interface Option {
  build: string;
  /** Índice do plano de perks (perkPlans do kit da build). */
  plan: number;
}
export function optionsOf(cls: ClassId): Option[] {
  const out: Option[] = [];
  for (const [build, s] of Object.entries(BUILDS[cls]))
    for (let plan = 0; plan < perkPlans(kitOf(cls, s)).length; plan++) out.push({ build, plan });
  return out;
}
const optLabel = (cls: ClassId, o: Option) => {
  const s = BUILDS[cls][o.build]!;
  const plan = perkPlans(kitOf(cls, s))[o.plan]!;
  return `${cls} [${o.build}; perks ${plan.map((p) => p.join("+")).join(" | ")}]`;
};

function topItem(cls: ClassId, base: Partial<ItemInstance> & { slot: string }, perks: string[]): ItemInstance {
  const plan = (B.cfg.limit.affixPlan as Record<string, Record<string, string[]>>)[cls] ?? {};
  const n = affixCount(base.slot as never, "lendario");
  const affixes = (plan[base.slot] ?? []).slice(0, n).map((id) => ({ id: id as never, value: affixRange(id as never, L, "lendario", B).max }));
  const it = { ilvl: L, rarity: "lendario", refine: 0, affixes, ...base } as ItemInstance;
  return { ...it, refine: refinable(it) ? 10 : 0, perks: perks.map((skill) => ({ skill, value: PERKS[skill]!.max })) } as ItemInstance;
}

const dealsDamage = (cls: ClassId, id: string) =>
  !!SKILLS_BY_CLASS[cls].find((x) => x.id === id)?.effects.some((e) => e.type === "dano" || e.type === "dot");

const fighters = new Map<string, FighterInput>();
export function fighter(cls: ClassId, o: Option): FighterInput {
  const key = `${cls}:${o.build}:${o.plan}`;
  const hit = fighters.get(key);
  if (hit) return hit;
  const s = BUILDS[cls][o.build]!;
  const base = hs0(cls);
  const kit = kitOf(cls, s);
  const plan = perkPlans(kit)[o.plan]!;
  let n = 0;
  const next = () => plan[n++ % plan.length]!;
  const first = next();
  const weaponPerks =
    SUPREME > 0
      ? [first[0]!, first[1] ?? plan.flat().find((x) => x !== first[0]) ?? kit.find((x) => x !== first[0])!]
      : first;
  const arma = topItem(cls, { slot: "arma", family: s.weapon }, weaponPerks);
  const eq: Record<string, ItemInstance> = {
    arma: SUPREME > 0 ? ({ ...arma, supreme: { power: SUPREME } } as ItemInstance) : arma,
  };
  if (s.off) eq.secundaria = topItem(cls, { slot: "secundaria", offhand: s.off }, next());
  for (const slot of ARMOR_SLOTS) eq[slot] = topItem(cls, { slot, weight: s.weight }, next());
  eq.colar = topItem(cls, { slot: "colar" }, next());
  eq.anel = topItem(cls, { slot: "anel" }, next());
  const w = ATTR_BUILDS[s.attrs];
  const h: BalanceHero = {
    cls,
    level: L,
    job: B.jobForLevel(L),
    proficiency: B.recommendedProficiency(L),
    attrs: B.allocateByWeights(B.attributePoints(L), w ?? CLASSES[cls].referenceBuild),
    equipment: eq as Equipment,
  };
  // A IA do gabarito (dano sai sempre) também nos kits trocados.
  const ai: Record<string, { kind: "sempre" }[]> = {};
  for (const id of kit) if (dealsDamage(cls, id)) ai[id] = [{ kind: "sempre" }];
  const f = heroFighter(h, { ...base, slots: kit, ai }, { potions: { hp: R0.potionHp(L), mp: R0.potionMp(L), stock: 1000 } }, B, R0);
  fighters.set(key, f);
  return f;
}

// ------------------------------------------------------------------ nota

const M = createMonsters(B);
interface Score { score: number; win: boolean; rooms: number; left: number }
export function scoreRun(d: DungeonDef, party: FighterInput[]): Score {
  const r = simulateRun(d, party, { mode: "esperado" }, B, M);
  const win = r.outcome === "vitoria";
  const cleared = r.rooms.filter((x) => x.win).length;
  const last = r.rooms[r.rooms.length - 1]!;
  const left = win ? 0 : last.enemiesLeft.reduce((a, x) => a + x, 0) / Math.max(1, last.enemiesLeft.length);
  const hpLeft = win ? r.heroes.reduce((a, h, i) => a + (h.alive ? h.hp / party[i]!.stats.hp : 0), 0) / party.length : 0;
  return { score: win ? 10 + hpLeft : cleared + (1 - left), win, rooms: cleared, left };
}

// ------------------------------------------------------------------ trabalhador

interface Job { kind: "comp"; comp: ClassId[]; dg: string; pairs: boolean }
interface CompResult { comp: ClassId[]; opts: Option[]; score: Score; evals: number }

function climb(comp: ClassId[], d: DungeonDef, pairs: boolean): CompResult {
  const opts = comp.map(optionsOf);
  let evals = 0;
  const memo = new Map<string, Score>();
  const evalOf = (pick: number[]): Score => {
    const key = pick.join(",");
    const m = memo.get(key);
    if (m) return m;
    evals++;
    const s = scoreRun(d, comp.map((c, i) => fighter(c, opts[i]![pick[i]!]!)));
    memo.set(key, s);
    return s;
  };
  const idx = (i: number, build: string) => Math.max(0, opts[i]!.findIndex((o) => o.build === build && o.plan === 0));
  const starts: number[][] = [comp.map((_, i) => idx(i, "classe")), comp.map((_, i) => idx(i, "solo"))];
  // 3º ponto: cada herói na sua melhor opção com os outros na da classe.
  const greedy = starts[0]!.slice();
  for (let i = 0; i < comp.length; i++) {
    let best = greedy[i]!;
    let bestS = -1;
    for (let k = 0; k < opts[i]!.length; k++) {
      const p = starts[0]!.slice();
      p[i] = k;
      const s = evalOf(p).score;
      if (s > bestS) [best, bestS] = [k, s];
    }
    greedy[i] = best;
  }
  starts.push(greedy);
  let bestPick = starts[0]!;
  let best = evalOf(bestPick);
  for (const st of starts) {
    let pick = st.slice();
    let cur = evalOf(pick);
    for (let sweep = 0; sweep < 4; sweep++) {
      let improved = false;
      for (let i = 0; i < comp.length; i++)
        for (let k = 0; k < opts[i]!.length; k++) {
          if (k === pick[i]) continue;
          const p = pick.slice();
          p[i] = k;
          const s = evalOf(p);
          if (s.score > cur.score + 1e-9) [pick, cur, improved] = [p, s, true];
        }
      if (!improved) break;
    }
    if (cur.score > best.score) [bestPick, best] = [pick, cur];
  }
  if (pairs) {
    // Dois heróis trocando juntos, a partir do melhor ponto (escapa de ótimo local de um só herói).
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < comp.length; i++)
        for (let j = i + 1; j < comp.length; j++)
          for (let a = 0; a < opts[i]!.length; a++)
            for (let b = 0; b < opts[j]!.length; b++) {
              const p = bestPick.slice();
              p[i] = a;
              p[j] = b;
              const s = evalOf(p);
              if (s.score > best.score + 1e-9) [bestPick, best, improved] = [p, s, true];
            }
    }
  }
  return { comp, opts: bestPick.map((k, i) => opts[i]![k]!), score: best, evals };
}

if (!isMainThread) {
  parentPort!.on("message", (job: Job) => {
    const d = dungeonById(job.dg)!;
    parentPort!.postMessage(climb(job.comp, d, job.pairs));
  });
} else {
  await main();
}

// ------------------------------------------------------------------ principal

function combos(size: number, start = 0, acc: ClassId[] = []): ClassId[][] {
  if (acc.length === size) return [[...acc]];
  const out: ClassId[][] = [];
  for (let i = start; i < CLASS_IDS.length; i++) out.push(...combos(size, i, [...acc, CLASS_IDS[i]!]));
  return out;
}

/**
 * --pool arquivo.json: sem busca; reavalia as `--poolTop` melhores configurações de uma busca já
 * feita (com o --growth desta rodada): nota na DG alvo, escada e rolagem de verdade.
 */
function poolMode(file: string) {
  const DG = arg("dg", "regiao-12");
  const TOPN = Number(arg("poolTop", "150"));
  const SEEDS = Number(arg("seeds", "200"));
  const data = JSON.parse(readFileSync(file, "utf8")) as { all: CompResult[] };
  const d = dungeonById(DG)!;
  const REG = ALL_DUNGEONS.filter((x) => x.kind === "regional" && x.level >= 450);
  const MAS = ALL_DUNGEONS.filter((x) => x.kind === "masmorra" && x.level >= 490);
  const reach = (party: FighterInput[], dgs: DungeonDef[]) => {
    let best = 0;
    for (const x of dgs) {
      if (simulateRun(x, party, { mode: "esperado" }, B, M).outcome !== "vitoria") break;
      best = x.level;
    }
    return best;
  };
  const rows = data.all.slice(0, TOPN).map((r) => {
    const party = r.comp.map((c, i) => fighter(c, r.opts[i]!));
    const sc = scoreRun(d, party);
    let luck = 0;
    for (let seed = 1; seed <= SEEDS; seed++)
      if (simulateRun(d, party, { mode: "aleatorio", random: randomSource(new Rng(seed * 104729)) }, B, M).outcome === "vitoria") luck++;
    return { r, sc, luck, regiao: reach(party, REG), masmorra: reach(party, MAS) };
  });
  rows.sort((a, b) => b.sc.score - a.sc.score);
  const g = (B.cfg.monsters as { endgameGrowth?: number }).endgameGrowth ?? 1;
  const wins = rows.filter((x) => x.sc.win).length;
  const lucky = rows.filter((x) => x.luck > 0).length;
  console.log(`# Pool (${rows.length} configurações) no ${DG}, ${PERKS_PER_ITEM} perk(s)${SUPREME > 0 ? `, arma Suprema +${Math.round(SUPREME * 100)}%` : ""}, endgameGrowth ${g}`);
  console.log(`vencem no esperado: ${wins} · vencem ao menos 1 de ${SEEDS} com rolagem: ${lucky} (total de vitórias: ${rows.reduce((a, x) => a + x.luck, 0)})`);
  const hist = (k: "regiao" | "masmorra") => {
    const m = new Map<number, number>();
    for (const x of rows) m.set(x[k], (m.get(x[k]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([lv, n]) => `${lv || "—"}: ${n}`).join(" · ");
  };
  console.log(`última Região vencida (em ordem do 450): ${hist("regiao")}`);
  console.log(`última Masmorra vencida (em ordem do 490): ${hist("masmorra")}`);
  for (const x of rows.slice(0, 12))
    console.log(`  ${x.sc.score.toFixed(3)} | Região ${x.regiao || "—"} | Masmorra ${x.masmorra || "—"} | rolagem ${x.luck}/${SEEDS} | ${x.r.comp.map((c, i) => optLabel(c, x.r.opts[i]!)).join(" · ")}`);
  process.exit(0);
}

async function main() {
  if (process.argv.includes("--pool")) return poolMode(arg("pool", ""));
  const DG = arg("dg", "regiao-12");
  const SIZES = arg("sizes", "4,5").split(",").map(Number);
  const WORKERS = Number(arg("workers", String(Math.max(1, Math.floor(availableParallelism() / 2)))));
  const PAIRS = Number(arg("pairs", "5"));
  const SEEDS = Number(arg("seeds", "200"));
  const TOP = Number(arg("top", "40"));
  const OUT = arg("out", "");
  const t0 = Date.now();
  const LIMIT = Number(arg("limit", "0"));
  const ONLY = arg("only", "");
  let comps = SIZES.flatMap((n) => combos(n));
  if (ONLY) comps = ONLY.split(";").map((x) => x.split(",") as ClassId[]);
  if (LIMIT > 0) comps = comps.slice(0, LIMIT);
  const pool = Array.from({ length: WORKERS }, () => new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) }));
  const run = (jobs: Job[]) =>
    new Promise<CompResult[]>((resolve) => {
      const out: CompResult[] = [];
      let next = 0;
      let done = 0;
      const feed = (w: Worker) => {
        if (next >= jobs.length) return;
        w.postMessage(jobs[next++]);
      };
      for (const w of pool) {
        w.removeAllListeners("message");
        w.on("message", (r: CompResult) => {
          out.push(r);
          done++;
          if (done % 25 === 0 || done === jobs.length)
            process.stderr.write(`  ${done}/${jobs.length} composições · ${Math.round((Date.now() - t0) / 1000)} s\n`);
          if (done === jobs.length) resolve(out);
          else feed(w);
        });
        feed(w);
      }
    });
  process.stderr.write(`${comps.length} composições, ${WORKERS} processos, perks por item: ${PERKS_PER_ITEM}, alvo ${DG}\n`);
  const first = await run(comps.map((comp) => ({ kind: "comp", comp, dg: DG, pairs: false })));
  first.sort((a, b) => b.score.score - a.score.score);
  const pairJobs = first.slice(0, PAIRS).map((r) => ({ kind: "comp" as const, comp: r.comp, dg: DG, pairs: true }));
  const second = PAIRS > 0 ? await run(pairJobs) : [];
  for (const r of second) {
    const i = first.findIndex((x) => x.comp.join() === r.comp.join());
    if (i >= 0 && r.score.score > first[i]!.score.score) first[i] = { ...r, evals: r.evals + first[i]!.evals };
  }
  for (const w of pool) void w.terminate();
  first.sort((a, b) => b.score.score - a.score.score);
  const evals = first.reduce((a, r) => a + r.evals, 0);

  console.log(`# Busca no ${DG} — ${PERKS_PER_ITEM} perk(s) por item${SUPREME > 0 ? `, arma Suprema +${Math.round(SUPREME * 100)}%` : ""} — ${comps.length} composições, ${evals} lutas, ${Math.round((Date.now() - t0) / 1000)} s`);
  const wins = first.filter((r) => r.score.win);
  console.log(`vencem (modo esperado): ${wins.length} composições`);
  const dist = new Map<string, number>();
  for (const r of first) {
    const k = r.score.win ? "vence" : `cai na sala ${r.score.rooms + 1}`;
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }
  console.log(`distribuição: ${[...dist.entries()].map(([k, v]) => `${k}: ${v}`).join(" · ")}`);
  console.log(`\n## As ${TOP} mais fortes (nota: 10+ = vence; senão salas vencidas + fração tirada da sala da queda)`);
  const d = dungeonById(DG)!;
  const REG = ALL_DUNGEONS.filter((x) => x.kind === "regional" && x.level >= 450);
  const MAS = ALL_DUNGEONS.filter((x) => x.kind === "masmorra" && x.level >= 490);
  const reach = (party: FighterInput[], dgs: DungeonDef[]) => {
    let best = 0;
    for (const x of dgs) {
      if (simulateRun(x, party, { mode: "esperado" }, B, M).outcome !== "vitoria") break;
      best = x.level;
    }
    return best;
  };
  const top = first.slice(0, TOP).map((r) => {
    const party = r.comp.map((c, i) => fighter(c, r.opts[i]!));
    let luck = 0;
    for (let seed = 1; seed <= SEEDS; seed++)
      if (simulateRun(d, party, { mode: "aleatorio", random: randomSource(new Rng(seed * 104729)) }, B, M).outcome === "vitoria") luck++;
    return { ...r, regiao: reach(party, REG), masmorra: reach(party, MAS), luck };
  });
  for (const r of top)
    console.log(`  ${r.score.score.toFixed(3)} | Região até ${r.regiao || "—"} | Masmorra até ${r.masmorra || "—"} | rolagem de verdade: ${r.luck}/${SEEDS} vitórias | ${r.comp.map((c, i) => optLabel(c, r.opts[i]!)).join(" · ")}`);
  const byClass = new Map<string, number>();
  for (const r of first.slice(0, TOP)) for (const c of new Set(r.comp)) byClass.set(c, (byClass.get(c) ?? 0) + 1);
  console.log(`\nclasses nas ${TOP} mais fortes: ${[...byClass.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (OUT) writeFileSync(OUT, JSON.stringify({ dg: DG, perks: PERKS_PER_ITEM, all: first, top }));
  process.exit(0);
}
