import { alpha, ART_PX, FABRIC, NEON, pick, shade, WOOD } from "./pixel.ts";

/**
 * Floor materials, one 16×16 art tile each (drawn at 2× by the chunk painter).
 * Patterns use the tile coordinates so seams line up across tiles. Colours
 * come from the item's variant; unknown variants fall back to the first.
 */

interface FloorArt {
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, variant: string | undefined): void;
}

const hash2 = (tx: number, ty: number) => {
  let h = (tx * 374761393 + ty * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function fill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

const CERAMIC: Record<string, string> = { branco: "#e9e6e0", bege: "#dccbb0", xadrez: "#e9e6e0" };
const OFFICE: Record<string, string> = { cinza: "#aeb3bd", grafite: "#6f7480" };
const CONCRETE: Record<string, string> = { cinza: "#9c9c9c", escuro: "#6e6e72" };

export const FLOORS: Record<string, FloorArt> = {
  "floor-wood": {
    draw(ctx, x, y, tx, ty, v) {
      const c = pick(WOOD, v);
      fill(ctx, x, y, ART_PX, ART_PX, c);
      // Four planks per tile, seams staggered every other row of planks.
      for (let p = 0; p < 4; p++) {
        const py = y + p * 4;
        const tone = hash2(tx, ty * 4 + p);
        fill(ctx, x, py, ART_PX, 4, shade(c, (tone - 0.5) * 0.12));
        fill(ctx, x, py + 3, ART_PX, 1, shade(c, -0.22));
        const seam = ((tx + p + ty) % 2) * 8 + Math.floor(tone * 3);
        fill(ctx, x + seam, py, 1, 3, shade(c, -0.3));
        if (tone > 0.7) fill(ctx, x + ((seam + 5) % 16), py + 1, 2, 1, shade(c, -0.12));
      }
    },
  },
  "floor-ceramic": {
    draw(ctx, x, y, tx, ty, v) {
      const base = pick(CERAMIC, v);
      const checker = v === "xadrez" && (tx + ty) % 2 === 1;
      const c = checker ? "#4a4a55" : base;
      fill(ctx, x, y, ART_PX, ART_PX, shade(c, -0.25)); // grout
      fill(ctx, x + 1, y + 1, 6, 6, c);
      fill(ctx, x + 9, y + 1, 6, 6, c);
      fill(ctx, x + 1, y + 9, 6, 6, c);
      fill(ctx, x + 9, y + 9, 6, 6, c);
      fill(ctx, x + 1, y + 1, 6, 1, shade(c, 0.12));
      fill(ctx, x + 9, y + 9, 6, 1, shade(c, 0.12));
    },
  },
  "floor-carpet": {
    draw(ctx, x, y, tx, ty, v) {
      const c = shade(pick(FABRIC, v), -0.2);
      fill(ctx, x, y, ART_PX, ART_PX, c);
      for (let i = 0; i < 10; i++) {
        const r = hash2(tx * 16 + i, ty * 7 + i);
        const px = Math.floor(hash2(tx + i, ty) * 16);
        const py = Math.floor(hash2(tx, ty + i * 3) * 16);
        fill(ctx, x + px, y + py, 1, 1, shade(c, r > 0.5 ? 0.1 : -0.12));
      }
    },
  },
  "floor-office": {
    draw(ctx, x, y, tx, ty, v) {
      const c = pick(OFFICE, v);
      const tone = hash2(tx, ty);
      fill(ctx, x, y, ART_PX, ART_PX, shade(c, (tone - 0.5) * 0.06));
      fill(ctx, x, y + 15, ART_PX, 1, shade(c, -0.15));
      fill(ctx, x + 15, y, 1, ART_PX, shade(c, -0.15));
      fill(ctx, x, y, ART_PX, 1, shade(c, 0.08));
      fill(ctx, x, y, 1, ART_PX, shade(c, 0.08));
    },
  },
  "floor-gamer": {
    draw(ctx, x, y, tx, ty, v) {
      const n = pick(NEON, v);
      fill(ctx, x, y, ART_PX, ART_PX, "#23242e");
      fill(ctx, x + 1, y + 1, 14, 14, "#2b2c38");
      fill(ctx, x + 1, y + 1, 14, 1, "#353645");
      // Neon seams every tile, brighter at the crossings.
      fill(ctx, x, y + 15, ART_PX, 1, alpha(n, 0.55));
      fill(ctx, x + 15, y, 1, ART_PX, alpha(n, 0.55));
      fill(ctx, x + 15, y + 15, 1, 1, n);
      if ((tx * 3 + ty * 5) % 7 === 0) fill(ctx, x + 6, y + 6, 3, 3, alpha(n, 0.2));
    },
  },
  "floor-concrete": {
    draw(ctx, x, y, tx, ty, v) {
      const c = pick(CONCRETE, v);
      fill(ctx, x, y, ART_PX, ART_PX, shade(c, (hash2(tx, ty) - 0.5) * 0.08));
      for (let i = 0; i < 6; i++) {
        const px = Math.floor(hash2(tx * 3 + i, ty) * 16);
        const py = Math.floor(hash2(tx, ty * 5 + i) * 16);
        fill(ctx, x + px, y + py, 1, 1, shade(c, -0.18));
      }
      if (tx % 4 === 0) fill(ctx, x, y, 1, ART_PX, shade(c, -0.25));
      if (ty % 4 === 0) fill(ctx, x, y, ART_PX, 1, shade(c, -0.25));
    },
  },
  "floor-grate": {
    draw(ctx, x, y) {
      fill(ctx, x, y, ART_PX, ART_PX, "#3a3d48");
      for (let i = 0; i < 16; i += 4) {
        fill(ctx, x + i, y, 2, ART_PX, "#5b606e");
        fill(ctx, x, y + i, ART_PX, 2, "#5b606e");
        fill(ctx, x + i, y, 1, ART_PX, "#747a8a");
        fill(ctx, x, y + i, ART_PX, 1, "#747a8a");
      }
    },
  },
  "floor-tatami": {
    draw(ctx, x, y, tx, ty) {
      const c = "#c9b77a";
      fill(ctx, x, y, ART_PX, ART_PX, c);
      const horizontal = (Math.floor(tx / 2) + Math.floor(ty / 2)) % 2 === 0;
      for (let i = 1; i < 16; i += 2) {
        if (horizontal) fill(ctx, x, y + i, ART_PX, 1, shade(c, -0.08));
        else fill(ctx, x + i, y, 1, ART_PX, shade(c, -0.08));
      }
      // Dark cloth border every two tiles.
      if (tx % 2 === 0) fill(ctx, x, y, 1, ART_PX, "#2f3a2a");
      if (ty % 2 === 0) fill(ctx, x, y, ART_PX, 1, "#2f3a2a");
    },
  },
};

/** Paints one floor tile of a material at art-pixel position (x, y). */
export function drawFloor(ctx: CanvasRenderingContext2D, item: string, variant: string | undefined, x: number, y: number, tx: number, ty: number) {
  const art = FLOORS[item] ?? FLOORS["floor-wood"]!;
  art.draw(ctx, x, y, tx, ty, variant);
}

/** Small swatch for the store. */
export function floorSwatch(item: string, variant: string | undefined, size = 48): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const scale = size / (ART_PX * 2);
  ctx.scale(scale, scale);
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) drawFloor(ctx, item, variant, tx * ART_PX, ty * ART_PX, tx, ty);
  return canvas;
}
