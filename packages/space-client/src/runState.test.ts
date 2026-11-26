import assert from "node:assert/strict";
import test from "node:test";

import {
  type RpgRunFeedItem,
  type RpgRunView,
  createHero,
  dungeonById,
  heroRunFighter,
  simulateRun,
} from "@muchat/space-core/game/ot/balance";

import { applyFrames, followsNextRun, runStateFrom } from "./runState.ts";

test("a corrida nova abre sozinha: a primeira sempre; a do laço, para quem estava no resumo do mesmo grupo (26/11/2026)", () => {
  const run = { auto: true, room: "r1", tv: "tv1" };
  const open = (
    o: Partial<{ ended: boolean; room: string; tv: string; member: boolean }>,
  ) => ({ ended: true, room: "r1", tv: "tv1", member: false, ...o });
  // A primeira do grupo (não é do laço) ou com a largada aberta: abre.
  assert.equal(
    followsNextRun({ run: { ...run, auto: false }, stageOpen: false, open: null }),
    true,
  );
  assert.equal(followsNextRun({ run, stageOpen: true, open: null }), true);
  // Quem fechou a tela segue fechado.
  assert.equal(followsNextRun({ run, stageOpen: false, open: null }), false);
  // Membro da anterior, no resumo: abre.
  assert.equal(
    followsNextRun({ run, stageOpen: false, open: open({ member: true }) }),
    true,
  );
  // O caso do dono: assistia à corrida da dupla (não era membro), no mesmo grupo: abre.
  assert.equal(followsNextRun({ run, stageOpen: false, open: open({}) }), true);
  // Assistindo a outro grupo (outra TV), ou a uma corrida que ainda não acabou: não troca.
  assert.equal(
    followsNextRun({ run, stageOpen: false, open: open({ tv: "tv2" }) }),
    false,
  );
  assert.equal(
    followsNextRun({ run, stageOpen: false, open: open({ ended: false }) }),
    false,
  );
});

let n = 0;
const id = () => `i${n++}`;

function recorded() {
  const heroes = [createHero("guerreiro", id), createHero("mago", id)];
  const d = dungeonById("cacada-1")!;
  const r = simulateRun(d, heroes.map((h) => heroRunFighter(h)), {
    mode: "esperado",
    record: true,
  });
  const run: RpgRunView = {
    id: "r1",
    tv: "tv",
    room: "sala",
    dungeon: d.id,
    started_at: 0,
    ends_at: 0,
    auto: false,
    members: heroes.map((h, i) => ({
      user_id: `u${i}`,
      name: `P${i}`,
      cls: h.cls,
      level: h.level,
      hp_max: 100,
      mp_max: 50,
      equipment: h.equipment,
      skills: [],
      supplies: h.supplies,
      belt: h.belt,
      potions: { hp: h.potions.hp.pequena, mp: h.potions.mp.pequena },
    })),
  };
  return { run, frames: r.frames!, outcome: r.outcome };
}

test("frames one by one add up to the whole run (XP of each kill, potions, last frame)", () => {
  const { run, frames } = recorded();
  let st = runStateFrom({ run, frame: null, feed: [] });
  for (const f of frames) st = applyFrames(st, [f]);
  assert.equal(st.frame?.s, frames.at(-1)!.s);
  const xp = [0, 0];
  let drank = [0, 0];
  for (const f of frames)
    for (const e of f.e) {
      if (e.k === "abate" && e.xp) e.xp.forEach((x, i) => (xp[i]! += x));
      if (e.k === "pocao" && !e.mana) drank[e.a]!++;
    }
  assert.deepEqual(st.xp, xp);
  assert.ok(xp[0]! > 0, "a kill gave XP");
  assert.deepEqual(
    st.potions.map((p) => p.hp),
    run.members.map((m, i) => Math.max(0, m.potions.hp - drank[i]!)),
  );
  assert.ok(st.feed.length <= 40);
  drank = [0, 0];
});

test("frames already seen are skipped (a tick that arrives before the run message)", () => {
  const { run, frames } = recorded();
  const half = Math.floor(frames.length / 2);
  let st = runStateFrom({ run, frame: null, feed: [] });
  st = applyFrames(st, frames.slice(0, half));
  const again = applyFrames(st, frames.slice(0, half));
  assert.equal(again, st);
  const next = applyFrames(st, frames.slice(half - 2));
  assert.equal(next.frame?.s, frames.at(-1)!.s);
});

test("joining in the middle: potions come from the carry, not counted twice", () => {
  const { run, frames } = recorded();
  const mid = frames[Math.floor(frames.length / 2)]!;
  const feed: RpgRunFeedItem[] = [
    { k: "pocao", a: 0, v: 10, at: mid.s, st: mid.st },
  ];
  const st = runStateFrom({
    run,
    frame: mid,
    feed,
    carry: run.members.map(() => ({
      hp: 1,
      mp: 1,
      alive: true,
      pots: 7,
      hpPots: 7,
      mpPots: 0,
      cooldowns: {},
      revived: false,
      cheatedDeath: false,
    })),
  });
  assert.equal(st.potions[0]!.hp, 7);
  assert.equal(st.potionAt[0], mid.s);
  assert.deepEqual(st.drank[0], { hp: mid.s, mp: -1 }, "o gole de vida, por tipo");
  assert.equal(st.xpFromStart, false);
});

test("the Cataclysm stacks grow on the boss and reset with the room", () => {
  const { run } = recorded();
  let st = runStateFrom({ run, frame: null, feed: [] });
  st = applyFrames(st, [
    { s: 1, st: 3, h: [1, 1], m: [1, 1], x: [1], e: [{ k: "sala", st: 3 }] },
    { s: 2, st: 3, h: [1, 1], m: [1, 1], x: [1], e: [{ k: "cataclismo", a: 100, n: 1 }] },
    { s: 3, st: 3, h: [1, 1], m: [1, 1], x: [1], e: [{ k: "cataclismo", a: 100, n: 2 }] },
    { s: 4, st: 3, h: [1, 1], m: [1, 1], x: [1], e: [{ k: "mecanica", a: 100, s: "golpe-pesado", b: 0 }] },
  ]);
  assert.equal(st.cataclysm, 2);
  assert.equal(st.mechanic?.s, "golpe-pesado");
  st = applyFrames(st, [
    { s: 5, st: 0, h: [1, 1], m: [1, 1], x: [1], e: [{ k: "sala", st: 0 }] },
  ]);
  assert.equal(st.cataclysm, 0);
  assert.equal(st.mechanic, null);
});
