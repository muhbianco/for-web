import { Tile } from "../map/constants.ts";
import { cellIndex, type MapIndex, tileAt } from "../map/grid.ts";
import type { CompiledMap, TilePos, TileRect } from "../map/types.ts";
import { type Catalog, itemOf } from "./catalog.ts";
import type { DecorInstance, DecorItem, DecorSettings, DecorState, InteractionConfig, Rotation } from "./types.ts";
import { type Zone, type ZoneIndex } from "./zones.ts";

/** Bounded document: one server's decoration never grows past this. */
export const MAX_ITEMS = 1500;
export const MAX_URL = 2048;
export const MAX_TEXT = 500;
export const MAX_TITLE = 60;
export const ID_PATTERN = /^[A-Za-z0-9_-]{4,40}$/;

export type PlacementError =
  | "unknown_item"
  | "not_placeable"
  | "unknown_zone"
  | "bad_rotation"
  | "bad_id"
  | "out_of_zone"
  | "not_floor"
  | "not_wall"
  | "overlap"
  | "blocks_door"
  | "blocks_path"
  | "too_many"
  | "bad_config";

/** Footprint (tiles) of an item at a rotation: odd quarter turns transpose it. */
export function footprint(item: DecorItem, rot: Rotation): { w: number; h: number } {
  if (item.rotations === 1 || rot % 2 === 0) return { w: item.w, h: item.h };
  return { w: item.h, h: item.w };
}

/** Absolute tile rectangle covered by an instance. */
export function instanceRect(zone: Zone, item: DecorItem, inst: Pick<DecorInstance, "x" | "y" | "rot">): TileRect {
  const { w, h } = footprint(item, inst.rot);
  const x0 = zone.rect.x0 + inst.x;
  const y0 = zone.rect.y0 + inst.y;
  return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
}

