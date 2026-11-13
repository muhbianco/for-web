import type { LeaseV1 } from "@muchat/space-core";

/**
 * Ports of the media core. Real adapters live next to this file; tests use
 * in-memory fakes so the ordering rules can be checked without a LiveKit.
 */

export interface RoomInfoLite {
  name: string;
  numParticipants: number;
}

export interface ParticipantLite {
  identity: string;
}

/** Thrown by adapters when LiveKit says the participant is not in the room. */
export class ParticipantNotFound extends Error {
  constructor() {
    super("participant not found");
    this.name = "ParticipantNotFound";
  }
}

export interface LiveKitAdmin {
  ensureRoom(
    name: string,
    opts: { maxParticipants: number; emptyTimeout: number; departureTimeout: number },
  ): Promise<void>;
  /** Resolves when removed; throws ParticipantNotFound or a transport error. */
  removeParticipant(room: string, identity: string): Promise<void>;
  listParticipants(room: string): Promise<ParticipantLite[]>;
  listRooms(): Promise<RoomInfoLite[]>;
  deleteRoom(name: string): Promise<void>;
}

export interface LeaseStore {
  /** Writes lease + user pointer atomically; returns nothing. */
  write(lease: LeaseV1, ttlSeconds: number): Promise<void>;
  /** Deletes the user's current lease (if any) and returns it. */
  revokeUser(userId: string): Promise<LeaseV1 | null>;
  /** Extends TTL only if `identity` is still the user's current lease. */
  renew(userId: string, identity: string, ttlSeconds: number): Promise<boolean>;
  get(identity: string): Promise<LeaseV1 | null>;
  /** The user's current lease (pointer → lease), if both still exist. */
  current(userId: string): Promise<LeaseV1 | null>;
}

export interface TokenMinter {
  mint(input: {
    identity: string;
    name: string;
    room: string;
    userId: string;
    sources: MediaSource[];
    canSubscribe: boolean;
    ttlSeconds: number;
  }): Promise<string>;
}

/** LiveKit track sources the token may publish (mirrors Stoat's Speak/Video). */
export type MediaSource =
  | "microphone"
  | "camera"
  | "screen_share"
  | "screen_share_audio";

export interface Clock {
  nowMs(): number;
  /** Schedules a callback; returns a cancel function. */
  later(ms: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  later: (ms, fn) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return () => clearTimeout(t);
  },
};
