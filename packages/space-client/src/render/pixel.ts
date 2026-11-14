/**
 * Pixel-art primitives for the decoration library (ADR 0007). Everything is
 * authored at 16 art pixels per tile and drawn at 2× (32 px per tile), like
 * the characters: same resolution, same 1 px outline, same light from the top
 * left. Original art drawn in code; no external assets.
 */

export const ART_PX = 16;
export const SCALE = 2;
export const OUTLINE = "#1a1724";

export const WOOD: Record<string, string> = { claro: "#d8b482", escuro: "#6a4a2e", mel: "#b9823f" };
export const FABRIC: Record<string, string> = { azul: "#3f6fd6", cinza: "#8c909d", vermelho: "#d2473f", verde: "#3faa6a", roxo: "#8457d8" };
export const NEON: Record<string, string> = { ciano: "#2ee6ff", magenta: "#ff3fd0", verde: "#4dff7a", laranja: "#ffa52e" };
export const METAL = "#9aa3b2";
export const DARK = "#2a2b36";
export const DARKER = "#1e1f29";
export const WHITE = "#f1f1f4";
export const SCREEN = "#182039";
export const LEAF = "#3f9c4a";
export const LEAF_DARK = "#2d7336";
export const TERRACOTTA = "#c0633a";

/** Picks a variant colour from a table, with the first entry as fallback. */
export function pick(table: Record<string, string>, variant: string | undefined): string {
  if (variant && table[variant]) return table[variant]!;
  return Object.values(table)[0]!;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Lightens (dl > 0) or darkens (dl < 0) a colour, keeping its hue. */
export function shade(hex: string, dl: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (dl >= 0) return rgbToHex(r + (255 - r) * dl, g + (255 - g) * dl, b + (255 - b) * dl);
  const k = 1 + dl;
  return rgbToHex(r * k, g * k, b * k);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Drawing surface of one sprite in art pixels. */
export interface G {
  ctx: CanvasRenderingContext2D;
  /** Footprint at this rotation, in tiles. */
  w: number;
  h: number;
  /** Sprite size in art pixels; the footprint is the bottom `h` tiles. */
  W: number;
  H: number;
  /** Art-pixel row where the footprint starts (headroom above it). */
  top: number;
  rot: 0 | 1 | 2 | 3;
  variant: string | undefined;
}

export function rect(g: G, x: number, y: number, w: number, h: number, c: string) {
  if (w <= 0 || h <= 0) return;
  g.ctx.fillStyle = c;
  g.ctx.fillRect(x, y, w, h);
}

export function dot(g: G, x: number, y: number, c: string) {
  rect(g, x, y, 1, 1, c);
}

/** 1 px border inside the rectangle. */
export function outline(g: G, x: number, y: number, w: number, h: number, c = OUTLINE) {
  rect(g, x, y, w, 1, c);
  rect(g, x, y + h - 1, w, 1, c);
  rect(g, x, y, 1, h, c);
  rect(g, x + w - 1, y, 1, h, c);
}

/** Filled rectangle lit from the top left: light top/left edge, dark bottom/right edge. */
export function bevel(g: G, x: number, y: number, w: number, h: number, c: string, strength = 1) {
  rect(g, x, y, w, h, c);
  rect(g, x, y, w, 1, shade(c, 0.22 * strength));
  rect(g, x, y, 1, h, shade(c, 0.1 * strength));
  rect(g, x, y + h - 1, w, 1, shade(c, -0.28 * strength));
  rect(g, x + w - 1, y, 1, h, shade(c, -0.16 * strength));
}

/** A box seen from above-front: a lighter top face over a front face, outlined. */
export function block(g: G, x: number, y: number, w: number, topH: number, frontH: number, c: string) {
  outline(g, x, y, w, topH + frontH);
  bevel(g, x + 1, y + 1, w - 2, topH - 1, shade(c, 0.14));
  bevel(g, x + 1, y + topH, w - 2, frontH - 1, shade(c, -0.08));
  rect(g, x + 1, y + topH, w - 2, 1, shade(c, -0.35));
}

/** Short legs under a piece of furniture. */
export function legs(g: G, x: number, y: number, w: number, c: string, inset = 1) {
  rect(g, x + inset, y, 2, 2, c);
  rect(g, x + w - inset - 2, y, 2, 2, c);
  dot(g, x + inset, y + 1, OUTLINE);
  dot(g, x + w - inset - 1, y + 1, OUTLINE);
}

/** Soft glow around a light source (drawn before the source). */
export function glow(g: G, x: number, y: number, w: number, h: number, c: string, a = 0.35) {
  rect(g, x - 1, y - 1, w + 2, h + 2, alpha(c, a * 0.4));
  rect(g, x, y, w, h, alpha(c, a));
}

/** A lit screen with a subtle gradient and a reflection. */
export function screen(g: G, x: number, y: number, w: number, h: number, c = "#3b9ad9") {
  outline(g, x, y, w, h, DARKER);
  rect(g, x + 1, y + 1, w - 2, h - 2, shade(c, -0.25));
  rect(g, x + 1, y + 1, w - 2, Math.max(1, Math.floor((h - 2) / 2)), c);
  rect(g, x + 2, y + 2, 1, 1, shade(c, 0.6));
}

/** A cushion: rounded-looking pad with a seam highlight. */
export function cushion(g: G, x: number, y: number, w: number, h: number, c: string) {
  rect(g, x + 1, y, w - 2, h, c);
  rect(g, x, y + 1, w, h - 2, c);
  rect(g, x + 1, y, w - 2, 1, shade(c, 0.25));
  rect(g, x + 1, y + h - 1, w - 2, 1, shade(c, -0.3));
}

/** Round-ish blob (plants, lamps): a filled disc approximated on the pixel grid. */
export function disc(g: G, cx: number, cy: number, r: number, c: string) {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y + 0.5));
    rect(g, cx - half, cy + y, 2 * half + 1, 1, c);
  }
}

