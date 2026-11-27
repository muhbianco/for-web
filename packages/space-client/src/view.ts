import {
  type CompiledMapWire,
  type DecorInstance,
  type DecorItem,
  type DecorRights,
  type DecorSettings,
  type DecorState,
  type InteractionConfig,
  type NewsWire as NewsWireT,
  type NpcKind,
  type ProfilePatch,
  type ProfileView,
  type TvRights,
  type TvState,
  type VoiceReport,
  CATALOG,
  ClockOffset,
  defaultPalette,
  instanceRect,
  itemOf,
  MAX_TV_POS_S,
  NewsWire,
  regionAt,
  TILE,
  youtube,
} from "@muchat/space-core";

const clampPos = (s: number) =>
  Math.max(0, Math.min(MAX_TV_POS_S, Number.isFinite(s) ? s : 0));

import type {
  HeroCarry,
  RpgBoardRun,
  RpgHeroState,
  RpgLobbyMember,
  RpgLobbyView,
  RpgPrepKind,
  RpgRunEndView,
  RpgRunFeedItem,
  RpgRunView,
  RunFrame,
  RunMeter,
} from "@muchat/space-core/game/ot/balance";
import { type ConnStatus, SpaceConnection } from "./connection.ts";
import { type EditorState, Editor } from "./editor.ts";
import { myHeroOf } from "./hero.ts";
import { type Prompt, nearestInteractive } from "./interact.ts";
import {
  type ListWing,
  type ZoneOption,
  announceRoomChange,
  buildList,
  locationText,
  shareList,
  shareZones,
  zoneList,
} from "./list.ts";
import { type MediaStatus, type VoicePort, MediaLink } from "./media.ts";
import { Mover } from "./mover.ts";
import { fitZoom } from "./render/framing.ts";
import { type HeadAnchor, Renderer } from "./render/renderer.ts";
import {
  type RunState,
  applyFrames,
  followsNextRun,
  runStateFrom,
} from "./runState.ts";
import { decodeMap, World } from "./world.ts";

export interface SpaceViewOptions {
  /** Element that receives the canvas and keyboard focus. */
  el: HTMLElement;
  /** Origin serving `/_muchat/space/*` (the chat origin, or the dev page). */
  baseUrl: string;
  sessionToken: string;
  serverId: string;
  client: "web" | "desktop" | "android";
  reducedMotion?: boolean;
  /** The app's voice; without it the space is presence only (dev page). */
  voice?: VoicePort;
}

/** An interactive object the person just used; the app shows the matching dialog. */
export interface Interaction {
  inst: DecorInstance;
  item: DecorItem;
  config: InteractionConfig;
}

export interface SpaceUiState {
  status: ConnStatus;
  location: string;
  list: ListWing[];
  /** Last message for the aria-live region. */
  announcement: string;
  zoom: number;
  media: MediaStatus;
  /** Decoration (ADR 0007). */
  rights: DecorRights;
  decorRev: number;
  settings: DecorSettings | null;
  editor: EditorState;
  /** Zones the person may send a portal to (keys and labels). */
  zones: ZoneOption[];
  /** Interactive object within reach, if any. */
  prompt: { id: string; label: string } | null;
  interaction: Interaction | null;
  /** Room under the pointer (map tooltip with who is inside), in px of the map element. */
  hover: { roomId: string; x: number; y: number } | null;
  /** The Smart TV of the room we are in (ADR 0008); null outside rooms. */
  tv: RoomTv | null;
  /** Last refusal of a TV command (shown by the TV panel). */
  tvError: { code: string; retryAfterMs?: number; at: number } | null;
  /** Bumped when someone uses a TV object on the map (the app opens the TV). */
  tvOpenRequest: number;
  /**
   * A click on someone sharing a screen (the live screen over their head): the app opens
   * that screen on the stage. `n` grows on every click, so the same person twice counts.
   */
  watchRequest: { userId: string; n: number } | null;
  /**
   * Refúgio (ADR 0009), from the snapshot: `available` = the operator switched
   * it on for this server; `enabled` = this person may play now. null = unknown.
   */
  game: { available: boolean; enabled: boolean } | null;
  /**
   * Idle game (docs/espaco/jogo/ot, engine v5): our hero as the server last sent it (null: no
   * class chosen yet), with the server's clock then (`serverNow`) and ours (`at`), so the app
   * projects the Dojô training. `rev` grows with every change the server saves.
   */
  rpg: {
    hero: RpgHeroState | null;
    serverNow: number;
    at: number;
    rev: number;
  } | null;
  /** Someone used a training dummy on the map: the app opens the training dialog. */
  trainRequest: { instance: string; title: string; n: number } | null;
  /** We used an NPC of the idle game (stage O8): the app opens its dialog. */
  npcRequest: {
    instance: string;
    title: string;
    npc: NpcKind;
    n: number;
  } | null;
  /** Usamos o quadro de avisos: o app abre o painel das novidades. */
  newsRequest: { instance: string; title: string; n: number } | null;
  /** Usamos a estante do Arsenal (27/11/2026): o app abre todos os itens do jogo. */
  arsenalRequest: { instance: string; title: string; n: number } | null;
  /** Someone used a TV with the game on: the app shows "watch" or "dungeon". */
  tvMenu: { instance: string; title: string; n: number } | null;
  /** A moderator took us to a room (27/11/2026): the app says who. `n` grows on every move. */
  moved: { roomId: string; byName: string; n: number } | null;
  /** Dungeon groups at the TVs of our room (stage O4), by TV instance. */
  lobbies: Record<string, RpgLobbyView>;
  /** The last group that started in our room (the app tells the room). */
  lobbyStarted: {
    dungeon: string;
    members: RpgLobbyMember[];
    n: number;
  } | null;
  /** Dungeon runs we see (stage O5): our room's and our own, by run id. */
  runs: Record<string, RunState>;
  /** The app shows the adventure panel of this run. */
  runOpen: { id: string; n: number } | null;
  /**
   * The app shows our group's start (26/11/2026): asked for, no run yet, waiting for whoever is
   * preparing and then the 3 s countdown. The run panel takes its place when the run arrives.
   */
  stageOpen: { lobby: string; n: number } | null;
  /** The game menu's board: groups forming at the TVs of this space and runs going on. */
  board: { lobbies: RpgLobbyView[]; runs: RpgBoardRun[]; at: number } | null;
}

export type { RunState } from "./runState.ts";

/** What the game panel receives: its own events, and errors of its own commands. */
export type GameWireEvent = {
  t: "rpg.state" | "rpg.lobby" | "rpg.run" | "rpg.stats" | "error";
  re?: string;
  d: Record<string, unknown>;
};

/** The room's TV as this person may see and use it. */
export interface RoomTv {
  roomId: string;
  state: TvState | null;
  you: TvRights;
  cooldownS: number;
  hasTv: boolean;
}

