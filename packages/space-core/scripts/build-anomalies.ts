// Anomalias da varredura de builds (scripts/build-sweep.ts): lê o JSON e aponta o que foge do esperado.
//
//   node scripts/build-anomalies.ts <varredura.json> [--json saida.json]
//
// Categorias:
//   acima    — build que passa da referência da classe no papel dela (risco de furar o aperto);
//   armadilha — combinação nova (pacotes A, B e C) que não chega a metade da referência;
//   papel    — classe que passa a referência de OUTRO papel (um não tanque mais duro que o guerreiro…);
//   peso     — armadura um peso acima que compensa (a penalidade não pesa);
//   numero   — NaN, negativo, teto batido (velocidade, recarga, crítico), dano zero;
//   skill    — skill que nunca sai (nem no boneco nem no chefe) em nenhum kit;
//   atributo — arquétipo de atributo melhor que a build de referência da classe;
//   solo     — vence o chefe menor da Caçada muito mais rápido que a referência, ou ninguém vence.
import { readFileSync, writeFileSync } from "node:fs";

import { CLASSES, type ClassId } from "../src/game/ot/balance/content.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";

const file = process.argv[2]!;
const jsonOut = (() => {
  const i = process.argv.indexOf("--json");
  return i > 0 ? process.argv[i + 1] : "";
})();
interface M {
  dps: number;
  casts: Record<string, number>;
  castsBoss: Record<string, number>;
  castsStress: Record<string, number>;
  castsArea: Record<string, number>;
  stressS: number;
  stressHps: number;
  stressThreat: number;
  survived: number;
  alive: boolean;
  won: boolean;
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
interface Row {
  cls: ClassId;
  level: number;
  pass: string;
  weapon: string;
  off: string | null;
  weight: string;
  fit: string;
  attrs: string;
  kit: string[];
  score: number;
  m: M;
}
const data = JSON.parse(readFileSync(file, "utf8")) as {
  levels: number[];
  refs: Record<string, M>;
  rows: Row[];
};

// O que existia antes dos pacotes A, B e C (27/11/2026): o resto é combinação nova.
const OLD: Record<ClassId, { weapons: string[]; offhands: string[] }> = {
  guerreiro: { weapons: ["espada", "machado", "lanca"], offhands: ["escudo"] },
  paladino: { weapons: ["espada", "lanca", "martelo"], offhands: ["escudo"] },
  padre: { weapons: ["cajado", "maca", "besta"], offhands: ["escudo"] },
  druida: { weapons: ["cajado", "adaga", "lanca", "bastao"], offhands: ["escudo"] },
  mago: { weapons: ["cajado", "cetro"], offhands: ["focus", "escudo"] },
  cacador: { weapons: ["arco", "besta", "adaga", "lanca"], offhands: ["aljava"] },
  assassino: { weapons: ["katar", "adaga", "espada", "lanca", "arco"], offhands: ["escudo"] },
};
const isNew = (r: Row) =>
  !OLD[r.cls].weapons.includes(r.weapon) ||
  (r.off !== null && !OLD[r.cls].offhands.includes(r.off));

const pct = (x: number) => `${x >= 1 ? "+" : ""}${Math.round((x - 1) * 100)}%`;
const label = (r: Row) =>
  `${r.weapon}${r.off ? ` + ${r.off}` : ""} · armadura ${r.weight}${r.fit === "acima" ? " (acima)" : ""} · atributos ${r.attrs}${r.pass !== "itens" ? ` · kit ${r.kit.join("/")}` : ""}`;

interface Finding {
  cat: string;
  cls?: ClassId;
  level?: number;
  text: string;
  value?: number;
}
const out: Finding[] = [];
const byKey = new Map<string, Row[]>();
for (const r of data.rows) {
  const k = `${r.cls}@${r.level}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k)!.push(r);
}

// 1) acima da referência no papel da classe (a melhor de cada passada).
for (const [k, rows] of byKey) {
  const [cls, lv] = k.split("@") as [ClassId, string];
  for (const pass of ["itens", "kit", "cruzada"]) {
    const best = rows.filter((r) => r.pass === pass).sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 1.1)
      out.push({ cat: "acima", cls, level: +lv, value: best.score, text: `${pct(best.score)} no papel (${CLASSES[cls].role}) com ${label(best)}` });
  }
}

// 2) armadilha: a melhor variante de cada combinação nova (arma + mão secundária), com o peso natural.
for (const [k, rows] of byKey) {
  const [cls, lv] = k.split("@") as [ClassId, string];
  const combos = new Map<string, Row>();
  for (const r of rows)
    if (r.pass === "itens" && isNew(r) && r.fit === "natural") {
      // Pela arma, com a melhor mão secundária: o paladino sem escudo é tanque fraco, não armadilha.
      const c = r.weapon;
      if (!combos.has(c) || combos.get(c)!.score < r.score) combos.set(c, r);
    }
  for (const r of combos.values())
    if (r.score < 0.5)
      out.push({ cat: "armadilha", cls, level: +lv, value: r.score, text: `${r.weapon}${r.off ? ` + ${r.off}` : ""}: no máximo ${Math.round(r.score * 100)}% da referência (melhor com atributos ${r.attrs})` });
}

// 3) papel: classe que passa a referência de outro papel no mesmo nível.
for (const L of data.levels) {
  const refOf = (c: ClassId) => data.refs[`${c}@${L}`]!;
  const tanks = (Object.keys(CLASSES) as ClassId[]).filter((c) => CLASSES[c].role === "tanque");
  const dpsCls = (Object.keys(CLASSES) as ClassId[]).filter((c) => CLASSES[c].role === "dps");
  const sups = (Object.keys(CLASSES) as ClassId[]).filter((c) => CLASSES[c].role === "suporte");
  // Só as classes medidas nesta varredura (ela pode ter rodado com --classes).
  const has = (c: ClassId) => !!data.refs[`${c}@${L}`];
  const maxRef = (cs: ClassId[], f: (m: M) => number) => Math.max(...cs.filter(has).map((c) => f(refOf(c))));
  const minRef = (cs: ClassId[], f: (m: M) => number) => Math.min(...cs.filter(has).map((c) => f(refOf(c))));
  const rowsL = data.rows.filter((r) => r.level === L);
  const tankEhp = minRef(tanks, (m) => m.ehp);
  const dpsMin = minRef(dpsCls, (m) => m.dps);
  const healMin = minRef(sups, (m) => m.stressHps);
  for (const cls of Object.keys(CLASSES) as ClassId[]) {
    const mine = rowsL.filter((r) => r.cls === cls);
    const role = CLASSES[cls].role;
    if (role !== "tanque") {
      const b = mine.sort((a, c) => c.m.ehp - a.m.ehp)[0];
      if (b && b.m.ehp > tankEhp)
        out.push({ cat: "papel", cls, level: L, value: b.m.ehp / tankEhp, text: `vida efetiva ${Math.round(b.m.ehp)} passa o tanque de referência mais frágil (${Math.round(tankEhp)}) com ${label(b)}` });
    }
    if (role !== "dps") {
      const b = mine.sort((a, c) => c.m.dps - a.m.dps)[0];
      if (b && b.m.dps > dpsMin)
        out.push({ cat: "papel", cls, level: L, value: b.m.dps / dpsMin, text: `dano ${Math.round(b.m.dps)}/s passa o DPS de referência mais fraco (${Math.round(dpsMin)}/s) com ${label(b)}` });
    }
    if (role !== "suporte" && healMin > 0) {
      const b = mine.sort((a, c) => c.m.stressHps - a.m.stressHps)[0];
      if (b && b.m.stressHps > healMin)
        out.push({ cat: "papel", cls, level: L, value: b.m.stressHps / healMin, text: `cura sob pressão ${Math.round(b.m.stressHps)}/s passa o suporte de referência mais fraco (${Math.round(healMin)}/s) com ${label(b)}` });
    }
  }
  void maxRef;
}

// 4) peso: armadura um peso acima que vale a pena (a melhor "acima" passa a melhor "natural" do mesmo item e atributos).
for (const [k, rows] of byKey) {
  const [cls, lv] = k.split("@") as [ClassId, string];
  const itens = rows.filter((r) => r.pass === "itens");
  const up = itens.filter((r) => r.fit === "acima");
  let wins = 0;
  let total = 0;
  let worst: { gain: number; r: Row } | null = null;
  for (const r of up) {
    const nat = itens.find((x) => x.fit === "natural" && x.weight === CLASSES[cls].armor && x.weapon === r.weapon && x.off === r.off && x.attrs === r.attrs);
    if (!nat || nat.score <= 0) continue;
    total++;
    if (r.score > nat.score * 1.01) {
      wins++;
      const gain = r.score / nat.score;
      if (!worst || gain > worst.gain) worst = { gain, r };
    }
  }
  if (total > 0 && wins / total >= 0.25 && worst)
    out.push({ cat: "peso", cls, level: +lv, value: wins / total, text: `a armadura um peso acima ganha da natural em ${wins} de ${total} builds (até ${pct(worst.gain)}, ${label(worst.r)})` });
}

// 5) números: NaN, negativo, tetos, dano zero.
const hasteCap = B.cfg.haste.hardCap;
const cdCap = B.cfg.cooldown.hardCap;
const seen = new Set<string>();
for (const r of data.rows) {
  const k = `${r.cls}@${r.level}`;
  const msgs: string[] = [];
  if (r.m.bad.length) msgs.push(`valor inválido ${r.m.bad.join(", ")}`);
  if (r.m.dps <= 0) msgs.push("dano zero no boneco");
  if (r.m.haste >= hasteCap - 1e-9) msgs.push(`velocidade no teto (${Math.round(hasteCap * 100)}%)`);
  if (r.m.cooldownCut >= cdCap - 1e-9) msgs.push(`corte de recarga no teto (${Math.round(cdCap * 100)}%)`);
  if (r.m.crit >= 0.95) msgs.push(`crítico ${Math.round(r.m.crit * 100)}%`);
  // A penalidade de peso pode deixar a velocidade abaixo da base (é o custo); só absurdo conta.
  if (r.m.haste <= -0.5) msgs.push(`velocidade ${Math.round(r.m.haste * 100)}%`);
  for (const msg of msgs) {
    const key = `${k}|${msg.replace(/\d+/g, "#")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ cat: "numero", cls: r.cls, level: r.level, text: `${msg} — ex.: ${label(r)}` });
  }
}