/** Punches a transparent disc (what is behind shows through). */
export function erase(g: G, cx: number, cy: number, r: number) {
  const prev = g.ctx.globalCompositeOperation;
  g.ctx.globalCompositeOperation = "destination-out";
  disc(g, cx, cy, r, "#000");
  g.ctx.globalCompositeOperation = prev;
}

/** Outlined disc with a transparent middle. */
export function ring(g: G, cx: number, cy: number, r: number, c = OUTLINE) {
  disc(g, cx, cy, r, c);
  if (r > 1) erase(g, cx, cy, r - 1);
}

/** Plant foliage: layered leaf blobs with highlights. */
export function foliage(g: G, cx: number, cy: number, r: number) {
  disc(g, cx, cy, r, OUTLINE);
  disc(g, cx, cy, r - 1, LEAF_DARK);
  disc(g, cx - 1, cy - 1, Math.max(1, r - 2), LEAF);
  dot(g, cx - 1, cy - r + 2, shade(LEAF, 0.4));
  dot(g, cx + 1, cy, shade(LEAF, 0.25));
}

/** Flower pot. */
export function pot(g: G, x: number, y: number, w: number, h: number, c: string) {
  outline(g, x, y, w, h);
  bevel(g, x + 1, y + 1, w - 2, h - 2, c);
  rect(g, x, y, w, 1, OUTLINE);
  rect(g, x + 1, y + 1, w - 2, 1, shade(c, 0.3));
}

/** Creates the canvas for a sprite of `w`×`h` tiles with `tall` tiles of headroom. */
export function spriteCanvas(w: number, h: number, tall: number): { canvas: HTMLCanvasElement; g: Omit<G, "rot" | "variant"> } {
  const W = w * ART_PX;
  const H = (h + tall) * ART_PX;
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.scale(SCALE, SCALE);
  return { canvas, g: { ctx, w, h, W, H, top: tall * ART_PX } };
}
