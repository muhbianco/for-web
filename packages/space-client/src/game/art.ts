import { type ClassId, type EnemyId, type GameLook, LOOK_LIMITS, type WeaponType } from "@muchat/space-core/game";

import { drawCharacter, type Palette } from "../render/sprites.ts";

/**
 * Arte do Refúgio desenhada em código (ADR 0009, GDD §2): pixel art original,
 * 16 px de arte por tile, sem arquivo de fora. Cada função pinta num canvas na
 * escala 1 (1 px de canvas = 1 px de arte); a cena amplia com "nearest".
 */

export const TILE = 16;
/** Cena: 12 × 8 tiles. */
export const SCENE_W = 12 * TILE;
export const SCENE_H = 8 * TILE;
const OUTLINE = "#15131a";

export const SKINS: readonly string[] = ["#f5d6bd", "#f1c7a5", "#e3b48f", "#c68a63", "#9b6444", "#6e4329"];
export const HAIRS: readonly string[] = ["#121014", "#3b2a20", "#7a3b22", "#a8452c", "#d9a441", "#e8d9a8", "#5b5b66", "#e8e8ee", "#3f6fd6", "#3faa6a"];
export const OUTFITS: readonly string[] = ["#3f7fd6", "#e0574f", "#3fae6a", "#8f5bd6", "#f0a53a", "#2ab3b8", "#d64f9a", "#e8e0cf"];
export const TRIMS: readonly string[] = ["#2c3350", "#33313c", "#3a3324", "#2b2b38", "#294052", "#3d2c3a", "#2a3a2e", "#3b4a6b"];

if (SKINS.length !== LOOK_LIMITS.skin || HAIRS.length !== LOOK_LIMITS.hair || OUTFITS.length !== LOOK_LIMITS.outfit || TRIMS.length !== LOOK_LIMITS.trim) {
  throw new Error("as paletas do herói têm de bater com LOOK_LIMITS");
}

const at = <T>(xs: readonly T[], i: number) => xs[((i % xs.length) + xs.length) % xs.length]!;

export function heroPalette(look: GameLook): Palette {
  return { skin: at(SKINS, look.skin), hair: at(HAIRS, look.hair), shirt: at(OUTFITS, look.outfit), pants: at(TRIMS, look.trim), shoes: "#1c1c22" };
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

type Ctx = CanvasRenderingContext2D;
const px = (ctx: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** Contorno de 1 px em volta de tudo o que já foi pintado (sombra para fora). */
function outline(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= c.width || y >= c.height ? 0 : img.data[(y * c.width + x) * 4 + 3]!);
  const out: [number, number][] = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (a(x, y) > 0) continue;
      if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) out.push([x, y]);
    }
  }
  ctx.fillStyle = OUTLINE;
  for (const [x, y] of out) ctx.fillRect(x, y, 1, 1);
}

/** Arma na mão da frente do herói (virado para a direita). */
function weapon(ctx: Ctx, ox: number, oy: number, w: WeaponType) {
  switch (w) {
    case "espada":
      px(ctx, ox + 12, oy + 4, 1, 6, "#d7dce6");
      px(ctx, ox + 11, oy + 10, 3, 1, "#b9823f");
      px(ctx, ox + 12, oy + 11, 1, 2, "#6a4a2e");
      break;
    case "machado":
      px(ctx, ox + 12, oy + 4, 1, 9, "#6a4a2e");
      px(ctx, ox + 13, oy + 4, 2, 3, "#c3cad6");
      break;
    case "maca":
      px(ctx, ox + 12, oy + 7, 1, 6, "#6a4a2e");
      px(ctx, ox + 11, oy + 4, 3, 3, "#8c909d");
      break;
    case "arco":
      px(ctx, ox + 13, oy + 3, 1, 10, "#8a5a2e");
      px(ctx, ox + 12, oy + 2, 1, 1, "#8a5a2e");
      px(ctx, ox + 12, oy + 13, 1, 1, "#8a5a2e");
      px(ctx, ox + 12, oy + 3, 1, 10, "#e8e0cf");
      break;
    case "varinha":
      px(ctx, ox + 12, oy + 7, 1, 5, "#3a2a20");
      px(ctx, ox + 12, oy + 5, 1, 2, "#2ee6ff");
      break;
    case "cajado":
      px(ctx, ox + 12, oy + 1, 1, 14, "#6a4a2e");
      px(ctx, ox + 11, oy + 0, 3, 2, "#4dff7a");
      break;
  }
}

