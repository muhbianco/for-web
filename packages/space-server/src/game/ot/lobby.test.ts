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

test("sair: membro sai e o grupo segue; o líder saindo passa a liderança; o último fecha; desfazer solta todos", () => {
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
  // 24/11/2026: o líder saindo não desfaz o grupo; quem entrou primeiro depois dele lidera.
  const passed = hub.leave("A")!;
  assert.equal(passed.ended, undefined);
  assert.equal(passed.lobby.leader, "C");
  const last = hub.leave("C")!;
  assert.equal(last.ended, "cancelled");
  assert.equal(hub.get("tv1"), undefined);
  assert.equal(hub.leave("Z"), null);
  // Desfazer (só o líder) solta todos.
  hub.create("tv1", "R1", "cripta-do-musgo", m("C"), 0);
  hub.join("tv1", m("D"));
  assert.deepEqual(hub.disband("D"), { ok: false, reason: "not_leader" });
  assert.equal(hub.disband("C").ok, true);
  assert.equal(hub.of("D"), undefined);
  assert.equal(hub.get("tv1"), undefined);
});

test("começar: só o líder; o grupo fica montado, corre e volta pronto para a próxima", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "cripta-do-musgo", m("A"), 0);
  hub.join("tv1", m("B"));
  assert.deepEqual(hub.start("B", 1000), { ok: false, reason: "not_leader" });
  assert.deepEqual(hub.start("Z", 1000), { ok: false, reason: "no_lobby" });
  const s = hub.start("A", 1000);
  assert.equal(s.ok, true);
  const l = hub.get("tv1")!;
  assert.equal(l.state, "running");
  assert.equal(hub.of("B"), l, "ninguém sai ao começar");
  assert.deepEqual(hub.start("A", 1001), { ok: false, reason: "in_run" });
  // Gravação falhou: volta a formar.
  assert.equal(hub.abort("tv1", 1002)!.state, "forming");
  hub.start("A", 1003);
  hub.running("tv1", "run-1");
  assert.equal(hub.abort("tv1", 1004), null, "corrida gravada não volta atrás");
  assert.equal(hub.runEnded("tv1", "outra", "vitoria", 5000), null);
  const ended = hub.runEnded("tv1", "run-1", "vitoria", 5000)!;
  assert.equal(ended.state, "ready");
  assert.equal(ended.runs, 1);
  assert.equal(ended.last, "vitoria");
  assert.equal(ended.expiresAt, 5000 + LOBBY.idleMs);
  assert.equal(ended.nextAt, null, "sem loop, espera o líder");
  assert.equal(hub.start("A", 6000).ok, true, "a próxima com o mesmo grupo");
});

test("loop: depois de cada vitória a próxima fica marcada; derrota, retirada e falha param com o motivo", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "cripta-do-musgo", m("A"), 0);
  hub.join("tv1", m("B"));
  assert.deepEqual(hub.setLoop("B", true, 0), { ok: false, reason: "not_leader" });
  assert.equal(hub.setLoop("A", true, 0).ok, true);
  assert.equal(hub.get("tv1")!.nextAt, null, "antes da primeira, espera o Começar");
  hub.start("A", 10);
  hub.running("tv1", "r1");
  hub.runEnded("tv1", "r1", "vitoria", 1000);
  const l = hub.get("tv1")!;
  assert.equal(l.nextAt, 1000 + LOBBY.loopDelayMs);
  assert.deepEqual(hub.due(1000 + LOBBY.loopDelayMs - 1), []);
  assert.deepEqual(hub.due(1000 + LOBBY.loopDelayMs), [l]);
  // Marcado, não expira; correndo, também não.
  assert.deepEqual(hub.expire(10 ** 9), []);
  hub.start("A", 20_000);
  hub.running("tv1", "r2");
  assert.deepEqual(hub.expire(10 ** 9), []);
  hub.runEnded("tv1", "r2", "derrota", 30_000);
  assert.equal(l.loop, false);
  assert.equal(l.stopped, "derrota");
  assert.equal(l.nextAt, null);
  // Ligar de novo com o grupo pronto já marca a próxima.
  hub.setLoop("A", true, 31_000);
  assert.equal(l.stopped, null);
  assert.equal(l.nextAt, 31_000 + LOBBY.loopDelayMs);
  hub.loopFailed("tv1", "start_failed", "level");
  assert.deepEqual([l.loop, l.stopped, l.stoppedDetail], [false, "start_failed", "level"]);
  // O líder saindo com o loop ligado: desliga (o novo líder decide).
  hub.setLoop("A", true, 40_000);
  hub.leave("A");
  assert.deepEqual([l.leader, l.loop, l.stopped], ["B", false, "leader_left"]);
  // Parado e sem corrida: o grupo se desfaz depois do prazo de pronto.
  assert.deepEqual(hub.expire(30_000 + LOBBY.idleMs).map((x) => x.tv), ["tv1"]);
});

test("trocar a dungeon: só o líder, fora da corrida, e todos com o level dela", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "cripta-do-musgo", m("A", 30), 0);
  hub.join("tv1", m("B", 10));
  assert.deepEqual(hub.setDungeon("B", "toca-dos-javalis"), { ok: false, reason: "not_leader" });
  assert.deepEqual(hub.setDungeon("A", "nada"), { ok: false, reason: "unknown_dungeon" });
  assert.deepEqual(hub.setDungeon("A", "mina-assombrada"), { ok: false, reason: "level" });
  assert.equal(hub.setDungeon("A", "galerias-afogadas").ok, true);
  assert.equal(hub.get("tv1")!.dungeon, "galerias-afogadas");
  hub.start("A", 1);
  assert.deepEqual(hub.setDungeon("A", "cripta-do-musgo"), { ok: false, reason: "in_run" });
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
