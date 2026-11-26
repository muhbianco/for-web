import assert from "node:assert/strict";
import test from "node:test";

import { type ClassId, CLASS_IDS } from "./content.ts";
import { balance as B } from "./formulas.ts";
import { reference as R } from "./reference.ts";
import { encounters as E } from "./sim/encounters.ts";

// As tabelas de referência do spec (§17, tolerância de ±2%) e os invariantes 6 e 7 da §14. HP de
// lacaio, de chefe menor e de chefe de masmorra saem do DPS de referência medido pelo motor de luta.

const TOL = 0.02;

function within(actual: number, expected: number, what: string, tol = TOL) {
  if (expected === 0) {
    assert.equal(actual, 0, what);
    return;
  }
  const rel = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(
    rel <= tol,
    `${what}: ${actual} contra ${expected} (${(100 * rel).toFixed(2)}%)`,
  );
}

/** Porcentagem da tabela, que vem arredondada para inteiro. */
function pct(actual: number, expected: number, what: string) {
  assert.ok(
    Math.abs(100 * actual - expected) <= 0.5 + 1e-9,
    `${what}: ${(100 * actual).toFixed(2)}% contra ${expected}%`,
  );
}

/**
 * §17, 1ª tabela. Colunas: nível, job, tier, N, K, XP para o próximo, corridas acumuladas, HP tanque,
 * HP caçador, HP lacaio*, golpe lacaio, HP chefe menor*, golpe chefe menor, HP chefe de masmorra (4)*,
 * golpe chefe, pulso, poção de vida, poção de mana, ouro por lacaio. (*) dependem do combate.
 *
 * Poções do L10 e do L40 trocadas pelas faixas novas (10 e 35; decisão do dono de 25/11/2026, P29):
 * no spec eram 7/4 e 18/13. Com as faixas de 10 em 10 até o 100 (P86, 26/11/2026) mudam também as
 * do L30 (18/13 → 24/18), do L40 (28/20 → 31/22) e do L70 (39/27 → 56/37).
 */
const PROGRESSION: ReadonlyArray<readonly number[]> = [
  [1, 1, 1, 11.9, 56, 374, 0, 157, 111, 102, 9, 853, 15, 7555, 33, 29, 7, 4, 4],
  [
    10, 11, 1, 37.4, 110, 4319, 16, 359, 193, 420, 18, 3500, 30, 32441, 94, 55,
    12, 8, 14,
  ],
  [
    20, 17, 1, 52.7, 170, 14717, 44, 660, 293, 914, 28, 7620, 47, 69516, 184,
    86, 18, 13, 28,
  ],
  [
    30, 22, 2, 64.2, 230, 32367, 83, 990, 406, 1437, 40, 11976, 67, 106811, 284,
    122, 24, 18, 43,
  ],
  [
    40, 26, 3, 73.9, 290, 58033, 133, 1330, 523, 1938, 52, 16154, 87, 142686,
    387, 158, 31, 22, 59,
  ],
  [
    50, 30, 3, 82.4, 350, 92345, 194, 1700, 653, 2512, 66, 20929, 110, 183426,
    499, 199, 39, 27, 75,
  ],
  [
    70, 38, 4, 96.9, 470, 188990, 348, 2496, 937, 3669, 96, 30574, 160, 272757,
    744, 288, 56, 37, 109,
  ],
  [
    100, 49, 4, 115.0, 650, 410440, 663, 3888, 1451, 5745, 150, 47874, 250,
    429150, 1181, 450, 87, 51, 163,
  ],
  [
    150, 66, 4, 139.5, 950, 1006269, 1408, 6668, 2362, 9870, 248, 82252, 413,
    748562, 2084, 741, 142, 75, 257,
  ],
  [
    200, 81, 4, 159.7, 1250, 1914998, 2428, 10060, 3337, 15526, 353, 129380,
    588, 1168841, 3227, 1056, 200, 99, 357,
  ],
  [
    250, 95, 4, 177.2, 1550, 3164303, 3723, 14128, 4465, 22194, 477, 184950,
    795, 1670295, 4649, 1425, 268, 123, 461,
  ],
  [
    300, 108, 4, 192.8, 1850, 4777385, 5292, 18897, 5678, 30151, 612, 251258,
    1020, 2270860, 6374, 1826, 341, 147, 568,
  ],
  [
    350, 121, 4, 207.0, 2150, 6774413, 7137, 24302, 6946, 39713, 756, 330944,
    1260, 2978198, 8397, 2252, 417, 171, 677,
  ],
  [
    400, 133, 4, 220.0, 2450, 9173337, 9257, 30498, 8412, 50136, 924, 417799,
    1540, 3746705, 10789, 2747, 505, 195, 789,
  ],
  [
    450, 145, 4, 232.1, 2750, 11990406, 11652, 37422, 9918, 61441, 1099, 512008,
    1832, 4591661, 13547, 3262, 595, 219, 903,
  ],
  [
    500, 150, 4, 243.3, 3050, 0, 14321, 45200, 11428, 74506, 1278, 620884, 2130,
    5506602, 16735, 3785, 686, 243, 1019,
  ],
];

