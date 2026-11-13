import {
  applyMove,
  type AvatarLook,
  type AvatarView,
  defaultPalette,
  channelPermissions,
  type CompiledMap,
  type CompiledMapWire,
  type Direction,
  generateLayout,
  has,
  indexMap,
  initialMoveState,
  type MapIndex,
  type MoveState,
  Perm,
  type PermMember,
  type PermServer,
  regionAt,
  type RoomView,
  type SnapshotEvent,
  tileCenter,
  type WingView,
} from "@muchat/space-core";

import type { Log } from "../log.ts";
import type { StoatCache } from "../stoat/cache.ts";
import type { StoatMember, StoatServer, StoatTextChannel, StoatUser } from "../stoat/types.ts";
import { type Assignment, reconcile, toLayoutInput } from "./assignment.ts";
import type { AssignmentStore } from "./store.ts";

/** How long a disconnected avatar stays (as "reconnecting") before it leaves. */
export const DISCONNECT_GRACE_MS = 60_000;

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

interface Avatar {
  userId: string;
  name: string;
  look: AvatarLook;
  move: MoveState;
  dir: Direction;
  moving: boolean;
  idle: boolean;
  session: SessionPort | null;
  disconnectedAt: number | null;
  dirty: boolean;
}

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
 * One Stoat server's space: placement, map, avatars and who sees what.
 * Everything runs on the event loop, so per-room decisions are serialized.
 */
export class SpaceRuntime {
  readonly serverId: string;
  private readonly cache: StoatCache;
  private readonly store: AssignmentStore;
  private readonly log: Log;
  private readonly now: () => number;

  private assignment: Assignment | null = null;
  map!: CompiledMap;
  private ix!: MapIndex;
  private mapWire = "";
  private readonly avatars = new Map<string, Avatar>();
  /** Per viewer: avatar ids that viewer currently has on screen. */
  private readonly visibleTo = new Map<string, Set<string>>();
  private permMemo = new Map<string, bigint>();
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;

  constructor(deps: { serverId: string; cache: StoatCache; store: AssignmentStore; log: Log; now?: () => number }) {
    this.serverId = deps.serverId;
    this.cache = deps.cache;
    this.store = deps.store;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
  }

  get layoutFingerprint(): string {
    return this.map.fingerprint;
  }

  get layoutWire(): string {
    return this.mapWire;
  }

  /** Loads placement, reconciles with Stoat, persists (CAS) and builds the map. */
  async init(): Promise<void> {
    await this.reconcileAndBuild();
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
        this.afterStructureChange(mapChanged);
      } while (this.refreshAgain);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private afterStructureChange(mapChanged: boolean) {
    for (const a of this.avatars.values()) {
      const viewer = a.session?.viewer;
      // Out of a room that no longer exists or that this person may no longer enter.
      const stillThere = a.move.room && this.ix.roomsById.has(a.move.room);
      const allowed = a.move.room && viewer ? this.canEnter(viewer, a.move.room) : true;
      if (a.move.room && (!stillThere || !allowed)) this.place(a, this.exitPoint(a.move.room), null);
      else if (mapChanged) {
        const region = regionAt(this.ix, a.move.pos.x, a.move.pos.y);
        if (region.kind === "blocked") this.place(a, tileCenter(this.map.spawns[0]!), null);
      }
    }
    for (const a of this.avatars.values()) {
      if (!a.session) continue;
      if (mapChanged) {
        a.session.send({ v: 1, t: "space.layout.changed", d: { fingerprint: this.map.fingerprint, url: this.layoutUrl() } });
      }
      a.session.send({
        v: 1,
        t: "space.rooms",
        d: { rooms: this.roomViews(a.session.viewer), wings: this.wingViews(a.session.viewer) },
      });
    }
  }

  private exitPoint(roomId: string) {
    const r = this.ix.roomsById.get(roomId);
    return r ? tileCenter(r.outside) : tileCenter(this.map.spawns[0]!);
  }

  private place(a: Avatar, pos: { x: number; y: number }, room: string | null) {
    a.move = { ...a.move, pos: { x: Math.round(pos.x), y: Math.round(pos.y) }, room };
    a.dirty = true;
    a.session?.send({ v: 1, t: "avatar.correction", d: { x: a.move.pos.x, y: a.move.pos.y, room, seq: a.move.seq, reason: "moved" } });
  }

