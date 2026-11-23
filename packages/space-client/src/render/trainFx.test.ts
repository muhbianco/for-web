import assert from "node:assert/strict";
import test from "node:test";

import { armoredPalette, gearKey, heroGear } from "./heroArt.ts";
import { palette } from "./sprites.ts";
import {
  attackPeriod,
  SHOT_FLIGHT_MS,
  SHOT_HIT_MS,
  seedOf,
  shotFor,
  shotPhase,
  shotStage,
} from "./trainFx.ts";

test("treino no mapa: o tiro de cada um pela arma; o cavaleiro arremessa o escudo a cada quatro golpes", () => {
  assert.equal(shotFor({ weapon: "arco-de-caca", ammo: "flecha" }, 0).art, "flecha");
  assert.equal(shotFor({ weapon: "besta-leve", ammo: "virote" }, 0).art, "virote");
  const orb = shotFor({ weapon: "varinha-de-brasa" }, 0);
  assert.equal(orb.art, "orbe");
  assert.equal(orb.tint, 0xff9a3c, "a cor do fogo");
  const knight = { weapon: "espada-curta", shield: "escudo-de-tabuas" };
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((n) => shotFor(knight, n).art),
    ["corte", "corte", "corte", "escudo", "corte", "corte", "corte", "escudo"],
  );
  assert.equal(shotFor({ weapon: "espada-curta" }, 3).art, "corte", "sem escudo, só o corte");
  assert.equal(shotFor({}, 0).art, "corte", "punhos");
});

test("treino no mapa: ritmo de ataque da vocação [TFS 2000 ms], voo e acerto dentro do intervalo", () => {
  assert.equal(attackPeriod(4), 2000);
  assert.equal(attackPeriod(8), 2000);
  assert.equal(attackPeriod(undefined), 2000);
  assert.ok(SHOT_FLIGHT_MS + SHOT_HIT_MS < attackPeriod(1));
  assert.deepEqual(shotPhase(4_100, 0, 2000), { n: 2, phase: 100 });
  assert.equal(shotStage(0).kind, "flying");
  assert.equal(shotStage(SHOT_FLIGHT_MS).kind, "hit");
  assert.equal(shotStage(SHOT_FLIGHT_MS + SHOT_HIT_MS).kind, "idle");
  assert.notEqual(seedOf("ana"), seedOf("bia"), "dois heróis não atiram juntos");
  assert.equal(seedOf("ana"), seedOf("ana"));
});

test("armadura no avatar: o corpo pinta a camisa, as pernas a calça, o capacete o cabelo; a túnica desce", () => {
  const base = palette(0);
  const p = armoredPalette(base, {
    head: "elmo-de-ferro",
    body: "cota-de-malha",
    legs: "calca-de-couro",
    feet: "botas-de-couro",
  });
  assert.equal(p.skin, base.skin);
  assert.equal(p.hair, "#9aa3ad");
  assert.equal(p.shirt, "#9aa3ad");
  assert.equal(p.pants, "#6e4a2b");
  assert.equal(p.shoes, "#4a3020");
  assert.equal(armoredPalette(base, { body: "manto-azul" }).pants, "#3f5fbf");
  assert.deepEqual(armoredPalette(base, {}), base);
  assert.equal(heroGear("cajado-de-pedra", null).look, "cajado");
  assert.notEqual(gearKey({ weapon: "a" }), gearKey({ shield: "a" }));
});
