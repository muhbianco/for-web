import {
  identityBelongsTo,
  LEASE_TTL_SECONDS,
  type LeaseV1,
  managedRoomName,
  mediaIdentity,
} from "@muchat/space-core";

import {
  type Clock,
  type LeaseStore,
  type LiveKitAdmin,
  type MediaSource,
  ParticipantNotFound,
  systemClock,
  type TokenMinter,
} from "./ports.ts";

/** Media could not be granted or revoked with certainty: deny media, keep presence. */
export class MediaUnavailable extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "MediaUnavailable";
  }
}

export interface GrantInput {
  userId: string;
  displayName: string;
  serverId: string;
  roomId: string;
  epoch: number;
  capacity: number;
  sources: MediaSource[];
  canSubscribe: boolean;
}

export interface MediaGrant {
  url: string;
  token: string;
  identity: string;
  roomName: string;
  grantSeq: number;
  /** Unix ms when the lease lapses unless renewed. */
  expiresAt: number;
}

export interface MediaEvents {
  onRemoveRetryExhausted?(room: string, identity: string): void;
}

/**
 * Re-tries after NotFound: the participant may still be joining (the gate let
 * it in just before the lease was revoked). Total ≈ 32 s, longer than
 * LiveKit's worst-case join (3 attempts of 3/6/9 s).
 */
export const NOT_FOUND_RETRY_MS = [1_000, 3_000, 8_000, 20_000];

const TOKEN_TTL_SECONDS = 30;

export interface MediaControllerDeps {
  lk: LiveKitAdmin;
  leases: LeaseStore;
  minter: TokenMinter;
  publicUrl: string;
  clock?: Clock;
  events?: MediaEvents;
}

/**
 * Grants and revokes LiveKit media for room entries. The ordering is the
 * security contract (docs/espaco/adr/0003):
 *   revoke: delete lease → RemoveParticipant (+ orphans, NotFound retries)
 *   grant:  revoke previous (confirmed) → write lease → ensure room → mint token
 * If removal from the previous room cannot be confirmed, the new grant fails
 * with MediaUnavailable: never two rooms at once.
 */
export class MediaController {
  private readonly lk: LiveKitAdmin;
  private readonly leases: LeaseStore;
  private readonly minter: TokenMinter;
  private readonly publicUrl: string;
  private readonly clock: Clock;
  private readonly events: MediaEvents;
  private seq: number;
  /** In-memory mirror so revocation still removes media when Redis is down. */
  private readonly current = new Map<string, { room: string; identity: string }>();
  private readonly pendingRetries = new Map<string, () => void>();

  constructor(deps: MediaControllerDeps) {
    this.lk = deps.lk;
    this.leases = deps.leases;
    this.minter = deps.minter;
    this.publicUrl = deps.publicUrl;
    this.clock = deps.clock ?? systemClock;
    this.events = deps.events ?? {};
    // Monotonic across restarts without persistence: the ms clock is the floor.
    this.seq = this.clock.nowMs();
  }

  private nextSeq(): number {
    this.seq = Math.max(this.seq + 1, this.clock.nowMs());
    return this.seq;
  }

  async grant(input: GrantInput): Promise<MediaGrant> {
    await this.revoke(input.userId, { confirm: true });

    const grantSeq = this.nextSeq();
    const identity = mediaIdentity(input.userId, grantSeq);
    const roomName = managedRoomName(input.roomId, input.epoch);
    const expMs = this.clock.nowMs() + LEASE_TTL_SECONDS * 1000;
    const lease: LeaseV1 = {
      v: 1,
      user_id: input.userId,
      identity,
      room_name: roomName,
      room_id: input.roomId,
      server_id: input.serverId,
      grant_seq: grantSeq,
      exp: Math.floor(expMs / 1000),
    };
    try {
      await this.leases.write(lease, LEASE_TTL_SECONDS);
      this.current.set(input.userId, { room: roomName, identity });
      await this.lk.ensureRoom(roomName, {
        maxParticipants: input.capacity,
        emptyTimeout: 60,
        departureTimeout: 20,
      });
      const token = await this.minter.mint({
        identity,
        name: input.displayName,
        room: roomName,
        userId: input.userId,
        sources: input.sources,
        canSubscribe: input.canSubscribe,
        ttlSeconds: TOKEN_TTL_SECONDS,
      });
      return { url: this.publicUrl, token, identity, roomName, grantSeq, expiresAt: expMs };
    } catch (err) {
      // Roll back so a half-made grant never admits anyone.
      this.current.delete(input.userId);
      await this.leases.revokeUser(input.userId).catch(() => undefined);
      throw new MediaUnavailable("grant failed", err);
    }
  }

