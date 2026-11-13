import { SPATIAL_ENABLED_KEY_PREFIX, spatialEnabledKey } from "@muchat/space-core";

import type { Log } from "../log.ts";
import type { LiveKitAdmin } from "../media/ports.ts";
import type { StoatCache } from "../stoat/cache.ts";

/** The few Redis calls the switch needs (ioredis in production, a Map in tests). */
export interface SwitchStore {
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  /** Every key that starts with `prefix` (SCAN, bounded by the number of servers). */
  keysWithPrefix(prefix: string): Promise<string[]>;
}

/**
 * The switch of a server to the space (ADR 0006), kept equal to
 * SPACE_ENABLED_SERVERS. The key `muchat:space:enabled:<server>` is what the
 * patched delta reads to refuse join_call and voice moves in that server
 * (`FeatureDisabled{spatial_only}`); DMs and groups never have it.
 *
 * - A server that becomes enabled gets the key, and its classic LiveKit rooms
 *   (named by voice channel id) are closed: nobody keeps talking outside the map.
 * - A server explicitly disabled loses the key: classic voice comes back.
 * - A server the cache does not know is left alone (a database hiccup must
 *   never switch classic voice back on everywhere).
 */
export class SpatialSwitch {
  private readonly store: SwitchStore;
  private readonly lk: LiveKitAdmin;
  private readonly cache: StoatCache;
  private readonly enabled: (serverId: string) => boolean;
  private readonly log: Log;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(deps: {
    store: SwitchStore;
    lk: LiveKitAdmin;
    cache: StoatCache;
    enabled: (serverId: string) => boolean;
    log: Log;
  }) {
    this.store = deps.store;
    this.lk = deps.lk;
    this.cache = deps.cache;
    this.enabled = deps.enabled;
    this.log = deps.log;
  }

  /** One pass; a request during a pass runs once more after it. Never throws. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          await this.pass();
        } catch (err) {
          this.log.warn("spatial switch sync failed", { err: String(err) });
        }
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pass() {
    if (!this.cache.ready) return;
    const known = [...this.cache.servers.keys()];
    const have = new Set(
      (await this.store.keysWithPrefix(SPATIAL_ENABLED_KEY_PREFIX)).map((k) => k.slice(SPATIAL_ENABLED_KEY_PREFIX.length)),
    );
    for (const id of known) {
      const want = this.enabled(id);
      if (want && !have.has(id)) {
        await this.store.set(spatialEnabledKey(id), "1");
        this.log.info("server switched to the space: classic voice off", { server: id });
        await this.closeClassicRooms(id);
      } else if (!want && have.has(id)) {
        await this.store.del(spatialEnabledKey(id));
        this.log.info("server back to classic voice", { server: id });
      }
    }
  }

  /** Classic rooms are named by the voice channel id (delta's join_call). */
  private async closeClassicRooms(serverId: string) {
    const voiceIds = new Set(this.cache.channelsOf(serverId).filter((c) => c.voice).map((c) => c._id));
    if (voiceIds.size === 0) return;
    let rooms: Array<{ name: string; numParticipants: number }>;
    try {
      rooms = await this.lk.listRooms();
    } catch (err) {
      this.log.warn("classic rooms not listed; they end when emptied", { server: serverId, err: String(err) });
      return;
    }
    for (const r of rooms) {
      if (!voiceIds.has(r.name)) continue;
      try {
        await this.lk.deleteRoom(r.name);
        this.log.info("classic voice room closed", { server: serverId, room: r.name, participants: r.numParticipants });
      } catch (err) {
        this.log.warn("classic voice room not closed", { room: r.name, err: String(err) });
      }
    }
  }
}
