import assert from "node:assert/strict";
import { test } from "node:test";

import {
  baseItem,
  CLASS_IDS,
  DEFAULT_TACTICS,
  type Degree,
  type EnemyId,
  GAME_ENGINE,
  heroCombat,
  type HeroCore,
  NO_BOONS,
  type Rarity,
  SKILL_IDS,
  SLOTS,
} from "@muchat/space-core/game";

import { buildTimeline, frameAt } from "./replay.ts";

// Refúgio (ADR 0009): a reprise do app chega à mesma luta do servidor.

function hero(cls: (typeof CLASS_IDS)[number], level: number, skill: number, ilvl: number, rarity: Rarity) {
  const skills = Object.fromEntries(SKILL_IDS.map((s) => [s, { l: skill, p: 0 }])) as HeroCore["skills"];
  const gear: HeroCore["gear"] = {};
  for (const slot of SLOTS) gear[slot] = baseItem(`it${slot}`, slot, rarity, ilvl, cls);
  return heroCombat({ cls, level, skills, gear });
}

const CASES: { degree: Degree; abyss: number; level: number; skill: number; ilvl: number; rarity: Rarity; foes: EnemyId[] }[] = [
  { degree: "normal", abyss: 1, level: 1, skill: 1, ilvl: 1, rarity: "comum", foes: ["rato", "fungo"] },
  { degree: "normal", abyss: 1, level: 5, skill: 10, ilvl: 5, rarity: "incomum", foes: ["matriarca"] },
  { degree: "dificil", abyss: 1, level: 15, skill: 25, ilvl: 15, rarity: "raro", foes: ["ossario", "esqueleto"] },
  { degree: "abismo", abyss: 4, level: 45, skill: 55, ilvl: 46, rarity: "epico", foes: ["fungo", "fungo", "esqueleto", "rato"] },
];

test("reprise: o último quadro tem a vida final do servidor, para toda classe e degrau", () => {
  let checked = 0;
  for (const cls of CLASS_IDS) {
    for (const c of CASES) {
      for (let seed = 1; seed <= 15; seed++) {
        const input = {
          engine: GAME_ENGINE,
          seed,
          hero: hero(cls, c.level, c.skill, c.ilvl, c.rarity),
          hp: 99_999,
          mp: 99_999,
          potions: 3,
          boons: { ...NO_BOONS, regenPerMille: seed % 3 === 0 ? 5 : 0, wardPct: seed % 4 === 0 ? 15 : 0 },
          tactics: { ...DEFAULT_TACTICS, order: [] },
          foes: c.foes,
          degree: c.degree,
          abyss: c.abyss,
          foePct: 100,
        };
        const tl = buildTimeline(input);
        const end = frameAt(tl, tl.durationMs);
        assert.equal(end.heroHp, tl.result.hp, `${cls} ${c.degree} semente ${seed}`);
        assert.equal(end.foes.filter((f) => !f.alive).length, tl.result.kills.length);
        if (tl.result.won) assert.ok(end.foes.every((f) => !f.alive || !f.visible));
        assert.ok(end.done);
        checked++;
      }
    }
  }
  assert.equal(checked, 4 * CASES.length * 15);
});

test("reprise: quadros no meio da luta são coerentes (vida dentro dos limites, recentes na janela)", () => {
  const input = {
    engine: GAME_ENGINE,
    seed: 9,
    hero: hero("druida", 8, 12, 8, "incomum"),
    hp: 99_999,
    mp: 99_999,
    potions: 3,
    boons: { ...NO_BOONS },
    tactics: { ...DEFAULT_TACTICS, order: [] },
    foes: ["matriarca"] as EnemyId[],
    degree: "normal" as Degree,
    abyss: 1,
    foePct: 100,
  };
  const tl = buildTimeline(input);
  assert.ok(tl.exact);
  for (let t = 0; t <= tl.durationMs; t += 250) {
    const f = frameAt(tl, t, 700);
    assert.ok(f.heroHp >= 0 && f.heroHp <= f.heroMaxHp);
    for (const e of f.recent) assert.ok(e.t <= t && e.t > t - 700);
    for (const foe of f.foes) assert.ok(foe.hp >= 0 && foe.hp <= foe.maxHp);
  }
  // A Matriarca chama dois ratos no meio: entram invisíveis e aparecem.
  if (tl.foes.length > 1) {
    assert.equal(frameAt(tl, 0).foes[1]!.visible, false);
    assert.equal(frameAt(tl, tl.durationMs).foes[1]!.visible, true);
  }
});

test("reprise: motor de outra versão mostra o resultado do servidor", () => {
  const input = {
    engine: GAME_ENGINE + 1,
    seed: 1,
    hero: hero("cavaleiro", 1, 1, 1, "comum"),
    hp: 99_999,
    mp: 99_999,
    potions: 3,
    boons: { ...NO_BOONS },
    tactics: { ...DEFAULT_TACTICS, order: [] },
    foes: ["rato"] as EnemyId[],
    degree: "normal" as Degree,
    abyss: 1,
    foePct: 100,
  };
  const server = { won: false, timeout: false, hp: 0, mp: 0, potions: 0, durationMs: 1, tries: {}, kills: [], events: 1 };
  const tl = buildTimeline(input, server);
  assert.equal(tl.exact, false);
  assert.equal(tl.result, server);
});
