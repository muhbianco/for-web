import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type DecorInstance,
  CATALOG,
  instanceRect,
  itemOf,
  Perm,
  roomZoneKey,
  tileCenter,
} from "@muchat/space-core";

import { silentLog } from "../log.ts";
import { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatUser } from "../stoat/types.ts";
import { MemoryDecorStore } from "./decorStore.ts";
import { type SessionPort, type Viewer, SpaceRuntime } from "./runtime.ts";
import { MemoryAssignmentStore } from "./store.ts";

const SRV = "01JSRV00000000000000000000";
const PUB = "01JPVB00000000000000000000";
const DUO = "01JDV000000000000000000000";
const ANA = "01JANA00000000000000000000"; // owner
const n = (b: bigint) => Number(b);
// A migrated server (ADR 0008): @everyone may use objects and control the TV.
const DEFAULT =
  Perm.ViewChannel |
  Perm.ReadMessageHistory |
  Perm.SendMessage |
  Perm.Connect |
  Perm.Speak |
  Perm.Listen |
  Perm.InteractSpaceObjects |
  Perm.ControlSpaceTv;

function makeCache(): StoatCache {
  const cache = new StoatCache();
  cache.apply({
    type: "Ready",
    servers: [
      {
        _id: SRV,
        owner: ANA,
        name: "Piloto",
        channels: [PUB, DUO],
        default_permissions: n(DEFAULT),
        roles: {
          MOD: { name: "Moderação", rank: 1, permissions: { a: 0, d: 0 } },
          // Decorates everywhere except where a room says otherwise.
          DEC: {
            name: "Decoração",
            rank: 2,
            permissions: { a: n(Perm.DecorateSpace), d: 0 },
          },
          CFG: {
            name: "Configura",
            rank: 3,
            permissions: {
              a: n(Perm.DecorateSpace | Perm.ConfigureSpaceObjects),
              d: 0,
            },
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
        _id: DUO,
        server: SRV,
        name: "Duo",
        voice: { max_users: 2 },
        // The Duo room takes decorating away from DEC (a channel override).
        role_permissions: { DEC: { a: 0, d: n(Perm.DecorateSpace) } },
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
  pos = { x: 0, y: 0 };
  seq = 0;
  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }
  send(e: Record<string, unknown>) {
    this.events.push(e);
    if (e.t === "space.snapshot") {
      const you = (e.d as { you: { x: number; y: number; seq: number } }).you;
      this.pos = { x: you.x, y: you.y };
      this.seq = you.seq;
    }
    if (e.t === "avatar.correction") {
      const d = e.d as { x: number; y: number };
      this.pos = { x: d.x, y: d.y };
    }
  }
  close() {}
  of(t: string) {
    return this.events.filter((e) => e.t === t);
  }
  last(t: string) {
    return this.of(t).at(-1);
  }
  errorsFor(re: string) {
    return this.events
      .filter((e) => e.t === "error" && e.re === re)
      .map((e) => e.d as { code: string; reason?: string });
  }
}

async function space(store = new MemoryDecorStore()) {
  const rt = new SpaceRuntime({
    serverId: SRV,
    cache: makeCache(),
    store: new MemoryAssignmentStore(),
    decorStore: store,
    log: silentLog,
  });
  await rt.init();
  return { rt, store };
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

/** Runs a command and waits for the queue to drain. */
async function run(
  rt: SpaceRuntime,
  s: FakeSession,
  id: string,
  cmd: Parameters<SpaceRuntime["decorCommand"]>[2],
) {
  rt.decorCommand(s, id, cmd);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const inst = (
  id: string,
  item: string,
  zone: string,
  x: number,
  y: number,
  extra: Partial<DecorInstance> = {},
): DecorInstance => ({
  id,
  item,
  zone,
  x,
  y,
  rot: 0,
  ...extra,
});

/** Põe um dummy ao lado do spawn da Ana (primeira posição livre em volta). */
async function placeDummy(rt: SpaceRuntime, ana: FakeSession, id: string) {
  const spawn = rt.map.spawns[0]!;
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
  ] as const) {
    const cmdId = `place-${id}-${dx}-${dy}`;
    await run(rt, ana, cmdId, {
      kind: "place",
      item: inst(
        id,
        "dummy-wood",
        "hall",
        spawn.tx + dx - rt.map.hall.x0,
        spawn.ty + dy - rt.map.hall.y0,
      ),
    });
    if (ana.errorsFor(cmdId).length === 0)
      return { tx: spawn.tx + dx, ty: spawn.ty + dy };
  }
  throw new Error("no free tile next to the spawn");
}

type Internals = {
  place: (a: unknown, p: { x: number; y: number }, room: string | null) => void;
  avatars: Map<string, unknown>;
};
const moveTo = (rt: SpaceRuntime, userId: string, tx: number, ty: number) =>
  (rt as unknown as Internals).place(
    (rt as unknown as Internals).avatars.get(userId),
    tileCenter({ tx, ty }),
    null,
  );

test("dummy: ao lado treina, longe não; só item de treino; o servidor confere a distância", async () => {
  const { rt } = await space();
  const ana = enter(rt, ANA, "Ana");
  const dummy = await placeDummy(rt, ana, "dummy-1");
  assert.deepEqual(rt.trainSpot(ana.viewer, "dummy-1"), {
    ok: true,
    zone: "hall",
  });
  assert.deepEqual(rt.trainSpot(ana.viewer, "nada"), {
    ok: false,
    code: "not_found",
  });
  // Um item que não é de treino não serve.
  const plain = rt.decorState.items.find(
    (i) => i.zone === "hall" && i.item !== "dummy-wood",
  )!;
  assert.deepEqual(rt.trainSpot(ana.viewer, plain.id), {
    ok: false,
    code: "not_found",
  });
  // Longe (5 tiles): recusado pela distância.
  moveTo(rt, ANA, dummy.tx + 5, dummy.ty);
  assert.deepEqual(rt.trainSpot(ana.viewer, "dummy-1"), {
    ok: false,
    code: "not_allowed",
    reason: "too_far",
  });
});

test("dummy: sair de perto, ser tirado do Espaço ou o dummy sumir encerram o treino", async () => {
  const { rt } = await space();
  const left: string[] = [];
  rt.onTrainingLeft = (userId) => left.push(userId);
  const ana = enter(rt, ANA, "Ana");
  const dummy = await placeDummy(rt, ana, "dummy-1");
  rt.setTraining(ANA, "dummy-1");
  // Andar em volta do dummy (dentro de 1 tile) não encerra.
  moveTo(rt, ANA, dummy.tx, dummy.ty + 1);
  assert.deepEqual(left, []);
  assert.ok(rt.isTrainingAt(ANA, "dummy-1"));
  // Afastar encerra uma vez.
  moveTo(rt, ANA, dummy.tx + 4, dummy.ty);
  moveTo(rt, ANA, dummy.tx + 5, dummy.ty);
  assert.deepEqual(left, [ANA]);
  assert.equal(rt.isTrainingAt(ANA, "dummy-1"), false);
  // O dummy removido pelo editor encerra quem treinava nele.
  moveTo(rt, ANA, dummy.tx, dummy.ty + 1);
  rt.setTraining(ANA, "dummy-1");
  await run(rt, ana, "rm", { kind: "remove", id: "dummy-1" });
  assert.deepEqual(left, [ANA, ANA]);
  // Tirado do Espaço (sessão do Stoat acabou) encerra.
  await placeDummy(rt, ana, "dummy-2");
  rt.setTraining(ANA, "dummy-2");
  rt.evict(ANA);
  assert.deepEqual(left, [ANA, ANA, ANA]);
});

test("dummy: desconectar não encerra (segue como o treino offline); reconectar longe encerra", async () => {
  const { rt } = await space();
  const left: string[] = [];
  rt.onTrainingLeft = (userId) => left.push(userId);
  const ana = enter(rt, ANA, "Ana");
  const dummy = await placeDummy(rt, ana, "dummy-1");
  moveTo(rt, ANA, dummy.tx, dummy.ty + 1);
  rt.setTraining(ANA, "dummy-1");
  rt.leave(ana);
  assert.deepEqual(left, []);
  // Volta dentro da tolerância, no mesmo lugar: continua treinando.
  enter(rt, ANA, "Ana");
  assert.deepEqual(left, []);
  // Longe dali, a próxima reentrada encerra.
  moveTo(rt, ANA, dummy.tx + 6, dummy.ty);
  assert.deepEqual(left, [ANA]);
});

test("herói no avatar: level e treino chegam aos outros; quem entra com o jogo ligado é anunciado", async () => {
  const rt = new SpaceRuntime({
    serverId: SRV,
    cache: makeCache(),
    store: new MemoryAssignmentStore(),
    decorStore: new MemoryDecorStore(),
    log: silentLog,
    gameAvailable: true,
  });
  await rt.init();
  const joined: string[] = [];
  rt.onAvatarJoined = (userId) => joined.push(userId);
  const ana = enter(rt, ANA, "Ana");
  assert.deepEqual(joined, [ANA]);
  const cai = enter(rt, "01JCA100000000000000000000", "Cai");
  rt.tick();
  rt.setHeroLevel(ANA, 7);
  rt.tick();
  const seen = () =>
    (
      cai.last("avatar.positions")?.d as {
        avatars: Array<{
          user_id: string;
          hero?: { level: number; training: boolean };
        }>;
      }
    ).avatars.find((a) => a.user_id === ANA)?.hero;
  assert.deepEqual(seen(), { level: 7, training: false });
  const dummy = await placeDummy(rt, ana, "dummy-1");
  moveTo(rt, ANA, dummy.tx, dummy.ty + 1);
  rt.setTraining(ANA, "dummy-1");
  rt.tick();
  assert.deepEqual(seen(), { level: 7, training: true });
  // Afastou: o "treinando" some para os outros.
  moveTo(rt, ANA, dummy.tx + 5, dummy.ty);
  rt.tick();
  assert.deepEqual(seen(), { level: 7, training: false });
});

type RtInternals = {
  avatars: Map<string, unknown>;
  zones: { byKey: Map<string, import("@muchat/space-core").Zone> };
  place: (
    a: unknown,
    pos: { x: number; y: number },
    room: string | null,
  ) => void;
};

/** A TV que o tema pôs na sala aberta e um tile ao lado dela, dentro da sala. */
function tvOfPub(rt: SpaceRuntime) {
  const inst = rt.decorState.items.find(
    (i) =>
      i.zone === roomZoneKey(PUB) &&
      itemOf(CATALOG, i.item)?.interaction === "tv",
  )!;
  const zone = (rt as unknown as RtInternals).zones.byKey.get(inst.zone)!;
  const rect = instanceRect(zone, itemOf(CATALOG, inst.item)!, inst);
  return { id: inst.id, beside: { tx: rect.x0, ty: rect.y1 + 1 } };
}

function placeAt(
  rt: SpaceRuntime,
  userId: string,
  tile: { tx: number; ty: number },
  room: string | null,
) {
  const i = rt as unknown as RtInternals;
  i.place(i.avatars.get(userId), tileCenter(tile), room);
}

const lobbyEvents = (s: FakeSession) =>
  s.of("rpg.lobby").map(
    (e) =>
      e.d as {
        tv: string;
        lobby: { members: Array<{ user_id: string }> } | null;
        ended?: string;
      },
  );
const lobbyMember = (id: string, name: string) => ({
  user_id: id,
  name,
  vocation: 4 as const,
  level: 5,
});

test("grupo na TV: ao lado e dentro da sala; quem está na sala vê; sair da sala ou desconectar tira do grupo", async () => {
  let now = 1_000;
  const rt = new SpaceRuntime({
    serverId: SRV,
    cache: makeCache(),
    store: new MemoryAssignmentStore(),
    decorStore: new MemoryDecorStore(),
    log: silentLog,
    now: () => now,
  });
  await rt.init();
  const ana = enter(rt, ANA, "Ana");
  const bia = enter(rt, "01JB1A00000000000000000000", "Bia");
  const cai = enter(rt, "01JCA100000000000000000000", "Cai");
  const tv = tvOfPub(rt);
  // Fora da sala: longe.
  assert.deepEqual(rt.tvSpot(ana.viewer, tv.id), {
    ok: false,
    code: "not_allowed",
    reason: "too_far",
  });
  placeAt(rt, ANA, tv.beside, PUB);
  assert.deepEqual(rt.tvSpot(ana.viewer, tv.id), { ok: true, room: PUB });
  assert.deepEqual(rt.tvSpot(ana.viewer, "nada"), {
    ok: false,
    code: "not_found",
  });
  // Bia já está na sala quando Ana cria: recebe; Cai (fora) não.
  placeAt(rt, "01JB1A00000000000000000000", tv.beside, PUB);
  assert.equal(
    rt.lobbyCreate(tv.id, PUB, "cripta-do-musgo", lobbyMember(ANA, "Ana")).ok,
    true,
  );
  assert.equal(lobbyEvents(bia).at(-1)?.lobby?.members.length, 1);
  assert.equal(lobbyEvents(cai).length, 0);
  // Cai entra na sala: recebe o grupo que já existe.
  placeAt(rt, "01JCA100000000000000000000", tv.beside, PUB);
  assert.equal(lobbyEvents(cai).at(-1)?.tv, tv.id);
  // Bia entra e depois sai da sala: sai do grupo, e quem fica vê.
  assert.equal(
    rt.lobbyJoin(tv.id, lobbyMember("01JB1A00000000000000000000", "Bia")).ok,
    true,
  );
  assert.equal(lobbyEvents(ana).at(-1)?.lobby?.members.length, 2);
  placeAt(rt, "01JB1A00000000000000000000", rt.map.spawns[0]!, null);
  assert.equal(rt.lobbies.of("01JB1A00000000000000000000"), undefined);
  assert.deepEqual(
    lobbyEvents(ana)
      .at(-1)
      ?.lobby?.members.map((m) => m.user_id),
    [ANA],
  );
  // A líder desconecta: o grupo é cancelado para quem está na sala.
  rt.leave(ana);
  assert.equal(rt.lobbies.get(tv.id), undefined);
  assert.equal(lobbyEvents(cai).at(-1)?.ended, "cancelled");
  // Prazo: Cai cria, ninguém começa, o tick depois de 5 min encerra.
  assert.equal(
    rt.lobbyCreate(
      tv.id,
      PUB,
      "cripta-do-musgo",
      lobbyMember("01JCA100000000000000000000", "Cai"),
    ).ok,
    true,
  );
  now += 5 * 60 * 1000;
  rt.tick();
  assert.equal(rt.lobbies.get(tv.id), undefined);
  assert.equal(lobbyEvents(cai).at(-1)?.ended, "expired");
});
