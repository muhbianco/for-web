import assert from "node:assert/strict";
import test from "node:test";

import { newRpgHero, normalizeHero, RPG_VERSION, type RpgHeroDoc } from "./hero.ts";
import { knownVersion, MongoRpgStore } from "./store.ts";

/** Um Mongo de mentira com um documento só. */
function fakeMongo(doc: Record<string, unknown> | null) {
  const col = { findOne: async () => doc };
  return { db: () => ({ collection: () => col }) } as never;
}

test("store: herói de versão antiga volta para a conversão; versão mais nova (rollback) é recusada", async () => {
  assert.equal(knownVersion(1), true);
  assert.equal(knownVersion(RPG_VERSION), true);
  assert.equal(knownVersion(RPG_VERSION + 1), false);
  assert.equal(knownVersion("2"), false);
  assert.equal(knownVersion(undefined), false);
  // O herói da etapa O5 como estava em produção: v 1, moedas soltas e a lista de itens.
  const old = newRpgHero("U1", 0) as unknown as Record<string, unknown>;
  delete old.inv;
  delete old.auto_equip;
  Object.assign(old, {
    v: 1,
    vocation: 3,
    level: 6,
    gold: 40,
    bag: [{ item: "elmo-de-ferro", count: 2 }],
    mtime: new Date(),
  });
  const got = await new MongoRpgStore(fakeMongo(old)).get("U1");
  assert.ok(got);
  assert.equal("mtime" in got, false);
  const d = normalizeHero(got as RpgHeroDoc);
  assert.equal(d.v, RPG_VERSION);
  assert.equal(d.inv.equip.mochila?.item, "mochila");
  assert.ok(d.inv.pack.some((x) => x.item === "elmo-de-ferro"));
  await assert.rejects(
    new MongoRpgStore(fakeMongo({ ...old, v: RPG_VERSION + 1 })).get("U1"),
    /unknown version/,
  );
});
