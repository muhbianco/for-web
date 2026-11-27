import assert from "node:assert/strict";
import { test } from "node:test";

import { Perm } from "@muchat/space-core";

import { silentLog } from "../log.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { MemoryDecorStore } from "./decorStore.ts";
import { type SessionPort, type Viewer, SpaceRuntime } from "./runtime.ts";
import { MemoryAssignmentStore } from "./store.ts";

/**
 * Mover alguém de sala arrastando na barra lateral (27/11/2026): o moderador (MoveMembers) leva a
 * pessoa para dentro da sala, a chamada dela vai junto (place → media), e a sala privada continua
 * privada para quem não pode entrar.
 */

const SRV = "01JSRV00000000000000000000";
const PUB = "01JPVB00000000000000000000";
const PRV = "01JPRV00000000000000000000";
const ANA = "01JANA00000000000000000000"; // dona
const BIA = "01JB1A00000000000000000000"; // MOD: pode mover
const CAI = "01JCA100000000000000000000"; // membro comum
const n = (b: bigint) => Number(b);
const DEFAULT =
  Perm.ViewChannel |
  Perm.ReadMessageHistory |
  Perm.SendMessage |
  Perm.Connect |
  Perm.Speak |
  Perm.Listen;

function makeCache(): StoatCache {
  const cache = new StoatCache();
  cache.apply({
    type: "Ready",
    servers: [
      {
        _id: SRV,
        owner: ANA,
        name: "Piloto",
        channels: [PUB, PRV],
        default_permissions: n(DEFAULT),
        roles: {
          MOD: {
            name: "Moderação",
            rank: 1,
            permissions: { a: n(Perm.MoveMembers), d: 0 },
          },
        },
      },
    ],
    channels: [
      {
        channel_type: "TextChannel",
        _id: PUB,
        server: SRV,
        name: "Sala Aberta",
        voice: { max_users: 8 },
      },
      {
        channel_type: "TextChannel",
        _id: PRV,
        server: SRV,
        name: "Diretoria",
        voice: { max_users: 8 },
        // Fechada para @everyone; a Moderação vê e entra.
        default_permissions: { a: 0, d: n(Perm.ViewChannel | Perm.Connect) },
        role_permissions: {
          MOD: { a: n(Perm.ViewChannel | Perm.Connect), d: 0 },
        },
      },
    ],
  });
  return cache;
}

const user = (id: string, name: string): StoatUser => ({
  _id: id,
  username: name.toLowerCase(),
  display_name: name,
});
const member = (id: string, roles: string[] = []): StoatMember => ({
  _id: { server: SRV, user: id },
  roles,
});

class FakeSession implements SessionPort {
  readonly events: Array<Record<string, unknown>> = [];
  readonly viewer: Viewer;
  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }
  send(e: Record<string, unknown>) {
    this.events.push(e);
  }
  close() {}
  last(t: string) {
    return [...this.events].reverse().find((e) => e.t === t);
  }
  errorsFor(id: string) {
    return this.events
      .filter((e) => e.t === "error" && e.re === id)
      .map((e) => e.d);
  }
}

async function space() {
  const rt = new SpaceRuntime({
    serverId: SRV,
    cache: makeCache(),
    store: new MemoryAssignmentStore(),
    decorStore: new MemoryDecorStore(),
    log: silentLog,
  });
  await rt.init();
  return rt;
}

function enter(
  rt: SpaceRuntime,
  id: string,
  name: string,
  roles: string[] = [],
) {
  const s = new FakeSession({
    user: user(id, name),
    member: member(id, roles),
  });
  rt.join(s);
  return s;
}

/** A sessão só de olhar (a da barra lateral): tem quem é, não tem avatar. */
const watcher = (id: string, name: string, roles: string[] = []) =>
  new FakeSession({ user: user(id, name), member: member(id, roles) });

const roomOf = (s: FakeSession) =>
  (s.last("avatar.correction")?.d as { room?: string | null } | undefined)
    ?.room;

test("quem pode mover leva a pessoa para dentro da sala; ela fica sabendo quem levou", async () => {
  const rt = await space();
  const bia = enter(rt, BIA, "Bia", ["MOD"]);
  const cai = enter(rt, CAI, "Cai");
  rt.moveMember(bia, "m1", CAI, PUB);
  assert.deepEqual(bia.errorsFor("m1"), []);
  assert.deepEqual(bia.last("member.move.ok")?.d, {
    user_id: CAI,
    room_id: PUB,
  });
  assert.equal(roomOf(cai), PUB);
  const moved = cai.last("member.moved")?.d as {
    room_id: string;
    by: string;
    by_name: string;
  };
  assert.equal(moved.room_id, PUB);
  assert.equal(moved.by, BIA);
  assert.equal(moved.by_name, "Bia");
  // De novo para a mesma sala: ok, sem mexer em ninguém.
  const before = cai.events.length;
  rt.moveMember(bia, "m2", CAI, PUB);
  assert.equal(bia.last("member.move.ok")?.re, "m2");
  assert.equal(cai.events.length, before);
});

test("sem MoveMembers, não move ninguém", async () => {
  const rt = await space();
  const bia = enter(rt, BIA, "Bia", ["MOD"]);
  const cai = enter(rt, CAI, "Cai");
  rt.moveMember(cai, "m1", BIA, PUB);
  assert.deepEqual(cai.errorsFor("m1"), [{ code: "not_allowed" }]);
  assert.equal(bia.last("member.moved"), undefined);
});

test("sala privada continua privada: não dá para levar quem não pode entrar", async () => {
  const rt = await space();
  const bia = enter(rt, BIA, "Bia", ["MOD"]);
  const cai = enter(rt, CAI, "Cai");
  const ana = enter(rt, ANA, "Ana");
  rt.moveMember(bia, "m1", CAI, PRV);
  assert.deepEqual(bia.errorsFor("m1"), [
    { code: "not_allowed", reason: "no_access" },
  ]);
  assert.notEqual(roomOf(cai), PRV);
  // A dona entra em qualquer sala.
  rt.moveMember(bia, "m2", ANA, PRV);
  assert.deepEqual(bia.errorsFor("m2"), []);
  assert.equal(roomOf(ana), PRV);
});

test("a barra lateral (sessão só de olhar, sem avatar) também move", async () => {
  const rt = await space();
  const cai = enter(rt, CAI, "Cai");
  const sidebar = watcher(BIA, "Bia", ["MOD"]);
  rt.moveMember(sidebar, "m1", CAI, PUB);
  assert.deepEqual(sidebar.errorsFor("m1"), []);
  assert.equal(roomOf(cai), PUB);
});

test("pedidos sem sentido: a si mesmo, sala ou pessoa que não existe", async () => {
  const rt = await space();
  const bia = enter(rt, BIA, "Bia", ["MOD"]);
  rt.moveMember(bia, "m1", BIA, PUB);
  assert.deepEqual(bia.errorsFor("m1"), [
    { code: "invalid_message", reason: "self" },
  ]);
  rt.moveMember(bia, "m2", CAI, PUB);
  assert.deepEqual(bia.errorsFor("m2"), [{ code: "not_found" }]);
  enter(rt, CAI, "Cai");
  rt.moveMember(bia, "m3", CAI, "01JNOPE0000000000000000000");
  assert.deepEqual(bia.errorsFor("m3"), [
    { code: "not_found", reason: "unknown_room" },
  ]);
});
