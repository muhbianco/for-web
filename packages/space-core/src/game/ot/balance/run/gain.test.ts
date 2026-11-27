import assert from "node:assert/strict";
import test from "node:test";

import {
  type GainRunRow,
  GAIN_MAX_LEAD_S,
  createVictoryXp,
  gainByDungeon,
  gainPerHour,
  snapXpMult,
} from "./gain.ts";

const victoryXp = createVictoryXp();

/**
 * As quatro Masmorras 60 do grupo do Mear em 27/11/2026 (rpg_runs5 de produção): Erudhir, Mear,
 * Acais e stalo, ninguém caiu. O XP gravado foi 33.567 para quem estava ×1, 50.350 para o Acais (×1,5)
 * e 16.783 para o stalo (×0,5); no nível de antes, 35.957 / 53.935 / 17.978.
 */
const M60: Omit<GainRunRow, "me" | "xp" | "jobXp" | "gold">[] = [
  {
    dungeon: "masmorra-60",
    outcome: "vitoria",
    startedAt: 1795783698877,
    seconds: 128,
    levels: [69, 66, 61, 68],
    dead: [false, false, false, false],
  },
  {
    dungeon: "masmorra-60",
    outcome: "vitoria",
    startedAt: 1795783839203,
    seconds: 131,
    levels: [69, 66, 61, 68],
    dead: [false, false, false, false],
  },
  {
    dungeon: "masmorra-60",
    outcome: "vitoria",
    startedAt: 1795783982530,
    seconds: 124,
    levels: [69, 67, 62, 69],
    dead: [false, false, false, false],
  },
  {
    dungeon: "masmorra-60",
    outcome: "vitoria",
    startedAt: 1795784118796,
    seconds: 128,
    levels: [69, 67, 62, 69],
    dead: [false, false, false, false],
  },
];

test("XP da vitória pela conta das salas bate com o gravado em produção (Masmorra 60, grupo de 4)", () => {
  assert.deepEqual(
    victoryXp("masmorra-60", [69, 66, 61, 68]),
    [35957, 35957, 35957, 35957],
  );
  // O grupo subiu de nível: a média passou de 66 para 67 e a diferença para o 60 já tira XP.
  assert.deepEqual(
    victoryXp("masmorra-60", [69, 67, 62, 69]),
    [33567, 33567, 33567, 33567],
  );
  assert.equal(victoryXp("nao-existe", [10]), null);
});

test("o multiplicador da stamina sai da razão, com folga para o arredondamento", () => {
  assert.equal(snapXpMult(50350 / 33567), 1.5);
  assert.equal(snapXpMult(16783 / 33567), 0.5);
  assert.equal(snapXpMult(1), 1);
  // Fora da folga (quem caiu e levantou perdeu abates): não reconhece.
  assert.equal(snapXpMult(0.8), null);
  assert.equal(snapXpMult(0), null);
  // Com a taxa do servidor em 2.
  assert.equal(snapXpMult(3, 2), 3);
});

test("ganho por DG: o tempo conta a largada medida; o XP de quem estava ×1,5 e ×0,5 sai como rende hoje (igual)", () => {
  const acais = M60.map((r, i) => ({
    ...r,
    me: 2,
    xp: i < 2 ? 53935 : 50350,
    jobXp: 0,
    gold: 4538,
  }));
  const stalo = M60.map((r, i) => ({
    ...r,
    me: 3,
    xp: i < 2 ? 17978 : 16783,
    jobXp: 0,
    gold: 4538,
  }));
  const a = gainByDungeon(acais, { victoryXp });
  const s = gainByDungeon(stalo, { victoryXp });
  assert.equal(a.runs, 4);
  // As largadas: 140,3 − 128, 143,3 − 131, 136,3 − 124 ≈ 12,3 s; a última corrida soma a mediana.
  assert.ok(Math.abs(a.leadSeconds - 12.326) < 0.01, String(a.leadSeconds));
  const g = a.dungeons[0]!;
  assert.equal(g.dungeon, "masmorra-60");
  assert.equal(g.runSeconds, 511);
  assert.ok(Math.abs(g.cycleSeconds - (511 + 4 * 12.3)) < 0.5);
  const base = 2 * 35957 + 2 * 33567;
  // O gravado é arredondado para baixo depois do ×0,5: dividir de volta erra até 2 por corrida.
  assert.ok(Math.abs(a.dungeons[0]!.xp - base) <= 8);
  assert.ok(Math.abs(s.dungeons[0]!.xp - base) <= 8);
  assert.equal(g.gold, 4 * 4538);
  assert.equal(g.wins, 4);
  assert.equal(g.deaths, 0);
});

