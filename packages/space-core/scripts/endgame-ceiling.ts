/* global console, process */
// Até onde o herói no topo chega no fim de jogo (27/11/2026, o dono: DGs até a 600 na mesma progressão,
// sem recalibrar e sem mexer na força de ninguém; "o grupo deve ficar travado antes de zerar o jogo,
// mesmo estando acima do limite com perks e tudo").
//
//   node scripts/endgame-ceiling.ts
//
// Heróis no nível 500 (o teto), Lendário iL 500 +10, afixos do plano no teto da faixa do Lendário,
// perks no valor máximo em todas as peças. Duas montagens por classe:
//   classe — a build de referência (arma, armadura e atributos da classe, kit de grupo) com os 2
//            primeiros perks do kit;
//   solo   — a vencedora de scripts/solo-ceiling.ts (arma, armadura, atributos, kit e o melhor par de perks).
// Sozinho: as 117 DGs em ordem de nível. Em grupo: Caçadas, Masmorras e Regiões do 400 ao 600 com as
// PTs de calibração e os trios do farm (e as mesmas PTs com as builds do solo). Mostra a última vencida e a 1ª perdida.
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
/** As vencedoras do solo no nível 500 (scripts/solo-ceiling.ts). */
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
  destreza: [["DES", 70], ["AGI", 30]],
  inteligencia: [["INT", 70], ["VIT", 30]],
  misto: STATS.map((s) => [s, 1] as const),
};

const L = 500;
const R0 = createReference(B);
const M = createMonsters(B);
type Build = "classe" | "solo";

function topItem(cls: ClassId, base: Partial<ItemInstance> & { slot: string }, perks: string[]): ItemInstance {
  const plan = (B.cfg.limit.affixPlan as Record<string, Record<string, string[]>>)[cls] ?? {};
  const n = affixCount(base.slot as never, "lendario");
  const affixes = (plan[base.slot] ?? []).slice(0, n).map((id) => ({ id: id as never, value: affixRange(id as never, L, "lendario", B).max }));
  const it = { ilvl: L, rarity: "lendario", refine: 0, affixes, ...base } as ItemInstance;
  return { ...it, refine: refinable(it) ? 10 : 0, perks: perks.map((skill) => ({ skill, value: PERKS[skill]!.max })) } as ItemInstance;
}

function specOf(cls: ClassId, b: Build, solo: boolean): Spec {
  if (b === "solo") return SOLO[cls];
  const c = CLASSES[cls];
  const hs = referenceSkills(cls, B.tierFor(B.jobForLevel(L)), B.jobForLevel(L), solo, B, "gabarito");
  return { weapon: c.referenceWeapon, off: c.referenceOffhand, weight: c.armor, attrs: "classe", kit: hs.slots, perks: hs.slots.slice(0, 2) };
}

const cache = new Map<string, FighterInput>();
function fighter(cls: ClassId, b: Build, solo: boolean): FighterInput {
  const key = `${cls}:${b}:${solo}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const s = specOf(cls, b, solo);
  const eq: Record<string, ItemInstance> = { arma: topItem(cls, { slot: "arma", family: s.weapon }, s.perks) };
  if (s.off) eq.secundaria = topItem(cls, { slot: "secundaria", offhand: s.off }, s.perks);
  for (const slot of ARMOR_SLOTS) eq[slot] = topItem(cls, { slot, weight: s.weight }, s.perks);
  eq.colar = topItem(cls, { slot: "colar" }, s.perks);
  eq.anel = topItem(cls, { slot: "anel" }, s.perks);
  const w = ATTR_BUILDS[s.attrs];
  const h: BalanceHero = {
    cls,
    level: L,
    job: B.jobForLevel(L),
    proficiency: B.recommendedProficiency(L),
    attrs: B.allocateByWeights(B.attributePoints(L), w ?? CLASSES[cls].referenceBuild),
    equipment: eq as Equipment,
  };
  const hs = { ...limitMechanics(cls, referenceSkills(cls, B.tierFor(h.job), h.job, solo, B, "gabarito")), slots: s.kit, ai: {} };
  const f = heroFighter(h, hs, { potions: { hp: R0.potionHp(L), mp: R0.potionMp(L), stock: 1000 } }, B, R0);
  cache.set(key, f);
  return f;
}

/** A escada de um tipo de DG: vence em ordem até a 1ª derrota (a "trava"); conta também as vencidas depois. */
function ladder(party: FighterInput[], dgs: DungeonDef[]): string {
  let best = 0;
  let first: DungeonDef | null = null;
  let after = 0;
  for (const d of dgs) {
    const r = simulateRun(d, party, { mode: "esperado" }, B, M);
    if (r.outcome === "vitoria") {
      if (!first) best = d.level;
      else after++;
    } else if (!first) first = d;
  }
  return first ? `vence até ${best || "—"}, trava em ${first.id}${after ? ` (vence ${after} depois)` : ""}` : `zera (até ${dgs.at(-1)!.level})`;
}

const byKind = (k: string, from = 1) => ALL_DUNGEONS.filter((d) => d.kind === k && d.level >= from);

console.log("## Sozinho (117 DGs; o herói não passa do nível 500)");
for (const cls of CLASS_IDS)
  for (const b of ["classe", "solo"] as Build[]) {
    const f = [fighter(cls, b, true)];
    console.log(`${cls.padEnd(9)} ${b.padEnd(6)} Caçada: ${ladder(f, byKind("cacada"))} · Masmorra: ${ladder(f, byKind("masmorra"))} · Região: ${ladder(f, byKind("regional"))}`);
  }

console.log("\n## Em grupo (do 400 ao 600)");
const parties: ClassId[][] = [...LIMIT_GROUP_PARTIES, ...REGION_PARTIES, ...FARM_TRIOS.filter((p) => p.length === 3)].map((p) => [...p]);
for (const p of parties)
  for (const b of ["classe", "solo"] as Build[]) {
    const party = p.map((c) => fighter(c, b, false));
    const name = p.map((c) => c.slice(0, 3)).join("+");
    console.log(`${name.padEnd(24)} ${b.padEnd(6)} Caçada: ${ladder(party, byKind("cacada", 400))} · Masmorra: ${ladder(party, byKind("masmorra", 400))} · Região: ${ladder(party, byKind("regional", 400))}`);
  }
process.exit(0);
