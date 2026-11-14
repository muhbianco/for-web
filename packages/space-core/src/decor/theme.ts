import type { MapIndex } from "../map/grid.ts";
import type { CompiledMap, CompiledRoom } from "../map/types.ts";
import { type Catalog, CATALOG } from "./catalog.ts";
import { type PlacementContext, validatePlacement } from "./placement.ts";
import { type DecorInstance, type DecorState, emptyDecor, type InteractionConfig, type Rotation } from "./types.ts";
import { roomZoneKey, wingZoneKey, type ZoneIndex, zonesOf } from "./zones.ts";

/**
 * Default decoration (ADR 0007): what a server looks like before anyone
 * decorates it, and what a new room gets when it appears. Deterministic for
 * a given map, so every member derives the same picture and the server can
 * materialize it into the stored state the first time someone edits.
 *
 * Placement goes through the same validator as the editor: anything that
 * would block a door or a path is simply skipped, so the theme is safe on any
 * room shape (doors differ between street-corner rooms and corridor rooms).
 */

/** Floor of a zone when the state has none. */
export function defaultFloor(map: CompiledMap, zoneKey: string): { item: string; variant: string } {
  if (zoneKey === "hall") return { item: "floor-wood", variant: "mel" };
  if (zoneKey === "spine") return { item: "floor-office", variant: "cinza" };
  if (zoneKey.startsWith("wing:")) return { item: "floor-carpet", variant: ["azul", "cinza", "verde", "roxo"][Number(zoneKey.slice(5)) % 4]! };
  const roomId = zoneKey.startsWith("room:") ? zoneKey.slice(5) : "";
  const room = map.rooms.find((r) => r.roomId === roomId);
  if (!room) return { item: "floor-wood", variant: "claro" };
  const pick = hash(roomId);
  if (room.size === "S") return { item: "floor-wood", variant: ["claro", "escuro"][pick % 2]! };
  if (room.size === "M") return { item: pick % 3 === 0 ? "floor-carpet" : "floor-wood", variant: pick % 3 === 0 ? "cinza" : "mel" };
  return { item: "floor-gamer", variant: ["ciano", "magenta", "verde", "laranja"][pick % 4]! };
}

/** Floor reference as stored: `<item>:<variant>`; variant optional. */
export function floorRef(item: string, variant?: string): string {
  return variant ? `${item}:${variant}` : item;
}

