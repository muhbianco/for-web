/* global console, process */
// Quem vence o chefe do 600 (O Último Rei, Região 12) e por que os outros perdem (27/11/2026, o dono:
// "antes de propor solução, procura mais grupos que vencem o 600; vamos entender olhando mais de cima").
//
//   node scripts/endgame-600.ts [--out arquivo.json] [--near 60]
//
// Todos no topo (nível 500, Lendário +10, afixos no teto, perks no máximo). Uma corrida por grupo na
// Região 12, guardando: venceu, sala em que caiu, vida que sobrou no chefe, 1ª morte (classe, causa,
// segundo), mortes, se a luta passou do Cataclismo.
//   Etapa 1: as 756 composições de 3 a 5 (as 7 classes, com repetição), com todos na build da classe,
//            todos na do solo e cada herói trocando sozinho para cada build alternativa da classe dele.
//   Etapa 2: nos `--near` grupos que chegaram mais perto, dois heróis trocando ao mesmo tempo.
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
import { dungeonById, edgeOf } from "../src/game/ot/balance/dungeons/catalog.ts";
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
const OUT = arg("out", "");
const NEAR = Number(arg("near", "60"));

interface Spec {
  weapon: FamilyId;
  off: OffhandId | null;
  weight: ArmorWeight;
  attrs: string;
  kit: string[];
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
/** As builds de cada classe: a da classe, a vencedora do solo e alternativas (armas, atributos e o peso acima). */
const BUILDS: Record<ClassId, Record<string, Spec>> = {
  guerreiro: {
    classe: g("espada", "escudo", "pesada", "classe"),
    solo: { weapon: "martelo", off: null, weight: "pesada", attrs: "misto", kit: ["golpe-provocador", "grito-de-guerra", "redemoinho", "estandarte-de-guerra"], perks: ["golpe-provocador", "grito-de-guerra"] },
    VIT: g("espada", "escudo", "pesada", "tanque"),
    "força machado": g("machado", null, "pesada", "forca"),
  },
  paladino: {
    classe: g("espada", "escudo", "pesada", "classe"),
    solo: { weapon: "besta", off: "aljava", weight: "pesada", attrs: "destreza", kit: ["golpe-sagrado", "escudo-da-fe", "consagracao", "imposicao-de-maos"], perks: ["escudo-da-fe", "consagracao"] },
    VIT: g("espada", "escudo", "pesada", "tanque"),
    "força martelo": g("martelo", null, "pesada", "forca"),
  },
  padre: {
    classe: g("cajado", null, "leve", "classe"),
    solo: { weapon: "cetro", off: "escudo", weight: "media", attrs: "classe", kit: ["curar", "luz-sagrada", "escudo-sagrado", "bencao"], perks: ["escudo-sagrado", "bencao"] },
    INT: g("cajado", null, "leve", "inteligencia"),
    "maça+escudo": g("maca", "escudo", "leve", "classe"),
    "cajado média (acima)": g("cajado", null, "media", "classe"),
  },
  druida: {
    classe: g("bastao", null, "media", "classe"),
    solo: { weapon: "cetro", off: "escudo", weight: "pesada", attrs: "classe", kit: ["rejuvenescer", "espinhos", "cancao-da-floresta", "raizes"], perks: ["espinhos", "cancao-da-floresta"] },
    cajado: g("cajado", null, "media", "classe"),
    "cajado pesada (acima)": g("cajado", null, "pesada", "classe"),
    "cetro+escudo média": g("cetro", "escudo", "media", "classe"),
    "katar misto": g("katar", null, "media", "misto"),
  },
  mago: {
    classe: g("cajado", null, "leve", "classe"),
    solo: { weapon: "cetro", off: "escudo", weight: "leve", attrs: "inteligencia", kit: ["seta-arcana", "nevasca", "escudo-de-mana", "raio-em-cadeia"], perks: ["seta-arcana", "raio-em-cadeia"] },
    INT: g("cajado", null, "leve", "inteligencia"),
    "cetro+foco": g("cetro", "focus", "leve", "classe"),
    "cajado média (acima)": g("cajado", null, "media", "classe"),
  },
  cacador: {
    classe: g("arco", "aljava", "media", "classe"),
    solo: { weapon: "besta", off: "aljava", weight: "pesada", attrs: "classe", kit: ["rajada-dupla", "marca-do-cacador", "foco-mortal", "tiro-perfurante"], perks: ["marca-do-cacador", "foco-mortal"] },
    DES: g("arco", "aljava", "media", "destreza"),
    "arco pesada (acima)": g("arco", "aljava", "pesada", "classe"),
  },
  assassino: {
    classe: g("katar", null, "media", "classe"),
    solo: { weapon: "arco", off: "aljava", weight: "media", attrs: "misto", kit: ["lamina-envenenada", "sequencia-letal", "emboscada", "danca-das-laminas"], perks: ["lamina-envenenada", "sequencia-letal"] },
    "crítico": g("katar", null, "media", "critico"),
    "adaga+punhal": g("adaga", "punhal", "media", "classe"),
    "katar pesada (acima)": g("katar", null, "pesada", "classe"),
  },
};

const L = 500;
const R0 = createReference(B);
const M = createMonsters(B);
const BOSS = dungeonById("regiao-12")!;
const CATACLYSM = edgeOf(BOSS)?.cataclysmAt ?? B.cfg.monsters.cataclysmAtSeconds;

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

type Member = [ClassId, string];
interface Fight {
  members: Member[];
  win: boolean;
  /** Salas vencidas antes de cair (4: venceu). */
  rooms: number;
  /** Vida que sobrou no chefe (0–1; 1 se nem chegou nele). */
  bossLeft: number;
  bossSeconds: number;
  firstDeath: { cls: ClassId; cause: string; seconds: number; room: number } | null;
  deaths: number;
  cataclysm: boolean;
}

function fight(members: Member[]): Fight {
  const r = simulateRun(BOSS, members.map(([c, b]) => fighter(c, b)), { mode: "esperado" }, B, M);
  const rooms = r.rooms.filter((x) => x.win).length;
  const boss = r.rooms.length === 4 ? r.rooms[3]! : null;
  let firstDeath: Fight["firstDeath"] = null;
  r.rooms.forEach((room, i) => {
    if (!firstDeath && room.firstDeath) firstDeath = { ...room.firstDeath, room: i + 1 };
  });
  return {
    members,
    win: r.outcome === "vitoria",
    rooms,
    bossLeft: boss ? (boss.enemiesLeft[0] ?? 0) : 1,
    bossSeconds: boss?.seconds ?? 0,
    firstDeath,
    deaths: r.rooms.reduce((a, x) => a + x.deaths, 0),
    cataclysm: (boss?.seconds ?? 0) >= CATACLYSM,
  };
}
/** Quão perto chegou: vitória acima de tudo; depois salas e o quanto tirou do chefe. */
const closeness = (f: Fight) => (f.win ? 10 : f.rooms + (1 - f.bossLeft));

function combos(size: number, start = 0, acc: ClassId[] = []): ClassId[][] {
  if (acc.length === size) return [[...acc]];
  const out: ClassId[][] = [];
  for (let i = start; i < CLASS_IDS.length; i++) out.push(...combos(size, i, [...acc, CLASS_IDS[i]!]));
  return out;
}

const t0 = Date.now();
const all: Fight[] = [];
// Etapa 1.
const bestByComp = new Map<string, Fight>();
for (const size of [3, 4, 5])
  for (const comp of combos(size)) {
    const variants: Member[][] = [comp.map((c) => [c, "classe"] as Member), comp.map((c) => [c, "solo"] as Member)];
    comp.forEach((c, i) => {
      if (comp.indexOf(c) !== i) return; // a 1ª vez que a classe aparece basta
      for (const b of Object.keys(BUILDS[c])) {
        if (b === "classe") continue;
        variants.push(comp.map((x, k) => [x, k === i ? b : "classe"] as Member));
      }
    });
    for (const v of variants) {
      const f = fight(v);
      all.push(f);
      const key = comp.join();
      if (!bestByComp.has(key) || closeness(f) > closeness(bestByComp.get(key)!)) bestByComp.set(key, f);
    }
  }
process.stderr.write(`etapa 1: ${all.length} lutas em ${Math.round((Date.now() - t0) / 1000)} s\n`);
// Etapa 2: os mais perto, dois heróis trocando.
const near = [...bestByComp.values()].sort((a, b) => closeness(b) - closeness(a)).slice(0, NEAR);
let n2 = 0;
for (const base of near) {
  const comp = base.members.map(([c]) => c);
  for (let i = 0; i < comp.length; i++)
    for (let j = i + 1; j < comp.length; j++)
      for (const bi of Object.keys(BUILDS[comp[i]!]))
        for (const bj of Object.keys(BUILDS[comp[j]!])) {
          if (bi === "classe" && bj === "classe") continue;
          all.push(fight(comp.map((c, k) => [c, k === i ? bi : k === j ? bj : "classe"] as Member)));
          n2++;
        }
}
process.stderr.write(`etapa 2: ${n2} lutas; total ${all.length} em ${Math.round((Date.now() - t0) / 1000)} s\n`);

// ------------------------------------------------------------ olhando de cima
const name = (f: Fight) => f.members.map(([c, b]) => (b === "classe" ? c : `${c} [${b}]`)).join(", ");
const wins = all.filter((f) => f.win);
const seen = new Set<string>();
const uniq = wins.filter((f) => {
  const k = name(f);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
console.log(`## Lutas no chefe do 600: ${all.length}; vitórias: ${uniq.length} arranjos diferentes`);
for (const f of uniq.slice(0, 60)) console.log(`  ✔ ${name(f)} (${Math.round(f.bossSeconds)} s, ${f.deaths} mortes${f.cataclysm ? ", com Cataclismo" : ""})`);

const base = all.filter((f) => f.members.every(([, b]) => b === "classe"));
const pct = (n: number, d: number) => `${Math.round((100 * n) / Math.max(1, d))}%`;
const tally = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
console.log(`\n## Onde os ${base.length} grupos (build da classe) perdem`);
console.log("sala em que caem: " + tally(base.filter((f) => !f.win), (f) => (f.rooms < 3 ? `sala ${f.rooms + 1}` : "chefe")).map(([k, v]) => `${k} ${pct(v, base.length)}`).join(" · "));
const atBoss = base.filter((f) => !f.win && f.rooms === 3);
console.log(`no chefe (${atBoss.length}): vida que sobrou nele — ` + tally(atBoss, (f) => (f.bossLeft < 0.1 ? "<10%" : f.bossLeft < 0.25 ? "10–25%" : f.bossLeft < 0.5 ? "25–50%" : "≥50%")).map(([k, v]) => `${k}: ${v}`).join(" · "));
console.log("  passaram do Cataclismo: " + pct(atBoss.filter((f) => f.cataclysm).length, atBoss.length));
console.log("  1ª morte, causa: " + tally(atBoss, (f) => f.firstDeath?.cause ?? "—").map(([k, v]) => `${k} ${pct(v, atBoss.length)}`).join(" · "));
console.log("  1ª morte, classe: " + tally(atBoss, (f) => f.firstDeath?.cls ?? "—").map(([k, v]) => `${k} ${pct(v, atBoss.length)}`).join(" · "));
const t = (f: Fight) => f.firstDeath?.seconds ?? 0;
console.log("  1ª morte, segundo da luta: " + tally(atBoss, (f) => (t(f) < 30 ? "<30 s" : t(f) < 60 ? "30–60 s" : t(f) < 100 ? "60–100 s" : t(f) < CATACLYSM ? `100–${CATACLYSM} s` : "no Cataclismo")).map(([k, v]) => `${k}: ${v}`).join(" · "));

console.log("\n## O que as vitórias têm");
const roleOf = (f: Fight) => {
  const n = { tanque: 0, suporte: 0, dps: 0 };
  for (const [c] of f.members) n[CLASSES[c].role as keyof typeof n]++;
  return `${n.tanque}T ${n.suporte}S ${n.dps}D`;
};
console.log("papéis: " + tally(uniq, roleOf).map(([k, v]) => `${k}: ${v}`).join(" · "));
console.log("tamanho: " + tally(uniq, (f) => `${f.members.length} heróis`).map(([k, v]) => `${k}: ${v}`).join(" · "));
console.log("classes presentes: " + tally(uniq.flatMap((f) => [...new Set(f.members.map(([c]) => c))]), (c) => c).map(([k, v]) => `${k} ${pct(v, uniq.length)}`).join(" · "));
console.log("builds fora da classe: " + tally(uniq.flatMap((f) => f.members.filter(([, b]) => b !== "classe").map(([c, b]) => `${c} [${b}]`)), (x) => x).map(([k, v]) => `${k}: ${v}`).join(" · "));
process.stderr.write(`fim em ${Math.round((Date.now() - t0) / 1000)} s\n`);
if (OUT) writeFileSync(OUT, JSON.stringify(all));
process.exit(0);
