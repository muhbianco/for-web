import assert from "node:assert/strict";
import test from "node:test";

import { Rng } from "../../../rng.ts";
import { fight, randomSource } from "../combat/fight.ts";
import type { EnemyInput, FighterInput } from "../combat/types.ts";
import { CLASS_IDS } from "../content.ts";
import { DUNGEONS, dungeonById, dungeonRooms } from "../dungeons/catalog.ts";
import { DUNGEON_EDGE } from "../dungeons/edge.generated.ts";
import { balance as B } from "../formulas.ts";
import { createHero, heroRunFighter } from "../hero.ts";
import { simulateRun } from "../run/simulate.ts";
import {
  FARM_TRIOS,
  LIMIT_HUNT_GROUPS,
  REGION_PARTIES,
  belowLimitFighter,
} from "../sim/calibration.ts";
import { limitEncounters as E } from "../sim/encounters.ts";
import { computeMonsterRow, createMonsters } from "./generate.ts";
import { MONSTER_TABLE } from "./table.generated.ts";

// Monstros gerados (spec §11), catálogo (§12), mecânicas de chefe (§12.3) e a corrida inteira.

const M = createMonsters();
const SPEC = { source: "spec", referenceAi: "gabarito" } as const;

test("a tabela gerada está em dia com as fórmulas (rodar scripts/gen-monsters.ts se mudar)", () => {
  for (const L of [1, 37, 100, 251, 500]) {
    const live = computeMonsterRow(L);
    const row = MONSTER_TABLE[L]!;
    for (const k of Object.keys(live) as (keyof typeof live)[])
      assert.ok(
        Math.abs(row[k] / live[k] - 1) < 1e-8,
        `L${L} ${k}: tabela ${row[k]} × agora ${live[k]}`,
      );
  }
});

test("§11.2: lacaio, elite, chefe menor e chefe de masmorra pelas fórmulas", () => {
  const L = 120;
  const r = M.row(L);
  const solo = { partySize: 1, type: "cacada" as const };
  const four = { partySize: 4, type: "masmorra" as const };
  const lac = M.lacaio(L, solo);
  // D22: a régua do spec (3 s; elite 4×); D17: golpe ×0,5 na Caçada solo, ×0,75 em dupla.
  assert.equal(lac.hp, 3 * r.soloDps);
  assert.equal(lac.autoRaw, r.lacaioHit * 0.5);
  assert.equal(
    M.lacaio(L, { partySize: 2, type: "cacada" }).autoRaw,
    r.lacaioHit * 0.75,
  );
  assert.equal(
    M.lacaio(L, { partySize: 4, type: "masmorra" }).autoRaw,
    r.lacaioHit,
  );
  assert.equal(M.elite(L, solo).hp, 4 * lac.hp);
  assert.equal(M.elite(L, solo).autoRaw, 1.8 * lac.autoRaw);
  assert.equal(
    M.lacaio(L, four).hp,
    3 * r.soloDps * B.partyScale(4, "masmorra"),
  );
  assert.equal(M.chefeMenor(L, solo).hp, 25 * r.soloDps);
  assert.ok(Math.abs(M.chefe(L, four).hp - 80 * r.partyDps) < 1e-6);
  assert.ok(
    Math.abs(
      M.chefe(L, { partySize: 2, type: "masmorra" }).hp -
        (80 * r.partyDps * 2.5) / 3.25,
    ) < 1e-6,
  );
});

test("§12.3: mecânicas do chefe entram por faixa", () => {
  const o = { partySize: 4, type: "masmorra" as const };
  const at = (L: number) => M.chefe(L, o);
  assert.ok(!at(39).curse && at(40).curse);
  assert.ok(!at(69).summon && at(70).summon);
  assert.ok(!at(99).manaDrain && at(100).manaDrain && at(100).charge);
  assert.ok(!at(149).phase && at(150).phase);
  const reg = M.regional(50, o);
  assert.equal(reg.archetype, "regional");
  assert.ok(reg.phase && reg.finalPhase);
});

