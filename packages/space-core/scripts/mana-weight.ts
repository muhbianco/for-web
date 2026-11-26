/* global console, process */
/**
 * O peso da mana na corrida (26/11/2026, pedido do dono: "a mana tá de enfeite"). Para cada
 * nível, os grupos de calibração do limite (D41) numa Masmorra do nível, modo esperado, com os
 * quadros gravados. Por herói:
 *   - gasto de mana em skill por segundo, a regeneração natural e a razão entre os dois;
 *   - o gasto por minuto em % da mana máxima e o custo médio de uma skill em % da mana máxima;
 *   - o mínimo de mana na corrida, quanto tempo passou abaixo de 30% (a poção) e de 10%;
 *   - poções de mana e de vida bebidas;
 *   - o teste do peso: a mesma corrida com a mana daquele herói infinita. Quantas skills a mais
 *     ele solta (as que a mana barrou) e quanto o grupo termina mais rápido.
 * E a vida, para comparar: o mínimo e o tempo abaixo de 50%.
 *
 *   node scripts/mana-weight.ts [--levels 40,100,200,300,400,500]
 */
import {
  type ClassId,
  type DungeonDef,
  type FighterInput,
  type RunResult,
  DUNGEONS,
  balance as B,
  createMonsters,
  simulateRun,
} from "../src/game/ot/balance/index.ts";
import {
  LIMIT_GROUP_PARTIES,
  limitFighter,
} from "../src/game/ot/balance/sim/calibration.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LEVELS = (arg("--levels") ?? "40,100,200,300,400,500")
  .split(",")
  .map(Number);
const PARTIES = [0, 1, 3].map((i) => [...LIMIT_GROUP_PARTIES[i]!]);
const M = createMonsters(B);

const masmorraAt = (L: number): DungeonDef =>
  DUNGEONS.filter((d) => d.kind === "masmorra").reduce((a, b) =>
    Math.abs(b.level - L) < Math.abs(a.level - L) ? b : a,
  );

const run = (d: DungeonDef, party: FighterInput[], record = false) =>
  simulateRun(d, party, { mode: "esperado", record }, B, M);

const infinite = (f: FighterInput): FighterInput => ({
  ...f,
  stats: { ...f.stats, mp: 1e12 },
});

const castsOf = (r: RunResult, j: number) =>
  r.rooms.reduce(
    (a, room) =>
      a +
      Object.values(room.heroes[j]!.casts).reduce((x, y) => x + y, 0),
    0,
  );

interface Row {
  L: number;
  dg: string;
  cls: ClassId;
  party: string;
  mpMax: number;
  hpMax: number;
  spendPerS: number;
  regenPerS: number;
  spendPctPerMin: number;
  costPct: number;
  minMp: number;
  under30: number;
  under10: number;
  endMp: number;
  mpPots: number;
  hpPots: number;
  minHp: number;
  hpUnder50: number;
  castsLost: number;
  fasterInf: number;
  seconds: number;
  outcome: string;
}

const noMp = (f: FighterInput): FighterInput => ({
  ...f,
  potions: {
    ...f.potions,
    hpStock: f.potions.hpStock ?? f.potions.stock,
    mpStock: 0,
  },
});
const noHp = (f: FighterInput): FighterInput => ({
  ...f,
  potions: {
    ...f.potions,
    mpStock: f.potions.mpStock ?? f.potions.stock,
    hpStock: 0,
  },
});
const potionRows: string[] = [];

