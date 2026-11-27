/* global console, process */
// As builds que mais avançaram sozinhas (scripts/solo-ceiling.ts, 27/11/2026) jogando em grupo. O dono:
// "pega a build vencedora no solo e roda em grupo; paladino de besta e suporte de cetro e escudo
// conseguem segurar o grupo?"
//
//   node scripts/group-builds.ts
//
// Contextos (os grupos que calibram o jogo, D53):
//   farm   — a Masmorra do nível com o trio do farm um pouco ABAIXO do limite (37 Masmorras);
//   limite — a Masmorra do nível com a PT de 5 no limite (folgada por design);
//   regiao — a Região do nível com 4 no limite (apertada).
// "classe" é a build de referência; "solo" troca arma, mão secundária, armadura, atributos e kit pela
// vencedora do solo, no mesmo equipamento do perfil (raridade, refino e afixos), sem lendário (o perfil
// do limite não veste lendário). No fim, o topo: nível 500, Lendário +10 com afixos no teto e o melhor
// par de perks em todas as peças, nas duas builds.
import type { FighterInput } from "../src/game/ot/balance/combat/types.ts";
import {
  type ArmorWeight,
  type ClassId,
  type FamilyId,
  type OffhandId,
  type Stat,
  ARMOR_SLOTS,
  CLASSES,
  STATS,
} from "../src/game/ot/balance/content.ts";
import { type DungeonDef, DUNGEONS } from "../src/game/ot/balance/dungeons/catalog.ts";
import type { BalanceHero, Equipment, ItemInstance } from "../src/game/ot/balance/equipment.ts";
import { heroFighter } from "../src/game/ot/balance/fighter.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { affixCount, affixRange } from "../src/game/ot/balance/items/generate.ts";
import { PERKS } from "../src/game/ot/balance/items/perks.ts";
import { refinable } from "../src/game/ot/balance/items/smith.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { createReference } from "../src/game/ot/balance/reference.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import { FARM_TRIOS, LIMIT_GROUP_PARTIES, REGION_PARTIES } from "../src/game/ot/balance/sim/calibration.ts";
import { limitMechanics, referenceSkills } from "../src/game/ot/balance/sim/encounters.ts";

interface Spec {
  weapon: FamilyId;
  off: OffhandId | null;
  weight: ArmorWeight;
  attrs: string;
  kit: string[];
  perks: string[];
}
/** As vencedoras do solo no nível 500 (scripts/solo-ceiling.ts, motor de 92c36a272). */
const SOLO: Record<ClassId, Spec> = {
  guerreiro: { weapon: "martelo", off: null, weight: "pesada", attrs: "misto", kit: ["golpe-provocador", "grito-de-guerra", "redemoinho", "estandarte-de-guerra"], perks: ["golpe-provocador", "grito-de-guerra"] },
  paladino: { weapon: "besta", off: "aljava", weight: "pesada", attrs: "destreza", kit: ["golpe-sagrado", "escudo-da-fe", "consagracao", "imposicao-de-maos"], perks: ["escudo-da-fe", "consagracao"] },
  padre: { weapon: "cetro", off: "escudo", weight: "media", attrs: "classe", kit: ["curar", "luz-sagrada", "escudo-sagrado", "bencao"], perks: ["escudo-sagrado", "bencao"] },
  druida: { weapon: "cetro", off: "escudo", weight: "pesada", attrs: "classe", kit: ["rejuvenescer", "espinhos", "cancao-da-floresta", "raizes"], perks: ["espinhos", "cancao-da-floresta"] },
  mago: { weapon: "cetro", off: "escudo", weight: "leve", attrs: "inteligencia", kit: ["seta-arcana", "nevasca", "escudo-de-mana", "raio-em-cadeia"], perks: ["seta-arcana", "raio-em-cadeia"] },
  cacador: { weapon: "besta", off: "aljava", weight: "pesada", attrs: "classe", kit: ["rajada-dupla", "marca-do-cacador", "foco-mortal", "tiro-perfurante"], perks: ["marca-do-cacador", "foco-mortal"] },
  assassino: { weapon: "arco", off: "aljava", weight: "media", attrs: "misto", kit: ["lamina-envenenada", "sequencia-letal", "emboscada", "danca-das-laminas"], perks: ["lamina-envenenada", "sequencia-letal"] },
};
const ATTR_BUILDS: Record<string, readonly (readonly [Stat, number])[] | null> = {
  classe: null,
  forca: [["FOR", 70], ["VIT", 30]],
  destreza: [["DES", 70], ["AGI", 30]],
  inteligencia: [["INT", 70], ["VIT", 30]],
  critico: [["AGI", 50], ["SOR", 50]],
  tanque: [["VIT", 70], ["FOR", 30]],
  misto: STATS.map((s) => [s, 1] as const),
};

