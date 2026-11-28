import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ClassId,
  type HeroV5,
  DUNGEONS,
  FOE_BASE,
  createHero,
  dungeonById,
  heroRunFighter,
  simulateRun,
} from "@muchat/space-core/game/ot/balance";

import { avatarGearOf } from "../hero.ts";
import {
  type Cue,
  afterHit,
  DAMAGE_COLOR,
  damageColor,
  fitName,
  foeArt,
  frameStep,
  heroGear,
  heroSpots,
  isRanged,
  monsterSpots,
  planSecond,
  ROOM_H,
  ROOM_W,
  ROOMS,
  roomCleared,
  roomFoes,
  SECOND_MS,
  TILE,
} from "./script.ts";

let n = 0;
/** Um herói da classe no nível, com poções de sobra (as corridas de teste passam por elas). */
function hero(cls: ClassId, level: number): HeroV5 {
  const h = createHero(cls, () => `t${n++}`);
  return {
    ...h,
    level,
    proficiency: 10 * level,
    potions: { hp: { pequena: 100, media: 0, grande: 0 }, mp: { pequena: 100, media: 0, grande: 0 } },
    supplies: { hp: 0.95, mp: 0.95 },
  };
}

const PARTIES: Record<string, HeroV5[]> = {
  "cacada-1": [hero("guerreiro", 3), hero("mago", 3)],
  "cacada-10": [hero("cacador", 12), hero("padre", 12)],
  "masmorra-40": [hero("guerreiro", 45), hero("padre", 45), hero("mago", 45), hero("cacador", 45)],
};

const gearOf = (h: HeroV5) => {
  const g = avatarGearOf(h.equipment);
  return heroGear(g.weapon, g.shield);
};

test("a família da arma decide a cara do herói; sem arma, punhos", () => {
  assert.deepEqual(heroGear("bastao", null), { look: "cajado", element: "terra", shield: false });
  assert.equal(heroGear("cetro", null).look, "varinha");
  assert.equal(heroGear("arco", null).look, "arco");
  assert.equal(heroGear("besta", null).look, "besta");
  assert.equal(heroGear("martelo", null).look, "maca");
  assert.equal(heroGear("espada", "escudo").shield, true);
  assert.equal(heroGear("espada", "focus").shield, false);
  assert.equal(heroGear("item-de-outra-versao", null).look, "punhos");
  assert.equal(heroGear(null, null).look, "punhos");
  assert.equal(isRanged("arco"), true);
  assert.equal(isRanged("maca"), false);
});

test("heróis: um lugar para cada, quem bate de perto na frente, tudo dentro da sala", () => {
  for (const party of Object.values(PARTIES)) {
    const gears = party.map(gearOf);
    const spots = heroSpots(gears);
    assert.equal(new Set(spots.map((s) => `${s.x},${s.y}`)).size, spots.length);
    spots.forEach((s, i) => {
      assert.ok(s.x > 0 && s.x < ROOM_W * TILE && s.y > TILE && s.y <= (ROOM_H - 1) * TILE);
      if (!isRanged(gears[i]!.look)) for (let j = 0; j < spots.length; j++) if (isRanged(gears[j]!.look)) assert.ok(s.x > spots[j]!.x);
    });
  }
});

