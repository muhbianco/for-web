import { type MapIndex, Tile, TILE, tileAt } from "@muchat/space-core";

import { drawFloor } from "./floors.ts";
import { ART_PX, SCALE } from "./pixel.ts";

/** Tiles per chunk side; a chunk is one 1024×1024 canvas texture. */
export const CHUNK = 32;

/** Floor material of a tile: the zone's floor (explicit or the theme's default). */
export type FloorLookup = (tx: number, ty: number) => { item: string; variant: string | undefined } | null;

const WALL = {
  face: "#3a3d4f",
  top: "#575b74",
  edge: "#6f7392",
  shadow: "#262838",
  base: "#2a2c3a",
};

/**
 * Paints the static floor/wall layer of one chunk. Doors are drawn on their
 * own layer; the floor shows through the doorway. Floors are the pixel-art
 * materials of floors.ts, picked per zone by `floors`.
 */
export function drawChunk(ix: MapIndex, cx: number, cy: number, floors: FloorLookup): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CHUNK * TILE;
  canvas.height = CHUNK * TILE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.scale(SCALE, SCALE); // art pixels: 16 per tile
  const { map } = ix;
  for (let ly = 0; ly < CHUNK; ly++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const tx = cx * CHUNK + lx;
      const ty = cy * CHUNK + ly;
      const kind = tileAt(map, tx, ty);
      const px = lx * ART_PX;
      const py = ly * ART_PX;
      if (kind === Tile.Wall) {
        drawWall(ctx, ix, tx, ty, px, py);
        continue;
      }
      if (kind !== Tile.Floor && kind !== Tile.Door) continue; // Void stays transparent
      const floor = floors(tx, ty) ?? (kind === Tile.Door ? neighbourFloor(ix, floors, tx, ty) : null) ?? { item: "floor-office", variant: "cinza" };
      drawFloor(ctx, floor.item, floor.variant, px, py, tx, ty);
      // A soft shadow under the wall above: depth without a second layer.
      if (tileAt(map, tx, ty - 1) === Tile.Wall) {
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(px, py, ART_PX, 2);
      }
    }
  }
  return canvas;
}

/** A door tile belongs to no zone: take the floor of the walkable tile next to it. */
function neighbourFloor(ix: MapIndex, floors: FloorLookup, tx: number, ty: number) {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
    if (tileAt(ix.map, tx + dx, ty + dy) === Tile.Floor) {
      const f = floors(tx + dx, ty + dy);
      if (f) return f;
    }
  }
  return null;
}

/**
 * Walls as seen from above and slightly in front: a lit top band, a face, a
 * darker base where a wall meets the floor below it. Exterior sides (next to
 * the void) get a darker edge so the building has a silhouette.
 */
function drawWall(ctx: CanvasRenderingContext2D, ix: MapIndex, tx: number, ty: number, px: number, py: number) {
  const { map } = ix;
  const below = tileAt(map, tx, ty + 1);
  const above = tileAt(map, tx, ty - 1);
  const faceDown = below === Tile.Floor || below === Tile.Door;
  ctx.fillStyle = WALL.face;
  ctx.fillRect(px, py, ART_PX, ART_PX);
  if (faceDown) {
    // A wall with floor in front shows its face: top band + face + baseboard.
    ctx.fillStyle = WALL.top;
    ctx.fillRect(px, py, ART_PX, 5);
    ctx.fillStyle = WALL.edge;
    ctx.fillRect(px, py, ART_PX, 1);
    ctx.fillStyle = WALL.face;
    ctx.fillRect(px, py + 5, ART_PX, 9);
    ctx.fillStyle = WALL.shadow;
    ctx.fillRect(px, py + 14, ART_PX, 2);
    // Faint panel seams.
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(px + 7, py + 6, 1, 7);
  } else {
    // Top of a wall seen from above (between two rooms, or the far edge).
    ctx.fillStyle = WALL.top;
    ctx.fillRect(px, py, ART_PX, ART_PX);
    ctx.fillStyle = WALL.edge;
    ctx.fillRect(px, py, ART_PX, 1);
    if (above === Tile.Void) {
      ctx.fillStyle = WALL.base;
      ctx.fillRect(px, py, ART_PX, 2);
    }
  }
  const left = tileAt(map, tx - 1, ty);
  const right = tileAt(map, tx + 1, ty);
  ctx.fillStyle = WALL.base;
  if (left === Tile.Void) ctx.fillRect(px, py, 2, ART_PX);
  if (right === Tile.Void) ctx.fillRect(px + ART_PX - 2, py, 2, ART_PX);
  if (below === Tile.Void) ctx.fillRect(px, py + ART_PX - 2, ART_PX, 2);
}

/** Chunk coordinates covering a world-pixel rectangle. */
export function chunksIn(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const size = CHUNK * TILE;
  const out: Array<[number, number]> = [];
  for (let cy = Math.floor(y0 / size); cy <= Math.floor(y1 / size); cy++) {
    for (let cx = Math.floor(x0 / size); cx <= Math.floor(x1 / size); cx++) out.push([cx, cy]);
  }
  return out;
}
