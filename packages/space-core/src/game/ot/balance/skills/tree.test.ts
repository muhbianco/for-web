import assert from "node:assert/strict";
import test from "node:test";

import { SKILLS_BY_CLASS } from "./index.ts";
import {
  type HeroSkills,
  evolve,
  fitSkillsToJob,
  freshBuild,
  freshHeroSkills,
  resetSkills,
  setSlots,
  skillPoints,
  skillPointsSpent,
  spendPoint,
} from "./tree.ts";

// A árvore de habilidades (spec §6 e §7).

/** Gasta `n` pontos na ordem dada (potência e eficiência das skills, depois mecânicas). */
function spendAll(
  hs: HeroSkills,
  job: number,
  cls: "guerreiro" | "mago" = "guerreiro",
): HeroSkills {
  let cur = hs;
  for (;;) {
    let moved = false;
    for (const id of Object.keys(cur.builds))
      for (const target of ["potencia", "eficiencia"] as const) {
        const r = spendPoint(cls, job, cur, id, target);
        if (r.ok) {
          cur = r.skills;
          moved = true;
        }
      }
    if (!moved) return cur;
  }
}

test("pontos: 1 por nível de job acima do 1, até 149", () => {
  assert.equal(skillPoints(1), 0);
  assert.equal(skillPoints(20), 19);
  assert.equal(skillPoints(150), 149);
  assert.equal(skillPoints(999), 149);
});

test("herói novo: T1 com as 2 skills do T1 aprendidas e nos slots", () => {
  const hs = freshHeroSkills("guerreiro");
  assert.equal(hs.tier, 1);
  assert.deepEqual(hs.slots, ["golpe-provocador", "grito-de-guerra"]);
  assert.equal(skillPointsSpent(hs), 0);
});

test("tetos: Potência 5 no T1, Eficiência 5, Mecânica bloqueada até o tier, sem pontos", () => {
  let hs = freshHeroSkills("guerreiro");
  for (let i = 0; i < 4; i++) {
    const r = spendPoint("guerreiro", 30, hs, "golpe-provocador", "potencia");
    assert.ok(r.ok);
    if (r.ok) hs = r.skills;
  }
  assert.equal(hs.builds["golpe-provocador"]!.potency, 5);
  assert.deepEqual(
    spendPoint("guerreiro", 30, hs, "golpe-provocador", "potencia"),
    {
      ok: false,
      error: "potencia-no-teto",
    },
  );
  assert.deepEqual(
    spendPoint("guerreiro", 30, hs, "golpe-provocador", {
      mechanic: "desafio",
    }),
    {
      ok: false,
      error: "mecanica-bloqueada",
    },
  );
  assert.deepEqual(
    spendPoint("guerreiro", 30, hs, "muralha-de-ferro", "potencia"),
    {
      ok: false,
      error: "skill-nao-aprendida",
    },
  );
  assert.deepEqual(
    spendPoint("guerreiro", 5, hs, "grito-de-guerra", "eficiencia"),
    {
      ok: false,
      error: "sem-pontos",
    },
  );
});

test("evolução: marco do job + pontos gastos (o que cabe); aprende as skills novas e preenche os slots", () => {
  const hs = freshHeroSkills("guerreiro");
  assert.deepEqual(evolve("guerreiro", 19, hs), {
    ok: false,
    error: "marco-nao-alcancado",
  });
  assert.deepEqual(evolve("guerreiro", 20, hs), {
    ok: false,
    error: "pontos-nao-gastos",
  });
  const full = spendAll(hs, 20);
  // No T1 cabem 18 (2 × (4 de Potência + 5 de Eficiência)); o job 20 dá 19 (P38).
  assert.equal(skillPointsSpent(full), 18);
  const r = evolve("guerreiro", 20, full);
  assert.ok(r.ok);
  if (!r.ok) return;
  // D51: o T2 dá só a 3ª skill (Muralha de Ferro); o Redemoinho passou para o T3.
  assert.equal(r.skills.tier, 2);
  assert.deepEqual(r.skills.slots, [
    "golpe-provocador",
    "grito-de-guerra",
    "muralha-de-ferro",
  ]);
  assert.equal(r.skills.builds["redemoinho"], undefined);
  // O nível do herói não conta mais: só o job 40 abre o T3.
  assert.deepEqual(evolve("guerreiro", 39, spendAll(r.skills, 39)), {
    ok: false,
    error: "marco-nao-alcancado",
  });
  const r3 = evolve("guerreiro", 40, spendAll(r.skills, 40));
  assert.ok(r3.ok);
  if (!r3.ok) return;
  assert.equal(r3.skills.tier, 3);
  assert.deepEqual(r3.skills.slots, [
    "golpe-provocador",
    "grito-de-guerra",
    "muralha-de-ferro",
    "redemoinho",
  ]);
  assert.ok(r3.skills.builds["ultima-resistencia"]);
  assert.deepEqual(evolve("guerreiro", 69, spendAll(r3.skills, 69)), {
    ok: false,
    error: "marco-nao-alcancado",
  });
  const r4 = evolve("guerreiro", 70, spendAll(r3.skills, 70));
  assert.ok(r4.ok);
  if (r4.ok) assert.ok(r4.skills.builds["estandarte-de-guerra"]);
});

