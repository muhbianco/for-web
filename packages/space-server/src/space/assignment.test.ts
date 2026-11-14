import assert from "node:assert/strict";
import { test } from "node:test";

import { generateLayout } from "@muchat/space-core";

import { StoatCache } from "../stoat/cache.ts";
import type { StoatServer, StoatTextChannel } from "../stoat/types.ts";
import { type Assignment, normalizeWings, reconcile, toLayoutInput } from "./assignment.ts";
import { MemoryAssignmentStore } from "./store.ts";

const SRV = "01JSRV00000000000000000000";
const vc = (id: string, name: string, max?: number): StoatTextChannel => ({
  channel_type: "TextChannel",
  _id: id,
  server: SRV,
  name,
  voice: { max_users: max ?? null },
});
const text = (id: string, name: string): StoatTextChannel => ({ channel_type: "TextChannel", _id: id, server: SRV, name });

function fixture() {
  const cache = new StoatCache();
  const server: StoatServer = {
    _id: SRV,
    owner: "OWNER",
    name: "Piloto",
    channels: ["C1", "C2", "C3", "C4", "T1"],
    categories: [
      { id: "CAT_GAMES", title: "Jogos", channels: ["C2", "C3"] },
      { id: "CAT_WORK", title: "Trabalho", channels: ["C4", "T1"] },
    ],
    default_permissions: 0,
  };
  cache.apply({
    type: "Ready",
    servers: [server],
    channels: [vc("C1", "Lobby de voz"), vc("C2", "Duo", 2), vc("C3", "Squad", 8), vc("C4", "Reunião", 20), text("T1", "geral")],
  });
  return cache;
}

const slotsOf = (a: Assignment) =>
  Object.fromEntries(a.wings.map((w) => [w.title, w.slots.map((s) => (s.roomId ? `${s.roomId}:${s.size}` : `free:${s.size}`))]));

test("initial conversion: uncategorised first, then categories; text channels are not rooms", () => {
  const cache = fixture();
  const r = reconcile(null, cache.servers.get(SRV)!, cache.channels);
  assert.equal(r.changed, true);
  assert.equal(r.assignment.rev, 1);
  assert.deepEqual(slotsOf(r.assignment), {
    Geral: ["C1:M"],
    Jogos: ["C2:S", "C3:M"],
    Trabalho: ["C4:L"],
  });
  assert.deepEqual(r.assignment.wings.map((w) => w.index), [0, 1, 2]);
});

test("no change, no new revision", () => {
  const cache = fixture();
  const first = reconcile(null, cache.servers.get(SRV)!, cache.channels).assignment;
  const again = reconcile(first, cache.servers.get(SRV)!, cache.channels);
  assert.equal(again.changed, false);
  assert.equal(again.assignment.rev, first.rev);
});

test("new channel appends to its category's wing; existing rooms keep their slots", () => {
  const cache = fixture();
  const a1 = reconcile(null, cache.servers.get(SRV)!, cache.channels).assignment;
  cache.apply({ ...vc("C5", "Trio", 3), type: "ChannelCreate" });
  cache.apply({
    type: "ServerUpdate",
    id: SRV,
    data: { categories: [{ id: "CAT_GAMES", title: "Jogos", channels: ["C5", "C2", "C3"] }, { id: "CAT_WORK", title: "Trabalho", channels: ["C4", "T1"] }] },
  });
  const r = reconcile(a1, cache.servers.get(SRV)!, cache.channels);
  assert.equal(r.changed, true);
  // C5 is first in Stoat's order, but goes to the END of the wing: nobody moves.
  assert.deepEqual(slotsOf(r.assignment).Jogos, ["C2:S", "C3:M", "C5:S"]);
});

test("deleted channel frees its slot (keeping the size); a room that fits reuses it; a stale id in categories is ignored", () => {
  const cache = fixture();
  const a1 = reconcile(null, cache.servers.get(SRV)!, cache.channels).assignment;
  cache.apply({ type: "ChannelDelete", id: "C2" }); // categories still list C2
  const a2 = reconcile(a1, cache.servers.get(SRV)!, cache.channels).assignment;
  assert.deepEqual(slotsOf(a2).Jogos, ["free:S", "C3:M"]);
  cache.apply({ ...vc("C6", "Nova", 2), type: "ChannelCreate" });
  cache.apply({
    type: "ServerUpdate",
    id: SRV,
    data: { categories: [{ id: "CAT_GAMES", title: "Jogos", channels: ["C2", "C3", "C6"] }, { id: "CAT_WORK", title: "Trabalho", channels: ["C4", "T1"] }] },
  });
  const a3 = reconcile(a2, cache.servers.get(SRV)!, cache.channels).assignment;
  assert.deepEqual(slotsOf(a3).Jogos, ["C6:S", "C3:M"]);
});

