import assert from "node:assert/strict";
import test from "node:test";

import type { RpgLobbyMember } from "@muchat/space-core/game/ot/balance";

import { LOBBY, LobbyHub, lobbyView } from "./lobby.ts";

const m = (
  id: string,
  level = 40,
  cls: RpgLobbyMember["cls"] = "guerreiro",
): RpgLobbyMember => ({
  user_id: id,
  name: id,
  cls,
  level,
});

test("grupo na TV: cria, entra até 5 (D41), vários grupos por TV e um por pessoa", () => {
  const hub = new LobbyHub();
  assert.equal(hub.create("tv1", "R1", "masmorra-40", m("A"), 0).ok, true);
  // 24/11/2026: a TV aceita outro grupo (o que fica montado não a prende mais).
  const other = hub.create("tv1", "R1", "masmorra-40", m("Z"), 0);
  assert.equal(other.ok, true);
  assert.equal(hub.atTv("tv1").length, 2);
  // Entrar pelo id escolhe o grupo; sair do segundo o fecha.
  assert.equal(hub.join("tv1", other.ok ? other.lobby.id : "", m("Y")).ok, true);
  assert.equal(hub.of("Y"), hub.of("Z"));
  hub.leave("Y");
  hub.leave("Z");
  assert.equal(hub.atTv("tv1").length, 1);
  assert.deepEqual(hub.create("tv2", "R1", "masmorra-40", m("A"), 0), {
    ok: false,
    reason: "in_lobby",
  });
  for (const id of ["B", "C", "D", "E"])
    assert.equal(hub.join("tv1", undefined, m(id)).ok, true);
  assert.deepEqual(hub.join("tv1", hub.of("A")!.id, m("F")), { ok: false, reason: "full" });
  // Sem id, a TV não tem grupo com vaga.
  assert.deepEqual(hub.join("tv1", undefined, m("F")), { ok: false, reason: "no_lobby" });
  assert.equal(hub.atTv("tv1")[0]!.members.length, 5);
  // Entrar de novo na mesma sala não duplica.
  assert.equal(hub.join("tv1", undefined, m("B")).ok, true);
  assert.equal(hub.atTv("tv1")[0]!.members.length, 5);
  assert.deepEqual(hub.join("tv9", undefined, m("Z")), { ok: false, reason: "no_lobby" });
  // O id de um grupo de outra TV não serve.
  assert.deepEqual(hub.join("tv9", hub.of("A")!.id, m("Z")), { ok: false, reason: "no_lobby" });
  assert.deepEqual(hub.create("tv3", "R1", "nada", m("Y"), 0), {
    ok: false,
    reason: "unknown_dungeon",
  });
});

test("level mínimo da dungeon vale para criar e para entrar", () => {
  const hub = new LobbyHub();
  assert.deepEqual(hub.create("tv1", "R1", "masmorra-70", m("A", 5), 0), {
    ok: false,
    reason: "level",
  });
  assert.equal(
    hub.create("tv1", "R1", "masmorra-70", m("A", 66), 0).ok,
    true,
  );
  assert.deepEqual(hub.join("tv1", undefined, m("B", 7)), { ok: false, reason: "level" });
});

test("sair: membro sai e o grupo segue; o líder saindo passa a liderança; o último fecha; desfazer solta todos", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "masmorra-40", m("A"), 0);
  hub.join("tv1", undefined, m("B"));
  hub.join("tv1", undefined, m("C"));
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
  assert.equal(hub.atTv("tv1")[0], undefined);
  assert.equal(hub.leave("Z"), null);
  // Desfazer (só o líder) solta todos.
  hub.create("tv1", "R1", "masmorra-40", m("C"), 0);
  hub.join("tv1", undefined, m("D"));
  assert.deepEqual(hub.disband("D"), { ok: false, reason: "not_leader" });
  assert.equal(hub.disband("C").ok, true);
  assert.equal(hub.of("D"), undefined);
  assert.equal(hub.atTv("tv1")[0], undefined);
});