test("monstros: lugares distintos, o chefe 2 × 2 sem ninguém em cima, arte para todos", () => {
  for (const d of DUNGEONS) {
    for (let members = 1; members <= 4; members++) {
      const rooms = roomFoes(d.id, members);
      assert.equal(rooms.length, ROOMS);
      rooms.forEach((foes, st) => {
        assert.ok(foes.every((f) => f.art && f.name && f.hp > 0), `${d.id} ${st}`);
        const spots = monsterSpots(foes.map((f) => f.boss));
        assert.equal(new Set(spots.map((s) => `${s.x},${s.y}`)).size, spots.length, `${d.id} ${st} ${members}`);
        for (const s of spots) assert.ok(s.x > 8.5 * TILE && s.x < ROOM_W * TILE && s.y <= (ROOM_H - 1) * TILE);
        const boss = spots.find((s) => s.size === 2);
        if (boss)
          for (const s of spots) {
            if (s === boss) continue;
            const inside = s.x > boss.x - TILE && s.x < boss.x + TILE && s.y > boss.y - 2 * TILE && s.y <= boss.y;
            assert.ok(!inside, `${d.id} ${st}: monstro dentro do chefe`);
          }
      });
      assert.ok(rooms[3]!.some((f) => f.boss), `${d.id}: a última sala tem o chefe`);
    }
  }
  // Mais monstros que lugares (os invocados): não quebra e não empilha no mesmo ponto.
  const many = monsterSpots(Array.from({ length: 40 }, () => false));
  assert.equal(new Set(many.map((s) => `${s.x},${s.y}`)).size, 40);
  // A região escolhe o chefe e os elementais (Terras Congeladas: gelo).
  assert.equal(foeArt({ archetype: "chefe", family: "fera" }, 1, 0), "rei-javali");
  assert.equal(foeArt({ archetype: "lacaio", family: "elemental" }, 5, 0), "espirito-da-nevasca");
});

test("invocados que chegam no meio da sala não mexem no lugar de quem já está nela (28/11/2026)", () => {
  // A cena acrescenta os lacaios da Invocação com a sala montada (scene.ts, growRoom): os lugares dos
  // primeiros têm de ser os mesmos com e sem eles, senão o chefe e os vivos pulariam de lugar.
  for (const d of DUNGEONS.filter((x) => x.kind !== "cacada" && x.level >= 70)) {
    const boss = roomFoes(d.id, 4)[3]!.map((f) => f.boss);
    const before = monsterSpots(boss);
    for (let extra = 1; extra <= 12; extra++) {
      const after = monsterSpots([...boss, ...Array.from({ length: extra }, () => false)]);
      assert.deepEqual(after.slice(0, before.length), before, `${d.id} +${extra}`);
      assert.equal(new Set(after.map((s) => `${s.x},${s.y}`)).size, after.length, `${d.id} +${extra}: dois no mesmo lugar`);
    }
  }
});

test("cada segundo de corridas inteiras vira um roteiro de ~0,8 s, sem perder dano nem cura", () => {
  let seconds = 0;
  let areas = 0;
  let potions = 0;
  for (const [dungeon, party] of Object.entries(PARTIES)) {
    for (let seed = 1; seed <= 3; seed++) {
      let s = seed;
      const random = { next: () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) };
      const r = simulateRun(dungeonById(dungeon)!, party.map((h) => heroRunFighter(h)), { mode: "aleatorio", random, record: true });
      const gears = party.map(gearOf);
      const rooms = roomFoes(dungeon, party.length);
      for (const f of r.frames!) {
        const foes = Array.from({ length: Math.max(f.x.length, rooms[f.st]!.length) }, (_, i) => rooms[f.st]![i] ?? { magic: false });
        const p = planSecond({ events: f.e, gears, classes: party.map((h) => h.cls), foes, delay: seed % 2 ? 350 : 0 });
        seconds++;
        assert.ok(p.end <= SECOND_MS + 200, `fim em ${p.end} ms`);
        const valid = (ref: number) => (ref >= FOE_BASE ? ref - FOE_BASE < foes.length : ref < party.length);
        for (const c of p.cues) {
          assert.ok(c.at >= 0);
          const refs = "who" in c ? [c.who] : "from" in c ? [c.from, c.to] : [c.on];
          for (const ref of refs) assert.ok(valid(ref), `ator ${ref} em ${c.k}`);
        }
        const hits = p.cues.filter((c): c is Extract<Cue, { k: "hit" }> => c.k === "hit");
        const dealt = (...how: string[]) => hits.filter((c) => how.includes(c.how)).reduce((a, c) => a + c.v, 0);
        const evs = f.e.filter((e) => e.k === "golpe" || e.k === "magia") as { k: string; a: number; b: number; v: number; cura?: true; bl?: string }[];
        const drunk = f.e.filter((e) => e.k === "pocao") as { v: number; mana?: true }[];
        potions += drunk.length;
        assert.equal(dealt("cura"), evs.filter((e) => e.cura).reduce((a, e) => a + e.v, 0) + drunk.filter((e) => !e.mana).reduce((a, e) => a + e.v, 0));
        assert.equal(dealt("mana"), drunk.filter((e) => e.mana).reduce((a, e) => a + e.v, 0));
        // Dano: tudo o que não é cura nem esquiva (a skill num aliado sem cura só brilha).
        const onAlly = (e: { a: number; b: number; k: string }) => e.k === "magia" && e.a < FOE_BASE && e.b < FOE_BASE;
        assert.equal(
          dealt("dano", "bloqueio", "imune"),
          evs.filter((e) => !e.cura && e.bl !== "erro" && !onAlly(e)).reduce((a, e) => a + e.v, 0),
        );
        const byTime = new Map<number, number>();
        for (const c of p.cues) if (c.k === "burst") byTime.set(c.at, (byTime.get(c.at) ?? 0) + 1);
        for (const k of byTime.values()) if (k > 1) areas++;
      }
    }
  }
  assert.ok(seconds > 200, `${seconds} segundos`);
  assert.ok(potions > 0, "nenhuma poção bebida nas corridas de teste");
  assert.ok(areas > 0, "nenhum ataque em área visto (o Pulso do chefe da masmorra)");
});

