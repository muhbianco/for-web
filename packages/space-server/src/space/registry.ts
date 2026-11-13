import type { Log } from "../log.ts";
import type { LiveKitAdmin } from "../media/ports.ts";
import type { MemberCache, StoatMembers } from "../stoat/api.ts";
import type { StoatCache } from "../stoat/cache.ts";
import type { RuntimeRegistry } from "../ws/gateway.ts";
import type { MediaHub } from "./roomMedia.ts";
import { SpaceRuntime } from "./runtime.ts";
import type { AssignmentStore } from "./store.ts";

/**
 * One runtime per Stoat server, created on first join and kept current by the
 * bot's cache events (structure → re-layout; member → permissions).
 */
export class Registry implements RuntimeRegistry {
  private readonly runtimes = new Map<string, Promise<SpaceRuntime>>();
  private readonly live = new Map<string, SpaceRuntime>();
  private readonly cache: StoatCache;
  private readonly store: AssignmentStore;
  private readonly members: StoatMembers & Partial<Pick<MemberCache, "invalidate">>;
  private readonly log: Log;
  private readonly now: () => number;
  /** Servers where the space is switched on; null = all (tests/lab). */
  private readonly enabled: (serverId: string) => boolean;
  private readonly media: { hub: MediaHub; lk: LiveKitAdmin } | undefined;

  constructor(deps: {
    cache: StoatCache;
    store: AssignmentStore;
    members: StoatMembers & Partial<Pick<MemberCache, "invalidate">>;
    log: Log;
    now?: () => number;
    enabled?: (serverId: string) => boolean;
    /** Room media (Phase 3); without it the space is presence only. */
    media?: { hub: MediaHub; lk: LiveKitAdmin };
  }) {
    this.cache = deps.cache;
    this.store = deps.store;
    this.members = deps.members;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
    this.enabled = deps.enabled ?? (() => true);
    this.media = deps.media;
    deps.cache.on((change) => {
      switch (change.kind) {
        case "structure": {
          const rt = this.live.get(change.serverId);
          if (rt) void rt.refreshStructure().catch((err) => this.log.error("relayout failed", { server: change.serverId, err: String(err) }));
          return;
        }
        case "server_gone": {
          const gone = this.live.get(change.serverId);
          gone?.closeAll(4403, "server gone");
          gone?.dispose();
          this.live.delete(change.serverId);
          this.runtimes.delete(change.serverId);
          return;
        }
        case "member": {
          this.members.invalidate?.(change.serverId, change.userId);
          const rt = this.live.get(change.serverId);
          // Also while reconnecting: a removed role must end media during the grace.
          if (!rt?.hasAvatar(change.userId)) return;
          void this.members.member(change.serverId, change.userId).then((res) => {
            if (res.kind === "ok") rt.memberChanged(change.userId, res.member);
            else if (res.kind === "not_member") rt.memberChanged(change.userId, null);
          });
          return;
        }
        case "ready": {
          // After a bonfire reconnect the cache is rebuilt: re-check every space.
          for (const rt of this.live.values()) {
            if (this.cache.servers.has(rt.serverId)) void rt.refreshStructure().catch(() => undefined);
            else rt.closeAll(4403, "server gone");
          }
          return;
        }
      }
    });
  }

  get(serverId: string): Promise<SpaceRuntime | null> {
    if (!this.cache.servers.has(serverId) || !this.enabled(serverId)) return Promise.resolve(null);
    let p = this.runtimes.get(serverId);
    if (!p) {
      const rt = new SpaceRuntime({
        serverId,
        cache: this.cache,
        store: this.store,
        log: this.log,
        now: this.now,
        media: this.media,
      });
      p = rt.init().then(() => {
        this.live.set(serverId, rt);
        return rt;
      });
      p.catch(() => {
        this.runtimes.delete(serverId);
        rt.dispose();
      });
      this.runtimes.set(serverId, p);
    }
    return p;
  }

  all(): Iterable<SpaceRuntime> {
    return this.live.values();
  }

  /** Stoat servers known to the bot with the space switched on. */
  enabledServers(): string[] {
    return [...this.cache.servers.keys()].filter((id) => this.enabled(id));
  }
}