test("começar: só o líder; o grupo fica montado, corre e volta pronto para a próxima", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "masmorra-40", m("A"), 0);
  hub.join("tv1", undefined, m("B"));
  assert.deepEqual(hub.start("B", 1000), { ok: false, reason: "not_leader" });
  assert.deepEqual(hub.start("Z", 1000), { ok: false, reason: "no_lobby" });
  const s = hub.start("A", 1000);
  assert.equal(s.ok, true);
  const l = hub.atTv("tv1")[0]!;
  assert.equal(l.state, "running");
  assert.equal(hub.of("B"), l, "ninguém sai ao começar");
  assert.deepEqual(hub.start("A", 1001), { ok: false, reason: "in_run" });
  // Gravação falhou: volta a formar.
  assert.equal(hub.abort(hub.of("A")!.id, 1002)!.state, "forming");
  hub.start("A", 1003);
  hub.running(hub.of("A")!.id, "run-1");
  assert.equal(hub.abort(hub.of("A")!.id, 1004), null, "corrida gravada não volta atrás");
  assert.equal(hub.runEnded("outra", "vitoria", 5000), null);
  const ended = hub.runEnded("run-1", "vitoria", 5000)!;
  assert.equal(ended.state, "ready");
  assert.equal(ended.runs, 1);
  assert.equal(ended.last, "vitoria");
  assert.equal(ended.expiresAt, 5000 + LOBBY.idleMs);
  assert.equal(ended.nextAt, null, "sem loop, espera o líder");
  assert.equal(hub.start("A", 6000).ok, true, "a próxima com o mesmo grupo");
});

test("loop: depois de cada vitória a próxima fica marcada; derrota, retirada e falha param com o motivo", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "masmorra-40", m("A"), 0);
  hub.join("tv1", undefined, m("B"));
  assert.deepEqual(hub.setLoop("B", true, 0), { ok: false, reason: "not_leader" });
  assert.equal(hub.setLoop("A", true, 0).ok, true);
  assert.equal(hub.atTv("tv1")[0]!.nextAt, null, "antes da primeira, espera o Começar");
  hub.start("A", 10);
  hub.running(hub.of("A")!.id, "r1");
  hub.runEnded("r1", "vitoria", 1000);
  const l = hub.atTv("tv1")[0]!;
  assert.equal(l.nextAt, 1000 + LOBBY.loopDelayMs);
  assert.deepEqual(hub.loopDue(1000 + LOBBY.loopDelayMs - 1), []);
  // Venceu: a largada fica pedida e conta 3 s (26/11/2026).
  assert.deepEqual(hub.loopDue(1000 + LOBBY.loopDelayMs), [l]);
  assert.deepEqual([l.pending, l.pendingAuto, l.nextAt], [true, true, null]);
  assert.equal(l.startAt, 1000 + LOBBY.loopDelayMs + LOBBY.countdownMs);
  assert.deepEqual(hub.launchDue(l.startAt! - 1), []);
  assert.deepEqual(hub.launchDue(l.startAt!), [l]);
  assert.deepEqual(hub.launchDue(l.startAt! + 1000), [], "uma vez só");
  // Marcado, não expira; correndo, também não.
  assert.deepEqual(hub.expire(10 ** 9), []);
  hub.start("A", 20_000);
  hub.running(hub.of("A")!.id, "r2");
  assert.deepEqual(hub.expire(10 ** 9), []);
  hub.runEnded("r2", "derrota", 30_000);
  assert.equal(l.loop, false);
  assert.equal(l.stopped, "derrota");
  assert.equal(l.nextAt, null);
  // Ligar de novo com o grupo pronto já marca a próxima.
  hub.setLoop("A", true, 31_000);
  assert.equal(l.stopped, null);
  assert.equal(l.nextAt, 31_000 + LOBBY.loopDelayMs);
  hub.loopFailed(hub.of("A")!.id, "start_failed", "level");
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
  hub.create("tv1", "R1", "masmorra-40", m("A", 70), 0);
  hub.join("tv1", undefined, m("B", 66));
  assert.deepEqual(hub.setDungeon("B", "masmorra-40"), { ok: false, reason: "not_leader" });
  assert.deepEqual(hub.setDungeon("A", "nada"), { ok: false, reason: "unknown_dungeon" });
  assert.deepEqual(hub.setDungeon("A", "masmorra-110"), { ok: false, reason: "level" });
  assert.equal(hub.setDungeon("A", "masmorra-70").ok, true);
  assert.equal(hub.atTv("tv1")[0]!.dungeon, "masmorra-70");
  hub.start("A", 1);
  assert.deepEqual(hub.setDungeon("A", "masmorra-40"), { ok: false, reason: "in_run" });
});

