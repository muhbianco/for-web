import {
  has,
  type LeaseV1,
  managedRoomName,
  type MediaSourceName,
  parseManagedRoomName,
  Perm,
} from "@muchat/space-core";

import type { Log } from "../log.ts";
import { type MediaController, type MediaGrant } from "../media/controller.ts";
import type { LiveKitAdmin } from "../media/ports.ts";
import type { SessionPort, Viewer } from "./runtime.ts";

/** What media needs to know about one space; SpaceRuntime implements it. */
export interface MediaHost {
  readonly serverId: string;
  /** The room this person is in (connected or within the reconnect grace), or null. */
  desiredRoom(userId: string): string | null;
  /** Last known viewer of an avatar here (also while it reconnects). */
  viewerOf(userId: string): Viewer | null;
  sessionOf(userId: string): SessionPort | null;
  displayName(userId: string): string;
  /** Stoat voice.max_users; null = unlimited. */
  capacity(roomId: string): number | null;
  perms(viewer: Viewer, roomId: string): bigint;
  occupants(roomId: string): number;
  hasRoom(roomId: string): boolean;
}

/**
 * Why a reconcile runs. Only `entry` (the person walked into a room, or asked
 * for media with "Usar aqui") may take media away from another space where the
 * same person also stands in a room; background events never do, or two open
 * spaces would keep stealing it from each other.
 */
export type SyncIntent = "entry" | "refresh";

interface Granted {
  space: RoomMedia;
  roomId: string;
  roomName: string;
  identity: string;
  /** Sources + subscribe of the token; a change (role edited) needs a new grant. */
  shape: string;
}

/** A grant's allowed sources and subscribe flag, from Stoat permissions (same as delta's join_call). */
export function grantShape(perm: bigint): { sources: MediaSourceName[]; canSubscribe: boolean } {
  const sources: MediaSourceName[] = [];
  if (has(perm, Perm.Speak)) sources.push("microphone");
  if (has(perm, Perm.Video)) sources.push("camera", "screen_share", "screen_share_audio");
  return { sources, canSubscribe: has(perm, Perm.Listen) };
}

const LIVEKIT_UNLIMITED = 0;
export const REQUEST_COOLDOWN_MS = 3_000;
/** After a start, managed rooms of spaces nobody reopened yet are kept this long (leases still apply). */
export const STARTUP_GRACE_MS = 150_000;
const PEEK_TIMEOUT_MS = 1_500;

export interface MediaHubDeps {
  media: MediaController;
  log: Log;
  /** Wait before minting for a fresh entry, so a quick in-and-out mints nothing. */
  debounceMs?: number;
  now?: () => number;
  startupGraceMs?: number;
}

/**
 * Media of the whole process (ADR 0001/0003). A person has at most one lease,
 * whatever the number of spaces they have open, so the bookkeeping lives here:
 * one promise chain per person serializes every step (no two grants race, and
 * a cancelled transition never leaves a lease behind), and one map says which
 * space holds each person's media.
 *
 * Each step compares where the person IS (the space's desiredRoom) with the
 * media they HAVE and fixes the difference. The ordering is the security
 * contract, enforced by MediaController: revoke = lease gone → participant
 * removed; grant = previous removal confirmed → lease → room → token. When in
 * doubt, no media: presence stays and the client gets media.unavailable.
 */
export class MediaHub {
  private readonly media: MediaController;
  private readonly log: Log;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly startupGraceMs: number;
  private readonly spaces = new Set<RoomMedia>();
  private readonly granted = new Map<string, Granted>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly force = new Set<string>();
  private readonly lastRequest = new Map<string, number>();
  private renewTimer: ReturnType<typeof setInterval> | undefined;
  private renewing = false;

  constructor(deps: MediaHubDeps) {
    this.media = deps.media;
    this.log = deps.log;
    this.debounceMs = deps.debounceMs ?? 300;
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
    this.startupGraceMs = deps.startupGraceMs ?? STARTUP_GRACE_MS;
  }

