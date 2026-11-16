import { expectedPosition, has, Perm, TV_APPS, type TvRights, type TvState } from "@muchat/space-core";
import type { Collection, MongoClient } from "mongodb";

import type { Log } from "../log.ts";
import type { SessionPort, Viewer } from "./runtime.ts";

/**
 * Smart TV of each room (ADR 0008). The server holds one session per room
 * ("um por vez"); every client plays locally and follows `tv.state`. Rights
 * are Stoat permissions of the room (channel): InteractSpaceObjects watches,
 * ControlSpaceTv chooses/plays/pauses/seeks, ManageSpaceTvs stops someone
 * else's video and skips the interval between videos.
 */

/** A room left empty pauses its TV; after this long empty the TV turns off. */
export const TV_EMPTY_OFF_MS = 30 * 60_000;
/** Videos one person may choose per minute (on top of the room's interval). */
export const TV_LOADS_PER_MINUTE = 30;

export interface TvStore {
  loadAll(serverId: string): Promise<TvState[]>;
  save(serverId: string, state: TvState): Promise<void>;
  remove(serverId: string, roomId: string): Promise<void>;
}

export class MemoryTvStore implements TvStore {
  readonly docs = new Map<string, TvState>();

  async loadAll(serverId: string): Promise<TvState[]> {
    return [...this.docs.entries()].filter(([k]) => k.startsWith(`${serverId}:`)).map(([, v]) => structuredClone(v));
  }

  async save(serverId: string, state: TvState): Promise<void> {
    this.docs.set(`${serverId}:${state.room_id}`, structuredClone(state));
  }

  async remove(serverId: string, roomId: string): Promise<void> {
    this.docs.delete(`${serverId}:${roomId}`);
  }
}

interface TvDoc extends TvState {
  _id: string;
  server_id: string;
  updated_at: Date;
}

/** Mongo `muchat_space.tv_sessions`: one bounded document per room with a TV on. */
export class MongoTvStore implements TvStore {
  private readonly col: Collection<TvDoc>;

  constructor(client: MongoClient, db = "muchat_space") {
    this.col = client.db(db).collection<TvDoc>("tv_sessions");
  }

  async loadAll(serverId: string): Promise<TvState[]> {
    const docs = await this.col.find({ server_id: serverId }, { maxTimeMS: 3_000, limit: 500 }).toArray();
    return docs.map(({ _id: _i, server_id: _s, updated_at: _u, ...state }) => state);
  }

  async save(serverId: string, state: TvState): Promise<void> {
    await this.col.replaceOne(
      { _id: `${serverId}:${state.room_id}` },
      { ...state, server_id: serverId, updated_at: new Date() },
      { upsert: true, maxTimeMS: 3_000 },
    );
  }

  async remove(serverId: string, roomId: string): Promise<void> {
    await this.col.deleteOne({ _id: `${serverId}:${roomId}` }, { maxTimeMS: 3_000 });
  }
}

/** What the TV needs from its space; SpaceRuntime implements it. */
export interface TvHost {
  readonly serverId: string;
  /** The room this person stands in (null outside rooms or evicted). */
  roomOf(userId: string): string | null;
  perms(viewer: Viewer, roomId: string): bigint;
  serverManages(viewer: Viewer): boolean;
  /** People inside a room, reconnecting ones included. */
  occupants(roomId: string): number;
  /** Live sessions of the people inside a room. */
  sessionsIn(roomId: string): SessionPort[];
  /** The room has a Smart TV object. */
  hasTv(roomId: string): boolean;
  /** Seconds between two videos in a room (0 = off). */
  cooldownS(): number;
  displayName(userId: string): string;
}

export type TvCommand =
  | { t: "tv.load"; room_id: string; base_rev: number; app: "youtube"; ref: string }
  | { t: "tv.play" | "tv.pause" | "tv.seek"; room_id: string; base_rev: number; pos_s: number }
  | { t: "tv.stop" | "tv.ended"; room_id: string; base_rev: number };