test("prazo: a sala some sozinha depois de 5 min; a TV removida acaba com a sala", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "masmorra-40", m("A"), 0);
  hub.create("tv2", "R1", "masmorra-40", m("B"), 60_000);
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
  assert.deepEqual(hub.dropTv("tv2").map((l) => l.tv), ["tv2"]);
  assert.equal(hub.of("B"), undefined);
  assert.deepEqual(hub.inRoom("R1"), []);
});

test("largada (26/11/2026): pedida, conta 3 s; quem está na ficha ou num NPC segura; fechar recomeça a contagem", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "masmorra-40", m("A"), 0);
  hub.join("tv1", undefined, m("B"));
  hub.join("tv1", undefined, m("C"));
  // A Bia já estava na ficha antes do pedido.
  assert.equal(hub.setPrep("B", "heroi", 10)?.prep.get("B"), "heroi");
  assert.equal(hub.setPrep("B", "heroi", 11), null, "o mesmo de novo não muda nada");
  assert.deepEqual(hub.requestStart("B", 100), { ok: false, reason: "not_leader" });
  const l = hub.of("A")!;
  assert.equal(hub.requestStart("A", 100).ok, true);
  assert.deepEqual([l.pending, l.pendingAuto, l.startAt, l.heldSince], [true, false, null, 100]);
  assert.deepEqual(hub.launchDue(10 ** 6), [], "ninguém larga com a Bia na ficha");
  assert.deepEqual(hub.expire(10 ** 7), [], "largada pendente não expira");
  // O Caio abre o Ferreiro; a Bia fecha: ainda segura.
  hub.setPrep("C", "ferreiro", 200);
  hub.setPrep("B", null, 300);
  assert.equal(l.startAt, null);
  hub.setPrep("C", null, 400);
  assert.deepEqual([l.startAt, l.heldSince], [400 + LOBBY.countdownMs, null]);
  // Abriu de novo no meio da contagem: para; fechou: conta 3 s do zero.
  hub.setPrep("B", "mestre", 1000);
  assert.equal(l.startAt, null);
  hub.setPrep("B", null, 2000);
  assert.equal(l.startAt, 2000 + LOBBY.countdownMs);
  assert.equal(hub.requestStart("A", 2500).ok, true, "pedir de novo não reinicia a contagem");
  assert.equal(l.startAt, 2000 + LOBBY.countdownMs);
  assert.deepEqual(hub.launchDue(2000 + LOBBY.countdownMs), [l]);
  // Com a largada entregue, abrir a ficha não volta atrás (o serviço já está lendo os heróis).
  hub.setPrep("B", "heroi", 5001);
  assert.equal(l.launching, true);
  assert.equal(hub.start("A", 5002).ok, true);
  assert.deepEqual([l.state, l.pending, l.launching, l.startAt], ["running", false, false, null]);
  // Durante a corrida a ficha aberta fica anotada e segura a próxima.
  hub.running(l.id, "r1");
  hub.setLoop("A", true, 5003);
  hub.runEnded("r1", "vitoria", 9000);
  assert.deepEqual(hub.loopDue(9000 + LOBBY.loopDelayMs), [l]);
  assert.equal(l.startAt, null, "a Bia ainda está na ficha");
  assert.deepEqual(
    lobbyViewOf(hub, "A").prep,
    [{ user_id: "B", what: "heroi" }],
  );
  hub.setPrep("B", null, 30_000);
  assert.equal(lobbyViewOf(hub, "A").start_at, 30_000 + LOBBY.countdownMs);
  assert.equal(lobbyViewOf(hub, "A").pending, true);
});

