/* global console, process */
// A luta do chefe do 600 segundo a segundo (27/11/2026, o dono: "destrincha"): o que mata o mago na
// abertura e o tanque perto dos 30 s. Corridas gravadas (record) de grupos que perdem e que vencem, no
// topo (nível 500, Lendário +10, afixos no teto, perks), mostrando na sala do chefe:
//   - cada segundo: mecânica anunciada (e em quem), golpe grande (≥ 15% da vida máxima do alvo), queda
//     e a vida de cada herói no fim do segundo;
//   - o resumo: dano recebido por fonte até a 1ª queda e o maior golpe em % da vida máxima.
//
//   node scripts/endgame-dissect.ts
import type { FighterInput } from "../src/game/ot/balance/combat/types.ts";
import { FOE_BASE } from "../src/game/ot/balance/combat/types.ts";
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
import { dungeonById } from "../src/game/ot/balance/dungeons/catalog.ts";
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

interface Spec { weapon: FamilyId; off: OffhandId | null; weight: ArmorWeight; attrs: string; kit: string[]; perks: string[] }
const ATTR: Record<string, readonly (readonly [Stat, number])[] | null> = {
  classe: null,
  destreza: [["DES", 70], ["AGI", 30]],
  inteligencia: [["INT", 70], ["VIT", 30]],
  tanque: [["VIT", 70], ["FOR", 30]],
  misto: STATS.map((s) => [s, 1] as const),
};
const g = (weapon: FamilyId, off: OffhandId | null, weight: ArmorWeight, attrs: string): Spec => ({ weapon, off, weight, attrs, kit: [], perks: [] });
const CLASSE: Record<ClassId, Spec> = {
  guerreiro: g("espada", "escudo", "pesada", "classe"),
  paladino: g("espada", "escudo", "pesada", "classe"),
  padre: g("cajado", null, "leve", "classe"),
  druida: g("bastao", null, "media", "classe"),
  mago: g("cajado", null, "leve", "classe"),
  cacador: g("arco", "aljava", "media", "classe"),
  assassino: g("katar", null, "media", "classe"),
};
const VARIANT: Record<string, Spec> = {
  "mago [solo]": { weapon: "cetro", off: "escudo", weight: "leve", attrs: "inteligencia", kit: ["seta-arcana", "nevasca", "escudo-de-mana", "raio-em-cadeia"], perks: ["seta-arcana", "raio-em-cadeia"] },
  "guerreiro [VIT]": g("espada", "escudo", "pesada", "tanque"),
};

const L = 500;
const R0 = createReference(B);
const M = createMonsters(B);
const BOSS = dungeonById("regiao-12")!;

function topItem(cls: ClassId, base: Partial<ItemInstance> & { slot: string }, perks: string[]): ItemInstance {
  const plan = (B.cfg.limit.affixPlan as Record<string, Record<string, string[]>>)[cls] ?? {};
  const n = affixCount(base.slot as never, "lendario");
  const affixes = (plan[base.slot] ?? []).slice(0, n).map((id) => ({ id: id as never, value: affixRange(id as never, L, "lendario", B).max }));
  const it = { ilvl: L, rarity: "lendario", refine: 0, affixes, ...base } as ItemInstance;
  return { ...it, refine: refinable(it) ? 10 : 0, perks: perks.map((skill) => ({ skill, value: PERKS[skill]!.max })) } as ItemInstance;
}