test("a bigger room does not fit a smaller free slot (appends); a smaller room takes a bigger slot's size", () => {
  const cache = fixture();
  const a1 = reconcile(null, cache.servers.get(SRV)!, cache.channels).assignment;
  cache.apply({ type: "ChannelDelete", id: "C2" }); // frees an S slot in Jogos
  cache.apply({ type: "ChannelDelete", id: "C4" }); // frees an L slot in Trabalho
  const a2 = reconcile(a1, cache.servers.get(SRV)!, cache.channels).assignment;
  cache.apply({ ...vc("C7", "Grande", 30), type: "ChannelCreate" });
  cache.apply({ ...vc("C8", "Pequena", 2), type: "ChannelCreate" });
  cache.apply({
    type: "ServerUpdate",
    id: SRV,
    data: {
      categories: [
        { id: "CAT_GAMES", title: "Jogos", channels: ["C3", "C7"] },
        { id: "CAT_WORK", title: "Trabalho", channels: ["C8", "T1"] },
      ],
    },
  });
  const a3 = reconcile(a2, cache.servers.get(SRV)!, cache.channels).assignment;
  assert.deepEqual(slotsOf(a3).Jogos, ["free:S", "C3:M", "C7:L"]);
  assert.deepEqual(slotsOf(a3).Trabalho, ["C8:L"]);
});

test("voice removed from a channel archives the room; moving category does not move it", () => {
  const cache = fixture();
  const a1 = reconcile(null, cache.servers.get(SRV)!, cache.channels).assignment;
  cache.apply({ type: "ChannelUpdate", id: "C4", data: {}, clear: ["Voice"] });
  cache.apply({
    type: "ServerUpdate",
    id: SRV,
    data: { categories: [{ id: "CAT_GAMES", title: "Jogos", channels: ["C2"] }, { id: "CAT_WORK", title: "Trabalho", channels: ["C3", "C4", "T1"] }] },
  });
  const a2 = reconcile(a1, cache.servers.get(SRV)!, cache.channels).assignment;
  assert.deepEqual(slotsOf(a2), { Geral: ["C1:M"], Jogos: ["C2:S", "C3:M"], Trabalho: ["free:L"] });
});

test("category rename renames the wing only", () => {
  const cache = fixture();
  const a1 = reconcile(null, cache.servers.get(SRV)!, cache.channels).assignment;
  cache.apply({
    type: "ServerUpdate",
    id: SRV,
    data: { categories: [{ id: "CAT_GAMES", title: "Games", channels: ["C2", "C3"] }, { id: "CAT_WORK", title: "Trabalho", channels: ["C4", "T1"] }] },
  });
  const r = reconcile(a1, cache.servers.get(SRV)!, cache.channels);
  assert.equal(r.changed, true);
  assert.deepEqual(r.assignment.wings.map((w) => [w.index, w.title]), [[0, "Geral"], [1, "Games"], [2, "Trabalho"]]);
});

test("legacy null slots (template 1) become free L slots, once, with a new revision", () => {
  const cache = fixture();
  const legacy = {
    serverId: SRV,
    rev: 3,
    wings: normalizeWings([
      { index: 0, categoryId: null, title: "Geral", slots: [{ roomId: "C1", size: "M" }] },
      { index: 1, categoryId: "CAT_GAMES", title: "Jogos", slots: [null, { roomId: "C2", size: "S" }, { roomId: "C3", size: "M" }] },
      { index: 2, categoryId: "CAT_WORK", title: "Trabalho", slots: [{ roomId: "C4", size: "L" }] },
    ]),
  };
  assert.deepEqual(slotsOf(legacy).Jogos, ["free:L", "C2:S", "C3:M"]);
  const r = reconcile(legacy, cache.servers.get(SRV)!, cache.channels);
  assert.equal(r.changed, false);
  assert.equal(r.assignment.rev, 3);
});

test("the layout from an assignment is generated and carries channel names", () => {
  const cache = fixture();
  const a = reconcile(null, cache.servers.get(SRV)!, cache.channels).assignment;
  const map = generateLayout(toLayoutInput(a, cache.channels));
  assert.equal(map.rooms.length, 4);
  assert.equal(map.rooms.find((r) => r.roomId === "C4")?.label, "Reunião");
});

test("store is compare-and-set on rev", async () => {
  const store = new MemoryAssignmentStore();
  const cache = fixture();
  const a = reconcile(null, cache.servers.get(SRV)!, cache.channels).assignment;
  assert.equal(await store.save(a, 0), true);
  assert.equal(await store.save(a, 0), false, "second creator loses");
  const b = { ...a, rev: a.rev + 1 };
  assert.equal(await store.save(b, 7), false, "stale writer loses");
  assert.equal(await store.save(b, a.rev), true);
  assert.equal((await store.load(SRV))?.rev, b.rev);
});