export class TvHub {
  private readonly host: TvHost;
  private readonly store: TvStore;
  private readonly log: Log;
  private readonly now: () => number;
  private readonly states = new Map<string, TvState>();
  private readonly emptySince = new Map<string, number>();
  private readonly loads = new Map<string, number[]>();
  /** Writes of one room in order (a quick pause/play never lands reversed). */
  private readonly writes = new Map<string, Promise<void>>();
  /** Last rev each room had, so a TV turned off and on again never reuses one. */
  private readonly lastRev = new Map<string, number>();

  constructor(deps: { host: TvHost; store: TvStore; log: Log; now: () => number }) {
    this.host = deps.host;
    this.store = deps.store;
    this.log = deps.log;
    this.now = deps.now;
  }

  /** After a restart: the rooms' TVs as they were (only rooms that still have one). */
  async init(): Promise<void> {
    let loaded: TvState[] = [];
    try {
      loaded = await this.store.loadAll(this.host.serverId);
    } catch (err) {
      this.log.warn("tv sessions not loaded", { server: this.host.serverId, err: String(err) });
      return;
    }
    for (const s of loaded) {
      if (!this.host.hasTv(s.room_id) || !TV_APPS[s.app]?.valid(s.ref)) {
        this.persistRemove(s.room_id);
        continue;
      }
      this.states.set(s.room_id, s);
      this.lastRev.set(s.room_id, s.rev);
    }
  }

  state(roomId: string): TvState | null {
    return this.states.get(roomId) ?? null;
  }

  rightsFor(viewer: Viewer, roomId: string): TvRights {
    const p = this.host.perms(viewer, roomId);
    const admin = this.host.serverManages(viewer) && has(p, Perm.ViewChannel);
    const manage = admin || has(p, Perm.ManageSpaceTvs);
    const control = manage || has(p, Perm.ControlSpaceTv);
    return { watch: control || has(p, Perm.InteractSpaceObjects), control, manage };
  }

  /** The TV of `roomId` as one person inside it may see it. */
  sendTo(session: SessionPort, roomId: string) {
    const you = this.rightsFor(session.viewer, roomId);
    const state = you.watch && this.host.hasTv(roomId) ? this.state(roomId) : null;
    session.send({
      v: 1,
      t: "tv.state",
      d: { room_id: roomId, state, you, cooldown_s: this.host.cooldownS(), has_tv: this.host.hasTv(roomId) },
    });
  }

  private broadcast(roomId: string) {
    for (const s of this.host.sessionsIn(roomId)) this.sendTo(s, roomId);
  }

  /** Someone entered a room (walked in, reconnected, joined): they get its TV. */
  entered(session: SessionPort, roomId: string) {
    this.emptySince.delete(roomId);
    this.sendTo(session, roomId);
  }

  /** The decoration changed: a room whose last TV object went away turns its TV off. */
  decorChanged(roomIds: Iterable<string>) {
    for (const roomId of roomIds) {
      if (this.host.hasTv(roomId)) {
        this.broadcast(roomId);
        continue;
      }
      if (this.states.delete(roomId)) this.persistRemove(roomId);
      this.broadcast(roomId);
    }
  }

  /** Every tick: empty rooms pause their TV; empty long enough, it turns off. */
  tick() {
    const now = this.now();
    for (const [roomId, s] of this.states) {
      // Someone reconnecting still holds the room (grace): not empty.
      if (this.host.occupants(roomId) > 0) {
        this.emptySince.delete(roomId);
        continue;
      }
      const since = this.emptySince.get(roomId);
      if (since === undefined) {
        this.emptySince.set(roomId, now);
        if (s.status === "playing") {
          this.commit({ ...s, status: "paused", pos_s: expectedPosition(s, now), ref_ms: now, rev: s.rev + 1, by: "", by_name: "" });
        }
      } else if (now - since >= TV_EMPTY_OFF_MS) {
        this.states.delete(roomId);
        this.emptySince.delete(roomId);
        this.persistRemove(roomId);
      }
    }
  }