function fighter(cls: ClassId, variant?: string): FighterInput {
  const s = variant ? VARIANT[variant]! : CLASSE[cls];
  const hs0 = limitMechanics(cls, referenceSkills(cls, B.tierFor(B.jobForLevel(L)), B.jobForLevel(L), false, B, "gabarito"));
  const kit = s.kit.length ? s.kit : hs0.slots;
  const perks = s.perks.length ? s.perks : kit.slice(0, 2);
  const eq: Record<string, ItemInstance> = { arma: topItem(cls, { slot: "arma", family: s.weapon }, perks) };
  if (s.off) eq.secundaria = topItem(cls, { slot: "secundaria", offhand: s.off }, perks);
  for (const slot of ARMOR_SLOTS) eq[slot] = topItem(cls, { slot, weight: s.weight }, perks);
  eq.colar = topItem(cls, { slot: "colar" }, perks);
  eq.anel = topItem(cls, { slot: "anel" }, perks);
  const h: BalanceHero = {
    cls,
    level: L,
    job: B.jobForLevel(L),
    proficiency: B.recommendedProficiency(L),
    attrs: B.allocateByWeights(B.attributePoints(L), ATTR[s.attrs] ?? CLASSES[cls].referenceBuild),
    equipment: eq as Equipment,
  };
  return heroFighter(h, { ...hs0, slots: kit, ai: s.kit.length ? {} : hs0.ai }, { potions: { hp: R0.potionHp(L), mp: R0.potionMp(L), stock: 1000 } }, B, R0);
}

/** `rooms`: as salas mostradas (0–3; 3 é a do chefe); o segundo é o da sala. */
function dissect(
  title: string,
  members: [ClassId, string?][],
  seconds = 40,
  rooms: number[] = [3],
  dg = BOSS,
) {
  const party = members.map(([c, v]) => fighter(c, v));
  const names = members.map(([c, v]) => v ?? c);
  const maxHp = party.map((f) => f.stats.hp);
  const r = simulateRun(dg, party, { mode: "esperado", record: true }, B, M);
  const all = r.frames ?? [];
  const start = new Map<number, number>();
  for (const f of all) if (!start.has(f.st)) start.set(f.st, f.s);
  const frames = all
    .filter((f) => rooms.includes(f.st))
    .map((f) => ({ ...f, s: f.s - start.get(f.st)! + 1 }));
  console.log(`\n=== ${title}: ${r.outcome === "vitoria" ? "VENCE" : "PERDE"} (${dg.id}; salas ${rooms.map((x) => x + 1).join(", ")})`);
  console.log("vida máxima: " + names.map((n, i) => `${n} ${Math.round(maxHp[i]!)}`).join(" · "));
  const taken = party.map(() => new Map<string, number>());
  const biggest = party.map(() => ({ v: 0, src: "", s: 0 }));
  const fell: number[] = [];
  const healed = party.map(() => 0);
  for (const f of frames) {
    const notes: string[] = [];
    for (const e of f.e) {
      if (e.k === "mecanica") notes.push(`⚠ ${e.s}${e.b !== undefined && e.b < FOE_BASE ? ` → ${names[e.b]}` : ""}`);
      if ((e.k === "golpe" || e.k === "magia") && e.b < FOE_BASE && e.a >= FOE_BASE && !("cura" in e && e.cura)) {
        const src = e.k === "golpe" ? (e.a === FOE_BASE ? "auto do chefe" : "auto de invocado") : e.s;
        if (!fell.includes(e.b)) taken[e.b]!.set(src, (taken[e.b]!.get(src) ?? 0) + e.v);
        const pct = e.v / maxHp[e.b]!;
        if (e.v > biggest[e.b]!.v) biggest[e.b] = { v: e.v, src, s: f.s };
        if (pct >= 0.15 && f.s <= seconds) notes.push(`${src} em ${names[e.b]}: ${Math.round(e.v)} (${Math.round(pct * 100)}%)`);
      }
      if (e.k === "magia" && "cura" in e && e.cura && e.b < FOE_BASE) healed[e.b]! += e.v;
      if (e.k === "pocao" && e.a < FOE_BASE && !e.mana) healed[e.a]! += e.v;
      if (e.k === "queda" && e.b < FOE_BASE) {
        fell.push(e.b);
        notes.push(`✖ cai ${names[e.b]}`);
      }
    }
    if (f.s <= seconds && notes.length)
      console.log(`sala ${f.st + 1} ${String(f.s).padStart(3)} s | ${notes.join(" | ")} | vida: ${f.h.map((v, i) => `${Math.round((100 * v) / maxHp[i]!)}%`).join(" ")}`);
  }
  console.log("até cair (ou o fim), dano recebido por fonte:");
  party.forEach((_, i) => {
    const t = [...taken[i]!.entries()].sort((a, b) => b[1] - a[1]);
    const total = t.reduce((a, [, v]) => a + v, 0);
    console.log(`  ${names[i]!.padEnd(16)} ${t.map(([k, v]) => `${k} ${Math.round((100 * v) / Math.max(1, total))}%`).join(", ")} · total ${Math.round(total / maxHp[i]!)}× a vida · curado ${Math.round(healed[i]! / maxHp[i]!)}× · maior golpe ${biggest[i]!.src} ${Math.round((100 * biggest[i]!.v) / maxHp[i]!)}% (aos ${biggest[i]!.s} s)`);
  });
}