  register(space: RoomMedia) {
    this.spaces.add(space);
  }

  /**
   * For the sweeper: is `roomName` the live epoch of a room of an open space?
   * Rooms of spaces not reopened since the start are kept during the startup
   * grace, so a redeploy does not cut calls; their participants still need a
   * lease, and leases lapse in 120 s unless the person comes back.
   */
  isCurrentRoom(roomName: string): boolean {
    const parsed = parseManagedRoomName(roomName);
    if (!parsed) return false;
    for (const s of this.spaces) if (s.host.hasRoom(parsed.roomId)) return s.isCurrent(roomName);
    return this.now() - this.startedAt < this.startupGraceMs;
  }

  /** Who holds this person's media (tests, metrics). */
  holderOf(userId: string): { serverId: string; roomId: string; identity: string } | null {
    const g = this.granted.get(userId);
    return g ? { serverId: g.space.host.serverId, roomId: g.roomId, identity: g.identity } : null;
  }

  get grantCount(): number {
    return this.granted.size;
  }

  // ---- entry points (all queued on the person's chain) ----------------------

  sync(space: RoomMedia, userId: string, intent: SyncIntent) {
    this.enqueue(userId, () => this.reconcile(space, userId, intent));
  }

  /** "Give me a token for my room": reissue when the grant is ours, else enter. */
  request(space: RoomMedia, userId: string): boolean {
    const now = this.now();
    if (now - (this.lastRequest.get(userId) ?? -Infinity) < REQUEST_COOLDOWN_MS) return false;
    this.lastRequest.set(userId, now);
    this.enqueue(userId, async () => {
      const g = this.granted.get(userId);
      if (g && g.space === space) await this.reissueOrRegrant(space, userId, g);
      else await this.reconcile(space, userId, "entry");
    });
    return true;
  }

  /** A session (re)joined this space: hand it a token for media it holds, or say where it is. */
  resume(space: RoomMedia, userId: string) {
    this.enqueue(userId, async () => {
      const desired = space.host.desiredRoom(userId);
      const g = this.granted.get(userId);
      if (g && g.space === space) return this.reissueOrRegrant(space, userId, g);
      if (desired === null) return;
      if (g) {
        space.host.sessionOf(userId)?.send({ v: 1, t: "media.unavailable", d: { room_id: desired, reason: "elsewhere" } });
        return;
      }
      await this.reconcile(space, userId, "refresh");
    });
  }

  /**
   * After a restart, for a person not on this space's map yet: the lease a
   * previous process wrote for them. If it is for a room of this space, at an
   * epoch this space accepts, and `permFor` says they may still be there, it
   * becomes this space's grant (same identity: their call never drops) and the
   * room id is returned so the avatar is put back in it. A lease for a room of
   * this space they may no longer enter is revoked now instead of lapsing.
   * Runs on the person's chain, like every other media step.
   */
  recover(space: RoomMedia, userId: string, permFor: (roomId: string) => bigint | null): Promise<string | null> {
    let room: string | null = null;
    return this.enqueue(userId, async () => {
      room = await this.recoverStep(space, userId, permFor);
    }).then(() => room);
  }

  private async recoverStep(
    space: RoomMedia,
    userId: string,
    permFor: (roomId: string) => bigint | null,
  ): Promise<string | null> {
    if (this.granted.has(userId)) return null;
    let lease: LeaseV1 | null;
    try {
      lease = await withTimeout(this.media.peekLease(userId), PEEK_TIMEOUT_MS);
    } catch {
      return null;
    }
    if (!lease || lease.server_id !== space.host.serverId || this.granted.has(userId)) return null;
    const parsed = parseManagedRoomName(lease.room_name);
    if (!parsed || parsed.roomId !== lease.room_id || !space.host.hasRoom(parsed.roomId)) return null;
    // Old epoch: that room is dead, the sweeper removes whoever is in it.
    if (!space.acceptsEpoch(parsed.roomId, parsed.epoch)) return null;
    const perm = permFor(parsed.roomId);
    if (perm === null) {
      // Lost access while we were down: end it now, not when the lease lapses.
      await this.media.revoke(userId).catch(() => undefined);
      this.log.info("media lease dropped on recovery", { server: space.host.serverId, user: userId, room: parsed.roomId });
      return null;
    }
    space.adoptEpoch(parsed.roomId, parsed.epoch);
    this.media.adopt(lease);
    this.granted.set(userId, {
      space,
      roomId: parsed.roomId,
      roomName: lease.room_name,
      identity: lease.identity,
      shape: JSON.stringify(grantShape(perm)),
    });
    this.log.info("media lease adopted", { server: space.host.serverId, user: userId, room: parsed.roomId });
    return parsed.roomId;
  }

