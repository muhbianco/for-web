import assert from "node:assert/strict";
import test from "node:test";

import { parseRpgCommand } from "./protocol.ts";

// O contrato dos comandos `rpg.*` da engine nova (Fase 8).

const send = (t: string, d?: unknown) =>
  parseRpgCommand(
    JSON.stringify({ v: 1, id: "c1", t, ...(d === undefined ? {} : { d }) }),
  );

test("os comandos novos passam com os dados certos", () => {
  const good: [string, unknown?][] = [
    ["rpg.open"],
    ["rpg.class", { cls: "cacador" }],
    ["rpg.dojo.start", { instance: "boneco-1" }],
    ["rpg.dojo.stop"],
    ["rpg.attrs", { add: { FOR: 5, VIT: 2 } }],
    ["rpg.skill.spend", { skill: "curar", target: "potencia" }],
    [
      "rpg.skill.spend",
      { skill: "curar", target: { mechanic: "cura-rapida" } },
    ],
    ["rpg.skill.slots", { slots: ["curar", "santuario"] }],
    ["rpg.skill.ai", { skill: "curar", conditions: [{ kind: "precisaCura" }] }],
    ["rpg.skill.ai", { skill: "curar", conditions: null }],
    ["rpg.master", { npc: "mestre-1", action: "evoluir" }],
    ["rpg.equip", { uid: "i1" }],
    ["rpg.unequip", { slot: "elmo" }],
    ["rpg.autoequip", { apply: true }],
    ["rpg.belt", { kind: "hp", size: "grande" }],
    ["rpg.supplies", { hp: 0.5, mp: 0.3 }],
    [
      "rpg.shop.buy",
      {
        npc: "m",
        buy: { kind: "pocao", type: "mp", size: "media", count: 20 },
      },
    ],
    [
      "rpg.shop.buy",
      { npc: "m", buy: { kind: "municao", grade: "afiada", packs: 2 } },
    ],
    [
      "rpg.shop.buy",
      {
        npc: "m",
        buy: { kind: "item", base: { slot: "elmo", weight: "leve" } },
      },
    ],
    ["rpg.shop.sell", { npc: "m", uid: "i1", confirm: true }],
    ["rpg.shop.sell.many", { npc: "m", uids: ["i1", "i2"], confirm: true }],
    ["rpg.smith.dismantle.many", { npc: "f", uids: ["i1"] }],
    ["rpg.master.class", { npc: "mestre-1", cls: "mago" }],
    ["rpg.smith", { npc: "f", action: "refinar", uid: "i1", protect: true }],
    ["rpg.bank", { npc: "b", gold: -500 }],
    ["rpg.vault", { npc: "b", action: "guardar", uid: "i1" }],
    ["rpg.vault.expand", { npc: "b" }],
    [
      "rpg.bank.transfer",
      { npc: "b", to: "u2", gold: 100, uids: [], confirmations: 1 },
    ],
    ["rpg.lobby.create", { tv: "tv1", dungeon: "masmorra-40" }],
    ["rpg.lobby.loop", { on: true }],
    ["rpg.run.leave"],
    ["rpg.board"],
  ];
  for (const [t, d] of good) {
    const r = send(t, d);
    assert.ok(r && r.ok, `${t}: ${JSON.stringify(r)}`);
  }
});

test("dados errados e comandos antigos são recusados; o que não é rpg. passa adiante", () => {
  const bad: [string, unknown?][] = [
    ["rpg.class", { cls: "cavaleiro" }],
    ["rpg.attrs", { add: { FOR: 0 } }],
    ["rpg.skill.slots", { slots: ["a", "b", "c", "d", "e"] }],
    ["rpg.skill.ai", { skill: "curar", conditions: [] }],
    ["rpg.skill.ai", { skill: "curar", conditions: [{ kind: "qualquer" }] }],
    ["rpg.belt", { kind: "hp", size: "enorme" }],
    [
      "rpg.shop.buy",
      { npc: "m", buy: { kind: "pocao", type: "hp", size: "media", count: 0 } },
    ],
    [
      "rpg.bank.transfer",
      { npc: "b", to: "u2", gold: 1, uids: [], confirmations: 3 },
    ],
    ["rpg.equip", { uid: "i1", extra: 1 }],
    // Os do modelo antigo (D2: sem renascimento; vocação e treino OT saíram).
    ["rpg.vocation", { vocation: 1 }],
    ["rpg.rebirth", {}],
    ["rpg.train.start", { instance: "x", skill: "espada" }],
  ];
  for (const [t, d] of bad) {
    const r = send(t, d);
    assert.deepEqual(r, { ok: false, error: "invalid_message" }, t);
  }
  assert.equal(
    parseRpgCommand(JSON.stringify({ v: 1, id: "x", t: "move" })),
    null,
  );
  assert.equal(parseRpgCommand("não é json"), null);
});