test("tipo de evento desconhecido (o que vier depois desta versão) passa batido", () => {
  const gears = [heroGear("espada", null)];
  const p = planSecond({
    events: [{ k: "evento-novo", a: 0 } as { k: string }, { k: "lanca", a: 0, s: "x" } as { k: string }, { k: "golpe", a: 0, b: 100, v: 12 } as { k: string }],
    gears,
    classes: ["guerreiro"],
    foes: [{ magic: false }],
  });
  assert.deepEqual(
    p.cues.map((c) => c.k),
    ["lunge", "hit"],
  );
  assert.deepEqual(planSecond({ events: [{ k: "novo" }], gears, classes: ["guerreiro"], foes: [] }), { cues: [], end: 0 });
});

test("poção: vida em verde, mana em azul sem mexer na vida; o Cataclismo é uma chama no chefe", () => {
  const p = planSecond({
    events: [
      { k: "pocao", a: 0, v: 40 },
      { k: "pocao", a: 1, v: 60, mana: true },
      { k: "cataclismo", a: 100, n: 2 },
      { k: "magia", a: 100, b: 0, v: 300, s: "cataclismo" },
      { k: "magia", a: 100, b: 1, v: 200, s: "cataclismo" },
    ] as unknown as { k: string }[],
    gears: [heroGear("espada", null), heroGear("cajado", null)],
    classes: ["guerreiro", "druida"],
    foes: [{ magic: false }],
  });
  const hits = p.cues.filter((c): c is Extract<Cue, { k: "hit" }> => c.k === "hit");
  assert.deepEqual(
    hits.map((h) => [h.who, h.how, h.v]),
    [
      [0, "cura", 40],
      [1, "mana", 60],
      [0, "dano", 300],
      [1, "dano", 200],
    ],
  );
  assert.equal(afterHit(10, 100, { v: 60, how: "mana" }), 10);
  assert.ok(p.cues.some((c) => c.k === "burst" && c.who === 100 && c.el === "fogo"));
  // Em área: os dois heróis no mesmo instante.
  const area = hits.filter((h) => h.v >= 200);
  assert.equal(area[0]!.at, area[1]!.at);
});

test("vida mostrada: dano e bloqueio tiram, cura põe, esquiva não mexe, nos limites", () => {
  assert.equal(afterHit(10, 50, { v: 30, how: "dano" }), 0);
  assert.equal(afterHit(40, 50, { v: 30, how: "cura" }), 50);
  assert.equal(afterHit(40, 50, { v: 8, how: "bloqueio" }), 32);
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
  assert.equal(roomCleared({ st: 0, x: [0, 0] }), true);
  assert.equal(roomCleared({ st: 0, x: [0, 3] }), false);
  assert.equal(roomCleared({ st: 3, x: [0] }), false);
  assert.equal(roomCleared({ st: 0, x: [] }), false);
});

test("nome comprido corta em palavra, com reticências", () => {
  const m = (s: string) => s.length * 5;
  assert.equal(fitName("Lacaio humanoide", 100, m), "Lacaio humanoide");
  assert.equal(fitName("Chefe da masmorra", 60, m), "Chefe da…");
  assert.equal(fitName("Chefe da masmorra", 30, m), "Chefe…");
  assert.equal(fitName("X", 1, m), "…");
});