  /** Roles or channel overrides changed: re-grant where the token's shape no longer matches. */
  permissionsChanged(space: RoomMedia) {
    for (const [userId, g] of this.granted) {
      if (g.space !== space) continue;
      const viewer = space.host.viewerOf(userId);
      if (!viewer) {
        this.sync(space, userId, "refresh");
        continue;
      }
      if (JSON.stringify(grantShape(space.host.perms(viewer, g.roomId))) !== g.shape) {
        this.force.add(userId);
        this.sync(space, userId, "refresh");
      }
    }
  }

  /** The space closed (server gone): every grant it holds ends. */
  dropSpace(space: RoomMedia) {
    this.spaces.delete(space);
    for (const [userId, g] of this.granted) {
      if (g.space !== space) continue;
      this.enqueue(userId, async () => {
        const cur = this.granted.get(userId);
        if (cur?.space === space) await this.revoke(userId, cur, "left").catch(() => undefined);
      });
    }
  }

  startRenewals(intervalMs = 30_000) {
    this.renewTimer ??= setInterval(() => void this.renewAll(), intervalMs);
    this.renewTimer.unref?.();
  }

  stop() {
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = undefined;
  }

  /** Waits for every queued step (tests, shutdown). */
  async settle(): Promise<void> {
    while (this.chains.size > 0) await Promise.all([...this.chains.values()]);
  }

  // ---- internals -------------------------------------------------------------

  /** Queues a step on the person's chain; the promise settles when it ran (never rejects). */
  private enqueue(userId: string, step: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(userId) ?? Promise.resolve();
    const next = prev
      .then(step)
      .catch((err) => this.log.error("media step failed", { user: userId, err: String(err) }));
    this.chains.set(userId, next);
    void next.finally(() => {
      if (this.chains.get(userId) === next) this.chains.delete(userId);
    });
    return next;
  }

  private send(space: RoomMedia, userId: string, event: Record<string, unknown>) {
    space.host.sessionOf(userId)?.send(event);
  }

  private sendGrant(space: RoomMedia, userId: string, roomId: string, g: MediaGrant, shape: ReturnType<typeof grantShape>) {
    this.send(space, userId, {
      v: 1,
      t: "media.grant",
      d: {
        room_id: roomId,
        url: g.url,
        token: g.token,
        identity: g.identity,
        sources: shape.sources,
        can_subscribe: shape.canSubscribe,
        expires_at: g.expiresAt,
      },
    });
  }

  /**
   * Ends a grant: admission closed and the participant removed (confirmed), the
   * client told, the room's epoch turned when it is now empty. Throws
   * MediaUnavailable when removal could not be confirmed; the grant is dropped
   * either way (its lease is gone, the sweeper finishes the removal).
   */
  private async revoke(userId: string, g: Granted, reason: "left" | "access" | "regrant" | "elsewhere") {
    try {
      await this.media.revoke(userId, { confirm: true });
    } finally {
      this.granted.delete(userId);
      this.send(g.space, userId, { v: 1, t: "media.revoked", d: { room_id: g.roomId, reason } });
      if (![...this.granted.values()].some((o) => o.space === g.space && o.roomId === g.roomId)) {
        g.space.maybeRotate(g.roomId);
      }
    }
  }

