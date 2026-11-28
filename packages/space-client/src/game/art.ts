import type { AvatarGear } from "@muchat/space-core";
import { dungeonById } from "@muchat/space-core/game/ot/balance";

import { artCanvas as canvas, type Ctx, drawEquipped, outline, px } from "../render/heroArt.ts";
import { OUTLINE, shade } from "../render/pixel.ts";
import { palette } from "../render/sprites.ts";
import { DOOR_ROW, SCENE_H, SCENE_W, TILE } from "./script.ts";

/**
 * Arte da dungeon vista de cima (docs/espaco/jogo/ot, etapa O10), desenhada em código no estilo
 * do Espaço: 16 px de arte por tile, contorno de 1 px, luz de cima à esquerda. Tudo é nosso
 * (nada de sprite, nome ou mapa do Tibia). Cada função pinta num canvas na escala 1; a cena
 * amplia com "nearest" e destrói só as texturas que criou a partir destes canvas.
 */

/** Sorteio fixo por semente (mulberry32): a mesma sala sai sempre igual. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---- heróis ------------------------------------------------------------------

/**
 * Quadros do herói na cena: [parado, passo A, passo B] para a direita e [parado] de frente, com o
 * avatar equipado do mapa (heroArt.drawEquipped: armadura, arma e escudo pelo material).
 */
export function equippedFrames(pal: number, gear: AvatarGear): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let f = 0; f < 3; f++) {
    const { c, ctx } = canvas(TILE, TILE);
    drawEquipped(ctx, "right", f, palette(pal), gear);
    out.push(c);
  }
  const { c, ctx } = canvas(TILE, TILE);
  drawEquipped(ctx, "down", 0, palette(pal), gear);
  out.push(c);
  return out;
}

/** O herói caído: deitado no chão (a cabeça para a direita), apagado. */
export function fallenCanvas(standing: HTMLCanvasElement): HTMLCanvasElement {
  const { c, ctx } = canvas(TILE, TILE);
  ctx.save();
  ctx.translate(TILE / 2, TILE - 5);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(standing, -TILE / 2, -TILE / 2);
  ctx.restore();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "rgba(36, 34, 46, 0.5)";
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.globalCompositeOperation = "source-over";
  return c;
}

// ---- monstros ----------------------------------------------------------------

/** Lado do sprite de cada monstro (o chefe ocupa 2 × 2 tiles). */
export function monsterSize(id: string, boss: boolean): number {
  return boss || BIG.has(likeOf(id)) ? 32 : 16;
}

/** A chave da arte já é o desenho (o elenco v5 escolhe por família e região: script.ts foeArt). */
function likeOf(id: string): string {
  return id;
}

