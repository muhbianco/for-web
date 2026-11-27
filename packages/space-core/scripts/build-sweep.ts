// Varredura de builds (27/11/2026, pedido do dono depois dos pacotes A, B e C de itens: "mede todas as
// builds e combinações (status, itens, skills) possíveis com todos os bonecos e me mostra as
// anomalias").
//
// Parte do herói do limite de cada classe (o mesmo do aperto: equipamento, afixos, proficiência e
// árvore de referência) e varia uma coisa por vez, por sensibilidade:
//   1. itens × atributos: toda arma que a classe usa, toda mão secundária que combina (ou nenhuma),
//      todo peso de armadura que veste (mais leve, o dela, um acima com penalidade), cruzados com 7
//      builds de atributo;
//   2. skills: toda combinação de 4 skills aprendidas, com o equipamento de referência;
//   3. as 3 melhores de (1) cruzadas com todos os kits de (2).
// Cada build luta duas vezes: contra um boneco que não morre e não bate (dano por segundo e quantas
// vezes cada skill sai) e contra o chefe do nível (sobrevivência, cura, ameaça, dano).
//
//   node scripts/build-sweep.ts [--levels 45,90,150,250] [--classes mago,druida] [--out arquivo.json]
import { writeFileSync } from "node:fs";

import { fight } from "../src/game/ot/balance/combat/fight.ts";
import type { EnemyInput, FighterInput } from "../src/game/ot/balance/combat/types.ts";
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
import {
  type BalanceHero,
  type Equipment,
  armorFit,
  heroDerived,
  offhandMismatch,
} from "../src/game/ot/balance/equipment.ts";
import { heroFighter } from "../src/game/ot/balance/fighter.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { createReference } from "../src/game/ot/balance/reference.ts";
import { DUNGEONS } from "../src/game/ot/balance/dungeons/catalog.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import {
  LIMIT_GROUP_PARTIES,
  limitFighter,
} from "../src/game/ot/balance/sim/calibration.ts";
import {
  limitEncounters,
  limitMechanics,
  referenceSkills,
} from "../src/game/ot/balance/sim/encounters.ts";
import {
  type HeroSkills,
  MAX_SLOTS,
  learnableSkills,
} from "../src/game/ot/balance/skills/tree.ts";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
// Níveis com Masmorra (o teste de grupo roda a Masmorra do nível).
const LEVELS = arg("levels", "40,90,160,260,410").split(",").map(Number);
const ONLY = arg("classes", "");
const CLASSES_RUN = (ONLY ? ONLY.split(",") : [...CLASS_IDS]) as ClassId[];
const OUT = arg("out", "");

const RL = createReference(B, "limite");
const R0 = createReference(B);
const M = createMonsters(B);

/**
 * Masmorra do nível com o grupo do limite (os da calibração): a build entra no lugar da classe e os
 * outros quatro são os do limite. Vale a ótica do dono (27/11/2026): o druida e o paladino de força
 * caçam sozinhos com mais autonomia, mas não seguram a PT na Masmorra onde o papel deles faz falta.
 */
interface Group {
  won: boolean;
  seconds: number;
  deaths: number;
}
function groupOf(cls: ClassId, L: number) {
  const dg = DUNGEONS.find((d) => d.kind === "masmorra" && d.level === L);
  // A PT em que a classe é a única do papel dela (o paladino de tanque único, não ao lado do
  // guerreiro): sem isso, "sem o papel" não mede nada.
  const role = CLASSES[cls].role;
  const party =
    LIMIT_GROUP_PARTIES.find(
      (p) => p.includes(cls) && p.filter((c) => CLASSES[c].role === role).length === 1,
    ) ?? LIMIT_GROUP_PARTIES.find((p) => p.includes(cls));
  if (!dg || !party) return null;
  const slot = party.indexOf(cls);
  const others = party.map((c, i) => (i === slot ? null : limitFighter(c, L, {}, B)));
  return (h: BalanceHero, hs: HeroSkills): Group => {
    const fighters = others.map((f) => f ?? fighterOf(h, hs));
    const r = simulateRun(dg, fighters, { mode: "esperado" }, B, M);
    return {
      won: r.outcome === "vitoria",
      seconds: r.seconds,
      deaths: r.rooms.reduce((a, x) => a + x.deaths, 0),
    };
  };
}

