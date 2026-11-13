import { TILE } from "@muchat/space-core";

import type { World } from "./world.ts";

/**
 * Text model of the space for the accessible list and for screen readers:
 * the same information as the map, without depending on seeing it. Read-only
 * in Phase 2; "Ir"/"Bater" arrive with doors (Phase 4).
 */
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
}

export interface ListWing {
  index: number;
  /** null when the viewer cannot see any room of the wing (category name hidden). */
  title: string | null;
  rooms: ListRoom[];
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
  // Live occupancy from the avatars we can see (positions stream in real time;
  // the server's room list only refreshes on structure changes). For rooms we
  // may not view, the server sends no avatars inside, so the count stays null.
  const live = new Map<string, number>();
  const count = (room: string | null) => {
    if (room) live.set(room, (live.get(room) ?? 0) + 1);
  };
  count(world.me?.room ?? null);
  for (const o of world.others.values()) count(o.room);
  const byWing = new Map<number, ListRoom[]>();
  for (const r of map.rooms) {
    const view = world.rooms.get(r.roomId);
    const occupants = view?.occupants ? (live.get(r.roomId) ?? 0) : null;
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
    };
    const list = byWing.get(r.wingIndex) ?? [];
    list.push(item);
    byWing.set(r.wingIndex, list);
  }
  return map.wings
    .filter((w) => byWing.has(w.index))
    .map((w) => ({ index: w.index, title: world.wings.get(w.index)?.title ?? null, rooms: byWing.get(w.index) ?? [] }));
}

/** What the live region says when our room changes. */
export function announceRoomChange(world: World, from: string | null, to: string | null): string {
  if (to) return `Você entrou em ${roomTitle(world, to)}.`;
  if (from) return `Você saiu de ${roomTitle(world, from)}.`;
  return "";
}

/** "Entrada", "Corredor · Ala X" or the room name: where we are, in words. */
export function locationText(world: World): string {
  const me = world.me;
  const map = world.map;
  if (!me || !map) return "";
  if (me.room) return roomTitle(world, me.room);
  const tx = Math.floor(me.x / TILE);
  const ty = Math.floor(me.y / TILE);
  const l = map.lobby;
  if (tx >= l.x0 && tx <= l.x1 && ty >= l.y0 && ty <= l.y1) return "Entrada";
  for (const w of map.wings) {
    const c = w.corridor;
    if (tx >= c.x0 && tx <= c.x1 && ty >= c.y0 && ty <= c.y1) return `Corredor · ${wingHeading(world.wings.get(w.index)?.title ?? null)}`;
  }
  return "Corredor";
}