const RL = createReference(B, "limite");
const R0 = createReference(B);
const M = createMonsters(B);
type Ctx = "farm" | "limite" | "regiao" | "topo";
type Build = "classe" | "solo";
type Member = [ClassId, Build];

/** Troca arma, mão secundária e o peso da armadura mantendo raridade, refino e afixos de cada peça. */
function withItems(h: BalanceHero, s: Spec): BalanceHero {
  const eq = { ...h.equipment } as Equipment & Record<string, unknown>;
  const w = h.equipment.arma!;
  eq.arma = { ...w, family: s.weapon };
  if (s.off) {
    const cur = h.equipment.secundaria;
    eq.secundaria =
      cur && cur.offhand === s.off
        ? cur
        : { ilvl: w.ilvl, rarity: w.rarity, refine: s.off === "escudo" ? w.refine : 0, slot: "secundaria", offhand: s.off, affixes: cur?.affixes ?? [] };
  } else delete eq.secundaria;
  for (const slot of ARMOR_SLOTS) {
    const p = h.equipment[slot];
    if (p) eq[slot] = { ...p, weight: s.weight };
  }
  return { ...h, equipment: eq as Equipment };
}

/** O item no topo (como em solo-ceiling.ts): Lendário iL 500, +10, afixos do plano no teto, os perks no máximo. */
function topItem(cls: ClassId, base: Partial<ItemInstance> & { slot: string }, perks: string[]): ItemInstance {
  const plan = (B.cfg.limit.affixPlan as Record<string, Record<string, string[]>>)[cls] ?? {};
  const n = affixCount(base.slot as never, "lendario");
  const affixes = (plan[base.slot] ?? []).slice(0, n).map((id) => ({ id: id as never, value: affixRange(id as never, 500, "lendario", B).max }));
  const it = { ilvl: 500, rarity: "lendario", refine: 0, affixes, ...base } as ItemInstance;
  return { ...it, refine: refinable(it) ? 10 : 0, perks: perks.map((skill) => ({ skill, value: PERKS[skill]!.max })) } as ItemInstance;
}

function topHero(cls: ClassId, s: Spec): BalanceHero {
  const eq: Record<string, ItemInstance> = { arma: topItem(cls, { slot: "arma", family: s.weapon }, s.perks) };
  if (s.off) eq.secundaria = topItem(cls, { slot: "secundaria", offhand: s.off }, s.perks);
  for (const slot of ARMOR_SLOTS) eq[slot] = topItem(cls, { slot, weight: s.weight }, s.perks);
  eq.colar = topItem(cls, { slot: "colar" }, s.perks);
  eq.anel = topItem(cls, { slot: "anel" }, s.perks);
  const w = ATTR_BUILDS[s.attrs];
  return {
    cls,
    level: 500,
    job: B.jobForLevel(500),
    proficiency: B.recommendedProficiency(500),
    attrs: B.allocateByWeights(B.attributePoints(500), w ?? CLASSES[cls].referenceBuild),
    equipment: eq as Equipment,
  };
}

/** A build da classe no topo: a arma, a mão e a armadura de referência, os atributos da classe e o melhor par de perks do kit de grupo. */
function classTopSpec(cls: ClassId): Spec {
  const c = CLASSES[cls];
  const hs = referenceSkills(cls, B.tierFor(B.jobForLevel(500)), B.jobForLevel(500), false, B, "gabarito");
  return { weapon: c.referenceWeapon, off: c.referenceOffhand, weight: c.armor, attrs: "classe", kit: hs.slots, perks: hs.slots.slice(0, 2) };
}

function fighter(cls: ClassId, L: number, build: Build, ctx: Ctx): FighterInput {
  const spec = build === "solo" ? SOLO[cls] : null;
  let h: BalanceHero;
  if (ctx === "topo") h = topHero(cls, spec ?? classTopSpec(cls));
  else {
    h = ctx === "farm" ? R0.referenceBalanceHero(cls, L, { refine: B.cfg.limit.farmRefine }) : RL.referenceBalanceHero(cls, L);
    if (spec) {
      h = withItems(h, spec);
      const w = ATTR_BUILDS[spec.attrs];
      if (w) h = { ...h, attrs: B.allocateByWeights(B.attributePoints(L), w) };
    }
  }
  let hs = referenceSkills(cls, B.tierFor(h.job), h.job, false, B, "gabarito");
  if (ctx !== "farm") hs = limitMechanics(cls, hs);
  if (spec) hs = { ...hs, slots: spec.kit, ai: {} };
  return heroFighter(h, hs, { potions: { hp: R0.potionHp(h.level), mp: R0.potionMp(h.level), stock: 100 } }, B, R0);
}

