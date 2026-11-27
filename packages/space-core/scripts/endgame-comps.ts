/* global console, process */
// Composições e builds no fim de jogo (27/11/2026, o dono: "estas comps com paladino no lugar do
// guerreiro não chegam no mesmo lugar? quero ver mais variações de comp, 2 tanques + 2 suportes + 1
// assassino por exemplo; seja amplo, teste várias builds também").
//
//   node scripts/endgame-comps.ts [--sizes 3,4,5] [--out arquivo.json]
//
// Todos no topo: nível 500, Lendário iL 500 +10, afixos do plano no teto, perks no valor máximo em
// todas as peças. Cada grupo sobe a escada dos chefes de Região (do 400 ao 600) e a das Masmorras do
// fim (490 a 590) até a 1ª derrota.
//   A) toda composição de 3, 4 e 5 heróis (as 7 classes, com repetição), com todos na build da classe e
//      com todos na build vencedora do solo;
//   B) 4 builds por classe (da classe, a do solo e duas alternativas), cada uma no lugar da classe nos
//      5 melhores grupos de A que têm a classe.
import { writeFileSync } from "node:fs";

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
import { type DungeonDef, ALL_DUNGEONS } from "../src/game/ot/balance/dungeons/catalog.ts";
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

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const SIZES = arg("sizes", "3,4,5").split(",").map(Number);
const OUT = arg("out", "");