test("largada: o líder desiste (o loop desliga); desligar o loop na contagem desiste dela; o líder saindo também", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "masmorra-40", m("A"), 0);
  hub.join("tv1", undefined, m("B"));
  const l = hub.of("A")!;
  assert.deepEqual(hub.cancelStart("A", 1), { ok: false, reason: "no_start" });
  hub.requestStart("A", 10);
  assert.deepEqual(hub.cancelStart("B", 11), { ok: false, reason: "not_leader" });
  assert.equal(hub.cancelStart("A", 12).ok, true);
  assert.deepEqual([l.pending, l.startAt, l.expiresAt], [false, null, 12 + LOBBY.ttlMs]);
  // Loop ligado e a largada do loop contando: desligar o loop desiste dela.
  hub.start("A", 20);
  hub.running(l.id, "r1");
  hub.setLoop("A", true, 21);
  hub.runEnded("r1", "vitoria", 100);
  hub.loopDue(100 + LOBBY.loopDelayMs);
  assert.equal(l.pending, true);
  hub.setLoop("A", false, 100 + LOBBY.loopDelayMs + 1);
  assert.deepEqual([l.pending, l.startAt, l.nextAt], [false, null, null]);
  // O líder sai no meio da largada: ela desiste (o novo líder decide).
  hub.requestStart("A", 50_000);
  hub.leave("A", 50_001);
  assert.deepEqual([l.leader, l.pending, l.stopped], ["B", false, "leader_left"]);
});

test("largada: quem esquece a ficha aberta não prende o grupo para sempre (desiste em 5 min e diz quem)", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "masmorra-40", m("A"), 0);
  hub.join("tv1", undefined, { ...m("B"), name: "Bia" });
  const l = hub.of("A")!;
  hub.setPrep("B", "banqueiro", 0);
  hub.requestStart("A", 1000);
  assert.deepEqual(hub.holdTimeouts(1000 + LOBBY.prepHoldMaxMs - 1), []);
  assert.deepEqual(hub.holdTimeouts(1000 + LOBBY.prepHoldMaxMs), [l]);
  assert.deepEqual([l.pending, l.stopped, l.stoppedDetail], [false, "prep", "Bia"]);
  // Quem sai do grupo deixa de segurar.
  hub.requestStart("A", 400_000);
  assert.equal(l.startAt, null);
  hub.leave("B", 400_100);
  assert.equal(l.startAt, 400_100 + LOBBY.countdownMs);
});

function lobbyViewOf(hub: LobbyHub, user: string) {
  return lobbyView(hub.of(user)!);
}

test("Chefe de Região: só entra quem concluiu o resto da região, e a troca de DG cobra todos (26/11/2026)", () => {
  const hub = new LobbyHub();
  const done = (id: string): RpgLobbyMember => ({ ...m(id, 50), regions: [1] });
  assert.deepEqual(hub.create("tv1", "R1", "regiao-1", m("A", 50), 0), {
    ok: false,
    reason: "region",
  });
  // A região 2 concluída não abre o chefe da 1.
  assert.deepEqual(
    hub.create("tv1", "R1", "regiao-1", { ...m("A", 50), regions: [2] }, 0),
    { ok: false, reason: "region" },
  );
  const l = hub.create("tv1", "R1", "regiao-1", done("A"), 0);
  assert.equal(l.ok, true);
  assert.deepEqual(hub.join("tv1", undefined, m("B", 50)), {
    ok: false,
    reason: "region",
  });
  assert.equal(hub.join("tv1", undefined, done("C")).ok, true);
  // Num grupo de outra DG, trocar para o chefe pede a região de todos.
  assert.equal(hub.create("tv2", "R1", "masmorra-40", done("D"), 0).ok, true);
  assert.equal(hub.join("tv2", undefined, m("E", 50)).ok, true);
  assert.deepEqual(hub.setDungeon("D", "regiao-1"), {
    ok: false,
    reason: "region",
  });
  hub.leave("E");
  assert.equal(hub.setDungeon("D", "regiao-1").ok, true);
  // As outras DGs não olham a região.
  assert.equal(hub.setDungeon("D", "cacada-40").ok, true);
});