/** Herói parado (quadro 0) ou em passo (1), virado para a direita, com a arma da classe. */
export function heroCanvas(look: GameLook, w: WeaponType, frame = 0): HTMLCanvasElement {
  const { c, ctx } = canvas(TILE, TILE);
  drawCharacter(ctx, 0, 0, "right", frame, heroPalette(look));
  weapon(ctx, 0, 0, w);
  return c;
}

export const CLASS_COLOR: Record<ClassId, string> = { cavaleiro: "#d2473f", arqueiro: "#3faa6a", feiticeiro: "#3f6fd6", druida: "#b9823f" };

/** Tamanho de cada inimigo em px de arte (o chefe ocupa 2 × 2 tiles). */
export const ENEMY_SIZE: Record<EnemyId, number> = { rato: 16, esqueleto: 16, fungo: 16, ossario: 24, matriarca: 32 };

export function enemyCanvas(id: EnemyId): HTMLCanvasElement {
  const s = ENEMY_SIZE[id];
  const { c, ctx } = canvas(s, s);
  switch (id) {
    case "rato":
      px(ctx, 4, 9, 9, 5, "#7d7a86");
      px(ctx, 3, 10, 2, 3, "#7d7a86");
      px(ctx, 2, 9, 2, 2, "#9a96a4");
      px(ctx, 3, 8, 2, 1, "#d9a0b4");
      px(ctx, 3, 11, 1, 1, "#e0574f");
      px(ctx, 13, 11, 2, 1, "#d9a0b4");
      px(ctx, 14, 10, 1, 1, "#d9a0b4");
      px(ctx, 5, 14, 1, 1, "#5b5866");
      px(ctx, 10, 14, 1, 1, "#5b5866");
      break;
    case "esqueleto":
      px(ctx, 6, 1, 5, 5, "#e8e4d8");
      px(ctx, 6, 3, 1, 1, OUTLINE);
      px(ctx, 9, 3, 1, 1, OUTLINE);
      px(ctx, 7, 7, 3, 1, "#e8e4d8");
      px(ctx, 6, 8, 5, 4, "#d6d1c3");
      px(ctx, 7, 9, 3, 1, "#8c8778");
      px(ctx, 7, 12, 1, 3, "#e8e4d8");
      px(ctx, 9, 12, 1, 3, "#e8e4d8");
      px(ctx, 3, 2, 1, 13, "#6a4a2e");
      px(ctx, 2, 0, 3, 2, "#c3cad6");
      break;
    case "fungo":
      px(ctx, 2, 3, 12, 5, "#8457d8");
      px(ctx, 4, 2, 8, 1, "#9c74e6");
      px(ctx, 4, 4, 2, 2, "#e8e0cf");
      px(ctx, 10, 4, 2, 2, "#e8e0cf");
      px(ctx, 5, 8, 6, 6, "#e3d7b8");
      px(ctx, 6, 9, 1, 1, OUTLINE);
      px(ctx, 9, 9, 1, 1, OUTLINE);
      px(ctx, 4, 14, 8, 1, "#3f9c4a");
      break;
    case "ossario":
      px(ctx, 8, 2, 8, 7, "#3a3d4a");
      px(ctx, 9, 4, 6, 4, "#e8e4d8");
      px(ctx, 10, 5, 1, 1, "#ff5a3c");
      px(ctx, 13, 5, 1, 1, "#ff5a3c");
      px(ctx, 7, 10, 10, 8, "#4a4f60");
      px(ctx, 8, 11, 8, 1, "#6c7387");
      px(ctx, 8, 18, 3, 5, "#3a3d4a");
      px(ctx, 13, 18, 3, 5, "#3a3d4a");
      px(ctx, 1, 9, 6, 9, "#6a4a2e");
      px(ctx, 2, 10, 4, 7, "#8c909d");
      px(ctx, 3, 12, 2, 3, "#d2473f");
      px(ctx, 18, 3, 2, 17, "#c3cad6");
      px(ctx, 17, 14, 4, 1, "#b9823f");
      break;
    case "matriarca":
      px(ctx, 3, 4, 26, 10, "#2d7336");
      px(ctx, 6, 2, 20, 3, "#3f9c4a");
      px(ctx, 10, 1, 12, 1, "#3f9c4a");
      for (const [x, y] of [[7, 6], [14, 5], [21, 7], [11, 10], [24, 11]] as const) px(ctx, x, y, 3, 2, "#c9f27a");
      px(ctx, 9, 14, 14, 12, "#cbbf9a");
      px(ctx, 11, 17, 3, 2, "#ffd23c");
      px(ctx, 18, 17, 3, 2, "#ffd23c");
      px(ctx, 13, 22, 6, 1, "#6a5a3a");
      for (const x of [4, 8, 23, 27]) px(ctx, x, 14, 2, 12 + (x % 3), "#3f9c4a");
      px(ctx, 7, 26, 18, 5, "#2d7336");
      break;
  }
  outline(c);
  return c;
}

