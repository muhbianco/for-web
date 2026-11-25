import assert from "node:assert/strict";
import test from "node:test";

import { balance as B } from "./formulas.ts";
import { gainXp, levelProgress } from "./progress.ts";

// Subida de nível e de job (spec §2).

test("o XP sobe o nível e o job; o que sobra fica na barra", () => {
  const fresh = { level: 1, job: 1 };
  const up = gainXp(fresh, B.xpTotalAt(10) + 5, 0);
  assert.equal(up.hero.level, 10);
  assert.equal(up.levelsGained, 9);
  assert.deepEqual(levelProgress(up.hero), { into: 5, need: B.xpToNext(10) });
  const job = gainXp(fresh, 0, B.jobXpTotalAt(20));
  assert.equal(job.hero.job, 20);
  assert.equal(job.jobsGained, 19);
});

test("quem sobe só com XP de DG chega no job do spec (30% do XP de nível)", () => {
  let h = { level: 1, job: 1 } as Parameters<typeof gainXp>[0];
  for (let L = 1; L < 100; L++) {
    const xp = B.xpToNext(L);
    h = gainXp(h, xp, Math.floor(xp * B.cfg.xp.jobShare)).hero;
  }
  assert.equal(h.level, 100);
  // §2: job 49 no L100 (o arredondamento por corrida pode tirar 1).
  assert.ok(Math.abs(h.job - B.jobForLevel(100)) <= 1, `job ${h.job}`);
});

test("nos tetos (500 e 150) o XP para de contar", () => {
  const top = gainXp({ level: 1, job: 1 }, 1e15, 1e15);
  assert.equal(top.hero.level, 500);
  assert.equal(top.hero.job, 150);
  assert.equal(top.hero.xp, B.xpTotalAt(500));
  assert.equal(top.hero.jobXp, B.jobXpTotalAt(150));
  // Nunca desce, nem com XP negativo.
  const same = gainXp(top.hero, -10, -10);
  assert.equal(same.hero.level, 500);
  assert.equal(same.levelsGained, 0);
});