  private async reconcile(space: RoomMedia, userId: string, intent: SyncIntent): Promise<void> {
    for (let round = 0; round < 4; round++) {
      const g = this.granted.get(userId);
      const desired = space.host.desiredRoom(userId);
      const mine = g && g.space === space ? g : undefined;
      if (g && !mine && (desired === null || intent !== "entry")) {
        this.force.delete(userId);
        return; // media belongs to another space; nothing here takes it
      }
      if (desired === null) {
        this.force.delete(userId);
        if (mine) await this.revoke(userId, mine, "left");
        return;
      }
      const viewer = space.host.viewerOf(userId);
      const perm = viewer ? space.host.perms(viewer, desired) : 0n;
      if (!has(perm, Perm.ViewChannel | Perm.Connect)) {
        // The door would not have opened; never grant on doubt.
        this.force.delete(userId);
        if (mine) await this.revoke(userId, mine, "access");
        return;
      }
      const shape = grantShape(perm);
      const shapeKey = JSON.stringify(shape);
      const forced = this.force.has(userId);
      if (mine && mine.roomName === managedRoomName(desired, space.epochFor(desired)) && mine.shape === shapeKey && !forced) {
        return;
      }
      if (!mine && this.debounceMs > 0) {
        await new Promise((r) => setTimeout(r, this.debounceMs));
        if (space.host.desiredRoom(userId) !== desired) continue;
      }
      this.force.delete(userId);
      const previous = this.granted.get(userId);
      if (previous) {
        const reason = previous.space !== space ? "elsewhere" : previous.roomId === desired ? "regrant" : "left";
        try {
          await this.revoke(userId, previous, reason);
        } catch (err) {
          this.log.warn("media revoke unconfirmed", { user: userId, err: String(err) });
          this.send(space, userId, { v: 1, t: "media.unavailable", d: { room_id: desired, reason: "livekit" } });
          return;
        }
      }
      // The room may have emptied (epoch turned) while we waited: read it now.
      const epoch = space.epochFor(desired);
      try {
        const grant = await this.media.grant({
          userId,
          displayName: space.host.displayName(userId),
          serverId: space.host.serverId,
          roomId: desired,
          epoch,
          capacity: space.host.capacity(desired) ?? LIVEKIT_UNLIMITED,
          sources: shape.sources,
          canSubscribe: shape.canSubscribe,
        });
        this.granted.set(userId, { space, roomId: desired, roomName: grant.roomName, identity: grant.identity, shape: shapeKey });
        this.sendGrant(space, userId, desired, grant, shape);
      } catch (err) {
        this.log.warn("media grant failed", { server: space.host.serverId, user: userId, room: desired, err: String(err) });
        this.send(space, userId, { v: 1, t: "media.unavailable", d: { room_id: desired, reason: "livekit" } });
        return;
      }
      // Left while we were granting? Loop once more and revoke.
      if (space.host.desiredRoom(userId) === desired) return;
      intent = "refresh";
    }
  }

  private async reissueOrRegrant(space: RoomMedia, userId: string, g: Granted) {
    const viewer = space.host.viewerOf(userId);
    const perm = viewer ? space.host.perms(viewer, g.roomId) : 0n;
    const shape = grantShape(perm);
    if (space.host.desiredRoom(userId) === g.roomId && JSON.stringify(shape) === g.shape && has(perm, Perm.ViewChannel | Perm.Connect)) {
      let grant: MediaGrant | null = null;
      try {
        grant = await this.media.reissue(userId, { displayName: space.host.displayName(userId), ...shape });
      } catch (err) {
        this.log.warn("media reissue failed", { user: userId, err: String(err) });
        this.send(space, userId, { v: 1, t: "media.unavailable", d: { room_id: g.roomId, reason: "livekit" } });
        return;
      }
      if (grant) return this.sendGrant(space, userId, g.roomId, grant, shape);
    }
    this.force.add(userId);
    await this.reconcile(space, userId, "refresh");
  }