test("corrida sem como deduzir (derrota, alguém caiu) usa a stamina da corrida mais perto; a gravada vale", () => {
  const rows: GainRunRow[] = [
    { ...M60[0]!, me: 3, xp: 17978, jobXp: 0, gold: 100 },
    {
      ...M60[1]!,
      outcome: "derrota",
      dead: [true, true, true, true],
      me: 3,
      xp: 9000,
      jobXp: 0,
      gold: 50,
    },
    // Gravada: vale mesmo que a conta da vitória dissesse outra coisa.
    { ...M60[2]!, me: 3, xp: 33567, jobXp: 0, gold: 100, xpMult: 1 },
  ];
  const r = gainByDungeon(rows, { victoryXp }).dungeons[0]!;
  assert.equal(r.runs, 3);
  assert.equal(r.wins, 2);
  assert.equal(r.deaths, 1);
  // 17978/0,5 + 9000/0,5 (a de antes era ×0,5) + 33567/1.
  assert.ok(Math.abs(r.xp - (35956 + 18000 + 33567)) <= 1);
});

test("pausa longa não vira tempo de DG; a DG que rende mais por hora vem primeiro", () => {
  const t0 = 1_800_000_000_000;
  const row = (
    dungeon: string,
    startedAt: number,
    seconds: number,
    xp: number,
  ): GainRunRow => ({
    dungeon,
    outcome: "vitoria",
    startedAt,
    seconds,
    levels: [50],
    dead: [false],
    me: 0,
    xp,
    jobXp: Math.floor(xp * 0.3),
    gold: 10,
    xpMult: 1,
  });
  const rows = [
    row("cacada-50", t0, 50, 1000),
    row("cacada-50", t0 + 60_000, 50, 1000),
    // 2 h parado antes da próxima: a cacada-50 desta corrida soma a largada mediana (10 s).
    row("cacada-50", t0 + 120_000, 50, 1000),
    row("masmorra-50", t0 + 120_000 + 7_200_000, 120, 3000),
    row("masmorra-50", t0 + 120_000 + 7_200_000 + 130_000, 120, 3000),
  ];
  const r = gainByDungeon(rows);
  assert.equal(r.leadSeconds, 10);
  const c = r.dungeons.find((d) => d.dungeon === "cacada-50")!;
  assert.equal(c.cycleSeconds, 3 * 60);
  const m = r.dungeons.find((d) => d.dungeon === "masmorra-50")!;
  assert.equal(m.cycleSeconds, 2 * 130);
  // Masmorra: 6000 XP em 260 s ≈ 83 mil/h; Caçada: 3000 em 180 s = 60 mil/h.
  assert.equal(r.dungeons[0]!.dungeon, "masmorra-50");
  assert.equal(Math.round(gainPerHour(m.xp, m.cycleSeconds)), 83077);
  assert.equal(Math.round(gainPerHour(c.xp, c.cycleSeconds)), 60000);
  assert.ok(GAIN_MAX_LEAD_S < 7_200);
  // Corridas gravadas com a taxa 1 e o servidor agora em 2: rendem o dobro hoje.
  const doubled = gainByDungeon(rows, { rate: 2 }).dungeons;
  assert.equal(doubled.find((d) => d.dungeon === "masmorra-50")!.xp, 12000);
});

test("sem corridas: nada, sem divisão por zero", () => {
  assert.deepEqual(gainByDungeon([]), {
    dungeons: [],
    runs: 0,
    leadSeconds: 0,
  });
  assert.equal(gainPerHour(100, 0), 0);
});
