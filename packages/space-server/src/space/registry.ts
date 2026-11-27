import type { Log } from "../log.ts";
import type { LiveKitAdmin } from "../media/ports.ts";
import type { MemberCache, StoatMembers } from "../stoat/api.ts";
import type { StoatCache } from "../stoat/cache.ts";
import type { RuntimeRegistry } from "../ws/gateway.ts";
import type { MediaHub } from "./roomMedia.ts";
import { SpaceRuntime } from "./runtime.ts";
import type { DecorStore } from "./decorStore.ts";
import type { LobbyStore } from "../game/ot/lobbyStore.ts";
import type { SpotStore } from "./spotStore.ts";
import type { TvStore } from "./tv.ts";
import type { AssignmentStore } from "./store.ts";

/** Idle game (docs/espaco/jogo/ot): hooks of each runtime into the game service. */
type RpgHooks = {
  trainingLeft: (runtime: SpaceRuntime, userId: string) => void;
  avatarJoined: (runtime: SpaceRuntime, userId: string) => void;
  roomEntered: (runtime: SpaceRuntime, userId: string, room: string) => void;
  launchDue(host: SpaceRuntime, leader: string, lobbyId: string, auto: boolean): void;
};

/**
 * One runtime per Stoat server, created on first join and kept current by the
 * bot's cache events (structure → re-layout; member → permissions).
 */
export class Registry implements RuntimeRegistry {
  private readonly runtimes = new Map<string, Promise<SpaceRuntime>>();
  private readonly live = new Map<string, SpaceRuntime>();
  private readonly cache: StoatCache;
  private readonly store: AssignmentStore;
  private readonly decorStore: DecorStore | undefined;
  private readonly tvStore: TvStore | undefined;
  private readonly spotStore: SpotStore | undefined;
  private readonly members: StoatMembers & Partial<Pick<MemberCache, "invalidate">>;
  private readonly log: Log;
  private readonly now: () => number;
  /** Servers where the space is switched on; null = all (tests/lab). */
  private readonly enabled: (serverId: string) => boolean;
  private readonly everyServer: boolean;
  private readonly media: { hub: MediaHub; lk: LiveKitAdmin } | undefined;
  /** Operator switch for Refúgio (ADR 0009); off everywhere when absent. */
  private readonly gameAvailable: (serverId: string) => boolean;
  private readonly rpg:
    | RpgHooks
    | undefined;

