// Laboratório de renascimento (24/11/2026, pedido do dono): quanto cada classe cresce com N
// renascimentos da árvore, e quanto do dano dela passa pela árvore. O renascimento soma
// MASTERY_PCT (0,5%) por vez ao adereço escolhido, sem teto; nos adereços de forma, ao poder da
// habilidade inteira. Por isso as habilidades têm de ser a menor parte do dano: o que passa pela
// árvore cresce para sempre, o resto (ataque normal) não.
//
// O herói é o do simulador (simHero.ts) no level pedido, com a árvore inteira (o renascimento
// pede a 3ª classe com a árvore cheia) e a maestria toda num adereço só: o que mais rende em
// --pick renascimentos, achado pelo próprio laboratório (o jogador que otimiza faria isso).
//
// Rodar (no space-core): node scripts/rebirth-lab.ts [--level 60] [--dungeon abismo-gelado]
//   [--seeds 20] [--rebirths 0,25,50,100,200,400] [--pick 200] [--class 3] [--json saida.json]
// Pesado só com muitas sementes: rodar com prioridade baixa e uma rodada por vez.
import { writeFileSync } from "node:fs";
import {
  type Mastery,
  type RunHero,
  type Tree,
  type VocationId,
  abilitiesOf,
  DUNGEONS,
  simulateRun,
  TREE,
  VOCATIONS,
} from "../src/game/ot/index.ts";
import { heroAt } from "./simHero.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : def;
};
const LEVEL = Number(opt("level", "60"));
const SEEDS = Number(opt("seeds", "20"));
const PICK = Number(opt("pick", "200"));
const REBIRTHS = opt("rebirths", "0,25,50,100,200,400").split(",").map(Number);
const ONLY = args.includes("--class") ? [Number(opt("class", "0")) as VocationId] : null;
const DUNGEON =
  opt("dungeon", "") ||
  [...DUNGEONS].reverse().find((d) => d.minLevel <= LEVEL)!.id;
const NAMES: Record<number, string> = { 1: "Feiticeiro", 2: "Druida", 3: "Arqueiro", 4: "Cavaleiro" };

/** A árvore inteira da classe (as três partes, cada adereço no último ponto). */
function fullTree(cls: number): Tree {
  const ids = new Set(abilitiesOf(cls).map((a) => a.id));
  const t: Tree = {};
  for (const n of TREE) if (ids.has(n.ability)) t[n.id] = n.ranks;
  return t;
}

function hero(vocation: VocationId, tree: Tree, mastery?: Mastery): RunHero {
  const h = heroAt(vocation, LEVEL);
  return { ...h, tree, ...(mastery ? { mastery } : {}) };
}

interface Measure {
  dps: number;
  win: number;
  secs: number;
  /** % do dano em monstros que saiu das habilidades (o resto é ataque normal). */
  abilities: number;
}

function measure(vocation: VocationId, tree: Tree, mastery?: Mastery, seeds = SEEDS): Measure {
  let dmg = 0;
  let secs = 0;
  let wins = 0;
  let ab = 0;
  let auto = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = simulateRun({ seed: seed * 104729, dungeon: DUNGEON, heroes: [hero(vocation, tree, mastery)], rateLoot: 2 });
    dmg += r.members[0]!.damage;
    secs += r.seconds;
    if (r.outcome === "vitoria") wins++;
    for (const f of r.frames)
      for (const e of f.e as Array<{ k: string; a: number; b: number; v: unknown; cura?: boolean }>) {
        if (e.a !== 0 || typeof e.v !== "number" || e.b < 100 || e.cura) continue;
        if (e.k === "magia") ab += e.v;
        else if (e.k === "golpe") auto += e.v;
      }
  }
  return {
    dps: +(dmg / Math.max(1, secs)).toFixed(1),
    win: Math.round((100 * wins) / seeds),
    secs: Math.round(secs / seeds),
    abilities: ab + auto > 0 ? Math.round((100 * ab) / (ab + auto)) : 0,
  };
}

const out: Record<string, unknown> = { level: LEVEL, dungeon: DUNGEON, seeds: SEEDS, pick: PICK, rebirths: REBIRTHS, classes: [] as unknown[] };
console.log(`renascimento · level ${LEVEL} · ${DUNGEON} · ${SEEDS} corridas por ponto · maestria escolhida em ${PICK} renascimentos`);
for (const vocation of ONLY ?? ([4, 3, 2, 1] as VocationId[])) {
  const cls = VOCATIONS[vocation].base;
  const tree = fullTree(cls);
  // O adereço que mais rende com a maestria (triagem com menos corridas).
  let best = { node: "", dps: -1 };
  for (const node of Object.keys(tree)) {
    const m = measure(vocation, tree, { [node]: PICK }, Math.max(4, Math.round(SEEDS / 4)));
    if (m.dps > best.dps) best = { node, dps: m.dps };
  }
  const empty = measure(vocation, {});
  const rows = REBIRTHS.map((n) => ({ rebirths: n, ...measure(vocation, tree, n ? { [best.node]: n } : undefined) }));
  const base = rows.find((r) => r.rebirths === 0) ?? rows[0]!;
  console.log(`\n== ${NAMES[cls]} · maestria em ${best.node}`);
  console.log(`  árvore vazia      dps ${empty.dps.toString().padStart(6)}  vitória ${empty.win}%  habilidades ${empty.abilities}% do dano`);
  for (const r of rows)
    console.log(
      `  ${String(r.rebirths).padStart(4)} renasc.  dps ${r.dps.toString().padStart(6)}  ×${(r.dps / base.dps).toFixed(2)}  vitória ${r.win}%  ${r.secs}s  habilidades ${r.abilities}% do dano`,
    );
  (out.classes as unknown[]).push({ vocation, name: NAMES[cls], node: best.node, empty, rows });
}
const json = opt("json", "");
if (json) writeFileSync(json, JSON.stringify(out, null, 1));