// 27/11/2026, o dono: "é importante que nenhum grupo se perca pra seguir na DG pós-deploy".
test("reinício: o snapshot volta com o mesmo grupo, a corrida rodando e o loop; o fim marca a próxima", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "masmorra-40", m("A"), 0);
  hub.join("tv1", undefined, m("B"));
  hub.join("tv1", undefined, m("C", 41, "padre"));
  hub.setLoop("A", true, 10);
  hub.start("A", 20);
  const id = hub.of("A")!.id;
  hub.running(id, "run-1");
  const saved = JSON.parse(JSON.stringify(hub.snapshot()));

  const next = new LobbyHub();
  const back = next.restore(saved, new Set(["run-1"]), 5000);
  assert.equal(back.length, 1);
  const l = next.of("B")!;
  assert.equal(l.id, id);
  assert.deepEqual(l.members.map((x) => x.user_id), ["A", "B", "C"]);
  assert.equal(l.state, "running");
  assert.equal(l.runId, "run-1");
  assert.equal(l.loop, true);
  assert.equal(l.prep.size, 0);
  // A corrida que voltou fecha em vitória: o loop marca a próxima, como antes do reinício.
  const ended = next.runEnded("run-1", "vitoria", 9000)!;
  assert.equal(ended.state, "ready");
  assert.equal(ended.nextAt, 9000 + LOBBY.loopDelayMs);
});

test("reinício: grupo rodando cuja corrida não voltou fica pronto (loop marcado); lixo do banco não entra", () => {
  const hub = new LobbyHub();
  hub.create("tv1", "R1", "cacada-40", m("A"), 0);
  hub.setLoop("A", true, 1);
  hub.start("A", 2);
  hub.running(hub.of("A")!.id, "run-x");
  const next = new LobbyHub();
  const [l] = next.restore(
    [...hub.snapshot(), { id: "x" }, null, "lixo"],
    new Set(),
    7000,
  );
  assert.equal(next.all().length, 1);
  assert.equal(l!.state, "ready");
  assert.equal(l!.runId, null);
  assert.equal(l!.nextAt, 7000 + LOBBY.loopDelayMs);
  // Quem já está noutro grupo não entra de novo.
  const again = next.restore(hub.snapshot(), new Set(), 8000);
  assert.equal(again.length, 0);
});

test("reinício sem snapshot: a corrida em andamento refaz o grupo (o primeiro como líder, loop do auto)", () => {
  const hub = new LobbyHub();
  const run = {
    id: "run-9",
    tv: "tv2",
    room: "R2",
    dungeon: "masmorra-60",
    members: [m("A", 60), m("B", 61, "padre"), m("C", 62, "mago")],
    auto: true,
  };
  const l = hub.adopt(run, 1000)!;
  assert.equal(l.state, "running");
  assert.equal(l.leader, "A");
  assert.equal(l.loop, true);
  assert.equal(hub.of("C")!.id, l.id);
  assert.equal(hub.adopt(run, 1001), null, "a mesma corrida não refaz outro grupo");
  const ended = hub.runEnded("run-9", "vitoria", 5000)!;
  assert.equal(ended.nextAt, 5000 + LOBBY.loopDelayMs);
  // Corrida largada à mão (sem auto): o grupo volta sem o loop; DG que sumiu não refaz.
  const h2 = new LobbyHub();
  assert.equal(h2.adopt({ ...run, id: "r2", auto: false }, 0)!.loop, false);
  assert.equal(h2.adopt({ ...run, id: "r3", dungeon: "nao-existe", members: [m("Z")] }, 0), null);
  // A vitória do loop que acabou de fechar (o grupo estava no intervalo): volta pronto, a próxima
  // marcada; quem já voltou noutro grupo (por uma corrida em andamento) fica de fora.
  const h3 = new LobbyHub();
  h3.adopt({ ...run, id: "r4", members: [m("C", 62, "mago")] }, 0);
  const between = h3.adopt({ ...run, id: "r5", ended: true }, 2000)!;
  assert.equal(between.state, "ready");
  assert.equal(between.runId, null);
  assert.equal(between.loop, true);
  assert.equal(between.nextAt, 2000 + LOBBY.loopDelayMs);
  assert.equal(between.last, "vitoria");
  assert.deepEqual(between.members.map((x) => x.user_id), ["A", "B"]);
  assert.equal(h3.of("C")!.runId, "r4");
});
