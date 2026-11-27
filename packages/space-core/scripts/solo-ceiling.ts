/* global console, process */
// O teto do herói sozinho (27/11/2026, pedido do dono): um herói de cada classe no nível 500, com o
// melhor que o jogo dá — Lendário iL 500, refino +10, os afixos do plano da classe no teto da faixa do
// Lendário (D64), os melhores atributos e os 2 melhores perks lendários (no valor máximo) em cada peça
// — joga todas as DGs sozinho. Até onde cada um chega?
//
//   node scripts/solo-ceiling.ts [--classes mago,cacador] [--out arquivo.json]
//
// Os perks somam entre as peças (items/legendary.ts → compileLoadout): com ~6 skills por classe e 8
// peças × 2 perks, o teto real é o melhor par empilhado em todas. Busca em 2 etapas, cada candidato
// jogando as 97 DGs (Caçada, Masmorra, Região) no modo esperado:
//   1) arma × mão secundária × armadura (natural ou um peso acima) × 7 perfis de atributo, kit solo de
//      referência, sem perk;
//   2) os 3 melhores da etapa 1 × todos os kits de 4 skills × todos os pares de perk do kit.
// Nota: vitórias por tipo (Região, Masmorra, Caçada) e, no empate, o quanto avança na 1ª que perde.
import { writeFileSync } from "node:fs";

import type { FighterInput } from "../src/game/ot/balance/combat/types.ts";
import {
  type ArmorWeight,
  type ClassId,
  type FamilyId,
  type OffhandId,
  type Stat,
  ARMOR_SLOTS,
  ARMOR_WEIGHTS,
  CLASS_IDS,
  CLASSES,
  FAMILIES,
  STATS,
} from "../src/game/ot/balance/content.ts";
import { type DungeonDef, DUNGEONS } from "../src/game/ot/balance/dungeons/catalog.ts";
import {
  type BalanceHero,
  type Equipment,
  type ItemInstance,
  armorFit,
  offhandMismatch,
} from "../src/game/ot/balance/equipment.ts";
import { heroFighter } from "../src/game/ot/balance/fighter.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { affixCount, affixRange } from "../src/game/ot/balance/items/generate.ts";
import { PERKS } from "../src/game/ot/balance/items/perks.ts";
import { refinable } from "../src/game/ot/balance/items/smith.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { createReference } from "../src/game/ot/balance/reference.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import { limitMechanics, referenceSkills } from "../src/game/ot/balance/sim/encounters.ts";
import {
  type HeroSkills,
  MAX_SLOTS,
  learnableSkills,
} from "../src/game/ot/balance/skills/tree.ts";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const ONLY = arg("classes", "");
const RUN_CLASSES = (ONLY ? ONLY.split(",") : [...CLASS_IDS]) as ClassId[];
const OUT = arg("out", "");

const L = 500;
const R0 = createReference(B);
const M = createMonsters(B);
const LADDER = [...DUNGEONS].sort((a, b) => a.level - b.level);
const KINDS = ["regional", "masmorra", "cacada"] as const;

const ATTR_BUILDS: Record<string, readonly (readonly [Stat, number])[] | null> = {
  classe: null,
  forca: [["FOR", 70], ["VIT", 30]],
  destreza: [["DES", 70], ["AGI", 30]],
  inteligencia: [["INT", 70], ["VIT", 30]],
  critico: [["AGI", 50], ["SOR", 50]],
  tanque: [["VIT", 70], ["FOR", 30]],
  misto: STATS.map((s) => [s, 1] as const),
};

interface Spec {
  weapon: FamilyId;
  off: OffhandId | null;
  weight: ArmorWeight;
  attrs: string;
  kit: string[];
  perks: string[];
}

