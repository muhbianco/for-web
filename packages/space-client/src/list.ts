import { type PresenceVoice, TILE } from "@muchat/space-core";

import type { World } from "./world.ts";

/**
 * Text model of the space for the accessible list and for screen readers:
 * the same information as the map, without depending on seeing it. Read-only
 * in Phase 2; "Ir"/"Bater" arrive with doors (Phase 4).
 */
/** Someone inside a room, as the list and the map's tooltip show them (ADR 0008). */
export interface ListPerson {
  userId: string;
  name: string;
  state: "online" | "idle" | "reconnecting";
  /** null: in the room without its call. */
  voice: PresenceVoice | null;
}

export interface ListRoom {
  roomId: string;
  title: string;
  here: boolean;
  canEnter: boolean;
  isPrivate: boolean;
  /** The viewer may see the room's name and chat (Stoat ViewChannel). */
  canView: boolean;
  occupants: number | null;
  status: string;
  /** Who is inside (server presence); empty when unknown or not visible. */
  people: ListPerson[];
  /** Cheap equality for `people` (keeps unchanged rows' DOM). */
  peopleKey: string;
}

export interface ListWing {
  index: number;
  /** null when the viewer cannot see any room of the wing (category name hidden). */
  title: string | null;
  rooms: ListRoom[];
}

/** A zone as the editor shows it (portal targets, floor tool). */
export interface ZoneOption {
  key: string;
  label: string;
}

/** Display name of a wing for headings and the location line. */
export function wingHeading(title: string | null): string {
  return title ? `Ala ${title}` : "Ala restrita";
}

const PRIVATE_TITLE = "Sala privada";

function people(n: number): string {
  if (n === 0) return "vazia";
  return n === 1 ? "1 pessoa" : `${n} pessoas`;
}

export function roomTitle(world: World, roomId: string): string {
  return world.rooms.get(roomId)?.label ?? PRIVATE_TITLE;
}

export function buildList(world: World): ListWing[] {
  const map = world.map;
  if (!map) return [];
  // Occupancy and names come from the server's presence (ADR 0008). Until the
  // first presence arrives, the avatars we can see give a live count. For
  // rooms we may not view, the server sends neither, so the count stays null.
  const live = new Map<string, number>();
  const count = (room: string | null) => {
    if (room) live.set(room, (live.get(room) ?? 0) + 1);
  };
  count(world.me?.room ?? null);
  for (const o of world.others.values()) count(o.room);
  const presence = world.presence;
  const byWing = new Map<number, ListRoom[]>();
  for (const r of map.rooms) {
    const view = world.rooms.get(r.roomId);
    const inside: ListPerson[] =
      view?.occupants && presence
        ? (presence.rooms.find((x) => x.room_id === r.roomId)?.people ?? []).map((p) => ({
            userId: p.user_id,
            name: p.name,
            state: p.state,
            voice: p.voice,
          }))
        : [];
    const occupants = view?.occupants ? (presence ? inside.length : (live.get(r.roomId) ?? 0)) : null;
    const here = world.me?.room === r.roomId;
    const parts: string[] = [];
    if (here) parts.push("você está aqui");
    if (occupants !== null) parts.push(people(occupants));
    if (view && !view.can_enter) parts.push("sem acesso");
    else if (!here && world.isFull(r.roomId)) parts.push("cheia");
    const item: ListRoom = {
      roomId: r.roomId,
      title: view?.label ?? PRIVATE_TITLE,
      here,
      canEnter: view?.can_enter ?? false,
      isPrivate: view?.private ?? true,
      canView: view?.label != null,
      occupants,
      status: parts.join(" · "),
      people: inside,
      peopleKey: JSON.stringify(inside),
    };
    const list = byWing.get(r.wingIndex) ?? [];
    list.push(item);
    byWing.set(r.wingIndex, list);
  }
  return map.wings
    .filter((w) => byWing.has(w.index))
    .map((w) => ({ index: w.index, title: world.wings.get(w.index)?.title ?? null, rooms: byWing.get(w.index) ?? [] }));
}