/** Pinta por cima do desenho (só onde há desenho), guardando a luz e a sombra dele. */
function tint(ctx: Ctx, w: number, h: number, color: string, alpha = 0.5) {
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
const BIG = new Set([
  "matriarca-do-musgo", "rei-das-comportas", "guardiao-da-forja", "rei-javali", "rainha-aranha", "capataz-espectral",
  "medusa-ancia", "senhor-das-cinzas", "wyrm-de-gelo", "imperador-do-vazio",
]);

type Painter = (ctx: Ctx) => void;

/** Linha de 1 px por uma sequência de pontos (x0, y0, x1, y1, …): pernas, fios, rachaduras. */
function line(ctx: Ctx, color: string, ...xy: number[]) {
  for (let i = 0; i + 3 < xy.length; i += 2) {
    let x = xy[i]!;
    let y = xy[i + 1]!;
    const x1 = xy[i + 2]!;
    const y1 = xy[i + 3]!;
    const dx = Math.abs(x1 - x);
    const dy = -Math.abs(y1 - y);
    const sx = x < x1 ? 1 : -1;
    const sy = y < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      px(ctx, x, y, 1, 1, color);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
}

/** O lobo de lado; o cinzento e o glacial mudam a pelagem e o que vem por cima. */
function wolf(ctx: Ctx, fur: string, light: string, dark: string, eye: string) {
  px(ctx, 3, 11, 2, 3, fur);
  px(ctx, 6, 11, 1, 3, dark);
  px(ctx, 10, 11, 1, 3, dark);
  px(ctx, 12, 10, 2, 4, fur);
  px(ctx, 2, 14, 3, 1, dark);
  px(ctx, 12, 14, 3, 1, dark);
  px(ctx, 3, 7, 11, 4, fur);
  px(ctx, 6, 7, 6, 1, dark);
  px(ctx, 5, 10, 6, 1, light);
  px(ctx, 13, 6, 2, 2, fur);
  px(ctx, 14, 4, 2, 2, fur);
  px(ctx, 15, 3, 1, 1, light);
  px(ctx, 2, 6, 4, 5, fur);
  px(ctx, 2, 9, 2, 2, light);
  px(ctx, 1, 3, 5, 4, fur);
  px(ctx, 2, 3, 3, 1, light);
  px(ctx, 4, 1, 1, 2, dark);
  px(ctx, 5, 2, 1, 1, dark);
  px(ctx, 0, 5, 2, 2, light);
  px(ctx, 0, 5, 1, 1, OUTLINE);
  px(ctx, 1, 7, 3, 1, dark);
  px(ctx, 1, 7, 1, 1, "#f1f1f4");
  px(ctx, 2, 4, 1, 1, eye);
}

/** Os monstros do jogo, de frente para a esquerda (o grupo vem da esquerda). */
const MONSTERS: Record<string, Painter> = {
  "rato-do-musgo": (ctx) => {
    px(ctx, 4, 9, 9, 5, "#6f7466");
    px(ctx, 5, 12, 7, 1, "#858a7a");
    px(ctx, 1, 10, 4, 3, "#6f7466");
    px(ctx, 0, 11, 1, 1, "#d9a0b4");
    px(ctx, 3, 8, 2, 2, "#8a8f80");
    px(ctx, 4, 8, 1, 1, "#d9a0b4");
    px(ctx, 2, 10, 1, 1, "#e0574f");
    px(ctx, 6, 8, 5, 2, "#3f9c4a");
    px(ctx, 7, 7, 3, 1, "#57b85f");
    px(ctx, 10, 9, 2, 1, "#2d7336");
    px(ctx, 13, 12, 2, 1, "#d9a0b4");
    px(ctx, 14, 11, 1, 1, "#d9a0b4");
    px(ctx, 15, 10, 1, 1, "#d9a0b4");
    px(ctx, 4, 14, 2, 1, "#4f5348");
    px(ctx, 10, 14, 2, 1, "#4f5348");
  },
  "morcego-da-cripta": (ctx) => {
    for (const [x, m] of [[0, 1], [10, 11]] as const) {
      px(ctx, x, 5, 6, 3, "#4b3a5c");
      px(ctx, x + 1, 4, 4, 1, "#4b3a5c");
      px(ctx, m, 6, 4, 1, "#6a5480");
    }
    px(ctx, 0, 8, 2, 1, "#4b3a5c");
    px(ctx, 3, 8, 2, 1, "#4b3a5c");
    px(ctx, 14, 8, 2, 1, "#4b3a5c");
    px(ctx, 11, 8, 2, 1, "#4b3a5c");
    px(ctx, 6, 4, 4, 6, "#2e2438");
    px(ctx, 6, 2, 1, 2, "#2e2438");
    px(ctx, 9, 2, 1, 2, "#2e2438");
    px(ctx, 6, 5, 1, 1, "#ff5a3c");
    px(ctx, 9, 5, 1, 1, "#ff5a3c");
    px(ctx, 7, 8, 1, 1, "#e8e4d8");
    px(ctx, 8, 8, 1, 1, "#e8e4d8");
    px(ctx, 7, 10, 2, 1, "#2e2438");
  },
  "ossada-inquieta": (ctx) => {
    px(ctx, 6, 1, 5, 5, "#e8e4d8");
    px(ctx, 6, 3, 1, 1, OUTLINE);
    px(ctx, 9, 3, 1, 1, OUTLINE);
    px(ctx, 7, 5, 3, 1, "#c9c4b6");
    px(ctx, 7, 7, 3, 1, "#e8e4d8");
    px(ctx, 6, 8, 5, 4, "#d6d1c3");
    px(ctx, 7, 9, 3, 1, "#8c8778");
    px(ctx, 7, 11, 3, 1, "#8c8778");
    px(ctx, 7, 12, 1, 3, "#e8e4d8");
    px(ctx, 9, 12, 1, 3, "#e8e4d8");
    px(ctx, 4, 8, 2, 1, "#e8e4d8");
    px(ctx, 3, 2, 1, 13, "#6a4a2e");
    px(ctx, 2, 0, 3, 2, "#c3cad6");
    px(ctx, 11, 8, 1, 3, "#e8e4d8");
  },
  "matriarca-do-musgo": (ctx) => {
    px(ctx, 3, 4, 26, 10, "#2d7336");
    px(ctx, 6, 2, 20, 3, "#3f9c4a");
    px(ctx, 10, 1, 12, 1, "#3f9c4a");
    for (const [x, y] of [[7, 6], [14, 5], [21, 7], [11, 10], [24, 11]] as const) px(ctx, x, y, 3, 2, "#c9f27a");
    px(ctx, 9, 14, 14, 12, "#cbbf9a");
    px(ctx, 10, 15, 12, 1, "#ddd3b2");
    px(ctx, 11, 17, 3, 2, "#ffd23c");
    px(ctx, 18, 17, 3, 2, "#ffd23c");
    px(ctx, 12, 18, 1, 1, OUTLINE);
    px(ctx, 19, 18, 1, 1, OUTLINE);
    px(ctx, 13, 22, 6, 1, "#6a5a3a");
    for (const x of [4, 8, 23, 27]) px(ctx, x, 14, 2, 12 + (x % 3), "#3f9c4a");
    px(ctx, 7, 26, 18, 5, "#2d7336");
    px(ctx, 9, 27, 3, 1, "#3f9c4a");
    px(ctx, 20, 28, 3, 1, "#3f9c4a");
  },
  "caranguejo-de-pedra": (ctx) => {
    for (const [x, y] of [[2, 12], [4, 13], [11, 13], [13, 12]] as const) px(ctx, x, y, 1, 2, "#5b5866");
    px(ctx, 3, 7, 10, 6, "#7d7a86");
    px(ctx, 4, 6, 8, 1, "#8c8996");
    px(ctx, 5, 5, 6, 1, "#9a96a4");
    px(ctx, 5, 8, 2, 1, "#5b5866");
    px(ctx, 9, 7, 2, 2, "#5b5866");
    px(ctx, 7, 10, 2, 1, "#a8a4b2");
    px(ctx, 0, 7, 2, 1, "#9a96a4");
    px(ctx, 0, 8, 3, 3, "#9a96a4");
    px(ctx, 1, 9, 1, 1, "#5b5866");
    px(ctx, 1, 12, 2, 2, "#9a96a4");
    px(ctx, 5, 3, 1, 2, "#7d7a86");
    px(ctx, 8, 3, 1, 2, "#7d7a86");
    px(ctx, 5, 2, 1, 1, "#15131a");
    px(ctx, 8, 2, 1, 1, "#15131a");
  },
  "troll-do-lodo": (ctx) => {
    px(ctx, 5, 12, 2, 4, "#55632c");
    px(ctx, 9, 12, 2, 4, "#55632c");
    px(ctx, 4, 6, 8, 7, "#6b7d3a");
    px(ctx, 6, 8, 4, 4, "#7f9248");
    px(ctx, 3, 2, 6, 5, "#6b7d3a");
    px(ctx, 4, 4, 1, 1, "#ffd23c");
    px(ctx, 6, 4, 1, 1, "#ffd23c");
    px(ctx, 4, 6, 3, 1, "#2a3014");
    px(ctx, 4, 6, 1, 1, "#e8e4d8");
    px(ctx, 2, 7, 2, 5, "#6b7d3a");
    px(ctx, 12, 7, 2, 4, "#6b7d3a");
    px(ctx, 0, 4, 2, 8, "#6a4a2e");
    px(ctx, 0, 3, 3, 2, "#5e3c22");
    px(ctx, 5, 13, 1, 2, "#4f5c2a");
    px(ctx, 11, 9, 1, 3, "#4f5c2a");
    px(ctx, 7, 2, 2, 1, "#4f5c2a");
  },
  "serpente-da-comporta": (ctx) => {
    px(ctx, 4, 11, 10, 4, "#2f7fa8");
    px(ctx, 5, 10, 8, 1, "#2f7fa8");
    px(ctx, 5, 13, 8, 1, "#8fd0e8");
    px(ctx, 6, 7, 7, 4, "#2f7fa8");
    px(ctx, 7, 9, 5, 1, "#8fd0e8");
    px(ctx, 4, 4, 3, 5, "#2f7fa8");
    px(ctx, 1, 2, 5, 3, "#3a90bd");
    px(ctx, 3, 2, 1, 1, "#ffd23c");
    px(ctx, 0, 4, 1, 1, "#e0574f");
    px(ctx, 5, 3, 1, 1, "#8fd0e8");
    px(ctx, 9, 12, 1, 1, "#1f5f80");
    px(ctx, 12, 12, 1, 1, "#1f5f80");
    px(ctx, 9, 8, 1, 1, "#1f5f80");
  },
  "rei-das-comportas": (ctx) => {
    px(ctx, 6, 12, 20, 14, "#2a6f9e");
    px(ctx, 8, 10, 16, 2, "#2a6f9e");
    px(ctx, 9, 26, 14, 3, "#2a6f9e");
    px(ctx, 10, 15, 12, 10, "#6fb6d8");
    px(ctx, 11, 16, 10, 1, "#8fd0e8");
    px(ctx, 8, 4, 16, 8, "#3a86b8");
    px(ctx, 10, 6, 3, 3, "#ffd23c");
    px(ctx, 19, 6, 3, 3, "#ffd23c");
    px(ctx, 11, 7, 1, 1, OUTLINE);
    px(ctx, 20, 7, 1, 1, OUTLINE);
    px(ctx, 11, 10, 10, 1, "#1a4a6a");
    px(ctx, 9, 1, 14, 3, "#ffd23c");
    for (const x of [9, 15, 21]) px(ctx, x, 0, 2, 1, "#ffd23c");
    px(ctx, 12, 2, 1, 1, "#e0574f");
    px(ctx, 19, 2, 1, 1, "#3faa6a");
    px(ctx, 2, 14, 4, 8, "#2a6f9e");
    px(ctx, 26, 14, 4, 8, "#2a6f9e");
    px(ctx, 1, 4, 1, 24, "#b9823f");
    px(ctx, 0, 3, 3, 1, "#d7dce6");
    px(ctx, 0, 1, 1, 2, "#d7dce6");
    px(ctx, 2, 1, 1, 2, "#d7dce6");
    px(ctx, 1, 0, 1, 3, "#d7dce6");
    px(ctx, 8, 29, 5, 2, "#1f5f80");
    px(ctx, 19, 29, 5, 2, "#1f5f80");
    px(ctx, 14, 27, 1, 2, "#8fd0e8");
  },
  "automato-de-ferro": (ctx) => {
    px(ctx, 5, 12, 2, 3, "#5a606e");
    px(ctx, 9, 12, 2, 3, "#5a606e");
    px(ctx, 4, 15, 3, 1, "#3a3d4a");
    px(ctx, 9, 15, 3, 1, "#3a3d4a");
    px(ctx, 3, 5, 10, 7, "#8c909d");
    px(ctx, 4, 6, 8, 1, "#a8adb9");
    for (const [x, y] of [[4, 8], [11, 8], [4, 10], [11, 10]] as const) px(ctx, x, y, 1, 1, "#5a606e");
    px(ctx, 7, 8, 2, 2, "#2ee6ff");
    px(ctx, 5, 1, 6, 4, "#9aa3b2");
    px(ctx, 5, 2, 4, 1, "#ff5a3c");
    px(ctx, 1, 6, 2, 6, "#6c7387");
    px(ctx, 0, 11, 3, 2, "#5a606e");
    px(ctx, 13, 6, 2, 5, "#6c7387");
    px(ctx, 8, 0, 1, 1, "#ffd23c");
  },
  "brasa-viva": (ctx) => {
    px(ctx, 3, 6, 10, 8, "#ff7a2e");
    px(ctx, 4, 4, 8, 2, "#ff7a2e");
    px(ctx, 5, 2, 2, 2, "#ff7a2e");
    px(ctx, 9, 1, 2, 3, "#ff7a2e");
    px(ctx, 2, 9, 1, 4, "#ff7a2e");
    px(ctx, 13, 8, 1, 4, "#ff7a2e");
    px(ctx, 5, 7, 6, 6, "#ffd23c");
    px(ctx, 6, 5, 3, 2, "#ffb347");
    px(ctx, 6, 11, 4, 3, "#3a2a20");
    px(ctx, 7, 12, 2, 1, "#ff5a3c");
    px(ctx, 5, 8, 2, 1, "#fff7d6");
    px(ctx, 9, 8, 2, 1, "#fff7d6");
    px(ctx, 5, 8, 1, 1, OUTLINE);
    px(ctx, 9, 8, 1, 1, OUTLINE);
    px(ctx, 12, 3, 1, 1, "#ffb347");
    px(ctx, 2, 5, 1, 1, "#ffb347");
  },
  martelador: (ctx) => {
    px(ctx, 5, 12, 2, 4, "#5e3c22");
    px(ctx, 9, 12, 2, 4, "#5e3c22");
    px(ctx, 4, 6, 8, 7, "#a0603a");
    px(ctx, 5, 8, 6, 5, "#5e3c22");
    px(ctx, 6, 9, 4, 1, "#7a5232");
    px(ctx, 5, 2, 6, 4, "#a0603a");
    px(ctx, 7, 2, 2, 1, "#c07a4e");
    px(ctx, 5, 5, 6, 2, "#3b2a20");
    px(ctx, 6, 3, 1, 1, OUTLINE);
    px(ctx, 2, 6, 2, 6, "#a0603a");
    px(ctx, 12, 6, 2, 5, "#a0603a");
    px(ctx, 1, 3, 1, 10, "#6a4a2e");
    px(ctx, 0, 0, 4, 4, "#9aa3b2");
    px(ctx, 0, 0, 4, 1, "#c3cad6");
  },
  "guardiao-da-forja": (ctx) => {
    px(ctx, 8, 22, 6, 9, "#3a3431");
    px(ctx, 18, 22, 6, 9, "#3a3431");
    px(ctx, 5, 9, 22, 14, "#4a423e");
    px(ctx, 7, 8, 18, 1, "#5a514c");
    px(ctx, 10, 12, 1, 6, "#ff7a2e");
    px(ctx, 11, 17, 4, 1, "#ff7a2e");
    px(ctx, 20, 10, 1, 5, "#ff7a2e");
    px(ctx, 17, 14, 3, 1, "#ffb347");
    px(ctx, 14, 19, 1, 3, "#ff7a2e");
    px(ctx, 14, 12, 4, 4, "#ffb347");
    px(ctx, 15, 13, 2, 2, "#fff1a8");
    px(ctx, 10, 1, 12, 8, "#4a423e");
    px(ctx, 12, 4, 3, 2, "#ffd23c");
    px(ctx, 18, 4, 3, 2, "#ffd23c");
    px(ctx, 13, 7, 6, 1, "#ff7a2e");
    px(ctx, 8, 0, 2, 4, "#2a2422");
    px(ctx, 22, 0, 2, 4, "#2a2422");
    px(ctx, 0, 10, 5, 12, "#3a3431");
    px(ctx, 27, 10, 5, 12, "#3a3431");
    px(ctx, 0, 21, 6, 4, "#2a2422");
    px(ctx, 26, 21, 6, 4, "#2a2422");
    px(ctx, 1, 14, 1, 3, "#ff7a2e");
    px(ctx, 29, 15, 1, 2, "#ff7a2e");
    px(ctx, 7, 30, 8, 2, "#2a2422");
    px(ctx, 17, 30, 8, 2, "#2a2422");
  },
  // ---- 24/11/2026: as dungeons novas ----------------------------------------------
  "lobo-cinzento": (ctx) => wolf(ctx, "#7a7f8a", "#a3a8b2", "#4f535d", "#ffd23c"),
  "javali-bravo": (ctx) => {
    px(ctx, 3, 12, 2, 3, "#4a3224");
    px(ctx, 6, 12, 1, 2, "#3a2619");
    px(ctx, 10, 12, 1, 2, "#3a2619");
    px(ctx, 12, 12, 2, 3, "#4a3224");
    px(ctx, 3, 14, 2, 1, "#2a1c14");
    px(ctx, 12, 14, 2, 1, "#2a1c14");
    px(ctx, 4, 6, 11, 6, "#6b4a34");
    px(ctx, 5, 5, 9, 1, "#6b4a34");
    px(ctx, 6, 6, 5, 1, "#8a6448");
    px(ctx, 6, 11, 7, 1, "#8a6448");
    px(ctx, 6, 4, 7, 1, "#3a2619");
    for (const [x, h] of [[6, 2], [8, 3], [10, 2], [12, 2]] as const) px(ctx, x, 4 - h, 1, h, "#3a2619");
    px(ctx, 15, 6, 1, 2, "#4a3224");
    px(ctx, 1, 6, 5, 5, "#6b4a34");
    px(ctx, 1, 6, 2, 1, "#8a6448");
    px(ctx, 4, 4, 1, 2, "#3a2619");
    px(ctx, 3, 6, 2, 1, "#3a2619");
    px(ctx, 0, 8, 2, 3, "#b07a64");
    px(ctx, 0, 9, 1, 1, OUTLINE);
    px(ctx, 2, 8, 1, 2, "#efe6cf");
    px(ctx, 1, 7, 1, 1, "#efe6cf");
    px(ctx, 3, 7, 1, 1, "#e0574f");
  },
  "cacador-da-toca": (ctx) => {
    px(ctx, 6, 13, 2, 3, "#4a3224");
    px(ctx, 9, 13, 2, 3, "#4a3224");
    px(ctx, 11, 7, 2, 6, "#a08060");
    px(ctx, 11, 7, 2, 1, "#c0a080");
    px(ctx, 5, 8, 7, 5, "#8a5a34");
    px(ctx, 9, 8, 2, 5, "#6a4428");
    px(ctx, 5, 11, 7, 1, "#3b2a20");
    px(ctx, 5, 3, 6, 5, "#7fa04a");
    px(ctx, 6, 4, 3, 1, "#9ab866");
    px(ctx, 5, 2, 7, 2, "#6a4428");
    px(ctx, 6, 1, 5, 1, "#6a4428");
    px(ctx, 6, 1, 3, 1, "#8a5a34");
    px(ctx, 11, 0, 1, 2, "#d2473f");
    px(ctx, 3, 4, 2, 1, "#7fa04a");
    px(ctx, 2, 3, 1, 1, "#7fa04a");
    px(ctx, 6, 5, 1, 1, "#ffd23c");
    px(ctx, 8, 5, 1, 1, "#ffd23c");
    px(ctx, 6, 7, 3, 1, "#4a5a2a");
    px(ctx, 7, 7, 1, 1, "#e8e4d8");
    px(ctx, 1, 10, 13, 1, "#b9823f");
    px(ctx, 1, 9, 2, 3, "#c3cad6");
    px(ctx, 0, 10, 1, 1, "#e0e4ec");
    px(ctx, 4, 8, 2, 3, "#7fa04a");
    px(ctx, 4, 8, 1, 1, "#9ab866");
  },
  "rei-javali": (ctx) => {
    px(ctx, 8, 23, 4, 7, "#3a2619");
    px(ctx, 14, 24, 3, 5, "#2a1c14");
    px(ctx, 21, 24, 3, 5, "#2a1c14");
    px(ctx, 25, 23, 4, 7, "#3a2619");
    px(ctx, 7, 29, 5, 2, "#2a1c14");
    px(ctx, 24, 29, 5, 2, "#2a1c14");
    px(ctx, 9, 9, 22, 15, "#5e3f2c");
    px(ctx, 11, 7, 18, 2, "#5e3f2c");
    px(ctx, 11, 24, 17, 1, "#5e3f2c");
    px(ctx, 12, 20, 16, 3, "#7a5640");
    px(ctx, 12, 9, 9, 2, "#80593f");
    px(ctx, 11, 5, 18, 3, "#3a2619");
    for (const [x, h] of [[12, 2], [15, 4], [18, 5], [21, 4], [24, 3], [27, 2]] as const) px(ctx, x, 5 - h, 2, h, "#3a2619");
    for (const [x, h] of [[15, 2], [18, 3], [21, 2]] as const) px(ctx, x, 5 - h, 1, h, "#5e3f2c");
    for (const [x, y] of [[19, 13], [20, 14], [21, 15], [22, 16], [26, 12], [26, 13], [26, 14]] as const) px(ctx, x, y, 1, 1, "#a07a5e");
    px(ctx, 31, 10, 1, 4, "#3a2619");
    px(ctx, 10, 4, 3, 6, "#3a2619");
    px(ctx, 2, 10, 11, 12, "#6b4a34");
    px(ctx, 3, 11, 6, 1, "#8a6448");
    px(ctx, 9, 17, 4, 4, "#4a3224");
    px(ctx, 0, 16, 4, 6, "#b07a64");
    px(ctx, 0, 17, 1, 4, "#8a5a4a");
    px(ctx, 1, 17, 1, 1, OUTLINE);
    px(ctx, 1, 20, 1, 1, OUTLINE);
    px(ctx, 3, 22, 7, 1, "#2a1c14");
    px(ctx, 7, 18, 2, 3, "#d8ceb4");
    px(ctx, 8, 16, 1, 2, "#d8ceb4");
    px(ctx, 3, 19, 3, 3, "#efe6cf");
    px(ctx, 2, 16, 2, 3, "#efe6cf");
    px(ctx, 3, 14, 1, 2, "#efe6cf");
    px(ctx, 2, 16, 1, 3, "#fffaf0");
    px(ctx, 5, 11, 5, 1, "#2a1c14");
    px(ctx, 5, 12, 3, 2, "#ff5a3c");
    px(ctx, 6, 12, 1, 1, "#fff1a8");
    px(ctx, 2, 8, 7, 2, "#ffd23c");
    px(ctx, 2, 9, 7, 1, "#c9a020");
    px(ctx, 2, 6, 1, 2, "#ffd23c");
    px(ctx, 5, 5, 1, 3, "#ffd23c");
    px(ctx, 8, 6, 1, 2, "#ffd23c");
    px(ctx, 5, 8, 1, 1, "#e0574f");
  },
  "aranha-tecela": (ctx) => {
    const leg = "#2a1c3a";
    line(ctx, leg, 5, 9, 2, 6, 0, 11);
    line(ctx, leg, 5, 10, 2, 10, 1, 14);
    line(ctx, leg, 7, 10, 5, 12, 4, 15);
    line(ctx, leg, 9, 10, 9, 12, 8, 15);
    line(ctx, leg, 11, 9, 13, 11, 12, 15);
    line(ctx, leg, 12, 8, 15, 10, 15, 14);
    px(ctx, 11, 0, 1, 3, "#d8d4e4");
    px(ctx, 8, 4, 6, 6, "#5a3a78");
    px(ctx, 9, 3, 4, 1, "#5a3a78");
    px(ctx, 9, 10, 4, 1, "#5a3a78");
    px(ctx, 14, 5, 1, 4, "#5a3a78");
    px(ctx, 9, 4, 2, 1, "#7a56a0");
    px(ctx, 8, 5, 1, 2, "#7a56a0");
    px(ctx, 11, 5, 1, 4, "#d0b8f0");
    px(ctx, 10, 6, 3, 1, "#d0b8f0");
    px(ctx, 4, 8, 5, 3, "#3e2856");
    px(ctx, 5, 7, 3, 1, "#3e2856");
    px(ctx, 4, 8, 1, 1, "#ff5a3c");
    px(ctx, 5, 7, 1, 1, "#ff5a3c");
    px(ctx, 6, 8, 1, 1, "#ff5a3c");
    px(ctx, 3, 10, 1, 2, "#e8e4d8");
  },
  "aranha-saltadora": (ctx) => {
    const leg = "#4a4458";
    line(ctx, leg, 11, 9, 14, 10, 15, 14);
    line(ctx, leg, 9, 10, 11, 12, 11, 15);
    line(ctx, leg, 6, 10, 5, 12, 4, 15);
    for (const d of [0, 1]) line(ctx, leg, 4, 8 + d, 2, 6 + d, 1, 3 + d);
    for (const [x, y] of [[14, 11], [11, 13], [5, 12], [2, 5], [1, 4]] as const) px(ctx, x, y, 1, 1, "#f1f1f4");
    px(ctx, 9, 4, 6, 5, "#2e2a36");
    px(ctx, 10, 3, 4, 1, "#2e2a36");
    px(ctx, 10, 9, 4, 1, "#2e2a36");
    px(ctx, 10, 4, 2, 1, "#4a4456");
    px(ctx, 11, 6, 3, 1, "#f1f1f4");
    px(ctx, 10, 8, 1, 1, "#ff9a3a");
    px(ctx, 13, 8, 1, 1, "#ff9a3a");
    px(ctx, 3, 6, 7, 5, "#2e2a36");
    px(ctx, 4, 5, 5, 1, "#2e2a36");
    px(ctx, 4, 5, 4, 1, "#4a4456");
    px(ctx, 8, 7, 1, 2, "#ff9a3a");
    px(ctx, 3, 7, 2, 2, "#0e0c12");
    px(ctx, 5, 7, 2, 2, "#0e0c12");
    px(ctx, 3, 7, 1, 1, "#e8f4f0");
    px(ctx, 5, 7, 1, 1, "#e8f4f0");
    px(ctx, 3, 10, 2, 2, "#3ad0a0");
    px(ctx, 3, 10, 1, 1, "#a0ffe0");
  },
  "larva-gigante": (ctx) => {
    const body = "#d8cc98";
    const fold = "#a89c68";
    px(ctx, 4, 7, 4, 7, body);
    px(ctx, 5, 6, 2, 1, body);
    px(ctx, 8, 8, 3, 6, body);
    px(ctx, 11, 9, 2, 5, body);
    px(ctx, 13, 10, 2, 4, body);
    px(ctx, 15, 11, 1, 2, body);
    for (const [x, y, h] of [[7, 8, 6], [10, 9, 5], [12, 10, 4]] as const) px(ctx, x, y, 1, h, fold);
    px(ctx, 5, 13, 10, 1, fold);
    px(ctx, 5, 6, 2, 1, "#f0e8c0");
    px(ctx, 4, 7, 1, 2, "#f0e8c0");
    px(ctx, 8, 8, 2, 1, "#f0e8c0");
    px(ctx, 11, 9, 1, 1, "#f0e8c0");
    px(ctx, 13, 10, 1, 1, "#f0e8c0");
    for (const x of [5, 8, 11]) px(ctx, x, 14, 1, 1, "#8a6a3a");
    px(ctx, 1, 8, 4, 5, "#8a6a3a");
    px(ctx, 2, 8, 2, 1, "#a8844a");
    px(ctx, 2, 9, 1, 1, OUTLINE);
    px(ctx, 0, 11, 2, 1, "#3b2a20");
    px(ctx, 0, 12, 1, 1, "#3b2a20");
  },
  "rainha-aranha": (ctx) => {
    const leg = "#1e1426";
    for (const d of [0, 1]) {
      line(ctx, leg, 11 + d, 16, 6 + d, 8, 1 + d, 20);
      line(ctx, leg, 11 + d, 19, 5 + d, 15, 2 + d, 27);
      line(ctx, leg, 14 + d, 21, 11 + d, 25, 8 + d, 31);
      line(ctx, leg, 18 + d, 21, 19 + d, 26, 17 + d, 31);
      line(ctx, leg, 22 + d, 19, 26 + d, 22, 26 + d, 31);
      line(ctx, leg, 24 + d, 17, 29 + d, 13, 29 + d, 25);
    }
    for (const [x, y] of [[6, 8], [5, 15], [11, 25], [19, 26], [26, 22], [29, 13]] as const) px(ctx, x, y, 2, 1, "#6a3a8a");
    px(ctx, 16, 4, 14, 14, "#4a2a68");
    px(ctx, 18, 2, 10, 2, "#4a2a68");
    px(ctx, 18, 18, 10, 2, "#4a2a68");
    px(ctx, 15, 6, 1, 10, "#4a2a68");
    px(ctx, 30, 6, 1, 10, "#4a2a68");
    px(ctx, 17, 15, 13, 3, "#321c48");
    px(ctx, 18, 4, 5, 2, "#6a4490");
    px(ctx, 17, 6, 2, 3, "#6a4490");
    px(ctx, 22, 7, 4, 2, "#e0304a");
    px(ctx, 23, 9, 2, 2, "#e0304a");
    px(ctx, 22, 11, 4, 2, "#e0304a");
    px(ctx, 22, 7, 2, 1, "#ff6a7a");
    px(ctx, 7, 13, 10, 8, "#2e1c42");
    px(ctx, 8, 12, 8, 1, "#2e1c42");
    px(ctx, 9, 13, 5, 1, "#4a2e66");
    px(ctx, 7, 15, 2, 2, "#ff5a3c");
    px(ctx, 10, 14, 2, 2, "#ff5a3c");
    px(ctx, 7, 15, 1, 1, "#ffd0c0");
    px(ctx, 10, 14, 1, 1, "#ffd0c0");
    px(ctx, 8, 18, 1, 1, "#ff5a3c");
    px(ctx, 11, 17, 1, 1, "#ff5a3c");
    px(ctx, 13, 15, 1, 1, "#ff5a3c");
    px(ctx, 6, 20, 2, 3, "#9be03a");
    px(ctx, 10, 20, 2, 3, "#9be03a");
    px(ctx, 6, 24, 1, 1, "#c9f27a");
    px(ctx, 8, 10, 7, 2, "#ffd23c");
    px(ctx, 8, 8, 1, 2, "#ffd23c");
    px(ctx, 11, 7, 1, 3, "#ffd23c");
    px(ctx, 14, 8, 1, 2, "#ffd23c");
    px(ctx, 11, 10, 1, 1, "#e0304a");
  },
  "mineiro-espectral": (ctx) => {
    px(ctx, 2, 3, 1, 9, "#6a5e58");
    px(ctx, 0, 2, 5, 1, "#9aa3b2");
    px(ctx, 0, 3, 1, 1, "#9aa3b2");
    px(ctx, 4, 3, 1, 1, "#9aa3b2");
    px(ctx, 4, 8, 8, 3, "#7fb8d0");
    px(ctx, 5, 11, 7, 1, "#7fb8d0");
    px(ctx, 7, 12, 6, 1, "#4f84a0");
    px(ctx, 12, 11, 2, 1, "#4f84a0");
    px(ctx, 5, 8, 2, 1, "#c4ecf8");
    px(ctx, 10, 9, 2, 2, "#4f84a0");
    px(ctx, 2, 8, 3, 2, "#c4ecf8");
    px(ctx, 5, 4, 6, 4, "#7fb8d0");
    px(ctx, 6, 4, 3, 1, "#c4ecf8");
    px(ctx, 6, 5, 1, 2, OUTLINE);
    px(ctx, 8, 5, 1, 2, OUTLINE);
    px(ctx, 7, 7, 1, 1, "#4f84a0");
    px(ctx, 5, 1, 6, 3, "#c9a040");
    px(ctx, 6, 1, 3, 1, "#e8c060");
    px(ctx, 4, 3, 8, 1, "#8a6a2a");
    px(ctx, 5, 2, 1, 1, "#fff1a8");
  },
  "golem-de-carvao": (ctx) => {
    px(ctx, 5, 12, 3, 3, "#24242a");
    px(ctx, 9, 12, 3, 3, "#24242a");
    px(ctx, 4, 4, 9, 9, "#3a3a44");
    px(ctx, 5, 5, 3, 2, "#5e5e6c");
    px(ctx, 9, 7, 2, 2, "#5e5e6c");
    px(ctx, 6, 9, 2, 2, "#24242a");
    px(ctx, 10, 10, 2, 2, "#24242a");
    px(ctx, 5, 5, 1, 1, "#a8a8b8");
    px(ctx, 9, 7, 1, 1, "#a8a8b8");
    px(ctx, 8, 10, 1, 2, "#ff7a2e");
    px(ctx, 9, 9, 1, 1, "#ffb347");
    px(ctx, 5, 1, 5, 4, "#3a3a44");
    px(ctx, 6, 1, 2, 1, "#5e5e6c");
    px(ctx, 5, 3, 1, 1, "#ff7a2e");
    px(ctx, 7, 3, 1, 1, "#ff7a2e");
    px(ctx, 1, 5, 3, 5, "#3a3a44");
    px(ctx, 0, 9, 4, 4, "#24242a");
    px(ctx, 1, 9, 2, 1, "#5e5e6c");
    px(ctx, 13, 5, 2, 5, "#24242a");
    px(ctx, 12, 10, 4, 3, "#24242a");
    px(ctx, 13, 10, 2, 1, "#5e5e6c");
  },
  "morcego-vampiro": (ctx) => {
    for (const s of [0, 1]) {
      const x = (v: number, w: number) => (s ? 16 - v - w : v);
      px(ctx, x(0, 2), 1, 2, 1, "#5a1e2a");
      px(ctx, x(0, 3), 2, 3, 1, "#5a1e2a");
      px(ctx, x(1, 4), 3, 4, 1, "#5a1e2a");
      px(ctx, x(2, 4), 4, 4, 1, "#5a1e2a");
      px(ctx, x(3, 3), 5, 3, 1, "#5a1e2a");
      px(ctx, x(4, 2), 6, 2, 1, "#5a1e2a");
      px(ctx, x(0, 1), 3, 1, 2, "#5a1e2a");
      px(ctx, x(2, 1), 5, 1, 1, "#5a1e2a");
      px(ctx, x(2, 2), 3, 2, 1, "#8a2e3e");
      px(ctx, x(3, 2), 4, 2, 1, "#8a2e3e");
    }
    px(ctx, 6, 4, 4, 6, "#2a1418");
    px(ctx, 7, 6, 2, 2, "#3e2024");
    px(ctx, 6, 2, 1, 2, "#2a1418");
    px(ctx, 9, 2, 1, 2, "#2a1418");
    px(ctx, 6, 5, 1, 1, "#ffd23c");
    px(ctx, 8, 5, 1, 1, "#ffd23c");
    px(ctx, 6, 8, 1, 1, "#f1f1f4");
    px(ctx, 8, 8, 1, 1, "#f1f1f4");
    px(ctx, 6, 9, 1, 1, "#e0304a");
    px(ctx, 7, 10, 1, 1, "#2a1418");
    px(ctx, 9, 10, 1, 1, "#2a1418");
  },
  "capataz-espectral": (ctx) => {
    px(ctx, 28, 4, 2, 20, "#5e5450");
    px(ctx, 24, 2, 8, 2, "#9aa3b2");
    px(ctx, 24, 4, 1, 2, "#9aa3b2");
    px(ctx, 31, 4, 1, 2, "#9aa3b2");
    px(ctx, 25, 2, 4, 1, "#c3cad6");
    px(ctx, 7, 24, 18, 3, "#5fb8b0");
    px(ctx, 9, 27, 13, 2, "#3a7a80");
    px(ctx, 12, 29, 7, 1, "#24525a");
    px(ctx, 21, 27, 6, 1, "#3a7a80");
    px(ctx, 25, 28, 4, 1, "#24525a");
    px(ctx, 5, 17, 22, 7, "#5fb8b0");
    px(ctx, 6, 17, 5, 1, "#a8f0e8");
    px(ctx, 10, 17, 12, 7, "#3a7a80");
    px(ctx, 5, 22, 22, 1, "#24525a");
    px(ctx, 15, 22, 2, 1, "#d8a838");
    px(ctx, 26, 16, 4, 7, "#5fb8b0");
    px(ctx, 27, 15, 3, 3, "#a8f0e8");
    px(ctx, 2, 17, 4, 6, "#5fb8b0");
    px(ctx, 2, 17, 2, 1, "#a8f0e8");
    px(ctx, 1, 22, 4, 2, "#a8f0e8");
    px(ctx, 2, 24, 2, 1, "#3a3d4a");
    px(ctx, 1, 25, 4, 5, "#3a3d4a");
    px(ctx, 2, 26, 2, 3, "#bfffff");
    px(ctx, 2, 26, 1, 1, "#ffffff");
    px(ctx, 8, 9, 14, 8, "#5fb8b0");
    px(ctx, 9, 9, 8, 1, "#a8f0e8");
    px(ctx, 9, 10, 12, 1, "#24525a");
    px(ctx, 10, 11, 3, 2, "#e8fff8");
    px(ctx, 16, 11, 3, 2, "#e8fff8");
    px(ctx, 10, 11, 1, 1, "#2ee6ff");
    px(ctx, 16, 11, 1, 1, "#2ee6ff");
    px(ctx, 9, 14, 12, 2, "#d8f8f4");
    px(ctx, 10, 16, 10, 3, "#d8f8f4");
    px(ctx, 11, 18, 8, 2, "#b0e0d8");
    px(ctx, 13, 15, 4, 1, "#24525a");
    px(ctx, 10, 1, 10, 2, "#d8a838");
    px(ctx, 8, 3, 14, 5, "#d8a838");
    px(ctx, 11, 2, 5, 1, "#f0cc68");
    px(ctx, 6, 7, 18, 2, "#8a6a2a");
    px(ctx, 9, 3, 3, 3, "#fff1a8");
    px(ctx, 10, 4, 1, 1, "#ffffff");
  },
  basilisco: (ctx) => {
    px(ctx, 12, 9, 2, 3, "#5a7a4a");
    px(ctx, 14, 7, 1, 3, "#5a7a4a");
    px(ctx, 15, 5, 1, 3, "#5a7a4a");
    px(ctx, 4, 12, 2, 2, "#3a5030");
    px(ctx, 10, 12, 2, 2, "#3a5030");
    px(ctx, 3, 13, 1, 1, "#3a5030");
    px(ctx, 9, 13, 1, 1, "#3a5030");
    px(ctx, 4, 8, 9, 4, "#5a7a4a");
    px(ctx, 5, 8, 5, 1, "#7a9a5a");
    px(ctx, 5, 11, 7, 1, "#a8b878");
    for (const x of [6, 8, 10, 12]) px(ctx, x, 7, 1, 1, "#3a5030");
    px(ctx, 7, 9, 1, 1, "#3a5030");
    px(ctx, 10, 10, 1, 1, "#3a5030");
    px(ctx, 0, 6, 5, 4, "#5a7a4a");
    px(ctx, 1, 6, 3, 1, "#7a9a5a");
    px(ctx, 0, 9, 3, 1, "#3a5030");
    px(ctx, 1, 7, 2, 1, "#f0ff7a");
    px(ctx, 2, 7, 1, 1, "#fffbd0");
    px(ctx, 1, 3, 1, 3, "#d2473f");
    px(ctx, 2, 4, 1, 2, "#d2473f");
    px(ctx, 3, 3, 1, 3, "#d2473f");
    px(ctx, 1, 3, 1, 1, "#ff7a5a");
  },
  "ent-de-pedra": (ctx) => {
    px(ctx, 3, 14, 3, 2, "#55534c");
    px(ctx, 10, 14, 3, 2, "#55534c");
    px(ctx, 5, 4, 6, 11, "#7c7a72");
    px(ctx, 4, 12, 8, 3, "#7c7a72");
    px(ctx, 5, 4, 2, 8, "#a09e94");
    px(ctx, 9, 6, 1, 4, "#55534c");
    px(ctx, 7, 11, 1, 3, "#55534c");
    px(ctx, 2, 6, 3, 2, "#7c7a72");
    px(ctx, 1, 8, 2, 3, "#7c7a72");
    px(ctx, 0, 10, 1, 2, "#55534c");
    px(ctx, 11, 5, 3, 2, "#7c7a72");
    px(ctx, 13, 2, 2, 3, "#7c7a72");
    px(ctx, 4, 1, 2, 3, "#7c7a72");
    px(ctx, 7, 0, 2, 4, "#7c7a72");
    px(ctx, 10, 1, 2, 3, "#7c7a72");
    px(ctx, 3, 0, 3, 2, "#5a8a3a");
    px(ctx, 9, 0, 4, 2, "#5a8a3a");
    px(ctx, 10, 0, 2, 1, "#7ab04a");
    px(ctx, 13, 1, 2, 1, "#5a8a3a");
    px(ctx, 2, 6, 2, 1, "#5a8a3a");
    px(ctx, 6, 13, 3, 1, "#5a8a3a");
    px(ctx, 5, 6, 1, 1, "#c9f27a");
    px(ctx, 7, 6, 1, 1, "#c9f27a");
    px(ctx, 5, 9, 3, 1, OUTLINE);
  },
  "harpia-de-granito": (ctx) => {
    for (const s of [0, 1]) {
      const x = (v: number, w: number) => (s ? 16 - v - w : v);
      px(ctx, x(1, 4), 1, 4, 2, "#b4aca6");
      px(ctx, x(0, 6), 3, 6, 2, "#8a8480");
      px(ctx, x(0, 1), 5, 1, 2, "#8a8480");
      px(ctx, x(2, 1), 5, 1, 2, "#8a8480");
      px(ctx, x(4, 2), 5, 2, 2, "#8a8480");
      px(ctx, x(2, 1), 3, 1, 1, "#c8a098");
    }
    px(ctx, 6, 5, 4, 5, "#8a8480");
    px(ctx, 6, 6, 2, 2, "#b4aca6");
    px(ctx, 8, 8, 1, 1, "#c8a098");
    px(ctx, 9, 6, 1, 1, "#5a5452");
    px(ctx, 6, 1, 4, 4, "#b8b0a8");
    px(ctx, 7, 0, 4, 1, "#4a4446");
    px(ctx, 10, 1, 1, 5, "#4a4446");
    px(ctx, 6, 2, 1, 1, "#2ee6ff");
    px(ctx, 8, 2, 1, 1, "#2ee6ff");
    px(ctx, 7, 4, 1, 1, "#5a5452");
    px(ctx, 6, 10, 1, 1, "#5a5452");
    px(ctx, 9, 10, 1, 1, "#5a5452");
    px(ctx, 5, 11, 2, 1, "#d8c890");
    px(ctx, 9, 11, 2, 1, "#d8c890");
  },
  "medusa-ancia": (ctx) => {
    px(ctx, 26, 18, 4, 8, "#4a7a4a");
    px(ctx, 28, 13, 3, 6, "#4a7a4a");
    px(ctx, 30, 10, 1, 4, "#4a7a4a");
    px(ctx, 27, 19, 1, 5, "#6a9a5a");
    px(ctx, 6, 24, 22, 6, "#4a7a4a");
    px(ctx, 8, 30, 18, 2, "#4a7a4a");
    px(ctx, 8, 27, 18, 2, "#c8c890");
    px(ctx, 7, 24, 8, 1, "#6a9a5a");
    for (const x of [10, 14, 18, 22]) px(ctx, x, 25, 2, 1, "#2f5a2f");
    px(ctx, 11, 20, 10, 5, "#4a7a4a");
    px(ctx, 13, 21, 6, 3, "#c8c890");
    const snake = (hx: number, hy: number, ...pts: number[]) => {
      line(ctx, "#2d7336", ...pts.map((v, i) => (i % 2 ? v : v + 1)));
      line(ctx, "#3f9c4a", ...pts);
      px(ctx, hx, hy, 3, 2, "#3f9c4a");
      px(ctx, hx + 1, hy, 1, 1, "#e0574f");
    };
    snake(5, 0, 11, 6, 9, 4, 8, 1);
    snake(12, 0, 14, 4, 13, 2, 13, 1);
    snake(21, 0, 18, 4, 20, 2, 22, 1);
    snake(24, 3, 20, 6, 23, 6, 25, 4);
    snake(4, 9, 11, 8, 8, 9, 6, 10);
    snake(23, 11, 20, 9, 23, 10, 24, 12);
    px(ctx, 11, 12, 10, 9, "#9ab08a");
    px(ctx, 12, 12, 4, 1, "#bcd0a8");
    px(ctx, 11, 15, 10, 2, "#ffd23c");
    px(ctx, 15, 15, 2, 1, "#e0574f");
    px(ctx, 21, 13, 2, 6, "#6a8060");
    px(ctx, 5, 13, 6, 2, "#9ab08a");
    px(ctx, 3, 12, 2, 4, "#9ab08a");
    px(ctx, 2, 12, 1, 1, "#e8e4d8");
    px(ctx, 2, 15, 1, 1, "#e8e4d8");
    px(ctx, 11, 4, 9, 8, "#9ab08a");
    px(ctx, 12, 4, 5, 1, "#bcd0a8");
    px(ctx, 12, 7, 2, 1, "#f0ff7a");
    px(ctx, 16, 7, 2, 1, "#f0ff7a");
    px(ctx, 12, 8, 2, 1, "#6a8060");
    px(ctx, 16, 8, 2, 1, "#6a8060");
    px(ctx, 13, 10, 4, 1, "#4a5a40");
    px(ctx, 11, 3, 9, 1, "#ffd23c");
    px(ctx, 15, 2, 1, 1, "#e0574f");
  },
  "cavaleiro-de-cinzas": (ctx) => {
    px(ctx, 11, 6, 2, 8, "#7a1e1e");
    px(ctx, 12, 14, 1, 1, "#7a1e1e");
    px(ctx, 5, 12, 2, 3, "#2e2a2c");
    px(ctx, 9, 12, 2, 3, "#2e2a2c");
    px(ctx, 4, 14, 3, 1, "#4a4448");
    px(ctx, 9, 14, 3, 1, "#4a4448");
    px(ctx, 4, 7, 8, 6, "#4a4448");
    px(ctx, 5, 7, 3, 1, "#6e686c");
    px(ctx, 4, 11, 8, 1, "#2e2a2c");
    px(ctx, 8, 9, 1, 2, "#ff7a2e");
    px(ctx, 9, 8, 1, 1, "#ff7a2e");
    px(ctx, 5, 2, 6, 5, "#4a4448");
    px(ctx, 6, 2, 3, 1, "#6e686c");
    px(ctx, 5, 4, 4, 1, "#ff7a2e");
    px(ctx, 5, 4, 1, 1, "#ffd23c");
    px(ctx, 8, 0, 3, 2, "#b0302a");
    px(ctx, 11, 1, 2, 2, "#b0302a");
    px(ctx, 12, 3, 1, 1, "#7a1e1e");
    px(ctx, 2, 1, 1, 8, "#a8a09a");
    px(ctx, 1, 2, 1, 6, "#ff7a2e");
    px(ctx, 2, 0, 1, 1, "#ffb347");
    px(ctx, 0, 9, 5, 1, "#2e2a2c");
    px(ctx, 3, 8, 2, 2, "#6e686c");
    px(ctx, 2, 10, 2, 2, "#6e686c");
    px(ctx, 2, 12, 1, 1, "#ff7a2e");
  },
  "demonio-menor": (ctx) => {
    px(ctx, 10, 3, 5, 4, "#5a1418");
    px(ctx, 12, 1, 3, 2, "#5a1418");
    px(ctx, 15, 2, 1, 4, "#5a1418");
    px(ctx, 11, 7, 1, 1, "#5a1418");
    px(ctx, 13, 7, 1, 1, "#5a1418");
    px(ctx, 11, 4, 1, 3, "#8a2a2e");
    px(ctx, 13, 3, 1, 4, "#8a2a2e");
    px(ctx, 11, 11, 3, 1, "#7a1e24");
    px(ctx, 14, 10, 1, 2, "#7a1e24");
    px(ctx, 13, 8, 3, 2, "#7a1e24");
    px(ctx, 5, 12, 2, 2, "#7a1e24");
    px(ctx, 8, 12, 2, 2, "#7a1e24");
    px(ctx, 4, 14, 2, 1, "#2a1a1a");
    px(ctx, 8, 14, 2, 1, "#2a1a1a");
    px(ctx, 4, 7, 7, 5, "#c0383a");
    px(ctx, 5, 8, 3, 2, "#e0574f");
    px(ctx, 3, 2, 6, 5, "#c0383a");
    px(ctx, 4, 2, 3, 1, "#e0574f");
    px(ctx, 3, 0, 1, 2, "#e8dcc0");
    px(ctx, 2, 0, 1, 1, "#e8dcc0");
    px(ctx, 7, 0, 1, 2, "#e8dcc0");
    px(ctx, 8, 0, 1, 1, "#e8dcc0");
    px(ctx, 3, 4, 1, 1, "#ffd23c");
    px(ctx, 5, 4, 1, 1, "#ffd23c");
    px(ctx, 3, 6, 4, 1, "#5a1418");
    px(ctx, 4, 6, 1, 1, "#f1f1f4");
    px(ctx, 6, 6, 1, 1, "#f1f1f4");
    px(ctx, 2, 8, 2, 2, "#c0383a");
    px(ctx, 1, 9, 1, 2, "#2a1a1a");
  },
  salamandra: (ctx) => {
    px(ctx, 12, 10, 2, 2, "#e86a2a");
    px(ctx, 13, 8, 2, 2, "#e86a2a");
    px(ctx, 14, 6, 1, 2, "#e86a2a");
    px(ctx, 14, 3, 2, 3, "#ffd23c");
    px(ctx, 15, 2, 1, 1, "#ff7a2e");
    px(ctx, 14, 4, 1, 1, "#fff1a8");
    px(ctx, 4, 12, 2, 2, "#a8401a");
    px(ctx, 10, 12, 2, 2, "#a8401a");
    px(ctx, 3, 13, 1, 1, "#a8401a");
    px(ctx, 9, 13, 1, 1, "#a8401a");
    px(ctx, 4, 9, 9, 3, "#e86a2a");
    px(ctx, 5, 11, 7, 1, "#ffb347");
    px(ctx, 6, 9, 1, 1, "#ffd23c");
    px(ctx, 9, 10, 1, 1, "#ffd23c");
    px(ctx, 11, 9, 1, 1, "#ffd23c");
    px(ctx, 6, 8, 1, 1, "#ff5a3c");
    px(ctx, 8, 7, 1, 2, "#ffb347");
    px(ctx, 10, 8, 1, 1, "#ff5a3c");
    px(ctx, 3, 6, 3, 4, "#e86a2a");
    px(ctx, 0, 4, 5, 3, "#e86a2a");
    px(ctx, 1, 4, 3, 1, "#ff9a4a");
    px(ctx, 2, 5, 1, 1, OUTLINE);
    px(ctx, 0, 6, 2, 1, "#a8401a");
  },
  "senhor-das-cinzas": (ctx) => {
    px(ctx, 6, 10, 22, 19, "#6a1a1a");
    px(ctx, 7, 29, 4, 2, "#6a1a1a");
    px(ctx, 22, 29, 5, 2, "#6a1a1a");
    px(ctx, 25, 12, 2, 14, "#9a2a2a");
    px(ctx, 10, 24, 5, 6, "#221c1e");
    px(ctx, 18, 24, 5, 6, "#221c1e");
    px(ctx, 9, 29, 6, 2, "#3a3234");
    px(ctx, 18, 29, 6, 2, "#3a3234");
    px(ctx, 9, 11, 15, 13, "#3a3234");
    px(ctx, 10, 11, 6, 2, "#5a5052");
    px(ctx, 9, 21, 15, 2, "#221c1e");
    px(ctx, 15, 14, 1, 6, "#ff7a2e");
    px(ctx, 16, 17, 3, 1, "#ff7a2e");
    px(ctx, 12, 19, 3, 1, "#ff7a2e");
    px(ctx, 14, 15, 3, 2, "#ffd23c");
    px(ctx, 15, 15, 1, 1, "#fff1a8");
    px(ctx, 5, 9, 6, 5, "#3a3234");
    px(ctx, 22, 9, 6, 5, "#3a3234");
    px(ctx, 5, 9, 6, 1, "#5a5052");
    px(ctx, 22, 9, 6, 1, "#5a5052");
    px(ctx, 5, 13, 6, 1, "#ff7a2e");
    px(ctx, 22, 13, 6, 1, "#ff7a2e");
    px(ctx, 5, 7, 2, 2, "#1a1416");
    px(ctx, 26, 7, 2, 2, "#1a1416");
    px(ctx, 24, 14, 4, 8, "#3a3234");
    px(ctx, 24, 21, 4, 3, "#221c1e");
    px(ctx, 2, 3, 2, 19, "#4a4042");
    px(ctx, 1, 4, 1, 17, "#ff7a2e");
    px(ctx, 2, 2, 1, 1, "#ffb347");
    px(ctx, 0, 22, 6, 2, "#1a1416");
    px(ctx, 2, 24, 2, 4, "#6a1a1a");
    px(ctx, 2, 28, 2, 1, "#ff7a2e");
    px(ctx, 5, 14, 3, 10, "#3a3234");
    px(ctx, 2, 24, 4, 3, "#5a5052");
    px(ctx, 11, 3, 10, 8, "#3a3234");
    px(ctx, 12, 3, 5, 1, "#5a5052");
    px(ctx, 12, 6, 8, 4, "#221c1e");
    px(ctx, 12, 6, 3, 1, "#fff1a8");
    px(ctx, 17, 6, 3, 1, "#fff1a8");
    px(ctx, 12, 7, 3, 1, "#ff7a2e");
    px(ctx, 17, 7, 3, 1, "#ff7a2e");
    px(ctx, 14, 9, 4, 1, "#ff7a2e");
    px(ctx, 8, 3, 3, 2, "#1a1416");
    px(ctx, 6, 0, 3, 4, "#1a1416");
    px(ctx, 6, 0, 1, 2, "#4a4042");
    px(ctx, 21, 3, 3, 2, "#1a1416");
    px(ctx, 23, 0, 3, 4, "#1a1416");
    px(ctx, 23, 0, 1, 2, "#4a4042");
    px(ctx, 12, 1, 8, 2, "#ff7a2e");
    px(ctx, 13, 0, 1, 2, "#ffb347");
    px(ctx, 16, 0, 1, 2, "#ffd23c");
    px(ctx, 18, 0, 1, 1, "#ffb347");
    px(ctx, 14, 1, 1, 1, "#fff1a8");
  },
  "lobo-glacial": (ctx) => {
    wolf(ctx, "#d6e2ee", "#f4f8fc", "#8aa4c0", "#2ee6ff");
    for (const x of [6, 9, 12]) {
      px(ctx, x, 5, 2, 2, "#8fd0e8");
      px(ctx, x, 4, 1, 1, "#e8f8ff");
    }
  },
  "gigante-de-gelo": (ctx) => {
    px(ctx, 4, 12, 3, 4, "#4a72a0");
    px(ctx, 9, 12, 3, 4, "#4a72a0");
    px(ctx, 3, 5, 10, 7, "#6a9ac8");
    px(ctx, 4, 5, 4, 1, "#9ac0e0");
    px(ctx, 10, 6, 3, 5, "#4a72a0");
    px(ctx, 7, 8, 1, 3, "#4a72a0");
    px(ctx, 4, 11, 8, 2, "#8a7a6a");
    px(ctx, 4, 11, 8, 1, "#6a5a4a");
    px(ctx, 13, 5, 2, 6, "#6a9ac8");
    px(ctx, 13, 10, 3, 2, "#4a72a0");
    px(ctx, 10, 3, 4, 2, "#c8f0ff");
    px(ctx, 12, 2, 1, 1, "#c8f0ff");
    px(ctx, 10, 3, 2, 1, "#ffffff");
    px(ctx, 5, 1, 5, 4, "#6a9ac8");
    px(ctx, 5, 0, 6, 1, "#e8f4ff");
    px(ctx, 10, 1, 1, 3, "#e8f4ff");
    px(ctx, 5, 1, 3, 1, "#e8f4ff");
    px(ctx, 5, 2, 1, 1, OUTLINE);
    px(ctx, 7, 2, 1, 1, OUTLINE);
    px(ctx, 4, 4, 5, 3, "#e8f4ff");
    px(ctx, 5, 6, 3, 1, "#b8d4ec");
    px(ctx, 2, 6, 2, 4, "#6a9ac8");
    px(ctx, 1, 4, 1, 5, "#6a4a2e");
    px(ctx, 0, 0, 3, 4, "#c8f0ff");
    px(ctx, 0, 0, 1, 3, "#ffffff");
    px(ctx, 1, 8, 2, 2, "#9ac0e0");
  },
  "espirito-da-nevasca": (ctx) => {
    px(ctx, 5, 1, 6, 5, "#a8d8f0");
    px(ctx, 6, 1, 3, 1, "#e6f6ff");
    for (const x of [5, 7, 9]) px(ctx, x, 0, 1, 1, "#e6f6ff");
    px(ctx, 6, 3, 1, 2, "#1a2a5a");
    px(ctx, 8, 3, 1, 2, "#1a2a5a");
    px(ctx, 5, 6, 6, 3, "#a8d8f0");
    px(ctx, 5, 6, 2, 1, "#e6f6ff");
    px(ctx, 2, 6, 3, 1, "#a8d8f0");
    px(ctx, 1, 5, 2, 1, "#e6f6ff");
    px(ctx, 0, 4, 1, 1, "#e6f6ff");
    px(ctx, 11, 6, 3, 1, "#a8d8f0");
    px(ctx, 13, 5, 2, 1, "#e6f6ff");
    px(ctx, 6, 9, 5, 1, "#6aa8d8");
    px(ctx, 9, 10, 4, 1, "#6aa8d8");
    px(ctx, 12, 9, 2, 1, "#a8d8f0");
    px(ctx, 13, 8, 1, 1, "#e6f6ff");
    px(ctx, 13, 0, 1, 3, "#e6f6ff");
    px(ctx, 12, 1, 3, 1, "#e6f6ff");
    px(ctx, 2, 9, 1, 3, "#e6f6ff");
    px(ctx, 1, 10, 3, 1, "#e6f6ff");
  },
  "wyrm-de-gelo": (ctx) => {
    px(ctx, 28, 15, 3, 8, "#7ab8e0");
    px(ctx, 29, 10, 2, 5, "#7ab8e0");
    px(ctx, 30, 6, 1, 4, "#4a88b8");
    px(ctx, 31, 11, 1, 2, "#c8f0ff");
    px(ctx, 31, 16, 1, 2, "#c8f0ff");
    px(ctx, 12, 14, 18, 14, "#7ab8e0");
    px(ctx, 14, 25, 14, 2, "#e8f4ff");
    px(ctx, 12, 27, 4, 3, "#4a88b8");
    px(ctx, 11, 30, 6, 2, "#2a5a88");
    px(ctx, 23, 27, 4, 3, "#4a88b8");
    px(ctx, 22, 30, 6, 2, "#2a5a88");
    px(ctx, 21, 1, 2, 3, "#4a88b8");
    px(ctx, 19, 3, 7, 3, "#a8d0ec");
    px(ctx, 17, 6, 11, 4, "#a8d0ec");
    px(ctx, 16, 10, 13, 5, "#a8d0ec");
    for (const x of [16, 21, 26]) px(ctx, x, 15, 3, 2, "#a8d0ec");
    px(ctx, 19, 3, 2, 1, "#d8f0ff");
    px(ctx, 17, 6, 2, 1, "#d8f0ff");
    line(ctx, "#4a88b8", 22, 2, 17, 15);
    line(ctx, "#4a88b8", 22, 2, 22, 15);
    line(ctx, "#4a88b8", 22, 2, 28, 14);
    px(ctx, 8, 12, 7, 11, "#7ab8e0");
    px(ctx, 8, 14, 2, 9, "#e8f4ff");
    px(ctx, 10, 12, 3, 1, "#b8e0f8");
    for (const [x, y] of [[13, 10], [14, 13]] as const) {
      px(ctx, x, y, 2, 2, "#c8f0ff");
      px(ctx, x + 1, y - 1, 1, 1, "#e8f8ff");
    }
    px(ctx, 1, 6, 12, 6, "#7ab8e0");
    px(ctx, 0, 8, 2, 3, "#7ab8e0");
    px(ctx, 2, 6, 7, 1, "#b8e0f8");
    px(ctx, 1, 12, 9, 1, "#1e3a5a");
    px(ctx, 1, 13, 9, 2, "#4a88b8");
    for (const x of [2, 5, 8]) px(ctx, x, 12, 1, 1, "#f1f1f4");
    px(ctx, 5, 7, 4, 1, "#2a5a88");
    px(ctx, 6, 8, 2, 1, "#2ee6ff");
    px(ctx, 6, 8, 1, 1, "#ffffff");
    px(ctx, 10, 3, 2, 4, "#e8f8ff");
    px(ctx, 12, 1, 2, 4, "#c8f0ff");
    px(ctx, 1, 9, 1, 1, OUTLINE);
  },
  "arauto-do-vazio": (ctx) => {
    px(ctx, 3, 11, 10, 4, "#3a2458");
    px(ctx, 4, 6, 8, 5, "#3a2458");
    px(ctx, 11, 7, 1, 7, "#24163a");
    px(ctx, 3, 14, 10, 1, "#a070e0");
    px(ctx, 4, 15, 2, 1, "#3a2458");
    px(ctx, 8, 15, 3, 1, "#3a2458");
    px(ctx, 6, 7, 1, 7, "#a070e0");
    px(ctx, 4, 1, 7, 6, "#3a2458");
    px(ctx, 8, 0, 3, 1, "#3a2458");
    px(ctx, 11, 1, 1, 3, "#3a2458");
    px(ctx, 5, 1, 3, 1, "#5a3a80");
    px(ctx, 4, 3, 4, 3, "#0c0a14");
    px(ctx, 4, 4, 1, 1, "#e070ff");
    px(ctx, 6, 4, 1, 1, "#e070ff");
    px(ctx, 1, 3, 1, 12, "#4a3a5a");
    px(ctx, 0, 1, 3, 1, "#c8a0ff");
    px(ctx, 1, 0, 1, 1, "#f0e0ff");
    px(ctx, 1, 2, 1, 1, "#c8a0ff");
    px(ctx, 2, 7, 3, 3, "#3a2458");
    px(ctx, 1, 8, 2, 2, "#5a3a80");
  },
  devorador: (ctx) => {
    px(ctx, 4, 15, 2, 1, "#22102e");
    px(ctx, 9, 15, 2, 1, "#22102e");
    px(ctx, 3, 2, 11, 12, "#3a1e4a");
    px(ctx, 4, 1, 9, 1, "#3a1e4a");
    px(ctx, 2, 4, 1, 8, "#3a1e4a");
    px(ctx, 14, 4, 1, 8, "#3a1e4a");
    px(ctx, 4, 14, 9, 1, "#3a1e4a");
    px(ctx, 5, 2, 5, 1, "#5a3470");
    px(ctx, 4, 3, 2, 2, "#5a3470");
    px(ctx, 11, 11, 3, 3, "#22102e");
    px(ctx, 1, 6, 8, 6, "#0c0610");
    px(ctx, 1, 6, 8, 1, "#a0205a");
    px(ctx, 1, 11, 8, 1, "#a0205a");
    for (const x of [2, 4, 6, 8]) px(ctx, x, 7, 1, 1, "#e8e4d8");
    for (const x of [1, 3, 5, 7]) px(ctx, x, 10, 1, 1, "#e8e4d8");
    px(ctx, 3, 9, 3, 1, "#c0307a");
    for (const [x, y] of [[5, 4], [8, 3], [11, 5], [12, 2], [10, 8]] as const) px(ctx, x, y, 1, 1, "#ff6ad5");
  },
  "sombra-vazia": (ctx) => {
    px(ctx, 5, 2, 7, 8, "#140e22");
    px(ctx, 6, 1, 4, 1, "#7a4ab8");
    px(ctx, 5, 2, 1, 7, "#4a2a78");
    px(ctx, 12, 4, 1, 4, "#140e22");
    px(ctx, 2, 5, 3, 2, "#140e22");
    px(ctx, 2, 5, 3, 1, "#4a2a78");
    px(ctx, 0, 4, 2, 1, "#7a4ab8");
    px(ctx, 0, 6, 2, 1, "#7a4ab8");
    px(ctx, 5, 10, 2, 2, "#140e22");
    px(ctx, 8, 10, 2, 1, "#140e22");
    px(ctx, 11, 10, 2, 2, "#140e22");
    px(ctx, 12, 8, 2, 2, "#140e22");
    px(ctx, 6, 3, 1, 1, "#f1f1f4");
    px(ctx, 8, 3, 1, 1, "#f1f1f4");
    px(ctx, 8, 6, 1, 1, "#e0c8ff");
    px(ctx, 10, 4, 1, 1, "#e0c8ff");
    px(ctx, 9, 8, 1, 1, "#e0c8ff");
    px(ctx, 11, 7, 1, 1, "#b080f0");
  },
  "imperador-do-vazio": (ctx) => {
    px(ctx, 5, 11, 23, 20, "#0e0a18");
    px(ctx, 5, 11, 1, 20, "#a070e0");
    px(ctx, 27, 11, 1, 20, "#4a2a78");
    for (const [x, y] of [[8, 22], [24, 19], [10, 28], [25, 27], [7, 16], [22, 29], [26, 14]] as const) px(ctx, x, y, 1, 1, "#e0c8ff");
    px(ctx, 11, 25, 4, 6, "#140e20");
    px(ctx, 17, 25, 4, 6, "#140e20");
    px(ctx, 10, 11, 12, 14, "#241a36");
    px(ctx, 11, 11, 5, 2, "#3e2e5a");
    px(ctx, 13, 15, 6, 1, "#d090ff");
    px(ctx, 13, 19, 6, 1, "#d090ff");
    px(ctx, 13, 16, 1, 3, "#d090ff");
    px(ctx, 18, 16, 1, 3, "#d090ff");
    px(ctx, 14, 16, 4, 3, "#05030a");
    px(ctx, 15, 17, 1, 1, "#f0e0ff");
    px(ctx, 10, 22, 12, 2, "#140e20");
    px(ctx, 15, 22, 2, 2, "#a070e0");
    px(ctx, 5, 9, 6, 5, "#241a36");
    px(ctx, 21, 9, 6, 5, "#241a36");
    px(ctx, 5, 9, 6, 1, "#3e2e5a");
    px(ctx, 21, 9, 6, 1, "#3e2e5a");
    px(ctx, 5, 13, 6, 1, "#a070e0");
    px(ctx, 21, 13, 6, 1, "#a070e0");
    px(ctx, 6, 6, 2, 3, "#b080f0");
    px(ctx, 24, 6, 2, 3, "#b080f0");
    px(ctx, 6, 6, 1, 1, "#f0e0ff");
    px(ctx, 24, 6, 1, 1, "#f0e0ff");
    px(ctx, 23, 14, 4, 9, "#241a36");
    px(ctx, 23, 22, 4, 3, "#3e2e5a");
    px(ctx, 3, 7, 1, 23, "#3e2e5a");
    px(ctx, 5, 14, 4, 4, "#241a36");
    px(ctx, 2, 16, 4, 3, "#3e2e5a");
    px(ctx, 1, 1, 5, 5, "#05030a");
    px(ctx, 1, 1, 5, 1, "#d090ff");
    px(ctx, 1, 5, 5, 1, "#d090ff");
    px(ctx, 1, 2, 1, 3, "#d090ff");
    px(ctx, 5, 2, 1, 3, "#d090ff");
    px(ctx, 3, 3, 1, 1, "#f0e0ff");
    px(ctx, 3, 6, 1, 1, "#a070e0");
    px(ctx, 11, 4, 10, 7, "#241a36");
    px(ctx, 12, 4, 5, 1, "#3e2e5a");
    px(ctx, 12, 6, 8, 4, "#05030a");
    px(ctx, 13, 7, 2, 1, "#f0e0ff");
    px(ctx, 17, 7, 2, 1, "#f0e0ff");
    px(ctx, 13, 8, 2, 1, "#a070e0");
    px(ctx, 17, 8, 2, 1, "#a070e0");
    px(ctx, 11, 1, 1, 2, "#b080f0");
    px(ctx, 14, 0, 1, 3, "#f0e0ff");
    px(ctx, 17, 0, 1, 3, "#f0e0ff");
    px(ctx, 20, 1, 1, 2, "#b080f0");
    px(ctx, 28, 3, 2, 3, "#b080f0");
    px(ctx, 28, 3, 1, 1, "#f0e0ff");
    px(ctx, 29, 24, 1, 2, "#b080f0");
  },
};

/** Monstro sem desenho próprio (conteúdo novo antes da arte): uma criatura com a cor do nome. */
function generic(ctx: Ctx, id: string, s: number) {
  const hue = hash(id) % 360;
  const body = `hsl(${hue} 45% 45%)`;
  const k = s / 16;
  px(ctx, 3 * k, 5 * k, 10 * k, 9 * k, body);
  px(ctx, 4 * k, 4 * k, 8 * k, 1 * k, `hsl(${hue} 45% 55%)`);
  px(ctx, 4 * k, 7 * k, 2 * k, 2 * k, "#f1f1f4");
  px(ctx, 9 * k, 7 * k, 2 * k, 2 * k, "#f1f1f4");
  px(ctx, 4 * k, 8 * k, 1 * k, 1 * k, OUTLINE);
  px(ctx, 9 * k, 8 * k, 1 * k, 1 * k, OUTLINE);
  px(ctx, 5 * k, 11 * k, 6 * k, 1 * k, `hsl(${hue} 45% 30%)`);
  px(ctx, 4 * k, 14 * k, 3 * k, 2 * k, `hsl(${hue} 45% 30%)`);
  px(ctx, 9 * k, 14 * k, 3 * k, 2 * k, `hsl(${hue} 45% 30%)`);
}

export function monsterCanvas(id: string, boss: boolean): HTMLCanvasElement {
  const s = monsterSize(id, boss);
  const { c, ctx } = canvas(s, s);
  const like = likeOf(id);
  const paint = MONSTERS[like];
  if (paint && (s === 32) === BIG.has(like)) paint(ctx);
  else generic(ctx, like, s);
  outline(c);
  if (FLYING.has(like) && s === 16) px(ctx, 5, 14, 6, 1, "rgba(0, 0, 0, 0.35)");
  return c;
}

/** O que voa ou flutua (16 px, desenho acaba na linha 12): ganha a sombra no chão. */
const FLYING = new Set(["morcego-da-cripta", "morcego-vampiro", "mineiro-espectral", "harpia-de-granito", "espirito-da-nevasca", "sombra-vazia"]);

/** Sem poça: o que não sangra. */
const DRY = new Set([
  "ossada-inquieta", "automato-de-ferro", "brasa-viva", "guardiao-da-forja", "mineiro-espectral", "golem-de-carvao",
  "capataz-espectral", "ent-de-pedra", "harpia-de-granito", "cavaleiro-de-cinzas", "senhor-das-cinzas",
  "espirito-da-nevasca", "arauto-do-vazio", "sombra-vazia", "imperador-do-vazio",
]);
const POOL: Record<string, string> = {
  "serpente-da-comporta": "#1f5f80",
  "rei-das-comportas": "#1f5f80",
  "troll-do-lodo": "#4f5c2a",
  "matriarca-do-musgo": "#2d7336",
  "aranha-tecela": "#3f5a24",
  "aranha-saltadora": "#3f5a24",
  "larva-gigante": "#7a8a2a",
  "rainha-aranha": "#3f5a24",
  salamandra: "#8a3a14",
  "demonio-menor": "#3a0c14",
  devorador: "#3a1a5a",
};

/** O corpo do monstro: achatado, escuro, numa poça (o saco de loot cai por cima). */
export function corpseCanvas(id: string, body: HTMLCanvasElement): HTMLCanvasElement {
  const s = body.width;
  const { c, ctx } = canvas(s, s);
  const like = likeOf(id);
  if (!DRY.has(like)) {
    ctx.fillStyle = POOL[like] ?? "#5a1e24";
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(s / 2, s - s * 0.16, s * 0.42, s * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const h = Math.round(s * 0.45);
  ctx.drawImage(body, 0, 0, s, s, 0, s - h - Math.round(s * 0.08), s, h);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "rgba(24, 14, 20, 0.5)";
  ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = "source-over";
  return c;
}

// ---- salas -------------------------------------------------------------------

interface Theme {
  floor: readonly [string, string];
  grout: string;
  wall: string;
  wallDark: string;
  lip: string;
  /** Enfeites da parede e do chão, sorteados pela semente da sala. */
  deco: (ctx: Ctx, rnd: () => number, st: number) => void;
}

const FLOOR_Y = TILE;
const SIDE = 4;

function torch(ctx: Ctx, x: number, glow: string) {
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(x + 1, 8, 9, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  px(ctx, x, 7, 3, 5, "#6a4a2e");
  px(ctx, x, 4, 3, 3, "#ffb347");
  px(ctx, x + 1, 3, 1, 2, "#fff1a8");
}

/** Um ponto do chão longe da parede e das portas. */
function floorPoint(rnd: () => number): [number, number] {
  return [SIDE + 6 + Math.floor(rnd() * (SCENE_W - 2 * SIDE - 18)), FLOOR_Y + 6 + Math.floor(rnd() * (SCENE_H - FLOOR_Y - 16))];
}

/** Um halo meio transparente (luz, névoa, brilho). */
function glow(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, a: number) {
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Samambaia com a base em (x, y). */
function fern(ctx: Ctx, x: number, y: number) {
  px(ctx, x + 3, y - 6, 1, 6, "#2d7336");
  px(ctx, x + 1, y - 5, 2, 1, "#3f9c4a");
  px(ctx, x + 4, y - 4, 2, 1, "#3f9c4a");
  px(ctx, x, y - 3, 3, 1, "#3f9c4a");
  px(ctx, x + 4, y - 2, 3, 1, "#3f9c4a");
  px(ctx, x + 2, y - 7, 2, 1, "#57b85f");
}

/** Teia: oito raios e dois anéis, meio transparente. */
function web(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.globalAlpha = 0.4;
  const tips: [number, number][] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.3;
    tips.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r * 0.7)]);
  }
  for (const [x, y] of tips) line(ctx, "#ddd6ea", cx, cy, cx + x, cy + y);
  for (const f of [0.45, 0.85]) {
    for (let k = 0; k < 8; k++) {
      const [x0, y0] = tips[k]!;
      const [x1, y1] = tips[(k + 1) % 8]!;
      line(ctx, "#ddd6ea", cx + Math.round(x0 * f), cy + Math.round(y0 * f), cx + Math.round(x1 * f), cy + Math.round(y1 * f));
    }
  }
  ctx.globalAlpha = 1;
}

/** Casulo pendurado num fio, com o topo em (x, y). */
function cocoon(ctx: Ctx, x: number, y: number) {
  px(ctx, x + 2, 0, 1, y, "#cfc8da");
  px(ctx, x + 1, y, 3, 1, "#d8d0c0");
  px(ctx, x, y + 1, 5, 6, "#d8d0c0");
  px(ctx, x + 1, y + 7, 3, 1, "#d8d0c0");
  px(ctx, x, y + 2, 5, 1, "#a8a090");
  px(ctx, x, y + 5, 5, 1, "#a8a090");
  px(ctx, x + 1, y + 1, 1, 4, "#f0ead8");
}

/** Lanterna de luz fria (a mina assombrada), pendurada em (x, y). */
function lantern(ctx: Ctx, x: number, y: number) {
  glow(ctx, x + 1.5, y + 3, 10, 8, "#8fe0ff", 0.22);
  px(ctx, x + 1, y - 2, 1, 2, "#3a3d4a");
  px(ctx, x, y, 3, 5, "#3a3d4a");
  px(ctx, x + 1, y + 1, 1, 3, "#bfefff");
}

/** Um aventureiro que virou pedra, de espada erguida, com o pé em (x, y). */
function statue(ctx: Ctx, x: number, y: number) {
  px(ctx, x, y - 2, 9, 2, "#55534c");
  px(ctx, x + 3, y - 5, 1, 3, "#7c7a72");
  px(ctx, x + 5, y - 5, 1, 3, "#7c7a72");
  px(ctx, x + 2, y - 11, 5, 6, "#8c8a82");
  px(ctx, x + 3, y - 14, 3, 3, "#9a988f");
  px(ctx, x + 3, y - 14, 2, 1, "#b4b2a8");
  px(ctx, x + 2, y - 11, 1, 5, "#a8a69c");
  px(ctx, x + 7, y - 13, 1, 4, "#7c7a72");
  px(ctx, x + 7, y - 19, 1, 6, "#a8a69c");
  px(ctx, x + 6, y - 13, 3, 1, "#7c7a72");
  px(ctx, x, y - 10, 2, 4, "#7c7a72");
  px(ctx, x + 4, y - 6, 2, 1, "#5a8a3a");
}

/** Estandarte vermelho rasgado, com a haste em (x, 1). */
function banner(ctx: Ctx, x: number, rnd: () => number) {
  px(ctx, x - 1, 1, 12, 1, "#3a2a20");
  px(ctx, x, 2, 10, 11, "#9a2a2a");
  px(ctx, x, 2, 1, 11, "#b8403a");
  px(ctx, x + 8, 2, 2, 11, "#6a1a1a");
  px(ctx, x, 13, 4, 2, "#9a2a2a");
  px(ctx, x + 6, 13, 4, 2, "#6a1a1a");
  px(ctx, x + 4, 4, 2, 1, "#ffd23c");
  px(ctx, x + 3, 5, 4, 3, "#ff7a2e");
  px(ctx, x + 4, 6, 2, 1, "#ffd23c");
  px(ctx, x + 4, 8, 2, 1, "#ff7a2e");
  px(ctx, x + 2 + Math.floor(rnd() * 5), 9 + Math.floor(rnd() * 3), 1, 2, "#342a2a");
}

/** Cristal violeta flutuando, com o topo em (x, y). */
function shard(ctx: Ctx, x: number, y: number) {
  glow(ctx, x + 1.5, y + 3, 5, 5, "#a070e0", 0.2);
  px(ctx, x + 1, y, 1, 1, "#f0e0ff");
  px(ctx, x, y + 1, 3, 4, "#b080f0");
  px(ctx, x + 1, y + 5, 1, 1, "#7a4ab8");
  px(ctx, x, y + 1, 1, 3, "#f0e0ff");
}

const THEMES: Record<string, Theme> = {
  "cripta-do-musgo": {
    floor: ["#4a4d5a", "#45485a"],
    grout: "#363844",
    wall: "#2b2d36",
    wallDark: "#1e1f29",
    lip: "#23242d",
    deco: (ctx, rnd, st) => {
      for (let x = 16; x < SCENE_W - 16; x += 48) {
        px(ctx, x, 3, 20, 13, "#1a1b22");
        px(ctx, x + 2, 2, 16, 1, "#1a1b22");
      }
      for (let x = 6; x < SCENE_W; x += 13) px(ctx, x, FLOOR_Y - 3, 5 + (x % 3), 3, "#3f9c4a");
      torch(ctx, 40, "#ffb347");
      torch(ctx, SCENE_W - 44, "#ffb347");
      for (let i = 0; i < 9 + st * 2; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 3 + Math.floor(rnd() * 4), 2, rnd() < 0.5 ? "#3f9c4a" : "#2d7336");
      }
      for (let i = 0; i < 3 + st; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 4, 1, "#d6d1c3");
        px(ctx, x + 1, y + 1, 1, 1, "#d6d1c3");
      }
      for (let i = 0; i < 2; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 9, 3, "#2f4a5a");
        px(ctx, x + 2, y, 3, 1, "#4d7488");
      }
    },
  },
  "galerias-afogadas": {
    floor: ["#3e5160", "#394b59"],
    grout: "#2b3a46",
    wall: "#26323d",
    wallDark: "#1b242d",
    lip: "#1f2a33",
    deco: (ctx, rnd, st) => {
      for (let x = 10; x < SCENE_W - 10; x += 36) {
        px(ctx, x, 6, 14, 3, "#8a5a34");
        px(ctx, x + 2, 9, 2, 7, "#6a4a2e");
        px(ctx, x + 10, 9, 2, 7, "#6a4a2e");
      }
      px(ctx, 92, 3, 56, 13, "#1b242d");
      for (let x = 94; x < 146; x += 6) px(ctx, x, 3, 2, 13, "#5a606e");
      for (let i = 0; i < 14; i++) px(ctx, 8 + Math.floor(rnd() * (SCENE_W - 16)), 2 + Math.floor(rnd() * 12), 1, 2, "#4d7488");
      for (let i = 0; i < 4 + st; i++) {
        const [x, y] = floorPoint(rnd);
        const w = 10 + Math.floor(rnd() * 14);
        px(ctx, x, y, w, 4, "#2a6f9e");
        px(ctx, x + 1, y - 1, w - 2, 1, "#2a6f9e");
        px(ctx, x + 2, y, Math.max(2, w - 8), 1, "#8fd0e8");
      }
      for (let i = 0; i < 6; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 2, 2, "#8a5a34");
      }
    },
  },
  "forja-rachada": {
    floor: ["#3a3431", "#352f2c"],
    grout: "#262220",
    wall: "#2a2422",
    wallDark: "#1c1816",
    lip: "#201b19",
    deco: (ctx, rnd, st) => {
      for (const x of [28, 104, 180]) {
        ctx.globalAlpha = 0.25;
        px(ctx, x - 4, 2, 32, 14, "#ff7a2e");
        ctx.globalAlpha = 1;
        px(ctx, x, 5, 24, 11, "#140f0d");
        px(ctx, x + 2, 10, 20, 6, "#ff7a2e");
        px(ctx, x + 4, 12, 16, 4, "#ffd23c");
      }
      for (let i = 0; i < 5 + st * 2; i++) {
        let [x, y] = floorPoint(rnd);
        for (let k = 0; k < 6 + Math.floor(rnd() * 8); k++) {
          px(ctx, x, y, 2, 1, k % 3 === 0 ? "#ffb347" : "#ff7a2e");
          x += 1 + Math.floor(rnd() * 2);
          y += Math.floor(rnd() * 3) - 1;
        }
      }
      for (let i = 0; i < 4; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 3, 2, "#6c7387");
      }
    },
  },
  // ---- 24/11/2026: as dungeons novas ----------------------------------------------
  "toca-dos-javalis": {
    floor: ["#5a4632", "#56432f"],
    grout: "#4a3a2a",
    wall: "#3a2c20",
    wallDark: "#2c2118",
    lip: "#30241a",
    deco: (ctx, rnd, st) => {
      for (const x of [26, 112, 192]) {
        px(ctx, x, 6, 22, 10, "#140e09");
        px(ctx, x + 3, 4, 16, 2, "#140e09");
        px(ctx, x + 1, 14, 20, 2, "#4a3a2a");
      }
      for (let x = 5; x < SCENE_W - 4; x += 8 + Math.floor(rnd() * 10)) {
        const h = 3 + Math.floor(rnd() * 9);
        px(ctx, x, 0, 1, h, "#6a4a2e");
        px(ctx, x + (rnd() < 0.5 ? -1 : 1), h, 1, 2, "#5e3c22");
      }
      for (let x = 2; x < SCENE_W - 8; x += 14 + Math.floor(rnd() * 10)) fern(ctx, x, FLOOR_Y);
      ctx.globalAlpha = 0.08;
      for (const x0 of [50 + Math.floor(rnd() * 50), 140 + Math.floor(rnd() * 50)]) {
        for (let y = FLOOR_Y; y < SCENE_H; y += 2) px(ctx, x0 + Math.floor((y - FLOOR_Y) / 3), y, 20, 2, "#fff1c0");
      }
      ctx.globalAlpha = 1;
      if (st === 1) {
        for (let i = 0; i < 5; i++) {
          const [x, y] = floorPoint(rnd);
          const w = 12 + Math.floor(rnd() * 12);
          px(ctx, x, y, w, 4, "#3a2a1c");
          px(ctx, x + 1, y - 1, w - 2, 1, "#3a2a1c");
          px(ctx, x + 2, y, Math.max(2, w - 9), 1, "#6a5440");
        }
      }
      if (st === 2) {
        const x = 96 + Math.floor(rnd() * 40);
        const y = SCENE_H - 30;
        glow(ctx, x + 6, y + 2, 18, 10, "#ffb347", 0.18);
        for (const [dx, dy] of [[0, 2], [3, 5], [8, 5], [11, 2], [4, -1], [8, -1]] as const) px(ctx, x + dx, y + dy, 3, 2, "#6c6658");
        px(ctx, x + 3, y + 1, 7, 3, "#4a3220");
        px(ctx, x + 4, y - 3, 5, 4, "#ff7a2e");
        px(ctx, x + 5, y - 5, 2, 3, "#ffd23c");
        px(ctx, x + 6, y - 2, 1, 2, "#fff1a8");
      }
      for (let i = 0; i < (st === 3 ? 6 : 2); i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 5, 1, "#d6d1c3");
        px(ctx, x, y - 1, 1, 3, "#d6d1c3");
        px(ctx, x + 4, y - 1, 1, 3, "#d6d1c3");
      }
      for (let i = 0; i < 4 + st; i++) {
        const [x, y] = floorPoint(rnd);
        fern(ctx, x, y);
      }
      for (let i = 0; i < 6; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 4, 3, "#6c6658");
        px(ctx, x, y, 2, 1, "#8a8476");
      }
      for (let i = 0; i < 14; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 2, 1, rnd() < 0.5 ? "#a07a32" : "#7a8a2a");
      }
    },
  },
  "ninho-das-aranhas": {
    floor: ["#2f3a31", "#2c362e"],
    grout: "#222a24",
    wall: "#272030",
    wallDark: "#1b1622",
    lip: "#1e1926",
    deco: (ctx, rnd, st) => {
      for (let x = 24; x < SCENE_W - 24; x += 22 + Math.floor(rnd() * 16)) cocoon(ctx, x, 2 + Math.floor(rnd() * 4));
      web(ctx, 0, 0, 20);
      web(ctx, SCENE_W, 0, 20);
      for (let i = 0; i < 12; i++) {
        const x = 6 + Math.floor(rnd() * (SCENE_W - 12));
        glow(ctx, x + 1, FLOOR_Y - 2, 4, 3, "#9be03a", 0.18);
        px(ctx, x, FLOOR_Y - 3, 2, 2, "#9be03a");
        px(ctx, x, FLOOR_Y - 3, 1, 1, "#e0ffa0");
      }
      for (let i = 0; i < 2 + Math.min(st, 2); i++) {
        const [x, y] = floorPoint(rnd);
        web(ctx, x + 4, y, 10 + Math.floor(rnd() * 8));
      }
      for (let i = 0; i < 3 + st; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y + 1, 7, 3, "#e8e0c8");
        px(ctx, x + 1, y, 5, 1, "#e8e0c8");
        px(ctx, x, y + 3, 7, 1, "#b8b098");
        px(ctx, x + 3, y + 2, 1, 1, "#b8b098");
        for (const [dx, dy] of [[1, 1], [3, 0], [5, 1], [2, 2]] as const) px(ctx, x + dx, y + dy, 1, 1, "#fffaf0");
      }
      for (let i = 0; i < 2 + st; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 8, 4, "#d8d0c0");
        px(ctx, x + 1, y - 1, 6, 1, "#d8d0c0");
        px(ctx, x + 2, y, 1, 4, "#a8a090");
        px(ctx, x + 5, y, 1, 4, "#a8a090");
        px(ctx, x + 1, y, 1, 2, "#f0ead8");
      }
      for (let i = 0; i < 4; i++) {
        const [x, y] = floorPoint(rnd);
        const w = 8 + Math.floor(rnd() * 10);
        px(ctx, x, y, w, 3, "#3f5a24");
        px(ctx, x + 1, y, Math.max(2, w - 6), 1, "#6a8a3a");
      }
      for (let i = 0; i < 3; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 4, 1, "#d6d1c3");
        px(ctx, x + 1, y + 1, 1, 1, "#d6d1c3");
      }
    },
  },
  "mina-assombrada": {
    floor: ["#3d3b40", "#39373c"],
    grout: "#2b292e",
    wall: "#2e2b30",
    wallDark: "#201e24",
    lip: "#242228",
    deco: (ctx, rnd, st) => {
      for (let i = 0; i < 9; i++) {
        const x = 6 + Math.floor(rnd() * (SCENE_W - 16));
        const y = 3 + Math.floor(rnd() * 9);
        px(ctx, x, y, 5, 3, "#141216");
        px(ctx, x + 1, y - 1, 3, 1, "#141216");
        px(ctx, x + 1, y, 1, 1, "#6c6c7c");
      }
      px(ctx, 99, 5, 42, 11, "#0e0d10");
      px(ctx, 103, 3, 34, 2, "#0e0d10");
      for (const x of [14, 96, 178]) {
        px(ctx, x, 2, 4, 14, "#6a4a2e");
        px(ctx, x + 44, 2, 4, 14, "#6a4a2e");
        px(ctx, x, 2, 1, 14, "#8a5a34");
        px(ctx, x + 44, 2, 1, 14, "#8a5a34");
        px(ctx, x - 1, 0, 50, 3, "#8a5a34");
        px(ctx, x - 1, 0, 50, 1, "#a07040");
        px(ctx, x - 1, 3, 50, 1, "#4a3220");
        lantern(ctx, x + 22, 6);
      }
      const ry = DOOR_ROW * TILE + 3;
      for (let x = 2; x < SCENE_W; x += 6) px(ctx, x, ry - 1, 2, 11, "#4a3220");
      for (const y of [ry, ry + 8]) {
        px(ctx, 0, y, SCENE_W, 1, "#8c909d");
        px(ctx, 0, y + 1, SCENE_W, 1, "#5a606e");
      }
      if (st === 1) {
        const x = 50 + Math.floor(rnd() * 110);
        px(ctx, x, ry - 7, 20, 9, "#5a606e");
        px(ctx, x - 1, ry - 8, 22, 2, "#8c909d");
        px(ctx, x + 2, ry - 11, 16, 3, "#15131a");
        px(ctx, x + 5, ry - 11, 2, 1, "#6c6c7c");
        px(ctx, x + 11, ry - 10, 1, 1, "#6c6c7c");
        px(ctx, x + 2, ry - 4, 16, 1, "#3a3d4a");
      }
      if (st === 2) {
        for (let i = 0; i < 4; i++) {
          const [x, y] = floorPoint(rnd);
          for (let k = 0; k < 6; k++) px(ctx, x + Math.floor(rnd() * 12), y + Math.floor(rnd() * 5), 3 + Math.floor(rnd() * 3), 2, rnd() < 0.5 ? "#5a5660" : "#7a7680");
        }
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 16, 3, "#6a4a2e");
        px(ctx, x, y, 16, 1, "#8a5a34");
      }
      for (let i = 0; i < 4 + st; i++) {
        const [x, y] = floorPoint(rnd);
        glow(ctx, x, y, 14, 5, "#8fe0ff", 0.06);
      }
      for (let i = 0; i < 10; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 3, 2, "#15131a");
        px(ctx, x, y, 1, 1, "#5a5a66");
      }
    },
  },
  "bosque-petrificado": {
    floor: ["#5e5f5a", "#5a5b56"],
    grout: "#4a4b46",
    wall: "#454642",
    wallDark: "#363733",
    lip: "#3a3b37",
    deco: (ctx, rnd, st) => {
      for (let x = 12; x < SCENE_W - 14; x += 30 + Math.floor(rnd() * 18)) {
        const r = Math.floor(rnd() * 3);
        const c = "#7c7a72";
        for (const d of [0, 1]) {
          line(ctx, c, x + d, 8, x - 3 + d, 4, x - 5 + d, 0);
          line(ctx, c, x + 3 + d, 8, x + 6 + d, 4 - r, x + 9 + d, 1);
        }
        line(ctx, c, x - 3, 4, x - 7, 3 - r);
        line(ctx, c, x + 2, 8, x + 2, 0);
        line(ctx, c, x + 6, 4 - r, x + 6, 0);
        px(ctx, x - 2, 14, 9, 2, c);
        px(ctx, x, 7, 5, 9, c);
        px(ctx, x, 7, 1, 9, "#9a988f");
        px(ctx, x + 4, 7, 1, 9, "#5e5c56");
        px(ctx, x - 3, 15, 1, 1, "#5e5c56");
        px(ctx, x + 7, 15, 1, 1, "#5e5c56");
        px(ctx, x, 11 + r, 2, 2, "#5a8a3a");
        px(ctx, x - 4, 3, 2, 1, "#5a8a3a");
        px(ctx, x + 6, 3 - r, 2, 1, "#7ab04a");
      }
      for (let i = 0; i < 4 + st; i++) {
        let [x, y] = floorPoint(rnd);
        for (let k = 0; k < 5 + Math.floor(rnd() * 6); k++) {
          px(ctx, x, y, 2, 1, "#3e3f3a");
          x += 2;
          y += Math.floor(rnd() * 3) - 1;
        }
      }
      for (let i = 0; i < 8; i++) {
        const [x, y] = floorPoint(rnd);
        const w = 4 + Math.floor(rnd() * 8);
        px(ctx, x, y, w, 2, "#4a7a3a");
        px(ctx, x + 1, y - 1, Math.max(1, w - 3), 1, "#5a8a3a");
      }
      for (let i = 0; i < 2; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 9, 5, "#7c7a72");
        px(ctx, x, y, 9, 2, "#a09e94");
        px(ctx, x + 3, y, 3, 1, "#7c7a72");
        px(ctx, x + 2, y + 4, 1, 1, "#5a8a3a");
      }
      for (let i = 0; i < 10; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 2, 1, "#8a8a84");
        px(ctx, x + 1, y + 1, 1, 1, "#8a8a84");
      }
      if (st === 2) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 18, 5, "#6c6a62");
        px(ctx, x + 2, y - 1, 14, 1, "#8c8a82");
        px(ctx, x + 4, y + 1, 10, 2, "#3e3f3a");
        for (const dx of [5, 8, 11]) px(ctx, x + dx, y + 1, 2, 2, "#d8d4c8");
      }
      for (let i = 0; i < (st === 3 ? 3 : st >= 1 ? 1 : 0); i++) {
        const [x, y] = floorPoint(rnd);
        statue(ctx, x, y + 6);
      }
    },
  },
  "cidadela-de-cinzas": {
    floor: ["#3f3634", "#3b3230"],
    grout: "#2b2422",
    wall: "#342a2a",
    wallDark: "#241d1d",
    lip: "#2a2222",
    deco: (ctx, rnd, st) => {
      for (const x of [20, 76, 148, 204]) banner(ctx, x, rnd);
      for (const x of [50, 115, 180]) torch(ctx, x, "#ff7a2e");
      if (st === 3) {
        const y = DOOR_ROW * TILE + 1;
        px(ctx, 0, y, SCENE_W, 14, "#5a1616");
        px(ctx, 0, y + 1, SCENE_W, 1, "#c9a040");
        px(ctx, 0, y + 12, SCENE_W, 1, "#c9a040");
        for (let i = 0; i < 6; i++) {
          const x = 10 + Math.floor(rnd() * (SCENE_W - 30));
          px(ctx, x, y + 3 + Math.floor(rnd() * 6), 6 + Math.floor(rnd() * 6), 3, "#2a2020");
        }
      }
      for (let i = 0; i < 5 + st; i++) {
        const [x, y] = floorPoint(rnd);
        glow(ctx, x, y, 10, 4, "#120c0c", 0.35);
      }
      for (let i = 0; i < 6; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 7, 2, "#6e6866");
        px(ctx, x + 1, y - 1, 5, 1, "#8a8480");
        px(ctx, x + 2, y - 2, 3, 1, "#a8a29e");
        if (rnd() < 0.5) px(ctx, x + 3, y, 1, 1, "#ff7a2e");
      }
      for (let i = 0; i < 2; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 9, 6, "#5a5050");
        px(ctx, x, y, 9, 2, "#7a7070");
        px(ctx, x + 2, y - 2, 4, 2, "#5a5050");
        px(ctx, x + 2, y - 2, 4, 1, "#7a7070");
        px(ctx, x + 6, y + 3, 1, 2, "#2a2020");
      }
      for (let i = 0; i < 18; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 1, 1, rnd() < 0.5 ? "#ff7a2e" : "#ffb347");
      }
      ctx.globalAlpha = 0.45;
      for (let i = 0; i < 30; i++) px(ctx, Math.floor(rnd() * SCENE_W), Math.floor(rnd() * SCENE_H), 1, 1, "#a8a29e");
      ctx.globalAlpha = 1;
    },
  },
  "abismo-gelado": {
    floor: ["#7fa3bd", "#7a9eb8"],
    grout: "#6a8eaa",
    wall: "#4e7090",
    wallDark: "#3e5e7c",
    lip: "#44647f",
    deco: (ctx, rnd, st) => {
      for (let i = 0; i < 8; i++) {
        const x = 6 + Math.floor(rnd() * (SCENE_W - 12));
        const y = 5 + Math.floor(rnd() * 7);
        px(ctx, x, y, 1, 3, "#a8d8f0");
        px(ctx, x - 1, y + 1, 3, 1, "#a8d8f0");
      }
      px(ctx, 0, 0, SCENE_W, 2, "#dfeef8");
      for (let x = 2; x < SCENE_W - 3; x += 4 + Math.floor(rnd() * 6)) {
        const h = 4 + Math.floor(rnd() * 10);
        px(ctx, x, 1, 3, h - 3, "#b8dcf0");
        px(ctx, x + 1, h - 2, 1, 2, "#e8f8ff");
        px(ctx, x, 1, 1, h - 3, "#ffffff");
      }
      if (st === 1) {
        let y = SCENE_H - 26;
        for (let x = 10; x < SCENE_W - 10; x += 4) {
          y = Math.max(SCENE_H - 32, Math.min(SCENE_H - 18, y + Math.floor(rnd() * 5) - 2));
          px(ctx, x, y - 1, 4, 1, "#e8f8ff");
          px(ctx, x, y, 4, 4, "#1e3a5a");
          px(ctx, x, y + 4, 4, 1, "#4e7090");
        }
      }
      for (let i = 0; i < 5; i++) {
        const [x, y] = floorPoint(rnd);
        const w = 12 + Math.floor(rnd() * 14);
        px(ctx, x, y, w, 3, "#dfeef8");
        px(ctx, x + 2, y - 1, w - 4, 1, "#dfeef8");
        px(ctx, x + 1, y + 2, w - 2, 1, "#b8d0e0");
      }
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 3 + st; i++) {
        const [x, y] = floorPoint(rnd);
        line(ctx, "#e8f8ff", x, y, x + 5, y + 2, x + 9, y + 1, x + 13, y + 4);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 10; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 1, 1, "#ffffff");
        px(ctx, x + 1, y + 1, 1, 1, "#e8f8ff");
      }
      for (let i = 0; i < 2 + (st === 3 ? 4 : 1); i++) {
        const [x, y] = floorPoint(rnd);
        glow(ctx, x + 1, y, 8, 4, "#c8f0ff", 0.2);
        px(ctx, x, y - 5, 2, 6, "#8fd0e8");
        px(ctx, x - 2, y - 2, 2, 3, "#8fd0e8");
        px(ctx, x + 2, y - 3, 2, 4, "#6ab0d8");
        px(ctx, x, y - 5, 1, 3, "#e8f8ff");
      }
      if (st === 3) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 20, 2, "#e8e4d8");
        for (let k = 0; k < 5; k++) px(ctx, x + 2 + k * 4, y - 5, 1, 5, "#d6d1c3");
      }
    },
  },
  "trono-do-vazio": {
    floor: ["#2a2340", "#27203c"],
    grout: "#3a2f58",
    wall: "#16111f",
    wallDark: "#0e0b16",
    lip: "#120e1a",
    deco: (ctx, rnd, st) => {
      glow(ctx, 40 + Math.floor(rnd() * 160), 7, 40, 10, "#6a2ab8", 0.2);
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.3 + rnd() * 0.6;
        px(ctx, Math.floor(rnd() * SCENE_W), Math.floor(rnd() * (FLOOR_Y - 1)), 1, 1, rnd() < 0.3 ? "#c8a0ff" : "#ffffff");
      }
      ctx.globalAlpha = 1;
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 8, 34, 14, "#8a4ad8", 0.25);
        px(ctx, cx - 7, 2, 14, 14, "#07050c");
        for (const dx of [-7, -1, 5]) {
          px(ctx, cx + dx, 0, 2, 2, "#07050c");
          px(ctx, cx + dx, 0, 1, 1, "#d090ff");
        }
        px(ctx, cx - 7, 2, 1, 14, "#a070e0");
        px(ctx, cx + 6, 2, 1, 14, "#7a4ab8");
        px(ctx, cx - 12, 9, 5, 7, "#241a36");
        px(ctx, cx + 7, 9, 5, 7, "#241a36");
        px(ctx, cx - 12, 9, 5, 1, "#a070e0");
        px(ctx, cx + 7, 9, 5, 1, "#7a4ab8");
        px(ctx, cx - 12, FLOOR_Y, 24, 6, "#07050c");
        px(ctx, cx - 7, FLOOR_Y, 14, 3, "#241a36");
        px(ctx, cx - 12, FLOOR_Y + 5, 24, 1, "#a070e0");
        shard(ctx, cx - 1, 4);
      }
      for (let x = 14; x < SCENE_W - 14; x += 40 + Math.floor(rnd() * 20)) if (st !== 3 || Math.abs(x - SCENE_W / 2) > 24) shard(ctx, x, 3 + Math.floor(rnd() * 6));
      ctx.globalAlpha = 0.35;
      for (let i = 0; i < 30; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 1, 1, rnd() < 0.3 ? "#c8a0ff" : "#ffffff");
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 2 + st; i++) {
        const [x, y] = floorPoint(rnd);
        glow(ctx, x + 8, y + 2, 14, 6, "#a070e0", 0.15);
        px(ctx, x + 2, y - 1, 12, 1, "#7a4ab8");
        px(ctx, x + 2, y, 12, 1, "#05030a");
        px(ctx, x, y + 1, 16, 2, "#05030a");
        px(ctx, x + 2, y + 3, 12, 1, "#05030a");
        px(ctx, x + 2, y + 4, 12, 1, "#4a2a78");
      }
      for (let i = 0; i < 3; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x - 1, y + 9, 5, 1, "#0e0b16");
        shard(ctx, x, y);
      }
      for (let i = 0; i < 3; i++) {
        const [x, y] = floorPoint(rnd);
        line(ctx, "#5a3a90", x, y, x + 4, y + 1, x + 7, y - 1, x + 11, y);
      }
    },
  },
  // ---- D69 (27/11/2026): os temas do fim de jogo, um por região (11 a 20) -----------------------
  "fenda-abissal": {
    floor: ["#1a2a30", "#18262c"],
    grout: "#24404a",
    wall: "#0d171b",
    wallDark: "#081013",
    lip: "#0a1316",
    deco: (ctx, rnd, st) => {
      // Olhos que piscam na parede e fendas de luz no chão.
      for (let x = 10; x < SCENE_W - 10; x += 22 + Math.floor(rnd() * 20)) {
        const y = 4 + Math.floor(rnd() * 7);
        glow(ctx, x + 1, y + 1, 4, 3, "#40e0d0", 0.25);
        px(ctx, x - 1, y, 5, 3, "#0b3a3a");
        px(ctx, x, y + 1, 3, 1, "#7ffff0");
        px(ctx, x + 1, y + 1, 1, 1, "#05080a");
      }
      for (let i = 0; i < 3 + st; i++) {
        const [x, y] = floorPoint(rnd);
        glow(ctx, x + 8, y + 2, 14, 5, "#3ad0c8", 0.18);
        line(ctx, "#7ffff0", x, y, x + 4, y + 2, x + 7, y - 1, x + 11, y + 2, x + 16, y);
        line(ctx, "#1f8f8a", x, y + 1, x + 4, y + 3, x + 7, y, x + 11, y + 3, x + 16, y + 1);
      }
      for (let i = 0; i < 4; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 3, 2, "#2e4a52");
        px(ctx, x + 1, y - 1, 1, 1, "#4e7a84");
      }
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 9, 30, 12, "#3ad0c8", 0.3);
        px(ctx, cx - 10, 1, 20, 14, "#020506");
        for (let k = 0; k < 7; k++) line(ctx, k % 2 ? "#7ffff0" : "#a070e0", cx, 8, cx - 12 + k * 4, k % 2 ? 1 : 15);
        px(ctx, cx - 2, 6, 4, 4, "#e8fffc");
      }
    },
  },
  "trono-do-fim": {
    floor: ["#2a1618", "#261416"],
    grout: "#3a1e22",
    wall: "#140a0c",
    wallDark: "#0c0607",
    lip: "#100809",
    deco: (ctx, rnd, st) => {
      // Velas pretas de chama roxa na parede, ossos e colunas partidas no chão.
      for (let x = 12; x < SCENE_W - 12; x += 30 + Math.floor(rnd() * 16)) {
        glow(ctx, x + 1, 7, 6, 5, "#b04ae0", 0.22);
        px(ctx, x, 8, 3, 6, "#1a1a1e");
        px(ctx, x + 1, 5, 1, 3, "#d090ff");
        px(ctx, x + 1, 4, 1, 1, "#ffffff");
      }
      for (let i = 0; i < 4 + st; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 7, 1, "#d8d0c0");
        px(ctx, x - 1, y - 1, 2, 3, "#e8e0d0");
        px(ctx, x + 6, y - 1, 2, 3, "#e8e0d0");
      }
      for (let i = 0; i < 2; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y - 10, 6, 10, "#4a3a3e");
        px(ctx, x, y - 10, 1, 10, "#6a5a5e");
        px(ctx, x + 1, y - 12, 2, 2, "#4a3a3e");
        px(ctx, x - 2, y, 10, 2, "#3a2a2e");
      }
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 8, 26, 10, "#8a1a2a", 0.3);
        px(ctx, cx - 8, 1, 16, 15, "#0a0505");
        px(ctx, cx - 10, 6, 3, 10, "#2a1418");
        px(ctx, cx + 7, 6, 3, 10, "#2a1418");
        px(ctx, cx - 5, 2, 10, 2, "#c8a040");
        for (const dx of [-5, -2, 1, 4]) px(ctx, cx + dx, 0, 1, 2, "#ffd060");
        px(ctx, cx - 10, FLOOR_Y, 20, 5, "#0a0505");
        px(ctx, cx - 10, FLOOR_Y + 4, 20, 1, "#8a1a2a");
      }
    },
  },
  "ermo-de-cinzas": {
    floor: ["#3a3432", "#36302e"],
    grout: "#4a3a30",
    wall: "#231c1a",
    wallDark: "#1a1412",
    lip: "#1e1816",
    deco: (ctx, rnd, st) => {
      // Cinza caindo, rachaduras com brasa e costelas de dragão no chão.
      for (let i = 0; i < 30; i++) {
        ctx.globalAlpha = 0.35 + rnd() * 0.5;
        px(ctx, Math.floor(rnd() * SCENE_W), Math.floor(rnd() * SCENE_H), 1, 1, rnd() < 0.25 ? "#ff8a3d" : "#bdb4ae");
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4 + st; i++) {
        const [x, y] = floorPoint(rnd);
        glow(ctx, x + 6, y + 1, 10, 4, "#ff6a1a", 0.22);
        line(ctx, "#ff8a2a", x, y, x + 3, y + 1, x + 6, y - 1, x + 9, y + 1, x + 12, y);
        line(ctx, "#ffd27a", x + 4, y, x + 6, y - 1);
      }
      const [rx, ry] = floorPoint(rnd);
      for (let k = 0; k < 5; k++) {
        px(ctx, rx + k * 4, ry - 6 + Math.abs(2 - k), 1, 7 - Math.abs(2 - k), "#e8e0d0");
        px(ctx, rx + k * 4 + 1, ry - 5 + Math.abs(2 - k), 1, 1, "#c8c0b0");
      }
      px(ctx, rx - 2, ry + 1, 22, 1, "#d8d0c0");
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 10, 30, 10, "#ff5a1a", 0.28);
        px(ctx, cx - 12, 3, 24, 11, "#d8d0c0");
        px(ctx, cx - 12, 3, 24, 1, "#f0e8d8");
        px(ctx, cx - 7, 6, 4, 3, "#1a0a06");
        px(ctx, cx + 3, 6, 4, 3, "#1a0a06");
        px(ctx, cx - 6, 7, 2, 1, "#ff6a1a");
        px(ctx, cx + 4, 7, 2, 1, "#ff6a1a");
        for (let k = -9; k <= 9; k += 3) px(ctx, cx + k, 12, 2, 3, "#f0e8d8");
        px(ctx, cx - 16, 1, 4, 6, "#c8c0b0");
        px(ctx, cx + 12, 1, 4, 6, "#c8c0b0");
      }
    },
  },
  "catedral-partida": {
    floor: ["#8a8e96", "#7c8088"],
    grout: "#5e626a",
    wall: "#3a3e4a",
    wallDark: "#2a2e38",
    lip: "#30343e",
    deco: (ctx, rnd, st) => {
      // Vitrais coloridos na parede, bancos quebrados e cacos de vidro no chão.
      const glass = ["#d04a4a", "#4a7ad0", "#e0c040", "#4ab070", "#a04ad0"];
      for (let x = 14; x < SCENE_W - 18; x += 34 + Math.floor(rnd() * 10)) {
        px(ctx, x, 2, 9, 13, "#1a1c22");
        for (let gy = 0; gy < 3; gy++)
          for (let gx = 0; gx < 2; gx++) px(ctx, x + 1 + gx * 4, 3 + gy * 4, 3, 3, glass[Math.floor(rnd() * glass.length)]!);
        px(ctx, x + 3, 1, 3, 1, "#1a1c22");
        glow(ctx, x + 4, 20, 10, 4, glass[Math.floor(rnd() * glass.length)]!, 0.12);
      }
      for (let i = 0; i < 2 + (st % 2); i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 18, 3, "#5a3a24");
        px(ctx, x, y - 4, 2, 4, "#4a2e1c");
        px(ctx, x + 12, y - 4, 2, 4, "#4a2e1c");
        px(ctx, x + 7, y, 3, 3, "#7c8088");
      }
      for (let i = 0; i < 6; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 1, 1, glass[Math.floor(rnd() * glass.length)]!);
        px(ctx, x + 1, y + 1, 1, 1, "#e8eef8");
      }
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 7, 18, 9, "#e8e0ff", 0.25);
        ctx.fillStyle = "#1a1c22";
        ctx.beginPath();
        ctx.arc(cx, 8, 8, 0, Math.PI * 2);
        ctx.fill();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          px(ctx, Math.round(cx + Math.cos(a) * 5) - 1, Math.round(8 + Math.sin(a) * 5) - 1, 2, 2, glass[k % glass.length]!);
        }
        line(ctx, "#3a3e4a", cx - 6, 3, cx + 2, 12);
        px(ctx, cx - 12, FLOOR_Y + 2, 24, 6, "#d8d8e0");
        px(ctx, cx - 12, FLOOR_Y + 2, 24, 1, "#ffffff");
        for (const dx of [-9, -4, 4, 9]) {
          px(ctx, cx + dx, FLOOR_Y - 2, 1, 4, "#f0ead8");
          px(ctx, cx + dx, FLOOR_Y - 3, 1, 1, "#ffd060");
        }
      }
    },
  },
  "mar-de-vidro": {
    floor: ["#101218", "#0e1016"],
    grout: "#1c2030",
    wall: "#08090e",
    wallDark: "#040509",
    lip: "#06070b",
    deco: (ctx, rnd, st) => {
      // Vidro negro: reflexos brancos no chão, espinhos de obsidiana, estrelas na parede.
      for (let i = 0; i < 26; i++) {
        ctx.globalAlpha = 0.3 + rnd() * 0.6;
        px(ctx, Math.floor(rnd() * SCENE_W), Math.floor(rnd() * (FLOOR_Y - 1)), 1, 1, "#c8d8ff");
      }
      ctx.globalAlpha = 0.18;
      for (let i = 0; i < 8; i++) {
        const [x, y] = floorPoint(rnd);
        line(ctx, "#ffffff", x, y, x + 10, y - 3);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4 + st; i++) {
        const [x, y] = floorPoint(rnd);
        const h = 5 + Math.floor(rnd() * 7);
        glow(ctx, x + 1, y - h / 2, 4, h / 2 + 1, "#7a6ad8", 0.14);
        for (let k = 0; k < h; k++) px(ctx, x + Math.floor(k / 3), y - k, Math.max(1, 3 - Math.floor(k / 3)), 1, k >= h - 2 ? "#c0b0ff" : "#2e2a4a");
        px(ctx, x, y - 1, 1, h - 2, "#5a4a98");
      }
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 10, 34, 12, "#5a4aa8", 0.28);
        for (const dx of [-14, -6, 4, 12]) {
          let y = FLOOR_Y + 10;
          for (let k = 0; k < 16; k++) {
            y -= 1;
            px(ctx, cx + dx + Math.round(Math.sin(k / 2.5 + dx) * 2), y, 3, 1, k > 12 ? "#8a7ac8" : "#14121e");
          }
        }
      }
    },
  },
  "forja-dos-titas": {
    floor: ["#4a3a2e", "#44352a"],
    grout: "#2e241c",
    wall: "#2a221c",
    wallDark: "#1c1612",
    lip: "#221a14",
    deco: (ctx, rnd, st) => {
      // Correntes na parede, chapas rebitadas, canais de lava e bigornas.
      for (let x = 8; x < SCENE_W - 8; x += 24 + Math.floor(rnd() * 14)) {
        for (let y = 0; y < 12; y += 3) {
          px(ctx, x, y, 3, 2, "#5a5450");
          px(ctx, x + 1, y + 2, 1, 1, "#3a3430");
        }
        px(ctx, x - 1, 12, 5, 3, "#6a6460");
      }
      for (let ty = 2; ty < 9; ty += 3)
        for (let tx = 1; tx < 14; tx += 4) px(ctx, tx * TILE + 2, ty * TILE + 2, 1, 1, "#8a7a6a");
      for (let i = 0; i < 1 + (st % 2); i++) {
        const y = FLOOR_Y + 20 + Math.floor(rnd() * 80);
        glow(ctx, SCENE_W / 2, y + 1, SCENE_W / 2, 4, "#ff6a1a", 0.18);
        px(ctx, SIDE, y, SCENE_W - 2 * SIDE, 3, "#ff6a1a");
        px(ctx, SIDE, y + 1, SCENE_W - 2 * SIDE, 1, "#ffd27a");
      }
      for (let i = 0; i < 2; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y - 6, 12, 3, "#5a5a60");
        px(ctx, x + 3, y - 3, 6, 3, "#4a4a50");
        px(ctx, x + 1, y, 10, 2, "#3a3a40");
        px(ctx, x, y - 6, 12, 1, "#8a8a90");
      }
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 12, 32, 10, "#ff6a1a", 0.35);
        px(ctx, cx - 14, 5, 28, 5, "#5a5a60");
        px(ctx, cx - 14, 5, 28, 1, "#9a9aa0");
        px(ctx, cx - 6, 10, 12, 6, "#4a4a50");
        px(ctx, cx - 10, FLOOR_Y, 20, 4, "#3a3a40");
        px(ctx, cx + 6, 0, 2, 6, "#6a4a2e");
        px(ctx, cx + 3, 0, 8, 3, "#7a7a80");
      }
    },
  },
  "jardim-das-almas": {
    floor: ["#241a30", "#21182c"],
    grout: "#2e2240",
    wall: "#140e1c",
    wallDark: "#0c0812",
    lip: "#100b16",
    deco: (ctx, rnd, st) => {
      // Trepadeiras na parede, flores pálidas que brilham e almas flutuando.
      for (let x = 4; x < SCENE_W - 4; x += 8 + Math.floor(rnd() * 10)) {
        const h = 6 + Math.floor(rnd() * 9);
        px(ctx, x, 0, 1, h, "#3a5a3a");
        px(ctx, x - 1, h - 2, 3, 2, "#4a7a4a");
      }
      for (let i = 0; i < 10 + st * 2; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x + 1, y - 3, 1, 3, "#3a5a3a");
        glow(ctx, x + 1.5, y - 4, 3, 3, "#e8e0ff", 0.25);
        px(ctx, x, y - 5, 3, 2, "#f0eaff");
        px(ctx, x + 1, y - 5, 1, 1, "#b8a8e8");
      }
      for (let i = 0; i < 3 + st; i++) {
        const [x, y] = floorPoint(rnd);
        glow(ctx, x + 2, y - 10, 6, 6, "#a8f0ff", 0.2);
        px(ctx, x, y - 12, 4, 4, "#d8f8ff");
        px(ctx, x + 1, y - 8, 2, 2, "#a8e0f0");
        px(ctx, x + 1, y - 6, 1, 1, "#78b0c8");
      }
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 10, 30, 12, "#a8f0ff", 0.22);
        px(ctx, cx - 2, 2, 5, 14, "#2a1a14");
        for (const [dx, dy] of [[-10, 3], [-6, 1], [6, 2], [10, 4]] as const) line(ctx, "#2a1a14", cx, 4, cx + dx, dy);
        for (const [dx, dy] of [[-9, 6], [8, 7], [-4, 9], [4, 10]] as const) {
          px(ctx, cx + dx, dy, 1, 3, "#3a2a24");
          px(ctx, cx + dx - 1, dy + 3, 3, 2, "#d8f8ff");
        }
        px(ctx, cx - 8, FLOOR_Y, 16, 3, "#2a1a14");
      }
    },
  },
  "torre-do-eclipse": {
    floor: ["#1c1a3a", "#1a1836"],
    grout: "#2e2a5a",
    wall: "#100e24",
    wallDark: "#0a0918",
    lip: "#0d0b1e",
    deco: (ctx, rnd, st) => {
      // O eclipse na parede, livros flutuando e círculos arcanos no chão.
      const ex = 30 + Math.floor(rnd() * (SCENE_W - 60));
      glow(ctx, ex, 8, 12, 9, "#ffd060", 0.35);
      ctx.fillStyle = "#05040c";
      ctx.beginPath();
      ctx.arc(ex, 8, 6, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 3; i++) {
        const x = 10 + Math.floor(rnd() * (SCENE_W - 20));
        const y = 2 + Math.floor(rnd() * 9);
        if (Math.abs(x - ex) < 12) continue;
        px(ctx, x, y, 5, 4, "#6a2a2a");
        px(ctx, x + 1, y + 1, 3, 2, "#f0e8d0");
      }
      for (let i = 0; i < 1 + (st >= 2 ? 1 : 0); i++) {
        const [x, y] = floorPoint(rnd);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = "#8a7ae8";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(x + 10, y + 3, 11, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(x + 10, y + 3, 7, 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        for (let k = 0; k < 6; k++) px(ctx, x + 10 + Math.round(Math.cos(k) * 9), y + 3 + Math.round(Math.sin(k) * 3), 1, 1, "#d8d0ff");
      }
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 8, 26, 14, "#ffd060", 0.4);
        ctx.fillStyle = "#020106";
        ctx.beginPath();
        ctx.arc(cx, 8, 9, 0, Math.PI * 2);
        ctx.fill();
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          px(ctx, Math.round(cx + Math.cos(a) * 11), Math.round(8 + Math.sin(a) * 8), 1, 1, "#fff0b0");
        }
      }
    },
  },
  "coracao-do-abismo": {
    floor: ["#3a1418", "#361216"],
    grout: "#5a1e24",
    wall: "#220a0e",
    wallDark: "#160608",
    lip: "#1c080b",
    deco: (ctx, rnd, st) => {
      // Veias pulsando no chão, bolsas de carne na parede e costelas.
      for (let x = 8; x < SCENE_W - 8; x += 20 + Math.floor(rnd() * 16)) {
        const y = 3 + Math.floor(rnd() * 6);
        glow(ctx, x + 3, y + 3, 6, 5, "#ff3a4a", 0.18);
        px(ctx, x, y, 7, 7, "#6a1a24");
        px(ctx, x + 1, y + 1, 5, 5, "#8a2a34");
        px(ctx, x + 2, y + 2, 2, 2, "#c84a54");
      }
      for (let i = 0; i < 4 + st; i++) {
        const [x, y] = floorPoint(rnd);
        line(ctx, "#8a1a2a", x, y, x + 5, y + 2, x + 9, y + 1, x + 14, y + 4, x + 20, y + 3);
        line(ctx, "#c8303e", x + 5, y + 2, x + 7, y + 5);
      }
      for (let i = 0; i < 2; i++) {
        const [x, y] = floorPoint(rnd);
        for (let k = 0; k < 4; k++) {
          px(ctx, x + k * 4, y - 8, 1, 8, "#e8d8d0");
          px(ctx, x + k * 4 + 1, y - 9, 2, 1, "#e8d8d0");
        }
      }
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 9, 30, 12, "#ff2a3a", 0.35);
        px(ctx, cx - 9, 2, 18, 13, "#8a1a24");
        px(ctx, cx - 7, 1, 6, 3, "#8a1a24");
        px(ctx, cx + 1, 1, 6, 3, "#8a1a24");
        px(ctx, cx - 6, 4, 4, 4, "#c84a54");
        px(ctx, cx - 5, 5, 2, 2, "#ff8a94");
        for (const dx of [-12, 12]) line(ctx, "#6a1a24", cx, 9, cx + dx, 15);
        px(ctx, cx - 2, 0, 4, 2, "#5a121a");
      }
    },
  },
  "horizonte-final": {
    floor: ["#0e1020", "#0c0e1c"],
    grout: "#1a1e38",
    wall: "#05060e",
    wallDark: "#020309",
    lip: "#04050b",
    deco: (ctx, rnd, st) => {
      // O horizonte que se apaga: estrelas, a linha de luz, ponteiros de relógio soltos e areia que sobe.
      for (let i = 0; i < 44; i++) {
        ctx.globalAlpha = 0.25 + rnd() * 0.7;
        px(ctx, Math.floor(rnd() * SCENE_W), Math.floor(rnd() * SCENE_H), 1, 1, rnd() < 0.2 ? "#ffd8a0" : "#ffffff");
      }
      ctx.globalAlpha = 1;
      glow(ctx, SCENE_W / 2, FLOOR_Y - 1, SCENE_W / 2, 3, "#ffb86a", 0.3);
      px(ctx, 0, FLOOR_Y - 2, SCENE_W, 1, "#ffd8a0");
      for (let i = 0; i < 2 + st; i++) {
        const [x, y] = floorPoint(rnd);
        line(ctx, "#c8b8f0", x, y, x + 8, y - 4);
        px(ctx, x + 8, y - 5, 2, 2, "#ffffff");
        line(ctx, "#8a7ac8", x + 3, y + 2, x + 7, y + 4);
      }
      ctx.globalAlpha = 0.4;
      for (let i = 0; i < 18; i++) {
        const [x, y] = floorPoint(rnd);
        px(ctx, x, y, 1, 1, "#ffd8a0");
      }
      ctx.globalAlpha = 1;
      if (st === 3) {
        const cx = SCENE_W / 2;
        glow(ctx, cx, 8, 22, 12, "#ffd8a0", 0.3);
        px(ctx, cx - 7, 1, 14, 1, "#c8a060");
        px(ctx, cx - 7, 15, 14, 1, "#c8a060");
        px(ctx, cx - 6, 2, 12, 2, "#8ab0d0");
        px(ctx, cx - 3, 4, 6, 3, "#8ab0d0");
        px(ctx, cx - 1, 7, 2, 2, "#ffd8a0");
        px(ctx, cx - 3, 9, 6, 3, "#8ab0d0");
        px(ctx, cx - 6, 12, 12, 3, "#ffd8a0");
        line(ctx, "#ffffff", cx - 5, 3, cx + 4, 13);
        px(ctx, cx + 9, 6, 3, 2, "#8ab0d0");
        px(ctx, cx - 12, 10, 2, 2, "#8ab0d0");
      }
    },
  },
};

