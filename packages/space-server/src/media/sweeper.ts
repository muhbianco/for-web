import { isManagedRoomName } from "@muchat/space-core";

import type { LeaseStore, LiveKitAdmin } from "./ports.ts";

export interface SweepResult {
  rooms: number;
  removed: Array<{ room: string; identity: string; reason: string }>;
  deletedRooms: string[];
  errors: number;
}

export interface SweeperDeps {
  lk: LiveKitAdmin;
  leases: LeaseStore;
  /** True when `roomName` is the current epoch of an active room. */
  isCurrentRoom: (roomName: string) => boolean;
  onRemoved?: (room: string, identity: string, reason: string) => void;
}

/**
 * The source of truth for "who may be in a managed room" is the lease, not a
 * webhook (LiveKit webhooks are best-effort, docs/espaco/adr/0003). Each pass
 * lists managed rooms, removes every participant without a matching lease and
 * deletes managed rooms that are not current (old epoch, archived room).
 */
export class Sweeper {
  private readonly deps: SweeperDeps;
  private running = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: SweeperDeps) {
    this.deps = deps;
  }

  start(intervalMs = 5_000) {
    this.timer ??= setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass; an overlapping pass is skipped and returns null. */
  async tick(): Promise<SweepResult | null> {
    if (this.running) return null;
    this.running = true;
    const { lk, leases, isCurrentRoom, onRemoved } = this.deps;
    const result: SweepResult = { rooms: 0, removed: [], deletedRooms: [], errors: 0 };
    try {
      const rooms = (await lk.listRooms()).filter((r) => isManagedRoomName(r.name));
      result.rooms = rooms.length;
      for (const room of rooms) {
        let participants;
        try {
          participants = await lk.listParticipants(room.name);
        } catch {
          result.errors++;
          continue;
        }
        const current = isCurrentRoom(room.name);
        for (const p of participants) {
          const base = p.identity.split("#", 1)[0] ?? p.identity;
          let reason: string | null = null;
          if (!current) {
            reason = "stale_room";
          } else if (base !== p.identity) {
            reason = "publish_suffix";
          } else {
            let lease;
            try {
              lease = await leases.get(p.identity);
            } catch {
              // Store unreachable: the gate refuses new joins meanwhile; do
              // not mass-kick already admitted people on a Redis blip.
              result.errors++;
              continue;
            }
            if (!lease) reason = "no_lease";
            else if (lease.room_name !== room.name) reason = "lease_other_room";
          }
          if (!reason) continue;
          try {
            await lk.removeParticipant(room.name, p.identity);
            result.removed.push({ room: room.name, identity: p.identity, reason });
            onRemoved?.(room.name, p.identity, reason);
          } catch {
            result.errors++;
          }
        }
        if (!current) {
          try {
            await lk.deleteRoom(room.name);
            result.deletedRooms.push(room.name);
          } catch {
            result.errors++;
          }
        }
      }
    } catch {
      result.errors++;
    } finally {
      this.running = false;
    }
    return result;
  }
}