interface Spec {
  weapon: FamilyId;
  off: OffhandId | null;
  weight: ArmorWeight;
  attrs: string;
  /** Kit; vazio: o de grupo de referência. */
  kit: string[];
  /** Os 2 perks; vazio: as 2 primeiras skills do kit. */
  perks: string[];
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
const g = (weapon: FamilyId, off: OffhandId | null, weight: ArmorWeight, attrs: string): Spec => ({ weapon, off, weight, attrs, kit: [], perks: [] });
/** As builds de cada classe: a da classe, a vencedora do solo (scripts/solo-ceiling.ts) e duas alternativas. */
const BUILDS: Record<ClassId, Record<string, Spec>> = {
  guerreiro: {
    classe: g("espada", "escudo", "pesada", "classe"),
    solo: { weapon: "martelo", off: null, weight: "pesada", attrs: "misto", kit: ["golpe-provocador", "grito-de-guerra", "redemoinho", "estandarte-de-guerra"], perks: ["golpe-provocador", "grito-de-guerra"] },
    "VIT (espada+escudo)": g("espada", "escudo", "pesada", "tanque"),
    "força (machado)": g("machado", null, "pesada", "forca"),
  },
  paladino: {
    classe: g("espada", "escudo", "pesada", "classe"),
    solo: { weapon: "besta", off: "aljava", weight: "pesada", attrs: "destreza", kit: ["golpe-sagrado", "escudo-da-fe", "consagracao", "imposicao-de-maos"], perks: ["escudo-da-fe", "consagracao"] },
    "VIT (espada+escudo)": g("espada", "escudo", "pesada", "tanque"),
    "força (martelo)": g("martelo", null, "pesada", "forca"),
  },
  padre: {
    classe: g("cajado", null, "leve", "classe"),
    solo: { weapon: "cetro", off: "escudo", weight: "media", attrs: "classe", kit: ["curar", "luz-sagrada", "escudo-sagrado", "bencao"], perks: ["escudo-sagrado", "bencao"] },
    "INT (cajado)": g("cajado", null, "leve", "inteligencia"),
    "maça+escudo": g("maca", "escudo", "leve", "classe"),
  },
  druida: {
    classe: g("bastao", null, "media", "classe"),
    solo: { weapon: "cetro", off: "escudo", weight: "pesada", attrs: "classe", kit: ["rejuvenescer", "espinhos", "cancao-da-floresta", "raizes"], perks: ["espinhos", "cancao-da-floresta"] },
    "cajado": g("cajado", null, "media", "classe"),
    "katar misto": g("katar", null, "media", "misto"),
  },
  mago: {
    classe: g("cajado", null, "leve", "classe"),
    solo: { weapon: "cetro", off: "escudo", weight: "leve", attrs: "inteligencia", kit: ["seta-arcana", "nevasca", "escudo-de-mana", "raio-em-cadeia"], perks: ["seta-arcana", "raio-em-cadeia"] },
    "INT (cajado)": g("cajado", null, "leve", "inteligencia"),
    "cetro+foco": g("cetro", "focus", "leve", "classe"),
  },
  cacador: {
    classe: g("arco", "aljava", "media", "classe"),
    solo: { weapon: "besta", off: "aljava", weight: "pesada", attrs: "classe", kit: ["rajada-dupla", "marca-do-cacador", "foco-mortal", "tiro-perfurante"], perks: ["marca-do-cacador", "foco-mortal"] },
    "DES (arco)": g("arco", "aljava", "media", "destreza"),
    "crítico (arco)": g("arco", "aljava", "media", "critico"),
  },
  assassino: {
    classe: g("katar", null, "media", "classe"),
    solo: { weapon: "arco", off: "aljava", weight: "media", attrs: "misto", kit: ["lamina-envenenada", "sequencia-letal", "emboscada", "danca-das-laminas"], perks: ["lamina-envenenada", "sequencia-letal"] },
    "crítico (katar)": g("katar", null, "media", "critico"),
    "adaga+punhal": g("adaga", "punhal", "media", "classe"),
  },
};

const L = 500;
const R0 = createReference(B);
const M = createMonsters(B);

function topItem(cls: ClassId, base: Partial<ItemInstance> & { slot: string }, perks: string[]): ItemInstance {
  const plan = (B.cfg.limit.affixPlan as Record<string, Record<string, string[]>>)[cls] ?? {};
  const n = affixCount(base.slot as never, "lendario");
  const affixes = (plan[base.slot] ?? []).slice(0, n).map((id) => ({ id: id as never, value: affixRange(id as never, L, "lendario", B).max }));
  const it = { ilvl: L, rarity: "lendario", refine: 0, affixes, ...base } as ItemInstance;
  return { ...it, refine: refinable(it) ? 10 : 0, perks: perks.map((skill) => ({ skill, value: PERKS[skill]!.max })) } as ItemInstance;
}

const fighters = new Map<string, FighterInput>();
function fighter(cls: ClassId, build: string): FighterInput {
  const key = `${cls}:${build}`;
  const hit = fighters.get(key);
  if (hit) return hit;
  const s = BUILDS[cls][build]!;
  const hs0 = limitMechanics(cls, referenceSkills(cls, B.tierFor(B.jobForLevel(L)), B.jobForLevel(L), false, B, "gabarito"));
  const kit = s.kit.length ? s.kit : hs0.slots;
  const perks = s.perks.length ? s.perks : kit.slice(0, 2);
  const eq: Record<string, ItemInstance> = { arma: topItem(cls, { slot: "arma", family: s.weapon }, perks) };
  if (s.off) eq.secundaria = topItem(cls, { slot: "secundaria", offhand: s.off }, perks);
  for (const slot of ARMOR_SLOTS) eq[slot] = topItem(cls, { slot, weight: s.weight }, perks);
  eq.colar = topItem(cls, { slot: "colar" }, perks);
  eq.anel = topItem(cls, { slot: "anel" }, perks);
  const w = ATTR_BUILDS[s.attrs];
  const h: BalanceHero = {
    cls,
    level: L,
    job: B.jobForLevel(L),
    proficiency: B.recommendedProficiency(L),
    attrs: B.allocateByWeights(B.attributePoints(L), w ?? CLASSES[cls].referenceBuild),
    equipment: eq as Equipment,
  };
  const f = heroFighter(h, { ...hs0, slots: kit, ai: s.kit.length ? {} : hs0.ai }, { potions: { hp: R0.potionHp(L), mp: R0.potionMp(L), stock: 1000 } }, B, R0);
  fighters.set(key, f);
  return f;
}

const REGIOES = ALL_DUNGEONS.filter((d) => d.kind === "regional" && d.level >= 400);
const MASMORRAS = ALL_DUNGEONS.filter((d) => d.kind === "masmorra" && d.level >= 490);
/** Até onde vai: o nível da última vencida em ordem (0: nenhuma). */
function reach(party: FighterInput[], dgs: DungeonDef[]): number {
  let best = 0;
  for (const d of dgs) {
    if (simulateRun(d, party, { mode: "esperado" }, B, M).outcome !== "vitoria") break;
    best = d.level;
  }
  return best;
}

/** Composições com repetição (multiconjuntos) de um tamanho. */
function combos(size: number, start = 0, acc: ClassId[] = []): ClassId[][] {
  if (acc.length === size) return [[...acc]];
  const out: ClassId[][] = [];
  for (let i = start; i < CLASS_IDS.length; i++) out.push(...combos(size, i, [...acc, CLASS_IDS[i]!]));
  return out;
}
const roleCount = (c: ClassId[]) => {
  const n = { tanque: 0, suporte: 0, dps: 0 };
  for (const x of c) n[CLASSES[x].role as keyof typeof n]++;
  return `${n.tanque}T ${n.suporte}S ${n.dps}D`;
};

interface Res { comp: ClassId[]; build: string; regiao: number; masmorra: number }
const t0 = Date.now();
const A: Res[] = [];
for (const size of SIZES)
  for (const comp of combos(size))
    for (const build of ["classe", "solo"]) {
      const party = comp.map((c) => fighter(c, build));
      A.push({ comp, build, regiao: reach(party, REGIOES), masmorra: reach(party, MASMORRAS) });
    }
process.stderr.write(`A: ${A.length} grupos em ${Math.round((Date.now() - t0) / 1000)} s\n`);

const label = (r: Res) => `${r.comp.join(", ")}`;
const score = (r: Res) => r.regiao * 1000 + r.masmorra;
console.log("## A. Composições: até onde vão (Região 400→600, depois Masmorra 490→590)");
for (const build of ["classe", "solo"]) {
  const rs = A.filter((r) => r.build === build);
  const dist = new Map<number, number>();
  for (const r of rs) dist.set(r.regiao, (dist.get(r.regiao) ?? 0) + 1);
  console.log(`\n### builds: ${build} — ${rs.length} grupos; último chefe de Região vencido: ${[...dist.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k || "nenhum"}: ${v}`).join(" · ")}`);
  console.log(`zeram (vencem o chefe do 600): ${rs.filter((r) => r.regiao === 600).length}`);
  const top = [...rs].sort((a, b) => score(b) - score(a)).slice(0, 15);
  for (const r of top) console.log(`  ${String(r.regiao).padStart(3)} | Masmorra ${String(r.masmorra).padStart(3)} | ${roleCount(r.comp)} | ${label(r)}`);
}

// As perguntas diretas: paladino no lugar do guerreiro, 2 tanques + 2 suportes + 1 de dano.
console.log("\n## Paladino no lugar do guerreiro (mesmos outros 4)");
const find = (comp: ClassId[], build: string) => A.find((r) => r.build === build && r.comp.join() === [...comp].sort((a, b) => CLASS_IDS.indexOf(a) - CLASS_IDS.indexOf(b)).join());
for (const rest of [["padre", "mago", "cacador", "assassino"], ["druida", "mago", "cacador", "assassino"], ["padre", "druida", "mago", "cacador"], ["padre", "druida", "mago", "assassino"], ["padre", "padre", "mago", "assassino"]] as ClassId[][])
  for (const build of ["classe", "solo"]) {
    const gu = find(["guerreiro", ...rest], build)!;
    const pa = find(["paladino", ...rest], build)!;
    console.log(`  ${build.padEnd(6)} + ${rest.join(", ")}: guerreiro → Região ${gu.regiao}, Masmorra ${gu.masmorra} · paladino → Região ${pa.regiao}, Masmorra ${pa.masmorra}`);
  }
console.log("\n## 2 tanques + 2 suportes + 1 de dano");
for (const build of ["classe", "solo"]) {
  const rs = A.filter((r) => r.build === build && roleCount(r.comp) === "2T 2S 1D").sort((a, b) => score(b) - score(a));
  for (const r of rs) console.log(`  ${build.padEnd(6)} Região ${String(r.regiao).padStart(3)} | Masmorra ${String(r.masmorra).padStart(3)} | ${label(r)}`);
}

// B) As builds de cada classe nos 5 melhores grupos (build da classe) que têm a classe.
console.log("\n## B. Builds: cada uma no lugar da classe nos 5 melhores grupos de 5 com ela");
const B5 = A.filter((r) => r.build === "classe" && r.comp.length === 5);
const outB: Record<string, unknown> = {};
for (const cls of CLASS_IDS) {
  const hosts = B5.filter((r) => r.comp.includes(cls)).sort((a, b) => score(b) - score(a)).slice(0, 5);
  console.log(`\n### ${cls} (grupos: ${hosts.map((h) => h.comp.map((c) => c.slice(0, 3)).join("+")).join(" | ")})`);
  for (const build of Object.keys(BUILDS[cls])) {
    const res = hosts.map((h) => {
      const i = h.comp.indexOf(cls);
      const party = h.comp.map((c, k) => fighter(c, k === i ? build : "classe"));
      return { regiao: reach(party, REGIOES), masmorra: reach(party, MASMORRAS) };
    });
    outB[`${cls}:${build}`] = res;
    const avg = (k: "regiao" | "masmorra") => Math.round(res.reduce((a, x) => a + x[k], 0) / res.length);
    console.log(`  ${build.padEnd(20)} Região ${res.map((x) => x.regiao || "—").join(" / ")} (média ${avg("regiao")}) · Masmorra ${res.map((x) => x.masmorra || "—").join(" / ")}`);
  }
}
process.stderr.write(`fim em ${Math.round((Date.now() - t0) / 1000)} s\n`);
if (OUT) writeFileSync(OUT, JSON.stringify({ A, B: outB }));
process.exit(0);
