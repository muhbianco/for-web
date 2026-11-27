import {
  applyDecorOp,
  applyMove,
  type AvatarLook,
  type AvatarGear,
  type AvatarHero,
  type AvatarView,
  CATALOG,
  cellIndex,
  channelPermissions,
  type CompiledMap,
  type CompiledMapWire,
  type DecorInstance,
  type DecorOp,
  type DecorRights,
  type DecorSettings,
  type DecorState,
  defaultPalette,
  type Direction,
  emptyDecor,
  furnish,
  generateLayout,
  has,
  indexMap,
  initialMoveState,
  instanceRect,
  itemOf,
  type MapIndex,
  type MoveState,
  type NpcKind,
  parseFloorRef,
  parseManagedRoomName,
  Perm,
  type PermMember,
  type PermServer,
  type PresenceEvent,
  type PresencePerson,
  type PresenceVoice,
  pruneDecor,
  regionAt,
  type RoomView,
  serverPermissions,
  setSolid,
  type SnapshotEvent,
  solidAt,
  solidMask,
  Tile,
  tileAt,
  tileCenter,
  type TilePos,
  validatePlacement,
  validateSettings,
  type VoiceReport,
  type WingView,
  type Zone,
  type ZoneIndex,
  zonesOf,
} from "@muchat/space-core";
import { TRAIN_REACH_TILES as REACH } from "@muchat/space-core/game/ot";
import type { RpgLobbyMember, RpgLoopStop, RpgPrepKind, RpgRunEnd } from "@muchat/space-core/game/ot/balance";

import { type Lobby, type LobbyResult, type SavedLobby, LobbyHub, lobbyView } from "../game/ot/lobby.ts";
import type { Log } from "../log.ts";
import type { LiveKitAdmin, ParticipantLite } from "../media/ports.ts";
import type { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatServer, StoatTextChannel, StoatUser } from "../stoat/types.ts";
import { type Assignment, reconcile, toLayoutInput } from "./assignment.ts";
import { type DecorStore, MemoryDecorStore } from "./decorStore.ts";
import { type MediaHost, type MediaHub, RoomMedia } from "./roomMedia.ts";
import { type ResumeSpot, RESUME_SPOT_TTL_MS, type SpotStore } from "./spotStore.ts";
import type { AssignmentStore } from "./store.ts";
import { MemoryTvStore, type TvCommand, TvHub, type TvHost, type TvStore } from "./tv.ts";

/** How long a disconnected avatar stays (as "reconnecting") before it leaves. */
export const DISCONNECT_GRACE_MS = 60_000;
/** Depois de um reinício, quanto um membro de grupo restaurado tem para reconectar (27/11/2026). */
export const RESTORED_GRACE_MS = 3 * 60_000;

export interface Viewer {
  user: StoatUser;
  member: StoatMember;
}

/** What the runtime needs from a connection; the gateway implements it. */
export interface SessionPort {
  readonly viewer: Viewer;
  send(event: Record<string, unknown>): void;
  close(code: number, reason: string): void;
}

/** A decoration change as the gateway hands it over (already shape-checked by zod). */
export type DecorCommand =
  | { kind: "place"; item: DecorInstance }
  | { kind: "update"; item: DecorInstance }
  | { kind: "remove"; id: string }
  | { kind: "floor"; zone: string; floor: string | null }
  | { kind: "settings"; settings: DecorSettings };

interface Avatar {
  userId: string;
  /** Last known viewer: kept while the avatar reconnects, for permission checks. */
  viewer: Viewer;
  name: string;
  look: AvatarLook;
  move: MoveState;
  dir: Direction;
  moving: boolean;
  idle: boolean;
  session: SessionPort | null;
  disconnectedAt: number | null;
  /** Leaves on the next tick, with no grace (session ended, membership gone). */
  evicted: boolean;
  dirty: boolean;
  /** What the client last said about its call in this room (presence hint, ADR 0008). */
  report: (VoiceReport & { at: number }) | null;
  /** Idle game: level and training, shown under the name to everyone (docs/espaco/jogo/ot). */
  hero: AvatarHero | null;
  /** What the game said the hero is (level, vocation, gear); `hero` adds the training to it. */
  heroLook: HeroLook | null;
}

/** The hero as the idle game sees it, for the map. */
export interface HeroLook {
  level: number;
  vocation: number;
  gear: AvatarGear;
}

/** How far from the dummy a hero keeps training, inside the dummy's zone (tiles; space-core). */
export const TRAIN_REACH_TILES = REACH;

/** LiveKit's view of one admitted participant (sweeper, every 5 s). */
interface SeenInLiveKit {
  room: string;
  mic: boolean;
  camera: boolean;
  screen: boolean;
  at: number;
}

/** Presence is sent at most this often per viewer, and re-checked at least every second. */
const PRESENCE_MIN_MS = 250;
const PRESENCE_RECHECK_MS = 1_000;
/** Watch-only sessions (the sidebar) per person and space. */
export const MAX_OBSERVERS_PER_USER = 3;

export function toPermServer(s: StoatServer): PermServer {
  return {
    ownerId: s.owner,
    defaultPermissions: s.default_permissions,
    roles: new Map(Object.entries(s.roles ?? {}).map(([id, r]) => [id, { rank: r.rank, permissions: r.permissions }])),
  };
}

export function toPermMember(m: StoatMember): PermMember {
  const timeout = m.timeout ? Date.parse(m.timeout) : null;
  return {
    roles: m.roles ?? [],
    timeoutUntil: Number.isFinite(timeout) ? timeout : null,
    canPublish: m.can_publish ?? true,
    canReceive: m.can_receive ?? true,
  };
}

/**
 * One Stoat server's space: placement, map, decoration, avatars and who sees
 * what. Everything runs on the event loop, so per-room decisions are
 * serialized; decoration writes go through one queue per space.
 */
export class SpaceRuntime implements MediaHost, TvHost {
  readonly serverId: string;
  private readonly cache: StoatCache;
  private readonly store: AssignmentStore;
  private readonly decorStore: DecorStore;
  private readonly log: Log;
  private readonly now: () => number;

  private assignment: Assignment | null = null;
  map!: CompiledMap;
  private ix!: MapIndex;
  private zones!: ZoneIndex;
  private mapWire = "";
  private decor: DecorState = emptyDecor();
  private decorQueue: Promise<unknown> = Promise.resolve();
  private readonly avatars = new Map<string, Avatar>();
  /** Per viewer: avatar ids that viewer currently has on screen. */
  private readonly visibleTo = new Map<string, Set<string>>();
  /** Channel permissions per viewer and room; an entry lapses when a Stoat timeout ends. */
  private permMemo = new Map<string, { value: bigint; until: number }>();
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  /** Media of this space (Phase 3); absent in Phase 2 setups and some tests. */
  readonly media: RoomMedia | null;
  /** After a restart: room to put a returning avatar back in (its lease survived). */
  private readonly resumeAt = new Map<string, string>();
  /** Where the previous process saw each avatar (and its dummy), until that person's first join. */
  private readonly resumeSpots = new Map<string, ResumeSpot>();
  /** Past this, a spot from the restart no longer applies (the person just came back later). */
  private resumeSpotsUntil = Number.NEGATIVE_INFINITY;
  private readonly spotStore: SpotStore | null;
  /** Watch-only sessions (sidebar presence): no avatar, never "in the space". */
  private readonly observers = new Set<SessionPort>();
  private lkSeen = new Map<string, SeenInLiveKit>();
  private presenceDirty = true;
  private presenceAt = Number.NEGATIVE_INFINITY;
  private readonly presenceSent = new WeakMap<SessionPort, string>();

  constructor(deps: {
    serverId: string;
    cache: StoatCache;
    store: AssignmentStore;
    decorStore?: DecorStore;
    /** Smart TV sessions (ADR 0008); in-memory when absent (tests, lab). */
    tvStore?: TvStore;
    log: Log;
    now?: () => number;
    media?: { hub: MediaHub; lk: LiveKitAdmin };
    /** The operator switched Refúgio on for this server (ADR 0009); off when absent. */
    gameAvailable?: boolean;
    /** Spots kept across a restart (24/11/2026); none when absent (tests, lab). */
    spotStore?: SpotStore;
  }) {
    this.serverId = deps.serverId;
    this.spotStore = deps.spotStore ?? null;
    this.gameAvailable = deps.gameAvailable ?? false;
    this.cache = deps.cache;
    this.store = deps.store;
    this.decorStore = deps.decorStore ?? new MemoryDecorStore();
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
    this.media = deps.media
      ? new RoomMedia({ hub: deps.media.hub, host: this, lk: deps.media.lk, log: deps.log, now: this.now })
      : null;
    this.tv = new TvHub({ host: this, store: deps.tvStore ?? new MemoryTvStore(), log: deps.log, now: this.now });
  }

  /** The rooms' Smart TVs (ADR 0008). */
  readonly tv: TvHub;
  /** Operator switch for Refúgio on this server (ADR 0009). */
  readonly gameAvailable: boolean;

  /**
   * Idle game (docs/espaco/jogo/ot): who trains at which dummy here. The hero document
   * holds the authoritative session; this only notices when the avatar walks away.
   */
  /** Who trains at which dummy. */
  private readonly trainingAt = new Map<string, string>();
  /** Called when a trainer leaves the dummy (walked off, moved, evicted, dummy removed). */
  onTrainingLeft: ((userId: string) => void) | null = null;
  /** Called when someone enters the map where the game is on (to show their hero's level). */
  onAvatarJoined: ((userId: string) => void) | null = null;
  /** Idle game: the TVs' preparation rooms (docs/espaco/jogo/ot, stage O4). */
  readonly lobbies = new LobbyHub();
  /**
   * Quem voltou num grupo restaurado depois de um reinício (27/11/2026) e ainda não reconectou: até
   * quando esperar. Sem avatar, a carência normal não chega a valer; vencido o prazo sem voltar, sai.
   */
  private readonly restoredGrace = new Map<string, number>();
  /** Called when someone enters a room (walked in, joined inside it): a dungeon run there shows (stage O5). */
  onRoomEntered: ((userId: string, room: string) => void) | null = null;
  /**
   * A dungeon group's start is due (the countdown ended, nobody preparing): the game service starts
   * the run for its leader; `auto`: the loop asked for it (26/11/2026).
   */
  onLobbyDue: ((leader: string, lobbyId: string, auto: boolean) => void) | null = null;

