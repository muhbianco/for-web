import assert from "node:assert/strict";
import test from "node:test";

import type { Effect } from "../combat/types.ts";
import { compileLoadout, compileSkill, skillCooldownMs } from "./compile.ts";
import { skillOf } from "./index.ts";
import { freshHeroSkills } from "./tree.ts";

// Da skill do conteúdo ao motor: Potência, Eficiência e adereços (spec §7).

const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} contra ${b}`);
const dano = (e: Effect | undefined) => {
  assert.ok(e && e.type === "dano");
  return e;
};

test("Potência: +5% por rank no número principal; apoio puro ganha −1% de recarga por rank", () => {
  const seta = compileSkill(skillOf("mago", "seta-arcana")!, {
    potency: 20,
    efficiency: 0,
    mechanics: {},
  });
  near(dano(seta.effects[0]).parts[0]!.coef, 1.6 * 1.95);
  const muralha = compileSkill(skillOf("guerreiro", "muralha-de-ferro")!, {
    potency: 11,
    efficiency: 0,
    mechanics: {},
  });
  const buff = muralha.effects[0]!;
  assert.ok(
    buff.type === "buff" && buff.value === 0.3,
    "o valor do buff de apoio não escala",
  );
  near(muralha.ownCooldownCut!, 0.1);
});

test("Eficiência: −4% de mana e −3% de recarga por up", () => {
  const s = compileSkill(skillOf("mago", "meteoro")!, {
    potency: 1,
    efficiency: 5,
    mechanics: {},
  });
  near(s.manaPct, 0.2 * 0.8);
  near(s.ownCooldownCut!, 0.15);
  assert.equal(s.baseCooldownMs, 60_000);
});

test("adereços: duração, recarga fixa, efeito novo, gancho e o extra do 5/5", () => {
  const desafio = compileSkill(skillOf("guerreiro", "golpe-provocador")!, {
    potency: 1,
    efficiency: 0,
    mechanics: { desafio: 5 },
  });
  const prov = desafio.effects[1]!;
  assert.ok(prov.type === "provocar" && prov.durationMs === 6000);

  const curar = compileSkill(skillOf("padre", "curar")!, {
    potency: 1,
    efficiency: 0,
    mechanics: { "cura-rapida": 5 },
  });
  assert.equal(curar.cooldownMs, 2000);

  const fogo = compileSkill(skillOf("mago", "explosao-de-fogo")!, {
    potency: 1,
    efficiency: 0,
    mechanics: { queimadura: 3 },
  });
  const dot = fogo.effects[1]!;
  assert.ok(dot.type === "dot");
  near(dot.coefPerSec, 0.12);

  const seta = compileSkill(skillOf("mago", "seta-arcana")!, {
    potency: 3,
    efficiency: 0,
    mechanics: { "seta-dupla": 2 },
  });
  const hook = seta.hooks?.[0];
  assert.ok(hook && hook.on === "acerto");
  near(hook.chance, 0.2);
  near(dano(hook.effects[0]).parts[0]!.coef, 1.6 * 1.1);

  const ultima = compileSkill(skillOf("guerreiro", "ultima-resistencia")!, {
    potency: 1,
    efficiency: 0,
    mechanics: { "recusa-da-morte": 5 },
  });
  const cura = ultima.effects[0]!;
  assert.ok(cura.type === "cura");
  near(cura.pctMaxHp!, 0.45);
  assert.ok(ultima.hooks?.some((h) => h.on === "recusaMorte"));
  const ultima4 = compileSkill(skillOf("guerreiro", "ultima-resistencia")!, {
    potency: 1,
    efficiency: 0,
    mechanics: { "recusa-da-morte": 4 },
  });
  assert.ok(
    !ultima4.hooks?.some((h) => h.on === "recusaMorte"),
    "o extra só vem no 5/5",
  );
});

test("o loadout sai na ordem dos slots, com a IA escolhida pelo jogador", () => {
  const hs = freshHeroSkills("mago");
  hs.slots = ["explosao-de-fogo", "seta-arcana"];
  hs.ai["explosao-de-fogo"] = [{ kind: "sempre" }];
  const out = compileLoadout("mago", hs);
  assert.deepEqual(
    out.map((s) => s.id),
    ["explosao-de-fogo", "seta-arcana"],
  );
  assert.deepEqual(out[0]!.condition, [{ kind: "sempre" }]);
  assert.deepEqual(out[1]!.condition, [{ kind: "sempre" }]);
});

test("recarga final: a mesma conta do motor, com a recarga global e o piso de 50% da base", () => {
  const s = { cooldownMs: 10_000, baseCooldownMs: 10_000, ownCooldownCut: 0.15 };
  assert.equal(Math.round(skillCooldownMs(s, 0.2)), Math.round(10_000 * 0.8 * 0.85));
  // Cortes enormes param no piso (§7: nunca abaixo de 50% da base).
  assert.equal(skillCooldownMs({ ...s, ownCooldownCut: 0.9 }, 0.4), 5_000);
  assert.equal(skillCooldownMs({ cooldownMs: 6_000 }, 0), 6_000);
});
