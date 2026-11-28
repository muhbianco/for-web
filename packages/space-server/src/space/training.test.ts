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
import { type SessionPort, type Viewer, RESTORED_GRACE_MS, SpaceRuntime } from "./runtime.ts";
import { MemorySpotStore } from "./spotStore.ts";
import { MemoryAssignmentStore } from "./store.ts";
import { MemoryRunStore } from "../game/ot/runs.ts";
import { RpgService } from "../game/ot/service.ts";
import { MemoryRpgStore } from "../game/ot/store.ts";

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
async function placeDummy(
  rt: SpaceRuntime,
  ana: FakeSession,
  id: string,
  item = "dummy-wood",
) {
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
        item,
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
  // Andar em volta do dummy e se afastar até 5 tiles, na mesma zona, não encerra.
  moveTo(rt, ANA, dummy.tx, dummy.ty + 1);
  moveTo(rt, ANA, dummy.tx + 4, dummy.ty);
  moveTo(rt, ANA, dummy.tx + 5, dummy.ty);
  assert.deepEqual(left, []);
  assert.ok(rt.isTrainingAt(ANA, "dummy-1"));
  // Mais longe encerra uma vez.
  moveTo(rt, ANA, dummy.tx + 6, dummy.ty);
  moveTo(rt, ANA, dummy.tx + 7, dummy.ty);
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

test("Dojô: o bônus é a média dos colegas no tempo, e quem sai de perto leva o seu (28/11/2026)", async () => {
  // Antes o bônus era a foto de quem treinava na hora de parar: quem saía de perto já não constava
  // (o runtime apagava o treino antes de avisar) e levava +0%, assim como o último a parar.
  const BIA = "01JBIA00000000000000000000";
  let now = 1_000_000;
  const rt = new SpaceRuntime({
    serverId: SRV,
    cache: makeCache(),
    store: new MemoryAssignmentStore(),
    decorStore: new MemoryDecorStore(),
    log: silentLog,
    now: () => now,
  });
  await rt.init();
  const left: [string, number][] = [];
  rt.onTrainingLeft = (u) => left.push([u, rt.trainingPeers(u)]);
  const ana = enter(rt, ANA, "Ana");
  enter(rt, BIA, "Bia");
  const dummy = await placeDummy(rt, ana, "dummy-1");
  moveTo(rt, ANA, dummy.tx, dummy.ty + 1);
  rt.setTraining(ANA, "dummy-1");
  now += 100_000; // 100 s sozinha
  rt.setTraining(BIA, "dummy-1");
  now += 100_000; // 100 s com a Bia
  assert.equal(rt.trainingPeers(ANA), 0.5);
  // A Ana sai de perto: o crédito dela ainda conta os 100 s com a Bia.
  for (const dx of [4, 5, 6, 7]) moveTo(rt, ANA, dummy.tx + dx, dummy.ty);
  assert.deepEqual(left, [[ANA, 0.5]]);
  // Lido uma vez: depois não há treino nem crédito pendente.
  assert.equal(rt.trainingPeers(ANA), 0);
  // A Bia treinou 100 s com a Ana; mais 100 s sozinha: média 0,5.
  now += 100_000;
  assert.equal(rt.trainingPeers(BIA), 0.5);
  // Recomeçar no mesmo boneco não zera a conta da sessão.
  rt.setTraining(BIA, "dummy-1");
  assert.equal(rt.trainingPeers(BIA), 0.5);
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
  moveTo(rt, ANA, dummy.tx + 7, dummy.ty);
  assert.deepEqual(left, [ANA]);
});

test("reinício: cada um volta ao mesmo lugar e quem treinava volta treinando ao lado do dummy", async () => {
  const BIA = "01JBIA00000000000000000000";
  const decor = new MemoryDecorStore();
  const spots = new MemorySpotStore();
  let now = 5_000_000;
  const boot = async () => {
    const rt = new SpaceRuntime({
      serverId: SRV,
      cache: makeCache(),
      store: new MemoryAssignmentStore(),
      decorStore: decor,
      spotStore: spots,
      log: silentLog,
      now: () => now,
    });
    await rt.init();
    return rt;
  };
  const rt1 = await boot();
  const ana = enter(rt1, ANA, "Ana");
  const dummy = await placeDummy(rt1, ana, "dummy-1");
  moveTo(rt1, ANA, dummy.tx, dummy.ty + 1);
  rt1.setTraining(ANA, "dummy-1");
  enter(rt1, BIA, "Bia");
  const internals = rt1 as unknown as Internals & {
    nearestFree: (t: { tx: number; ty: number }, room: string | null) => { x: number; y: number } | null;
  };
  const spawn = rt1.map.spawns[0]!;
  const biaAt = internals.nearestFree({ tx: spawn.tx + 6, ty: spawn.ty + 2 }, null)!;
  internals.place(internals.avatars.get(BIA), biaAt, null);
  const anaAt = tileCenter({ tx: dummy.tx, ty: dummy.ty + 1 });
  assert.equal(await rt1.saveSpots(), 2);

  // O processo novo: Bia entra primeiro (o spawn seria outro) e Ana depois.
  now += 60_000;
  const rt2 = await boot();
  const bia2 = enter(rt2, BIA, "Bia");
  const ana2 = enter(rt2, ANA, "Ana");
  assert.deepEqual(bia2.pos, biaAt);
  assert.deepEqual(ana2.pos, anaAt);
  assert.ok(rt2.isTrainingAt(ANA, "dummy-1"));
  assert.equal(rt2.trainingOf(BIA), null);
  // O lugar vale uma vez: o documento sai na leitura.
  assert.equal(spots.docs.size, 0);

  // Só o treino conhecido (sem posição): vai para o lado do dummy, treinando.
  await spots.save(SRV, [{ user: ANA, x: null, y: null, room: null, training: "dummy-1" }], now);
  const rt3 = await boot();
  const ana3 = enter(rt3, ANA, "Ana");
  assert.ok(rt3.isTrainingAt(ANA, "dummy-1"));
  const tx = Math.floor(ana3.pos.x / rt3.map.tileSize);
  const ty = Math.floor(ana3.pos.y / rt3.map.tileSize);
  assert.ok(Math.abs(tx - dummy.tx) <= 1 && Math.abs(ty - dummy.ty) <= 1, `ao lado do dummy: ${tx},${ty}`);
  // Dois no mesmo dummy (gravados à mão, sem posição): cada um num quadrado.
  await spots.save(
    SRV,
    [
      { user: ANA, x: null, y: null, room: null, training: "dummy-1" },
      { user: BIA, x: null, y: null, room: null, training: "dummy-1" },
    ],
    now,
  );
  const rt3b = await boot();
  const anaB = enter(rt3b, ANA, "Ana");
  const biaB = enter(rt3b, BIA, "Bia");
  assert.ok(rt3b.isTrainingAt(ANA, "dummy-1") && rt3b.isTrainingAt(BIA, "dummy-1"));
  assert.notDeepEqual(anaB.pos, biaB.pos);

  // Velho demais (mais de 30 min): a entrada normal, sem treino.
  await spots.save(SRV, [{ user: ANA, x: anaAt.x, y: anaAt.y, room: null, training: "dummy-1" }], now);
  now += 31 * 60_000;
  const rt4 = await boot();
  enter(rt4, ANA, "Ana");
  assert.equal(rt4.isTrainingAt(ANA, "dummy-1"), false);

  // Uma sala em que a pessoa não pode mais entrar: entrada normal.
  await spots.save(SRV, [{ user: BIA, x: biaAt.x, y: biaAt.y, room: "01JNADA0000000000000000000", training: null }], now);
  const rt5 = await boot();
  const bia5 = enter(rt5, BIA, "Bia");
  assert.notDeepEqual(bia5.pos, biaAt);
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
  rt.setHero(ANA, {
    level: 7,
    vocation: 4,
    gear: { weapon: "espada-curta", shield: "escudo-de-tabuas" },
  });
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
  assert.deepEqual(seen(), {
    level: 7,
    training: true,
    at: "dummy-1",
    vocation: 4,
    gear: { weapon: "espada-curta", shield: "escudo-de-tabuas" },
  });
  // Afastou demais: o "treinando" some para os outros.
  moveTo(rt, ANA, dummy.tx + 6, dummy.ty);
  moveTo(rt, ANA, dummy.tx + 7, dummy.ty);
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
  cls: "guerreiro" as const,
  level: 40,
});

test("grupo na TV: ao lado e dentro da sala; quem está na sala vê; o grupo segue quem anda e quem cai até o fim da reconexão", async () => {
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
    rt.lobbyCreate(tv.id, PUB, "masmorra-40", lobbyMember(ANA, "Ana")).ok,
    true,
  );
  assert.equal(lobbyEvents(bia).at(-1)?.lobby?.members.length, 1);
  assert.equal(lobbyEvents(cai).length, 0);
  // Cai entra na sala: recebe o grupo que já existe.
  placeAt(rt, "01JCA100000000000000000000", tv.beside, PUB);
  assert.equal(lobbyEvents(cai).at(-1)?.tv, tv.id);
  // Bia entra e depois sai da sala: continua no grupo (24/11/2026) e segue recebendo.
  const BIA = "01JB1A00000000000000000000";
  assert.equal(rt.lobbyJoin(tv.id, undefined, lobbyMember(BIA, "Bia")).ok, true);
  assert.equal(lobbyEvents(ana).at(-1)?.lobby?.members.length, 2);
  placeAt(rt, BIA, rt.map.spawns[0]!, null);
  assert.equal(rt.lobbies.of(BIA)?.tv, tv.id, "andar não tira do grupo");
  const seen = lobbyEvents(bia).length;
  rt.lobbyLoop(ANA, true);
  assert.equal(lobbyEvents(bia).length, seen + 1, "fora da sala, o membro recebe");
  rt.lobbyLoop(ANA, false);
  // A líder desconecta: o grupo espera a reconexão; passado o prazo, Bia lidera.
  rt.leave(ana);
  rt.tick();
  assert.equal(rt.lobbies.atTv(tv.id)[0]?.leader, ANA);
  now += 61_000;
  rt.tick();
  assert.equal(rt.lobbies.atTv(tv.id)[0]?.leader, BIA);
  assert.deepEqual(
    lobbyEvents(bia)
      .at(-1)
      ?.lobby?.members.map((m) => m.user_id),
    [BIA],
  );
  // O loop vencido chama o jogo pelo líder.
  const due: string[] = [];
  rt.onLobbyDue = (leader, at) => due.push(`${leader}@${at}`);
  const l = rt.lobbies.atTv(tv.id)[0]!;
  rt.lobbyStart(BIA);
  rt.lobbyRunning(l.id, "run-1");
  rt.lobbyLoop(BIA, true);
  rt.lobbyRunEnded("run-1", "vitoria", { [BIA]: 9 });
  assert.equal(l.members[0]!.level, 9, "o level de depois da corrida");
  // 26/11/2026: a ficha aberta segura a largada do loop; cair da conexão solta (o app avisa de novo).
  rt.lobbyPrep(BIA, "heroi");
  now += 13_000;
  rt.tick();
  assert.deepEqual(due, [], "a Bia está na ficha");
  assert.equal(l.pending, true);
  now += 60_000;
  rt.tick();
  assert.deepEqual(due, [], "segue esperando");
  rt.leave(bia);
  assert.equal(l.prep.size, 0, "desconectou: não segura mais");
  rt.tick();
  assert.deepEqual(due, [], "a contagem de 3 s começou agora");
  now += 3_000;
  rt.tick();
  assert.deepEqual(due, [`${BIA}@${l.id}`]);
  rt.tick();
  assert.equal(due.length, 1, "uma vez só");
  // A líder desfaz: quem está na sala vê o fim.
  rt.lobbyDisband(BIA);
  assert.equal(rt.lobbies.atTv(tv.id)[0], undefined);
  assert.equal(lobbyEvents(cai).at(-1)?.ended, "cancelled");
  // Prazo: Cai cria, ninguém começa, o tick depois de 5 min encerra.
  assert.equal(
    rt.lobbyCreate(
      tv.id,
      PUB,
      "masmorra-40",
      lobbyMember("01JCA100000000000000000000", "Cai"),
    ).ok,
    true,
  );
  now += 5 * 60 * 1000;
  rt.tick();
  assert.equal(rt.lobbies.atTv(tv.id)[0], undefined);
  assert.equal(lobbyEvents(cai).at(-1)?.ended, "expired");
});

