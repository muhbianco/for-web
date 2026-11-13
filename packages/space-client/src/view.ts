import { type CompiledMapWire, type ProfilePatch, type ProfileView, TILE } from "@muchat/space-core";

import { type ConnStatus, SpaceConnection } from "./connection.ts";
import { announceRoomChange, buildList, type ListWing, locationText } from "./list.ts";
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
}

export interface SpaceUiState {
  status: ConnStatus;
  location: string;
  list: ListWing[];
  /** Last message for the aria-live region. */
  announcement: string;
  zoom: number;
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
 * Wires connection + world + local movement + renderer + input. Framework
 * agnostic: the Muchat client (Solid) only mounts it and renders SpaceUiState.
 */
export class SpaceView {
  readonly world = new World();
  private readonly renderer = new Renderer();
  private readonly conn: SpaceConnection;
  private readonly mover: Mover;
  private readonly opts: SpaceViewOptions;
  private readonly listeners = new Set<(s: SpaceUiState) => void>();
  private state: SpaceUiState = { status: "connecting", location: "", list: [], announcement: "", zoom: 2 };
  private dirtyUi = true;
  private uiTimer: ReturnType<typeof setInterval> | undefined;
  private readonly cleanup: Array<() => void> = [];

  private constructor(opts: SpaceViewOptions) {
    this.opts = opts;
    this.mover = new Mover(this.world, (cmd) => this.conn.send(cmd as unknown as Record<string, unknown>));
    this.conn = new SpaceConnection({
      baseUrl: opts.baseUrl,
      sessionToken: opts.sessionToken,
      serverId: opts.serverId,
      client: opts.client,
      onStatus: (status) => this.patch({ status }),
      onEvent: (e) => void this.onEvent(e),
    });
  }

  static async mount(opts: SpaceViewOptions): Promise<SpaceView> {
    const v = new SpaceView(opts);
    v.renderer.reducedMotion = opts.reducedMotion ?? false;
    await v.renderer.init(opts.el);
    v.bindInput();
    v.world.on((e) => {
      if (e.kind === "room_changed") v.patch({ announcement: announceRoomChange(v.world, e.from, e.to) });
      if (e.kind === "corrected") v.mover.resync();
      if (e.kind === "layout_changed") void v.loadMap(e.url);
      if (e.kind === "rooms_changed") v.renderer.rebuildStatic(v.world);
      v.dirtyUi = true;
    });
    v.renderer.app.ticker.add((t) => {
      const now = performance.now();
      v.mover.step(t.deltaMS, now);
      v.renderer.frame(v.world, now, t.deltaMS);
    });
    // List and location at 4 Hz: occupancy follows movement without a re-render per frame.
    v.uiTimer = setInterval(() => {
      v.dirtyUi = true;
      v.flushUi();
    }, 250);
    v.conn.start();
    return v;
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
    this.patch({ location: locationText(this.world), list: buildList(this.world), zoom: this.renderer.zoom });
  }

  private async loadMap(url: string) {
    const res = await fetch(new URL(url, this.opts.baseUrl), { headers: { "X-Session-Token": this.opts.sessionToken } });
    if (!res.ok) throw new Error(`layout ${res.status}`);
    const wire = (await res.json()) as CompiledMapWire;
    this.world.setMap(decodeMap(wire));
    this.renderer.rebuildStatic(this.world);
    this.dirtyUi = true;
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
    }
  }

  private bindInput() {
    const el = this.opts.el;
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    const down = (ev: KeyboardEvent) => {
      const k = KEYS[ev.code];
      if (k) {
        ev.preventDefault();
        this.mover.setKey(k, true);
        return;
      }
      if (ev.key === "Escape") this.mover.cancelPath();
      if (ev.key === "+" || ev.key === "=") this.setZoom(this.renderer.zoom + 1);
      if (ev.key === "-") this.setZoom(this.renderer.zoom - 1);
    };
    const up = (ev: KeyboardEvent) => {
      const k = KEYS[ev.code];
      if (k) this.mover.setKey(k, false);
    };
    const blur = () => this.mover.clearKeys();
    const pointer = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      el.focus();
      const rect = this.renderer.app.canvas.getBoundingClientRect();
      const p = this.renderer.screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      if (!this.mover.walkTo(p.x, p.y)) this.patch({ announcement: "Não dá para chegar lá." });
    };
    const visibility = () =>
      this.conn.send({ v: 1, t: "presence.idle", id: this.conn.nextId(), d: { idle: document.visibilityState === "hidden" } });
    el.addEventListener("keydown", down);
    el.addEventListener("keyup", up);
    el.addEventListener("blur", blur);
    this.renderer.app.canvas.addEventListener("pointerdown", pointer);
    document.addEventListener("visibilitychange", visibility);
    this.cleanup.push(
      () => el.removeEventListener("keydown", down),
      () => el.removeEventListener("keyup", up),
      () => el.removeEventListener("blur", blur),
      () => this.renderer.app.canvas.removeEventListener("pointerdown", pointer),
      () => document.removeEventListener("visibilitychange", visibility),
    );
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

  destroy() {
    if (this.uiTimer) clearInterval(this.uiTimer);
    for (const fn of this.cleanup) fn();
    this.conn.stop();
    this.renderer.destroy();
  }
}
