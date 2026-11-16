import { isManagedRoomName } from "@muchat/space-core";

import type { LeaseStore, LiveKitAdmin, ParticipantLite } from "./ports.ts";

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
  /**
   * After each pass: the participants (and their tracks) of every managed room
   * that could be listed, admitted ones only. `failed` rooms keep their last
   * known state. Presence reads this; no extra LiveKit call is made for it.
   */
  onSnapshot?: (rooms: Map<string, ParticipantLite[]>, failed: Set<string>) => void;
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
    const { lk, leases, isCurrentRoom, onRemoved, onSnapshot } = this.deps;
    const result: SweepResult = { rooms: 0, removed: [], deletedRooms: [], errors: 0 };
    const snapshot = new Map<string, ParticipantLite[]>();
    const failed = new Set<string>();
    let listed = false;
    try {
      const rooms = (await lk.listRooms()).filter((r) => isManagedRoomName(r.name));
      listed = true;
      result.rooms = rooms.length;
      for (const room of rooms) {
        let participants;
        try {
          participants = await lk.listParticipants(room.name);
        } catch {
          result.errors++;
          failed.add(room.name);
          continue;
        }
        const current = isCurrentRoom(room.name);
        const admitted: ParticipantLite[] = [];
        if (current) snapshot.set(room.name, admitted);
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
              // Presence keeps this room's last known state.
              result.errors++;
              failed.add(room.name);
              continue;
            }
            if (!lease) reason = "no_lease";
            else if (lease.room_name !== room.name) reason = "lease_other_room";
          }
          if (!reason) {
            admitted.push(p);
            continue;
          }
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
    if (listed) {
      try {
        onSnapshot?.(snapshot, failed);
      } catch {
        result.errors++;
      }
    }
    return result;
  }
}