// ------------------------------------------------------------ jogo idle de ponta a ponta (Fase 8)

test("jogo idle de ponta a ponta no runtime real: jogador novo, grupo na TV, Caçada, quadros e fechamento", async () => {
  let now = 1_000_000;
  const rt = new SpaceRuntime({
    serverId: SRV,
    cache: makeCache(),
    store: new MemoryAssignmentStore(),
    decorStore: new MemoryDecorStore(),
    log: silentLog,
    now: () => now,
    gameAvailable: true,
  });
  await rt.init();
  const store = new MemoryRpgStore();
  const runStore = new MemoryRunStore();
  const svc = new RpgService({ store, runStore, log: silentLog, now: () => now, autoTick: false });
  svc.setHosts(() => rt);
  rt.onLobbyDue = (leader, lobbyId, auto) => svc.launchDue(rt, leader, lobbyId, auto);
  const ana = enter(rt, ANA, "Ana");
  const tv = tvOfPub(rt);
  placeAt(rt, ANA, tv.beside, PUB);
  let n = 0;
  const send = async (t: string, d?: Record<string, unknown>) => {
    const id = `e${++n}`;
    svc.handle(ana, rt, { v: 1, id, t, ...(d ? { d } : {}) } as never);
    await svc.idle(ANA);
    return id;
  };
  const hero = () =>
    (ana.last("rpg.state")?.d as { hero: { hero: { level: number; xp: number; gold: number; cls: string } ; run: unknown } | null }).hero;

  await send("rpg.open");
  assert.equal(hero(), null, "jogador novo sem herói");
  const c = await send("rpg.class", { cls: "guerreiro" });
  assert.deepEqual(ana.errorsFor(c), []);
  assert.equal(hero()?.hero.cls, "guerreiro");
  // O avatar mostra o herói (nível sob o nome).
  const create = await send("rpg.lobby.create", { tv: tv.id, dungeon: "cacada-1" });
  assert.deepEqual(ana.errorsFor(create), []);
  const start = await send("rpg.lobby.start");
  assert.deepEqual(ana.errorsFor(start), []);
  // A largada conta 3 s (26/11/2026) e sai pelo tique do runtime.
  assert.equal(ana.last("rpg.run"), undefined);
  now += 3_000;
  rt.tick();
  await svc.idle(ANA);
  const runEv = ana.last("rpg.run")!.d as { run: { id: string; ends_at: number; members: unknown[] } };
  assert.equal(runEv.run.members.length, 1);
  assert.ok(hero()?.run, "o herói está na corrida");
  // Os quadros chegam pela sala (sendRun do runtime).
  now += 5_000;
  await svc.tickRuns();
  const ticks = ana.of("rpg.run.tick");
  assert.ok(ticks.length >= 1);
  // Até o fim: fecha, credita e o grupo fica pronto.
  now = runEv.run.ends_at + 1_000;
  await svc.tickRuns();
  await svc.idle(ANA);
  const end = (ana.last("rpg.run")!.d as { end?: { outcome: string; members: Array<{ reward: { xp: number; gold: number } | null }> } }).end;
  assert.equal(end?.outcome, "vitoria");
  assert.ok(end!.members[0]!.reward!.xp > 0);
  assert.equal(hero()?.run, null);
  assert.ok(hero()!.hero.gold > 0);
  assert.equal(rt.lobbies.of(ANA)?.state, "ready");
  assert.equal(runStore.docs.get(runEv.run.id)?.status, "settled");
});