  command(session: SessionPort, cmdId: string, cmd: TvCommand): void {
    const userId = session.viewer.user._id;
    const fail = (code: string, extra: Record<string, unknown> = {}) =>
      session.send({ v: 1, t: "error", re: cmdId, d: { code, ...extra } });
    const roomId = cmd.room_id;
    // Only from inside the room, and only where the room has a TV.
    if (this.host.roomOf(userId) !== roomId) return fail("not_allowed", { reason: "not_in_room" });
    if (!this.host.hasTv(roomId)) return fail("no_tv");
    const rights = this.rightsFor(session.viewer, roomId);
    const cur = this.state(roomId);
    if (cmd.base_rev !== (cur?.rev ?? 0)) {
      this.sendTo(session, roomId);
      return fail("stale_rev");
    }
    const now = this.now();
    const by = { by: userId, by_name: this.host.displayName(userId) };
    const nextRev = Math.max(cur?.rev ?? 0, this.lastRev.get(roomId) ?? 0) + 1;
    switch (cmd.t) {
      case "tv.load": {
        if (!rights.control) return fail("not_allowed");
        const app = TV_APPS[cmd.app];
        if (!app || !app.valid(cmd.ref)) return fail("invalid_message", { reason: "bad_ref" });
        const cooldown = this.host.cooldownS() * 1000;
        if (cur && cooldown > 0 && !rights.manage && cur.ref !== cmd.ref) {
          const wait = cur.started_ms + cooldown - now;
          if (wait > 0) return fail("tv_cooldown", { retry_after_ms: wait });
        }
        if (!this.takeLoad(userId, now)) return fail("rate_limited", { retry_after_ms: 60_000 });
        this.commit({
          room_id: roomId,
          app: cmd.app,
          ref: cmd.ref,
          status: "playing",
          pos_s: 0,
          ref_ms: now,
          rev: nextRev,
          ...by,
          started_by: userId,
          started_ms: now,
        });
        this.log.info("tv load", { server: this.host.serverId, room: roomId, user: userId, ref: cmd.ref });
        return;
      }
      case "tv.play":
      case "tv.pause":
      case "tv.seek": {
        if (!rights.control) return fail("not_allowed");
        if (!cur) return fail("not_found");
        const status = cmd.t === "tv.play" ? "playing" : cmd.t === "tv.pause" ? "paused" : cur.status === "ended" ? "paused" : cur.status;
        this.commit({ ...cur, status, pos_s: cmd.pos_s, ref_ms: now, rev: nextRev, ...by });
        return;
      }
      case "tv.ended": {
        if (!rights.control) return fail("not_allowed");
        if (!cur) return fail("not_found");
        this.commit({ ...cur, status: "ended", pos_s: expectedPosition(cur, now), ref_ms: now, rev: nextRev, ...by });
        return;
      }
      case "tv.stop": {
        if (!cur) return fail("not_found");
        // Whoever chose the video turns it off; anyone else needs ManageSpaceTvs.
        if (!(rights.manage || (rights.control && cur.started_by === userId))) return fail("not_allowed");
        this.states.delete(roomId);
        this.lastRev.set(roomId, nextRev);
        this.persistRemove(roomId);
        this.broadcast(roomId);
        this.log.info("tv stop", { server: this.host.serverId, room: roomId, user: userId });
        return;
      }
    }
  }

  private takeLoad(userId: string, now: number): boolean {
    const recent = (this.loads.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= TV_LOADS_PER_MINUTE) {
      this.loads.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.loads.set(userId, recent);
    return true;
  }

  private commit(state: TvState) {
    this.states.set(state.room_id, state);
    this.lastRev.set(state.room_id, state.rev);
    this.persist(state.room_id, () => this.store.save(this.host.serverId, state));
    this.broadcast(state.room_id);
  }

  private persistRemove(roomId: string) {
    this.persist(roomId, () => this.store.remove(this.host.serverId, roomId));
  }

  private persist(roomId: string, write: () => Promise<void>) {
    const prev = this.writes.get(roomId) ?? Promise.resolve();
    const next = prev
      .then(write)
      .catch((err) => this.log.warn("tv session not persisted", { server: this.host.serverId, room: roomId, err: String(err) }));
    this.writes.set(roomId, next);
    void next.finally(() => {
      if (this.writes.get(roomId) === next) this.writes.delete(roomId);
    });
  }

  /** Waits for pending writes (tests, shutdown). */
  async settle(): Promise<void> {
    while (this.writes.size) await Promise.all([...this.writes.values()]);
  }
}
