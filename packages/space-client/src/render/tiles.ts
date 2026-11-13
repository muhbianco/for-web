import { type MapIndex, Tile, TILE, tileAt } from "@muchat/space-core";

/** Tiles per chunk side; a chunk is one 1024×1024 canvas texture. */
export const CHUNK = 32;

const WING_HUES = [208, 152, 32, 280, 350, 190, 96, 250, 12, 320];

const C = {
  wall: "#2c2f3e",
  wallTop: "#474c63",
  wallShade: "#1d1f2a",
  lobby: "#e7d9bf",
  lobbyAlt: "#ddcdb0",
  corridor: "#c9ced8",
  corridorAlt: "#bfc5d1",
};

function roomFloor(wingIndex: number, alt: boolean): string {
  const hue = WING_HUES[wingIndex % WING_HUES.length]!;
  return `hsl(${hue} 38% ${alt ? 80 : 84}%)`;
}

/** Paints the static floor/wall layer of one chunk. Doors are drawn on their own layer. */
export function drawChunk(ix: MapIndex, cx: number, cy: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CHUNK * TILE;
  canvas.height = CHUNK * TILE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const { map } = ix;
  const lobby = map.lobby;
  for (let ly = 0; ly < CHUNK; ly++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const tx = cx * CHUNK + lx;
      const ty = cy * CHUNK + ly;
      const kind = tileAt(map, tx, ty);
      const px = lx * TILE;
      const py = ly * TILE;
      const alt = (tx + ty) % 2 === 0;
      if (kind === Tile.Wall) {
        ctx.fillStyle = C.wall;
        ctx.fillRect(px, py, TILE, TILE);
        // Top light edge when there is floor below (a wall face seen from above).
        if (tileAt(map, tx, ty + 1) !== Tile.Wall && tileAt(map, tx, ty + 1) !== Tile.Void) {
          ctx.fillStyle = C.wallShade;
          ctx.fillRect(px, py + TILE - 6, TILE, 6);
        }
        ctx.fillStyle = C.wallTop;
        ctx.fillRect(px, py, TILE, 3);
        continue;
      }
      if (kind !== Tile.Floor && kind !== Tile.Door) continue; // Void stays transparent
      const inLobby = tx >= lobby.x0 && tx <= lobby.x1 && ty >= lobby.y0 && ty <= lobby.y1;
      const local = (ty - map.originTy) * map.width + (tx - map.originTx);
      const roomIdx = ix.interiorOf[local] ?? 0;
      const room = roomIdx > 0 ? map.rooms[roomIdx - 1] : undefined;
      ctx.fillStyle = room ? roomFloor(room.wingIndex, alt) : inLobby ? (alt ? C.lobbyAlt : C.lobby) : alt ? C.corridorAlt : C.corridor;
      ctx.fillRect(px, py, TILE, TILE);
      // Subtle plank/tile seams.
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(px, py + TILE - 1, TILE, 1);
      ctx.fillRect(px + TILE - 1, py, 1, TILE);
    }
  }
  return canvas;
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
