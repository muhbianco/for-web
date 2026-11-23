import assert from "node:assert/strict";
import test from "node:test";

import { type RpgLobbyMember, LOBBY } from "@muchat/space-core/game/ot";

import { LobbyHub } from "./lobby.ts";

const m = (
  id: string,
  level = 10,
  vocation: RpgLobbyMember["vocation"] = 4,
): RpgLobbyMember => ({
  user_id: id,
  name: id,
  vocation,
  level,
});

test("sala na TV: cria, entra até 4, uma sala por TV e uma por pessoa", () => {
  const hub = new LobbyHub();
  assert.equal(hub.create("tv1", "R1", "cripta-do-musgo", m("A"), 0).ok, true);
  assert.deepEqual(hub.create("tv1", "R1", "cripta-do-musgo", m("B"), 0), {
    ok: false,
    reason: "tv_busy",
  });
  assert.deepEqual(hub.create("tv2", "R1", "cripta-do-musgo", m("A"), 0), {
    ok: false,
    reason: "in_lobby",
  });
  for (const id of ["B", "C", "D"])
    assert.equal(hub.join("tv1", m(id)).ok, true);
  assert.deepEqual(hub.join("tv1", m("E")), { ok: false, reason: "full" });
  assert.equal(hub.get("tv1")!.members.length, LOBBY.maxMembers);
  // Entrar de novo na mesma sala não duplica.
  assert.equal(hub.join("tv1", m("B")).ok, true);
  assert.equal(hub.get("tv1")!.members.length, 4);
  assert.deepEqual(hub.join("tv9", m("Z")), { ok: false, reason: "no_lobby" });
  assert.deepEqual(hub.create("tv3", "R1", "nada", m("Y"), 0), {
    ok: false,
    reason: "unknown_dungeon",
  });
});

test("level mínimo da dungeon vale para criar e para entrar", () => {
  const hub = new LobbyHub();
  assert.deepEqual(hub.create("tv1", "R1", "galerias-afogadas", m("A", 5), 0), {
    ok: false,
    reason: "level",
  });
  assert.equal(
    hub.create("tv1", "R1", "galerias-afogadas", m("A", 8), 0).ok,
    true,
  );
  assert.deepEqual(hub.join("tv1", m("B", 7)), { ok: false, reason: "level" });
});

test("sair: membro sai e a sala segue; o líder saindo cancela; quem saiu pode criar outra", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "cripta-do-musgo", m("A"), 0);
  hub.join("tv1", m("B"));
  hub.join("tv1", m("C"));
  const left = hub.leave("B")!;
  assert.equal(left.ended, undefined);
  assert.deepEqual(
    left.lobby.members.map((x) => x.user_id),
    ["A", "C"],
  );
  assert.equal(hub.of("B"), undefined);
  const gone = hub.leave("A")!;
  assert.equal(gone.ended, "cancelled");
  assert.equal(hub.get("tv1"), undefined);
  assert.equal(hub.of("C"), undefined, "o cancelamento solta todos");
  assert.equal(hub.leave("Z"), null);
  assert.equal(hub.create("tv1", "R1", "cripta-do-musgo", m("C"), 0).ok, true);
});

test("começar: só o líder, antes do prazo; a sala fecha e solta todos", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "cripta-do-musgo", m("A"), 0);
  hub.join("tv1", m("B"));
  assert.deepEqual(hub.start("B", 1000), { ok: false, reason: "not_leader" });
  assert.deepEqual(hub.start("Z", 1000), { ok: false, reason: "no_lobby" });
  const s = hub.start("A", 1000);
  assert.equal(s.ok, true);
  assert.equal(hub.get("tv1"), undefined);
  assert.equal(hub.of("A"), undefined);
  assert.equal(hub.of("B"), undefined);
});

test("prazo: a sala some sozinha depois de 5 min; a TV removida acaba com a sala", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "cripta-do-musgo", m("A"), 0);
  hub.create("tv2", "R1", "cripta-do-musgo", m("B"), 60_000);
  assert.deepEqual(hub.expire(LOBBY.ttlMs - 1), []);
  assert.deepEqual(
    hub.expire(LOBBY.ttlMs).map((l) => l.tv),
    ["tv1"],
  );
  assert.equal(hub.of("A"), undefined);
  assert.deepEqual(hub.start("B", 60_000 + LOBBY.ttlMs), {
    ok: false,
    reason: "expired",
  });
  assert.equal(hub.dropTv("tv2")!.tv, "tv2");
  assert.equal(hub.of("B"), undefined);
  assert.deepEqual(hub.inRoom("R1"), []);
});