/** Builds de atributo: a da classe e seis arquétipos (pesos em %). */
const ATTR_BUILDS: Record<string, readonly (readonly [Stat, number])[] | null> = {
  classe: null,
  forca: [["FOR", 70], ["VIT", 30]],
  destreza: [["DES", 70], ["AGI", 30]],
  inteligencia: [["INT", 70], ["VIT", 30]],
  critico: [["AGI", 50], ["SOR", 50]],
  tanque: [["VIT", 70], ["FOR", 30]],
  misto: STATS.map((s) => [s, 1] as const),
};

interface Measure {
  dps: number;
  /** Quantas vezes cada skill saiu: no boneco (dano) e no chefe (cura e defesa só saem levando dano). */
  casts: Record<string, number>;
  castsBoss: Record<string, number>;
  /** Contra o chefe de masmorra (escala de 3) sozinho: todo mundo cai; vale quanto aguenta. */
  stressS: number;
  stressHps: number;
  stressThreat: number;
  castsStress: Record<string, number>;
  /** Contra 3 bonecos: as skills de área saem. */
  castsArea: Record<string, number>;
  /** Contra o chefe do nível. */
  survived: number;
  alive: boolean;
  won: boolean;
  /** Segundos para vencer o chefe menor (sem vencer: o tempo todo). */
  killS: number;
  bossDps: number;
  hps: number;
  threat: number;
  hp: number;
  ehp: number;
  haste: number;
  cooldownCut: number;
  crit: number;
  bad: string[];
}

function fighterOf(h: BalanceHero, hs: HeroSkills): FighterInput {
  const L = h.level;
  return heroFighter(
    h,
    hs,
    { potions: { hp: R0.potionHp(L), mp: R0.potionMp(L), stock: 100 } },
    B,
    R0,
  );
}

const DUMMY_S = 30;
/** O chefe menor da Caçada no perfil do limite: 25 s do dano solo de referência, Cataclismo aos 120 s. */
const BOSS_S = 120;
const STRESS_S = 120;

