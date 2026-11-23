/* global process, console */
/**
 * Heróis do jogo idle para as contas do laboratório completo (23/11/2026): Ana
 * cavaleira, Bia druida e Caio arqueiro, para o roteiro de celular e tablet
 * (packages/client/qa/full-lab/mobile-audit.mjs) chegar na ficha do herói, na loja e
 * nas dungeons sem passar pelo boneco de treino. Usa as mesmas funções do servidor
 * (newRpgHero, applyVocation) e grava no Mongo do laboratório. Herói que já tem
 * vocação fica como está.
 *
 *   node packages/space-server/lab/full/seed-heroes.ts [--lab-dir <pasta do lab>]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MongoClient } from "mongodb";

import {
  applyVocation,
  newRpgHero,
  normalizeHero,
} from "../../src/game/ot/hero.ts";
import { MongoRpgStore } from "../../src/game/ot/store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const at = process.argv.indexOf("--lab-dir");
const LAB =
  (at >= 0 ? process.argv[at + 1] : undefined) ??
  process.env.FULL_LAB_DIR ??
  HERE;
const ip = readFileSync(join(LAB, ".wsl-ip"), "utf8").trim();
const state = JSON.parse(
  readFileSync(join(LAB, "state.local.json"), "utf8"),
) as {
  users: Record<string, { id: string }>;
};

const WHO: Array<[string, 1 | 2 | 3 | 4]> = [
  ["ana", 4],
  ["bia", 2],
  ["caio", 3],
];

const client = new MongoClient(`mongodb://${ip}:27018`, {
  serverSelectionTimeoutMS: 5_000,
});
await client.connect();
try {
  const store = new MongoRpgStore(client);
  for (const [name, vocation] of WHO) {
    const id = state.users[name]?.id;
    if (!id) {
      console.log(`${name}: sem conta na semente`);
      continue;
    }
    const raw = await store.get(id);
    const now = Date.now();
    if (!raw) {
      const doc = newRpgHero(id, now);
      applyVocation(doc, vocation);
      console.log(
        `${name}: ${(await store.create(doc)) ? "criado" : "já existia"} (vocação ${vocation})`,
      );
      continue;
    }
    const doc = normalizeHero(raw);
    if (doc.vocation !== 0) {
      console.log(`${name}: já tem vocação ${doc.vocation}`);
      continue;
    }
    const rev = doc.rev;
    applyVocation(doc, vocation);
    doc.rev = rev + 1;
    doc.updated_at = now;
    console.log(
      `${name}: ${(await store.save(doc, rev)) ? "vocação gravada" : "conflito, rode de novo"} (${vocation})`,
    );
  }
} finally {
  await client.close();
}