test("§17: progressão, golpes dos monstros, poções e ouro por nível", () => {
  for (const row of PROGRESSION) {
    const [
      L,
      job,
      ,
      // O tier do gabarito era pelo nível (T3 no 40, T4 no 70); desde a D51 é só pelo job.
      n,
      k,
      xpNext,
      runs,
      hpTank,
      hpHunter,
      ,
      hitLacaio,
      ,
      hitMenor,
      ,
      hitBoss,
      pulse,
      potHp,
      potMp,
      gold,
    ] = row as number[];
    const at = `L${L}`;
    assert.equal(B.jobForLevel(L!), job, `${at} job`);
    const tierByJob = job! < 20 ? 1 : job! < 40 ? 2 : job! < 70 ? 3 : 4;
    assert.equal(B.tierFor(job!), tierByJob, `${at} tier`);
    within(B.normalizer(L!), n!, `${at} N`);
    within(B.defenseK(L!), k!, `${at} K`);
    within(B.xpToNext(L!), xpNext!, `${at} XP para o próximo`);
    within(B.runsTo(L!), runs!, `${at} corridas acumuladas`);
    within(R.tankReference(L!).hp, hpTank!, `${at} HP tanque`);
    within(R.hunterReference(L!).hp, hpHunter!, `${at} HP caçador`);
    const hits = R.monsterHits(L!);
    within(hits.lacaio, hitLacaio!, `${at} golpe lacaio`);
    within(hits.chefeMenor, hitMenor!, `${at} golpe chefe menor`);
    within(hits.chefe, hitBoss!, `${at} golpe chefe`);
    within(hits.pulso, pulse!, `${at} pulso`);
    within(R.potionHp(L!), potHp!, `${at} poção de vida`);
    within(R.potionMp(L!), potMp!, `${at} poção de mana`);
    within(B.lacaioGold(L!), gold!, `${at} ouro por lacaio`);
  }
});

test("§17: HP de lacaio, elite, chefe menor e chefe de masmorra pelo DPS de referência", () => {
  const mon = B.cfg.monsters;
  for (const row of PROGRESSION) {
    const [L, , , , , , , , , hpLacaio, , hpMenor, , hpBoss] = row as number[];
    const at = `L${L}`;
    const solo = E.referenceSoloDps(L!);
    // A tabela do spec usa 3 s; o jogo usa 9 s desde a calibragem da Fase 6 (D18).
    within(3 * solo, hpLacaio!, `${at} HP lacaio`);
    within(mon.menorHpSeconds * solo, hpMenor!, `${at} HP chefe menor`);
    within(E.dungeonBoss(L!, 4).hp, hpBoss!, `${at} HP chefe de masmorra (4)`);
  }
});