function measure(h: BalanceHero, hs: HeroSkills): Measure {
  const bad: string[] = [];
  const d = heroDerived(h, B);
  for (const [k, v] of Object.entries(d))
    if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${k}=${v}`);
  // 1) Boneco: não morre e não bate. O dano por segundo puro e quantas vezes cada skill sai.
  const dummy: EnemyInput = {
    archetype: "chefe",
    level: h.level,
    hp: 1e15,
    autoRaw: 0,
    attacksPerSecond: 0.5,
  } as EnemyInput;
  const r1 = fight([fighterOf(h, hs)], [dummy], { maxSeconds: DUMMY_S, mode: "esperado" }, B);
  const dps = r1.damage / DUMMY_S;
  if (!Number.isFinite(dps) || dps < 0) bad.push(`dps=${dps}`);
  // 2) O chefe menor da Caçada do nível, sozinho (o conteúdo solo calibrado): vence em quanto tempo,
  // aguenta quanto, cura quanto, segura a ameaça.
  const boss = limitEncounters.huntBoss(h.level);
  const r2 = fight([fighterOf(h, hs)], [boss], { maxSeconds: BOSS_S, mode: "esperado" }, B);
  const me = r2.heroes[0]!;
  const survived = me.alive ? BOSS_S : (r2.firstDeath?.seconds ?? r2.seconds);
  const bossDps = me.damage / Math.max(1, r2.seconds);
  const hps = me.healed / Math.max(1, r2.seconds);
  const threat = (me.threat[0] ?? 0) / Math.max(1, r2.seconds);
  const ehp = d.hp / (1 - B.heroPhysicalReduction(d.def, h.level));
  // 3) Estresse: o chefe de masmorra feito para 3, contra o herói sozinho (tanque e suporte se medem
  // aqui: quanto aguentam, quanto curam com dano de sobra, quanta ameaça por segundo vivo).
  const r3 = fight([fighterOf(h, hs)], [limitEncounters.dungeonBoss(h.level, 3)], { maxSeconds: STRESS_S, mode: "esperado" }, B);
  const st = r3.heroes[0]!;
  const stressS = st.alive ? STRESS_S : (r3.firstDeath?.seconds ?? r3.seconds);
  // 4) Três bonecos: área.
  const r4 = fight([fighterOf(h, hs)], [dummy, dummy, dummy], { maxSeconds: DUMMY_S, mode: "esperado" }, B);
  return {
    stressS,
    stressHps: st.healed / Math.max(1, stressS),
    stressThreat: (st.threat[0] ?? 0) / Math.max(1, stressS),
    castsStress: st.casts,
    castsArea: r4.heroes[0]!.casts,
    dps,
    casts: r1.heroes[0]!.casts,
    castsBoss: me.casts,
    survived,
    alive: me.alive,
    won: r2.win,
    killS: r2.win ? r2.seconds : BOSS_S,
    bossDps,
    hps,
    threat,
    hp: d.hp,
    ehp,
    haste: d.haste,
    cooldownCut: d.cooldownCut,
    crit: B.critChance(d.critRating, B.monsterStats("chefe", h.level).critRes),
    bad,
  };
}

/** A nota do papel da classe, contra a referência (1 = igual). */
function roleScore(cls: ClassId, m: Measure, ref: Measure): number {
  const rel = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? 2 : 1);
  const role = CLASSES[cls].role;
  if (role === "dps") return rel(m.dps, ref.dps);
  // Tanque: quanto aguenta o chefe de masmorra sozinho e quanta ameaça segura por segundo vivo.
  if (role === "tanque")
    return 0.6 * rel(m.stressS, ref.stressS) + 0.4 * rel(m.stressThreat, ref.stressThreat);
  // Suporte: quanto cura com dano de sobra e quanto aguenta.
  return 0.5 * rel(m.stressHps, ref.stressHps) + 0.5 * rel(m.stressS, ref.stressS);
}

function withItems(
  base: BalanceHero,
  family: FamilyId,
  off: OffhandId | null,
  weight: ArmorWeight,
): BalanceHero {
  const eq = { ...base.equipment } as Equipment & Record<string, unknown>;
  const w = base.equipment.arma!;
  eq.arma = { ...w, family };
  if (off) {
    const cur = base.equipment.secundaria;
    eq.secundaria =
      cur && cur.offhand === off
        ? cur
        : {
            ilvl: w.ilvl,
            rarity: w.rarity,
            refine: off === "escudo" ? w.refine : 0,
            slot: "secundaria",
            offhand: off,
            affixes: cur?.affixes ?? [],
          };
  } else delete eq.secundaria;
  for (const s of ARMOR_SLOTS) {
    const p = base.equipment[s];
    if (p) eq[s] = { ...p, weight };
  }
  return { ...base, equipment: eq as Equipment };
}

function withAttrs(base: BalanceHero, key: string): BalanceHero {
  const weights = ATTR_BUILDS[key];
  if (!weights) return base;
  return { ...base, attrs: B.allocateByWeights(B.attributePoints(base.level), weights) };
}

function kitsOf(cls: ClassId, hs: HeroSkills): string[][] {
  const learned = learnableSkills(cls, hs.tier).map((s) => s.id);
  const n = Math.min(MAX_SLOTS, learned.length);
  const out: string[][] = [];
  const pick = (start: number, acc: string[]) => {
    if (acc.length === n) return out.push([...acc]);
    for (let i = start; i < learned.length; i++) pick(i + 1, [...acc, learned[i]!]);
  };
  pick(0, []);
  return out;
}

interface Row {
  cls: ClassId;
  level: number;
  pass: "itens" | "kit" | "cruzada";
  weapon: FamilyId;
  off: OffhandId | null;
  weight: ArmorWeight;
  fit: "natural" | "acima";
  attrs: string;
  kit: string[];
  score: number;
  m: Measure;
  /** Masmorra do nível com o grupo do limite (só na passada de itens × atributos). */
  g?: Group | null;
}

const rows: Row[] = [];
const refs: Record<string, Measure> = {};
const groupRefs: Record<string, Group | null> = {};
/** A mesma PT sem o papel da classe (o lugar dela vira um mago do limite): o papel faz falta? */
const groupWithout: Record<string, Group | null> = {};
const t0 = Date.now();

for (const cls of CLASSES_RUN) {
  const c = CLASSES[cls];
  for (const L of LEVELS) {
    const base = RL.referenceBalanceHero(cls, L);
    const hs = limitMechanics(
      cls,
      referenceSkills(cls, B.tierFor(base.job), base.job, false, B, "gabarito"),
    );
    const ref = measure(base, hs);
    refs[`${cls}@${L}`] = ref;
    const group = groupOf(cls, L);
    groupRefs[`${cls}@${L}`] = group ? group(base, hs) : null;
    if (group && cls !== "mago") {
      const mage = RL.referenceBalanceHero("mago", L);
      const mageHs = referenceSkills("mago", B.tierFor(mage.job), mage.job, false, B, "gabarito");
      groupWithout[`${cls}@${L}`] = group(mage, mageHs);
    }
    const refRow = {
      weapon: c.referenceWeapon,
      off: c.referenceOffhand,
      weight: c.armor,
    };
    // 1) itens × atributos, com o kit de referência.
    const itemRows: Row[] = [];
    for (const family of c.weapons) {
      const offs: (OffhandId | null)[] = [null, ...c.offhands.filter((o) => offhandMismatch(o, FAMILIES[family]) === null)];
      for (const off of offs)
        for (const weight of ARMOR_WEIGHTS) {
          const fit = armorFit(cls, weight);
          if (!fit) continue;
          for (const attrs of Object.keys(ATTR_BUILDS)) {
            const h = withAttrs(withItems(base, family, off, weight), attrs);
            const m = measure(h, hs);
            const row: Row = { cls, level: L, pass: "itens", weapon: family, off, weight, fit, attrs, kit: hs.slots, score: roleScore(cls, m, ref), m, g: group ? group(h, hs) : null };
            rows.push(row);
            itemRows.push(row);
          }
        }
    }
    // 2) kits com o equipamento de referência.
    const kits = kitsOf(cls, hs);
    for (const kit of kits) {
      const m = measure(base, { ...hs, slots: kit, ai: {} });
      rows.push({ cls, level: L, pass: "kit", ...refRow, fit: "natural", attrs: "classe", kit, score: roleScore(cls, m, ref), m });
    }
    // 3) as 3 melhores de itens × atributos com todos os kits.
    const top = [...itemRows].sort((a, b) => b.score - a.score).slice(0, 3);
    for (const t of top)
      for (const kit of kits) {
        const h = withAttrs(withItems(base, t.weapon, t.off, t.weight), t.attrs);
        const m = measure(h, { ...hs, slots: kit, ai: {} });
        rows.push({ ...t, pass: "cruzada", kit, score: roleScore(cls, m, ref), m });
      }
    process.stderr.write(`${cls}@${L}: ${rows.length} builds, ${Math.round((Date.now() - t0) / 1000)} s\n`);
  }
}

const out = { at: new Date().toISOString(), levels: LEVELS, refs, groupRefs, groupWithout, rows };
if (OUT) writeFileSync(OUT, JSON.stringify(out));
process.stderr.write(`fim: ${rows.length} builds em ${Math.round((Date.now() - t0) / 1000)} s\n`);