// 27/11/2026, o dono: "é importante que nenhum grupo se perca pra seguir na DG pós-deploy".
test("reinício: o grupo refeito pela corrida espera quem reconecta; quem não volta sai depois da carência", async () => {
  let now = 1_000_000;
  const BIA = "01JBIA00000000000000000000";
  const rt = new SpaceRuntime({
    serverId: SRV,
    cache: makeCache(),
    store: new MemoryAssignmentStore(),
    decorStore: new MemoryDecorStore(),
    log: silentLog,
    now: () => now,
  });
  await rt.init();
  const adopted = rt.adoptRun({
    id: "run-1",
    tv: "tv-x",
    room: PUB,
    dungeon: "masmorra-40",
    members: [
      { user_id: ANA, name: "Ana", cls: "guerreiro", level: 45 },
      { user_id: BIA, name: "Bia", cls: "padre", level: 44 },
    ],
    auto: true,
  });
  assert.equal(adopted, true);
  // Antes de reconectar, os dois contam como presentes (o loop não para por "offline").
  assert.equal(rt.isPresent(ANA), true);
  assert.equal(rt.isPresent(BIA), true);
  // A corrida fecha em vitória: o grupo continua e o loop marca a próxima.
  rt.lobbyRunEnded("run-1", "vitoria", {}, {});
  assert.equal(rt.lobbies.of(ANA)?.nextAt !== null, true);
  // Ana volta; Bia não volta a tempo e sai do grupo, que segue com a Ana.
  const ana = enter(rt, ANA, "Ana");
  // Volta no hall (fora de sala): o app recebe o próprio grupo na hora (27/11/2026; antes só na
  // próxima corrida, e a ficha aberta não segurava a largada do loop).
  const got = ana.last("rpg.lobby")?.d as { lobby?: { members: { user_id: string }[] } } | undefined;
  assert.deepEqual(got?.lobby?.members.map((m) => m.user_id), [ANA, BIA]);
  now += RESTORED_GRACE_MS + 1;
  rt.tick();
  assert.equal(rt.lobbies.of(BIA), undefined);
  assert.deepEqual(rt.lobbies.of(ANA)?.members.map((m) => m.user_id), [ANA]);
  assert.equal(rt.isPresent(BIA), false);
});