test("§12.2 e D19: catálogo com 50 Caçadas, 37 Masmorras (só do 40) e 10 Chefes de Região", () => {
  const count = (k: string) => DUNGEONS.filter((d) => d.kind === k).length;
  assert.equal(count("cacada"), 50);
  assert.equal(count("masmorra"), 37);
  assert.equal(count("regional"), 10);
  assert.equal(new Set(DUNGEONS.map((d) => d.id)).size, DUNGEONS.length);
  assert.equal(dungeonById("toca")?.id, "cacada-1");
  assert.ok(!DUNGEONS.some((d) => d.kind === "masmorra" && d.level < 40));
  const m = dungeonById("masmorra-130")!;
  assert.equal(m.minLevel, 125);
  assert.deepEqual(m.party, { min: 1, max: 5 });
  assert.deepEqual(dungeonById("cacada-130")!.party, { min: 1, max: 5 });
});

test("§12.1 e D14: salas 4 / 5 / 3 + elite / chefe; lacaios de R−4 a R; elite e chefe em R", () => {
  const d = dungeonById("masmorra-230")!;
  const rooms = dungeonRooms(d, 4, M);
  assert.deepEqual(
    rooms.map((r) => r.length),
    [4, 5, 4, 1],
  );
  for (const e of rooms.flat())
    if (e.archetype === "lacaio")
      assert.ok(e.level >= 226 && e.level <= 230, `lacaio ${e.level}`);
    else assert.equal(e.level, 230);
  // Região 5 (Terras Congeladas): metade dos lacaios bate com magia.
  const lacaios = rooms.flat().filter((e) => e.archetype === "lacaio");
  assert.ok(lacaios.filter((e) => e.magicAuto).length >= 5);
});

const hero = (cls: FighterInput["cls"], L = 120): FighterInput =>
  E.fighter(cls, L, SPEC);
const dummy = (extra: Partial<EnemyInput>): EnemyInput => ({
  archetype: "chefe",
  level: 120,
  hp: 1e15,
  autoRaw: 0,
  attacksPerSecond: 0.5,
  ...extra,
});

test("Maldição tira 3%/s de um não tanque; o Santuário do padre purifica", () => {
  const curse = {
    curse: { everySeconds: 20, pctPerSecond: 0.03, maxSeconds: 15 },
  };
  const noCleanse = fight([{ ...hero("mago"), skills: [] }], [dummy(curse)], {
    maxSeconds: 36,
    mode: "esperado",
  });
  assert.ok(
    noCleanse.heroes[0]!.hpPct < 0.6,
    `sem purificar: ${noCleanse.heroes[0]!.hpPct}`,
  );
  const withPriest = fight(
    [{ ...hero("mago"), skills: [] }, hero("padre")],
    [dummy(curse)],
    { maxSeconds: 36, mode: "esperado" },
  );
  assert.ok(withPriest.heroes[0]!.hpPct > noCleanse.heroes[0]!.hpPct);
});

test("Invocação traz lacaios; Drenar Mana seca o conjurador", () => {
  const minion = M.lacaio(120, { partySize: 1, type: "masmorra" });
  const s = fight(
    [hero("guerreiro")],
    [dummy({ summon: { everySeconds: 5, count: 2, minion } })],
    {
      maxSeconds: 11,
      mode: "esperado",
    },
  );
  assert.equal(s.enemiesLeft.length, 1 + 4);
  const drained = fight(
    [{ ...hero("mago"), skills: [], potions: { hp: 0, mp: 0, stock: 0 } }],
    [
      dummy({
        manaDrain: { everySeconds: 5, pctPerSecond: 0.03, durationSeconds: 6 },
      }),
    ],
    { maxSeconds: 12, mode: "esperado" },
  );
  assert.ok(drained.heroes[0]!.carry.mp < 0.9 * hero("mago").stats.mp);
});