/** Boneco de treino por nível (madeira, reforçado, avançado, mágico, lendário): 16 × 24. */
export function dummyCanvas(tier: number): HTMLCanvasElement {
  const { c, ctx } = canvas(TILE, 24);
  const body = ["#d8b482", "#b9823f", "#9aa3b2", "#5a4fd0", "#e6b422"][Math.max(0, Math.min(4, tier))]!;
  px(ctx, 7, 12, 2, 10, "#6a4a2e");
  px(ctx, 4, 22, 8, 2, "#4a3420");
  px(ctx, 4, 5, 8, 8, body);
  px(ctx, 5, 1, 6, 5, body);
  px(ctx, 2, 7, 12, 2, body);
  if (tier >= 1) px(ctx, 4, 9, 8, 1, "#6c7387");
  if (tier >= 2) px(ctx, 5, 6, 6, 3, "#c3cad6");
  if (tier >= 3) {
    px(ctx, 6, 3, 1, 1, "#2ee6ff");
    px(ctx, 9, 3, 1, 1, "#2ee6ff");
    px(ctx, 7, 10, 2, 2, "#2ee6ff");
  }
  if (tier >= 4) px(ctx, 5, 0, 6, 1, "#fff1a8");
  px(ctx, 7, 7, 2, 2, "#d2473f");
  outline(c);
  return c;
}

/** O quarto do Refúgio vazio: parede com rodapé e piso de tábuas. Os móveis são a decoração do herói. */
export function lobbyCanvas(): HTMLCanvasElement {
  const { c, ctx } = canvas(SCENE_W, SCENE_H);
  px(ctx, 0, 0, SCENE_W, 3 * TILE, "#3b3346");
  for (let x = 0; x < SCENE_W; x += 8) px(ctx, x, 0, 1, 3 * TILE, "#352e40");
  px(ctx, 0, 3 * TILE - 3, SCENE_W, 3, "#2a2433");
  for (let y = 3 * TILE; y < SCENE_H; y += 4) {
    px(ctx, 0, y, SCENE_W, 4, y % 8 === 0 ? "#8a5a34" : "#7f5230");
    for (let x = (y / 4) % 3 === 0 ? 0 : 12; x < SCENE_W; x += 24) px(ctx, x, y, 1, 4, "#5e3c22");
  }
  return c;
}

/** As Ruínas de Pedramusgo: piso de lajes, muro com arcos e musgo. */
export function ruinsCanvas(): HTMLCanvasElement {
  const { c, ctx } = canvas(SCENE_W, SCENE_H);
  px(ctx, 0, 0, SCENE_W, 3 * TILE, "#2b2d36");
  for (let x = 8; x < SCENE_W; x += 48) {
    px(ctx, x, 10, 28, 38, "#1a1b22");
    px(ctx, x + 2, 8, 24, 2, "#1a1b22");
    px(ctx, x + 6, 6, 16, 2, "#1a1b22");
  }
  for (let x = 0; x < SCENE_W; x += 12) px(ctx, x, 3 * TILE - 4, 6, 3, "#3f9c4a");
  for (let y = 3 * TILE; y < SCENE_H; y += 16) {
    for (let x = (y / 16) % 2 === 0 ? 0 : -8; x < SCENE_W; x += 16) {
      px(ctx, x, y, 16, 16, "#4a4d5a");
      px(ctx, x, y, 16, 1, "#3a3c47");
      px(ctx, x, y, 1, 16, "#3a3c47");
      px(ctx, x + 4, y + 6, 2, 1, "#5a5e6c");
    }
  }
  for (const [x, y] of [[20, 70], [90, 100], [150, 80], [170, 118]] as const) px(ctx, x, y, 5, 2, "#3f9c4a");
  return c;
}
