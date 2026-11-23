import {
  type AvatarView,
  type CompiledMap,
  type CompiledMapWire,
  type DecorOp,
  type DecorRights,
  type DecorState,
  type Direction,
  type DoorRule,
  type MapIndex,
  type PresenceEvent,
  type RoomView,
  type TvState,
  type WingView,
  type ZoneIndex,
  applyDecorOp,
  CATALOG,
  indexMap,
  setSolid,
  solidMask,
  zonesOf,
} from "@muchat/space-core";

/** Remote avatars are drawn this far in the past, between two received samples. */
export const INTERP_DELAY_MS = 100;
const MAX_SAMPLES = 12;

export function decodeMap(w: CompiledMapWire): CompiledMap {
  const bin = atob(w.tiles);
  const tiles = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) tiles[i] = bin.charCodeAt(i);
  return { ...w, tiles };
}

export interface Me {
  userId: string;
  name: string;
  palette: number;
  x: number;
  y: number;
  room: string | null;
  seq: number;
  dir: Direction;
  moving: boolean;
}

export interface Remote {
  userId: string;
  name: string;
  palette: number;
  room: string | null;
  state: AvatarView["state"];
  dir: Direction;
  moving: boolean;
  samples: Array<{ t: number; x: number; y: number }>;
  /** Idle game: level and training, shown under the name (docs/espaco/jogo/ot). */
  hero: { level: number; training: boolean } | null;
}

export type WorldEvent =
  /** `local`: our own predicted walk crossed the door (the person's intent), not a server placement. */
  | {
      kind: "room_changed";
      from: string | null;
      to: string | null;
      local?: boolean;
    }
  | { kind: "corrected"; reason: string }
  | { kind: "layout_changed"; fingerprint: string; url: string }
  | { kind: "rooms_changed" }
  /** The decoration changed by one op (or wholesale: `reset`). */
  | { kind: "decor_changed"; op: DecorOp }
  /** We missed a revision: fetch the whole decoration again. */
  | { kind: "decor_stale" }
  | { kind: "rights_changed" }
  /** Who is in which room, in which call, muted or sharing (server presence). */
  | { kind: "presence_changed" }
  /** The TV of our room changed (ADR 0008). */
  | { kind: "tv_changed" };

/**
 * Client copy of the world: what the server confirmed, plus our own predicted
 * position. Pure state with no DOM, so it runs under node:test.
 */
export class World {
  /** Our own hero (from `rpg.state`): its level and training under our name. */
  myHero: { level: number; training: boolean } | null = null;
  map: CompiledMap | null = null;
  ix: MapIndex | null = null;
  zones: ZoneIndex | null = null;
  fingerprint = "";
  me: Me | null = null;
  readonly rooms = new Map<string, RoomView>();
  readonly wings = new Map<number, WingView>();
  readonly others = new Map<string, Remote>();
  /** Decoration of this space (ADR 0007); null until the first fetch. */
  decor: DecorState | null = null;
  decorUrl = "";
  /** Revision the server announced last; the fetch brings at least this one. */
  decorRevWanted = 0;
  rights: DecorRights = { can_edit: false, can_manage: false };
  /** Who is where, from the server (ADR 0008); null until the first presence. */
  presence: PresenceEvent["d"] | null = null;
  /** People speaking in our own room's call (LiveKit, given by the app). */
  speakers: ReadonlySet<string> = new Set();
  private readonly listeners = new Set<(e: WorldEvent) => void>();

  setPresence(p: PresenceEvent["d"]) {
    this.presence = p;
    this.emit({ kind: "presence_changed" });
  }

  /** TV of the rooms we were inside (full state); other rooms come from presence. */
  readonly tvStates = new Map<string, TvState | null>();

  setTv(roomId: string, state: TvState | null) {
    this.tvStates.set(roomId, state);
    this.emit({ kind: "tv_changed" });
  }

  /** The room's TV is playing (drawn lit on the map). */
  tvOn(roomId: string): boolean {
    if (this.me?.room === roomId && this.tvStates.has(roomId))
      return this.tvStates.get(roomId)?.status === "playing";
    return (
      this.presence?.rooms.find((r) => r.room_id === roomId)?.tv === "playing"
    );
  }

  /** Voice state of someone as the presence says (null: not in a call we may see). */
  voiceOf(userId: string) {
    for (const r of this.presence?.rooms ?? []) {
      const p = r.people.find((x) => x.user_id === userId);
      if (p) return p.voice;
    }
    return null;
  }