export function parseFloorRef(ref: string): { item: string; variant?: string } {
  const i = ref.indexOf(":");
  return i < 0 ? { item: ref } : { item: ref.slice(0, i), variant: ref.slice(i + 1) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

type Spec = {
  item: string;
  x: number;
  y: number;
  rot?: Rotation;
  variant?: string;
  config?: InteractionConfig;
};

const FABRIC = ["azul", "cinza", "vermelho", "verde", "roxo"] as const;
const NEON = ["ciano", "magenta", "verde", "laranja"] as const;

function hallSpecs(serverName: string): Spec[] {
  return [
    // North wall.
    { item: "window-wide", x: 1, y: -1, variant: "dia" },
    { item: "clock", x: 4, y: -1 },
    { item: "sign", x: 6, y: -1, variant: "neon", config: { title: serverName || "Bem-vindo", text: `Bem-vindo ao espaço${serverName ? ` de ${serverName}` : ""}. Ande até uma sala para entrar na conversa.` } },
    { item: "window-wide", x: 9, y: -1, variant: "dia" },
    // Reception corner and lounge.
    { item: "plant-tall", x: 0, y: 0, variant: "vaso-branco" },
    { item: "counter", x: 1, y: 1, variant: "escuro" },
    { item: "gaming-chair", x: 2, y: 0, rot: 0, variant: "preto-azul" },
    { item: "plant-tall", x: 11, y: 0, variant: "vaso-branco" },
    { item: "floor-lamp", x: 11, y: 2, variant: "dourado" },
    { item: "rug-living", x: 4, y: 3, variant: "azul" },
    { item: "coffee-table", x: 1, y: 6, variant: "escuro" },
    { item: "sofa-3", x: 1, y: 7, rot: 2, variant: "azul" },
    { item: "arcade", x: 6, y: 7, rot: 2, variant: "vermelho" },
    { item: "arcade", x: 7, y: 7, rot: 2, variant: "azul" },
    { item: "speaker", x: 5, y: 7 },
    { item: "vending-machine", x: 11, y: 7, variant: "azul" },
    { item: "trash-can", x: 10, y: 7, variant: "cinza" },
    { item: "rug-doormat", x: 11, y: 4 },
    { item: "ceiling-lamp", x: 5, y: 1, variant: "quente" },
    { item: "ceiling-lamp", x: 8, y: 1, variant: "quente" },
  ];
}

/** Rooms are 7 wide; `h` is the length. Two looks per size, picked by room id. */
function roomSpecs(room: CompiledRoom, pick: number): Spec[] {
  const h = room.interior.y1 - room.interior.y0 + 1;
  const fabric = FABRIC[pick % FABRIC.length]!;
  const neon = NEON[pick % NEON.length]!;
  const bottom = h - 1;
  if (room.size === "S") {
    return pick % 2 === 0
      ? [
          // Duo gamer: two setups facing down, chairs in front, a rug in the middle.
          { item: "poster", x: 0, y: -1, variant: "gamer" },
          { item: "neon-strip", x: 2, y: -1, variant: neon },
          { item: "poster", x: 5, y: -1, variant: "espaço" },
          { item: "desk-pc", x: 0, y: 0, rot: 0, variant: neon },
          { item: "desk-pc", x: 5, y: 0, rot: 0, variant: neon },
          { item: "gaming-chair", x: 0, y: 1, rot: 2, variant: "preto-vermelho" },
          { item: "gaming-chair", x: 6, y: 1, rot: 2, variant: "preto-azul" },
          { item: "rug-round", x: 2, y: 2, variant: fabric },
          { item: "plant-small", x: 6, y: bottom, variant: "vaso-preto" },
          { item: "beanbag", x: 0, y: bottom, variant: fabric },
          { item: "speaker", x: 3, y: bottom },
        ]
      : [
          // Cozy nook: sofa, table, plants, a window.
          { item: "window", x: 1, y: -1, variant: "noite" },
          { item: "painting", x: 3, y: -1, variant: "abstrato" },
          { item: "window", x: 5, y: -1, variant: "noite" },
          { item: "sofa-2", x: 2, y: 0, rot: 0, variant: fabric },
          { item: "plant-tall", x: 0, y: 0, variant: "vaso-terracota" },
          { item: "floor-lamp", x: 6, y: 0, variant: "preto" },
          { item: "coffee-table", x: 2, y: 2, variant: "mel" },
          { item: "rug-round", x: 1, y: 1, variant: fabric },
          { item: "armchair", x: 5, y: 2, rot: 3, variant: fabric },
          { item: "bookshelf", x: 0, y: bottom, variant: "escuro" },
          { item: "console-shelf", x: 4, y: bottom, variant: "preto" },
        ];
  }
  if (room.size === "M") {
    return pick % 2 === 0
      ? [
          // Living room around a TV.
          { item: "painting-wide", x: 1, y: -1, variant: "paisagem" },
          { item: "window-wide", x: 4, y: -1, variant: "cidade" },
          { item: "plant-tall", x: 0, y: 0, variant: "vaso-branco" },
          { item: "sofa-3", x: 2, y: 1, rot: 0, variant: fabric },
          { item: "floor-lamp", x: 6, y: 0, variant: "dourado" },
          { item: "rug-living", x: 1, y: 2, variant: fabric },
          { item: "armchair", x: 0, y: 3, rot: 1, variant: fabric },
          { item: "armchair", x: 6, y: 3, rot: 3, variant: fabric },
          { item: "coffee-table", x: 2, y: 3, variant: "mel" },
          { item: "tv-stand", x: 2, y: 5, rot: 2 },
          { item: "speaker", x: 1, y: 5, variant: "preto" },
          { item: "speaker", x: 4, y: 5, variant: "preto" },
          { item: "plant-small", x: 6, y: bottom, variant: "vaso-terracota" },
          { item: "ceiling-lamp", x: 3, y: 3, variant: "quente" },
        ]
      : [
          // Meeting room.
          { item: "whiteboard", x: 1, y: -1, config: { title: "Pauta", text: "Use este quadro para deixar a pauta ou os combinados da sala." } },
          { item: "clock", x: 4, y: -1 },
          { item: "projector-screen", x: 4, y: -1 },
          { item: "meeting-table", x: 1, y: 2, variant: "escuro" },
          { item: "chair", x: 1, y: 1, rot: 0, variant: "escuro" },
          { item: "chair", x: 3, y: 1, rot: 0, variant: "escuro" },
          { item: "chair", x: 1, y: 4, rot: 2, variant: "escuro" },
          { item: "chair", x: 3, y: 4, rot: 2, variant: "escuro" },
          { item: "chair", x: 5, y: 2, rot: 3, variant: "escuro" },
          { item: "plant-tall", x: 0, y: 0, variant: "vaso-preto" },
          { item: "water-cooler", x: 6, y: 0 },
          { item: "cabinet", x: 6, y: bottom, variant: "escuro" },
          { item: "trash-can", x: 0, y: bottom, variant: "azul" },
          { item: "rug-striped", x: 1, y: 1, variant: "marinho" },
        ];
  }
  // L: a streaming studio up top, a lounge in the middle, arcades at the bottom.
  return [
    { item: "neon-sign", x: 0, y: -1, variant: pick % 2 ? "live" : "gg" },
    { item: "tv-wall", x: 2, y: -1 },
    { item: "neon-strip", x: 4, y: -1, variant: neon },
    { item: "poster", x: 6, y: -1, variant: "banda" },
    { item: "desk-stream", x: 2, y: 0, rot: 0, variant: neon },
    { item: "server-rack", x: 0, y: 0, variant: "azul" },
    { item: "camera-tripod", x: 6, y: 0, rot: 1 },
    { item: "gaming-chair", x: 3, y: 1, rot: 2, variant: "preto-vermelho" },
    { item: "ring-light", x: 1, y: 1 },
    { item: "rug-gamer", x: 2, y: 3, variant: neon },
    { item: "sofa-3", x: 2, y: 5, rot: 0, variant: fabric },
    { item: "led-pillar", x: 0, y: 4, variant: neon },
    { item: "led-pillar", x: 6, y: 4, variant: neon },
    { item: "beanbag", x: 0, y: 7, variant: fabric },
    { item: "beanbag", x: 6, y: 7, variant: fabric },
    { item: "coffee-table", x: 2, y: 7, variant: "escuro" },
    { item: "table-round", x: 4, y: 7, variant: "escuro" },
    { item: "rug-round", x: 2, y: 9, variant: fabric },
    { item: "speaker", x: 0, y: bottom, variant: "preto" },
    { item: "arcade", x: 1, y: bottom, rot: 2, variant: "vermelho" },
    { item: "arcade", x: 2, y: bottom, rot: 2, variant: "azul" },
    { item: "pinball", x: 4, y: bottom - 1, rot: 2, variant: "vermelho" },
    { item: "arcade-double", x: 5, y: bottom, rot: 2, variant: "preto" },
    { item: "vending-machine", x: 0, y: bottom - 2, variant: "vermelho" },
    { item: "spotlight", x: 3, y: 2, variant: neon },
    { item: "spotlight", x: 3, y: 6, variant: neon },
  ];
}

/** Corridors: a runner down the middle, posters on the far wall, plants at the mouth. */
function corridorSpecs(width: number, height: number, north: boolean, pick: number): Spec[] {
  const out: Spec[] = [];
  const mid = Math.floor(width / 2);
  for (let y = north ? 0 : height - 4; north ? y + 3 < height : y >= 0; y += north ? 4 : -4) {
    out.push({ item: "rug-runner", x: mid, y, rot: 0, variant: ["vermelho", "azul", "cinza"][pick % 3]! });
  }
  if (north) {
    out.push({ item: "poster", x: 0, y: -1, variant: ["retro", "mapa", "espaço"][pick % 3]! });
    out.push({ item: "neon-strip", x: 1, y: -1, variant: NEON[pick % 4]! });
  }
  const farY = north ? 0 : height - 1;
  out.push({ item: "plant-small", x: 0, y: farY, variant: "vaso-terracota" });
  out.push({ item: "plant-small", x: width - 1, y: farY, variant: "vaso-terracota" });
  return out;
}

/** Main corridor: plants and lamps along the walls, away from doors (the validator skips those). */
function spineSpecs(width: number, height: number): Spec[] {
  const out: Spec[] = [];
  for (let x = 2; x < width; x += 7) {
    out.push({ item: "plant-small", x, y: 0, variant: "vaso-preto" });
    out.push({ item: "floor-lamp", x: x + 3, y: height - 1, variant: "preto" });
  }
  for (let x = 1; x < width; x += 9) out.push({ item: "ceiling-lamp", x, y: 1, variant: "frio" });
  return out;
}

export interface ThemeOptions {
  serverName?: string;
  catalog?: Catalog;
  /** Only these zone keys get furnished (new rooms); default: every zone. */
  onlyZones?: ReadonlySet<string>;
}

/**
 * Adds the theme's items to `state` for the zones not yet furnished. Returns
 * the new state (same `rev`), with `furnished` updated. Items are validated
 * one by one against everything already placed; invalid ones are skipped.
 */
export function furnish(ix: MapIndex, state: DecorState, opts: ThemeOptions = {}): DecorState {
  const map = ix.map;
  const zones = zonesOf(map);
  const catalog = opts.catalog ?? CATALOG;
  const furnished = new Set(state.furnished);
  const items = [...state.items];
  let next: DecorState = { ...state, items, furnished: [...furnished] };
  const ctx = (): PlacementContext => ({ ix, zones, catalog, state: next });

  const place = (zoneKey: string, specs: Spec[]) => {
    const zone = zones.byKey.get(zoneKey);
    if (!zone) return;
    specs.forEach((s, n) => {
      const inst: DecorInstance = {
        id: `t-${hash(zoneKey).toString(36)}-${n}`,
        item: s.item,
        zone: zoneKey,
        x: s.x,
        y: s.y,
        rot: s.rot ?? 0,
        ...(s.variant ? { variant: s.variant } : {}),
        ...(s.config ? { config: s.config } : {}),
      };
      if (validatePlacement(ctx(), inst) === null) {
        items.push(inst);
        next = { ...next, items: [...items] };
      }
    });
    furnished.add(zoneKey);
    next = { ...next, furnished: [...furnished] };
  };

  const wants = (key: string) => !furnished.has(key) && (!opts.onlyZones || opts.onlyZones.has(key));
  if (wants("hall")) place("hall", hallSpecs(opts.serverName ?? ""));
  if (wants("spine")) place("spine", spineSpecs(map.spine.x1 - map.spine.x0 + 1, map.spine.y1 - map.spine.y0 + 1));
  for (const w of map.wings) {
    const key = wingZoneKey(w.index);
    if (!wants(key)) continue;
    place(key, corridorSpecs(w.corridor.x1 - w.corridor.x0 + 1, w.corridor.y1 - w.corridor.y0 + 1, w.north, hash(key)));
  }
  for (const r of map.rooms) {
    const key = roomZoneKey(r.roomId);
    if (!wants(key)) continue;
    place(key, roomSpecs(r, hash(r.roomId)));
  }
  return next;
}

/** Fresh default state for a map (rev 0: nothing stored yet). */
export function defaultDecor(ix: MapIndex, opts: ThemeOptions = {}): DecorState {
  return furnish(ix, emptyDecor(), opts);
}

export type { ZoneIndex };
