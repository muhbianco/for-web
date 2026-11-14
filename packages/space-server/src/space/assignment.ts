import {
  type LayoutInput,
  MAX_SLOTS_PER_WING,
  MAX_WINGS,
  type RoomSize,
  roomSizeFor,
  SIZE_RANK,
} from "@muchat/space-core";

import type { StoatServer, StoatTextChannel } from "../stoat/types.ts";

/**
 * Persistent room placement of one Stoat server (ADR 0005). Append-only:
 * a wing keeps its index forever; a room keeps its slot until the channel is
 * deleted or loses voice, and then the slot becomes free but keeps its size,
 * so the rooms after it never move. A new room reuses the first free slot
 * that fits and takes the slot's size; otherwise it is appended.
 */
export interface SlotState {
  /** null = free slot (archived room). */
  roomId: string | null;
  size: RoomSize;
}

export interface WingState {
  index: number;
  /** null = channels without a category ("Ala geral"). */
  categoryId: string | null;
  title: string;
  slots: SlotState[];
}

export interface Assignment {
  serverId: string;
  rev: number;
  wings: WingState[];
}

export const GENERAL_WING_TITLE = "Geral";

/** Template 1 stored free slots as `null`; they had the largest footprint. */
const LEGACY_FREE_SIZE: RoomSize = "L";

/** Stored wings as read from the database, including legacy `null` slots. */
export type StoredWing = Omit<WingState, "slots"> & { slots: Array<SlotState | null | undefined> };

export function normalizeWings(wings: StoredWing[]): WingState[] {
  return wings.map((w) => ({
    index: w.index,
    categoryId: w.categoryId,
    title: w.title,
    slots: w.slots.map((s) => (s ? { roomId: s.roomId ?? null, size: s.size } : { roomId: null, size: LEGACY_FREE_SIZE })),
  }));
}

export interface ReconcileResult {
  assignment: Assignment;
  changed: boolean;
  /** Voice channels that did not fit (wing or slot limits). */
  overflow: string[];
}

/** Voice channels of the server, in Stoat's display order (categories, then the rest). */
function orderedVoiceChannels(server: StoatServer, channels: Map<string, StoatTextChannel>) {
  const live = new Set(server.channels);
  const isVoice = (id: string) => {
    const c = channels.get(id);
    return Boolean(c && live.has(id) && c.server === server._id && c.voice != null);
  };
  const out: Array<{ channel: StoatTextChannel; categoryId: string | null; categoryTitle: string }> = [];
  const seen = new Set<string>();
  // Uncategorised first, as Stoat shows them above the categories.
  const categorised = new Set((server.categories ?? []).flatMap((c) => c.channels));
  for (const id of server.channels) {
    if (!categorised.has(id) && isVoice(id) && !seen.has(id)) {
      seen.add(id);
      out.push({ channel: channels.get(id)!, categoryId: null, categoryTitle: GENERAL_WING_TITLE });
    }
  }
  for (const cat of server.categories ?? []) {
    for (const id of cat.channels) {
      // Stoat leaves deleted ids in categories: isVoice filters them out.
      if (isVoice(id) && !seen.has(id)) {
        seen.add(id);
        out.push({ channel: channels.get(id)!, categoryId: cat.id, categoryTitle: cat.title });
      }
    }
  }
  return out;
}

export function reconcile(
  prev: Assignment | null,
  server: StoatServer,
  channels: Map<string, StoatTextChannel>,
): ReconcileResult {
  const before = JSON.stringify(prev?.wings ?? []);
  const wings: WingState[] = normalizeWings(structuredClone(prev?.wings ?? []));
  const voice = orderedVoiceChannels(server, channels);
  const wanted = new Map(voice.map((v) => [v.channel._id, v]));
  const overflow: string[] = [];

  // 1. Free the slots of rooms whose channel is gone or no longer has voice.
  const placed = new Set<string>();
  for (const w of wings) {
    w.slots = w.slots.map((s) => {
      if (s.roomId === null) return s;
      if (!wanted.has(s.roomId) || placed.has(s.roomId)) return { roomId: null, size: s.size };
      placed.add(s.roomId);
      return s;
    });
  }

  // 2. Wing titles follow category renames (no geometry change).
  const titles = new Map((server.categories ?? []).map((c) => [c.id, c.title]));
  for (const w of wings) {
    if (w.categoryId === null) w.title = GENERAL_WING_TITLE;
    else if (titles.has(w.categoryId)) w.title = titles.get(w.categoryId)!;
  }

  // 3. New rooms go to the wing of their category: the first free slot that
  //    fits (taking its size), or the end.
  for (const v of voice) {
    if (placed.has(v.channel._id)) continue;
    let wing = wings.find((w) => w.categoryId === v.categoryId);
    if (!wing) {
      if (wings.length >= MAX_WINGS) {
        overflow.push(v.channel._id);
        continue;
      }
      wing = { index: wings.length, categoryId: v.categoryId, title: v.categoryTitle, slots: [] };
      wings.push(wing);
    }
    const size = roomSizeFor(v.channel.voice?.max_users ?? null);
    const fit = wing.slots.findIndex((s) => s.roomId === null && SIZE_RANK[s.size] >= SIZE_RANK[size]);
    if (fit >= 0) wing.slots[fit] = { roomId: v.channel._id, size: wing.slots[fit]!.size };
    else if (wing.slots.length < MAX_SLOTS_PER_WING) wing.slots.push({ roomId: v.channel._id, size });
    else {
      overflow.push(v.channel._id);
      continue;
    }
    placed.add(v.channel._id);
  }

  const changed = JSON.stringify(wings) !== before;
  const rev = (prev?.rev ?? 0) + (changed || !prev ? 1 : 0);
  return { assignment: { serverId: server._id, rev, wings }, changed: changed || !prev, overflow };
}

/** Layout input with current channel names as labels. */
export function toLayoutInput(a: Assignment, channels: Map<string, StoatTextChannel>): LayoutInput {
  return {
    templateVersion: 2,
    wings: a.wings.map((w) => ({
      index: w.index,
      title: w.title,
      slots: w.slots.map((s) => ({
        roomId: s.roomId,
        size: s.size,
        label: s.roomId ? (channels.get(s.roomId)?.name ?? "Sala") : "",
      })),
    })),
  };
}