  /**
   * Closes admission, then removes the participant and any orphan identity of
   * the same user in that room. With `confirm`, an unconfirmed removal (a
   * transport error, not NotFound) throws MediaUnavailable so the caller does
   * not grant another room while the old one may still be audible.
   */
  async revoke(userId: string, opts: { confirm?: boolean } = {}): Promise<{ room: string; identity: string } | null> {
    const mem = this.current.get(userId);
    this.current.delete(userId);
    let stored: LeaseV1 | null = null;
    let storeError: unknown;
    try {
      stored = await this.leases.revokeUser(userId);
    } catch (err) {
      // With Redis down the gate already refuses managed rooms; the lease
      // lapses by TTL. Media removal below must still happen.
      storeError = err;
    }
    const target = stored ? { room: stored.room_name, identity: stored.identity } : mem;
    if (!target) {
      if (storeError && opts.confirm) throw new MediaUnavailable("lease store unavailable", storeError);
      return null;
    }
    try {
      await this.removeEverywhereInRoom(target.room, userId, target.identity);
    } catch (err) {
      if (opts.confirm) throw new MediaUnavailable("previous room not confirmed empty", err);
    }
    return target;
  }

  /** Renews the lease while the person stays in the room. */
  renew(userId: string, identity: string): Promise<boolean> {
    return this.leases.renew(userId, identity, LEASE_TTL_SECONDS);
  }

  /** Current in-memory grant for a user, if any. */
  currentOf(userId: string): { room: string; identity: string } | undefined {
    return this.current.get(userId);
  }

  private async removeEverywhereInRoom(room: string, userId: string, identity: string) {
    await this.removeWithRetry(room, identity);
    let others: string[] = [];
    try {
      others = (await this.lk.listParticipants(room))
        .map((p) => p.identity)
        .filter((id) => id !== identity && identityBelongsTo(id, userId));
    } catch {
      // The sweeper catches orphans; the primary identity was handled.
    }
    for (const id of others) await this.removeWithRetry(room, id);
  }

  /** Removes now; on NotFound schedules retries in case the join is in flight. */
  private async removeWithRetry(room: string, identity: string): Promise<void> {
    const key = `${room}\u0000${identity}`;
    this.pendingRetries.get(key)?.();
    this.pendingRetries.delete(key);
    try {
      await this.lk.removeParticipant(room, identity);
    } catch (err) {
      if (!(err instanceof ParticipantNotFound)) throw err;
    }
    // Retry either way: a stale token can rejoin inside the gate's race window.
    this.scheduleRetry(room, identity, 0);
  }

  private scheduleRetry(room: string, identity: string, attempt: number) {
    const key = `${room}\u0000${identity}`;
    const delay = NOT_FOUND_RETRY_MS[attempt];
    if (delay === undefined) {
      this.pendingRetries.delete(key);
      this.events.onRemoveRetryExhausted?.(room, identity);
      return;
    }
    const cancel = this.clock.later(delay, () => {
      // Never remove someone whose current grant is this very identity again.
      const now = [...this.current.values()].some((c) => c.identity === identity && c.room === room);
      if (now) {
        this.pendingRetries.delete(key);
        return;
      }
      const next = () => this.scheduleRetry(room, identity, attempt + 1);
      this.lk.removeParticipant(room, identity).then(next, next);
    });
    this.pendingRetries.set(key, cancel);
  }

  /** Pending removal retries (tests and metrics). */
  get pendingRetryCount(): number {
    return this.pendingRetries.size;
  }

  stop() {
    for (const cancel of this.pendingRetries.values()) cancel();
    this.pendingRetries.clear();
  }
}