  layoutUrl(): string {
    return `/_muchat/space/v1/spaces/${this.serverId}/layout/${this.map.fingerprint}`;
  }

  // ---- permissions ---------------------------------------------------------

  perms(viewer: Viewer, roomId: string): bigint {
    const key = `${viewer.user._id}\u0000${roomId}`;
    const hit = this.permMemo.get(key);
    if (hit !== undefined) return hit;
    const channel: StoatTextChannel | undefined = this.cache.channels.get(roomId);
    const value = channel
      ? channelPermissions({
          user: { id: viewer.user._id, privileged: viewer.user.privileged ?? false },
          server: toPermServer(this.server()),
          channel: { defaultPermissions: channel.default_permissions, rolePermissions: channel.role_permissions },
          member: toPermMember(viewer.member),
          nowMs: this.now(),
        })
      : 0n;
    this.permMemo.set(key, value);
    return value;
  }

  canView(viewer: Viewer, roomId: string): boolean {
    return has(this.perms(viewer, roomId), Perm.ViewChannel);
  }

  canEnter(viewer: Viewer, roomId: string): boolean {
    return has(this.perms(viewer, roomId), Perm.ViewChannel | Perm.Connect);
  }

  /** A member's roles or flags changed: recompute what they see and where they may be. */
  memberChanged(userId: string, member: StoatMember | null) {
    for (const k of [...this.permMemo.keys()]) if (k.startsWith(`${userId}\u0000`)) this.permMemo.delete(k);
    const a = this.avatars.get(userId);
    if (!a?.session) return;
    if (!member) {
      a.session.close(4403, "not a member");
      return;
    }
    (a.session.viewer as { member: StoatMember }).member = member;
    this.afterStructureChange(false);
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
      if (!a.move.room) continue;
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
    };
  }

  join(session: SessionPort, look: AvatarLook = { palette: defaultPalette(session.viewer.user._id) }): void {
    const { user } = session.viewer;
    const name = session.viewer.member.nickname || user.display_name || user.username;
    let a = this.avatars.get(user._id);
    if (a) {
      a.look = look;
      // Same person back within the grace period (or another tab replacing the
      // old one — the gateway closed that session already): keep the spot,
      // unless the room is no longer theirs to be in.
      a.session = session;
      a.disconnectedAt = null;
      a.name = name;
      if (a.move.room && !this.canEnter(session.viewer, a.move.room)) {
        a.move = { ...a.move, pos: this.exitPoint(a.move.room), room: null };
      }
    } else {
      const spawn = this.map.spawns[this.avatars.size % this.map.spawns.length] ?? this.map.spawns[0]!;
      a = {
        userId: user._id,
        name,
        look,
        move: initialMoveState(tileCenter(spawn), null, this.now()),
        dir: "down",
        moving: false,
        idle: false,
        session,
        disconnectedAt: null,
        dirty: false,
      };
      this.avatars.set(user._id, a);
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
        you: { user_id: user._id, name, look: a.look, x: a.move.pos.x, y: a.move.pos.y, room: a.move.room, seq: a.move.seq },
        rooms: this.roomViews(session.viewer),
        wings: this.wingViews(session.viewer),
        avatars,
      },
    };
    session.send(snapshot as unknown as Record<string, unknown>);
  }

  /** Socket gone: keep the avatar as "reconnecting" for the grace period. */
  leave(session: SessionPort): void {
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session) return;
    a.session = null;
    a.disconnectedAt = this.now();
    a.dirty = true;
  }

  move(session: SessionPort, cmd: { seq: number; x: number; y: number; dir: Direction; moving: boolean }): void {
    const a = this.avatars.get(session.viewer.user._id);
    if (!a || a.session !== session) return;
    const out = applyMove(this.ix, a.move, cmd, this.now(), (roomId) => this.canEnter(session.viewer, roomId));
    if (out.kind === "stale") return;
    a.move = out.state;
    a.dirty = true;
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
    for (const id of removed) this.avatars.delete(id);
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
  }
}