const KEYS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

/**
 * Wires connection + world + local movement + renderer + input + editor.
 * Framework agnostic: the Muchat client (Solid) only mounts it and renders
 * SpaceUiState.
 */
export class SpaceView {
  readonly world = new World();
  readonly editor: Editor;
  private readonly renderer = new Renderer();
  private readonly conn: SpaceConnection;
  private readonly mover: Mover;
  private readonly opts: SpaceViewOptions;
  private readonly listeners = new Set<(s: SpaceUiState) => void>();
  private state: SpaceUiState;
  private dirtyUi = true;
  private uiTimer: ReturnType<typeof setInterval> | undefined;
  private inputCleanup: Array<() => void> = [];
  private readonly media: MediaLink | null;
  private attached = true;
  private prompt: Prompt | null = null;
  private decorLoading: Promise<void> | null = null;
  private pointerDownAt: { x: number; y: number; t: number } | null = null;
  /** Head counts last drawn on the room labels. */
  private presenceCounts = "";
  /** Last call state told to the server (sent only on change). */
  private lastReport = "";

  private constructor(opts: SpaceViewOptions) {
    this.opts = opts;
    this.mover = new Mover(this.world, (cmd) =>
      this.conn.send(cmd as unknown as Record<string, unknown>),
    );
    this.conn = new SpaceConnection({
      baseUrl: opts.baseUrl,
      sessionToken: opts.sessionToken,
      serverId: opts.serverId,
      client: opts.client,
      onStatus: (status) => {
        // The session is over here (another tab, expired, not a member): leave its call.
        if (
          status === "replaced" ||
          status === "unauthenticated" ||
          status === "not_member"
        )
          this.media?.detach();
        this.patch({ status });
      },
      onEvent: (e) => void this.onEvent(e),
      onClock: (sent, received, serverMs) =>
        this.clock.add(sent, received, serverMs),
    });
    this.media = opts.voice
      ? new MediaLink({
          voice: opts.voice,
          request: () =>
            this.conn.send({
              v: 1,
              t: "media.session.request",
              id: this.conn.nextId(),
            }),
          onStatus: (media) => this.patch({ media }),
        })
      : null;
    this.editor = new Editor(
      this.world,
      (cmd) => {
        const id = this.conn.nextId();
        this.conn.send({ ...cmd, id });
        return id;
      },
      () => {
        this.patch({ editor: this.editor.state });
        this.syncOverlay();
      },
    );
    this.state = {
      status: "connecting",
      location: "",
      list: [],
      announcement: "",
      zoom: 2,
      media: { kind: "idle" },
      rights: { can_edit: false, can_manage: false },
      decorRev: 0,
      settings: null,
      editor: this.editor.state,
      zones: [],
      prompt: null,
      interaction: null,
      hover: null,
      tv: null,
      tvError: null,
      tvOpenRequest: 0,
      watchRequest: null,
      game: null,
      rpg: null,
      trainRequest: null,
      npcRequest: null,
      newsRequest: null,
      arsenalRequest: null,
      tvMenu: null,
      moved: null,
      lobbies: {},
      lobbyStarted: null,
      runs: {},
      runOpen: null,
      stageOpen: null,
      board: null,
    };
  }

  // ---- Jogo do Espaço (rpg.*, docs/espaco/jogo/ot) --------------------------------

  private readonly gameListeners = new Set<(e: GameWireEvent) => void>();
  /** Runs whose panel already opened by itself (once per run). */
  private readonly autoOpened = new Set<string>();
  /** `rpg.lobby` events that arrived before the snapshot (replayed once we know who we are). */
  private readonly earlyLobbies: Record<string, unknown>[] = [];
  /** What holds our group's start now: the hero sheet or an NPC (26/11/2026). */
  private prepWhat: RpgPrepKind | null = null;
  private prepSentAt = 0;
  /** Ids of game commands in flight, so their errors go to the game, not the editor. */
  private readonly gameCommands = new Set<string>();

  /**
   * Sends a game command over the map's own connection (never a second one: a
   * second "play" session would replace this one, 4001). Returns its id; the
   * answers (`game.state`, `game.fight`, `error`) carry it as `re`.
   */
  gameSend(t: string, d?: Record<string, unknown>): string {
    const id = this.conn.nextId();
    this.gameCommands.add(id);
    if (this.gameCommands.size > 64)
      this.gameCommands.delete(this.gameCommands.values().next().value!);
    this.conn.send({ v: 1, t, id, ...(d === undefined ? {} : { d }) });
    return id;
  }

  /** Listens to the game's events; returns the unsubscribe. The map's UI state is not touched. */
  onGame(listener: (e: GameWireEvent) => void): () => void {
    this.gameListeners.add(listener);
    return () => this.gameListeners.delete(listener);
  }

  private emitGame(e: GameWireEvent) {
    for (const l of [...this.gameListeners]) {
      try {
        l(e);
      } catch (err) {
        console.error("game listener failed", err);
      }
    }
  }

  // ---- Smart TV (ADR 0008) -----------------------------------------------------

  private readonly clock = new ClockOffset();
  /** TV per room, as the server last told us (only rooms we were inside). */
  private readonly tvRooms = new Map<string, RoomTv>();
  /** Ids of TV commands in flight, so their errors go to the TV, not the editor. */
  private readonly tvCommands = new Set<string>();

  /** Server time (ms) as this client estimates it; the TV positions run on it. */
  serverNow(): number {
    return this.clock.ready ? this.clock.serverNow(Date.now()) : Date.now();
  }

  private syncTv() {
    const room = this.world.me?.room ?? null;
    const tv = room ? (this.tvRooms.get(room) ?? null) : null;
    if (tv !== this.state.tv) this.patch({ tv });
  }

  private tvSend(t: string, d: Record<string, unknown>): boolean {
    const tv = this.state.tv;
    if (!tv) return false;
    const id = this.conn.nextId();
    this.tvCommands.add(id);
    if (this.tvCommands.size > 64)
      this.tvCommands.delete(this.tvCommands.values().next().value!);
    this.conn.send({
      v: 1,
      t,
      id,
      d: { room_id: tv.roomId, base_rev: tv.state?.rev ?? 0, ...d },
    });
    return true;
  }

  /** Puts a video on the room's TV from a link or id typed by the person. */
  tvLoad(input: string): "ok" | "invalid" | "no_tv" {
    const ref = youtube.parse(input);
    if (!ref) return "invalid";
    return this.tvSend("tv.load", { app: "youtube", ref }) ? "ok" : "no_tv";
  }

  tvPlay(posS: number) {
    this.tvSend("tv.play", { pos_s: clampPos(posS) });
  }

  tvPause(posS: number) {
    this.tvSend("tv.pause", { pos_s: clampPos(posS) });
  }

  tvSeek(posS: number) {
    this.tvSend("tv.seek", { pos_s: clampPos(posS) });
  }