// 6) skill que nunca sai em nenhum kit (nem no boneco nem no chefe).
for (const [k, rows] of byKey) {
  const [cls, lv] = k.split("@") as [ClassId, string];
  const kits = rows.filter((r) => r.pass === "kit");
  const used = new Set<string>();
  const offered = new Set<string>();
  for (const r of kits) {
    for (const id of r.kit) offered.add(id);
    for (const [id, n] of [...Object.entries(r.m.casts), ...Object.entries(r.m.castsBoss), ...Object.entries(r.m.castsStress), ...Object.entries(r.m.castsArea)]) if (n > 0) used.add(id);
  }
  for (const id of offered)
    if (!used.has(id))
      out.push({ cat: "skill", cls, level: +lv, text: `"${id}" não saiu em nenhum dos ${kits.length} kits (boneco, 3 bonecos, chefe menor e chefe de masmorra)` });
}

// 7) atributo: arquétipo melhor que a build de referência (mesmo item de referência e kit).
for (const [k, rows] of byKey) {
  const [cls, lv] = k.split("@") as [ClassId, string];
  const c = CLASSES[cls];
  const refItems = rows.filter((r) => r.pass === "itens" && r.weapon === c.referenceWeapon && r.off === c.referenceOffhand && r.weight === c.armor);
  const classe = refItems.find((r) => r.attrs === "classe");
  const best = [...refItems].sort((a, b) => b.score - a.score)[0];
  if (classe && best && best.attrs !== "classe" && best.score > classe.score * 1.05)
    out.push({ cat: "atributo", cls, level: +lv, value: best.score / classe.score, text: `atributos "${best.attrs}" rendem ${pct(best.score / classe.score)} sobre a build da classe, com o item de referência` });
}

