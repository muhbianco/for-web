/* global console, process */
// A abertura de cada sala (27/11/2026, a suposição do dono: "muitas vezes entrei numa corrida com o
// mago já morto de largada. ele deve iniciar com ameaça alta e toma o primeiro hit da dg antes da gente
// ver ela"). No começo de cada sala a ameaça de todos é 0 e o alvo de todo monstro é o 1º da lista
// (combat/fight.ts, `alive[0]`); os monstros agem antes dos heróis no mesmo tique e o relógio do
// ataque começa em 0, então o 1º golpe de cada monstro sai no 1º segundo, antes da provocação.
// No jogo, o 1º da lista é quem criou o grupo (lobby.ts).
//
// Para cada DG calibrada, no nível de entrada, o grupo guerreiro, padre, mago, caçador, assassino com
// cada classe na frente: o resultado, o maior dano que o da frente leva no 1º segundo de uma sala (em
// % da vida máxima) e se ele cai nos 2 primeiros segundos de alguma sala.
//
//   node scripts/opening-aggro.ts [--limite] [--kind masmorra,regional,cacada] [--plus 0]
import type { ClassId } from "../src/game/ot/balance/content.ts";
import type { FighterInput } from "../src/game/ot/balance/combat/types.ts";
import { FOE_BASE } from "../src/game/ot/balance/combat/types.ts";
import { DUNGEONS } from "../src/game/ot/balance/dungeons/catalog.ts";
import { balance as B } from "../src/game/ot/balance/formulas.ts";
import { createMonsters } from "../src/game/ot/balance/monsters/generate.ts";
import { simulateRun } from "../src/game/ot/balance/run/simulate.ts";
import { belowLimitFighter, limitFighter } from "../src/game/ot/balance/sim/calibration.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : def;
};
const LIMIT = args.includes("--limite");
const KINDS = opt("kind", "masmorra,regional").split(",");
const PLUS = Number(opt("plus", "0"));
const M = createMonsters(B);

const BASE: ClassId[] = ["guerreiro", "padre", "mago", "cacador", "assassino"];
const LEADERS: ClassId[] = ["guerreiro", "padre", "mago", "cacador", "assassino"];
const SHORT: Record<string, string> = { guerreiro: "guer", padre: "padre", mago: "mago", cacador: "caç", assassino: "assa" };

interface Cell { win: boolean; open: number; fall: number | null; deaths: number }

function run(dg: (typeof DUNGEONS)[number], order: ClassId[]): Cell {
  const L = Math.min(500, dg.minLevel + PLUS);
  const party: FighterInput[] = order.map((c) => (LIMIT ? limitFighter(c, L, {}, B) : belowLimitFighter(c, L, {}, B)));
  const max0 = party[0]!.stats.hp;
  const r = simulateRun(dg, party, { mode: "esperado", record: true }, B, M);
  const start = new Map<number, number>();
  const dmg = new Map<number, number>();
  let fall: number | null = null;
  for (const f of r.frames ?? []) {
    if (!start.has(f.st)) start.set(f.st, f.s);
    const rel = f.s - start.get(f.st)! + 1;
    for (const e of f.e) {
      if (rel === 1 && (e.k === "golpe" || e.k === "magia") && e.b === 0 && e.a >= FOE_BASE && !("cura" in e && e.cura))
        dmg.set(f.st, (dmg.get(f.st) ?? 0) + e.v);
      if (e.k === "queda" && e.b === 0 && rel <= 2 && fall === null) fall = f.st + 1;
    }
  }
  return {
    win: r.outcome === "vitoria",
    open: Math.max(0, ...dmg.values()) / max0,
    fall,
    deaths: r.rooms.reduce((a, x) => a + x.deaths, 0),
  };
}

const dgs = DUNGEONS.filter((d) => KINDS.includes(d.kind) && d.party.max >= 5);
console.log(`# Abertura das salas — ${LIMIT ? "herói no limite" : "herói abaixo do limite (farm)"}, nível de entrada${PLUS ? ` +${PLUS}` : ""}`);
console.log(`# célula: resultado (V/D) · maior dano no 1º segundo de uma sala no da frente (% da vida) · † sala em que ele cai nos 2 primeiros s`);
console.log(`${"DG".padEnd(16)} ${LEADERS.map((l) => `${SHORT[l]!} na frente`.padEnd(20)).join("")}`);
const tally = new Map<ClassId, { falls: number; wins: number; open: number[] }>();
for (const l of LEADERS) tally.set(l, { falls: 0, wins: 0, open: [] });
for (const d of dgs) {
  const cells = LEADERS.map((lead) => {
    const order = [lead, ...BASE.filter((c) => c !== lead)];
    const c = run(d, order);
    const t = tally.get(lead)!;
    if (c.fall !== null) t.falls++;
    if (c.win) t.wins++;
    t.open.push(c.open);
    return `${c.win ? "V" : "D"} ${String(Math.round(c.open * 100)).padStart(3)}%${c.fall !== null ? ` †${c.fall}` : ""}`.padEnd(20);
  });
  console.log(`${d.id.padEnd(16)} ${cells.join("")}`);
}
console.log(`\n# resumo (${dgs.length} DGs)`);
for (const [l, t] of tally) {
  const s = [...t.open].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)] ?? 0;
  console.log(`  ${l.padEnd(10)} na frente: vence ${t.wins}/${dgs.length} · cai na largada de uma sala em ${t.falls} · dano de largada mediano ${Math.round(med * 100)}%, máx ${Math.round((s[s.length - 1] ?? 0) * 100)}%`);
}
process.exit(0);