  tvStop() {
    this.tvSend("tv.stop", {});
  }

  /** The controller's player reached the end of the video. */
  tvEnded() {
    this.tvSend("tv.ended", {});
  }

  /** Measures the server's clock now (the TV panel opened). */
  probeClock() {
    this.conn.probeClock();
  }

  static async mount(opts: SpaceViewOptions): Promise<SpaceView> {
    const v = new SpaceView(opts);
    v.renderer.reducedMotion = opts.reducedMotion ?? false;
    await v.renderer.init(opts.el);
    v.bindInput(opts.el);
    v.world.on((e) => {
      switch (e.kind) {
        case "room_changed":
          if (e.local) v.media?.roomChanged(e.to);
          // The groups shown are our room's (the server sends the new room's on entry);
          // our own group stays.
          if (Object.keys(v.state.lobbies).length) {
            const me = v.world.me?.userId;
            const kept = Object.fromEntries(
              Object.entries(v.state.lobbies).filter(([, l]) =>
                l.members.some((m) => m.user_id === me),
              ),
            );
            v.patch({ lobbies: kept });
          }
          // Runs of the room we left go; ours stay (the new room's come on entry).
          v.keepOwnRuns();
          v.patch({ announcement: announceRoomChange(v.world, e.from, e.to) });
          v.syncTv();
          break;
        case "corrected":
          v.mover.resync();
          break;
        case "layout_changed":
          void v.loadMap(e.url);
          break;
        case "rooms_changed":
          v.renderer.rebuildStatic(v.world);
          break;
        case "decor_changed":
          if (e.op.kind === "reset") v.renderer.rebuildDecor(v.world);
          else v.renderer.applyDecorOp(v.world, e.op);
          v.renderer.tvDirty = true;
          v.patch({
            decorRev: v.world.decor?.rev ?? 0,
            settings: v.world.decor?.settings ?? null,
          });
          v.updatePrompt();
          break;
        case "decor_stale":
          void v.loadDecor();
          break;
        case "rights_changed":
          if (!v.world.rights.can_edit && v.editor.state.enabled)
            v.editor.setEnabled(false);
          v.patch({ rights: v.world.rights });
          break;
        case "tv_changed":
          v.renderer.tvDirty = true;
          v.renderer.invalidate();
          break;
        case "presence_changed": {
          v.renderer.tvDirty = true;
          // Room labels carry the head count: redraw them only when a count moved.
          const counts = (v.world.presence?.rooms ?? [])
            .map((r) => `${r.room_id}:${r.people.length}`)
            .join(",");
          if (counts !== v.presenceCounts) {
            v.presenceCounts = counts;
            v.renderer.rebuildStatic(v.world);
          }
          v.renderer.invalidate();
          break;
        }
      }
      v.dirtyUi = true;
    });
    v.renderer.app.ticker.add((t) => {
      const now = performance.now();
      v.mover.step(t.deltaMS, now);
      v.renderer.frame(v.world, now, t.deltaMS);
    });
    // List, location and prompts at 4 Hz: occupancy follows movement without a re-render per frame.
    v.uiTimer = setInterval(() => {
      v.dirtyUi = true;
      v.updatePrompt();
      v.flushUi();
    }, 250);
    v.conn.start();
    return v;
  }

  /** Current UI state (the same object subscribers receive). */
  get ui(): SpaceUiState {
    return this.state;
  }

