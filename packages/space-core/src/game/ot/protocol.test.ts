import assert from "node:assert/strict";
import test from "node:test";

import { CATALOG, itemOf } from "../../decor/catalog.ts";
import { parseRpgCommand } from "./protocol.ts";

test("parseRpgCommand: só o prefixo rpg., com os campos exatos", () => {
  assert.equal(parseRpgCommand('{"v":1,"t":"game.open","id":"a"}'), null);
  assert.equal(parseRpgCommand("não é json"), null);
  const ok = parseRpgCommand(
    '{"v":1,"t":"rpg.train.start","id":"a","d":{"instance":"d1","skill":"espada"}}',
  );
  assert.ok(ok?.ok);
  assert.deepEqual(
    parseRpgCommand(
      '{"v":1,"t":"rpg.train.start","id":"a","d":{"instance":"d1","skill":"pesca"}}',
    ),
    {
      ok: false,
      error: "invalid_message",
    },
  );
  assert.deepEqual(
    parseRpgCommand('{"v":1,"t":"rpg.vocation","id":"a","d":{"vocation":5}}'),
    { ok: false, error: "invalid_message" },
  );
  assert.ok(
    parseRpgCommand('{"v":1,"t":"rpg.vocation","id":"a","d":{"vocation":2}}')
      ?.ok,
  );
  assert.ok(parseRpgCommand('{"v":1,"t":"rpg.open","id":"a"}')?.ok);
  assert.deepEqual(
    parseRpgCommand('{"v":1,"t":"rpg.train.stop","id":"a","d":{"extra":1}}'),
    { ok: false, error: "invalid_message" },
  );
});

test("os dummies estão no catálogo como objetos de treino", () => {
  for (const id of ["dummy-wood", "dummy-target", "dummy-mannequin"]) {
    const it = itemOf(CATALOG, id);
    assert.equal(it?.interaction, "train", id);
    assert.equal(it?.solid, true, id);
  }
});