  private async renewAll() {
    if (this.renewing) return;
    this.renewing = true;
    try {
      for (const [userId, g] of [...this.granted]) {
        let ok: boolean;
        try {
          ok = await this.media.renew(userId, g.identity);
        } catch {
          // Store unreachable: the lease has 120 s; the next round tries again.
          continue;
        }
        if (!ok && this.granted.get(userId) === g) {
          // Lease lost (store restarted, lapsed during a stall): the sweeper will
          // remove that participant, so grant again on the facts.
          this.log.warn("media lease lost", { user: userId, room: g.roomId });
          this.force.add(userId);
          this.sync(g.space, userId, "refresh");
        }
      }
    } finally {
      this.renewing = false;
    }
  }
}

/**
 * Media of one space: the room epochs, and the host (runtime) view the hub
 * reads. Epoch = the suffix of the LiveKit room name; it turns when a room
 * empties, so a token from an earlier occupancy only reaches a dead room.
 */
export class RoomMedia {
  readonly host: MediaHost;
  private readonly hub: MediaHub;
  private readonly lk: LiveKitAdmin;
  private readonly log: Log;
  private readonly now: () => number;
  private readonly epochs = new Map<string, number>();

  constructor(deps: { hub: MediaHub; host: MediaHost; lk: LiveKitAdmin; log: Log; now?: () => number }) {
    this.hub = deps.hub;
    this.host = deps.host;
    this.lk = deps.lk;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
    this.hub.register(this);
  }

  /** At start: adopt the epochs of this space's rooms still alive in LiveKit. */
  async recoverEpochs(): Promise<void> {
    let rooms: Array<{ name: string }>;
    try {
      rooms = await this.lk.listRooms();
    } catch (err) {
      this.log.warn("media epochs: listRooms failed", { server: this.host.serverId, err: String(err) });
      return;
    }
    for (const r of rooms) {
      const parsed = parseManagedRoomName(r.name);
      if (!parsed || !this.host.hasRoom(parsed.roomId)) continue;
      if (parsed.epoch > (this.epochs.get(parsed.roomId) ?? -1)) this.epochs.set(parsed.roomId, parsed.epoch);
    }
  }

  isCurrent(roomName: string): boolean {
    const parsed = parseManagedRoomName(roomName);
    return Boolean(parsed && this.host.hasRoom(parsed.roomId) && this.epochs.get(parsed.roomId) === parsed.epoch);
  }

  epochFor(roomId: string): number {
    let e = this.epochs.get(roomId);
    if (e === undefined) {
      e = Math.floor(this.now());
      this.epochs.set(roomId, e);
    }
    return e;
  }

  /** A recovered lease's epoch is usable when the room has none yet or the same one. */
  acceptsEpoch(roomId: string, epoch: number): boolean {
    const cur = this.epochs.get(roomId);
    return cur === undefined || cur === epoch;
  }

  adoptEpoch(roomId: string, epoch: number): boolean {
    if (!this.acceptsEpoch(roomId, epoch)) return false;
    this.epochs.set(roomId, epoch);
    return true;
  }

  /** Called by the hub when a room's last grant ended. */
  maybeRotate(roomId: string) {
    if (this.host.occupants(roomId) > 0) return;
    const cur = this.epochs.get(roomId);
    if (cur === undefined) return;
    this.epochs.set(roomId, Math.max(cur + 1, Math.floor(this.now())));
  }

  sync(userId: string, intent: SyncIntent = "refresh") {
    this.hub.sync(this, userId, intent);
  }

  request(userId: string): boolean {
    return this.hub.request(this, userId);
  }

  resume(userId: string) {
    this.hub.resume(this, userId);
  }

  recover(userId: string, permFor: (roomId: string) => bigint | null): Promise<string | null> {
    return this.hub.recover(this, userId, permFor);
  }

  permissionsChanged() {
    this.hub.permissionsChanged(this);
  }

  dispose() {
    this.hub.dropSpace(this);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
