/* global console, process */
// D66 (27/11/2026): o que a Devoção e o kit do Cruzado mudam no paladino, peça por peça. (O Escudo
// da Fé guardado para o aviso do Golpe pesado foi medido aqui e saiu: o grupo com druida perdia 4
// Regiões no limite, contra 1 sem ele.) Em cada Masmorra e Região (do 150 ao 500), os grupos com paladino
// do teste de farm (abaixo do limite) e da calibragem (no limite), em cada variante.
//
//   node scripts/paladin-probe.ts [--only "nome;nome"]
import type { ClassId } from "../src/game/ot/balance/content.ts";
import { DUNGEONS } from "../src/game/ot/balance/dungeons/catalog.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import { belowLimitFighter, limitFighter } from "../src/game/ot/balance/sim/calibration.ts";
import { REFERENCE_KITS_T4, skillOf } from "../src/game/ot/balance/skills/index.ts";

const M = createMonsters(B);
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const dev = skillOf("paladino", "intervencao-divina")!.effects[0] as { pct: number; minHpPct: number; durationMs: number };
const devSkill = skillOf("paladino", "intervencao-divina")! as { cooldownMs: number };

const K = {
  devocao: ["golpe-sagrado", "consagracao", "escudo-da-fe", "intervencao-divina"],
  egide: ["golpe-sagrado", "consagracao", "escudo-da-fe", "bencao-da-egide"],
  semEscudo: ["golpe-sagrado", "consagracao", "intervencao-divina", "bencao-da-egide"],
  semConsagracao: ["golpe-sagrado", "escudo-da-fe", "intervencao-divina", "bencao-da-egide"],
  devocaoPrimeiro: ["intervencao-divina", "golpe-sagrado", "consagracao", "escudo-da-fe"],
};
interface Variant { name: string; kit: string[]; pct?: number; minHp?: number; durMs?: number; cdMs?: number }
const ALL: Variant[] = [
  { name: "antigo", kit: K.egide },
  { name: "devocao 60%", kit: K.devocao, pct: 0.6 },
  { name: "devocao 50%", kit: K.devocao, pct: 0.5 },
  { name: "devocao 40%", kit: K.devocao, pct: 0.4 },
  { name: "devocao 30%", kit: K.devocao, pct: 0.3 },
  { name: "devocao 60% vida≥50%", kit: K.devocao, pct: 0.6, minHp: 0.5 },
  { name: "devocao 40% vida≥50%", kit: K.devocao, pct: 0.4, minHp: 0.5 },
  { name: "sem escudo 60%", kit: K.semEscudo, pct: 0.6 },
  { name: "sem escudo 40%", kit: K.semEscudo, pct: 0.4 },
  { name: "sem consagracao 60%", kit: K.semConsagracao, pct: 0.6 },
  { name: "devocao primeiro 60%", kit: K.devocaoPrimeiro, pct: 0.6 },
  { name: "devocao 40% 8s/20s", kit: K.devocao, pct: 0.4, durMs: 8000, cdMs: 20000 },
];
const only = arg("only", "");
const VARIANTS = only ? ALL.filter((v) => only.split(";").includes(v.name)) : ALL;

const GROUPS: [string, "abaixo" | "limite", ClassId[]][] = [
  ["farm", "abaixo", ["paladino", "druida", "cacador"]],
  ["farm4", "abaixo", ["paladino", "padre", "mago", "cacador"]],
  ["D50 padre", "limite", ["paladino", "padre", "mago", "cacador", "assassino"]],
  ["D50 druida", "limite", ["paladino", "druida", "mago", "cacador", "assassino"]],
  ["2 tanques", "limite", ["guerreiro", "paladino", "padre", "mago", "cacador"]],
  ["região", "limite", ["guerreiro", "paladino", "padre", "mago"]],
];

const dgs = DUNGEONS.filter((d) => d.kind !== "cacada" && d.level >= 150);
for (const v of VARIANTS) {
  REFERENCE_KITS_T4.paladino = v.kit;
  dev.pct = v.pct ?? 0.3;
  dev.minHpPct = v.minHp ?? 0.25;
  dev.durationMs = v.durMs ?? 12000;
  devSkill.cooldownMs = v.cdMs ?? 15000;
  let total = 0;
  const lines: string[] = [];
  for (const [gname, prof, comp] of GROUPS) {
    const lost: string[] = [];
    let n = 0;
    for (const d of dgs) {
      if (d.kind === "regional" && gname.startsWith("farm")) continue;
      if (d.kind === "masmorra" && gname === "região") continue;
      n++;
      const party = comp.map((c) => (prof === "abaixo" ? belowLimitFighter(c, d.level, {}, B) : limitFighter(c, d.level, {}, B)));
      if (simulateRun(d, party, { mode: "esperado" }, B, M).outcome !== "vitoria")
        lost.push(d.id.replace("masmorra-", "M").replace("regiao-", "R"));
    }
    total += lost.length;
    lines.push(`  ${gname.padEnd(11)} perde ${lost.length}/${n}${lost.length ? `: ${lost.join(" ")}` : ""}`);
  }
  console.log(`\n## ${v.name} — ${total} derrotas`);
  for (const l of lines) console.log(l);
}
process.exit(0);