test("D51: skills por tier em toda classe — 2 no T1, 1 no T2, 2 no T3, 1 no T4", () => {
  for (const [cls, list] of Object.entries(SKILLS_BY_CLASS))
    assert.deepEqual(
      [1, 2, 3, 4].map((t) => list.filter((s) => s.tier === t).length),
      [2, 1, 2, 1],
      cls,
    );
});

test("D51: herói acima do que o job dá desce, perde a skill e recebe os pontos de volta", () => {
  // O caso do dono: T3 no job 23 (o nível 48 abria o T3), com os pontos gastos.
  let hs = freshHeroSkills("guerreiro");
  hs = (evolve("guerreiro", 20, spendAll(hs, 20)) as { skills: HeroSkills })
    .skills;
  hs = { ...hs, tier: 3 };
  for (const id of ["redemoinho", "ultima-resistencia"])
    hs.builds[id] = freshBuild();
  hs.slots = [
    "golpe-provocador",
    "grito-de-guerra",
    "muralha-de-ferro",
    "ultima-resistencia",
  ];
  hs.ai = {
    "ultima-resistencia": [{ kind: "sempre" }],
    "grito-de-guerra": [{ kind: "sempre" }],
  };
  hs = spendAll(hs, 23);
  hs.resets = 1;
  const r = fitSkillsToJob("guerreiro", 27, hs);
  assert.equal(r.changed, true);
  assert.equal(r.skills.tier, 2);
  assert.deepEqual(Object.keys(r.skills.builds).sort(), [
    "golpe-provocador",
    "grito-de-guerra",
    "muralha-de-ferro",
  ]);
  assert.equal(skillPointsSpent(r.skills), 0);
  assert.deepEqual(r.skills.slots, [
    "golpe-provocador",
    "grito-de-guerra",
    "muralha-de-ferro",
  ]);
  assert.deepEqual(Object.keys(r.skills.ai), ["grito-de-guerra"]);
  // A redistribuição grátis não é gasta.
  assert.equal(r.skills.resets, 1);
  // Quem está dentro das regras fica como está, e a adequação é idempotente.
  assert.deepEqual(fitSkillsToJob("guerreiro", 27, r.skills), {
    skills: r.skills,
    changed: false,
  });
  const ok = spendAll(r.skills, 27);
  assert.equal(fitSkillsToJob("guerreiro", 27, ok).changed, false);
  // T2 com a skill que subiu para o T3 (Redemoinho, aprendida no T2 antigo): perde só por ela.
  const t2old = { ...ok, builds: { ...ok.builds, redemoinho: freshBuild() } };
  const r2 = fitSkillsToJob("guerreiro", 27, t2old);
  assert.equal(r2.changed, true);
  assert.equal(r2.skills.tier, 2);
  assert.equal(r2.skills.builds["redemoinho"], undefined);
  assert.equal(skillPointsSpent(r2.skills), 0);
});

test("slots: até 4, sem repetir, só skills aprendidas", () => {
  const hs = freshHeroSkills("mago");
  assert.ok(setSlots("mago", hs, ["explosao-de-fogo", "seta-arcana"]).ok);
  assert.deepEqual(setSlots("mago", hs, ["seta-arcana", "seta-arcana"]), {
    ok: false,
    error: "slot-repetido",
  });
  assert.deepEqual(setSlots("mago", hs, ["meteoro"]), {
    ok: false,
    error: "slot-invalido",
  });
  assert.deepEqual(setSlots("mago", hs, ["a", "b", "c", "d", "e"]), {
    ok: false,
    error: "slots-demais",
  });
});

test("redistribuir: a 1ª é grátis, depois 5.000 fixos (D25); os slots ficam", () => {
  const hs = spendAll(freshHeroSkills("guerreiro"), 15);
  const first = resetSkills(hs);
  assert.equal(first.cost, 0);
  assert.equal(skillPointsSpent(first.skills), 0);
  assert.deepEqual(first.skills.slots, hs.slots);
  assert.equal(resetSkills(first.skills).cost, 5000);
});