// 8) solo: vence o chefe menor muito mais rápido que a referência; ou ninguém da classe vence.
for (const [k, rows] of byKey) {
  const [cls, lv] = k.split("@") as [ClassId, string];
  const ref = data.refs[k]!;
  const winners = rows.filter((r) => r.m.won);
  if (winners.length === 0) {
    out.push({ cat: "solo", cls, level: +lv, text: `nenhuma build vence o chefe menor da Caçada sozinha` });
    continue;
  }
  const fastest = winners.sort((a, b) => a.m.killS - b.m.killS)[0]!;
  if (ref.won && fastest.m.killS < ref.killS * 0.6)
    out.push({ cat: "solo", cls, level: +lv, value: ref.killS / fastest.m.killS, text: `vence o chefe menor em ${Math.round(fastest.m.killS)} s (referência ${Math.round(ref.killS)} s) com ${label(fastest)}` });
  if (!ref.won)
    out.push({ cat: "solo", cls, level: +lv, text: `a referência não vence o chefe menor sozinha; a melhor build vence em ${Math.round(fastest.m.killS)} s` });
}

const cats = ["acima", "papel", "peso", "atributo", "solo", "armadilha", "skill", "numero"];
for (const cat of cats) {
  const f = out.filter((x) => x.cat === cat);
  console.log(`\n## ${cat} (${f.length})`);
  for (const x of f.sort((a, b) => (a.cls ?? "").localeCompare(b.cls ?? "") || (a.level ?? 0) - (b.level ?? 0)))
    console.log(`- ${x.cls ?? ""} ${x.level ?? ""}: ${x.text}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