test("o grupo que estava entre duas corridas do loop volta e pede a próxima sozinho", async () => {
  let now = 1_000_000;
  const BIA = "01JBIA00000000000000000000";
  const rt = new SpaceRuntime({
    serverId: SRV,
    cache: makeCache(),
    store: new MemoryAssignmentStore(),
    decorStore: new MemoryDecorStore(),
    log: silentLog,
    now: () => now,
  });
  await rt.init();
  const due: [string, string, boolean][] = [];
  rt.onLobbyDue = (leader, id, auto) => due.push([leader, id, auto]);
  assert.equal(
    rt.adoptRun({
      id: "run-ended",
      tv: "tv-x",
      room: PUB,
      dungeon: "masmorra-40",
      members: [
        { user_id: ANA, name: "Ana", cls: "guerreiro", level: 45 },
        { user_id: BIA, name: "Bia", cls: "padre", level: 44 },
      ],
      auto: true,
      ended: true,
    }),
    true,
  );
  const lobby = rt.lobbies.of(ANA)!;
  assert.equal(lobby.state, "ready");
  // Os dois voltam antes da hora da próxima: o loop pede a largada sozinho.
  enter(rt, ANA, "Ana");
  enter(rt, BIA, "Bia");
  for (let i = 0; i < 20 && due.length === 0; i++) {
    now += 1_000;
    rt.tick();
  }
  assert.deepEqual(due, [[ANA, lobby.id, true]]);
});