/** O item no topo: Lendário iL 500, refino +10 se refina, afixos do plano no teto, os perks no máximo. */
function topItem(cls: ClassId, base: Partial<ItemInstance> & { slot: string }, perks: string[]): ItemInstance {
  const plan = (B.cfg.limit.affixPlan as Record<string, Record<string, string[]>>)[cls] ?? {};
  const n = affixCount(base.slot as never, "lendario");
  const affixes = (plan[base.slot] ?? []).slice(0, n).map((id) => ({
    id: id as never,
    value: affixRange(id as never, L, "lendario", B).max,
  }));
  const it = { ilvl: L, rarity: "lendario", refine: 0, affixes, ...base } as ItemInstance;
  const out = { ...it, refine: refinable(it) ? 10 : 0 } as ItemInstance;
  if (perks.length > 0)
    (out as ItemInstance & { perks: unknown }).perks = perks.map((skill) => ({
      skill,
      value: PERKS[skill]!.max,
    }));
  return out;
}

function heroOf(cls: ClassId, s: Spec): BalanceHero {
  const eq: Record<string, ItemInstance> = {
    arma: topItem(cls, { slot: "arma", family: s.weapon }, s.perks),
  };
  if (s.off) eq.secundaria = topItem(cls, { slot: "secundaria", offhand: s.off }, s.perks);
  for (const slot of ARMOR_SLOTS) eq[slot] = topItem(cls, { slot, weight: s.weight }, s.perks);
  eq.colar = topItem(cls, { slot: "colar" }, s.perks);
  eq.anel = topItem(cls, { slot: "anel" }, s.perks);
  const w = ATTR_BUILDS[s.attrs];
  return {
    cls,
    level: L,
    job: B.jobForLevel(L),
    proficiency: B.recommendedProficiency(L),
    attrs: B.allocateByWeights(B.attributePoints(L), w ?? CLASSES[cls].referenceBuild),
    equipment: eq as Equipment,
  };
}

function skillsOf(cls: ClassId, kit: string[] | null): HeroSkills {
  const job = B.jobForLevel(L);
  const hs = limitMechanics(cls, referenceSkills(cls, B.tierFor(job), job, true, B, "gabarito"));
  return kit ? { ...hs, slots: kit, ai: {} } : hs;
}

function fighterOf(cls: ClassId, s: Spec): FighterInput {
  return heroFighter(
    heroOf(cls, s),
    skillsOf(cls, s.kit.length ? s.kit : null),
    { potions: { hp: R0.potionHp(L), mp: R0.potionMp(L), stock: 1000 } },
    B,
    R0,
  );
}

interface Ladder {
  won: Record<string, number>;
  best: Record<string, number>;
  firstLoss: Record<string, { id: string; level: number; progress: number } | null>;
  score: number;
}

/** Quanto da corrida a derrota andou: salas vencidas e o quanto o último inimigo perdeu. */
function progressOf(d: DungeonDef, r: ReturnType<typeof simulateRun>): number {
  const rooms = r.rooms.length;
  const last = r.rooms.at(-1);
  const left = last ? last.enemiesLeft.reduce((a, x) => a + x, 0) / Math.max(1, last.enemiesLeft.length) : 1;
  const total = Math.max(rooms, d.kind === "cacada" ? 4 : 4);
  return Math.min(1, (rooms - 1 + (1 - left)) / total);
}

function ladder(f: FighterInput): Ladder {
  const won: Record<string, number> = { regional: 0, masmorra: 0, cacada: 0 };
  const best: Record<string, number> = { regional: 0, masmorra: 0, cacada: 0 };
  const firstLoss: Ladder["firstLoss"] = { regional: null, masmorra: null, cacada: null };
  for (const d of LADDER) {
    const r = simulateRun(d, [f], { mode: "esperado" }, B, M);
    if (r.outcome === "vitoria") {
      won[d.kind]!++;
      best[d.kind] = Math.max(best[d.kind]!, d.level);
    } else if (!firstLoss[d.kind]) {
      firstLoss[d.kind] = { id: d.id, level: d.level, progress: progressOf(d, r) };
    }
  }
  const prog = (k: string) => firstLoss[k]?.progress ?? 1;
  const score =
    won.regional! * 1e6 + won.masmorra! * 1e4 + won.cacada! * 100 +
    prog("regional") * 10 + prog("masmorra") + prog("cacada") * 0.1;
  return { won, best, firstLoss, score };
}

