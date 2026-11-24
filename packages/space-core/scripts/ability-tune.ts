// Afinador das habilidades na fórmula "golpe" (24/11/2026). Para cada classe, no level de
// referência, no grupo completo:
//  1. a escala de um controle para a parte do dano que vem das habilidades chegar ao alvo
//     (--share, por classe): a recarga das habilidades de ataque e de área (--knob cd, o padrão)
//     ou o multiplicador delas e dos adereços que trocam a fórmula (--knob mult);
//  2. nos magos, a escala da varinha (WAND_ML) para o dano por segundo chegar ao de antes (--dps,
//     por classe; a magia sai da varinha, então a varinha acerta o total e o controle, a parte).
// Mostra depois a parte e o dano nos outros levels. Não grava nada: os números vão à mão para
// abilities.ts e spells.ts. Rodar (no space-core):
//   node scripts/ability-tune.ts [--level 27] [--seeds 8] [--levels 60,120,224,500]
//   [--share 4:38,3:30,2:45,1:45] [--dps 2:150,1:132] [--knob cd|mult]
import {
  type VocationId,
  abilitiesOf,
  abilityDef,
  DUNGEONS,
  simulateRun,
  TREE,
  VOCATIONS,
  WAND_ML,
} from "../src/game/ot/index.ts";
import { heroAt } from "./simHero.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : def;
};
const pairs = (s: string) => Object.fromEntries(s.split(",").filter(Boolean).map((p) => p.split(":").map(Number)));
const LEVEL = Number(opt("level", "27"));
const SEEDS = Number(opt("seeds", "8"));
const LEVELS = opt("levels", "60,120,224,500").split(",").map(Number);
const SHARE: Record<number, number> = pairs(opt("share", "4:38,3:30,2:45,1:45"));
const DPS: Record<number, number> = pairs(opt("dps", "2:150,1:132"));
const KNOB = opt("knob", "cd");
const CLASSES = opt("classes", "4,3,2,1").split(",").map(Number);
const NAMES: Record<number, string> = { 4: "Cavaleiro", 3: "Arqueiro", 2: "Druida", 1: "Feiticeiro" };
const party: VocationId[] = [4, 3, 2, 1];

type Golpe = { type: string; min: number; max: number };
type Def = { id: string; cooldownMs: number; kind: string; cls: number; formula: Golpe };
const cds = new Map<Def, number>();
const formulas = new Map<Golpe, { cls: number; min: number; max: number }>();
for (const cls of [1, 2, 3, 4])
  for (const d of abilitiesOf(cls) as unknown as Def[]) {
    if (d.kind === "ataque" || d.kind === "area") cds.set(d, d.cooldownMs);
    if (d.formula.type === "golpe") formulas.set(d.formula, { cls, min: d.formula.min, max: d.formula.max });
  }
for (const n of TREE as unknown as { ability: string; effect: { t: string; formula?: Golpe } }[]) {
  const f = n.effect.t === "formula" ? n.effect.formula : undefined;
  const cls = abilityDef(n.ability)?.cls;
  if (f?.type === "golpe" && cls) formulas.set(f, { cls, min: f.min, max: f.max });
}
const scale: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 1 };
const wand0: [number, number] = [WAND_ML[0], WAND_ML[1]];
/**
 * A base do golpe normal de cada classe (o controle do dano total): a varinha nos magos (WAND_ML),
 * o multiplicador de distância no arqueiro e o de corpo a corpo no cavaleiro (as vocações da classe).
 */