  get layoutFingerprint(): string {
    return this.map.fingerprint;
  }

  get layoutWire(): string {
    return this.mapWire;
  }

  /** The movement index, furniture included (dev walkers and tests path with it). */
  get index(): MapIndex {
    return this.ix;
  }

  /** Loads placement, reconciles with Stoat, persists (CAS), builds the map and loads the decoration. */
  async init(): Promise<void> {
    await this.reconcileAndBuild();
    await this.loadDecor();
    await this.loadSpots();
    await this.media?.recoverEpochs();
    await this.tv.init();
  }

  /** The spots the previous process wrote at shutdown; best effort (the normal entry without them). */
  private async loadSpots(): Promise<void> {
    if (!this.spotStore) return;
    try {
      const spots = await this.spotStore.take(this.serverId, this.now() - RESUME_SPOT_TTL_MS);
      for (const s of spots) this.resumeSpots.set(s.user, s);
      this.resumeSpotsUntil = this.now() + RESUME_SPOT_TTL_MS;
      if (spots.length) this.log.info("resume spots loaded", { server: this.serverId, count: spots.length });
    } catch (err) {
      this.log.warn("resume spots unavailable", { server: this.serverId, err: String(err) });
    }
  }

  /** Every avatar on the map now (reconnecting ones too) and the dummy it trains at: written at shutdown. */
  spots(): ResumeSpot[] {
    const out: ResumeSpot[] = [];
    for (const a of this.avatars.values()) {
      if (a.evicted) continue;
      out.push({
        user: a.userId,
        x: a.move.pos.x,
        y: a.move.pos.y,
        room: a.move.room,
        training: this.trainingAt.get(a.userId) ?? null,
      });
    }
    return out;
  }

  /** Writes `spots()` (the process is stopping). */
  async saveSpots(): Promise<number> {
    if (!this.spotStore) return 0;
    const spots = this.spots();
    if (spots.length) await this.spotStore.save(this.serverId, spots, this.now());
    return spots.length;
  }

  // ---- TvHost --------------------------------------------------------------

  roomOf(userId: string): string | null {
    const a = this.avatars.get(userId);
    return a && !a.evicted ? a.move.room : null;
  }

  serverManages(viewer: Viewer): boolean {
    return has(this.serverPerms(viewer), Perm.ManageServer);
  }

  /**
   * Refúgio (ADR 0009, decisão 7): operador (SPACE_GAME_SERVERS), depois o dono
   * do servidor (`settings.game`), depois a pessoa (InteractSpaceObjects no
   * servidor, que o timeout tira).
   */
  gameAccess(viewer: Viewer): "ok" | "disabled" | "not_allowed" {
    if (!this.gameAvailable || this.decor.settings.game === "off") return "disabled";
    return has(this.serverPerms(viewer), Perm.InteractSpaceObjects) ? "ok" : "not_allowed";
  }

  sessionsIn(roomId: string): SessionPort[] {
    const out: SessionPort[] = [];
    for (const a of this.avatars.values()) if (a.session && !a.evicted && a.move.room === roomId) out.push(a.session);
    return out;
  }

  hasTv(roomId: string): boolean {
    const zone = `room:${roomId}`;
    return this.decor.items.some((i) => i.zone === zone && itemOf(CATALOG, i.item)?.smartTv === true);
  }

  cooldownS(): number {
    return this.decor.settings.tv_cooldown_s ?? 0;
  }

  /** A TV turned on, off, paused: presence (lit TVs on the map) goes out again. */
  tvChanged(): void {
    this.presenceDirty = true;
  }