const kitsOf = (cls: ClassId): string[][] => {
  const tier = B.tierFor(B.jobForLevel(L));
  const ids = learnableSkills(cls, tier).map((s) => s.id);
  const n = Math.min(MAX_SLOTS, ids.length);
  const out: string[][] = [];
  const pick = (start: number, acc: string[]) => {
    if (acc.length === n) return void out.push([...acc]);
    for (let i = start; i < ids.length; i++) pick(i + 1, [...acc, ids[i]!]);
  };
  pick(0, []);
  return out;
};

const results: Record<string, unknown> = {};
const t0 = Date.now();
for (const cls of RUN_CLASSES) {
  const c = CLASSES[cls];
  // Etapa 1: itens × atributos, kit solo de referência, sem perk.
  const stage1: { s: Spec; l: Ladder }[] = [];
  for (const weapon of c.weapons)
    for (const off of [null, ...c.offhands.filter((o) => offhandMismatch(o, FAMILIES[weapon]) === null)])
      for (const weight of ARMOR_WEIGHTS) {
        if (!armorFit(cls, weight)) continue;
        for (const attrs of Object.keys(ATTR_BUILDS)) {
          const s: Spec = { weapon, off, weight, attrs, kit: [], perks: [] };
          stage1.push({ s, l: ladder(fighterOf(cls, s)) });
        }
      }
  stage1.sort((a, b) => b.l.score - a.l.score);
  // Referência para comparar: a build da classe (arma de referência, atributos da classe), sem perk.
  const refSpec: Spec = {
    weapon: c.referenceWeapon,
    off: c.referenceOffhand,
    weight: c.armor,
    attrs: "classe",
    kit: [],
    perks: [],
  };
  const refLadder = ladder(fighterOf(cls, refSpec));
  // Etapa 2: os 3 melhores × kits × pares de perk do kit.
  const kits = kitsOf(cls);
  let best = { s: stage1[0]!.s, l: stage1[0]!.l };
  for (const top of stage1.slice(0, 3))
    for (const kit of kits)
      for (let i = 0; i < kit.length; i++)
        for (let j = i + 1; j < kit.length; j++) {
          const perks = [kit[i]!, kit[j]!].filter((id) => PERKS[id]);
          if (perks.length < 2) continue;
          const s: Spec = { ...top.s, kit, perks };
          const l = ladder(fighterOf(cls, s));
          if (l.score > best.l.score) best = { s, l };
        }
  // O mesmo herói sem perk (quanto os perks valem).
  const noPerk = ladder(fighterOf(cls, { ...best.s, perks: [] }));
  results[cls] = { best: best.s, ladder: best.l, noPerk, stage1Top: stage1.slice(0, 3), reference: refLadder };
  const fmt = (l: Ladder) =>
    KINDS.map((k) => {
      const total = DUNGEONS.filter((d) => d.kind === k).length;
      const fl = l.firstLoss[k];
      return `${k} ${l.won[k]}/${total}${fl ? ` (1ª derrota ${fl.id}, ${Math.round(fl.progress * 100)}%)` : ""}`;
    }).join(" · ");
  console.log(`\n## ${cls} (${Math.round((Date.now() - t0) / 1000)} s)`);
  console.log(`build: ${best.s.weapon}${best.s.off ? ` + ${best.s.off}` : ""}, armadura ${best.s.weight}${armorFit(cls, best.s.weight) === "acima" ? " (acima)" : ""}, atributos ${best.s.attrs}, kit ${best.s.kit.join("/") || "referência"}, perks ${best.s.perks.join(" + ") || "nenhum"}`);
  console.log(`  com tudo:     ${fmt(best.l)}`);
  console.log(`  sem os perks: ${fmt(noPerk)}`);
  console.log(`  build da classe, sem perk: ${fmt(refLadder)}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(results));
