import {
  type LeaseV1,
  LeaseV1 as LeaseSchema,
  leaseKey,
  userLeaseKey,
} from "@muchat/space-core";
import type { Redis } from "ioredis";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";

import {
  type LeaseStore,
  type LiveKitAdmin,
  type MediaSource,
  ParticipantNotFound,
  type ParticipantLite,
  type RoomInfoLite,
  type TokenMinter,
} from "./ports.ts";

/** RoomService over Twirp with a per-request timeout (seconds). */
export class LiveKitRoomAdmin implements LiveKitAdmin {
  private readonly client: RoomServiceClient;

  constructor(url: string, apiKey: string, apiSecret: string, timeoutSeconds = 3) {
    this.client = new RoomServiceClient(url, apiKey, apiSecret, {
      requestTimeout: timeoutSeconds,
      failover: false,
    });
  }

  async ensureRoom(
    name: string,
    opts: { maxParticipants: number; emptyTimeout: number; departureTimeout: number },
  ): Promise<void> {
    // CreateRoom is idempotent for an existing room. Empty metadata on purpose:
    // Stoat's voice-ingress then fails before touching Redis (fase-0-achados.md).
    await this.client.createRoom({
      name,
      maxParticipants: opts.maxParticipants,
      emptyTimeout: opts.emptyTimeout,
      departureTimeout: opts.departureTimeout,
    });
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    try {
      await this.client.removeParticipant(room, identity);
    } catch (err) {
      if (isNotFound(err)) throw new ParticipantNotFound();
      throw err;
    }
  }

  async listParticipants(room: string): Promise<ParticipantLite[]> {
    try {
      return (await this.client.listParticipants(room)).map((p) => ({ identity: p.identity }));
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  async listRooms(): Promise<RoomInfoLite[]> {
    return (await this.client.listRooms()).map((r) => ({
      name: r.name,
      numParticipants: r.numParticipants,
    }));
  }

  async deleteRoom(name: string): Promise<void> {
    try {
      await this.client.deleteRoom(name);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { status?: unknown; code?: unknown };
  return e.status === 404 || e.code === "not_found";
}

/**
 * Leases in Valkey. A user has at most one lease: `user-lease:{user}` points to
 * the identity whose `lease:{identity}` the gate reads. Both keys share a TTL.
 */
export class RedisLeaseStore implements LeaseStore {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async write(lease: LeaseV1, ttlSeconds: number): Promise<void> {
    const body = JSON.stringify(LeaseSchema.parse(lease));
    const res = await this.redis
      .multi()
      .set(leaseKey(lease.identity), body, "EX", ttlSeconds)
      .set(userLeaseKey(lease.user_id), lease.identity, "EX", ttlSeconds)
      .exec();
    if (!res || res.some(([err]) => err)) throw new Error("lease write failed");
  }

  async revokeUser(userId: string): Promise<LeaseV1 | null> {
    // GETDEL the pointer, then GETDEL the lease: after the first call no other
    // revoke can find this lease, and the gate stops admitting on the second.
    const identity = await this.redis.getdel(userLeaseKey(userId));
    if (!identity) return null;
    const raw = await this.redis.getdel(leaseKey(identity));
    // Unreadable or already lapsed: the caller falls back to its in-memory grant.
    return parseLease(raw);
  }

  async renew(userId: string, identity: string, ttlSeconds: number): Promise<boolean> {
    const script = `
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      redis.call('EXPIRE', KEYS[1], ARGV[2])
      local raw = redis.call('GET', KEYS[2])
      if not raw then return 0 end
      local lease = cjson.decode(raw)
      lease.exp = tonumber(ARGV[3])
      redis.call('SET', KEYS[2], cjson.encode(lease), 'EX', ARGV[2])
      return 1`;
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const ok = await this.redis.eval(
      script,
      2,
      userLeaseKey(userId),
      leaseKey(identity),
      identity,
      String(ttlSeconds),
      String(exp),
    );
    return ok === 1;
  }

  async get(identity: string): Promise<LeaseV1 | null> {
    return parseLease(await this.redis.get(leaseKey(identity)));
  }
}

function parseLease(raw: string | null): LeaseV1 | null {
  if (!raw) return null;
  try {
    const parsed = LeaseSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const SOURCE_MAP: Record<MediaSource, TrackSource> = {
  microphone: TrackSource.MICROPHONE,
  camera: TrackSource.CAMERA,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

/** Mints the participant token. Never `hidden`, never `roomAdmin`. */
export class LiveKitTokenMinter implements TokenMinter {
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  async mint(input: Parameters<TokenMinter["mint"]>[0]): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: input.identity,
      name: input.name,
      ttl: input.ttlSeconds,
      metadata: JSON.stringify({ stoat_user_id: input.userId }),
    });
    at.addGrant({
      roomJoin: true,
      room: input.room,
      canPublish: input.sources.length > 0,
      canPublishSources: input.sources.map((s) => SOURCE_MAP[s]),
      canSubscribe: input.canSubscribe,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      hidden: false,
    });
    return at.toJwt();
  }
}
