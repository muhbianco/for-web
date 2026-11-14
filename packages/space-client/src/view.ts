import {
  CATALOG,
  type CompiledMapWire,
  type DecorInstance,
  type DecorItem,
  type DecorRights,
  type DecorSettings,
  type DecorState,
  instanceRect,
  type InteractionConfig,
  itemOf,
  type ProfilePatch,
  type ProfileView,
  TILE,
} from "@muchat/space-core";

import { type ConnStatus, SpaceConnection } from "./connection.ts";
import { Editor, type EditorState } from "./editor.ts";
import { nearestInteractive, type Prompt } from "./interact.ts";
import { announceRoomChange, buildList, type ListWing, locationText, zoneList, type ZoneOption } from "./list.ts";
import { MediaLink, type MediaStatus, type VoicePort } from "./media.ts";
import { Mover } from "./mover.ts";
import { Renderer } from "./render/renderer.ts";
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

  private constructor(opts: SpaceViewOptions) {
    this.opts = opts;
    this.mover = new Mover(this.world, (cmd) => this.conn.send(cmd as unknown as Record<string, unknown>));
    this.conn = new SpaceConnection({
      baseUrl: opts.baseUrl,
      sessionToken: opts.sessionToken,
      serverId: opts.serverId,
      client: opts.client,
      onStatus: (status) => {
        // The session is over here (another tab, expired, not a member): leave its call.
        if (status === "replaced" || status === "unauthenticated" || status === "not_member") this.media?.detach();
        this.patch({ status });
      },
      onEvent: (e) => void this.onEvent(e),
    });
    this.media = opts.voice
      ? new MediaLink({
          voice: opts.voice,
          request: () => this.conn.send({ v: 1, t: "media.session.request", id: this.conn.nextId() }),
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
    };
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
          v.patch({ announcement: announceRoomChange(v.world, e.from, e.to) });
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
          v.patch({ decorRev: v.world.decor?.rev ?? 0, settings: v.world.decor?.settings ?? null });
          v.updatePrompt();
          break;
        case "decor_stale":
          void v.loadDecor();
          break;
        case "rights_changed":
          if (!v.world.rights.can_edit && v.editor.state.enabled) v.editor.setEnabled(false);
          v.patch({ rights: v.world.rights });
          break;
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
    this.patch({ location: locationText(this.world), list: buildList(this.world), zoom: this.renderer.zoom, zones: zoneList(this.world) });
  }

  private async loadMap(url: string) {
    const res = await fetch(new URL(url, this.opts.baseUrl), { headers: { "X-Session-Token": this.opts.sessionToken } });
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
      const url = this.world.decorUrl || `/_muchat/space/v1/spaces/${this.opts.serverId}/decor`;
      const res = await fetch(new URL(url, this.opts.baseUrl), { headers: { "X-Session-Token": this.opts.sessionToken } });
      if (!res.ok) throw new Error(`decor ${res.status}`);
      const state = (await res.json()) as DecorState;
      this.world.setDecor({ ...state, furnished: state.furnished ?? [] });
    })().finally(() => {
      this.decorLoading = null;
      // A newer revision was announced while we fetched: once more.
      if (this.world.decor && this.world.decor.rev < this.world.decorRevWanted) void this.loadDecor();
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
        if (d.layout.fingerprint !== this.world.fingerprint) await this.loadMap(d.layout.url);
        this.world.applySnapshot(d, now);
        this.mover.resync();
        this.renderer.rebuildStatic(this.world);
        if (!this.world.decor || this.world.decor.rev !== d.decor?.rev) await this.loadDecor().catch(() => undefined);
        this.patch({ rights: this.world.rights, settings: this.world.decor?.settings ?? null, decorRev: this.world.decor?.rev ?? 0 });
        this.dirtyUi = true;
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
        this.editor.onChanged(d.op, typeof e.re === "string" ? e.re : undefined);
        return;
      case "decor.rights":
        this.world.setRights(d);
        return;
      case "error":
        if (d?.code && (typeof e.re === "string" || d.code === "not_allowed")) this.editor.onError(typeof e.re === "string" ? e.re : undefined, d.code, d.reason);
        return;
      case "media.grant":
        return this.media?.onGrant(d);
      case "media.revoked":
        return this.media?.onRevoked(d);
      case "media.unavailable":
        return this.media?.onUnavailable(d);
    }
  }

  // ---- input -----------------------------------------------------------------

  private bindInput(el: HTMLElement) {
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    const down = (ev: KeyboardEvent) => {
      if (this.editor.state.enabled && this.editorKey(ev)) {
        ev.preventDefault();
        return;
      }
      const k = KEYS[ev.code];
      if (k) {
        ev.preventDefault();
        this.mover.setKey(k, true);
        return;
      }
      if (ev.code === "KeyE" || ev.key === "Enter") {
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
      if (ev.key === "+" || ev.key === "=") this.setZoom(this.renderer.zoom + 1);
      if (ev.key === "-") this.setZoom(this.renderer.zoom - 1);
    };
    const up = (ev: KeyboardEvent) => {
      const k = KEYS[ev.code];
      if (k) this.mover.setKey(k, false);
    };
    const blur = () => this.mover.clearKeys();
    const canvasPoint = (ev: PointerEvent) => {
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      return this.renderer.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    };
    const pointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      el.focus();
      const p = canvasPoint(ev);
      this.pointerDownAt = { x: p.x, y: p.y, t: performance.now() };
      if (this.editor.state.enabled) {
        this.editor.pointerDown(p.x, p.y);
        return;
      }
    };
    const pointerMove = (ev: PointerEvent) => {
      if (!this.editor.state.enabled) return;
      const p = canvasPoint(ev);
      this.editor.hover(p.x, p.y);
    };
    const pointerUp = (ev: PointerEvent) => {
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
      const hit = this.editor.instanceAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
      if (hit && this.prompt && hit.inst.id === this.prompt.inst.id) {
        this.interact();
        return;
      }
      if (!this.mover.walkTo(p.x, p.y)) this.patch({ announcement: "Não dá para chegar lá." });
    };
    const leave = () => {
      if (this.editor.state.enabled) this.editor.hover(-1e9, -1e9);
    };
    const visibility = () =>
      this.conn.send({ v: 1, t: "presence.idle", id: this.conn.nextId(), d: { idle: document.visibilityState === "hidden" } });
    const canvas = this.renderer.app.canvas;
    el.addEventListener("keydown", down);
    el.addEventListener("keyup", up);
    el.addEventListener("blur", blur);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", visibility);
    this.inputCleanup.push(
      () => el.removeEventListener("keydown", down),
      () => el.removeEventListener("keyup", up),
      () => el.removeEventListener("blur", blur),
      () => canvas.removeEventListener("pointerdown", pointerDown),
      () => canvas.removeEventListener("pointermove", pointerMove),
      () => canvas.removeEventListener("pointerup", pointerUp),
      () => canvas.removeEventListener("pointerleave", leave),
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
      ghost: s.ghost ? { item: s.ghost.item, rot: s.ghost.inst.rot, variant: s.ghost.inst.variant, rect: s.ghost.rect, valid: s.ghost.error === null } : null,
      selected: selectedRect,
    };
  }

  private updatePrompt() {
    const p = this.editor.state.enabled ? null : nearestInteractive(this.world);
    const changed = (p?.inst.id ?? null) !== (this.prompt?.inst.id ?? null) || p?.label !== this.prompt?.label;
    this.prompt = p;
    this.renderer.prompt = p ? { x: p.x, y: p.y, label: p.label } : null;
    if (changed) this.patch({ prompt: p ? { id: p.inst.id, label: p.label } : null });
  }

  /** Use the interactive object within reach (E, Enter, tap). */
  interact() {
    const p = this.prompt;
    if (!p) return;
    if (p.item.interaction === "teleport") {
      this.conn.send({ v: 1, t: "avatar.teleport", id: this.conn.nextId(), d: { id: p.inst.id } });
      return;
    }
    this.patch({ interaction: { inst: p.inst, item: p.item, config: p.inst.config ?? {} } });
  }

  closeInteraction() {
    if (this.state.interaction) this.patch({ interaction: null });
  }

  // ---- editor API for the app ------------------------------------------------

  setEditing(on: boolean) {
    if (on && !this.world.rights.can_edit) return;
    this.editor.setEnabled(on);
    this.updatePrompt();
  }

  /** Profile (chosen look, first-access progress) of the signed-in person. */
  async profile(): Promise<ProfileView> {
    const res = await fetch(new URL("/_muchat/space/v1/me/profile", this.opts.baseUrl), {
      headers: { "X-Session-Token": this.opts.sessionToken },
    });
    if (!res.ok) throw new Error(`profile ${res.status}`);
    return (await res.json()) as ProfileView;
  }

  async updateProfile(patch: ProfilePatch): Promise<ProfileView> {
    const res = await fetch(new URL("/_muchat/space/v1/me/profile", this.opts.baseUrl), {
      method: "PUT",
      headers: { "X-Session-Token": this.opts.sessionToken, "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
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
    return this.mover.walkTo(room.inside.tx * TILE + TILE / 2, room.inside.ty * TILE + TILE / 2);
  }

  setZoom(z: number) {
    this.renderer.setZoom(z);
    this.patch({ zoom: this.renderer.zoom });
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
