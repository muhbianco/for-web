import { type DecorItem, footprint, type Rotation } from "@muchat/space-core";
import { Texture } from "pixi.js";

import { artOf } from "./items.ts";
import { ART_PX, type G, SCALE, spriteCanvas } from "./pixel.ts";

/**
 * Sprites of the decoration library, drawn on demand and cached per
 * (item, rotation, variant). The same painter serves the PixiJS textures and
 * the store thumbnails, so what you pick is what you get.
 */
export interface SpriteInfo {
  canvas: HTMLCanvasElement;
  /** Footprint at this rotation, tiles. */
  w: number;
  h: number;
  /** Headroom above the footprint, tiles. */
  tall: number;
}

const sprites = new Map<string, SpriteInfo>();
const textures = new Map<string, Texture>();

const key = (item: DecorItem, rot: Rotation, variant: string | undefined) => `${item.id}|${rot}|${variant ?? ""}`;

export function spriteFor(item: DecorItem, rot: Rotation, variant: string | undefined): SpriteInfo {
  const k = key(item, rot, variant);
  let s = sprites.get(k);
  if (s) return s;
  const art = artOf(item.id);
  const fp = footprint(item, rot);
  const tall = art.tall ?? 0;
  const { canvas, g } = spriteCanvas(fp.w, fp.h, tall);
  const full: G = { ...g, rot, variant };
  art.draw(full);
  s = { canvas, w: fp.w, h: fp.h, tall };
  sprites.set(k, s);
  return s;
}

export function textureFor(item: DecorItem, rot: Rotation, variant: string | undefined): Texture {
  const k = key(item, rot, variant);
  let t = textures.get(k);
  if (t) return t;
  const s = spriteFor(item, rot, variant);
  t = Texture.from(s.canvas);
  t.source.scaleMode = "nearest";
  textures.set(k, t);
  return t;
}

/**
 * Thumbnail for the store: the sprite fitted into a square, crisp pixels,
 * on a transparent background. Independent of PixiJS (plain canvas).
 */
export function thumbnail(item: DecorItem, variant: string | undefined, size = 64, rot: Rotation = 0): HTMLCanvasElement {
  const s = spriteFor(item, rot, variant);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const sw = s.canvas.width;
  const sh = s.canvas.height;
  // Integer scale when it fits, else the largest that does.
  const fit = Math.min(size / sw, size / sh);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  ctx.drawImage(s.canvas, Math.floor((size - dw) / 2), Math.floor((size - dh) / 2), dw, dh);
  return canvas;
}

/** World pixels per tile as the sprites are drawn (art pixels × scale). */
export const SPRITE_TILE = ART_PX * SCALE;