const wandScale: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 1 };
type Voc = { base: number; meleeDamage: number; distDamage: number };
const vocs = (Object.values(VOCATIONS) as unknown as Voc[]).map((v) => ({ v, melee: v.meleeDamage, dist: v.distDamage }));
function apply(cls: number) {
  if (KNOB === "cd") for (const [d, ms] of cds) d.cooldownMs = Math.round((ms * scale[d.cls]!) / 100) * 100;
  else
    for (const [f, b] of formulas) {
      f.min = b.min * scale[b.cls]!;
      f.max = b.max * scale[b.cls]!;
    }
  // A varinha é uma só para os dois magos: cada um mede com a sua escala.
  const k = cls === 1 || cls === 2 ? wandScale[cls]! : 1;
  WAND_ML[0] = wand0[0] * k;
  WAND_ML[1] = wand0[1] * k;
  for (const x of vocs) {
    if (x.v.base === 3) x.v.distDamage = x.dist * wandScale[3]!;
    if (x.v.base === 4) x.v.meleeDamage = x.melee * wandScale[4]!;
  }
}

function measure(level: number, cls: number): { share: number; dps: number } {
  apply(cls);
  const d = [...DUNGEONS].reverse().find((x) => x.minLevel <= level)!;
  const i = party.findIndex((v) => VOCATIONS[v].base === cls);
  let ab = 0;
  let auto = 0;
  let dmg = 0;
  let secs = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = simulateRun({ seed: seed * 104729, dungeon: d.id, heroes: party.map((v) => heroAt(v, level)), rateLoot: 2 });
    dmg += r.members[i]!.damage;
    secs += r.seconds;
    for (const f of r.frames)
      for (const e of f.e as Array<{ k: string; a: number; b: number; v: unknown; cura?: boolean }>) {
        if (e.a !== i || typeof e.v !== "number" || e.b < 100 || e.cura) continue;
        if (e.k === "magia") ab += e.v;
        else if (e.k === "golpe") auto += e.v;
      }
  }
  return { share: (100 * ab) / Math.max(1, ab + auto), dps: dmg / Math.max(1, secs) };
}

/** Bissecção do controle pela parte: recarga maior = parte menor; multiplicador maior = parte maior. */
function tuneShare(cls: number) {
  let lo = KNOB === "cd" ? 0.3 : 0.1;
  let hi = KNOB === "cd" ? 6 : 3;
  for (let it = 0; it < 9; it++) {
    scale[cls] = Math.sqrt(lo * hi);
    const m = measure(LEVEL, cls);
    if (Math.abs(m.share - SHARE[cls]!) < 1.5) return;
    const tooMuch = m.share > SHARE[cls]!;
    if (tooMuch === (KNOB === "cd")) lo = scale[cls]!;
    else hi = scale[cls]!;
  }
}

for (const cls of CLASSES) {
  tuneShare(cls);
  if (DPS[cls]) {
    for (let round = 0; round < 2; round++) {
      let a = 0.3;
      let b = 2;
      for (let it = 0; it < 8; it++) {
        wandScale[cls] = Math.sqrt(a * b);
        const m = measure(LEVEL, cls);
        if (Math.abs(m.dps - DPS[cls]!) / DPS[cls]! < 0.03) break;
        if (m.dps > DPS[cls]!) b = wandScale[cls]!;
        else a = wandScale[cls]!;
      }
      tuneShare(cls);
    }
  }
  const at = [LEVEL, ...LEVELS].map((l) => {
    const m = measure(l, cls);
    return `L${l} ${Math.round(m.share)}% ${Math.round(m.dps)}dps`;
  });
  const list = (abilitiesOf(cls) as unknown as Def[])
    .filter((d) => d.formula.type === "golpe")
    .map((d) => `${d.id} ×${d.formula.min.toFixed(2)}–${d.formula.max.toFixed(2)} ${d.cooldownMs / 1000}s`)
    .join(", ");
  const wand = DPS[cls] ? ` base ×${wandScale[cls]!.toFixed(2)} (WAND_ML ${(wand0[0] * wandScale[cls]!).toFixed(2)}–${(wand0[1] * wandScale[cls]!).toFixed(2)})` : "";
  console.log(`${NAMES[cls]!.padEnd(10)} ${KNOB === "cd" ? "recarga" : "multiplicador"} ×${scale[cls]!.toFixed(2)}${wand} · ${list}\n  ${at.join(" · ")}`);
}
