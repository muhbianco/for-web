import assert from "node:assert/strict";
import { test } from "node:test";

import { applyDecorOp, emptyDecor, validateSettings } from "../decor/index.ts";
import { DecorSettingsSchema, parseCommand } from "../protocol/messages.ts";
import { parseGameCommand, tacticsFromWire } from "./index.ts";

// Refúgio (ADR 0009, decisão 5): o protocolo do jogo e a chave do dono.

const look = { skin: 0, hair: 9, outfit: 7, trim: 7, cosmetic: null };

test("protocolo: comandos do jogo válidos passam", () => {
  const ok = [
    { v: 1, t: "game.open", id: "a" },
    { v: 1, t: "game.open", id: "a", d: {} },
    { v: 1, t: "game.create", id: "a", d: { cls: "druida", look } },
    { v: 1, t: "game.look", id: "a", d: { look: { ...look, cosmetic: "coroa" } } },
    { v: 1, t: "game.train", id: "a", d: { skill: "escudo" } },
    { v: 1, t: "game.equip", id: "a", d: { item: "AB12CD34" } },
    { v: 1, t: "game.unequip", id: "a", d: { slot: "secundaria" } },
    { v: 1, t: "game.sell", id: "a", d: { items: ["AB12CD34", "ZZ99XX00"] } },
    { v: 1, t: "game.buy", id: "a", d: { offer: "dummy", qty: 1 } },
    { v: 1, t: "game.buy", id: "a", d: { offer: "decor", qty: 2, item: "rug-round" } },
    { v: 1, t: "game.lobby.place", id: "a", d: { item: "chair", x: 3, y: 4, rot: 0, variant: "escuro" } },
    { v: 1, t: "game.lobby.move", id: "a", d: { id: "AB12CD34", x: 0, y: 7, rot: 1 } },
    { v: 1, t: "game.lobby.remove", id: "a", d: { id: "AB12CD34" } },
    { v: 1, t: "game.tactics", id: "a", d: { order: ["seiva"], potion_at: 35, heal_at: 60 } },
  ];
  for (const c of ok) {
    const r = parseGameCommand(JSON.stringify(c));
    assert.ok(r && r.ok, c.t);
  }
});

test("protocolo: comandos do jogo inválidos são recusados", () => {
  const bad = [
    { v: 2, t: "game.open", id: "a" },
    { v: 1, t: "game.create", id: "a", d: { cls: "paladino", look } },
    { v: 1, t: "game.create", id: "a", d: { cls: "druida", look: { ...look, skin: 6 } } },
    { v: 1, t: "game.create", id: "a", d: { cls: "druida", look, extra: 1 } },
    { v: 1, t: "game.sell", id: "a", d: { items: [] } },
    { v: 1, t: "game.sell", id: "a", d: { items: Array.from({ length: 21 }, (_, i) => `ITEM${i}`) } },
    { v: 1, t: "game.sell", id: "a", d: { items: ["../../x"] } },
    { v: 1, t: "game.buy", id: "a", d: { offer: "espada", qty: 1 } },
    { v: 1, t: "game.buy", id: "a", d: { offer: "potion", qty: 0 } },
    { v: 1, t: "game.buy", id: "a", d: { offer: "decor", qty: 1 } },
    { v: 1, t: "game.buy", id: "a", d: { offer: "potion", qty: 1, item: "chair" } },
    { v: 1, t: "game.buy", id: "a", d: { offer: "decor", qty: 1, item: "../../x" } },
    { v: 1, t: "game.lobby.place", id: "a", d: { item: "chair", x: 99, y: 4, rot: 0 } },
    { v: 1, t: "game.lobby.place", id: "a", d: { item: "chair", x: 1, y: 4, rot: 4 } },
    { v: 1, t: "game.lobby.place", id: "a", d: { id: "X", item: "chair", x: 1, y: 4, rot: 0 } },
    { v: 1, t: "game.tactics", id: "a", d: { order: [], potion_at: 5, heal_at: 60 } },
    { v: 1, t: "game.tactics", id: "a", d: { order: ["a", "b", "c", "d", "e", "f", "g"], potion_at: 30, heal_at: 60 } },
    { v: 1, t: "game.voar", id: "a" },
  ];
  for (const c of bad) assert.deepEqual(parseGameCommand(JSON.stringify(c)), { ok: false, error: "invalid_message" }, JSON.stringify(c));
});

test("protocolo: frame que não é do jogo volta null (o gateway segue com o mapa)", () => {
  assert.equal(parseGameCommand('{"v":1,"t":"ping","id":"x \\"game.trap"}'), null);
  assert.equal(parseGameCommand("não é json"), null);
  assert.equal(parseGameCommand("[1,2]"), null);
  assert.equal(parseGameCommand("x".repeat(5000)), null);
  // E o parser do mapa não conhece os comandos do jogo.
  assert.equal(parseCommand('{"v":1,"t":"game.open","id":"a"}').ok, false);
});

test("protocolo: tática do fio para as regras", () => {
  assert.deepEqual(tacticsFromWire({ order: ["raio"], potion_at: 40, heal_at: 70 }), { order: ["raio"], potionAt: 40, healAt: 70 });
});

test("configurações: a chave game passa pelo schema, pela validação e pelo applyDecorOp", () => {
  assert.ok(DecorSettingsSchema.safeParse({ editors: "admins", roles: [], game: "off" }).success);
  assert.ok(!DecorSettingsSchema.safeParse({ editors: "admins", roles: [], game: "talvez" }).success);
  assert.ok(validateSettings({ editors: "admins", roles: [], game: "on" }));
  assert.ok(!validateSettings({ editors: "admins", roles: [], game: 1 }));
  const s = applyDecorOp(emptyDecor(), { kind: "settings", settings: { editors: "admins", roles: [], game: "off", tv_cooldown_s: 5 } }, 1);
  assert.deepEqual(s.settings, { editors: "admins", roles: [], tv_cooldown_s: 5, game: "off" });
});