/** §17, 2ª tabela: HP, MP, ATQ, MATQ, red. física %, red. mágica %, crítico vs chefe %, evasão vs chefe %, erro vs lacaio %, ataques/s. */
const HEROES: ReadonlyArray<readonly [ClassId, number, ...number[]]> = [
  ["guerreiro", 40, 1376, 151, 410, 28, 59, 22, 4, 11, 20, 1.06],
  ["paladino", 40, 1284, 355, 406, 70, 59, 25, 4, 1, 20, 0.91],
  ["padre", 40, 616, 893, 167, 629, 33, 42, 6, 1, 0, 0.71],
  ["druida", 40, 670, 803, 169, 535, 42, 34, 6, 11, 15, 0.88],
  ["mago", 40, 379, 1072, 177, 647, 31, 42, 9, 1, 0, 0.71],
  ["cacador", 40, 523, 305, 570, 55, 40, 27, 20, 27, 9, 1.03],
  ["assassino", 40, 579, 253, 448, 43, 40, 27, 34, 29, 20, 1.35],
  ["guerreiro", 100, 4049, 343, 996, 68, 61, 24, 5, 15, 16, 1.21],
  ["paladino", 100, 3726, 1036, 977, 174, 61, 27, 5, 1, 16, 0.91],
  ["padre", 100, 1649, 2653, 446, 1625, 33, 42, 7, 1, 0, 0.71],
  ["druida", 100, 1823, 2343, 394, 1344, 43, 34, 7, 15, 13, 1.01],
  ["mago", 100, 1005, 3213, 461, 1672, 32, 42, 8, 1, 0, 0.71],
  ["cacador", 100, 1451, 707, 1459, 107, 42, 29, 22, 28, 9, 1.13],
  ["assassino", 100, 1645, 583, 1124, 84, 42, 29, 33, 29, 19, 1.47],
  ["guerreiro", 500, 48032, 1851, 7799, 296, 68, 28, 5, 15, 13, 1.39],
  ["paladino", 500, 42369, 8566, 7242, 651, 68, 34, 5, 0, 13, 0.91],
  ["padre", 500, 14814, 30813, 3323, 15432, 35, 48, 6, 0, 0, 0.71],
  ["druida", 500, 16842, 26360, 2023, 12086, 48, 38, 6, 14, 12, 1.16],
  ["mago", 500, 7292, 37766, 3416, 16313, 34, 49, 8, 0, 0, 0.71],
  ["cacador", 500, 11428, 4164, 13948, 383, 46, 34, 21, 27, 8, 1.29],
  ["assassino", 500, 13357, 3342, 9803, 338, 46, 34, 34, 28, 15, 1.65],
];

test("§17: herói de referência (build e equipamento Raro +4 do nível, proficiência 10 × nível)", () => {
  for (const [
    cls,
    L,
    hp,
    mp,
    atk,
    matk,
    rf,
    rm,
    crit,
    avoid,
    miss,
    aps,
  ] of HEROES) {
    const h = R.referenceHero(cls, L);
    const v = R.versus(h);
    const at = `${cls} L${L}`;
    within(h.hp, hp!, `${at} HP`);
    within(h.mp, mp!, `${at} MP`);
    within(h.atk, atk!, `${at} ATQ`);
    within(h.matk, matk!, `${at} MATQ`);
    pct(v.physicalReduction, rf!, `${at} redução física`);
    pct(v.magicReduction, rm!, `${at} redução mágica`);
    pct(v.critVsBoss, crit!, `${at} crítico vs chefe`);
    pct(v.avoidVsBoss, avoid!, `${at} evasão vs chefe`);
    pct(v.missVsLacaio, miss!, `${at} erro vs lacaio`);
    within(h.attacksPerSecond, aps!, `${at} ataques/s`);
  }
});

test("§14.6: crítico e evasão variam ≤ 5 p.p. e a redução física ≤ 10 p.p. entre L40 e L500", () => {
  for (const cls of CLASS_IDS) {
    const a = R.versus(R.referenceHero(cls, 40));
    const b = R.versus(R.referenceHero(cls, 500));
    assert.ok(Math.abs(a.critVsBoss - b.critVsBoss) <= 0.05, `${cls}: crítico`);
    assert.ok(
      Math.abs(a.avoidVsBoss - b.avoidVsBoss) <= 0.05,
      `${cls}: evasão`,
    );
    assert.ok(
      Math.abs(a.physicalReduction - b.physicalReduction) <= 0.1,
      `${cls}: redução física`,
    );
  }
});

/** Horas de Dojô até a base 10 × nível, do gabarito (seção 5 do relatório dele). */
const DOJO_HOURS: ReadonlyArray<readonly [number, number]> = [
  [10, 0.64],
  [40, 5.557],
  [70, 15.895],
  [100, 32.334],
  [200, 136.399],
  [300, 324.008],
  [500, 977.009],
];

test("§14.7: ritmo — horas de Dojô dentro de ±10% e job 20 entre o L24 e o L28", () => {
  for (const [L, hours] of DOJO_HOURS)
    within(B.dojoHoursTo(10 * L), hours, `Dojô até a base ${10 * L}`, 0.1);
  let first = 0;
  for (let L = 1; L <= 500 && !first; L++)
    if (B.jobForLevel(L) >= 20) first = L;
  assert.ok(first >= 24 && first <= 28, `job 20 no L${first}`);
  assert.equal(B.jobForLevel(500), 150);
});

test("§7: marcos de pontos de habilidade (T2 → 19; T3 no L40 → ~25; T4 no L70 → ~37; L100 → ~48)", () => {
  assert.equal(B.jobForLevel(40) - 1, 25);
  assert.equal(B.jobForLevel(70) - 1, 37);
  assert.equal(B.jobForLevel(100) - 1, 48);
});
