// Afinador da dificuldade das dungeons (24/11/2026, pedido do dono: "mantenha a dificuldade sempre
// em prática; a party completa é importante; sem algum membro, a deficiência precisa ser
// evidente"). Para cada dungeon, no level de entrada:
//  1. a força dos golpes dos monstros (dmg) em que o grupo completo vence ~85% (sem a Fúria do chefe);
//  2. o tempo que ele leva na sala do chefe, e a Fúria dela um pouco depois (furyMs);
//  3. confere de novo com a Fúria e mede os quatro trios a que falta um membro.
// Com --seconds <arquivo> (linhas "dungeon segundos", 25/11/2026), antes de tudo a vida dos
// monstros (hp, só em grupo) para a corrida do grupo completo durar esse tempo: a experiência por
// hora fica a de antes sem mexer no EXP_FIX, e o trio a que falta um atacante luta mais e a Fúria
// pega. Grava src/game/ot/difficulty.ts (--write) e um resumo. Rodar (no space-core):
//   node scripts/party-tune.ts [dungeon …] [--seeds 24] [--seconds alvo.txt] [--write]
// Pesado: rodar com prioridade baixa e uma rodada por vez.
import { readFileSync, writeFileSync } from "node:fs";
import { type VocationId, DIFFICULTY, DUNGEONS, RUN, simulateRun } from "../src/game/ot/index.ts";
import { heroAt } from "./simHero.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : def;
};
const SEEDS = Number(opt("seeds", "24"));
const only = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const TARGET = { low: 78, high: 92 };
/** A Fúria do chefe começa este tanto depois do tempo que o grupo completo leva nele. */
const FURY_MULT = Number(opt("fury", "1.15"));
if (process.env.FURY) Object.assign((RUN as unknown as { fury: object }).fury, JSON.parse(process.env.FURY));
const FULL: VocationId[] = [4, 3, 2, 1];
const TRIOS: [string, VocationId[]][] = [
  ["sem cavaleiro", [3, 2, 1]],
  ["sem arqueiro", [4, 2, 1]],
  ["sem druida", [4, 3, 1]],
  ["sem feiticeiro", [4, 3, 2]],
];
const table = DIFFICULTY as Record<string, { dmg: number; hp: number; furyMs: number }>;
const SECONDS: Record<string, number> = {};
const secondsFile = opt("seconds", "");
if (secondsFile)
  for (const line of readFileSync(secondsFile, "utf8").split(/\r?\n/)) {
    const [id, n] = line.trim().split(/\s+/);
    if (id && n && Number(n) > 0) SECONDS[id] = Number(n);
  }

function measure(dungeon: string, party: VocationId[], level: number, seeds = SEEDS) {
  let wins = 0;
  let secs = 0;
  const boss: number[] = [];
  const last = DUNGEONS.find((d) => d.id === dungeon)!.stages.length - 1;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = simulateRun({ seed: seed * 104729, dungeon, heroes: party.map((v) => heroAt(v, level)), rateLoot: 2 });
    secs += r.seconds;
    if (r.outcome !== "vitoria") continue;
    wins++;
    const enter = r.frames.find((f) => (f.e as Array<{ k: string; st?: number }>).some((e) => e.k === "sala" && e.st === last));
    if (enter) boss.push(r.seconds - enter.s);
  }
  const mean = boss.length ? boss.reduce((a, b) => a + b, 0) / boss.length : 0;
  return { win: Math.round((100 * wins) / seeds), bossS: mean, seconds: secs / seeds };
}

const out: Record<string, { dmg: number; hp: number; furyMs: number }> = {};
for (const d of DUNGEONS) {
  if (only.length && !only.includes(d.id)) continue;
  // As de iniciante ficam como estão (difficulty.ts beginner).
  if (DIFFICULTY[d.id]?.beginner) continue;
  const L = d.minLevel;
  // 1. dmg pela bissecção (sem a Fúria do chefe); com --seconds, antes a vida pelo tempo, e as
  // duas de novo (a força dos golpes mexe pouco no tempo, a vida mexe na vitória).
  table[d.id] = { dmg: DIFFICULTY[d.id]?.dmg ?? 1, hp: 1, furyMs: 1e9 };
  let dmg = table[d.id]!.dmg;
  let hp = 1;
  const target = SECONDS[d.id];
  for (let round = 0; round < (target ? 2 : 1); round++) {
    if (target) {
      let a = 0.4;
      let b = 4;
      for (let i = 0; i < 8; i++) {
        table[d.id]!.hp = hp;
        const t = measure(d.id, FULL, L).seconds;
        if (Math.abs(t - target) / target < 0.05) break;
        if (t > target) b = hp;
        else a = hp;
        hp = Math.sqrt(a * b);
      }
      hp = Math.round(hp * 100) / 100;
      table[d.id]!.hp = hp;
    }
    let lo = 0.25;
    let hi = 4;
    for (let i = 0; i < 9; i++) {
      table[d.id]!.dmg = dmg;
      const w = measure(d.id, FULL, L).win;
      if (w >= TARGET.low && w <= TARGET.high) break;
      if (w > TARGET.high) lo = dmg;
      else hi = dmg;
      dmg = Math.sqrt(lo * hi);
    }
    dmg = Math.round(dmg * 100) / 100;
    table[d.id]!.dmg = dmg;
  }
  // 2. o tempo no chefe e a Fúria dele.
  const base = measure(d.id, FULL, L);
  let furyMs = Math.max(20_000, Math.ceil((base.bossS * FURY_MULT) / 5) * 5_000);
  table[d.id]!.furyMs = furyMs;
  let full = measure(d.id, FULL, L);
  for (let i = 0; i < 4 && full.win < TARGET.low - 8; i++) {
    furyMs = Math.ceil((furyMs * 1.2) / 5_000) * 5_000;
    table[d.id]!.furyMs = furyMs;
    full = measure(d.id, FULL, L);
  }
  out[d.id] = { dmg, hp, furyMs };
  const trios = TRIOS.map(([name, p]) => `${name} ${measure(d.id, p, L).win}%`).join(" · ");
  console.log(`${d.id.padEnd(22)} L${String(L).padStart(3)} vida ×${hp} (${Math.round(full.seconds)} s${target ? ` de ${target}` : ""}) dmg ×${dmg} chefe ${Math.round(base.bossS)} s → Fúria ${furyMs / 1000} s · completo ${full.win}% · ${trios}`);
}

if (args.includes("--write")) {
  const F = new URL("../src/game/ot/difficulty.ts", import.meta.url);
  const src = readFileSync(F, "utf8").replace(/\r\n/g, "\n");
  const keep = Object.fromEntries(Object.entries(DIFFICULTY).filter(([id]) => !(id in out) && table[id]!.furyMs < 1e9));
  const line = (id: string, v: { dmg: number; hp: number; furyMs: number; beginner?: boolean }) =>
    `  "${id}": { dmg: ${v.dmg}, hp: ${v.hp}, furyMs: ${v.furyMs}${v.beginner ? ", beginner: true" : ""} },`;
  const all = { ...keep, ...out };
  const body = Object.entries(all)
    .map(([id, v]) => line(id, v))
    .join("\n");
  const next = src.replace(/export const DIFFICULTY[^]*$/, `export const DIFFICULTY: Readonly<Record<string, Difficulty>> = {\n${body}\n};\n`);
  writeFileSync(F, next);
  console.log("gravado em difficulty.ts");
}
