// Laboratório de grupo (24/11/2026, pedido do dono: "a party completa é importante; sem algum
// membro, a deficiência precisa ser evidente"). Em cada dungeon, no level de entrada e acima, a
// vitória do grupo completo (as quatro classes) e dos quatro trios a que falta uma delas, e o
// level em que cada um fica confortável (vence 70% ou mais).
//
// Rodar (no space-core): node scripts/party-lab.ts [dungeon …] [--seeds 30] [--plus 0,5,10,20]
// [--json saida.json]. Pesado: rodar com prioridade baixa e uma rodada por vez.
import { writeFileSync } from "node:fs";
import { type VocationId, DUNGEONS, MAX_LEVEL, simulateRun } from "../src/game/ot/index.ts";
import { RUN, monsterDef } from "../src/game/ot/index.ts";
import { heroAt } from "./simHero.ts";
if (process.env.PARTY) Object.assign((RUN as unknown as { party: object }).party, JSON.parse(process.env.PARTY));
if (process.env.FURY) Object.assign((RUN as unknown as { fury: object }).fury, JSON.parse(process.env.FURY));
// MTUNE (só para afinar): {"dungeon": [vida, corpo a corpo, magia]} multiplica os monstros dela na memória.
const MT = JSON.parse(process.env.MTUNE ?? "{}") as Record<string, [number, number, number]>;
for (const [id, [hp, mel, mag]] of Object.entries(MT)) {
  const dd = DUNGEONS.find((x) => x.id === id);
  for (const mid of new Set(dd?.stages.flatMap((st) => st.monsters.map((g) => g.id)) ?? [])) {
    const m = monsterDef(mid) as unknown as { health: number; attacks: { kind: string; min: number; max: number }[] };
    m.health = Math.round(m.health * hp);
    for (const at of m.attacks) {
      const k = at.kind === "melee" ? mel : mag;
      at.min = Math.round(at.min * k);
      at.max = Math.round(at.max * k);
    }
  }
}

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : def;
};
const SEEDS = Number(opt("seeds", "30"));
const PLUS = opt("plus", "0,5,10,20").split(",").map(Number);
const only = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

export const PARTIES: [string, VocationId[]][] = [
  ["completo", [4, 3, 2, 1]],
  ["sem cavaleiro", [3, 2, 1]],
  ["sem arqueiro", [4, 2, 1]],
  ["sem druida", [4, 3, 1]],
  ["sem feiticeiro", [4, 3, 2]],
];

function win(dungeon: string, party: VocationId[], level: number, seeds = SEEDS): number {
  let w = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = simulateRun({ seed: seed * 104729, dungeon, heroes: party.map((v) => heroAt(v, level)), rateLoot: 2 });
    if (r.outcome === "vitoria") w++;
  }
  return Math.round((100 * w) / seeds);
}

/** O primeiro level a partir da entrada com 70% ou mais (até +80 ou o teto). */
function comfortable(dungeon: string, party: VocationId[], from: number): number | null {
  const step = (l: number) => (l < 30 ? 2 : l < 100 ? 3 : l < 200 ? 5 : 10);
  for (let l = from; l <= Math.min(MAX_LEVEL, from + 80); l += step(l))
    if (win(dungeon, party, l, Math.max(10, Math.round(SEEDS / 2))) >= 70) return l;
  return null;
}

const out: unknown[] = [];
for (const d of DUNGEONS) {
  if (only.length && !only.includes(d.id)) continue;
  const rows = PARTIES.map(([name, party]) => {
    const wins = PLUS.map((p) => win(d.id, party, Math.min(MAX_LEVEL, d.minLevel + p)));
    return { name, wins, comfy: comfortable(d.id, party, d.minLevel) };
  });
  console.log(`\n== ${d.id} (entra L${d.minLevel})  vitórias em +${PLUS.join("/+")} · confortável`);
  for (const r of rows)
    console.log(`  ${r.name.padEnd(15)} ${r.wins.map((w) => String(w).padStart(3) + "%").join(" ")}   ${r.comfy ?? "—"}`);
  out.push({ dungeon: d.id, minLevel: d.minLevel, rows });
}
const json = opt("json", "");
if (json) writeFileSync(json, JSON.stringify(out, null, 1));
