import { AVATAR_PALETTES, type Direction } from "@muchat/space-core";

/**
 * Placeholder pixel-art characters drawn in code (original art, no assets):
 * 16×16, four directions × three frames (idle, step A, step B), 1 px outline.
 * Replaced by the chosen art pack later; the sheet layout stays the same.
 */
export const SPRITE = 16;
export const DIRS: readonly Direction[] = ["down", "up", "left", "right"];
export const FRAMES = 3;

export interface Palette {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
}

export const PALETTES: readonly Palette[] = [
  { skin: "#f1c7a5", hair: "#3b2a20", shirt: "#3f7fd6", pants: "#2c3350", shoes: "#1c1c22" },
  { skin: "#c68a63", hair: "#121014", shirt: "#e0574f", pants: "#33313c", shoes: "#1c1c22" },
  { skin: "#8d5a3b", hair: "#1d1410", shirt: "#3fae6a", pants: "#3a3324", shoes: "#20180f" },
  { skin: "#f5d6bd", hair: "#d9a441", shirt: "#8f5bd6", pants: "#2b2b38", shoes: "#1c1c22" },
  { skin: "#e3b48f", hair: "#7a3b22", shirt: "#f0a53a", pants: "#294052", shoes: "#1c1c22" },
  { skin: "#b87850", hair: "#2f2f37", shirt: "#2ab3b8", pants: "#3d2c3a", shoes: "#18181c" },
  { skin: "#f0c09c", hair: "#5b5b66", shirt: "#d64f9a", pants: "#2a3a2e", shoes: "#1c1c22" },
  { skin: "#9b6444", hair: "#a8452c", shirt: "#e8e0cf", pants: "#3b4a6b", shoes: "#20180f" },
];

const OUTLINE = "#15131a";

if (PALETTES.length !== AVATAR_PALETTES) throw new Error("PALETTES must match AVATAR_PALETTES");

export function palette(index: number): Palette {
  return PALETTES[((index % PALETTES.length) + PALETTES.length) % PALETTES.length]!;
}

type Px = [x: number, y: number, w: number, h: number, color: keyof Palette | "eye"];

function shape(dir: Direction, frame: number): Px[] {
  const out: Px[] = [];
  // Legs: idle together, steps alternate one leg shorter (lifted).
  const leftLift = frame === 1 ? 1 : 0;
  const rightLift = frame === 2 ? 1 : 0;
  out.push([6, 12, 2, 3 - leftLift, "pants"], [8, 12, 2, 3 - rightLift, "pants"]);
  out.push([6, 15 - leftLift, 2, 1, "shoes"], [8, 15 - rightLift, 2, 1, "shoes"]);
  // Body and arms (arms swing opposite to legs).
  out.push([5, 7, 6, 5, "shirt"]);
  const armL = frame === 2 ? 1 : 0;
  const armR = frame === 1 ? 1 : 0;
  if (dir === "left") out.push([4, 8 + armL, 1, 3, "skin"]);
  else if (dir === "right") out.push([11, 8 + armR, 1, 3, "skin"]);
  else out.push([4, 8 + armL, 1, 3, "skin"], [11, 8 + armR, 1, 3, "skin"]);
  // Head.
  out.push([5, 2, 6, 5, "skin"]);
  out.push([5, 1, 6, 2, "hair"]);
  if (dir === "up") out.push([5, 2, 6, 4, "hair"]);
  if (dir === "left") out.push([9, 2, 2, 3, "hair"]);
  if (dir === "right") out.push([5, 2, 2, 3, "hair"]);
  if (dir === "down") out.push([6, 4, 1, 1, "eye"], [9, 4, 1, 1, "eye"]);
  if (dir === "left") out.push([6, 4, 1, 1, "eye"]);
  if (dir === "right") out.push([9, 4, 1, 1, "eye"]);
  return out;
}

/** Draws one 16×16 frame at (ox, oy) with a 1 px outline around the silhouette. */
export function drawCharacter(ctx: CanvasRenderingContext2D, ox: number, oy: number, dir: Direction, frame: number, pal: Palette) {
  const parts = shape(dir, frame);
  ctx.fillStyle = OUTLINE;
  for (const [x, y, w, h] of parts) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) ctx.fillRect(ox + x + dx, oy + y + dy, w, h);
  }
  for (const [x, y, w, h, c] of parts) {
    ctx.fillStyle = c === "eye" ? OUTLINE : pal[c];
    ctx.fillRect(ox + x, oy + y, w, h);
  }
}

/** Sheet: columns = DIRS × FRAMES, one row. */
export function characterSheet(pal: Palette): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE * DIRS.length * FRAMES;
  canvas.height = SPRITE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  DIRS.forEach((dir, d) => {
    for (let f = 0; f < FRAMES; f++) drawCharacter(ctx, (d * FRAMES + f) * SPRITE, 0, dir, f, pal);
  });
  return canvas;
}