  on(fn: (e: WorldEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: WorldEvent) {
    for (const fn of this.listeners) fn(e);
  }

  setMap(map: CompiledMap) {
    this.map = map;
    this.ix = indexMap(map);
    this.zones = zonesOf(map);
    this.fingerprint = map.fingerprint;
    this.refreshSolid();
  }

  /** The door opens for rooms we may enter that have a free place, and always for the room we are in. */
  readonly doorRule: DoorRule = (roomId) =>
    roomId === this.me?.room ||
    (this.rooms.get(roomId)?.can_enter === true && !this.isFull(roomId));

  /** Same rule as the server (voice.max_users), from the avatars we see inside. */
  isFull(roomId: string): boolean {
    const cap = this.rooms.get(roomId)?.capacity ?? null;
    if (cap === null) return false;
    let n = this.me?.room === roomId ? 1 : 0;
    for (const o of this.others.values()) if (o.room === roomId) n++;
    return n >= cap;
  }

  applySnapshot(
    d: {
      layout: { fingerprint: string };
      decor?: { rev: number; url: string };
      you: {
        user_id: string;
        name: string;
        look: { palette: number };
        x: number;
        y: number;
        room: string | null;
        seq: number;
        decor?: DecorRights;
      };
      rooms: RoomView[];
      wings: WingView[];
      avatars: AvatarView[];
    },
    nowMs: number,
  ) {
    const prevRoom = this.me?.room ?? null;
    this.me = {
      userId: d.you.user_id,
      name: d.you.name,
      palette: d.you.look.palette,
      x: d.you.x,
      y: d.you.y,
      room: d.you.room,
      seq: Math.max(this.me?.seq ?? 0, d.you.seq),
      dir: this.me?.dir ?? "down",
      moving: false,
    };
    this.setRooms(d.rooms, d.wings);
    this.others.clear();
    for (const a of d.avatars) this.upsertRemote(a, nowMs);
    if (d.decor) {
      this.decorUrl = d.decor.url;
      this.decorRevWanted = d.decor.rev;
    }
    if (d.you.decor) this.setRights(d.you.decor);
    if (prevRoom !== d.you.room)
      this.emit({ kind: "room_changed", from: prevRoom, to: d.you.room });
  }

  setRooms(rooms: RoomView[], wings: WingView[]) {
    this.rooms.clear();
    for (const r of rooms) this.rooms.set(r.room_id, r);
    this.wings.clear();
    for (const w of wings) this.wings.set(w.index, w);
    this.emit({ kind: "rooms_changed" });
  }

  setRights(rights: DecorRights) {
    if (
      rights.can_edit === this.rights.can_edit &&
      rights.can_manage === this.rights.can_manage
    )
      return;
    this.rights = rights;
    this.emit({ kind: "rights_changed" });
  }

  // ---- decoration ----------------------------------------------------------

  /** Whole state from the server (first load, or after a missed revision). */
  setDecor(state: DecorState) {
    this.decor = state;
    this.decorRevWanted = Math.max(this.decorRevWanted, state.rev);
    this.refreshSolid();
    this.emit({ kind: "decor_changed", op: { kind: "reset" } });
  }

  /**
   * One change announced by the server. Applied only when it is the very next
   * revision; otherwise the whole state is fetched again (`decor_stale`).
   */
  applyDecorOp(rev: number, op: DecorOp): boolean {
    this.decorRevWanted = Math.max(this.decorRevWanted, rev);
    if (!this.decor || op.kind === "reset" || rev !== this.decor.rev + 1) {
      if (this.decor?.rev !== rev) this.emit({ kind: "decor_stale" });
      return false;
    }
    this.decor = applyDecorOp(this.decor, op, rev);
    this.refreshSolid();
    this.emit({ kind: "decor_changed", op });
    return true;
  }

  /** Movement and pathing see the furniture exactly as the server does. */
  private refreshSolid() {
    if (!this.map || !this.ix || !this.zones || !this.decor) return;
    setSolid(
      this.ix,
      solidMask(this.map, this.zones, CATALOG, this.decor.items),
    );
  }

  private upsertRemote(a: AvatarView, nowMs: number) {
    if (a.user_id === this.me?.userId) return;
    let r = this.others.get(a.user_id);
    if (!r) {
      r = {
        userId: a.user_id,
        name: a.name,
        palette: a.look.palette,
        room: a.room,
        state: a.state,
        dir: a.dir,
        moving: a.moving,
        samples: [],
        hero: null,
      };
      this.others.set(a.user_id, r);
    }
    r.name = a.name;
    r.palette = a.look.palette;
    r.room = a.room;
    r.state = a.state;
    r.dir = a.dir;
    r.moving = a.moving;
    r.hero = a.hero ? { level: a.hero.level, training: a.hero.training } : null;
    r.samples.push({ t: nowMs, x: a.x, y: a.y });
    if (r.samples.length > MAX_SAMPLES)
      r.samples.splice(0, r.samples.length - MAX_SAMPLES);
  }

  applyPositions(d: { avatars: AvatarView[]; gone: string[] }, nowMs: number) {
    for (const a of d.avatars) this.upsertRemote(a, nowMs);
    for (const id of d.gone) this.others.delete(id);
  }

  /** The server's word wins: snap to it. */
  applyCorrection(d: {
    x: number;
    y: number;
    room: string | null;
    seq: number;
    reason: string;
  }) {
    if (!this.me) return;
    const prevRoom = this.me.room;
    this.me.x = d.x;
    this.me.y = d.y;
    this.me.room = d.room;
    this.me.moving = false;
    this.me.seq = Math.max(this.me.seq, d.seq);
    this.emit({ kind: "corrected", reason: d.reason });
    if (prevRoom !== d.room)
      this.emit({ kind: "room_changed", from: prevRoom, to: d.room });
  }

  /** Our predicted move crossed into or out of a room. */
  setMyRoom(room: string | null) {
    if (!this.me || this.me.room === room) return;
    const from = this.me.room;
    this.me.room = room;
    this.emit({ kind: "room_changed", from, to: room, local: true });
  }

  layoutChanged(fingerprint: string, url: string) {
    if (fingerprint !== this.fingerprint)
      this.emit({ kind: "layout_changed", fingerprint, url });
  }

  /** Interpolated position of a remote avatar at `nowMs`. */
  positionOf(r: Remote, nowMs: number): { x: number; y: number } {
    const s = r.samples;
    const last = s[s.length - 1];
    if (!last) return { x: 0, y: 0 };
    const t = nowMs - INTERP_DELAY_MS;
    if (t >= last.t || s.length === 1) return { x: last.x, y: last.y };
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (t >= a.t) {
        const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return { x: s[0]!.x, y: s[0]!.y };
  }
}
