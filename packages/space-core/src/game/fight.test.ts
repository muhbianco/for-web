import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLASS_IDS,
  DEFAULT_TACTICS,
  type EnemyId,
  fight,
  type FightEvent,
  type FightInput,
  GAME_ENGINE,
  NO_BOONS,
  RULES,
  baseHitCenti,
  tacticSpells,
} from "./index.ts";
import { refHero } from "../testing/game.ts";

// Refúgio (ADR 0009): a luta é determinística e é a mesma no servidor e no app.

function input(over: Partial<FightInput> & Pick<FightInput, "hero" | "foes">): FightInput {
  return {
    engine: GAME_ENGINE,
    seed: 1,
    hp: 99_999,
    mp: 99_999,
    potions: 3,
    boons: { ...NO_BOONS },
    tactics: { ...DEFAULT_TACTICS, order: [] },
    degree: "normal",
    abyss: 1,
    foePct: 100,
    ...over,
  };
}

const GOLDEN: [string, FightInput, Record<string, unknown>][] = [
  [
    "cavaleiro nv 1 contra dois ratos",
    input({ hero: refHero("cavaleiro", 1, 1, 1, "comum"), foes: ["rato", "rato"] }),
    { won: true, hp: 176, mp: 22, potions: 3, durationMs: 8200, kills: 2, events: 20, tries: { espada: 38, escudo: 21 } },
  ],
  [
    "druida nv 20 contra o chefe do Difícil, com eco",
    input({ seed: 42, hero: refHero("druida", 20, 30, 20, "raro"), foes: ["matriarca"], degree: "dificil", boons: { ...NO_BOONS, echoBp: 2500 } }),
    { won: true, hp: 246, mp: 652, potions: 3, durationMs: 18820, kills: 3, events: 39, tries: { magia: 102, escudo: 30 } },
  ],
  [
    "feiticeiro nv 40 no Abismo 3",
    input({
      seed: 7777,
      hero: refHero("feiticeiro", 40, 50, 40, "epico"),
      foes: ["esqueleto", "fungo", "rato", "esqueleto"],
      degree: "abismo",
      abyss: 3,
      potions: 2,
      boons: { ...NO_BOONS, dmgPct: 20 },
    }),
    { won: true, hp: 149, mp: 1407, potions: 1, durationMs: 17340, kills: 4, events: 45, tries: { magia: 106, escudo: 51 } },
  ],
];

test("luta: resultados de ouro (mudou? suba GAME_ENGINE e atualize aqui)", () => {
  for (const [name, inp, want] of GOLDEN) {
    const r = fight(inp);
    assert.deepEqual(
      { won: r.won, hp: r.hp, mp: r.mp, potions: r.potions, durationMs: r.durationMs, kills: r.kills.length, events: r.events, tries: r.tries },
      want,
      name,
    );
  }
});

test("luta: a mesma entrada dá o mesmo resultado, e o registro não muda o resultado", () => {
  for (const [, inp] of GOLDEN) {
    const a = fight(structuredClone(inp));
    const log: FightEvent[] = [];
    const b = fight(structuredClone(inp), (e) => log.push(e));
    assert.deepEqual(a, b);
    assert.ok(log.length > 0);
    // Os eventos estão em ordem de tempo e dentro da luta.
    for (let i = 1; i < log.length; i++) assert.ok(log[i]!.t >= log[i - 1]!.t);
    assert.ok(log[log.length - 1]!.t <= a.durationMs);
    // Cada morte registrada é uma morte contada.
    assert.equal(log.filter((e) => e.k === "die").length, a.kills.length);
  }
});

test("luta: a entrada não é alterada (o servidor grava a mesma que manda ao app)", () => {
  const inp = GOLDEN[1]![1];
  const before = JSON.stringify(inp);
  fight(inp);
  assert.equal(JSON.stringify(inp), before);
});

test("luta: herói sem dano nenhum termina no limite como derrota, nunca passa dele", () => {
  const hero = { ...refHero("cavaleiro", 1, 1, 1, "comum"), atk: 0, armor: 10_000_000 };
  const r = fight(input({ hero, foes: ["esqueleto", "esqueleto"], degree: "abismo", abyss: 30, boons: { ...NO_BOONS, maxHpPct: 5000 } }));
  assert.equal(r.won, false);
  assert.ok(r.durationMs <= RULES.fightLimitMs);
});

test("luta: herói morto não volta a ganhar, e vida 0 de entrada perde na hora", () => {
  const r = fight(input({ hero: refHero("arqueiro", 1, 1, 1, "comum"), hp: 0, foes: ["rato"] }));
  assert.equal(r.won, false);
  assert.equal(r.events, 0);
});

test("luta: cada classe nova vence dois ratos no Normal", () => {
  for (const cls of CLASS_IDS) {
    let wins = 0;
    for (let seed = 1; seed <= 50; seed++) if (fight(input({ seed, hero: refHero(cls, 1, 1, 1, "comum"), foes: ["rato", "rato"] })).won) wins++;
    assert.ok(wins >= 45, `${cls}: ${wins}/50`);
  }
});

test("luta: tática respeita a ordem escolhida e ignora magia não liberada ou de outra classe", () => {
  const hc = refHero("feiticeiro", 30, 40, 30, "raro");
  assert.deepEqual(
    tacticSpells(hc, { ...DEFAULT_TACTICS, order: ["raio", "meteoro", "bola_de_fogo", "golpe_pesado"] }).map((s) => s.id),
    ["raio", "meteoro", "bola_de_fogo"],
  );
  const low = refHero("feiticeiro", 4, 5, 4, "comum");
  assert.deepEqual(tacticSpells(low, { ...DEFAULT_TACTICS, order: ["raio"] }).map((s) => s.id), ["bola_de_fogo"]);
});

test("luta: golpe base do cavaleiro novo bate com o GDD (24,39)", () => {
  assert.equal(baseHitCenti(refHero("cavaleiro", 1, 1, 1, "comum")), 2439);
});

test("luta: custo no servidor (2.000 lutas de chefe do Abismo, bem abaixo de 1 ms cada)", () => {
  const hero = refHero("druida", 60, 60, 55, "lendario");
  const foes: EnemyId[] = ["matriarca"];
  const t0 = process.hrtime.bigint();
  let worst = 0n;
  for (let seed = 0; seed < 2000; seed++) {
    const s = process.hrtime.bigint();
    fight(input({ seed, hero, foes, degree: "abismo", abyss: 8, boons: { ...NO_BOONS, wardPct: 30 } }));
    const d = process.hrtime.bigint() - s;
    if (d > worst) worst = d;
  }
  const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
  // Folgado de propósito (a máquina do CI varia): a meta da ADR é < 1 ms por comando.
  assert.ok(totalMs < 2000, `total ${totalMs.toFixed(0)} ms`);
  assert.ok(Number(worst) / 1e6 < 50, `pior ${Number(worst) / 1e6} ms`);
});