function sameRoom(a: ListRoom, b: ListRoom): boolean {
  return (
    a.roomId === b.roomId &&
    a.title === b.title &&
    a.here === b.here &&
    a.canEnter === b.canEnter &&
    a.isPrivate === b.isPrivate &&
    a.canView === b.canView &&
    a.occupants === b.occupants &&
    a.status === b.status &&
    a.peopleKey === b.peopleKey
  );
}

/**
 * Reuses `prev` items that did not change (matched by `key`), and `prev` itself
 * when nothing changed. Keyed UI lists (Solid's `<For>` compares by reference)
 * then keep their DOM: rebuilt from scratch every 250 ms, the room list lost
 * hover and focus and redid every row 4 times a second.
 */
function share<T>(prev: readonly T[], next: T[], key: (item: T) => string | number, same: (a: T, b: T) => boolean): T[] {
  const byKey = new Map(prev.map((item) => [key(item), item]));
  let unchanged = prev.length === next.length;
  const out = next.map((item, i) => {
    const old = byKey.get(key(item));
    const kept = old !== undefined && same(old, item) ? old : item;
    if (kept !== prev[i]) unchanged = false;
    return kept;
  });
  return unchanged ? (prev as T[]) : out;
}

/** `next` with every unchanged wing and room taken from `prev` (see `share`). */
export function shareList(prev: readonly ListWing[], next: ListWing[]): ListWing[] {
  const prevByIndex = new Map(prev.map((w) => [w.index, w]));
  const withRooms = next.map((w) => {
    const old = prevByIndex.get(w.index);
    return old ? { ...w, rooms: share(old.rooms, w.rooms, (r) => r.roomId, sameRoom) } : w;
  });
  return share(prev, withRooms, (w) => w.index, (a, b) => a.title === b.title && a.rooms === b.rooms);
}

/** `next` with every unchanged zone taken from `prev` (see `share`). */
export function shareZones(prev: readonly ZoneOption[], next: ZoneOption[]): ZoneOption[] {
  return share(prev, next, (z) => z.key, (a, b) => a.label === b.label);
}

/** What the live region says when our room changes. */
export function announceRoomChange(world: World, from: string | null, to: string | null): string {
  if (to) return `Você entrou em ${roomTitle(world, to)}.`;
  if (from) return `Você saiu de ${roomTitle(world, from)}.`;
  return "";
}

/** Name of a zone key for the editor, with the viewer's room names. */
export function zoneLabel(world: World, key: string): string {
  if (key === "hall") return "Hall de entrada";
  if (key === "spine") return "Corredor principal";
  if (key.startsWith("wing:")) return `Corredor · ${wingHeading(world.wings.get(Number(key.slice(5)))?.title ?? null)}`;
  if (key.startsWith("room:")) return roomTitle(world, key.slice(5));
  return key;
}

/** Zones a portal may point to: common areas and the rooms this person can view. */
export function zoneList(world: World): ZoneOption[] {
  const zones = world.zones;
  if (!zones) return [];
  return zones.list
    .filter((z) => z.kind !== "room" || world.rooms.get(z.roomId ?? "")?.label != null)
    .map((z) => ({ key: z.key, label: zoneLabel(world, z.key) }));
}

/** "Hall de entrada", "Corredor · Ala X" or the room name: where we are, in words. */
export function locationText(world: World): string {
  const me = world.me;
  const map = world.map;
  if (!me || !map) return "";
  if (me.room) return roomTitle(world, me.room);
  const tx = Math.floor(me.x / TILE);
  const ty = Math.floor(me.y / TILE);
  const l = map.lobby;
  if (tx >= l.x0 && tx <= l.x1 && ty >= l.y0 && ty <= l.y1) return "Hall de entrada";
  for (const w of map.wings) {
    const c = w.corridor;
    if (tx >= c.x0 && tx <= c.x1 && ty >= c.y0 && ty <= c.y1) return `Corredor · ${wingHeading(world.wings.get(w.index)?.title ?? null)}`;
  }
  return "Corredor principal";
}
