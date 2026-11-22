import assert from "node:assert/strict";
import { test } from "node:test";

import { freshHero, refHero } from "../testing/game.ts";
import {
  CLASS_IDS,
  DEFAULT_TACTICS,
  type HeroCombat,
  heroCombat,
  maxHpWithBoons,
  reachableLanes,
  RULES,
  type RunChoice,
  type RunState,
  settleRun,
  simpleSeeds,
  startRun,
  stepRun,
} from "./index.ts";

// Refúgio (ADR 0009): a expedição como máquina de estados pura.

const tactics = { ...DEFAULT_TACTICS, order: [] };

/** Política simples: aceita a primeira bênção, cura no descanso, recusa evento, sai da loja, trilha mais baixa. */
function autoplay(s0: RunState, hc: HeroCombat, seed: number, pick?: (s: RunState) => RunChoice): { s: RunState; steps: number } {
  const seeds = simpleSeeds(seed);
  let s = s0;
  let steps = 0;
  while (!s.end && steps < 100) {
    const choice: RunChoice =
      pick?.(s) ??
      (s.offer && s.offer.kind !== "loja"
        ? { t: "choose", option: s.offer.kind === "bencao" ? 0 : s.offer.kind === "descanso" ? 0 : 1 }
        : { t: "go", lane: reachableLanes(s)[0]! });
    const r = stepRun(s, hc, tactics, choice, seeds);
    assert.ok(r.ok, `passo ${steps}: ${!r.ok && r.error}`);
    s = r.state;
    steps++;
  }
  return { s, steps };
}

function start(hc: HeroCombat, seed: number, over: Partial<Parameters<typeof startRun>[0]> = {}): RunState {
  return startRun({ degree: "normal", abyss: 1, initiation: false, hp: hc.maxHp, mp: hc.maxMp, potions: 3, ...over }, simpleSeeds(seed));
}

test("expedição: a iniciação é vencível por todas as classes novas", () => {
  for (const cls of CLASS_IDS) {
    const hc = heroCombat(freshHero(cls));
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { s } = autoplay(start(hc, seed, { initiation: true }), hc, seed);
      if (s.end === "vitoria") wins++;
    }
    assert.ok(wins >= 36, `${cls}: ${wins}/40`);
  }
});

test("expedição: termina em até 8 salas, com experiência e tentativas de skill", () => {
  const hc = refHero("cavaleiro", 10, 15, 10, "incomum");
  const { s, steps } = autoplay(start(hc, 5), hc, 5);
  assert.ok(s.end);
  assert.ok(s.row <= RULES.rows - 1);
  assert.ok(steps <= 40, `${steps} passos`);
  assert.ok(s.xp > 0);
  assert.ok((s.tries.espada ?? 0) > 0);
  // O estado cabe com folga no documento do herói (ADR: ≤ 32 KB no total).
  assert.ok(JSON.stringify(s).length < 12_000, `${JSON.stringify(s).length} bytes`);
});

test("expedição: a mesma semente e as mesmas escolhas dão a mesma expedição", () => {
  const hc = refHero("arqueiro", 12, 20, 12, "raro");
  const a = autoplay(start(hc, 99), hc, 99).s;
  const b = autoplay(start(hc, 99), hc, 99).s;
  assert.deepEqual(a, b);
  const c = autoplay(start(hc, 100), hc, 100).s;
  assert.notDeepEqual(a.map, c.map);
});

test("expedição: stepRun não altera o estado de entrada", () => {
  const hc = refHero("druida", 5, 8, 5, "comum");
  const s = start(hc, 3);
  const before = JSON.stringify(s);
  const r = stepRun(s, hc, tactics, { t: "go", lane: 0 }, simpleSeeds(3));
  assert.ok(r.ok);
  assert.equal(JSON.stringify(s), before);
});

test("expedição: trilha inválida, oferta pendente e expedição encerrada são recusadas", () => {
  const hc = refHero("cavaleiro", 30, 40, 30, "epico");
  const seeds = simpleSeeds(11);
  let s = start(hc, 11);
  assert.deepEqual(stepRun(s, hc, tactics, { t: "go", lane: 3 }, seeds), { ok: false, error: "bad_lane" });
  assert.deepEqual(stepRun(s, hc, tactics, { t: "go", lane: 0.5 }, seeds), { ok: false, error: "bad_lane" });
  assert.deepEqual(stepRun(s, hc, tactics, { t: "choose", option: 0 }, seeds), { ok: false, error: "no_offer" });
  // Anda até aparecer uma oferta que trava (bênção, descanso ou evento) e tenta seguir.
  for (let i = 0; i < 8 && !(s.offer && s.offer.kind !== "loja"); i++) {
    const r = stepRun(s, hc, tactics, { t: "go", lane: reachableLanes(s)[0]! }, seeds);
    assert.ok(r.ok);
    s = r.state;
    if (s.end) break;
  }
  if (s.offer && s.offer.kind !== "loja" && !s.end) {
    assert.deepEqual(stepRun(s, hc, tactics, { t: "go", lane: reachableLanes(s)[0]! }, seeds), { ok: false, error: "offer_pending" });
  }
  const done = autoplay(s, hc, 11).s;
  assert.deepEqual(stepRun(done, hc, tactics, { t: "go", lane: 0 }, seeds), { ok: false, error: "ended" });
});