/** O tema da sala de cada região (e a cor por cima, quando repete o tema de outra). */
const REGION_ROOM: Readonly<Record<number, { like: string; tint?: string }>> = {
  1: { like: "toca-dos-javalis" },
  2: { like: "galerias-afogadas" },
  3: { like: "mina-assombrada" },
  4: { like: "bosque-petrificado", tint: "#c9a45a" },
  5: { like: "abismo-gelado" },
  6: { like: "cidadela-de-cinzas" },
  7: { like: "galerias-afogadas", tint: "#2a6f8a" },
  8: { like: "cripta-do-musgo", tint: "#6a5a8a" },
  9: { like: "bosque-petrificado", tint: "#e8e0ff" },
  10: { like: "trono-do-vazio" },
  // D69: o fim de jogo, até o 1000 (antes a 11 e a 12 caíam no tema da 1).
  11: { like: "fenda-abissal" },
  12: { like: "trono-do-fim" },
  13: { like: "ermo-de-cinzas" },
  14: { like: "catedral-partida" },
  15: { like: "mar-de-vidro" },
  16: { like: "forja-dos-titas" },
  17: { like: "jardim-das-almas" },
  18: { like: "torre-do-eclipse" },
  19: { like: "coracao-do-abismo" },
  20: { like: "horizonte-final" },
};

