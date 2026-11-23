import assert from "node:assert/strict";
import { test } from "node:test";

import { addExperience, bestGear, DUNGEONS, expForLevel, MONSTER_BASE, type RunHero, simulateRun, type SkillId, START, stageMonsters, type VocationId, VOCATIONS } from "@muchat/space-core/game/ot";

import { afterHit, type Cue, fitName, frameStep, heroGear, heroSpots, isCoins, isRanged, monsterSpots, planSecond, ROOM_H, ROOM_W, roomCleared, SECOND_MS, TILE } from "./script.ts";

function hero(vocation: VocationId, level: number, skill: number, ml: number, owned: string[] = []): RunHero {
  const voc = VOCATIONS[vocation];
  const st = addExperience(voc, { level: 1, experience: 0, healthMax: START.health, manaMax: START.mana, cap: START.cap }, expForLevel(level));
  const skills = { punhos: 10, maca: 10, espada: 10, machado: 10, distancia: 10, escudo: 10 } as Record<SkillId, number>;
  if (voc.base === 4) {
    skills.espada = skill;
    skills.escudo = skill;
  }
  if (voc.base === 3) skills.distancia = skill;
  return { userId: `u${vocation}`, name: `H${vocation}`, vocation, level: st.level, healthMax: st.healthMax, manaMax: st.manaMax, skills, magicLevel: ml, stamina: 2520, gear: bestGear(vocation, st.level, skills, st.manaMax, owned) };
}

const PARTIES: Record<string, RunHero[]> = {
  "cripta-do-musgo": [hero(4, 8, 30, 2), hero(2, 8, 10, 12)],
  "galerias-afogadas": [hero(4, 20, 55, 4, ["espada-larga", "escudo-de-aco"]), hero(2, 20, 10, 30, ["varinha-de-geada"]), hero(3, 20, 55, 8, ["arco-composto"]), hero(1, 20, 10, 30, ["varinha-de-geada"])],
  "forja-rachada": [hero(4, 40, 70, 6, ["lamina-da-forja", "escudo-da-forja"]), hero(2, 40, 10, 45), hero(3, 40, 70, 10, ["arco-de-guerra"]), hero(1, 40, 10, 45)],
};

test("a arma decide a cara do herói; o que a cena não conhece luta de punhos", () => {
  assert.deepEqual(heroGear("varinha-de-musgo", null), { look: "varinha", element: "terra", shield: false });
  assert.equal(heroGear("varinha-de-faiscas", null).element, "energia");
  assert.equal(heroGear("arco-composto", null).look, "arco");
  assert.equal(heroGear("besta-leve", null).look, "besta");
  assert.equal(heroGear("cajado-de-pedra", null).look, "cajado");
  assert.equal(heroGear("espada-larga", "escudo-de-aco").shield, true);
  assert.equal(heroGear("item-da-o9", null).look, "punhos");
  assert.equal(heroGear(null, null).look, "punhos");
  assert.equal(isRanged("arco"), true);
  assert.equal(isRanged("maca"), false);
});

test("heróis: um lugar para cada, quem bate de perto na frente, tudo dentro da sala", () => {
  for (const party of Object.values(PARTIES)) {
    const gears = party.map((h) => heroGear(h.gear.weapon, h.gear.shield));
    const spots = heroSpots(gears);
    assert.equal(new Set(spots.map((s) => `${s.x},${s.y}`)).size, spots.length);
    spots.forEach((s, i) => {
      assert.ok(s.x > 0 && s.x < ROOM_W * TILE && s.y > TILE && s.y <= (ROOM_H - 1) * TILE);
      if (!isRanged(gears[i]!.look)) for (let j = 0; j < spots.length; j++) if (isRanged(gears[j]!.look)) assert.ok(s.x > spots[j]!.x);
    });
  }
});