test("expedição: retirada só no descanso da linha 5 em diante, e guarda a bolsa inteira", () => {
  const hc = refHero("cavaleiro", 40, 50, 40, "epico");
  const seeds = simpleSeeds(21);
  // Mapa à mão: descanso na linha 2 (não deixa) e na linha 5 (deixa).
  let s = start(hc, 21);
  s.map = s.map.map((row, r) => row.map((n) => ({ ...n, type: r === 1 || r === 4 ? ("descanso" as const) : n.type === "chefe" ? n.type : ("tesouro" as const) })));
  const go = () => {
    const r = stepRun(s, hc, tactics, { t: "go", lane: reachableLanes(s)[0]! }, seeds);
    assert.ok(r.ok);
    s = r.state;
  };
  go(); // linha 1: tesouro
  go(); // linha 2: descanso
  assert.deepEqual(s.offer, { kind: "descanso", retreat: false });
  assert.deepEqual(stepRun(s, hc, tactics, { t: "choose", option: 2 }, seeds), { ok: false, error: "bad_option" });
  const healed = stepRun(s, hc, tactics, { t: "choose", option: 1 }, seeds);
  assert.ok(healed.ok);
  s = healed.state;
  go();
  go(); // linhas 3 e 4: tesouro
  go(); // linha 5: descanso
  assert.deepEqual(s.offer, { kind: "descanso", retreat: true });
  const bag = { gold: s.bagGold, items: s.bagItems.length };
  assert.ok(bag.items >= 3);
  const out = stepRun(s, hc, tactics, { t: "choose", option: 2 }, seeds);
  assert.ok(out.ok);
  assert.equal(out.state.end, "retirada");
  const reward = settleRun(out.state);
  assert.equal(reward.gold, bag.gold);
  assert.equal(reward.items.length, bag.items);
});

test("expedição: morrer guarda a experiência e metade do ouro, e perde os itens", () => {
  const hc = refHero("feiticeiro", 1, 1, 1, "comum");
  // Abismo 10 com herói novo: morre na primeira luta.
  let s = start(hc, 31, { degree: "abismo", abyss: 10 });
  s.bagGold = 101;
  s.bagItems = structuredClone(autoplay(start(refHero("feiticeiro", 30, 40, 30, "raro"), 1), refHero("feiticeiro", 30, 40, 30, "raro"), 1).s.bagItems);
  const r = stepRun(s, hc, tactics, { t: "go", lane: 0 }, simpleSeeds(31));
  assert.ok(r.ok);
  s = r.state;
  assert.equal(s.end, "morte");
  const reward = settleRun(s);
  assert.equal(reward.end, "morte");
  assert.equal(reward.items.length, 0);
  assert.equal(reward.gold, Math.floor(s.bagGold / 2));
  assert.equal(reward.hp, 1);
  assert.equal(reward.xp, s.xp);
});

test("expedição: abandonar no meio conta como morte", () => {
  const hc = refHero("arqueiro", 20, 30, 20, "raro");
  const r = stepRun(start(hc, 41), hc, tactics, { t: "go", lane: 1 }, simpleSeeds(41));
  assert.ok(r.ok);
  const s = { ...r.state, bagGold: 50, end: null };
  assert.equal(settleRun(s).end, "morte");
  assert.equal(settleRun(s).gold, 25);
});

test("expedição: loja vende poção até o limite e bênção abre uma escolha", () => {
  const hc = refHero("druida", 15, 20, 15, "raro");
  const seeds = simpleSeeds(51);
  let s = start(hc, 51, { potions: 1 });
  s.map = s.map.map((row, r) => row.map((n) => ({ ...n, type: r === 0 ? ("loja" as const) : n.type })));
  let r = stepRun(s, hc, tactics, { t: "go", lane: 0 }, seeds);
  assert.ok(r.ok);
  s = { ...r.state, bagGold: 1000 };
  assert.equal(s.offer?.kind, "loja");
  for (let i = 0; i < 2; i++) {
    r = stepRun(s, hc, tactics, { t: "choose", option: 0 }, seeds);
    assert.ok(r.ok);
    s = r.state;
  }
  assert.equal(s.potions, 3);
  assert.deepEqual(stepRun(s, hc, tactics, { t: "choose", option: 0 }, seeds), { ok: false, error: "full" });
  r = stepRun(s, hc, tactics, { t: "choose", option: 1 }, seeds);
  assert.ok(r.ok);
  assert.equal(r.state.offer?.kind, "bencao");
  const poor = { ...s, bagGold: 0 };
  assert.deepEqual(stepRun(poor, hc, tactics, { t: "choose", option: 1 }, seeds), { ok: false, error: "no_gold" });
});

test("expedição: a vida nunca passa do máximo com as bênçãos", () => {
  const hc = refHero("cavaleiro", 25, 35, 25, "raro");
  for (let seed = 1; seed <= 30; seed++) {
    const seeds = simpleSeeds(seed);
    let s = start(hc, seed);
    while (!s.end) {
      // Aceita tudo (altar, baú, andarilho quando dá), para passar por todos os caminhos que mexem na vida.
      const o = s.offer;
      const choice: RunChoice =
        o && o.kind !== "loja"
          ? { t: "choose", option: o.kind === "evento" && o.event === "andarilho" && s.bagGold < o.price ? 1 : 0 }
          : { t: "go", lane: reachableLanes(s)[0]! };
      const r = stepRun(s, hc, tactics, choice, seeds);
      assert.ok(r.ok);
      s = r.state;
      assert.ok(s.hp <= maxHpWithBoons(hc, s.boons), `semente ${seed}: ${s.hp}`);
      assert.ok(s.potions <= RULES.maxPotions);
      assert.ok(s.bagItems.length <= RULES.bagItemsMax);
    }
  }
});