test("a corrida leva HP e recargas de uma sala para a outra e acaba em vitória ou derrota, sem teto de tempo", () => {
  const d = dungeonById("masmorra-70")!;
  const party = ["guerreiro", "padre", "mago", "cacador"].map((c) =>
    hero(c as FighterInput["cls"], 70),
  );
  const win = simulateRun(d, party, { mode: "esperado" });
  assert.equal(win.outcome, "vitoria");
  assert.equal(win.rooms.length, 4);
  // Tolerância de ponto flutuante (127,3 × 127,30000000000001).
  assert.ok(win.seconds >= win.rooms.reduce((a, r) => a + r.seconds, 0) - 1e-6);
  // D53: perto do limite a composição pesa menos; sem tanque, abaixo do limite, perde.
  const lose = simulateRun(
    d,
    ["padre", "mago", "cacador", "assassino"].map((c) =>
      belowLimitFighter(c as FighterInput["cls"], 70),
    ),
    {
      mode: "esperado",
    },
  );
  assert.equal(lose.outcome, "derrota");
});

// ------------------------------------------------------------ calibragem da Fase 6 (D16–D19)

test("D16: a Investida vale 1,5× o golpe do chefe menor (não o do chefe, calibrado no tanque)", () => {
  const b = M.chefe(200, { partySize: 4, type: "masmorra" });
  const r = M.row(200);
  assert.ok(Math.abs(b.autoRaw * b.charge!.mult - 1.5 * r.menorHit) < 1e-6);
});

// D41 (25/11/2026, pedido do dono: "a pt só chega até o 500 se estiver no level máximo, com os
// melhores itens da classe, o kit do meta e os atributos da classe"): os monstros saem do perfil do
// limite e cada DG fica no ponto do grupo de calibração mais frágil (dungeons/edge.generated.ts). Os
// heróis destes testes estão no limite (limitEncounters); um degrau abaixo perde, e isso fica no relatório.
// D21/D22: nada se balanceia por tempo; a duração das salas não é cobrada.
/**
 * D71 (28/11/2026, o dono: "vamos aceitar o buff… temos mais níveis de DG do que força nos heróis"):
 * com o chefe novo o farm abaixo do limite vence ~9 em 10, não mais toda Masmorra. Quem perde é o
 * trio de um herói de dano só (os invocados tiram o dano dele do chefe); o grupo de 4 e o de 5 vencem
 * todas. Medido: 136 de 148 no modo esperado, toda Masmorra cai para 3 dos 4.
 */
test("D53/D71: o farm abaixo do limite vence ~9 em 10 Masmorras do nível (4 e 5 vencem todas); sem tanque e sem cura, perdem", () => {
  const below = (d: (typeof DUNGEONS)[number], c: readonly string[]) =>
    simulateRun(
      d,
      c.map((x) => belowLimitFighter(x as FighterInput["cls"], d.level)),
      { mode: "esperado" },
    );
  let wins = 0;
  let total = 0;
  for (const d of DUNGEONS.filter((x) => x.kind === "masmorra")) {
    let here = 0;
    for (const c of FARM_TRIOS) {
      const win = below(d, c).outcome === "vitoria";
      total++;
      if (win) wins++;
      if (win) here++;
      if (c.length >= 4) assert.ok(win, `${c.join("+")} ${d.id}`);
    }
    assert.ok(here >= FARM_TRIOS.length - 1, `${d.id}: só ${here} dos grupos de farm vencem`);
    if (![40, 70, 110, 160, 310, 490].includes(d.level)) continue;
    assert.notEqual(below(d, ["padre", "mago", "cacador"]).outcome, "vitoria", `${d.id} sem tanque`);
    assert.notEqual(below(d, ["guerreiro", "mago", "cacador"]).outcome, "vitoria", `${d.id} sem cura`);
  }
  assert.ok(wins / total >= 0.88, `o farm vence ${wins} de ${total}`);
});