  subscribe(fn: (s: SpaceUiState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private patch(p: Partial<SpaceUiState>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn(this.state);
  }

  private flushUi() {
    if (!this.dirtyUi) return;
    this.dirtyUi = false;
    const s = this.state;
    const location = locationText(this.world);
    const list = shareList(s.list, buildList(this.world));
    const zones = shareZones(s.zones, zoneList(this.world));
    const zoom = this.renderer.zoom;
    // The 4 Hz timer marks the UI dirty unconditionally; only tell the page when
    // something it shows actually moved.
    if (
      location === s.location &&
      list === s.list &&
      zones === s.zones &&
      zoom === s.zoom
    )
      return;
    this.patch({ location, list, zoom, zones });
  }

  private async loadMap(url: string) {
    const res = await fetch(new URL(url, this.opts.baseUrl), {
      headers: { "X-Session-Token": this.opts.sessionToken },
    });
    if (!res.ok) throw new Error(`layout ${res.status}`);
    const wire = (await res.json()) as CompiledMapWire;
    this.world.setMap(decodeMap(wire));
    this.renderer.rebuildStatic(this.world);
    this.renderer.rebuildDecor(this.world);
    this.dirtyUi = true;
  }

  /** Whole decoration from the server; coalesced so a burst of stale events fetches once. */
  private loadDecor(): Promise<void> {
    if (this.decorLoading) return this.decorLoading;
    this.decorLoading = (async () => {
      const url =
        this.world.decorUrl ||
        `/_muchat/space/v1/spaces/${this.opts.serverId}/decor`;
      const res = await fetch(new URL(url, this.opts.baseUrl), {
        headers: { "X-Session-Token": this.opts.sessionToken },
      });
      if (!res.ok) throw new Error(`decor ${res.status}`);
      const state = (await res.json()) as DecorState;
      this.world.setDecor({ ...state, furnished: state.furnished ?? [] });
    })().finally(() => {
      this.decorLoading = null;
      // A newer revision was announced while we fetched: once more.
      if (this.world.decor && this.world.decor.rev < this.world.decorRevWanted)
        void this.loadDecor();
    });
    return this.decorLoading;
  }

  private async onEvent(e: Record<string, unknown>) {
    const d = e.d as any;
    const now = performance.now();
    switch (e.t) {
      case "hello.ok":
        return;
      case "space.snapshot": {
        if (d.layout.fingerprint !== this.world.fingerprint)
          await this.loadMap(d.layout.url);
        this.world.applySnapshot(d, now);
        // Groups that arrived while the map was loading (we did not know who we were yet).
        const early = this.earlyLobbies.splice(0);
        for (const ev of early) void this.onEvent(ev);
        this.mover.resync();
        this.renderer.rebuildStatic(this.world);
        if (!this.world.decor || this.world.decor.rev !== d.decor?.rev)
          await this.loadDecor().catch(() => undefined);
        this.patch({
          rights: this.world.rights,
          settings: this.world.decor?.settings ?? null,
          decorRev: this.world.decor?.rev ?? 0,
          game: d.game
            ? {
                available: d.game.available === true,
                enabled: d.game.enabled === true,
              }
            : null,
        });
        this.dirtyUi = true;
        // Idle game: our hero (level under the name; closes a training left behind).
        if (d.game?.enabled === true) this.gameSend("rpg.open");
        return;
      }
      case "avatar.positions":
        this.world.applyPositions(d, now);
        return;
      case "avatar.correction":
        this.world.applyCorrection(d);
        return;
      case "space.rooms":
        this.world.setRooms(d.rooms, d.wings);
        return;
      case "space.layout.changed":
        this.world.layoutChanged(d.fingerprint, d.url);
        return;
      case "decor.changed":
        this.world.applyDecorOp(d.rev, d.op);
        this.editor.onChanged(
          d.op,
          typeof e.re === "string" ? e.re : undefined,
        );
        return;
      case "decor.rights":
        this.world.setRights(d);
        return;
      case "rpg.lobby": {
        // Before the snapshot we do not know who we are or where: our own group would be
        // dropped (it came right after the snapshot, while the map was still loading).
        if (!this.world.me) {
          if (this.earlyLobbies.length < 64) this.earlyLobbies.push(e);
          return;
        }
        if (typeof e.re === "string") this.gameCommands.delete(e.re);
        const tv = typeof d.tv === "string" ? d.tv : "";
        const lobbies = { ...this.state.lobbies };
        const lobby = (d.lobby ?? null) as RpgLobbyView | null;
        const me = this.world.me?.userId;
        // Keyed by the group (a TV holds several since 24/11/2026; an older server sends no id).
        const key = lobby?.id ?? (typeof d.id === "string" ? d.id : "") ?? "";
        // Our own group wherever it is (it stays formed between runs and follows us around
        // the map); the others, only our room's.
        if (
          lobby &&
          (lobby.room === this.world.me?.room ||
            lobby.members.some((m) => m.user_id === me))
        )
          lobbies[key || lobby.tv] = lobby;
        else if (key) delete lobbies[key];
        else if (tv) delete lobbies[tv];
        else if (d.lobby === null && typeof e.re === "string") {
          // Our own "leave": drop the group we were in.
          for (const [k, l] of Object.entries(lobbies))
            if (l.members.some((m) => m.user_id === this.world.me?.userId))
              delete lobbies[k];
        }
        const started =
          d.ended === "started" && d.started
            ? (d.started as { dungeon: string; members: RpgLobbyMember[] })
            : null;
        const before = Object.values(this.state.lobbies).find((l) =>
          l.members.some((m) => m.user_id === me),
        );
        const mineNow =
          lobby && lobby.members.some((m) => m.user_id === me) ? lobby : null;
        this.patch({
          ...this.stageFor(before ?? null, mineNow, key),
          lobbies,
          ...(started
            ? {
                lobbyStarted: {
                  ...started,
                  n: (this.state.lobbyStarted?.n ?? 0) + 1,
                },
              }
            : {}),
        });
        if (mineNow) this.syncPrep(mineNow);
        this.emitGame({
          t: "rpg.lobby",
          re: typeof e.re === "string" ? e.re : undefined,
          d,
        });
        return;
      }
      case "rpg.run": {
        const run = d.run as RpgRunView | undefined;
        if (!run || typeof run.id !== "string") return;
        const me = this.world.me?.userId;
        const mine = run.members.some((m) => m.user_id === me);
        const next: RunState = runStateFrom({
          run,
          frame: (d.frame ?? null) as RunFrame | null,
          feed: Array.isArray(d.feed) ? (d.feed as RpgRunFeedItem[]) : [],
          ...(Array.isArray(d.carry) ? { carry: d.carry as HeroCarry[] } : {}),
          ...(d.end ? { end: d.end as RpgRunEndView } : {}),
          ...(d.meter ? { meter: d.meter as RunMeter } : {}),
        });
        // Runs that ended go once another one arrives, unless their summary is open.
        const runs: Record<string, RunState> = {};
        for (const [id, r] of Object.entries(this.state.runs))
          if (!r.end || id === this.state.runOpen?.id) runs[id] = r;
        runs[run.id] = next;
        // The loop's next run (run.auto) opens only for whoever still has the last one open
        // (watching the summary); whoever closed the panel to chat keeps chatting.
        const openNow = this.state.runOpen
          ? this.state.runs[this.state.runOpen.id]
          : null;
        // Whoever watches our group's start (the stage) follows it into the run; so does whoever had
        // the group's last run open, as a member or watching it (followsNextRun).
        const follow = followsNextRun({
          run,
          stageOpen: !!this.state.stageOpen,
          open: openNow
            ? {
                ended: !!openNow.end,
                room: openNow.run.room,
                tv: openNow.run.tv,
                member: openNow.run.members.some((m) => m.user_id === me),
              }
            : null,
        });
        this.patch({
          runs,
          ...(mine && this.state.stageOpen ? { stageOpen: null } : {}),
        });
        if (mine && !next.end && follow) this.autoOpenRun(run.id);
        const re = typeof e.re === "string" ? e.re : undefined;
        if (re) this.gameCommands.delete(re);
        this.emitGame({ t: "rpg.run", re, d });
        return;
      }
      case "rpg.stats": {
        // The run meter asked for the gain per hour (27/11/2026): only its own command waits for it.
        const re = typeof e.re === "string" ? e.re : undefined;
        if (re) this.gameCommands.delete(re);
        this.emitGame({ t: "rpg.stats", re, d });
        return;
      }
      case "rpg.board": {
        if (typeof e.re === "string") this.gameCommands.delete(e.re);
        this.patch({
          board: {
            lobbies: Array.isArray(d.lobbies)
              ? (d.lobbies as RpgLobbyView[])
              : [],
            runs: Array.isArray(d.runs) ? (d.runs as RpgBoardRun[]) : [],
            at: Date.now(),
          },
        });
        return;
      }
      case "rpg.run.tick": {
        const id = typeof d.id === "string" ? d.id : "";
        const cur = this.state.runs[id];
        const frames = Array.isArray(d.frames) ? (d.frames as RunFrame[]) : [];
        if (!cur || frames.length === 0) return;
        // The run message already counted up to its own second: a tick sent before it arrived
        // can repeat those frames (applyFrames skips them).
        const next = applyFrames(cur, frames);
        if (next === cur) return;
        this.patch({ runs: { ...this.state.runs, [id]: next } });
        return;
      }
      case "rpg.state": {
        if (typeof e.re === "string") this.gameCommands.delete(e.re);
        const hero = (d.hero ?? null) as RpgHeroState | null;
        // A state older than the one we have (two commands in flight) does not go back in time;
        // the command that waits for it still gets its answer below.
        const rev = typeof d.rev === "number" ? d.rev : 0;
        const stale = !!this.state.rpg && rev > 0 && rev < this.state.rpg.rev;
        if (!stale) {
          this.world.myHero = hero ? myHeroOf(hero) : null;
          this.renderer.invalidate();
          this.patch({
            rpg: {
              hero,
              serverNow:
                typeof d.server_now === "number" ? d.server_now : Date.now(),
              at: Date.now(),
              rev,
            },
          });
          // In a run we already see (it can arrive before we know who we are, on reload).
          const runId = hero?.run?.id;
          if (runId && this.state.runs[runId] && !this.state.runs[runId]!.end)
            this.autoOpenRun(runId);
        }
        this.emitGame({
          t: "rpg.state",
          re: typeof e.re === "string" ? e.re : undefined,
          d,
        });
        return;
      }
      case "error":
        if (typeof e.re === "string" && this.gameCommands.delete(e.re)) {
          this.emitGame({ t: "error", re: e.re, d: d ?? {} });
          return;
        }
        if (typeof e.re === "string" && this.tvCommands.delete(e.re)) {
          this.patch({
            tvError: {
              code: d?.code ?? "internal",
              retryAfterMs: d?.retry_after_ms,
              at: Date.now(),
            },
          });
          return;
        }
        if (d?.code && (typeof e.re === "string" || d.code === "not_allowed"))
          this.editor.onError(
            typeof e.re === "string" ? e.re : undefined,
            d.code,
            d.reason,
          );
        return;
      case "space.presence":
        this.world.setPresence(d);
        this.dirtyUi = true;
        return;
      case "tv.state": {
        const tv: RoomTv = {
          roomId: d.room_id,
          state: d.state ?? null,
          you: d.you,
          cooldownS: d.cooldown_s ?? 0,
          hasTv: d.has_tv !== false,
        };
        this.tvRooms.set(d.room_id, tv);
        this.world.setTv(d.room_id, tv.state);
        if (!this.clock.ready && tv.state) this.conn.probeClock();
        this.syncTv();
        return;
      }
      case "member.moved": {
        // A moderator took us to a room (the sidebar's drag): the correction already placed
        // us there and our call follows; the app says who did it.
        const m = d as { room_id?: string; by?: string; by_name?: string };
        if (typeof m.room_id !== "string") return;
        this.patch({
          moved: {
            roomId: m.room_id,
            byName: typeof m.by_name === "string" ? m.by_name : "",
            n: (this.state.moved?.n ?? 0) + 1,
          },
        });
        return;
      }
      case "screen.stopped":
        // A moderator of the room ended our screen share: stop it here too.
        this.opts.voice?.stopScreenShare?.();
        this.patch({
          announcement: "Um moderador encerrou o compartilhamento da sua tela.",
        });
        return;
      case "media.grant":
        // A new grant is a new call: its state is told afresh.
        this.lastReport = "";
        return this.media?.onGrant(d);
      case "media.revoked":
        return this.media?.onRevoked(d);
      case "media.unavailable":
        return this.media?.onUnavailable(d);
    }
  }

  // ---- input -----------------------------------------------------------------

  /** The person picked a zoom (buttons, keys, two fingers): the map stops framing itself. */
  private zoomByHand = false;

  /**
   * Frames the map for its screen (render/framing.ts): a phone in portrait gets zoom 1,
   * a computer 2. Runs on every resize of the map (a rotation, a split screen, a panel
   * opening) until the person zooms by hand.
   */
  private frameZoom(width: number, height: number) {
    if (this.zoomByHand || width <= 0 || height <= 0) return;
    const z = fitZoom(width, height);
    if (z === this.renderer.zoom) return;
    this.renderer.setZoom(z);
    this.patch({ zoom: this.renderer.zoom });
  }

  private bindInput(el: HTMLElement) {
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    // The camera follows the map's size (see frameZoom).
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() =>
        this.frameZoom(el.clientWidth, el.clientHeight),
      );
      ro.observe(el);
      this.inputCleanup.push(() => ro.disconnect());
    }
    const down = (ev: KeyboardEvent) => {
      if (this.editor.state.enabled && this.editorKey(ev)) {
        ev.preventDefault();
        return;
      }
      const k = KEYS[ev.code];
      // With a modifier the key belongs to the page (Shift+S shares the
      // screen, Shift+D deafens, Ctrl+… are the app's): never a step.
      if (k && !(ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey)) {
        ev.preventDefault();
        this.mover.setKey(k, true);
        return;
      }
      // E only: Enter belongs to the app, which opens the chat with it (27/11/2026).
      if (ev.code === "KeyE") {
        if (this.prompt && !this.editor.state.enabled) {
          ev.preventDefault();
          this.interact();
        }
        return;
      }
      if (ev.key === "Escape") {
        this.mover.cancelPath();
        if (this.state.interaction) this.patch({ interaction: null });
      }
      if (ev.key === "+" || ev.key === "=")
        this.setZoom(this.renderer.zoom + 1);
      if (ev.key === "-") this.setZoom(this.renderer.zoom - 1);
    };
    const up = (ev: KeyboardEvent) => {
      const k = KEYS[ev.code];
      if (k) this.mover.setKey(k, false);
    };
    const blur = () => this.mover.clearKeys();
    const canvasPoint = (ev: PointerEvent) => {
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      return this.renderer.screenToWorld(
        ev.clientX - rect.left,
        ev.clientY - rect.top,
      );
    };
    // Two fingers on the map zoom it (a pinch), like any map on a phone. A pinch
    // never walks: the second finger cancels the tap of the first.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; zoom: number } | null = null;
    const spread = () => {
      const [a, b] = [...touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const pointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      el.focus();
      if (ev.pointerType === "touch") {
        touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (touches.size === 2) {
          pinch = { dist: spread(), zoom: this.renderer.zoom };
          this.pointerDownAt = null;
          return;
        }
        if (touches.size > 2) return;
      }
      const p = canvasPoint(ev);
      this.pointerDownAt = { x: p.x, y: p.y, t: performance.now() };
      if (this.editor.state.enabled) {
        this.editor.pointerDown(p.x, p.y);
        return;
      }
    };
    const pointerMove = (ev: PointerEvent) => {
      if (touches.has(ev.pointerId)) {
        touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pinch && touches.size === 2) {
          // One zoom step per clear pinch; the next step counts from there.
          const ratio = spread() / Math.max(1, pinch.dist);
          if (ratio > 1.35 || ratio < 0.74) {
            this.setZoom(pinch.zoom + (ratio > 1 ? 1 : -1));
            pinch = { dist: spread(), zoom: this.renderer.zoom };
          }
          return;
        }
      }
      const p = canvasPoint(ev);
      if (this.editor.state.enabled) {
        this.editor.hover(p.x, p.y);
        return;
      }
      // Someone sharing a screen is clickable (it opens their screen): the hand says so.
      // On the map's element: PixiJS resets the canvas's own cursor to "inherit".
      const cursor = this.renderer.sharerAt(p.x, p.y) ? "pointer" : "";
      if (el.style.cursor !== cursor) el.style.cursor = cursor;
      // Hovering a room shows who is inside (tooltip), without walking there.
      const ix = this.world.ix;
      const region = ix ? regionAt(ix, p.x, p.y) : null;
      const roomId = region?.kind === "room" ? region.roomId : null;
      if (roomId === (this.state.hover?.roomId ?? null)) return;
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      this.patch({
        hover: roomId
          ? { roomId, x: ev.clientX - rect.left, y: ev.clientY - rect.top }
          : null,
      });
    };
    const pointerUp = (ev: PointerEvent) => {
      touches.delete(ev.pointerId);
      if (touches.size < 2) pinch = null;
      if (ev.button !== 0) return;
      const p = canvasPoint(ev);
      const start = this.pointerDownAt;
      this.pointerDownAt = null;
      if (this.editor.state.enabled) {
        this.editor.pointerUp(p.x, p.y);
        return;
      }
      if (!start) return;
      // A tap on an interactive object within reach uses it; otherwise walk there.
      const hit = this.editor.instanceAt(
        Math.floor(p.x / TILE),
        Math.floor(p.y / TILE),
      );
      if (hit && this.prompt && hit.inst.id === this.prompt.inst.id) {
        this.interact();
        return;
      }
      // A tap on someone sharing a screen opens it on the stage, instead of walking there.
      const sharer = this.renderer.sharerAt(p.x, p.y);
      if (sharer) {
        const n = (this.state.watchRequest?.n ?? 0) + 1;
        this.patch({ watchRequest: { userId: sharer, n } });
        return;
      }
      if (!this.mover.walkTo(p.x, p.y))
        this.patch({ announcement: "Não dá para chegar lá." });
    };
    const cancel = (ev: PointerEvent) => {
      touches.delete(ev.pointerId);
      if (touches.size < 2) pinch = null;
      this.pointerDownAt = null;
    };
    const leave = () => {
      if (this.editor.state.enabled) this.editor.hover(-1e9, -1e9);
      if (this.state.hover) this.patch({ hover: null });
      el.style.cursor = "";
    };
    const visibility = () => {
      // The renderer draws on demand and skips while hidden: repaint on return.
      if (document.visibilityState === "visible") this.renderer.invalidate();
      this.conn.send({
        v: 1,
        t: "presence.idle",
        id: this.conn.nextId(),
        d: { idle: document.visibilityState === "hidden" },
      });
    };
    const canvas = this.renderer.app.canvas;
    el.addEventListener("keydown", down);
    el.addEventListener("keyup", up);
    el.addEventListener("blur", blur);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointercancel", cancel);
    // The map takes every touch gesture (tap to walk, pinch to zoom): no page
    // scroll or browser zoom on it.
    canvas.style.touchAction = "none";
    document.addEventListener("visibilitychange", visibility);
    this.inputCleanup.push(
      () => el.removeEventListener("keydown", down),
      () => el.removeEventListener("keyup", up),
      () => el.removeEventListener("blur", blur),
      () => canvas.removeEventListener("pointerdown", pointerDown),
      () => canvas.removeEventListener("pointermove", pointerMove),
      () => canvas.removeEventListener("pointerup", pointerUp),
      () => canvas.removeEventListener("pointerleave", leave),
      () => canvas.removeEventListener("pointercancel", cancel),
      () => document.removeEventListener("visibilitychange", visibility),
    );
  }

