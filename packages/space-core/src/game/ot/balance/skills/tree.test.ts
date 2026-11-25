import assert from "node:assert/strict";
import test from "node:test";

import {
  type HeroSkills,
  evolve,
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

test("evolução: marco + pontos gastos (o que cabe); aprende as skills novas e preenche os slots", () => {
  const hs = freshHeroSkills("guerreiro");
  assert.deepEqual(evolve("guerreiro", 25, 19, hs), {
    ok: false,
    error: "marco-nao-alcancado",
  });
  assert.deepEqual(evolve("guerreiro", 26, 20, hs), {
    ok: false,
    error: "pontos-nao-gastos",
  });
  const full = spendAll(hs, 20);
  // No T1 cabem 18 (2 × (4 de Potência + 5 de Eficiência)); o job 20 dá 19 (P38).
  assert.equal(skillPointsSpent(full), 18);
  const r = evolve("guerreiro", 26, 20, full);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.skills.tier, 2);
    assert.equal(r.skills.slots.length, 4);
    assert.ok(r.skills.builds["muralha-de-ferro"]);
    assert.ok(r.skills.builds["redemoinho"]);
    assert.deepEqual(evolve("guerreiro", 39, 26, spendAll(r.skills, 26)), {
      ok: false,
      error: "marco-nao-alcancado",
    });
    assert.ok(evolve("guerreiro", 40, 26, spendAll(r.skills, 26)).ok);
  }
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