  /** Gateway entry for `tv.*` (the person's current session only). */
  tvCommand(session: SessionPort, cmdId: string, cmd: TvCommand): void {
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session) return;
    this.tv.command(session, cmdId, cmd);
  }

  private server(): StoatServer {
    const s = this.cache.servers.get(this.serverId);
    if (!s) throw new Error("server not in cache");
    return s;
  }

  private async reconcileAndBuild(): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const stored = this.assignment ?? (await this.store.load(this.serverId));
      const { assignment, changed, overflow } = reconcile(stored, this.server(), this.cache.channels);
      if (overflow.length) this.log.warn("rooms beyond layout limits", { server: this.serverId, count: overflow.length });
      if (changed && !(await this.store.save(assignment, stored?.rev ?? 0))) {
        this.assignment = null; // someone else wrote: reload and retry
        continue;
      }
      const prevFingerprint = this.map?.fingerprint;
      this.assignment = assignment;
      this.map = generateLayout(toLayoutInput(assignment, this.cache.channels));
      this.ix = indexMap(this.map);
      this.zones = zonesOf(this.map);
      // Same geometry for every member, but NO names: room labels and wing
      // titles reach each viewer only through roomViews()/wingViews(), which
      // hide private rooms. (A private channel's name must not leak via the map.)
      const wire: CompiledMapWire = {
        ...this.map,
        rooms: this.map.rooms.map((r) => ({ ...r, label: "" })),
        wings: this.map.wings.map((w) => ({ ...w, title: "" })),
        tiles: Buffer.from(this.map.tiles).toString("base64"),
      };
      this.mapWire = JSON.stringify(wire);
      this.permMemo.clear();
      // The furniture mask lives in the index: rebuild it for the new grid.
      this.installSolid();
      return prevFingerprint !== this.map.fingerprint;
    }
    throw new Error("assignment write conflict");
  }

  /** Stoat structure changed (channels, categories, roles): coalesced. */
  refreshStructure(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        const mapChanged = await this.reconcileAndBuild();
        if (mapChanged) await this.loadDecor().catch((err) => this.log.error("decor reload failed", { server: this.serverId, err: String(err) }));
        this.afterStructureChange(mapChanged);
      } while (this.refreshAgain);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private afterStructureChange(mapChanged: boolean) {
    for (const a of this.avatars.values()) {
      // Out of a room that no longer exists or that this person may no longer enter.
      const stillThere = a.move.room && this.ix.roomsById.has(a.move.room);
      const allowed = a.move.room ? this.canEnter(a.viewer, a.move.room) : true;
      if (a.move.room && (!stillThere || !allowed)) this.place(a, this.exitPoint(a.move.room), null);
      else if (mapChanged) {
        const region = regionAt(this.ix, a.move.pos.x, a.move.pos.y);
        if (region.kind === "blocked") this.place(a, tileCenter(this.map.spawns[0]!), null);
      }
    }
    this.unstickAvatars();
    // Who sees whom may have changed for avatars that did not move (a role or
    // override gave or took ViewChannel): the next tick recomputes everyone,
    // sending `gone` for what a viewer may no longer see (privacy) and the
    // positions of what they now may.
    for (const a of this.avatars.values()) a.dirty = true;
    for (const a of this.avatars.values()) {
      if (!a.session) continue;
      if (mapChanged) {
        a.session.send({ v: 1, t: "space.layout.changed", d: { fingerprint: this.map.fingerprint, url: this.layoutUrl() } });
        a.session.send({ v: 1, t: "decor.changed", d: { rev: this.decor.rev, op: { kind: "reset" }, by: null } });
      }
      a.session.send({
        v: 1,
        t: "space.rooms",
        d: { rooms: this.roomViews(a.session.viewer), wings: this.wingViews(a.session.viewer) },
      });
      a.session.send({ v: 1, t: "decor.rights", d: this.decorRights(a.session.viewer) });
    }
    // Roles or overrides may have changed what a token may publish.
    this.media?.permissionsChanged();
    // ...and what each person may do with their room's TV.
    const occupied = new Set<string>();
    for (const a of this.avatars.values()) if (a.move.room && !a.evicted) occupied.add(a.move.room);
    if (occupied.size) this.tv.decorChanged(occupied);
  }

  private exitPoint(roomId: string) {
    const r = this.ix.roomsById.get(roomId);
    return r ? tileCenter(r.outside) : tileCenter(this.map.spawns[0]!);
  }

  private place(a: Avatar, pos: { x: number; y: number }, room: string | null) {
    const before = a.move.room;
    a.move = { ...a.move, pos: { x: Math.round(pos.x), y: Math.round(pos.y) }, room };
    a.dirty = true;
    this.checkTraining(a.userId);
    if (before !== room) {
      a.report = null;
      this.presenceDirty = true;
      if (room && a.session) this.tv.entered(a.session, room);
      this.lobbyRoomChanged(a.userId, room);
    }
    a.session?.send({ v: 1, t: "avatar.correction", d: { x: a.move.pos.x, y: a.move.pos.y, room, seq: a.move.seq, reason: "moved" } });
    if (before !== room) this.media?.sync(a.userId, "refresh");
  }

  layoutUrl(): string {
    return `/_muchat/space/v1/spaces/${this.serverId}/layout/${this.map.fingerprint}`;
  }

  decorUrl(): string {
    return `/_muchat/space/v1/spaces/${this.serverId}/decor`;
  }

  // ---- decoration (ADR 0007) ------------------------------------------------

  get decorRev(): number {
    return this.decor.rev;
  }

  /** The decoration as every member may read it (bookkeeping fields left out). */
  get decorWire(): string {
    const { rev, floors, items, settings } = this.decor;
    return JSON.stringify({ rev, floors, items, settings });
  }

  /** Current state (tests and the dev server). */
  get decorState(): DecorState {
    return this.decor;
  }

  private installSolid() {
    setSolid(this.ix, solidMask(this.map, this.zones, CATALOG, this.decor.items));
  }

  private setDecor(state: DecorState) {
    this.decor = state;
    this.installSolid();
    // A dummy someone trains at was removed or moved: those trainers stop.
    for (const userId of [...this.trainingAt.keys()]) this.checkTraining(userId);
    // A TV with dungeon groups was removed: its groups end.
    for (const tv of this.lobbies.tvs()) {
      if (state.items.some((i) => i.id === tv)) continue;
      for (const lobby of this.lobbies.dropTv(tv)) this.broadcastLobby(lobby, false, { ended: "cancelled" });
    }
  }

  // ---- idle game: dungeon groups at the TVs (docs/espaco/jogo/ot, stage O4) -----

  /** A TV in a room, usable by the person, who stands next to it inside that room. */
  tvSpot(viewer: Viewer, tv: string): { ok: true; room: string } | { ok: false; code: string; reason?: string } {
    const a = this.avatars.get(viewer.user._id);
    if (!a || !a.session) return { ok: false, code: "not_allowed" };
    const inst = this.decor.items.find((i) => i.id === tv);
    const item = inst ? itemOf(CATALOG, inst.item) : undefined;
    const zone = inst ? this.zones.byKey.get(inst.zone) : undefined;
    if (!inst || !item || !zone || item.interaction !== "tv" || zone.kind !== "room" || !zone.roomId)
      return { ok: false, code: "not_found" };
    if (!this.canInteract(viewer, inst.zone)) return { ok: false, code: "not_allowed" };
    if (a.move.room !== zone.roomId || !this.besideInstance(a, tv, "tv"))
      return { ok: false, code: "not_allowed", reason: "too_far" };
    return { ok: true, room: zone.roomId };
  }

  lobbyCreate(tv: string, room: string, dungeon: string, member: RpgLobbyMember): LobbyResult {
    const res = this.lobbies.create(tv, room, dungeon, member, this.now());
    if (res.ok) this.broadcastLobby(res.lobby, true, {}, member.user_id);
    return res;
  }

  /** Joins group `id` at the TV (no id: the TV's first group with room, out of a run). */
  lobbyJoin(tv: string, id: string | undefined, member: RpgLobbyMember): LobbyResult {
    const res = this.lobbies.join(tv, id, member);
    if (res.ok) this.broadcastLobby(res.lobby, true, {}, member.user_id);
    return res;
  }

  lobbyLeave(userId: string): void {
    const out = this.lobbies.leave(userId, this.now());
    if (!out) return;
    this.broadcastLobby(out.lobby, !out.ended, out.ended ? { ended: out.ended } : {}, undefined, [userId]);
  }

  /** The leader ends the group for everyone. */
  lobbyDisband(userId: string): LobbyResult {
    const res = this.lobbies.disband(userId);
    if (res.ok) this.broadcastLobby(res.lobby, false, { ended: "cancelled" }, userId);
    return res;
  }

  lobbyDungeon(userId: string, dungeon: string): LobbyResult {
    const res = this.lobbies.setDungeon(userId, dungeon);
    if (res.ok) this.broadcastLobby(res.lobby, true, {}, userId);
    return res;
  }

  lobbyLoop(userId: string, on: boolean): LobbyResult {
    const res = this.lobbies.setLoop(userId, on, this.now());
    if (res.ok) this.broadcastLobby(res.lobby, true, {}, userId);
    return res;
  }

  /** The leader asks for the start: it waits for whoever is preparing, then counts 3 s. */
  lobbyRequestStart(userId: string): LobbyResult {
    const res = this.lobbies.requestStart(userId, this.now());
    if (res.ok) this.broadcastLobby(res.lobby, true, {}, userId);
    return res;
  }

  /** The leader gives up the pending start. */
  lobbyCancelStart(userId: string): LobbyResult {
    const res = this.lobbies.cancelStart(userId, this.now());
    if (res.ok) this.broadcastLobby(res.lobby, true, {}, userId);
    return res;
  }

  /** The person opened (or closed) the hero sheet or an NPC: holds their group's start. */
  lobbyPrep(userId: string, what: RpgPrepKind | null): Lobby | null {
    const lobby = this.lobbies.setPrep(userId, what, this.now());
    if (lobby) this.broadcastLobby(lobby, true, {}, userId);
    return lobby ?? this.lobbies.of(userId) ?? null;
  }

  /** Os grupos para gravar no desligamento (27/11/2026: nenhum grupo se perde no deploy). */
  lobbySnapshot(): SavedLobby[] {
    return this.lobbies.snapshot();
  }

  /**
   * Traz os grupos gravados no desligamento; quem voltou tem `RESTORED_GRACE_MS` para reconectar.
   * `activeRuns`: as corridas que voltam a andar (grupo "rodando" sem a corrida fica pronto).
   */
  restoreLobbies(saved: readonly unknown[], activeRuns: ReadonlySet<string>): number {
    const got = this.lobbies.restore(saved, activeRuns, this.now());
    for (const l of got) this.graceRestored(l);
    return got.length;
  }

  /** Refaz o grupo de uma corrida em andamento que não voltou do snapshot (o deploy que o criou). */
  adoptRun(run: Parameters<LobbyHub["adopt"]>[0]): boolean {
    const lobby = this.lobbies.adopt(run, this.now());
    if (!lobby) return false;
    this.graceRestored(lobby);
    return true;
  }

  private graceRestored(lobby: Lobby): void {
    const until = this.now() + RESTORED_GRACE_MS;
    for (const m of lobby.members)
      if (!this.avatars.get(m.user_id)?.session) this.restoredGrace.set(m.user_id, until);
  }

  /** The group's run was saved: everyone sees it running. */
  lobbyRunning(id: string, runId: string): void {
    this.lobbies.running(id, runId);
    const lobby = this.lobbies.get(id);
    if (lobby) this.broadcastLobby(lobby, true, {});
  }

  /** The run could not be saved: the group waits again. */
  lobbyAbort(id: string): void {
    const lobby = this.lobbies.abort(id, this.now());
    if (lobby) this.broadcastLobby(lobby, true, {});
  }

  /** A group's run closed: ready for the next (levels refreshed; the loop schedules it). */
  lobbyRunEnded(
    runId: string,
    outcome: RpgRunEnd,
    levels: Record<string, number>,
    regions: Record<string, number[]> = {},
  ): void {
    const lobby = this.lobbies.runEnded(runId, outcome, this.now());
    if (!lobby) return;
    for (const m of lobby.members) {
      if (levels[m.user_id] !== undefined) m.level = levels[m.user_id]!;
      // The boss of a region opens once its other dungeons are cleared (26/11/2026).
      if (regions[m.user_id] !== undefined) m.regions = regions[m.user_id];
    }
    this.broadcastLobby(lobby, true, {});
  }

  /** The hero changed class at the Mestre (26/11/2026): the group shows the new class. */
  lobbyHero(userId: string, cls: RpgLobbyMember["cls"], level: number): void {
    const lobby = this.lobbies.of(userId);
    const m = lobby?.members.find((x) => x.user_id === userId);
    if (!lobby || !m) return;
    m.cls = cls;
    m.level = level;
    this.broadcastLobby(lobby, true, {});
  }

  /** The loop could not start the next run: it stops, and everyone sees why. */
  lobbyLoopFailed(id: string, why: RpgLoopStop, detail?: string): void {
    const lobby = this.lobbies.loopFailed(id, why, detail);
    if (lobby) this.broadcastLobby(lobby, true, {});
  }

  /**
   * On the map now or within the reconnect grace (not gone for good). Desde 27/11/2026 também quem
   * voltou num grupo restaurado depois de um reinício e ainda reconecta (`restoredGrace`): o loop
   * não para por "offline" só porque o app de todos ainda está voltando.
   */
  isPresent(userId: string): boolean {
    const a = this.avatars.get(userId);
    if (a) return !a.evicted;
    return this.restoredGrace.has(userId);
  }

  /** The leader starts; `auto`: by the loop (the room is not told again on every run). */
  lobbyStart(userId: string, auto = false): LobbyResult {
    const res = this.lobbies.start(userId, this.now());
    if (res.ok) {
      this.broadcastLobby(
        res.lobby,
        true,
        auto
          ? {}
          : {
              ended: "started",
              started: { dungeon: res.lobby.dungeon, members: res.lobby.members.map((m) => ({ ...m })) },
            },
      );
      this.log.info("rpg lobby started", {
        server: this.serverId,
        room: res.lobby.room,
        tv: res.lobby.tv,
        dungeon: res.lobby.dungeon,
        members: res.lobby.members.length,
      });
    }
    return res;
  }

  /**
   * The person walked into another room: the new room's groups shown. Their own group stays
   * (24/11/2026: the group is theirs until they leave it, wherever they walk).
   */
  private lobbyRoomChanged(userId: string, room: string | null) {
    const a = this.avatars.get(userId);
    if (room && a?.session) {
      this.sendLobbiesTo(a.session, room);
      this.onRoomEntered?.(userId, room);
    }
  }

  /** Every dungeon group at the TVs of this space (the game menu's board). */
  allLobbies(): Lobby[] {
    return this.lobbies.all();
  }

  lobbyOf(userId: string): Lobby | undefined {
    return this.lobbies.of(userId);
  }

  /** A dungeon run to everyone in its room and to its members wherever they are, once each (stage O5). */
  sendRun(room: string, userIds: readonly string[], ev: Record<string, unknown>): void {
    const seen = new Set<SessionPort>();
    for (const s of this.sessionsIn(room)) {
      seen.add(s);
      s.send(ev);
    }
    for (const id of userIds) {
      const s = this.avatars.get(id)?.session;
      if (s && !seen.has(s)) {
        seen.add(s);
        s.send(ev);
      }
    }
  }

  /** The room's groups (none outside a room), and the person's own group wherever it is. */
  private sendLobbiesTo(session: SessionPort, room: string | null) {
    const shown = room ? this.lobbies.inRoom(room) : [];
    const mine = this.lobbies.of(session.viewer.user._id);
    if (mine && !shown.includes(mine)) shown.push(mine);
    for (const l of shown) session.send({ v: 1, t: "rpg.lobby", d: { tv: l.tv, id: l.id, lobby: lobbyView(l) } });
  }

  /**
   * A group to everyone in its TV's room and to its members wherever they are, once each
   * (whoever acted gets it as the command's answer). `alive` false: it ended (the event carries
   * null); `also`: people who just left it.
   */
  private broadcastLobby(
    lobby: Lobby,
    alive: boolean,
    extra: { ended?: "started" | "cancelled" | "expired"; started?: { dungeon: string; members: RpgLobbyMember[] } },
    exceptUserId?: string,
    also: readonly string[] = [],
  ) {
    const event = { v: 1, t: "rpg.lobby", d: { tv: lobby.tv, id: lobby.id, lobby: alive ? lobbyView(lobby) : null, ...extra } };
    const seen = new Set<SessionPort>();
    for (const s of this.sessionsIn(lobby.room)) {
      seen.add(s);
      if (s.viewer.user._id !== exceptUserId) s.send(event);
    }
    const ids = [...lobby.members.map((m) => m.user_id), ...also];
    for (const id of ids) {
      if (id === exceptUserId) continue;
      const s = this.avatars.get(id)?.session;
      if (s && !seen.has(s)) {
        seen.add(s);
        s.send(event);
      }
    }
  }

  // ---- idle game: training dummies (docs/espaco/jogo/ot) -----------------------

  /** A training dummy: exists, is a dummy, the person may use it and stands next to it. */
  trainSpot(viewer: Viewer, instanceId: string): { ok: true; zone: string } | { ok: false; code: string; reason?: string } {
    const a = this.avatars.get(viewer.user._id);
    if (!a || !a.session) return { ok: false, code: "not_allowed" };
    const inst = this.decor.items.find((i) => i.id === instanceId);
    const item = inst ? itemOf(CATALOG, inst.item) : undefined;
    const zone = inst ? this.zones.byKey.get(inst.zone) : undefined;
    if (!inst || !item || !zone || item.interaction !== "train") return { ok: false, code: "not_found" };
    if (!this.canInteract(viewer, inst.zone)) return { ok: false, code: "not_allowed" };
    if (!this.besideInstance(a, instanceId)) return { ok: false, code: "not_allowed", reason: "too_far" };
    return { ok: true, zone: inst.zone };
  }

  /** An NPC of the idle game (stage O8): exists, is that NPC, the person may use it and stands next to it. */
  npcSpot(viewer: Viewer, instanceId: string, kind: NpcKind): { ok: true } | { ok: false; code: string; reason?: string } {
    const a = this.avatars.get(viewer.user._id);
    if (!a || !a.session) return { ok: false, code: "not_allowed" };
    const inst = this.decor.items.find((i) => i.id === instanceId);
    const item = inst ? itemOf(CATALOG, inst.item) : undefined;
    if (!inst || !item || item.interaction !== "npc" || item.npc !== kind) return { ok: false, code: "not_found" };
    if (!this.canInteract(viewer, inst.zone)) return { ok: false, code: "not_allowed" };
    if (!this.besideInstance(a, instanceId, "npc")) return { ok: false, code: "not_allowed", reason: "too_far" };
    return { ok: true };
  }

  isTrainingAt(userId: string, instanceId: string): boolean {
    return this.trainingAt.get(userId) === instanceId;
  }

  /** How many others train at a dummy in the same zone as this person (the Dojô social bonus). */
  trainingPeers(userId: string): number {
    const mine = this.trainingAt.get(userId);
    if (mine === undefined) return 0;
    const zoneOf = (id: string) => this.decor.items.find((i) => i.id === id)?.zone;
    const zone = zoneOf(mine);
    let n = 0;
    for (const [u, inst] of this.trainingAt) if (u !== userId && zoneOf(inst) === zone) n++;
    return n;
  }

  /** The dummy the runtime sees the person training at (null: none). */
  trainingOf(userId: string): string | null {
    return this.trainingAt.get(userId) ?? null;
  }

  setTraining(userId: string, instanceId: string | null): void {
    if (instanceId === null) this.trainingAt.delete(userId);
    else this.trainingAt.set(userId, instanceId);
    this.markHero(userId);
  }

  /** The hero under the name and, while training, what they wear (null: no hero, nothing shown). */
  setHero(userId: string, look: HeroLook | null): void {
    const a = this.avatars.get(userId);
    if (!a) return;
    a.heroLook = look;
    this.markHero(userId);
  }

  private markHero(userId: string): void {
    const a = this.avatars.get(userId);
    if (!a) return;
    const look = a.heroLook;
    const at = this.trainingAt.get(userId);
    const hero: AvatarHero | null = !look
      ? null
      : at === undefined
        ? { level: look.level, training: false }
        : { level: look.level, training: true, at, vocation: look.vocation, gear: look.gear };
    if (JSON.stringify(hero) === JSON.stringify(a.hero)) return;
    a.hero = hero;
    a.dirty = true;
  }

  /**
   * The avatar stands within `reach` tiles of the instance (1: the same reach as the prompt).
   * A longer reach also needs the avatar inside the instance's zone (no training through a wall).
   */
  private besideInstance(a: Avatar, instanceId: string, kind: "train" | "tv" | "npc" = "train", reach = 1): boolean {
    return this.nearInstance(a.move.pos, instanceId, kind, reach);
  }

  private nearInstance(pos: { x: number; y: number }, instanceId: string, kind: "train" | "tv" | "npc", reach: number): boolean {
    const inst = this.decor.items.find((i) => i.id === instanceId);
    const item = inst ? itemOf(CATALOG, inst.item) : undefined;
    const zone = inst ? this.zones.byKey.get(inst.zone) : undefined;
    if (!inst || !item || !zone || item.interaction !== kind) return false;
    const rect = instanceRect(zone, item, inst);
    const tx = Math.floor(pos.x / this.map.tileSize);
    const ty = Math.floor(pos.y / this.map.tileSize);
    if (reach > 1 && !(tx >= zone.rect.x0 && tx <= zone.rect.x1 && ty >= zone.rect.y0 && ty <= zone.rect.y1)) return false;
    return tx >= rect.x0 - reach && tx <= rect.x1 + reach && ty >= rect.y0 - reach && ty <= rect.y1 + reach;
  }

  /**
   * Where a person comes back after a restart (their resume spot), or null for the normal entry.
   * They must still be allowed there; a trainer stands next to the dummy (the shutdown spot
   * normally already is) and goes on training.
   */
  private spotStart(
    viewer: Viewer,
    spot: ResumeSpot,
  ): { pos: { x: number; y: number }; room: string | null; training: string | null } | null {
    if (spot.room && (!this.ix.roomsById.has(spot.room) || !this.canEnter(viewer, spot.room))) return null;
    const regionOf = (p: { x: number; y: number }): string | null | undefined => {
      const r = regionAt(this.ix, p.x, p.y);
      return r.kind === "room" ? r.roomId : r.kind === "open" ? null : undefined;
    };
    const tileOf = (p: { x: number; y: number }): TilePos => ({
      tx: Math.floor(p.x / this.map.tileSize),
      ty: Math.floor(p.y / this.map.tileSize),
    });
    const saved = spot.x !== null && spot.y !== null ? this.nearestFree(tileOf({ x: spot.x, y: spot.y }), spot.room) : null;
    const pos = saved && regionOf(saved) === spot.room ? saved : null;
    if (spot.training) {
      const inst = this.decor.items.find((i) => i.id === spot.training);
      const item = inst ? itemOf(CATALOG, inst.item) : undefined;
      const zone = inst ? this.zones.byKey.get(inst.zone) : undefined;
      if (inst && item && zone && item.interaction === "train" && this.canInteract(viewer, inst.zone)) {
        const near = (p: { x: number; y: number } | null) =>
          !!p && regionOf(p) === spot.room && this.nearInstance(p, inst.id, "train", TRAIN_REACH_TILES);
        if (near(pos)) return { pos: pos!, room: spot.room, training: inst.id };
        // Next to the dummy, on a tile nobody stands on (several trainers come back to one dummy).
        const rect = instanceRect(zone, item, inst);
        const taken = new Set<string>();
        for (const o of this.avatars.values()) {
          if (!o.evicted) taken.add(`${Math.floor(o.move.pos.x / this.map.tileSize)},${Math.floor(o.move.pos.y / this.map.tileSize)}`);
        }
        for (let ty = rect.y0 - 1; ty <= rect.y1 + 1; ty++) {
          for (let tx = rect.x0 - 1; tx <= rect.x1 + 1; tx++) {
            if (taken.has(`${tx},${ty}`) || tileAt(this.map, tx, ty) !== Tile.Floor || solidAt(this.ix, tx, ty)) continue;
            const c = tileCenter({ tx, ty });
            if (near(c)) return { pos: c, room: spot.room, training: inst.id };
          }
        }
        const beside = this.nearestFree({ tx: rect.x0, ty: rect.y0 }, spot.room);
        if (near(beside)) return { pos: beside!, room: spot.room, training: inst.id };
      }
    }
    return pos ? { pos, room: spot.room, training: null } : null;
  }

  /** A trainer who left the dummy's zone or walked more than TRAIN_REACH_TILES away (or is gone) stops training. */
  private checkTraining(userId: string): void {
    const instanceId = this.trainingAt.get(userId);
    if (instanceId === undefined) return;
    const a = this.avatars.get(userId);
    if (a && !a.evicted && this.besideInstance(a, instanceId, "train", TRAIN_REACH_TILES)) return;
    this.trainingAt.delete(userId);
    this.markHero(userId);
    this.onTrainingLeft?.(userId);
  }

  /**
   * Loads the stored decoration, drops what no longer fits the map, furnishes
   * zones the theme has not touched yet (every zone on a fresh server, new
   * rooms later) and persists the result when anything changed.
   */
  private async loadDecor(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const stored = await this.decorStore.load(this.serverId);
      const base = stored ?? emptyDecor();
      const ctx = { ix: this.ix, zones: this.zones, catalog: CATALOG };
      const { state: pruned, dropped } = pruneDecor(ctx, base);
      if (dropped.length) this.log.warn("decor items no longer fit the map", { server: this.serverId, count: dropped.length });
      const next = furnish(this.ix, pruned, { serverName: this.server().name });
      const changed =
        !stored ||
        dropped.length > 0 ||
        next.items.length !== base.items.length ||
        next.furnished.length !== base.furnished.length ||
        Object.keys(next.floors).length !== Object.keys(base.floors).length;
      if (!changed) {
        this.setDecor(next);
        return;
      }
      const toSave = { ...next, rev: base.rev + 1 };
      if (await this.decorStore.save(this.serverId, toSave, stored?.rev ?? 0)) {
        this.setDecor(toSave);
        return;
      }
      // Someone else wrote (overlapping redeploy): reload and try again.
    }
    throw new Error("decor write conflict");
  }

  // ---- permissions of the space (ADR 0008) ---------------------------------

  /** Stoat server permissions of a viewer (timeouts masked like Stoat does). */
  private serverPerms(viewer: Viewer): bigint {
    return serverPermissions({
      user: { id: viewer.user._id, privileged: viewer.user.privileged ?? false },
      server: toPermServer(this.server()),
      member: toPermMember(viewer.member),
      nowMs: this.now(),
    });
  }

  /**
   * Permissions that apply to a zone of the map: a room is its Stoat channel
   * (overrides included, nothing without ViewChannel); the hall, the spine and
   * the wing corridors use the server's permissions.
   */
  private zonePerms(viewer: Viewer, zoneKey: string): bigint {
    const zone = this.zones.byKey.get(zoneKey);
    if (zone?.kind === "room") return zone.roomId ? this.perms(viewer, zone.roomId) : 0n;
    return this.serverPerms(viewer);
  }

  /** The zone is on this viewer's map (rooms need ViewChannel). */
  private seesZone(viewer: Viewer, zoneKey: string): boolean {
    const zone = this.zones.byKey.get(zoneKey);
    if (zone?.kind !== "room") return true;
    return zone.roomId ? this.canView(viewer, zone.roomId) : false;
  }

  /** Place, move, rotate, edit and remove objects in the zone (ManageServer also does). */
  canDecorate(viewer: Viewer, zoneKey: string): boolean {
    return has(this.serverPerms(viewer), Perm.ManageServer) || has(this.zonePerms(viewer, zoneKey), Perm.DecorateSpace);
  }

  /** Configure what interactive objects do in the zone. */
  canConfigure(viewer: Viewer, zoneKey: string): boolean {
    return has(this.serverPerms(viewer), Perm.ManageServer) || has(this.zonePerms(viewer, zoneKey), Perm.ConfigureSpaceObjects);
  }

  /** Use interactive objects of the zone (open, teleport, watch the TV). */
  canInteract(viewer: Viewer, zoneKey: string): boolean {
    return has(this.zonePerms(viewer, zoneKey), Perm.InteractSpaceObjects) || this.canConfigure(viewer, zoneKey);
  }

  /** What this person may do to the decoration, and where (mirrored for the editor). */
  decorRights(viewer: Viewer): DecorRights {
    const manage = has(this.serverPerms(viewer), Perm.ManageServer);
    const editCommon = this.canDecorate(viewer, "hall");
    const configureCommon = this.canConfigure(viewer, "hall");
    const editRooms: string[] = [];
    const configureRooms: string[] = [];
    for (const r of this.map.rooms) {
      const key = `room:${r.roomId}`;
      if (this.canDecorate(viewer, key)) editRooms.push(r.roomId);
      if (this.canConfigure(viewer, key)) configureRooms.push(r.roomId);
    }
    return {
      can_edit: editCommon || editRooms.length > 0,
      can_manage: manage,
      edit_common: editCommon,
      edit_rooms: editRooms,
      configure_common: configureCommon,
      configure_rooms: configureRooms,
    };
  }

  /** An instance as this viewer may receive it: no configuration when they may not use it. */
  private instanceFor(viewer: Viewer, inst: DecorInstance): DecorInstance {
    if (!inst.config || this.canInteract(viewer, inst.zone)) return inst;
    const { config: _hidden, ...rest } = inst;
    return { ...rest, locked: true };
  }

  /**
   * The decoration as this viewer may read it (GET /decor): items and floors
   * of rooms they cannot view are left out (a private room's notes, links and
   * furniture never leave the server), configurations they may not use too.
   */
  decorWireFor(viewer: Viewer): string {
    const { rev, floors, items, settings } = this.decor;
    return JSON.stringify({
      rev,
      floors: Object.fromEntries(Object.entries(floors).filter(([zone]) => this.seesZone(viewer, zone))),
      items: items.filter((i) => this.seesZone(viewer, i.zone)).map((i) => this.instanceFor(viewer, i)),
      settings,
    });
  }

  /** `decor.changed` for one recipient: a change they may not see is a reset (refetch, filtered). */
  private opFor(viewer: Viewer, op: DecorOp, zones: string[]): DecorOp {
    if (!zones.every((z) => this.seesZone(viewer, z))) return { kind: "reset" };
    if (op.kind === "place" || op.kind === "update") return { ...op, item: this.instanceFor(viewer, op.item) };
    return op;
  }

  /** Gateway entry: one change, validated and persisted, then told to everyone. Serialized per space. */
  decorCommand(session: SessionPort, cmdId: string, cmd: DecorCommand): void {
    this.decorQueue = this.decorQueue
      .then(() => this.runDecor(session, cmdId, cmd))
      .catch((err) => {
        this.log.error("decor command failed", { server: this.serverId, err: String(err) });
        session.send({ v: 1, t: "error", re: cmdId, d: { code: "internal" } });
      });
  }

  private async runDecor(session: SessionPort, cmdId: string, cmd: DecorCommand): Promise<void> {
    const userId = session.viewer.user._id;
    const a = this.avatars.get(userId);
    if (!a || a.session !== session) return;
    const fail = (code: string, reason?: string) =>
      session.send({ v: 1, t: "error", re: cmdId, d: { code, ...(reason ? { reason } : {}) } });
    const viewer = session.viewer;
    if (cmd.kind === "settings" && !has(this.serverPerms(viewer), Perm.ManageServer)) return fail("not_allowed");

    const ctx = { ix: this.ix, zones: this.zones, catalog: CATALOG, state: this.decor };
    let op: DecorOp;
    /** Zones the change touches: who may not see one of them gets a reset. */
    let touched: string[] = [];
    switch (cmd.kind) {
      case "place": {
        // Permission per zone (ADR 0008): a room is its channel, the halls the server.
        if (!this.canDecorate(viewer, cmd.item.zone)) return fail("not_allowed");
        if (cmd.item.config && !this.canConfigure(viewer, cmd.item.zone)) return fail("not_allowed", "configure");
        const { locked: _l, ...item } = cmd.item as DecorInstance;
        const err = validatePlacement(ctx, item);
        if (err) return fail("decor_invalid", err);
        op = { kind: "place", item };
        touched = [item.zone];
        break;
      }
      case "update": {
        const cur = this.decor.items.find((i) => i.id === cmd.item.id);
        if (!cur) return fail("not_found");
        if (cur.item !== cmd.item.item) return fail("decor_invalid", "unknown_item");
        // Moving between zones needs the permission in both.
        if (!this.canDecorate(viewer, cur.zone) || !this.canDecorate(viewer, cmd.item.zone)) return fail("not_allowed");
        const { locked: _l, ...sent } = cmd.item as DecorInstance;
        let item = sent;
        if (!this.canConfigure(viewer, cmd.item.zone)) {
          // Someone who may not configure moves or turns the object: its
          // configuration stays as it is (they may not even have received it).
          if (sent.config && JSON.stringify(sent.config) !== JSON.stringify(cur.config)) return fail("not_allowed", "configure");
          item = { ...sent, ...(cur.config ? { config: cur.config } : {}) };
          if (!cur.config) delete (item as { config?: unknown }).config;
        }
        const err = validatePlacement(ctx, item, item.id);
        if (err) return fail("decor_invalid", err);
        op = { kind: "update", item };
        touched = [cur.zone, item.zone];
        break;
      }
      case "remove": {
        const cur = this.decor.items.find((i) => i.id === cmd.id);
        if (!cur) return fail("not_found");
        if (!this.canDecorate(viewer, cur.zone)) return fail("not_allowed");
        op = { kind: "remove", id: cmd.id };
        touched = [cur.zone];
        break;
      }
      case "floor": {
        if (!this.zones.byKey.has(cmd.zone)) return fail("decor_invalid", "unknown_zone");
        if (!this.canDecorate(viewer, cmd.zone)) return fail("not_allowed");
        touched = [cmd.zone];
        if (cmd.floor !== null) {
          const { item, variant } = parseFloorRef(cmd.floor);
          const it = itemOf(CATALOG, item);
          if (!it || it.layer !== "floor") return fail("decor_invalid", "unknown_item");
          if (variant !== undefined && !(it.variants ?? []).includes(variant)) return fail("decor_invalid", "bad_config");
        }
        op = { kind: "floor", zone: cmd.zone, floor: cmd.floor };
        break;
      }
      case "settings": {
        if (!validateSettings(cmd.settings)) return fail("decor_invalid", "bad_config");
        // An app that does not know Refúgio's switch leaves it out: keep the stored one (ADR 0009).
        const game = cmd.settings.game ?? this.decor.settings.game;
        op = { kind: "settings", settings: game ? { ...cmd.settings, game } : cmd.settings };
        break;
      }
    }

    const next = applyDecorOp(this.decor, op, this.decor.rev + 1);
    const saved = await this.decorStore.save(this.serverId, next, this.decor.rev);
    if (!saved) {
      // Another writer got there first (overlapping redeploy): take theirs, tell everyone to refetch.
      const fresh = await this.decorStore.load(this.serverId);
      if (fresh) this.setDecor(fresh);
      this.broadcast({ v: 1, t: "decor.changed", d: { rev: this.decor.rev, op: { kind: "reset" }, by: null } });
      return fail("conflict");
    }
    this.setDecor(next);
    // Everyone gets the change as they may see it (a room they cannot view:
    // a reset, refetched filtered); the issuer also gets `re` (undo stack).
    for (const other of this.avatars.values()) {
      const s = other.session;
      if (!s) continue;
      const event = { v: 1, t: "decor.changed", d: { rev: next.rev, op: this.opFor(s.viewer, op, touched), by: userId } };
      s.send(s === session ? { ...event, re: cmdId } : event);
    }
    if (op.kind === "settings") {
      for (const other of this.avatars.values()) other.session?.send({ v: 1, t: "decor.rights", d: this.decorRights(other.viewer) });
    }
    // A TV object placed or removed in a room turns that room's TV on or off.
    const rooms = touched.filter((z) => z.startsWith("room:")).map((z) => z.slice(5));
    if (rooms.length) this.tv.decorChanged(new Set(rooms));
    if (op.kind === "settings") this.tv.decorChanged(this.map.rooms.map((r) => r.roomId).filter((id) => this.tv.state(id)));
    if ((op.kind === "place" || op.kind === "update") && itemOf(CATALOG, op.item.item)?.solid) this.unstickAvatars();
  }

  private broadcast(event: Record<string, unknown>) {
    for (const a of this.avatars.values()) a.session?.send(event);
  }

  /** Nobody stays inside a sofa: anyone standing under new furniture steps to the nearest free tile. */
  private unstickAvatars() {
    for (const a of this.avatars.values()) {
      const tx = Math.floor(a.move.pos.x / this.map.tileSize);
      const ty = Math.floor(a.move.pos.y / this.map.tileSize);
      if (!solidAt(this.ix, tx, ty)) continue;
      const free = this.nearestFree({ tx, ty }, a.move.room);
      if (!free) continue;
      const region = regionAt(this.ix, free.x, free.y);
      this.place(a, free, region.kind === "room" ? region.roomId : region.kind === "open" ? null : a.move.room);
    }
  }

  /** Breadth-first over walkable tiles, preferring the same room (or outside any room). */
  private nearestFree(from: TilePos, room: string | null): { x: number; y: number } | null {
    const map = this.map;
    const seen = new Set<number>();
    const queue: TilePos[] = [from];
    let fallback: TilePos | null = null;
    while (queue.length) {
      const p = queue.shift()!;
      const idx = cellIndex(map, p.tx, p.ty);
      if (idx < 0 || seen.has(idx) || seen.size > 400) continue;
      seen.add(idx);
      const kind = tileAt(map, p.tx, p.ty);
      if (kind !== Tile.Floor && kind !== Tile.Door) continue;
      if (kind === Tile.Floor && !solidAt(this.ix, p.tx, p.ty)) {
        const c = tileCenter(p);
        const region = regionAt(this.ix, c.x, c.y);
        const sameRoom = region.kind === "room" ? region.roomId === room : region.kind === "open" && room === null;
        if (sameRoom) return c;
        fallback ??= p;
      }
      queue.push({ tx: p.tx + 1, ty: p.ty }, { tx: p.tx - 1, ty: p.ty }, { tx: p.tx, ty: p.ty + 1 }, { tx: p.tx, ty: p.ty - 1 });
    }
    return fallback ? tileCenter(fallback) : null;
  }

  /** A portal: the person next to it goes to its target zone (same rules as walking there). */
  teleport(session: SessionPort, cmdId: string, instanceId: string): void {
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session) return;
    const fail = (code: string, reason?: string) =>
      session.send({ v: 1, t: "error", re: cmdId, d: { code, ...(reason ? { reason } : {}) } });
    const inst = this.decor.items.find((i) => i.id === instanceId);
    const item = inst ? itemOf(CATALOG, inst.item) : undefined;
    const zone = inst ? this.zones.byKey.get(inst.zone) : undefined;
    if (!inst || !item || !zone || item.interaction !== "teleport") return fail("not_found");
    if (!this.canInteract(session.viewer, inst.zone)) return fail("not_allowed");
    const rect = instanceRect(zone, item, inst);
    const tx = Math.floor(a.move.pos.x / this.map.tileSize);
    const ty = Math.floor(a.move.pos.y / this.map.tileSize);
    if (tx < rect.x0 - 1 || tx > rect.x1 + 1 || ty < rect.y0 - 1 || ty > rect.y1 + 1) return fail("not_allowed", "too_far");
    const target = inst.config?.target ? this.zones.byKey.get(inst.config.target) : undefined;
    if (!target) return fail("decor_invalid", "unknown_zone");
    const dest = this.arrivalTile(target, session.viewer);
    if (!dest) return fail("not_allowed");
    this.place(a, tileCenter(dest.tile), dest.room);
  }

  /** Where a teleport lands in a zone; null when the person may not be there. */
  private arrivalTile(zone: Zone, viewer: Viewer): { tile: TilePos; room: string | null } | null {
    if (zone.kind === "room") {
      const room = zone.roomId ? this.ix.roomsById.get(zone.roomId) : undefined;
      if (!room || !this.doorOpenFor(viewer, room.roomId)) return null;
      return { tile: room.inside, room: room.roomId };
    }
    if (zone.kind === "hall") {
      const spawn = this.map.spawns[this.avatars.size % this.map.spawns.length] ?? this.map.spawns[0]!;
      return { tile: spawn, room: null };
    }
    const cx = Math.floor((zone.rect.x0 + zone.rect.x1) / 2);
    const cy = Math.floor((zone.rect.y0 + zone.rect.y1) / 2);
    const free = this.nearestFree({ tx: cx, ty: cy }, null);
    return free ? { tile: { tx: Math.floor(free.x / this.map.tileSize), ty: Math.floor(free.y / this.map.tileSize) }, room: null } : null;
  }

  // ---- permissions ---------------------------------------------------------

  perms(viewer: Viewer, roomId: string): bigint {
    const key = `${viewer.user._id}\u0000${roomId}`;
    const now = this.now();
    const hit = this.permMemo.get(key);
    if (hit !== undefined && hit.until > now) return hit.value;
    const channel: StoatTextChannel | undefined = this.cache.channels.get(roomId);
    const member = toPermMember(viewer.member);
    const value = channel
      ? channelPermissions({
          user: { id: viewer.user._id, privileged: viewer.user.privileged ?? false },
          server: toPermServer(this.server()),
          channel: { defaultPermissions: channel.default_permissions, rolePermissions: channel.role_permissions },
          member,
          nowMs: now,
        })
      : 0n;
    // A timeout masks permissions until it ends: never serve that mask longer.
    const timeoutUntil = member.timeoutUntil ?? null;
    const until = timeoutUntil !== null && timeoutUntil > now ? timeoutUntil : Number.POSITIVE_INFINITY;
    this.permMemo.set(key, { value, until });
    return value;
  }

  canView(viewer: Viewer, roomId: string): boolean {
    return has(this.perms(viewer, roomId), Perm.ViewChannel);
  }

  /** Permission to be in the room (Stoat ViewChannel + Connect). */
  canEnter(viewer: Viewer, roomId: string): boolean {
    return has(this.perms(viewer, roomId), Perm.ViewChannel | Perm.Connect);
  }

  /** The door opens for a newcomer: permission and a free place (voice.max_users). */
  doorOpenFor(viewer: Viewer, roomId: string): boolean {
    if (!this.canEnter(viewer, roomId)) return false;
    const cap = this.capacity(roomId);
    return cap === null || this.occupants(roomId) < cap;
  }

  /** A member's roles or flags changed: recompute what they see and where they may be. */
  /** Forget what was computed for this person (roles, overrides or membership changed). */
  invalidatePerms(userId: string) {
    const prefix = `${userId}\u0000`;
    for (const k of [...this.permMemo.keys()]) if (k.startsWith(prefix)) this.permMemo.delete(k);
  }

  memberChanged(userId: string, member: StoatMember | null) {
    this.invalidatePerms(userId);
    this.presenceDirty = true;
    // Watch-only sessions follow the same membership and roles.
    for (const s of this.observersOf(userId)) {
      if (!member) {
        s.close(4403, "not a member");
        this.observers.delete(s);
      } else (s.viewer as { member: StoatMember }).member = member;
    }
    const a = this.avatars.get(userId);
    if (!a) return;
    if (!member) {
      a.session?.close(4403, "not a member");
      this.evict(userId);
      return;
    }
    // The session shares this object: both see the new roles.
    (a.viewer as { member: StoatMember }).member = member;
    this.afterStructureChange(false);
  }

  hasAvatar(userId: string): boolean {
    return this.avatars.has(userId);
  }

  // ---- MediaHost -------------------------------------------------------------

  desiredRoom(userId: string): string | null {
    const a = this.avatars.get(userId);
    return a && !a.evicted ? a.move.room : null;
  }

  viewerOf(userId: string): Viewer | null {
    return this.avatars.get(userId)?.viewer ?? null;
  }

  displayName(userId: string): string {
    return this.avatars.get(userId)?.name ?? userId;
  }

  capacity(roomId: string): number | null {
    const max = this.cache.channels.get(roomId)?.voice?.max_users;
    return typeof max === "number" && Number.isSafeInteger(max) && max > 0 ? max : null;
  }

  occupants(roomId: string): number {
    let n = 0;
    for (const a of this.avatars.values()) if (!a.evicted && a.move.room === roomId) n++;
    return n;
  }

  hasRoom(roomId: string): boolean {
    // `ix` exists once init() built the map; before that this space owns nothing.
    return this.ix?.roomsById.has(roomId) ?? false;
  }

  private avatarVisibleTo(viewer: Viewer, a: Avatar): boolean {
    if (a.userId === viewer.user._id) return true;
    if (!a.move.room) return true;
    const me = this.avatars.get(viewer.user._id);
    if (me?.move.room === a.move.room) return true;
    return this.canView(viewer, a.move.room);
  }

  roomViews(viewer: Viewer): RoomView[] {
    const occupants = new Map<string, string[]>();
    for (const a of this.avatars.values()) {
      // Evicted avatars leave on the next tick: never count them.
      if (!a.move.room || a.evicted) continue;
      const list = occupants.get(a.move.room) ?? [];
      list.push(a.userId);
      occupants.set(a.move.room, list);
    }
    return this.map.rooms.map((r) => {
      const visible = this.canView(viewer, r.roomId);
      return {
        room_id: r.roomId,
        label: visible ? r.label : null,
        private: !this.everyoneCanView(r.roomId),
        can_enter: this.canEnter(viewer, r.roomId),
        occupants: visible ? (occupants.get(r.roomId) ?? []) : null,
        capacity: visible ? this.capacity(r.roomId) : null,
      };
    });
  }

  /** Wing titles (category names) only for wings with at least one room the viewer can view. */
  wingViews(viewer: Viewer): WingView[] {
    return this.map.wings.map((w) => {
      const visible = this.map.rooms.some((r) => r.wingIndex === w.index && this.canView(viewer, r.roomId));
      return { index: w.index, title: visible ? w.title : null };
    });
  }

  /** A room is "private" when a plain member (no roles) cannot view it. */
  private everyoneCanView(roomId: string): boolean {
    const channel = this.cache.channels.get(roomId);
    if (!channel) return false;
    const p = channelPermissions({
      user: { id: "\u0000nobody" },
      server: toPermServer(this.server()),
      channel: { defaultPermissions: channel.default_permissions, rolePermissions: channel.role_permissions },
      member: { roles: [] },
      nowMs: this.now(),
    });
    return has(p, Perm.ViewChannel);
  }

  // ---- presence (ADR 0008) ---------------------------------------------------

  /**
   * The sweeper's pass (every 5 s): who LiveKit admitted in each managed room,
   * with their tracks. Only rooms of this space are kept; a room that could
   * not be listed keeps its last known state.
   */
  observeLiveKit(rooms: Map<string, ParticipantLite[]>, failed: Set<string>) {
    const now = this.now();
    const next = new Map<string, SeenInLiveKit>();
    for (const [identity, seen] of this.lkSeen) if (failed.has(seen.room)) next.set(identity, seen);
    for (const [roomName, participants] of rooms) {
      const parsed = parseManagedRoomName(roomName);
      if (!parsed || !this.hasRoom(parsed.roomId)) continue;
      for (const p of participants) {
        const tracks = p.tracks ?? [];
        const open = (source: string) => tracks.some((t) => t.source === source && !t.muted);
        next.set(p.identity, {
          room: roomName,
          mic: open("microphone"),
          camera: open("camera"),
          screen: open("screen_share"),
          at: now,
        });
      }
    }
    this.lkSeen = next;
    this.presenceDirty = true;
  }

  /** The client says what its call is doing (sent on change; rate limited by the gateway). */
  reportVoice(session: SessionPort, report: VoiceReport): void {
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session || !a.move.room) return;
    a.report = { ...report, at: this.now() };
    this.presenceDirty = true;
  }

  /**
   * The person's call in their room, as others see it: null when they are in
   * the room without its call. LiveKit's last pass wins over an older hint;
   * a newer hint (a mute just now) shows until the next pass confirms it.
   */
  private voiceOf(a: Avatar): PresenceVoice | null {
    if (!a.move.room || a.evicted) return null;
    const holder = this.media?.holder(a.userId);
    if (!holder || holder.roomId !== a.move.room) return null;
    const lk = this.lkSeen.get(holder.identity);
    const r = a.report;
    const hint = r && (!lk || r.at >= lk.at) ? r : null;
    return {
      connected: hint ? hint.connected : Boolean(lk),
      mic: hint ? hint.mic : Boolean(lk?.mic),
      deaf: r?.deaf ?? false,
      camera: hint ? hint.camera : Boolean(lk?.camera),
      screen: hint ? hint.screen : Boolean(lk?.screen),
    };
  }

  private personOf(a: Avatar): PresencePerson {
    return {
      user_id: a.userId,
      name: a.name,
      state: a.session ? (a.idle ? "idle" : "online") : "reconnecting",
      voice: this.voiceOf(a),
    };
  }

  /** Everyone, by room, once per flush; each viewer then gets the rooms they may view. */
  private buildPresence(): { byRoom: Map<string, PresencePerson[]>; outside: PresencePerson[] } {
    const byRoom = new Map<string, PresencePerson[]>();
    const outside: PresencePerson[] = [];
    for (const a of this.avatars.values()) {
      if (a.evicted) continue;
      const p = this.personOf(a);
      if (!a.move.room) outside.push(p);
      else {
        const list = byRoom.get(a.move.room) ?? [];
        list.push(p);
        byRoom.set(a.move.room, list);
      }
    }
    const byName = (x: PresencePerson, y: PresencePerson) => x.name.localeCompare(y.name) || x.user_id.localeCompare(y.user_id);
    for (const list of byRoom.values()) list.sort(byName);
    outside.sort(byName);
    return { byRoom, outside };
  }

  /** Who is where as this viewer may see it (private rooms they cannot view are left out). */
  presenceFor(viewer: Viewer): PresenceEvent["d"] {
    return this.presenceFrom(viewer, this.buildPresence());
  }

  private presenceFrom(
    viewer: Viewer,
    built: { byRoom: Map<string, PresencePerson[]>; outside: PresencePerson[] },
  ): PresenceEvent["d"] {
    const rooms = [];
    for (const [roomId, people] of built.byRoom) {
      if (this.ix.roomsById.has(roomId) && this.canView(viewer, roomId)) {
        rooms.push({ room_id: roomId, people, tv: this.tv.state(roomId)?.status ?? null });
      }
    }
    rooms.sort((x, y) => x.room_id.localeCompare(y.room_id));
    return { rooms, outside: built.outside };
  }

  private sendPresence(session: SessionPort, built = this.buildPresence()) {
    const d = this.presenceFrom(session.viewer, built);
    const json = JSON.stringify(d);
    if (this.presenceSent.get(session) === json) return;
    this.presenceSent.set(session, json);
    session.send({ v: 1, t: "space.presence", d });
  }

  /** At most every 250 ms when something changed, and every second regardless (async media). */
  private flushPresence() {
    const now = this.now();
    const since = now - this.presenceAt;
    if (since < PRESENCE_MIN_MS) return;
    if (!this.presenceDirty && since < PRESENCE_RECHECK_MS) return;
    this.presenceAt = now;
    this.presenceDirty = false;
    const built = this.buildPresence();
    for (const a of this.avatars.values()) if (a.session) this.sendPresence(a.session, built);
    for (const s of this.observers) this.sendPresence(s, built);
  }

  /** A watch-only session (the sidebar): presence now and on every change. */
  observe(session: SessionPort): void {
    this.invalidatePerms(session.viewer.user._id);
    const mine = this.observersOf(session.viewer.user._id);
    // Bounded per person: the oldest gives way.
    while (mine.length >= MAX_OBSERVERS_PER_USER) {
      const oldest = mine.shift()!;
      oldest.close(4001, "too many watchers");
      this.observers.delete(oldest);
    }
    this.observers.add(session);
    this.sendPresence(session);
  }

  unobserve(session: SessionPort): void {
    this.observers.delete(session);
  }

  hasObserver(userId: string): boolean {
    return this.observersOf(userId).length > 0;
  }

  private observersOf(userId: string): SessionPort[] {
    return [...this.observers].filter((s) => s.viewer.user._id === userId);
  }

  get observerCount(): number {
    return this.observers.size;
  }

  /**
   * A moderator ends someone's screen share in the room both are in: Stoat's
   * MuteMembers on that room (the voice moderation permission). LiveKit mutes
   * the shared tracks and the sharer's app stops sharing; audited in the log.
   */
  async stopScreen(session: SessionPort, cmdId: string, targetId: string): Promise<void> {
    const fail = (code: string, reason?: string) =>
      session.send({ v: 1, t: "error", re: cmdId, d: { code, ...(reason ? { reason } : {}) } });
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session) return;
    const room = a.move.room;
    const target = this.avatars.get(targetId);
    if (!room || !target || target.evicted || target.move.room !== room) return fail("not_found");
    if (!has(this.perms(session.viewer, room), Perm.MuteMembers)) return fail("not_allowed");
    const stopped = (await this.media?.stopScreen(targetId).catch(() => false)) ?? false;
    if (!stopped) return fail("not_found", "no_screen");
    target.session?.send({ v: 1, t: "screen.stopped", d: { room_id: room, by: a.userId } });
    session.send({ v: 1, t: "screen.stop.ok", re: cmdId, d: { user_id: targetId } });
    this.log.info("screen share stopped by moderator", { server: this.serverId, room, actor: a.userId, target: targetId });
  }

  // ---- sessions ------------------------------------------------------------

  private view(a: Avatar): AvatarView {
    return {
      user_id: a.userId,
      name: a.name,
      look: a.look,
      x: a.move.pos.x,
      y: a.move.pos.y,
      dir: a.dir,
      moving: a.moving,
      room: a.move.room,
      state: a.session ? (a.idle ? "idle" : "online") : "reconnecting",
      ...(a.hero ? { hero: { ...a.hero } } : {}),
    };
  }

  /**
   * Before join, for a person not on the map: after a restart, a lease the
   * previous process wrote may still hold them in a room (their call never
   * dropped, LiveKit is separate). Adopt it and put them back in that room.
   */
  async prepareJoin(viewer: Viewer, maxWaitMs = 2_000): Promise<void> {
    const userId = viewer.user._id;
    if (!this.media || this.avatars.has(userId)) return;
    const recovered = this.media.recover(userId, (roomId) =>
      this.canEnter(viewer, roomId) ? this.perms(viewer, roomId) : null,
    );
    // Never hold the hello for long. If recovery finishes after the join, the
    // avatar is in the lobby and the join's resume step revokes the adopted grant.
    const room = await Promise.race([recovered, new Promise<null>((r) => setTimeout(() => r(null), maxWaitMs).unref?.())]);
    if (room && !this.avatars.has(userId)) this.resumeAt.set(userId, room);
  }

  join(session: SessionPort, look: AvatarLook = { palette: defaultPalette(session.viewer.user._id) }): void {
    const { user } = session.viewer;
    const name = session.viewer.member.nickname || user.display_name || user.username;
    // The hello brought a freshly fetched member: nothing cached before applies.
    this.invalidatePerms(user._id);
    let a = this.avatars.get(user._id);
    if (a && !a.evicted) {
      a.look = look;
      // Same person back within the grace period (or another tab replacing the
      // old one — the gateway closed that session already): keep the spot,
      // unless the room is no longer theirs to be in.
      a.session = session;
      a.viewer = session.viewer;
      a.disconnectedAt = null;
      a.name = name;
      if (a.move.room && !this.canEnter(session.viewer, a.move.room)) {
        a.move = { ...a.move, pos: this.exitPoint(a.move.room), room: null };
      }
    } else {
      const resume = this.resumeAt.get(user._id);
      this.resumeAt.delete(user._id);
      // After a restart: the exact spot (and the dummy) the previous process saw.
      const spot = this.resumeSpots.get(user._id);
      this.resumeSpots.delete(user._id);
      const start = spot && this.now() <= this.resumeSpotsUntil ? this.spotStart(session.viewer, spot) : null;
      const room = resume ? this.ix.roomsById.get(resume) : undefined;
      const spawn = this.map.spawns[this.avatars.size % this.map.spawns.length] ?? this.map.spawns[0]!;
      a = {
        userId: user._id,
        viewer: session.viewer,
        name,
        look,
        move: start
          ? initialMoveState(start.pos, start.room, this.now())
          : room
            ? initialMoveState(tileCenter(room.inside), room.roomId, this.now())
            : initialMoveState(tileCenter(spawn), null, this.now()),
        dir: "down",
        moving: false,
        idle: false,
        session,
        disconnectedAt: null,
        evicted: false,
        dirty: false,
        report: null,
        hero: null,
        heroLook: null,
      };
      this.avatars.set(user._id, a);
      // Trained there before the restart: goes on training (the hero document kept the session).
      if (start?.training) this.trainingAt.set(user._id, start.training);
    }
    a.dirty = true;
    const visible = new Set<string>();
    const avatars: AvatarView[] = [];
    for (const other of this.avatars.values()) {
      if (other.userId !== user._id && this.avatarVisibleTo(session.viewer, other)) {
        visible.add(other.userId);
        avatars.push(this.view(other));
      }
    }
    this.visibleTo.set(user._id, visible);
    const snapshot: Omit<SnapshotEvent, "sv"> = {
      v: 1,
      t: "space.snapshot",
      d: {
        server_id: this.serverId,
        layout: { fingerprint: this.map.fingerprint, url: this.layoutUrl() },
        decor: { rev: this.decor.rev, url: this.decorUrl(), settings: this.decor.settings },
        you: {
          user_id: user._id,
          name,
          look: a.look,
          x: a.move.pos.x,
          y: a.move.pos.y,
          room: a.move.room,
          seq: a.move.seq,
          decor: this.decorRights(session.viewer),
        },
        rooms: this.roomViews(session.viewer),
        wings: this.wingViews(session.viewer),
        avatars,
        game: { available: this.gameAvailable, enabled: this.gameAccess(session.viewer) === "ok" },
      },
    };
    session.send(snapshot as unknown as Record<string, unknown>);
    this.presenceDirty = true;
    this.sendPresence(session);
    // Back inside a room (reconnect, new tab, restart): its TV where it is now.
    if (a.move.room) this.tv.entered(session, a.move.room);
    // O próprio grupo vai sempre, mesmo fora de uma sala (27/11/2026): quem recarregava no hall não
    // sabia do grupo até a próxima corrida, e a ficha aberta não segurava a largada do loop.
    this.sendLobbiesTo(session, a.move.room);
    if (a.move.room) this.onRoomEntered?.(user._id, a.move.room);
    // Reconnected away from the dummy: the training that went on offline closes now.
    this.checkTraining(user._id);
    // The hero's level under the name, where the game is on.
    if (this.gameAvailable && this.decor.settings.game !== "off") this.onAvatarJoined?.(user._id);
    // A token for media this person already holds here (new tab, reconnect,
    // restart), or the reason they have none.
    this.media?.resume(user._id);
  }

  /** Socket gone: keep the avatar as "reconnecting" for the grace period. */
  leave(session: SessionPort): void {
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session) return;
    a.session = null;
    a.disconnectedAt = this.now();
    a.dirty = true;
    this.presenceDirty = true;
    // The dungeon group stays (24/11/2026): it goes only when the reconnect grace ends. A sheet
    // or NPC they had open does not hold the group's start any more (the app says so again).
    const held = this.lobbies.setPrep(a.userId, null, this.now());
    if (held) this.broadcastLobby(held, true, {});
  }

  /**
   * The person must go now, without grace: their Stoat session ended or they
   * are no longer a member. Media is revoked at once; the avatar leaves the
   * others' screens on the next tick.
   */
  evict(userId: string): void {
    const a = this.avatars.get(userId);
    if (!a || a.evicted) return;
    a.evicted = true;
    a.session = null;
    this.checkTraining(userId);
    this.lobbyLeave(userId);
    a.disconnectedAt = Number.NEGATIVE_INFINITY;
    a.dirty = true;
    this.presenceDirty = true;
    this.media?.sync(userId, "refresh");
  }

  /** The client asks for a media token for its room (connect failed, "Usar aqui"). */
  requestMedia(session: SessionPort): boolean {
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session || !this.media) return true;
    return this.media.request(a.userId);
  }

  move(session: SessionPort, cmd: { seq: number; x: number; y: number; dir: Direction; moving: boolean }): void {
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session) return;
    const out = applyMove(this.ix, a.move, cmd, this.now(), (roomId) => this.doorOpenFor(session.viewer, roomId));
    if (out.kind === "stale") return;
    const before = a.move.room;
    a.move = out.state;
    a.dirty = true;
    this.checkTraining(a.userId);
    // Walking in or out is the only thing that moves media between rooms.
    if (a.move.room !== before) {
      a.report = null;
      this.presenceDirty = true;
      this.media?.sync(a.userId, "entry");
      // The room's TV as it is now (the newcomer joins the session in progress).
      if (a.move.room) this.tv.entered(session, a.move.room);
      this.lobbyRoomChanged(a.userId, a.move.room);
    }
    if (out.kind === "accepted") {
      a.dir = cmd.dir;
      a.moving = cmd.moving;
      return;
    }
    a.moving = false;
    session.send({
      v: 1,
      t: "avatar.correction",
      d: { x: a.move.pos.x, y: a.move.pos.y, room: a.move.room, seq: a.move.seq, reason: out.reason },
    });
  }

  /** The person picked another character look: everyone who sees them redraws it. */
  updateLook(userId: string, look: AvatarLook): void {
    const a = this.avatars.get(userId);
    if (!a || a.look.palette === look.palette) return;
    a.look = look;
    a.dirty = true;
  }

  setIdle(session: SessionPort, idle: boolean): void {
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session || a.idle === idle) return;
    a.idle = idle;
    a.dirty = true;
    this.presenceDirty = true;
  }

  /**
   * 10 Hz: one batch per viewer with the avatars that changed and that viewer
   * may see; avatars that became invisible (entered a room the viewer cannot
   * view) are sent as `gone`, never as a position.
   */
  tick(): void {
    const now = this.now();
    const removed: string[] = [];
    for (const a of this.avatars.values()) {
      if (!a.session && a.disconnectedAt !== null && now - a.disconnectedAt >= DISCONNECT_GRACE_MS) removed.push(a.userId);
    }
    for (const id of removed) {
      // Gone for good (the grace ended): out of the dungeon group too.
      this.lobbyLeave(id);
      this.avatars.delete(id);
      this.invalidatePerms(id);
      this.media?.sync(id, "refresh"); // no room any more: revoke
    }
    if (removed.length) this.presenceDirty = true;
    // Grupo restaurado no reinício: quem não reconectou a tempo sai dele (como no fim da carência).
    for (const [id, until] of this.restoredGrace) {
      if (this.avatars.get(id)?.session) this.restoredGrace.delete(id);
      else if (now >= until) {
        this.restoredGrace.delete(id);
        this.lobbyLeave(id);
      }
    }
    this.flushPresence();
    this.tv.tick();
    for (const lobby of this.lobbies.expire(now)) this.broadcastLobby(lobby, false, { ended: "expired" });
    // The loop's next run is due: its start is asked for (it waits like the leader's).
    for (const lobby of this.lobbies.loopDue(now)) this.broadcastLobby(lobby, true, {});
    // A start held too long by someone preparing gives up (everyone sees who).
    for (const lobby of this.lobbies.holdTimeouts(now)) this.broadcastLobby(lobby, true, {});
    // The countdown ended: the game service reads the heroes and starts the run for the leader.
    for (const lobby of this.lobbies.launchDue(now)) this.onLobbyDue?.(lobby.leader, lobby.id, lobby.pendingAuto);
    const dirty = [...this.avatars.values()].filter((a) => a.dirty);
    if (dirty.length === 0 && removed.length === 0) return;
    for (const viewerAvatar of this.avatars.values()) {
      const session = viewerAvatar.session;
      if (!session) continue;
      const seen = this.visibleTo.get(viewerAvatar.userId) ?? new Set<string>();
      const changed: AvatarView[] = [];
      const gone: string[] = [];
      for (const a of dirty) {
        if (a.userId === viewerAvatar.userId) continue;
        if (this.avatarVisibleTo(session.viewer, a)) {
          seen.add(a.userId);
          changed.push(this.view(a));
        } else if (seen.delete(a.userId)) gone.push(a.userId);
      }
      for (const id of removed) if (seen.delete(id)) gone.push(id);
      this.visibleTo.set(viewerAvatar.userId, seen);
      if (changed.length || gone.length) session.send({ v: 1, t: "avatar.positions", d: { avatars: changed, gone } });
    }
    for (const a of dirty) a.dirty = false;
    for (const id of removed) this.visibleTo.delete(id);
  }

  get sessionCount(): number {
    let n = 0;
    for (const a of this.avatars.values()) if (a.session) n++;
    return n;
  }

  /** The current session of a user here (used by the gateway to replace it). */
  sessionOf(userId: string): SessionPort | null {
    return this.avatars.get(userId)?.session ?? null;
  }

  closeAll(code: number, reason: string) {
    for (const a of this.avatars.values()) a.session?.close(code, reason);
    for (const s of this.observers) s.close(code, reason);
    this.observers.clear();
  }

  /** The space is gone (server deleted, bot removed): every media grant here ends. */
  dispose() {
    for (const a of this.avatars.values()) {
      a.evicted = true;
      a.session = null;
    }
    this.media?.dispose();
    this.avatars.clear();
    this.visibleTo.clear();
    this.observers.clear();
  }
}