/**
 * A ordem do grupo (27/11/2026, a suposição do dono: "muitas vezes entrei numa corrida com o mago já
 * morto de largada"): na abertura de cada sala a ameaça de todos é 0 e o alvo de todo monstro é o 1º
 * da lista (combat/fight.ts, `alive[0]`); no jogo, o 1º é quem criou o grupo (lobby.ts).
 */
function order(title: string, comps: ClassId[][], dgs: string[]) {
  console.log(`\n## ${title}`);
  for (const comp of comps)
    for (const id of dgs) {
      const d = dungeonById(id)!;
      const r = simulateRun(d, comp.map((c) => fighter(c)), { mode: "esperado" }, B, M);
      const fd = r.rooms
        .map((x, i) => (x.firstDeath ? `sala ${i + 1}: ${x.firstDeath.cls} aos ${x.firstDeath.seconds} s (${x.firstDeath.cause})` : null))
        .filter(Boolean);
      console.log(`  [${comp.join(", ")}] ${id}: ${r.outcome}, ${r.rooms.reduce((a, x) => a + x.deaths, 0)} mortes${fd.length ? ` — 1ª queda ${fd[0]}` : ""}`);
    }
}
order(
  "Mesmo grupo, ordem diferente (no jogo, o 1º é quem criou o grupo)",
  [
    ["guerreiro", "padre", "mago", "cacador", "assassino"],
    ["mago", "guerreiro", "padre", "cacador", "assassino"],
    ["padre", "guerreiro", "mago", "cacador", "assassino"],
    ["assassino", "guerreiro", "padre", "mago", "cacador"],
  ],
  ["masmorra-410", "regiao-10", "masmorra-590", "regiao-12"],
);
dissect("O começo das salas com o MAGO criando o grupo", [["mago"], ["guerreiro"], ["padre"], ["cacador"], ["assassino"]], 6, [0, 1, 2, 3]);
dissect("O começo das salas com o GUERREIRO criando o grupo", [["guerreiro"], ["padre"], ["mago"], ["cacador"], ["assassino"]], 6, [0, 1, 2, 3]);
dissect("PERDE — guerreiro, padre, mago, caçador, assassino (build da classe)", [["guerreiro"], ["padre"], ["mago"], ["cacador"], ["assassino"]]);
dissect("VENCE — o mesmo com o mago de cetro e escudo", [["guerreiro"], ["padre"], ["mago", "mago [solo]"], ["cacador"], ["assassino"]]);
dissect("PERDE — paladino no lugar do guerreiro", [["paladino"], ["padre"], ["mago"], ["cacador"], ["assassino"]]);
dissect("PERDE — paladino com o mago de cetro e escudo", [["paladino"], ["padre"], ["mago", "mago [solo]"], ["cacador"], ["assassino"]]);
dissect("VENCE — guerreiro de VIT, padre, mago de cetro e escudo, mago, caçador", [["guerreiro", "guerreiro [VIT]"], ["padre"], ["mago", "mago [solo]"], ["mago"], ["cacador"]]);
process.exit(0);
