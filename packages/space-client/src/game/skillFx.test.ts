import assert from "node:assert/strict";
import { test } from "node:test";

import { SKILLS_BY_CLASS } from "@muchat/space-core/game/ot/balance";

import { type Cue, heroGear, planSecond, RAIN_MS } from "./script.ts";
import { CAST_FX, FX_COLOR, lingerFor, lingersOf } from "./skillFx.ts";

const FOE = 100;
const plan = (
  cls: string[],
  events: object[],
  looks = cls.map(() => "espada"),
) =>
  planSecond({
    events: events as { k: string }[],
    gears: looks.map((l) => heroGear(l as never, null)),
    classes: cls as never,
    foes: [
      { magic: false },
      { magic: false },
      { magic: false },
      { magic: false },
    ],
  });
const of = <K extends Cue["k"]>(cues: Cue[], k: K) =>
  cues.filter((c): c is Extract<Cue, { k: K }> => c.k === k);

test("efeitos de skill: toda receita é de uma skill que existe", () => {
  const ids = new Set(
    Object.values(SKILLS_BY_CLASS)
      .flat()
      .map((s) => s.id),
  );
  for (const id of Object.keys(CAST_FX)) assert.ok(ids.has(id), id);
});

test("Redemoinho em 3 monstros: um giro só em quem soltou, um corte e um número em cada alvo, juntos", () => {
  const p = plan(
    ["guerreiro"],
    [0, 1, 2].map((i) => ({
      k: "magia",
      a: 0,
      b: FOE + i,
      v: 50,
      s: "redemoinho",
    })),
  );
  const spin = of(p.cues, "spin");
  assert.equal(spin.length, 1);
  assert.equal(spin[0]!.who, 0);
  const hits = of(p.cues, "hit");
  assert.deepEqual(
    hits.map((h) => h.who),
    [FOE, FOE + 1, FOE + 2],
  );
  assert.equal(
    new Set(hits.map((h) => h.at)).size,
    1,
    "os três ao mesmo tempo",
  );
  assert.equal(of(p.cues, "slash").length, 3);
  assert.equal(of(p.cues, "lunge").length, 0, "não avança: gira");
});

test("Chuva de Flechas: flechas caindo em cada alvo, o número chega com elas; sem projétil do caçador", () => {
  const p = plan(
    ["cacador"],
    [0, 1].map((i) => ({
      k: "magia",
      a: 0,
      b: FOE + i,
      v: 30,
      s: "chuva-de-flechas",
    })),
    ["arco"],
  );
  const rain = of(p.cues, "rain");
  assert.equal(rain.length, 2);
  assert.equal(of(p.cues, "shot").length, 0);
  for (const h of of(p.cues, "hit")) assert.equal(h.at, rain[0]!.at + RAIN_MS);
});

test("Raio em Cadeia: do mago ao 1º alvo e de um alvo ao seguinte, em ordem", () => {
  const p = plan(
    ["mago"],
    [2, 0, 1].map((i) => ({
      k: "magia",
      a: 0,
      b: FOE + i,
      v: 80,
      s: "raio-em-cadeia",
    })),
    ["cajado"],
  );
  const beams = of(p.cues, "beam");
  assert.deepEqual(
    beams.map((b) => [b.from, b.to]),
    [
      [0, FOE + 2],
      [FOE + 2, FOE],
      [FOE, FOE + 1],
    ],
  );
  assert.ok(beams[0]!.at < beams[1]!.at && beams[1]!.at < beams[2]!.at);
});

test("Meteoro: a pedra cai em cada alvo e estoura; skill sem receita segue como antes", () => {
  const p = plan(
    ["mago"],
    [{ k: "magia", a: 0, b: FOE, v: 300, s: "meteoro" }],
    ["cajado"],
  );
  assert.equal(of(p.cues, "drop").length, 1);
  assert.equal(of(p.cues, "burst").length, 1);
  const plain = plan(
    ["mago"],
    [{ k: "magia", a: 0, b: FOE, v: 90, s: "seta-arcana" }],
    ["cajado"],
  );
  assert.deepEqual(
    plain.cues.map((c) => c.k),
    ["shot", "burst", "hit"],
  );
});

test("lançamento: a Nuvem Tóxica e a Consagração viram o gatilho do efeito; o tique do DoT continua número", () => {
  const p = plan(
    ["assassino", "paladino"],
    [
      { k: "magia", a: 0, b: FOE, v: 12, s: "fumaca", dt: "veneno" },
      { k: "lanca", a: 0, s: "fumaca" },
      { k: "lanca", a: 1, s: "consagracao" },
      { k: "lanca", a: 1, s: "golpe-sagrado" },
    ],
  );
  assert.deepEqual(
    of(p.cues, "cast").map((c) => [c.who, c.s]),
    [
      [0, "fumaca"],
      [1, "consagracao"],
    ],
  );
  assert.equal(of(p.cues, "hit")[0]!.dot, "veneno");
});

test("o que dura: nuvem verde no veneno da Nuvem Tóxica, círculo dourado da Consagração, bolha dos escudos", () => {
  assert.deepEqual(lingerFor({ s: "fumaca", k: "dot" }), {
    art: "nuvem",
    color: FX_COLOR.veneno,
    layer: "cima",
  });
  assert.equal(lingerFor({ s: "consagracao", k: "dot" })?.layer, "chao");
  assert.equal(lingerFor({ s: "nevasca", k: "debuff" })?.art, "floco");
  assert.equal(
    lingerFor({ s: "escudo-de-mana", k: "mana" })?.color,
    FX_COLOR.mana,
  );
  assert.equal(
    lingerFor({ s: "escudo-sagrado", k: "escudo" })?.color,
    FX_COLOR.branco,
  );
  // O veneno da Lâmina não vira nuvem (só o da Nuvem Tóxica).
  assert.equal(lingerFor({ s: "lamina-envenenada", k: "dot" }), null);
  // A Nevasca põe DoT e lentidão: um floco só.
  assert.equal(
    lingersOf([
      { s: "nevasca", k: "dot" },
      { s: "nevasca", k: "debuff" },
    ]).length,
    1,
  );
});