/** A sala `st` de uma dungeon: parede com enfeites, chão de lajes, portas dos dois lados. */
export function roomCanvas(dungeon: string, st: number): HTMLCanvasElement {
  // As 20 regiões (§12.2 e D69) usam os temas que existem; as que repetem um tema ganham outra cor.
  const look = REGION_ROOM[dungeonById(dungeon)?.region.index ?? 1] ?? REGION_ROOM[1]!;
  const th = THEMES[look.like] ?? THEMES["cripta-do-musgo"]!;
  const { c, ctx } = canvas(SCENE_W, SCENE_H);
  const rnd = seeded(hash(`${dungeon}|${st}`));
  // Chão: lajes de 16 px com rejunte, umas mais claras, umas lascadas.
  for (let ty = 1; ty < SCENE_H / TILE; ty++) {
    for (let tx = 0; tx < SCENE_W / TILE; tx++) {
      const x = tx * TILE;
      const y = ty * TILE;
      const base = th.floor[(tx + ty) % 2]!;
      px(ctx, x, y, TILE, TILE, rnd() < 0.12 ? shade(base, 0.03) : base);
      px(ctx, x, y, TILE, 1, th.grout);
      px(ctx, x, y, 1, TILE, th.grout);
      if (rnd() < 0.3) px(ctx, x + 3 + Math.floor(rnd() * 9), y + 4 + Math.floor(rnd() * 8), 2, 1, shade(base, -0.06));
    }
  }
  // Parede de cima: tijolos e a sombra que ela joga no chão.
  px(ctx, 0, 0, SCENE_W, FLOOR_Y, th.wall);
  for (let y = 0; y < FLOOR_Y; y += 4) {
    for (let x = (y / 4) % 2 === 0 ? 0 : 6; x < SCENE_W; x += 12) px(ctx, x, y, 1, 4, th.wallDark);
    px(ctx, 0, y, SCENE_W, 1, th.wallDark);
  }
  th.deco(ctx, rnd, st);
  px(ctx, 0, FLOOR_Y, SCENE_W, 2, "rgba(0, 0, 0, 0.35)");
  // Paredes dos lados, com as portas na linha do meio; a borda de baixo.
  const doorY = DOOR_ROW * TILE;
  for (const x of [0, SCENE_W - SIDE]) {
    px(ctx, x, FLOOR_Y, SIDE, SCENE_H - FLOOR_Y, th.wall);
    px(ctx, x, doorY, SIDE, TILE, "#0c0c10");
    px(ctx, x, doorY - 2, SIDE, 2, "#6a4a2e");
    px(ctx, x, doorY + TILE, SIDE, 2, "#6a4a2e");
  }
  px(ctx, 0, SCENE_H - 3, SCENE_W, 3, th.lip);
  if (look.tint) tint(ctx, SCENE_W, SCENE_H, look.tint, 0.35);
  return c;
}