const intersects = (a: TileRect, b: TileRect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const inRect = (p: TilePos, r: TileRect) => p.tx >= r.x0 && p.tx <= r.x1 && p.ty >= r.y0 && p.ty <= r.y1;

export interface PlacementContext {
  ix: MapIndex;
  zones: ZoneIndex;
  catalog: Catalog;
  state: DecorState;
}

/** Validates the interaction configuration an instance may carry. */
export function validateConfig(item: DecorItem, config: InteractionConfig | undefined, zones: ZoneIndex): boolean {
  if (config === undefined) return true;
  if (typeof config !== "object" || config === null) return false;
  const keys = Object.keys(config);
  if (keys.some((k) => !["title", "url", "text", "target"].includes(k))) return false;
  if (config.title !== undefined && (typeof config.title !== "string" || config.title.length > MAX_TITLE)) return false;
  if (config.url !== undefined) {
    if (typeof config.url !== "string" || config.url.length > MAX_URL) return false;
    let u: URL;
    try {
      u = new URL(config.url);
    } catch {
      return false;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  }
  if (config.text !== undefined && (typeof config.text !== "string" || config.text.length > MAX_TEXT)) return false;
  if (config.target !== undefined && (typeof config.target !== "string" || !zones.byKey.has(config.target))) return false;
  // Only interactive items carry a configuration, and only fields of their kind.
  if (!item.interaction && keys.length > 0) return false;
  switch (item.interaction) {
    case "link":
    case "picture":
    case "frame":
      return config.text === undefined && config.target === undefined;
    case "note":
      return config.url === undefined && config.target === undefined;
    case "teleport":
      return config.url === undefined && config.text === undefined;
    default:
      return true;
  }
}

/**
 * Whether `inst` may stand where it says, given everything else in `state`.
 * `ignoreId` excludes the instance being moved from the overlap check. Shared
 * by the editor (ghost preview) and the server (authority), so the preview
 * never shows green for what the server will refuse.
 */
export function validatePlacement(
  ctx: PlacementContext,
  inst: DecorInstance,
  ignoreId?: string,
  opts: { geometryOnly?: boolean } = {},
): PlacementError | null {
  const item = itemOf(ctx.catalog, inst.item);
  if (!item) return "unknown_item";
  if (item.layer === "floor") return "not_placeable";
  const zone = ctx.zones.byKey.get(inst.zone);
  if (!zone) return "unknown_zone";
  if (!Number.isInteger(inst.rot) || inst.rot < 0 || inst.rot > 3) return "bad_rotation";
  if (item.rotations === 1 && inst.rot !== 0) return "bad_rotation";
  if (item.rotations === 2 && inst.rot > 1) return "bad_rotation";
  if (!ID_PATTERN.test(inst.id)) return "bad_id";
  if (!Number.isInteger(inst.x) || !Number.isInteger(inst.y)) return "out_of_zone";
  if (inst.variant !== undefined && !(item.variants ?? []).includes(inst.variant)) return "bad_config";
  if (!validateConfig(item, inst.config, ctx.zones)) return "bad_config";
  const live = ctx.state.items.filter((i) => i.id !== ignoreId);
  if (ignoreId === undefined && live.length >= MAX_ITEMS) return "too_many";
  if (live.some((i) => i.id === inst.id)) return "bad_id";

  const map = ctx.ix.map;
  const rect = instanceRect(zone, item, inst);
  if (item.layer === "wall") {
    // Hangs on the wall right above the zone: one row, inside the zone's columns.
    if (inst.y !== -1 || rect.y1 !== rect.y0) return "not_wall";
    if (rect.x0 < zone.rect.x0 || rect.x1 > zone.rect.x1) return "out_of_zone";
    for (let tx = rect.x0; tx <= rect.x1; tx++) if (tileAt(map, tx, rect.y0) !== Tile.Wall) return "not_wall";
  } else {
    if (rect.x0 < zone.rect.x0 || rect.y0 < zone.rect.y0 || rect.x1 > zone.rect.x1 || rect.y1 > zone.rect.y1) return "out_of_zone";
    for (let ty = rect.y0; ty <= rect.y1; ty++) {
      for (let tx = rect.x0; tx <= rect.x1; tx++) if (tileAt(map, tx, ty) !== Tile.Floor) return "not_floor";
    }
  }

  // Same layer never overlaps; a rug under a sofa is fine.
  for (const other of live) {
    const oItem = itemOf(ctx.catalog, other.item);
    const oZone = ctx.zones.byKey.get(other.zone);
    if (!oItem || !oZone || oItem.layer !== item.layer) continue;
    if (intersects(rect, instanceRect(oZone, oItem, other))) return "overlap";
  }

  if (item.solid) {
    // Doorways and spawn points stay free, and every door stays reachable.
    for (const r of map.rooms) {
      if (inRect(r.inside, rect) || inRect(r.outside, rect)) return "blocks_door";
    }
    for (const s of map.spawns) if (inRect(s, rect)) return "blocks_door";
    if (!opts.geometryOnly) {
      const solid = solidMask(ctx.ix.map, ctx.zones, ctx.catalog, [...live, inst]);
      if (!allReachable(ctx.ix.map, solid)) return "blocks_path";
    }
  }
  return null;
}

/**
 * Drops the instances that no longer fit the map (a template change moved a
 * wall, a zone disappeared) and, if the remaining solid ones still cut a path,
 * the solid ones from the end until every door is reachable again. The common
 * case (the map only grew) keeps everything.
 */
export function pruneDecor(ctx: Omit<PlacementContext, "state">, state: DecorState): { state: DecorState; dropped: DecorInstance[] } {
  const dropped: DecorInstance[] = [];
  let kept: DecorInstance[] = [];
  for (const inst of state.items) {
    const err = validatePlacement({ ...ctx, state: { ...state, items: kept } }, inst, undefined, { geometryOnly: true });
    if (err === null) kept.push(inst);
    else dropped.push(inst);
  }
  while (kept.length && !allReachable(ctx.ix.map, solidMask(ctx.ix.map, ctx.zones, ctx.catalog, kept))) {
    const i = kept.map((k, idx) => (itemOf(ctx.catalog, k.item)?.solid ? idx : -1)).filter((idx) => idx >= 0).pop();
    if (i === undefined) break;
    dropped.push(kept[i]!);
    kept = kept.filter((_, idx) => idx !== i);
  }
  const floors: Record<string, string> = {};
  for (const [zone, floor] of Object.entries(state.floors)) if (ctx.zones.byKey.has(zone)) floors[zone] = floor;
  return { state: { ...state, items: kept, floors }, dropped };
}

/** 1 for every tile under a solid instance (same grid as the map). */
export function solidMask(map: CompiledMap, zones: ZoneIndex, catalog: Catalog, items: readonly DecorInstance[]): Uint8Array {
  const mask = new Uint8Array(map.width * map.height);
  for (const inst of items) {
    const item = itemOf(catalog, inst.item);
    const zone = zones.byKey.get(inst.zone);
    if (!item || !zone || !item.solid) continue;
    const r = instanceRect(zone, item, inst);
    for (let ty = r.y0; ty <= r.y1; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) {
        const i = cellIndex(map, tx, ty);
        if (i >= 0) mask[i] = 1;
      }
    }
  }
  return mask;
}

/**
 * Flood fill from the first spawn over Floor and Door tiles not under solid
 * decoration: every spawn and every room's door, inside and outside tile must
 * be reachable. Doors count as open here (locks are a per-person matter).
 */
export function allReachable(map: CompiledMap, solid: Uint8Array): boolean {
  const start = map.spawns[0];
  if (!start) return true;
  const seen = new Uint8Array(map.width * map.height);
  const queue: number[] = [];
  const startIdx = cellIndex(map, start.tx, start.ty);
  if (startIdx < 0) return false;
  seen[startIdx] = 1;
  queue.push(startIdx);
  const passable = (i: number) => {
    const k = map.tiles[i];
    return (k === Tile.Floor || k === Tile.Door) && solid[i] !== 1;
  };
  if (!passable(startIdx)) return false;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const x = cur % map.width;
    const y = Math.floor(cur / map.width);
    const nbrs = [
      x > 0 ? cur - 1 : -1,
      x < map.width - 1 ? cur + 1 : -1,
      y > 0 ? cur - map.width : -1,
      y < map.height - 1 ? cur + map.width : -1,
    ];
    for (const n of nbrs) {
      if (n < 0 || seen[n] === 1 || !passable(n)) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  const ok = (p: TilePos) => {
    const i = cellIndex(map, p.tx, p.ty);
    return i >= 0 && seen[i] === 1;
  };
  for (const s of map.spawns) if (!ok(s)) return false;
  for (const r of map.rooms) if (!ok(r.door) || !ok(r.inside) || !ok(r.outside)) return false;
  return true;
}

/** The floor item of a zone: explicit, else the theme's default (caller passes it). */
export function floorOf(state: DecorState, zoneKey: string, fallback: string): string {
  return state.floors[zoneKey] ?? fallback;
}

export function validateSettings(s: unknown): s is DecorSettings {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  if (!["admins", "roles", "everyone"].includes(String(o.editors))) return false;
  if (!Array.isArray(o.roles) || o.roles.length > 50) return false;
  return o.roles.every((r) => typeof r === "string" && r.length > 0 && r.length <= 64);
}

/**
 * Applies an op to a state, returning the new state (the old one is not
 * mutated). The caller validated the op; this only mirrors it, so client and
 * server end with the same items in the same order.
 */
export function applyDecorOp(
  state: DecorState,
  op:
    | { kind: "place"; item: DecorInstance }
    | { kind: "update"; item: DecorInstance }
    | { kind: "remove"; id: string }
    | { kind: "floor"; zone: string; floor: string | null }
    | { kind: "settings"; settings: DecorSettings },
  rev: number,
): DecorState {
  switch (op.kind) {
    case "place":
      return { ...state, rev, items: [...state.items, op.item] };
    case "update":
      return { ...state, rev, items: state.items.map((i) => (i.id === op.item.id ? op.item : i)) };
    case "remove":
      return { ...state, rev, items: state.items.filter((i) => i.id !== op.id) };
    case "floor": {
      const floors = { ...state.floors };
      if (op.floor === null) delete floors[op.zone];
      else floors[op.zone] = op.floor;
      return { ...state, rev, floors };
    }
    case "settings":
      return { ...state, rev, settings: { editors: op.settings.editors, roles: [...op.settings.roles] } };
  }
}