interface Score { won: number; total: number; deaths: number; seconds: number; lost: number[] }
function play(party: Member[], ctx: Ctx, dgs: DungeonDef[]): Score {
  const s: Score = { won: 0, total: 0, deaths: 0, seconds: 0, lost: [] };
  for (const d of dgs) {
    const L = ctx === "topo" ? 500 : d.level;
    const r = simulateRun(d, party.map(([c, b]) => fighter(c, L, b, ctx)), { mode: "esperado" }, B, M);
    s.total++;
    s.deaths += r.rooms.reduce((a, x) => a + x.deaths, 0);
    if (r.outcome === "vitoria") {
      s.won++;
      s.seconds += r.seconds;
    } else s.lost.push(d.level);
  }
  return s;
}
const fmt = (s: Score) =>
  `vence ${s.won}/${s.total}${s.won ? `, ${Math.round(s.seconds / s.won)} s em média` : ""}, ${s.deaths} mortes${s.lost.length && s.lost.length <= 6 ? ` (perde ${s.lost.join(", ")})` : ""}`;

const MASMORRAS = DUNGEONS.filter((d) => d.kind === "masmorra");
const REGIOES = DUNGEONS.filter((d) => d.kind === "regional");
const short = (p: Member[]) => p.map(([c, b]) => `${c.slice(0, 3)}${b === "solo" ? "*" : ""}`).join("+");

// 1) Cada classe trocando só a própria build, nos grupos de calibração em que ela está.
console.log("## 1. Só a classe troca para a build do solo (* = build do solo)");
const CONTEXTS: [Ctx, readonly (readonly ClassId[])[], DungeonDef[]][] = [
  ["farm", FARM_TRIOS, MASMORRAS],
  ["limite", LIMIT_GROUP_PARTIES, MASMORRAS],
  ["regiao", REGION_PARTIES, REGIOES],
];
for (const cls of Object.keys(SOLO) as ClassId[])
  for (const [ctx, parties, dgs] of CONTEXTS)
    for (const p of parties) {
      if (!p.includes(cls)) continue;
      const base: Member[] = p.map((c) => [c, "classe"]);
      const swap: Member[] = p.map((c) => [c, c === cls ? "solo" : "classe"]);
      console.log(`${cls.padEnd(9)} ${ctx.padEnd(6)} ${short(base).padEnd(26)} classe: ${fmt(play(base, ctx, dgs))}`);
      console.log(`${"".padEnd(9)} ${"".padEnd(6)} ${short(swap).padEnd(26)} solo:   ${fmt(play(swap, ctx, dgs))}`);
    }

// 2) Paladino de tanque único × suporte de cura único: da classe ou do solo.
console.log("\n## 2. Paladino tanque único × suporte (padre ou druida), cada um da classe ou do solo");
const DUOS: [Ctx, ClassId[], DungeonDef[], string][] = [
  ["farm", ["paladino", "druida", "cacador"], MASMORRAS, "trio do farm (calibração)"],
  ["farm", ["paladino", "padre", "mago"], MASMORRAS, "trio do farm com padre (fora da calibração)"],
  ["limite", ["paladino", "padre", "mago", "cacador", "assassino"], MASMORRAS, "PT de 5 no limite (calibração, D50)"],
  ["limite", ["paladino", "druida", "mago", "cacador", "assassino"], MASMORRAS, "PT de 5 no limite (calibração, D50)"],
  ["regiao", ["paladino", "padre", "mago", "assassino"], REGIOES, "Região, tanque único (fora da calibração)"],
  ["regiao", ["paladino", "druida", "mago", "assassino"], REGIOES, "Região, tanque único (fora da calibração)"],
];
for (const [ctx, comp, dgs, what] of DUOS) {
  console.log(`- ${what}: ${comp.join(", ")}`);
  for (const pb of ["classe", "solo"] as Build[])
    for (const sb of ["classe", "solo"] as Build[]) {
      const party: Member[] = comp.map((c) => [c, c === "paladino" ? pb : CLASSES[c].role === "suporte" ? sb : "classe"]);
      console.log(`    paladino ${pb.padEnd(6)} + suporte ${sb.padEnd(6)}: ${fmt(play(party, ctx, dgs))}`);
    }
}

// 3) O topo (nível 500, tudo no máximo, com perks): a PT toda da classe × a PT toda do solo.
console.log("\n## 3. Topo: nível 500, Lendário +10, afixos no teto, perks no máximo");
const TOP_DGS = [...MASMORRAS.filter((d) => d.level >= 410), ...REGIOES.filter((d) => d.level >= 400)];
for (const comp of [
  ["guerreiro", "padre", "mago", "cacador", "assassino"],
  ["paladino", "padre", "mago", "cacador", "assassino"],
  ["paladino", "druida", "mago", "cacador", "assassino"],
] as ClassId[][]) {
  for (const b of ["classe", "solo"] as Build[]) {
    const party: Member[] = comp.map((c) => [c, b]);
    console.log(`${short(party).padEnd(30)} ${b.padEnd(6)}: ${fmt(play(party, "topo", TOP_DGS))}`);
  }
}
process.exit(0);
