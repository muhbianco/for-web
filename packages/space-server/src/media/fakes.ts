import type { LeaseV1 } from "@muchat/space-core";

import {
  type Clock,
  type LeaseStore,
  type LiveKitAdmin,
  ParticipantNotFound,
  type ParticipantLite,
  type RoomInfoLite,
  type TokenMinter,
} from "./ports.ts";

/** In-memory LiveKit with a call log, for ordering assertions. */
export class FakeLiveKit implements LiveKitAdmin {
  rooms = new Map<string, Set<string>>();
  calls: string[] = [];
  failRemove: Error | null = null;
  failEnsure: Error | null = null;

  join(room: string, identity: string) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room)?.add(identity);
  }

  async ensureRoom(name: string): Promise<void> {
    this.calls.push(`ensure:${name}`);
    if (this.failEnsure) throw this.failEnsure;
    if (!this.rooms.has(name)) this.rooms.set(name, new Set());
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    this.calls.push(`remove:${room}:${identity}`);
    if (this.failRemove) throw this.failRemove;
    const set = this.rooms.get(room);
    if (!set?.delete(identity)) throw new ParticipantNotFound();
  }

  async listParticipants(room: string): Promise<ParticipantLite[]> {
    return [...(this.rooms.get(room) ?? [])].map((identity) => ({ identity }));
  }

  async listRooms(): Promise<RoomInfoLite[]> {
    return [...this.rooms].map(([name, s]) => ({ name, numParticipants: s.size }));
  }

  async deleteRoom(name: string): Promise<void> {
    this.calls.push(`delete:${name}`);
    this.rooms.delete(name);
  }
}

export class FakeLeases implements LeaseStore {
  leases = new Map<string, LeaseV1>();
  pointers = new Map<string, string>();
  calls: string[] = [];
  down = false;

  private check() {
    if (this.down) throw new Error("redis down");
  }

  async write(lease: LeaseV1): Promise<void> {
    this.check();
    this.calls.push(`write:${lease.identity}`);
    this.leases.set(lease.identity, lease);
    this.pointers.set(lease.user_id, lease.identity);
  }

  async revokeUser(userId: string): Promise<LeaseV1 | null> {
    this.check();
    this.calls.push(`revoke:${userId}`);
    const id = this.pointers.get(userId);
    if (!id) return null;
    this.pointers.delete(userId);
    const lease = this.leases.get(id) ?? null;
    this.leases.delete(id);
    return lease;
  }

  async renew(userId: string, identity: string): Promise<boolean> {
    this.check();
    return this.pointers.get(userId) === identity;
  }

  async get(identity: string): Promise<LeaseV1 | null> {
    this.check();
    return this.leases.get(identity) ?? null;
  }
}

export class FakeMinter implements TokenMinter {
  minted: Array<Parameters<TokenMinter["mint"]>[0]> = [];
  async mint(input: Parameters<TokenMinter["mint"]>[0]): Promise<string> {
    this.minted.push(input);
    return `token-for-${input.identity}`;
  }
}

/** Manual clock: `advance(ms)` fires due timers in order. */
export class FakeClock implements Clock {
  private now: number;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private nextId = 1;

  constructor(start = 1_800_000_000_000) {
    this.now = start;
  }

  nowMs(): number {
    return this.now;
  }

  later(ms: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, fn, id });
    return () => {
      this.timers = this.timers.filter((t) => t.id !== id);
    };
  }

  async advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.now = next.at;
      next.fn();
      // Let promise callbacks scheduled by the timer settle.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }
    this.now = target;
  }

  get pending(): number {
    return this.timers.length;
  }
}