const rows: Row[] = [];
for (const L of LEVELS) {
  const d = masmorraAt(L);
  for (const comp of PARTIES) {
    const party = comp.map((c) => limitFighter(c, d.level, {}, B));
    const r = run(d, party, true);
    const frames = r.frames ?? [];
    const allInf = run(d, party.map(infinite));
    const dryMp = run(d, party.map(noMp));
    const dryHp = run(d, party.map(noHp));
    potionRows.push(
      [
        d.level,
        comp.map((x) => x.slice(0, 3)).join("+"),
        `${r.outcome} ${Math.round(r.seconds)}s`,
        `${dryMp.outcome} ${Math.round(dryMp.seconds)}s`,
        comp
          .map((c, j) => `${c.slice(0, 3)} ${castsOf(r, j) > 0 ? Math.round(100 * (1 - castsOf(dryMp, j) / castsOf(r, j))) : 0}%`)
          .join(" "),
        `${dryHp.outcome} ${Math.round(dryHp.seconds)}s`,
      ].join("\t"),
    );
    comp.forEach((cls, j) => {
      const f = party[j]!;
      const mpMax = f.stats.mp;
      const hpMax = f.stats.hp;
      let spent = 0;
      for (const room of r.rooms)
        for (const [id, n] of Object.entries(room.heroes[j]!.casts)) {
          const s = f.skills.find((x) => x.id === id);
          if (s) spent += n * s.manaPct * f.stats.manaBase;
        }
      const casts = castsOf(r, j);
      const regen =
        mpMax * B.cfg.regen.mpPctPerSecond +
        B.cfg.regen.mpPerIntPerSecond * f.stats.attrs.INT;
      const mp = frames.map((x) => (x.m[j] ?? 0) / mpMax);
      const hp = frames.map((x) => (x.h[j] ?? 0) / hpMax);
      const alive = frames.filter((x) => (x.h[j] ?? 0) > 0).length || 1;
      const only = run(
        d,
        party.map((x, k) => (k === j ? infinite(x) : x)),
      );
      rows.push({
        L: d.level,
        dg: d.id,
        cls,
        party: comp.map((x) => x.slice(0, 3)).join("+"),
        mpMax,
        hpMax,
        spendPerS: spent / Math.max(1, r.seconds),
        regenPerS: regen,
        spendPctPerMin: (60 * spent) / Math.max(1, r.seconds) / mpMax,
        costPct:
          f.skills.length > 0
            ? f.skills.reduce((a, s) => a + s.manaPct * f.stats.manaBase, 0) /
              f.skills.length /
              mpMax
            : 0,
        minMp: Math.min(1, ...mp),
        under30: mp.filter((x) => x < 0.3).length / alive,
        under10: mp.filter((x) => x < 0.1).length / alive,
        endMp: mp.at(-1) ?? 1,
        mpPots: r.rooms.reduce((a, room) => a + room.heroes[j]!.mpPotions, 0),
        hpPots: r.rooms.reduce((a, room) => a + room.heroes[j]!.hpPotions, 0),
        minHp: Math.min(1, ...hp.filter((x) => x > 0)),
        hpUnder50: hp.filter((x) => x > 0 && x < 0.5).length / alive,
        castsLost: casts > 0 ? castsOf(only, j) / casts - 1 : 0,
        fasterInf: 1 - allInf.seconds / Math.max(1, r.seconds),
        seconds: r.seconds,
        outcome: `${r.outcome}${allInf.outcome !== r.outcome ? `→${allInf.outcome}` : ""}`,
      });
    });
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n1 = (x: number) => (Math.round(x * 10) / 10).toString();
console.log(
  "L\tdg\tgrupo\tclasse\tgasto/s\tregen/s\tgasto÷regen\tgasto/min (% mana)\tcusto skill (% mana)\tmín mana\t<30%\t<10%\tfim\tpoção MP\tpoção HP\tmín vida\tvida<50%\tskills barradas\tgrupo + rápido c/ mana ∞\ttempo\tresultado",
);
for (const r of rows)
  console.log(
    [
      r.L,
      r.dg,
      r.party,
      r.cls,
      n1(r.spendPerS),
      n1(r.regenPerS),
      n1(r.spendPerS / r.regenPerS),
      pct(r.spendPctPerMin),
      pct(r.costPct),
      pct(r.minMp),
      pct(r.under30),
      pct(r.under10),
      pct(r.endMp),
      r.mpPots,
      r.hpPots,
      pct(r.minHp),
      pct(r.hpUnder50),
      pct(r.castsLost),
      pct(r.fasterInf),
      Math.round(r.seconds),
      r.outcome,
    ].join("\t"),
  );

console.log("\nSEM POÇÃO (o grupo inteiro)");
console.log(
  "L\tgrupo\tnormal\tsem poção de mana\tskills perdidas sem poção de mana\tsem poção de vida",
);
for (const l of potionRows) console.log(l);

// Resumo por classe (média dos níveis e grupos).
const by = new Map<ClassId, Row[]>();
for (const r of rows) by.set(r.cls, [...(by.get(r.cls) ?? []), r]);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log("\nRESUMO POR CLASSE (média)");
console.log(
  "classe\tgasto÷regen\tgasto/min (% mana)\tcusto skill (% mana)\tmín mana\t<30%\tpoção MP/corrida\tpoção HP/corrida\tskills barradas",
);
for (const [cls, rs] of by)
  console.log(
    [
      cls,
      n1(avg(rs.map((r) => r.spendPerS / r.regenPerS))),
      pct(avg(rs.map((r) => r.spendPctPerMin))),
      pct(avg(rs.map((r) => r.costPct))),
      pct(avg(rs.map((r) => r.minMp))),
      pct(avg(rs.map((r) => r.under30))),
      n1(avg(rs.map((r) => r.mpPots))),
      n1(avg(rs.map((r) => r.hpPots))),
      pct(avg(rs.map((r) => r.castsLost))),
    ].join("\t"),
  );
console.log("\nRESUMO POR NÍVEL (média das classes)");
console.log("L\tgasto÷regen\tmín mana\tpoção MP/herói\tpoção HP/herói\tskills barradas\tgrupo + rápido c/ mana ∞");
for (const L of [...new Set(rows.map((r) => r.L))]) {
  const rs = rows.filter((r) => r.L === L);
  console.log(
    [
      L,
      n1(avg(rs.map((r) => r.spendPerS / r.regenPerS))),
      pct(avg(rs.map((r) => r.minMp))),
      n1(avg(rs.map((r) => r.mpPots))),
      n1(avg(rs.map((r) => r.hpPots))),
      pct(avg(rs.map((r) => r.castsLost))),
      pct(avg(rs.map((r) => r.fasterInf))),
    ].join("\t"),
  );
}