test("monstros: lugares distintos, o chefe 2 × 2 sem ninguém em cima, todos depois dos heróis", () => {
  for (const d of DUNGEONS) {
    for (let st = 0; st < d.stages.length; st++) {
      for (let members = 1; members <= 4; members++) {
        const ids = stageMonsters(d.id, st, members).map((m) => m.id);
        const spots = monsterSpots(ids);
        assert.equal(new Set(spots.map((s) => `${s.x},${s.y}`)).size, spots.length, `${d.id} ${st} ${members}`);
        for (const s of spots) assert.ok(s.x > 8.5 * TILE && s.x < ROOM_W * TILE && s.y <= (ROOM_H - 1) * TILE);
        const boss = spots.find((s) => s.size === 2);
        if (boss) {
          for (const s of spots) {
            if (s === boss) continue;
            const inside = s.x > boss.x - TILE && s.x < boss.x + TILE && s.y > boss.y - 2 * TILE && s.y <= boss.y;
            assert.ok(!inside, `${d.id} ${st}: monstro dentro do chefe`);
          }
        }
      }
    }
  }
  // Mais monstros que lugares: não quebra e não empilha no mesmo ponto.
  const many = monsterSpots(Array.from({ length: 40 }, () => "rato-do-musgo"));
  assert.equal(new Set(many.map((s) => `${s.x},${s.y}`)).size, 40);
});

test("cada segundo de corridas inteiras vira um roteiro de ~0,8 s, sem perder dano nem cura", () => {
  let seconds = 0;
  let areas = 0;
  for (const [dungeon, party] of Object.entries(PARTIES)) {
    for (let seed = 1; seed <= 4; seed++) {
      const r = simulateRun({ seed, dungeon, heroes: party, rateLoot: 2 });
      const gears = party.map((h) => heroGear(h.gear.weapon, h.gear.shield));
      for (const f of r.frames) {
        const monsters = stageMonsters(dungeon, f.st, party.length).map((m) => m.id);
        const p = planSecond({ events: f.e, gears, vocations: party.map((h) => h.vocation), monsters, delay: seed % 2 ? 350 : 0 });
        seconds++;
        assert.ok(p.end <= SECOND_MS + 200, `fim em ${p.end} ms`);
        const valid = (ref: number) => (ref >= MONSTER_BASE ? ref - MONSTER_BASE < monsters.length : ref < party.length);
        for (const c of p.cues) {
          assert.ok(c.at >= 0);
          const refs = "who" in c ? [c.who] : "from" in c ? [c.from, c.to] : [c.on];
          for (const ref of refs) assert.ok(valid(ref), `ator ${ref}`);
        }
        const hits = p.cues.filter((c): c is Extract<Cue, { k: "hit" }> => c.k === "hit");
        const dealt = (how: string) => hits.filter((c) => c.how === how).reduce((a, c) => a + c.v, 0);
        const evs = f.e.filter((e) => e.k === "golpe" || e.k === "magia") as { k: string; v: number; cura?: true; bl?: string }[];
        assert.equal(dealt("cura"), evs.filter((e) => e.cura).reduce((a, e) => a + e.v, 0));
        assert.equal(dealt("dano"), evs.filter((e) => !e.cura && e.bl !== "erro").reduce((a, e) => a + e.v, 0));
        // O saque cai num corpo que caiu no mesmo segundo, depois da queda.
        for (const l of p.cues.filter((c) => c.k === "loot")) {
          const die = p.cues.find((c) => c.k === "die" && c.who === (l as { on: number }).on);
          assert.ok(die && die.at < l.at);
        }
        // Ataque em área: todos os alvos no mesmo instante.
        const byTime = new Map<number, number>();
        for (const c of p.cues) if (c.k === "burst") byTime.set(c.at, (byTime.get(c.at) ?? 0) + 1);
        for (const n of byTime.values()) if (n > 1) areas++;
      }
    }
  }
  assert.ok(seconds > 500);
  assert.ok(areas > 0, "nenhum ataque em área visto (Rei das Comportas / Guardião da Forja)");
});

