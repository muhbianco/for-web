import assert from "node:assert/strict";
import test from "node:test";

import { newRpgHero, RPG_VERSION } from "./hero.ts";
import { HEROES_COLLECTION, knownVersion, MongoRpgStore } from "./store.ts";

/** Um Mongo de mentira com um documento só; guarda o nome da coleção pedida. */
function fakeMongo(doc: Record<string, unknown> | null) {
  const asked: string[] = [];
  const col = { findOne: async () => doc };
  return {
    asked,
    client: {
      db: () => ({
        collection: (name: string) => {
          asked.push(name);
          return col;
        },
      }),
    } as never,
  };
}

test("store v5: coleção nova (a do v4 fica intacta); só lê a v5; versão desconhecida é recusada", async () => {
  assert.equal(HEROES_COLLECTION, "rpg_heroes5");
  assert.equal(knownVersion(RPG_VERSION), true);
  assert.equal(knownVersion(4), false);
  assert.equal(knownVersion(6), false);
  assert.equal(knownVersion("5"), false);
  let n = 0;
  const doc = {
    ...newRpgHero("U1", "mago", 1, () => `i${++n}`),
    mtime: new Date(),
  } as unknown as Record<string, unknown>;
  const m = fakeMongo(doc);
  const got = await new MongoRpgStore(m.client).get("U1");
  assert.deepEqual(m.asked, ["rpg_heroes5"]);
  assert.ok(got);
  assert.equal("mtime" in got, false);
  assert.equal(got.hero.cls, "mago");
  await assert.rejects(
    new MongoRpgStore(fakeMongo({ ...doc, v: 4 }).client).get("U1"),
    /unknown version/,
  );
});