  constructor(deps: {
    cache: StoatCache;
    store: AssignmentStore;
    /** Decoration per server (ADR 0007); in-memory when absent (tests, lab). */
    decorStore?: DecorStore;
    /** Smart TV sessions (ADR 0008); in-memory when absent. */
    tvStore?: TvStore;
    /** Where the avatars stood at shutdown (24/11/2026); none kept when absent. */
    spotStore?: SpotStore;
    members: StoatMembers & Partial<Pick<MemberCache, "invalidate">>;
    log: Log;
    now?: () => number;
    enabled?: (serverId: string) => boolean;
    /** The switch is "*" (every server, present and future). */
    everyServer?: boolean;
    /** Room media (Phase 3); without it the space is presence only. */
    media?: { hub: MediaHub; lk: LiveKitAdmin };
    /** SPACE_GAME_SERVERS (ADR 0009): servers where Refúgio may be played. */
    gameAvailable?: (serverId: string) => boolean;
    /** Idle game (docs/espaco/jogo/ot): hooks of each runtime into the game service. */
    rpg?: RpgHooks;
  }) {
    this.cache = deps.cache;
    this.store = deps.store;
    // Without this line every runtime fell back to its in-memory store and the
    // decoration vanished on each restart (found in the 16/11/2026 audit).
    this.decorStore = deps.decorStore;
    this.tvStore = deps.tvStore;
    this.spotStore = deps.spotStore;
    this.members = deps.members;
    this.log = deps.log;
    this.now = deps.now ?? Date.now;
    this.enabled = deps.enabled ?? (() => true);
    this.everyServer = deps.everyServer ?? deps.enabled === undefined;
    this.media = deps.media;
    this.gameAvailable = deps.gameAvailable ?? (() => false);
    this.rpg = deps.rpg;
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
          if (!rt) return;
          // Even with no avatar here: a cached permission must not outlive the
          // role it came from (the person may come back and enter with it).
          rt.invalidatePerms(change.userId);
          // Also while reconnecting: a removed role must end media during the
          // grace. Watch-only sessions follow roles and membership too.
          if (!rt.hasAvatar(change.userId) && !rt.hasObserver(change.userId)) return;
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
        decorStore: this.decorStore,
        tvStore: this.tvStore,
        spotStore: this.spotStore,
        log: this.log,
        now: this.now,
        media: this.media,
        gameAvailable: this.gameAvailable(serverId),
      });
      if (this.rpg) {
        const rpg = this.rpg;
        rt.onTrainingLeft = (userId) => rpg.trainingLeft(rt, userId);
        rt.onAvatarJoined = (userId) => rpg.avatarJoined(rt, userId);
        rt.onRoomEntered = (userId, room) => rpg.roomEntered(rt, userId, room);
        rt.onLobbyDue = (leader, id, auto) => rpg.launchDue(rt, leader, id, auto);
      }
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

  /** The runtime of a server already up (the game service sends dungeon runs through it). */
  liveRuntime(serverId: string): SpaceRuntime | null {
    return this.live.get(serverId) ?? null;
  }

  all(): Iterable<SpaceRuntime> {
    return this.live.values();
  }

  /**
   * The process is stopping: every live space writes where its avatars stand (and who trains
   * where), so the next process puts them back. Bounded by `timeoutMs`; a failure only costs that.
   */
  async saveSpots(timeoutMs = 3_000): Promise<{ servers: number; avatars: number; failed: number }> {
    const out = { servers: 0, avatars: 0, failed: 0 };
    const jobs = [...this.live.values()].map(async (rt) => {
      try {
        const n = await rt.saveSpots();
        if (n) {
          out.servers++;
          out.avatars += n;
        }
      } catch (err) {
        out.failed++;
        this.log.warn("resume spots not saved", { server: rt.serverId, err: String(err) });
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(jobs),
      new Promise((r) => {
        timer = setTimeout(r, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    return out;
  }

  /**
   * O processo vai parar: cada espaço vivo grava os seus grupos de DG (27/11/2026, "nenhum grupo se
   * perde no deploy"). Com prazo, como as posições; uma falha só custa os grupos daquele servidor.
   */
  async saveLobbies(store: LobbyStore, timeoutMs = 3_000): Promise<{ servers: number; lobbies: number; failed: number }> {
    const out = { servers: 0, lobbies: 0, failed: 0 };
    const now = this.now();
    const jobs = [...this.live.values()].map(async (rt) => {
      const lobbies = rt.lobbySnapshot();
      if (lobbies.length === 0) return;
      try {
        await store.save(rt.serverId, lobbies, now);
        out.servers++;
        out.lobbies += lobbies.length;
      } catch (err) {
        out.failed++;
        this.log.warn("dungeon groups not saved", { server: rt.serverId, err: String(err) });
      }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(jobs),
      new Promise((r) => {
        timer = setTimeout(r, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    return out;
  }

  /**
   * Na subida, antes de as corridas voltarem: os grupos gravados no desligamento e, para cada
   * corrida em andamento sem grupo, o grupo refeito pela corrida (o processo de antes deste código
   * não gravava); depois, as vitórias do loop que acabaram de fechar (`ended`, na ordem dada: a mais
   * nova primeiro), o grupo que estava entre uma corrida e a próxima. Abre o espaço do servidor para
   * isso (o fim da corrida precisa achar o grupo).
   */
  async restoreLobbies(
    store: LobbyStore,
    runs: readonly (Parameters<SpaceRuntime["adoptRun"]>[0] & { server: string })[],
    since: number,
  ): Promise<{ restored: number; rebuilt: number; between: number }> {
    const out = { restored: 0, rebuilt: 0, between: 0 };
    const active = new Set(runs.filter((r) => !r.ended).map((r) => r.id));
    for (const s of await store.takeAll(since)) {
      const rt = await this.get(s.serverId).catch(() => null);
      if (rt) out.restored += rt.restoreLobbies(s.lobbies, active);
    }
    for (const run of [...runs].sort((a, b) => Number(!!a.ended) - Number(!!b.ended))) {
      const rt = await this.get(run.server).catch(() => null);
      if (rt?.adoptRun(run)) {
        if (run.ended) out.between++;
        else out.rebuilt++;
      }
    }
    return out;
  }

  /** True when every server has the space on (SPACE_ENABLED_SERVERS=*). */
  allEnabled(): boolean {
    return this.everyServer;
  }

  /** Stoat servers known to the bot with the space switched on. */
  enabledServers(): string[] {
    return [...this.cache.servers.keys()].filter((id) => this.enabled(id));
  }
}
