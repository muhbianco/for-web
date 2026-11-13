import {
  type AvatarView,
  type CompiledMap,
  type CompiledMapWire,
  type Direction,
  type DoorRule,
  indexMap,
  type MapIndex,
  type RoomView,
  type WingView,
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
}

export type WorldEvent =
  | { kind: "room_changed"; from: string | null; to: string | null }
  | { kind: "corrected"; reason: string }
  | { kind: "layout_changed"; fingerprint: string; url: string }
  | { kind: "rooms_changed" };

/**
 * Client copy of the world: what the server confirmed, plus our own predicted
 * position. Pure state with no DOM, so it runs under node:test.
 */
export class World {
  map: CompiledMap | null = null;
  ix: MapIndex | null = null;
  fingerprint = "";
  me: Me | null = null;
  readonly rooms = new Map<string, RoomView>();
  readonly wings = new Map<number, WingView>();
  readonly others = new Map<string, Remote>();
  private readonly listeners = new Set<(e: WorldEvent) => void>();

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
    this.fingerprint = map.fingerprint;
  }

  /** The door opens for rooms we may enter, and always for the room we are in. */
  readonly doorRule: DoorRule = (roomId) => roomId === this.me?.room || this.rooms.get(roomId)?.can_enter === true;

  applySnapshot(d: {
    layout: { fingerprint: string };
    you: { user_id: string; name: string; look: { palette: number }; x: number; y: number; room: string | null; seq: number };
    rooms: RoomView[];
    wings: WingView[];
    avatars: AvatarView[];
  }, nowMs: number) {
    const prevRoom = this.me?.room ?? null;
    this.me = { userId: d.you.user_id, name: d.you.name, palette: d.you.look.palette, x: d.you.x, y: d.you.y, room: d.you.room, seq: Math.max(this.me?.seq ?? 0, d.you.seq), dir: this.me?.dir ?? "down", moving: false };
    this.setRooms(d.rooms, d.wings);
    this.others.clear();
    for (const a of d.avatars) this.upsertRemote(a, nowMs);
    if (prevRoom !== d.you.room) this.emit({ kind: "room_changed", from: prevRoom, to: d.you.room });
  }

  setRooms(rooms: RoomView[], wings: WingView[]) {
    this.rooms.clear();
    for (const r of rooms) this.rooms.set(r.room_id, r);
    this.wings.clear();
    for (const w of wings) this.wings.set(w.index, w);
    this.emit({ kind: "rooms_changed" });
  }

  private upsertRemote(a: AvatarView, nowMs: number) {
    if (a.user_id === this.me?.userId) return;
    let r = this.others.get(a.user_id);
    if (!r) {
      r = { userId: a.user_id, name: a.name, palette: a.look.palette, room: a.room, state: a.state, dir: a.dir, moving: a.moving, samples: [] };
      this.others.set(a.user_id, r);
    }
    r.name = a.name;
    r.palette = a.look.palette;
    r.room = a.room;
    r.state = a.state;
    r.dir = a.dir;
    r.moving = a.moving;
    r.samples.push({ t: nowMs, x: a.x, y: a.y });
    if (r.samples.length > MAX_SAMPLES) r.samples.splice(0, r.samples.length - MAX_SAMPLES);
  }

  applyPositions(d: { avatars: AvatarView[]; gone: string[] }, nowMs: number) {
    for (const a of d.avatars) this.upsertRemote(a, nowMs);
    for (const id of d.gone) this.others.delete(id);
  }

  /** The server's word wins: snap to it. */
  applyCorrection(d: { x: number; y: number; room: string | null; seq: number; reason: string }) {
    if (!this.me) return;
    const prevRoom = this.me.room;
    this.me.x = d.x;
    this.me.y = d.y;
    this.me.room = d.room;
    this.me.moving = false;
    this.me.seq = Math.max(this.me.seq, d.seq);
    this.emit({ kind: "corrected", reason: d.reason });
    if (prevRoom !== d.room) this.emit({ kind: "room_changed", from: prevRoom, to: d.room });
  }

  /** Our predicted move crossed into or out of a room. */
  setMyRoom(room: string | null) {
    if (!this.me || this.me.room === room) return;
    const from = this.me.room;
    this.me.room = room;
    this.emit({ kind: "room_changed", from, to: room });
  }

  layoutChanged(fingerprint: string, url: string) {
    if (fingerprint !== this.fingerprint) this.emit({ kind: "layout_changed", fingerprint, url });
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