test("tipo de evento desconhecido (poção, flecha das etapas seguintes) passa batido", () => {
  const gears = [heroGear("espada-larga", null)];
  const p = planSecond({
    events: [{ k: "pocao", a: 0, v: 50 } as { k: string }, { k: "flecha", a: 0, n: 1 } as { k: string }, { k: "golpe", a: 0, b: 100, v: 12, bl: "none" } as { k: string }],
    gears,
    vocations: [4],
    monsters: ["rato-do-musgo"],
  });
  assert.deepEqual(
    p.cues.map((c) => c.k),
    ["lunge", "hit"],
  );
  assert.deepEqual(planSecond({ events: [{ k: "novo" }], gears, vocations: [4], monsters: [] }), { cues: [], end: 0 });
});

test("saque: moedas de qualquer tipo viram moedas; o que ficou no corpo (O7) também deixa o saco", () => {
  const gears = [heroGear("espada-larga", null)];
  const p = planSecond({
    events: [
      { k: "golpe", a: 0, b: 100, v: 30, bl: "none" },
      { k: "abate", b: 100, exp: 5 },
      { k: "loot", a: 0, item: "moeda-de-ouro", n: 3 },
      { k: "deixado", a: 0, item: "espada-de-ferro", n: 1 },
      { k: "municao", a: 0 },
      { k: "gasto", a: 0, item: "anel" },
    ] as unknown as { k: string }[],
    gears,
    vocations: [4],
    monsters: ["rato-do-musgo"],
  });
  const loot = p.cues.filter((c) => c.k === "loot") as { on: number; coins: boolean }[];
  assert.deepEqual(
    loot.map((l) => [l.on, l.coins]),
    [
      [100, true],
      [100, false],
    ],
  );
  assert.equal(isCoins("moedas"), true);
  assert.equal(isCoins("moeda-de-cristal"), true);
  assert.equal(isCoins("espada-de-ferro"), false);
});

test("vida mostrada: dano tira, cura põe, bloqueio não mexe, nos limites", () => {
  assert.equal(afterHit(10, 50, { v: 30, how: "dano" }), 0);
  assert.equal(afterHit(40, 50, { v: 30, how: "cura" }), 50);
  assert.equal(afterHit(40, 50, { v: 0, how: "bloqueio" }), 40);
  assert.equal(afterHit(40, 50, { v: 9, how: "erro" }), 40);
});

test("quadro novo: corrida nova começa do estado, o segundo seguinte anima, o repetido não", () => {
  assert.equal(frameStep(null, "r1", 5), "reset");
  assert.equal(frameStep({ run: "r0", s: 9 }, "r1", 0), "reset");
  assert.equal(frameStep({ run: "r1", s: 5 }, "r1", 6), "animate");
  assert.equal(frameStep({ run: "r1", s: 5 }, "r1", 9), "animate");
  assert.equal(frameStep({ run: "r1", s: 5 }, "r1", 5), "same");
  assert.equal(frameStep({ run: "r1", s: 5 }, "r1", 3), "snap");
});

test("sala limpa com outra depois: hora de andar até a porta", () => {
  assert.equal(roomCleared({ st: 0, x: [0, 0] }, 4), true);
  assert.equal(roomCleared({ st: 0, x: [0, 3] }, 4), false);
  assert.equal(roomCleared({ st: 3, x: [0] }, 4), false);
  assert.equal(roomCleared({ st: 0, x: [] }, 4), false);
});

test("nome comprido corta em palavra, com reticências", () => {
  const m = (s: string) => s.length * 5;
  assert.equal(fitName("Rato do musgo", 100, m), "Rato do musgo");
  assert.equal(fitName("Caranguejo de pedra", 60, m), "Caranguejo…");
  assert.equal(fitName("Caranguejo de pedra", 30, m), "Caran…");
  assert.equal(fitName("X", 1, m), "…");
});
