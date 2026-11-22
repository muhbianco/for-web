import assert from "node:assert/strict";
import { test } from "node:test";

import { type GameCommand, LOBBY, lobbyItemOf, lobbyPrice, Rng, rollItem } from "@muchat/space-core/game";

import { silentLog } from "../log.ts";
import type { SessionPort, Viewer } from "../space/runtime.ts";
import { BAG_MAX, docBytes, DOC_MAX_BYTES, PENDING_MAX } from "./hero.ts";
import { type GameHost, GameService } from "./service.ts";
import { MemoryGameStore } from "./store.ts";

// Refúgio (ADR 0009, etapa E4b): comprar e arrumar a decoração do quarto.

const SRV = "01JSRV00000000000000000000";
const ID = "01JDEC0R000000000000000000";
const host: GameHost = { serverId: SRV, gameAccess: () => "ok" };

function rig() {
  const store = new MemoryGameStore();
  let n = 1;
  const svc = new GameService({ store, log: silentLog, now: () => 1_800_000_000_000 + n * 1000, random: () => 1000 + n++ });
  const sent: Record<string, any>[] = [];
  const s: SessionPort = {
    viewer: { user: { _id: ID, username: "deco" }, member: { _id: { server: SRV, user: ID }, roles: [] } } as Viewer,
    send: (e) => void sent.push(e),
    close: () => {},
  };
  let seq = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ask = async (t: GameCommand["t"], d?: unknown): Promise<any> => {
    const id = `c${++seq}`;
    svc.handle(s, host, { v: 1, t, id, ...(d === undefined ? {} : { d }) } as GameCommand);
    await svc.idle(ID);
    return sent.filter((m) => m.re === id).at(-1);
  };
  return { store, ask };
}

test("decoração: o herói nasce com o quarto arrumado", async () => {
  const r = rig();
  const made = await r.ask("game.create", { cls: "druida", look: { skin: 0, hair: 0, outfit: 0, trim: 0, cosmetic: null } });
  const h = made.d.hero;
  assert.equal(h.lobby.length, 5);
  assert.deepEqual(Object.keys(h.decor_owned).sort(), ["bookshelf", "floor-lamp", "plant-small", "rug-round", "window"]);
  assert.equal(new Set(h.lobby.map((x: any) => x.id)).size, 5, "ids únicos");
});

test("decoração: comprar com ouro, colocar, mover, tirar e os limites", async () => {
  const r = rig();
  await r.ask("game.create", { cls: "cavaleiro", look: { skin: 0, hair: 0, outfit: 0, trim: 0, cosmetic: null } });
  const doc = r.store.docs.get(ID)!;
  doc.gold = 2000;
  doc.lobby = []; // quarto vazio para o teste
  doc.rev++;
  // O serviço de cima tem o documento velho em cache: abre outro com o documento novo.
  const svc2 = (() => {
    const fresh = rig();
    fresh.store.docs.set(ID, structuredClone(doc));
    return fresh;
  })();
  const chairPrice = lobbyPrice(lobbyItemOf("chair")!);
  const bought = await svc2.ask("game.buy", { offer: "decor", qty: 2, item: "chair" });
  assert.equal(bought.t, "game.state", JSON.stringify(bought.d));
  assert.equal(bought.d.hero.gold, 2000 - 2 * chairPrice);
  assert.equal(bought.d.hero.decor_owned.chair, 2);
  assert.deepEqual((await svc2.ask("game.buy", { offer: "decor", qty: 1, item: "desk-pc" })).d, { code: "game_invalid", reason: "unknown_item" });
  assert.deepEqual((await svc2.ask("game.buy", { offer: "decor", qty: 1, item: "statue" })).d, { code: "game_invalid", reason: "no_gold" });

  const p1 = await svc2.ask("game.lobby.place", { item: "chair", x: 1, y: 4, rot: 0 });
  assert.equal(p1.t, "game.state", JSON.stringify(p1.d));
  const p2 = await svc2.ask("game.lobby.place", { item: "chair", x: 2, y: 4, rot: 0 });
  assert.equal(p2.t, "game.state");
  assert.deepEqual((await svc2.ask("game.lobby.place", { item: "chair", x: 3, y: 4, rot: 0 })).d, { code: "game_invalid", reason: "not_owned" }, "só tem 2");
  assert.deepEqual((await svc2.ask("game.lobby.place", { item: "window", x: 3, y: 4, rot: 0 })).d, { code: "game_invalid", reason: "out_of_bounds" });
  const ids = p2.d.hero.lobby.map((x: any) => x.id);
  assert.deepEqual((await svc2.ask("game.lobby.move", { id: ids[1], x: 1, y: 4, rot: 0 })).d, { code: "game_invalid", reason: "overlap" });
  const moved = await svc2.ask("game.lobby.move", { id: ids[1], x: 4, y: 6, rot: 0 });
  assert.deepEqual(moved.d.hero.lobby.find((x: any) => x.id === ids[1]), { id: ids[1], item: "chair", x: 4, y: 6, rot: 0 });
  const removed = await svc2.ask("game.lobby.remove", { id: ids[0] });
  assert.equal(removed.d.hero.lobby.length, 1);
  assert.equal(removed.d.hero.decor_owned.chair, 2, "tirar do quarto não vende");
  assert.equal((await svc2.ask("game.lobby.place", { item: "chair", x: 1, y: 4, rot: 0 })).t, "game.state", "coloca de novo");
  assert.deepEqual((await svc2.ask("game.lobby.remove", { id: "NAOEXISTE" })).d, { code: "game_invalid", reason: "not_found" });
});

test("decoração: quarto cheio recusa, e o documento com tudo no máximo cabe em 32 KB", async () => {
  const r = rig();
  await r.ask("game.create", { cls: "feiticeiro", look: { skin: 0, hair: 0, outfit: 0, trim: 0, cosmetic: null } });
  const doc = structuredClone(r.store.docs.get(ID)!);
  doc.lobby = Array.from({ length: LOBBY.maxItems }, (_, i) => ({ id: `ID${String(i).padStart(5, "0")}`, item: "statue", x: i % 12, y: 3 + (i % 5), rot: 0 as const, variant: "bronze" }));
  doc.decor_owned = Object.fromEntries(Array.from({ length: LOBBY.maxKinds }, (_, i) => [`item-com-nome-longo-${i}`, 99]));
  doc.decor_owned.chair = 5;
  const rng = new Rng(3);
  for (let i = 0; i < BAG_MAX; i++) doc.bag.push(rollItem(rng, 250, "mitico", "feiticeiro", "anel"));
  for (let i = 0; i < PENDING_MAX; i++) doc.pending.push(rollItem(rng, 250, "mitico", "feiticeiro", "amuleto"));
  assert.ok(docBytes(doc) < DOC_MAX_BYTES, `${docBytes(doc)} bytes`);
  const fresh = rig();
  fresh.store.docs.set(ID, doc);
  assert.deepEqual((await fresh.ask("game.lobby.place", { item: "chair", x: 0, y: 7, rot: 0 })).d, { code: "game_invalid", reason: "full" });
});
