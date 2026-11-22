import assert from "node:assert/strict";
import { test } from "node:test";

import type { MongoClient } from "mongodb";

import { newHeroDoc } from "./hero.ts";
import { MongoGameStore } from "./store.ts";

// Refúgio (ADR 0009, decisão 6): o store do Mongo contra uma coleção falsa
// com a mesma semântica de filtro por _id e rev e de chave duplicada.

function fakeMongo() {
  const docs = new Map<string, Record<string, unknown>>();
  const ops: { op: string; options: unknown }[] = [];
  const col = {
    async findOne(filter: { _id: string }, options: unknown) {
      ops.push({ op: "findOne", options });
      const d = docs.get(filter._id);
      return d ? structuredClone(d) : null;
    },
    async insertOne(doc: Record<string, unknown>, options: unknown) {
      ops.push({ op: "insertOne", options });
      if (docs.has(doc._id as string)) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      docs.set(doc._id as string, structuredClone(doc));
      return { acknowledged: true };
    },
    async replaceOne(filter: { _id: string; rev: number }, doc: Record<string, unknown>, options: unknown) {
      ops.push({ op: "replaceOne", options });
      const cur = docs.get(filter._id);
      if (!cur || cur.rev !== filter.rev) return { matchedCount: 0 };
      docs.set(filter._id, structuredClone(doc));
      return { matchedCount: 1 };
    },
  };
  const names: string[] = [];
  const client = {
    db(name: string) {
      names.push(name);
      return {
        collection(c: string) {
          names.push(c);
          return col;
        },
      };
    },
  } as unknown as MongoClient;
  return { client, docs, ops, names };
}

const ANA = "01JANA00000000000000000000";
const SRV = "01JSRV00000000000000000000";
const look = { skin: 0, hair: 0, outfit: 0, trim: 0, cosmetic: null };

test("store Mongo: coleção certa, create uma vez, save só com o rev esperado, get sem mtime", async () => {
  const m = fakeMongo();
  const store = new MongoGameStore(m.client);
  assert.deepEqual(m.names, ["muchat_space", "game_heroes"]);
  const doc = newHeroDoc(ANA, "cavaleiro", look, 1000, SRV, () => 1);
  assert.equal(await store.create(doc), true);
  assert.equal(await store.create(doc), false, "chave duplicada = já existe");
  assert.ok(m.docs.get(ANA)!.mtime instanceof Date);
  const got = await store.get(ANA);
  assert.deepEqual(got, doc, "o que volta é o herói, sem o mtime");
  assert.equal(await store.save({ ...doc, rev: 1, gold: 5 }, 1), false, "rev errado");
  assert.equal(await store.save({ ...doc, rev: 1, gold: 5 }, 0), true);
  assert.equal((await store.get(ANA))!.gold, 5);
  assert.equal(await store.get("01JNINGUEM0000000000000000"), null);
  // Toda operação tem teto de tempo.
  for (const o of m.ops) assert.deepEqual(o.options, { maxTimeMS: 2_000 }, o.op);
});

test("store Mongo: versão desconhecida no banco é recusada, nunca sobrescrita", async () => {
  const m = fakeMongo();
  const store = new MongoGameStore(m.client);
  m.docs.set(ANA, { ...newHeroDoc(ANA, "druida", look, 1000, SRV, () => 2), v: 2, mtime: new Date() });
  await assert.rejects(() => store.get(ANA), /unknown version 2/);
});

test("store Mongo: erro que não é chave duplicada sobe", async () => {
  const m = fakeMongo();
  const store = new MongoGameStore(m.client);
  const col = (m.client as unknown as { db: (n: string) => { collection: (c: string) => { insertOne: unknown } } }).db("x").collection("y");
  col.insertOne = async () => {
    throw Object.assign(new Error("network"), { code: 89 });
  };
  await assert.rejects(() => store.create(newHeroDoc(ANA, "arqueiro", look, 1000, SRV, () => 3)), /network/);
});