test("D53: o chefe de Região (até o do 500) cai para os 4 no limite perfeito: tanque, tanque, cura, dano; tanque, cura, cura, dano; tanque, cura, dano, dano", () => {
  for (const d of DUNGEONS.filter((x) => x.kind === "regional"))
    for (const c of REGION_PARTIES)
      assert.equal(
        simulateRun(
          d,
          c.map((x) => hero(x as FighterInput["cls"], d.level)),
          { mode: "esperado" },
        ).outcome,
        "vitoria",
        `${c.join("+")} ${d.id}`,
      );
});

/** D40: na zona de entrada (fora do aperto do D41) o mago solo segue perdendo a Caçada do 30. */
const D40_MAGO_SOLO_ENTRY = new Set([30]);

test("D41/D53: no limite, toda classe vence sozinha a Caçada 10 níveis abaixo (a de entrada, a do nível), e os grupos de 2 a 5 a do próprio nível", () => {
  for (const d of DUNGEONS.filter((x) => x.kind === "cacada")) {
    // D53: fora da zona de entrada, sozinho se farma 10 abaixo; quem tem de vencer é o herói 10 acima.
    const soloLevel =
      d.level > B.cfg.limit.entryHuntsUpTo ? Math.min(500, d.level + 10) : d.level;
    for (const c of [
      "guerreiro",
      "paladino",
      "padre",
      "druida",
      "mago",
      "cacador",
      "assassino",
    ] as const) {
      const r = simulateRun(
        d,
        [E.fighter(c, soloLevel, { ...SPEC, solo: true })],
        { mode: "esperado" },
      );
      // Zona de entrada (sem aperto, como antes do D41): o mago solo perde a do 30 desde a D40.
      if (
        c === "mago" &&
        d.level <= B.cfg.limit.entryHuntsUpTo &&
        D40_MAGO_SOLO_ENTRY.has(d.level)
      )
        continue;
      assert.equal(r.outcome, "vitoria", `${c} ${d.id}`);
    }
    for (const group of Object.values(LIMIT_HUNT_GROUPS))
      for (const c of group)
        assert.equal(
          simulateRun(
            d,
            c.map((x) => hero(x, d.level)),
            { mode: "esperado" },
          ).outcome,
          "vitoria",
          `${c.join("+")} ${d.id}`,
        );
  }
});

// D37 e D41: as Caçadas da zona de entrada ficam fora do aperto (`limit.entryHuntsUpTo`): o herói
// recém-criado de toda classe, com o kit do jogo e sem treino, vence a 1ª (com o aperto, o mago novo
// perdia 59%, 26/11/2026).
test("D37: o herói recém-criado de toda classe vence a 1ª Caçada, no esperado e no aleatório", () => {
  const d = dungeonById("cacada-1")!;
  assert.equal(DUNGEON_EDGE[d.id], undefined);
  let n = 0;
  for (const cls of CLASS_IDS) {
    const f = heroRunFighter(createHero(cls, () => `h${n++}`));
    assert.equal(
      simulateRun(d, [f], { mode: "esperado" }).outcome,
      "vitoria",
      cls,
    );
    for (let i = 0; i < 40; i++)
      assert.equal(
        simulateRun(d, [f], {
          mode: "aleatorio",
          random: randomSource(new Rng(77 + i * 7919)),
        }).outcome,
        "vitoria",
        `${cls} semente ${i}`,
      );
  }
});

// D21: sem teto de tempo — a Caçada lenta do druida termina, só leva mais.
test("Caçada solo sem teto de tempo: o druida termina a do 451", () => {
  const d = DUNGEONS.find((x) => x.kind === "cacada" && x.level === 451)!;
  const r = simulateRun(
    d,
    [E.fighter("druida", 451, { ...SPEC, solo: true })],
    { mode: "esperado" },
  );
  assert.equal(r.outcome, "vitoria");
});