test("errou e esquivou: o golpe sai sem o impacto, com o erro em quem foi atacado (26/11/2026)", () => {
  const p = planSecond({
    events: [
      // O herói (espada) errou o monstro; a skill dele também.
      { k: "golpe", a: 0, b: FOE_BASE, v: 0, bl: "erro" },
      { k: "magia", a: 0, b: FOE_BASE, v: 0, s: "golpe-brutal", bl: "erro" },
      // O monstro errou o herói (esquiva) e depois bateu num bloqueio.
      { k: "golpe", a: FOE_BASE, b: 0, v: 0, bl: "erro" },
      { k: "golpe", a: FOE_BASE, b: 0, v: 7, bl: "bloqueio" },
    ] as unknown as { k: string }[],
    gears: [heroGear("espada", null)],
    classes: ["guerreiro"],
    foes: [{ magic: false }],
  });
  const hits = p.cues.filter((c): c is Extract<Cue, { k: "hit" }> => c.k === "hit");
  assert.deepEqual(
    hits.map((h) => [h.who, h.how, h.v]),
    [
      [FOE_BASE, "erro", 0],
      [FOE_BASE, "erro", 0],
      [0, "erro", 0],
      [0, "bloqueio", 7],
    ],
  );
  // A skill que errou não tem o corte do impacto.
  assert.equal(p.cues.filter((c) => c.k === "slash").length, 0);
});

test("cores do número de dano: físico branco, crítico amarelo, mágico magenta, veneno verde, queimadura laranja (26/11/2026)", () => {
  assert.equal(damageColor({ el: "fisico" }, false), DAMAGE_COLOR.fisico);
  assert.equal(damageColor({ el: "fisico", crit: true }, false), DAMAGE_COLOR.critico);
  for (const el of ["fogo", "gelo", "energia", "terra", "morte"] as const)
    assert.equal(damageColor({ el }, false), DAMAGE_COLOR.magico, el);
  assert.equal(damageColor({ el: "fisico", dot: "veneno" }, false), DAMAGE_COLOR.veneno);
  assert.equal(damageColor({ el: "fogo", dot: "queimadura" }, false), DAMAGE_COLOR.queimadura);
  assert.equal(damageColor({ el: "fisico", dot: "sangramento" }, false), DAMAGE_COLOR.sangramento);
  assert.equal(damageColor({ el: "sagrado" }, false), DAMAGE_COLOR.sagrado);
  // DoT sem tipo próprio (Nevasca, Espinhos) segue o elemento.
  assert.equal(damageColor({ el: "gelo", dot: "dot" }, false), DAMAGE_COLOR.magico);
  // O que o herói recebe é vermelho, qualquer que seja o tipo.
  assert.equal(damageColor({ el: "fisico", crit: true }, true), DAMAGE_COLOR.recebido);
  // As cores não se repetem.
  assert.equal(new Set(Object.values(DAMAGE_COLOR)).size, Object.keys(DAMAGE_COLOR).length);
});

test("crítico e tique de DoT chegam ao número; o tique não anima um golpe novo (26/11/2026)", () => {
  const p = planSecond({
    events: [
      { k: "golpe", a: 0, b: FOE_BASE, v: 80, cr: true },
      { k: "magia", a: 0, b: FOE_BASE, v: 30, s: "lamina-envenenada", dt: "veneno" },
    ] as unknown as { k: string }[],
    gears: [heroGear("adaga", null)],
    classes: ["assassino"],
    foes: [{ magic: false }],
  });
  const hits = p.cues.filter((c): c is Extract<Cue, { k: "hit" }> => c.k === "hit");
  assert.deepEqual(
    hits.map((h) => [h.v, h.crit ?? false, h.dot ?? null]),
    [
      [80, true, null],
      [30, false, "veneno"],
    ],
  );
  // Um golpe só (o do ataque básico): o veneno não avança de novo no monstro.
  assert.equal(p.cues.filter((c) => c.k === "lunge").length, 1);
});
