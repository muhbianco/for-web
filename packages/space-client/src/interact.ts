import { CATALOG, type DecorInstance, type DecorItem, type InteractionKind, instanceRect, itemOf, TILE } from "@muchat/space-core";
import { TRAIN_REACH_TILES } from "@muchat/space-core/game/ot";

import type { World } from "./world.ts";

/**
 * Interactive objects (ADR 0007): standing next to one shows a prompt; E (or
 * a click on it) runs its behaviour. The client only finds the object and
 * names the action; what happens next is the app's (dialogs) or the server's
 * (teleport).
 */
export interface Prompt {
  inst: DecorInstance;
  item: DecorItem;
  /** World px of the hint: centred above the object. */
  x: number;
  y: number;
  label: string;
}

export const VERBS: Record<InteractionKind, string> = {
  link: "Abrir link",
  note: "Ler",
  picture: "Ver",
  frame: "Abrir",
  teleport: "Entrar",
  tv: "Abrir Smart TV",
  train: "Treinar",
  npc: "Falar",
};

/** The other dummy for training at both at once (24/11/2026). */
export interface DummyPartner {
  instance: string;
  title: string;
  dummy: "vocacao" | "habilidade";
}

/**
 * The dummy of the other kind to train at together with `instId`: in the same zone, within
 * TRAIN_REACH_TILES of us (the server's check), the nearest one. Null when there is none.
 */
export function dummyPartner(world: World, instId: string): DummyPartner | null {
  const { me, decor, zones } = world;
  if (!me || !decor || !zones) return null;
  const inst = decor.items.find((i) => i.id === instId);
  const item = inst ? itemOf(CATALOG, inst.item) : undefined;
  const zone = inst ? zones.byKey.get(inst.zone) : undefined;
  if (!inst || !item || !zone || item.interaction !== "train") return null;
  const kind = item.dummy ?? "vocacao";
  const tx = Math.floor(me.x / TILE);
  const ty = Math.floor(me.y / TILE);
  if (tx < zone.rect.x0 || tx > zone.rect.x1 || ty < zone.rect.y0 || ty > zone.rect.y1) return null;
  let best: DummyPartner | null = null;
  let bestDist = Infinity;
  for (const o of decor.items) {
    if (o.id === inst.id || o.zone !== inst.zone) continue;
    const oi = itemOf(CATALOG, o.item);
    if (oi?.interaction !== "train" || (oi.dummy ?? "vocacao") === kind) continue;
    const r = instanceRect(zone, oi, o);
    const dist = Math.max(r.x0 - tx, 0, tx - r.x1, r.y0 - ty, ty - r.y1);
    if (dist > TRAIN_REACH_TILES || dist >= bestDist) continue;
    bestDist = dist;
    best = { instance: o.id, title: o.config?.title?.trim() || oi.name, dummy: oi.dummy ?? "vocacao" };
  }
  return best;
}

/** The closest interactive instance within one tile of us, if any. */
export function nearestInteractive(world: World): Prompt | null {
  const { me, decor, zones } = world;
  if (!me || !decor || !zones) return null;
  const tx = Math.floor(me.x / TILE);
  const ty = Math.floor(me.y / TILE);
  let best: Prompt | null = null;
  let bestDist = Infinity;
  for (const inst of decor.items) {
    const item = itemOf(CATALOG, inst.item);
    if (!item?.interaction) continue;
    const zone = zones.byKey.get(inst.zone);
    if (!zone) continue;
    // A TV only works inside a room (ADR 0008); one elsewhere is decoration.
    if (item.smartTv && zone.kind !== "room") continue;
    const r = instanceRect(zone, item, inst);
    const dx = Math.max(r.x0 - tx, 0, tx - r.x1);
    const dy = Math.max(r.y0 - ty, 0, ty - r.y1);
    if (Math.max(dx, dy) > 1) continue;
    const cx = ((r.x0 + r.x1 + 1) / 2) * TILE;
    const cy = ((r.y0 + r.y1 + 1) / 2) * TILE;
    const dist = Math.hypot(cx - me.x, cy - me.y);
    if (dist >= bestDist) continue;
    bestDist = dist;
    const label = inst.config?.title?.trim() || `${VERBS[item.interaction]} · ${item.name}`;
    best = { inst, item, x: cx, y: r.y0 * TILE - (item.layer === "furniture" ? TILE / 2 : 0), label };
  }
  return best;
}