  /** Editor shortcuts; true when handled. */
  private editorKey(ev: KeyboardEvent): boolean {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.code === "KeyZ") {
      if (ev.shiftKey) this.editor.redo();
      else this.editor.undo();
      return true;
    }
    if (mod && ev.code === "KeyY") {
      this.editor.redo();
      return true;
    }
    if (mod && ev.code === "KeyD") {
      this.editor.duplicateSelected();
      return true;
    }
    if (ev.code === "KeyR" && !mod) {
      this.editor.rotate();
      return true;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      this.editor.removeSelected();
      return true;
    }
    if (ev.key === "Escape") {
      this.editor.cancel();
      return true;
    }
    return false;
  }

  private syncOverlay() {
    const s = this.editor.state;
    const sel = s.selected;
    let selectedRect = null;
    if (sel && this.world.zones) {
      const zone = this.world.zones.byKey.get(sel.zone);
      const item = itemOf(CATALOG, sel.item);
      if (zone && item) selectedRect = instanceRect(zone, item, sel);
    }
    this.renderer.overlay = {
      enabled: s.enabled,
      hoverTile: s.hoverTile,
      zoneRect: s.hoverZone?.rect ?? null,
      floorTool: s.tool.kind === "floor",
      ghost: s.ghost
        ? {
            item: s.ghost.item,
            rot: s.ghost.inst.rot,
            variant: s.ghost.inst.variant,
            rect: s.ghost.rect,
            valid: s.ghost.error === null,
          }
        : null,
      selected: selectedRect,
    };
  }

  /** The "E · …" bubble over the object within reach (off on phones: the app shows a button). */
  private mapPrompt = true;

  /**
   * Whether the map draws the "E · …" bubble over the object within reach. A phone
   * turns it off: the app's button at the bottom does the same with a finger, and
   * the bubble, drawn at the map's zoom, was wider than the screen (23/11/2026).
   */
  setMapPrompt(on: boolean) {
    if (this.mapPrompt === on) return;
    this.mapPrompt = on;
    const p = this.prompt;
    this.renderer.prompt = p && on ? { x: p.x, y: p.y, label: p.label } : null;
  }

  private updatePrompt() {
    const p = this.editor.state.enabled ? null : nearestInteractive(this.world);
    const changed =
      (p?.inst.id ?? null) !== (this.prompt?.inst.id ?? null) ||
      p?.label !== this.prompt?.label;
    this.prompt = p;
    this.renderer.prompt =
      p && this.mapPrompt ? { x: p.x, y: p.y, label: p.label } : null;
    if (changed)
      this.patch({ prompt: p ? { id: p.inst.id, label: p.label } : null });
  }

  /** Use the interactive object within reach (E, tap). */
  interact() {
    const p = this.prompt;
    if (!p) return;
    if (p.item.interaction === "teleport") {
      this.conn.send({
        v: 1,
        t: "avatar.teleport",
        id: this.conn.nextId(),
        d: { id: p.inst.id },
      });
      return;
    }
    if (p.item.interaction === "tv") {
      // With the idle game on, the TV also starts dungeons (stage O4): the app asks which.
      if (this.state.game?.enabled) {
        this.patch({
          tvMenu: {
            instance: p.inst.id,
            title: p.label,
            n: (this.state.tvMenu?.n ?? 0) + 1,
          },
        });
        return;
      }
      // The room's Smart TV: the app opens it on the media stage.
      this.patch({ tvOpenRequest: this.state.tvOpenRequest + 1 });
      return;
    }
    if (p.item.interaction === "npc" && p.item.npc) {
      // An NPC of the idle game (stage O8): merchant, banker or the vocation master.
      this.patch({
        npcRequest: {
          instance: p.inst.id,
          title: p.label,
          npc: p.item.npc,
          n: (this.state.npcRequest?.n ?? 0) + 1,
        },
      });
      return;
    }
    if (p.item.interaction === "arsenal") {
      // A estante do Arsenal: o app abre todos os itens do jogo (nada vai ao servidor).
      this.patch({
        arsenalRequest: {
          instance: p.inst.id,
          title: p.inst.config?.title?.trim() || p.item.name,
          n: (this.state.arsenalRequest?.n ?? 0) + 1,
        },
      });
      return;
    }
    if (p.item.interaction === "news") {
      // O quadro de avisos: o app busca as novidades e abre o painel.
      this.patch({
        newsRequest: {
          instance: p.inst.id,
          // O título do painel é o do quadro (ou o nome do item), não o verbo do balão.
          title: p.inst.config?.title?.trim() || p.item.name,
          n: (this.state.newsRequest?.n ?? 0) + 1,
        },
      });
      return;
    }
    if (p.item.interaction === "train") {
      // A training dummy (docs/espaco/jogo/ot): the app asks vocation and skill.
      this.patch({
        trainRequest: {
          instance: p.inst.id,
          title: p.label,
          n: (this.state.trainRequest?.n ?? 0) + 1,
        },
      });
      return;
    }
    this.patch({
      interaction: { inst: p.inst, item: p.item, config: p.inst.config ?? {} },
    });
  }

  closeInteraction() {
    if (this.state.interaction) this.patch({ interaction: null });
  }

  /** The app closed the TV menu (stage O4). */
  closeTvMenu() {
    if (this.state.tvMenu) this.patch({ tvMenu: null });
  }

  /** Asks the server for the game menu's board (groups forming, runs going on). */
  requestBoard() {
    this.gameSend("rpg.board");
  }

  /** Whether this app already receives the run (it left from this room, or we watch it). */
  knowsRun(id: string): boolean {
    return !!this.state.runs[id];
  }

  /** Show a dungeon run (the chip, the TV menu). */
  watchRun(id: string) {
    if (!this.state.runs[id]) return;
    this.patch({
      tvMenu: null,
      runOpen: { id, n: (this.state.runOpen?.n ?? 0) + 1 },
    });
  }

  /**
   * Avatar palette of someone in this space, for the dungeon scene (docs/espaco/jogo/ot, O10):
   * ours, or of whoever we see on the map; someone we no longer see gets the default for the id.
   */
  paletteOf(userId: string): number {
    if (this.world.me?.userId === userId) return this.world.me.palette;
    return this.world.others.get(userId)?.palette ?? defaultPalette(userId);
  }

  /**
   * The hero sheet or an NPC opened (or closed, null): it holds our group's start until it closes
   * (26/11/2026). Sent only while we are in a group; said again when the server forgot it
   * (reconnect) — see `syncPrep`.
   */
  setPrep(what: RpgPrepKind | null) {
    if (this.prepWhat === what) return;
    this.prepWhat = what;
    const me = this.world.me?.userId;
    const mine = Object.values(this.state.lobbies).some((l) =>
      l.members.some((m) => m.user_id === me),
    );
    if (!mine) return;
    this.prepSentAt = Date.now();
    this.gameSend("rpg.lobby.prep", { what });
  }

  /** The server's idea of what holds us differs from ours (reconnect, new group): say it again. */
  private syncPrep(l: RpgLobbyView) {
    if (!Array.isArray(l.prep)) return; // older server: no hold
    const me = this.world.me?.userId;
    const theirs = l.prep.find((p) => p.user_id === me)?.what ?? null;
    if (theirs === this.prepWhat) return;
    if (Date.now() - this.prepSentAt < 1500) return;
    this.prepSentAt = Date.now();
    this.gameSend("rpg.lobby.prep", { what: this.prepWhat });
  }

  /**
   * Our group's start panel: it opens by itself when the leader asks for the start (not the loop's:
   * whoever closed the panel to chat keeps chatting); it closes when the start is called off.
   */
  private stageFor(
    before: RpgLobbyView | null,
    now: RpgLobbyView | null,
    key: string,
  ): Partial<Pick<SpaceUiState, "stageOpen">> {
    const open = this.state.stageOpen;
    if (!now) return open ? { stageOpen: null } : {};
    const id = now.id || key;
    if (now.pending) {
      if (open) return {};
      const was = before && before.id === now.id && before.pending;
      if (was || now.pending_auto) return {};
      // The run panel already open (the last run's summary) shows the start itself.
      if (this.state.runOpen) return {};
      return { stageOpen: { lobby: id, n: 1 } };
    }
    // The start came out: keep the stage until the run arrives (the panel takes over).
    if (open && now.state !== "running") return { stageOpen: null };
    return {};
  }

  /** Open our group's start panel (the group frame's button, while the start is pending). */
  watchStage() {
    const me = this.world.me?.userId;
    const l = Object.values(this.state.lobbies).find((x) =>
      x.members.some((m) => m.user_id === me),
    );
    if (!l?.pending) return;
    this.patch({ tvMenu: null, stageOpen: { lobby: l.id, n: 1 } });
  }

  closeStage() {
    if (this.state.stageOpen) this.patch({ stageOpen: null });
  }

  /** The adventure panel closed; a run that already ended is dismissed with it. */
  closeRun() {
    const open = this.state.runOpen;
    if (!open) return;
    const runs = { ...this.state.runs };
    if (runs[open.id]?.end) delete runs[open.id];
    this.patch({ runOpen: null, runs });
  }

  /** Our own run opens by itself, once (closing it keeps it closed). */
  private autoOpenRun(id: string) {
    if (this.autoOpened.has(id)) return;
    if (this.autoOpened.size > 50) this.autoOpened.clear();
    this.autoOpened.add(id);
    this.patch({ runOpen: { id, n: (this.state.runOpen?.n ?? 0) + 1 } });
  }

  /** Room changed: keep only the runs we are in. */
  private keepOwnRuns() {
    const me = this.world.me?.userId;
    const runs: Record<string, RunState> = {};
    let changed = false;
    for (const [id, r] of Object.entries(this.state.runs)) {
      if (r.run.members.some((m) => m.user_id === me)) runs[id] = r;
      else changed = true;
    }
    if (!changed) return;
    const open = this.state.runOpen;
    this.patch({ runs, ...(open && !runs[open.id] ? { runOpen: null } : {}) });
  }

  /** The app closed the training dialog (docs/espaco/jogo/ot). */

  /** "Watch" from the TV menu: the Smart TV as before. */
  watchTv() {
    this.patch({ tvMenu: null, tvOpenRequest: this.state.tvOpenRequest + 1 });
  }

  closeNpcRequest() {
    if (this.state.npcRequest) this.patch({ npcRequest: null });
  }

  closeNewsRequest() {
    if (this.state.newsRequest) this.patch({ newsRequest: null });
  }

  closeArsenalRequest() {
    if (this.state.arsenalRequest) this.patch({ arsenalRequest: null });
  }

  /** As novidades do quadro de avisos (o servidor guarda por minutos; o Outline fica atrás dele). */
  async news(): Promise<NewsWireT> {
    const res = await fetch(
      new URL("/_muchat/space/v1/news", this.opts.baseUrl),
      {
        headers: { "X-Session-Token": this.opts.sessionToken },
      },
    );
    if (!res.ok) throw new Error(`news ${res.status}`);
    const parsed = NewsWire.safeParse(await res.json());
    if (!parsed.success) throw new Error("news: resposta fora do contrato");
    return parsed.data;
  }

  /** Liga ou desliga o alfinete vermelho dos quadros de avisos do mapa. */
  setNewsUnread(on: boolean) {
    if (this.world.newsUnread === on) return;
    this.world.newsUnread = on;
    this.renderer.refreshNews(this.world);
  }

  closeTrainRequest() {
    if (this.state.trainRequest) this.patch({ trainRequest: null });
  }

  // ---- editor API for the app ------------------------------------------------

  setEditing(on: boolean) {
    if (on && !this.world.rights.can_edit) return;
    this.editor.setEnabled(on);
    this.updatePrompt();
  }

  /** Profile (chosen look, first-access progress) of the signed-in person. */
  async profile(): Promise<ProfileView> {
    const res = await fetch(
      new URL("/_muchat/space/v1/me/profile", this.opts.baseUrl),
      {
        headers: { "X-Session-Token": this.opts.sessionToken },
      },
    );
    if (!res.ok) throw new Error(`profile ${res.status}`);
    return (await res.json()) as ProfileView;
  }

  async updateProfile(patch: ProfilePatch): Promise<ProfileView> {
    const res = await fetch(
      new URL("/_muchat/space/v1/me/profile", this.opts.baseUrl),
      {
        method: "PUT",
        headers: {
          "X-Session-Token": this.opts.sessionToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) throw new Error(`profile ${res.status}`);
    const profile = (await res.json()) as ProfileView;
    if (this.world.me) this.world.me.palette = profile.look.palette;
    return profile;
  }

  /** Walk (client-side path, server-validated) to a world point. */
  walkTo(x: number, y: number): boolean {
    return this.mover.walkTo(x, y);
  }

  /** Walk to a room's first inside tile; false when its door will not open for us. */
  walkToRoom(roomId: string): boolean {
    const room = this.world.ix?.roomsById.get(roomId);
    if (!room) return false;
    return this.mover.walkTo(
      room.inside.tx * TILE + TILE / 2,
      room.inside.ty * TILE + TILE / 2,
    );
  }

  /**
   * What the app lays over the map's right and bottom edges (sheets, the dock, the
   * run panel), in CSS pixels: the camera centres you in the rest.
   */
  setInsets(right: number, bottom: number) {
    this.renderer.setInsets(right, bottom);
  }

  /** A zoom the person picked: from now on the map keeps it (no more framing). */
  setZoom(z: number) {
    this.zoomByHand = true;
    this.renderer.setZoom(z);
    this.patch({ zoom: this.renderer.zoom });
  }

  /** "Ver no mapa": the camera looks at a room for a few seconds (walking ends it). */
  peekRoom(roomId: string): boolean {
    const room = this.world.ix?.roomsById.get(roomId);
    if (!room) return false;
    this.renderer.peek(
      room.inside.tx * TILE + TILE / 2,
      room.inside.ty * TILE + TILE / 2,
      performance.now(),
    );
    return true;
  }

  /**
   * Our call's state for the others' indicators (ADR 0008). Called by the app
   * whenever it may have changed; only a change reaches the server.
   */
  reportVoice(report: VoiceReport) {
    if (this.state.media.kind === "idle") return;
    const key = JSON.stringify(report);
    if (key === this.lastReport) return;
    this.lastReport = key;
    this.conn.send({
      v: 1,
      t: "media.state.report",
      id: this.conn.nextId(),
      d: report,
    });
  }

  /**
   * The chat bubbles of the app follow these people's heads (render/renderer.ts): `listener`
   * gets where each head is on the map's element whenever one moves. An empty set stops it.
   */
  watchHeads(
    ids: ReadonlySet<string>,
    listener: ((heads: ReadonlyMap<string, HeadAnchor>) => void) | null,
  ) {
    this.renderer.watchHeads(ids, listener);
  }

  /** Where someone is in this space: a room id, null in the halls, undefined when not on the map. */
  roomOf(userId: string): string | null | undefined {
    const me = this.world.me;
    if (me?.userId === userId) return me.room;
    const r = this.world.others.get(userId);
    return r ? r.room : undefined;
  }

  /** Who is speaking in our room's call right now (LiveKit, from the app). */
  setSpeakers(userIds: ReadonlySet<string>) {
    const prev = this.world.speakers;
    if (prev.size === userIds.size && [...userIds].every((id) => prev.has(id)))
      return;
    this.world.speakers = userIds;
    this.renderer.invalidate();
  }

  /** A moderator ends someone's screen share in our room (MuteMembers; the server decides). */
  stopScreenOf(userId: string): string {
    const id = this.conn.nextId();
    this.conn.send({ v: 1, t: "screen.stop", id, d: { user_id: userId } });
    return id;
  }

  /** "Usar aqui" after another tab took over. */
  takeOver() {
    this.conn.takeOver();
  }

  /** "Tentar de novo" / "Usar aqui" / "Voltar ao áudio" for the room's audio. */
  retryMedia() {
    this.media?.retry();
  }

  /** The app's voice changed under us (see MediaLink.voiceChanged). */
  voiceChanged(change: "dropped" | "gone") {
    this.media?.voiceChanged(change);
  }

  /** True while this space holds (or is setting up) the person's room audio. */
  get holdsAudio(): boolean {
    const k = this.state.media.kind;
    return k === "connected" || k === "connecting" || k === "unavailable";
  }

  get isAttached(): boolean {
    return this.attached;
  }

  /**
   * Leaving the page while in a room keeps the space connected (presence and
   * audio go on, like a call), without drawing. `attach` brings it back.
   */
  detach() {
    if (!this.attached) return;
    this.attached = false;
    for (const fn of this.inputCleanup) fn();
    this.inputCleanup = [];
    this.mover.clearKeys();
    this.mover.cancelPath();
    this.editor.setEnabled(false);
    this.renderer.detach();
  }

  attach(el: HTMLElement) {
    if (this.attached) return;
    this.attached = true;
    this.opts.el = el;
    this.renderer.attach(el);
    this.bindInput(el);
    this.renderer.rebuildStatic(this.world);
    this.renderer.rebuildDecor(this.world);
    this.dirtyUi = true;
    this.flushUi();
  }

  destroy() {
    if (this.uiTimer) clearInterval(this.uiTimer);
    for (const fn of this.inputCleanup) fn();
    this.inputCleanup = [];
    this.media?.destroy();
    this.conn.stop();
    this.renderer.destroy();
  }
}
