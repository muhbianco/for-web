import type { Db } from "mongodb";

import type { BonfireLog } from "./bonfire.ts";
import type { StoatCache } from "./cache.ts";
import type { StoatServer, StoatTextChannel } from "./types.ts";

export interface StructureSnapshot {
  servers: StoatServer[];
  channels: StoatTextChannel[];
}

// Generous caps: today the instance has a handful of servers and dozens of channels.
const MAX_SERVERS = 2_000;
const MAX_CHANNELS = 50_000;

/**
 * Servers and their text channels read straight from Stoat's database
 * (`revolt`), read-only. The bot's own Ready is not enough: Stoat filters the
 * channels in it by the bot's ViewChannel (bonfire/src/events/impl.rs), so a
 * private room would never reach the space — it would vanish from the map and
 * lose its place. The space server decides visibility per viewer itself.
 */
export async function loadStructure(db: Db): Promise<StructureSnapshot> {
  const servers = await db
    .collection<StoatServer>("servers")
    .find(
      {},
      {
        projection: { _id: 1, owner: 1, name: 1, channels: 1, categories: 1, default_permissions: 1, roles: 1 },
        maxTimeMS: 5_000,
      },
    )
    .limit(MAX_SERVERS)
    .toArray();
  const channels = await db
    .collection<StoatTextChannel>("channels")
    .find(
      { channel_type: "TextChannel" },
      {
        projection: {
          _id: 1,
          channel_type: 1,
          server: 1,
          name: 1,
          default_permissions: 1,
          role_permissions: 1,
          voice: 1,
        },
        maxTimeMS: 5_000,
      },
    )
    .limit(MAX_CHANNELS)
    .toArray();
  return { servers, channels };
}

/** Bonfire events that mean "the structure may have changed": refresh from the database. */
export const STRUCTURE_EVENTS = new Set([
  "Ready",
  "ServerCreate",
  "ServerUpdate",
  "ServerDelete",
  "ChannelCreate",
  "ChannelUpdate",
  "ChannelDelete",
  "ServerRoleUpdate",
  "ServerRoleDelete",
  "ServerRoleRanksUpdate",
]);

/**
 * Keeps the cache's structure equal to the database: a debounced refresh on
 * every structure event the bot sees, plus a short periodic one for what it
 * does not see (changes to channels hidden from it arrive on their own
 * topic). Refreshes never overlap; a failed one keeps the last good copy.
 */
export class StructureSync {
  private readonly load: () => Promise<StructureSnapshot>;
  private readonly cache: StoatCache;
  private readonly log: BonfireLog;
  private readonly debounceMs: number;
  private readonly intervalMs: number;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(deps: {
    load: () => Promise<StructureSnapshot>;
    cache: StoatCache;
    log: BonfireLog;
    debounceMs?: number;
    intervalMs?: number;
  }) {
    this.load = deps.load;
    this.cache = deps.cache;
    this.log = deps.log;
    this.debounceMs = deps.debounceMs ?? 500;
    this.intervalMs = deps.intervalMs ?? 10_000;
  }

  /** First load (throws if the database is unreachable), then the periodic refresh. */
  async start(): Promise<void> {
    const snap = await this.load();
    this.cache.replaceStructure(snap.servers, snap.channels);
    this.timer ??= setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = this.debounce = undefined;
  }

  /** Something changed (bonfire event): refresh soon. */
  hint() {
    if (this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.refresh();
    }, this.debounceMs);
    this.debounce.unref?.();
  }

  /** One refresh, coalesced: a request during a refresh runs once more after it. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          const snap = await this.load();
          this.cache.replaceStructure(snap.servers, snap.channels);
        } catch (err) {
          this.log.warn("structure refresh failed", { err: String(err) });
        }
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}

/**
 * Routes bonfire events when the structure comes from the database: structure
 * events only trigger a refresh (their payloads are filtered by what the bot
 * may see), everything else (members) goes to the cache.
 */
export function routeBonfireEvent(event: unknown, cache: StoatCache, sync: StructureSync): void {
  if (typeof event !== "object" || event === null) return;
  const e = event as { type?: unknown; v?: unknown };
  if (e.type === "Bulk" && Array.isArray(e.v)) {
    for (const inner of e.v) routeBonfireEvent(inner, cache, sync);
    return;
  }
  if (typeof e.type === "string" && STRUCTURE_EVENTS.has(e.type)) {
    sync.hint();
    return;
  }
  cache.apply(event);
}
