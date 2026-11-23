import { drawCharacter, palette } from "../render/sprites.ts";
import { OUTLINE, shade } from "../render/pixel.ts";
import { DOOR_ROW, type HeroGear, type HeroLook, SCENE_H, SCENE_W, TILE } from "./script.ts";

/**
 * Arte da dungeon vista de cima (docs/espaco/jogo/ot, etapa O10), desenhada em código no estilo
 * do Espaço: 16 px de arte por tile, contorno de 1 px, luz de cima à esquerda. Tudo é nosso
 * (nada de sprite, nome ou mapa do Tibia). Cada função pinta num canvas na escala 1; a cena
 * amplia com "nearest" e destrói só as texturas que criou a partir destes canvas.
 */

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: Ctx } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Contorno de 1 px em volta do que já foi pintado (para fora). */
function outline(c: HTMLCanvasElement, color = OUTLINE) {
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= c.width || y >= c.height ? 0 : img.data[(y * c.width + x) * 4 + 3]!);
  ctx.fillStyle = color;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (a(x, y) > 0) continue;
      if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) ctx.fillRect(x, y, 1, 1);
    }
  }
}

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

/** A arma na mão da frente do herói virado para a direita. */
function weapon(ctx: Ctx, look: HeroLook) {
  switch (look) {
    case "espada":
      px(ctx, 12, 3, 1, 7, "#d7dce6");
      px(ctx, 13, 3, 1, 1, "#f1f1f4");
      px(ctx, 11, 10, 3, 1, "#b9823f");
      px(ctx, 12, 11, 1, 2, "#6a4a2e");
      break;
    case "machado":
      px(ctx, 12, 3, 1, 10, "#6a4a2e");
      px(ctx, 13, 3, 2, 4, "#c3cad6");
      px(ctx, 14, 4, 1, 2, "#e8ebf0");
      break;
    case "maca":
      px(ctx, 12, 7, 1, 6, "#6a4a2e");
      px(ctx, 11, 4, 3, 3, "#8c909d");
      px(ctx, 12, 3, 1, 1, "#8c909d");
      px(ctx, 11, 4, 1, 1, "#c3cad6");
      break;
    case "arco":
      px(ctx, 13, 3, 1, 10, "#8a5a2e");
      px(ctx, 12, 2, 1, 1, "#8a5a2e");
      px(ctx, 12, 13, 1, 1, "#8a5a2e");
      px(ctx, 12, 3, 1, 10, "#e8e0cf");
      break;
    case "besta":
      px(ctx, 11, 8, 4, 1, "#6a4a2e");
      px(ctx, 14, 5, 1, 7, "#9aa3b2");
      px(ctx, 13, 6, 1, 5, "#e8e0cf");
      break;
    case "varinha":
      px(ctx, 12, 7, 1, 5, "#3a2a20");
      px(ctx, 12, 5, 1, 2, "#2ee6ff");
      px(ctx, 13, 5, 1, 1, "#bff8ff");
      break;
    case "cajado":
      px(ctx, 12, 1, 1, 14, "#6a4a2e");
      px(ctx, 11, 0, 3, 2, "#4dff7a");
      px(ctx, 12, 0, 1, 1, "#d7ffe0");
      break;
    case "punhos":
      break;
  }
}

/** Escudo no braço de trás (virado para a direita, é o lado de dentro). */
function shield(ctx: Ctx) {
  px(ctx, 3, 7, 3, 5, "#8a5a34");
  px(ctx, 3, 7, 3, 1, "#b9823f");
  px(ctx, 4, 9, 1, 1, "#d7dce6");
}

/** Quadros do herói: [parado, passo A, passo B] para a direita e [parado] de frente. */
export function heroFrames(pal: number, g: HeroGear): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let f = 0; f < 3; f++) {
    const { c, ctx } = canvas(TILE, TILE);
    if (g.shield) shield(ctx);
    drawCharacter(ctx, 0, 0, "right", f, palette(pal));
    weapon(ctx, g.look);
    out.push(c);
  }
  const { c, ctx } = canvas(TILE, TILE);
  drawCharacter(ctx, 0, 0, "down", 0, palette(pal));
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
  return boss || BIG.has(id) ? 32 : 16;
}
const BIG = new Set(["matriarca-do-musgo", "rei-das-comportas", "guardiao-da-forja"]);

type Painter = (ctx: Ctx) => void;

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
  const paint = MONSTERS[id];
  if (paint && (s === 32) === BIG.has(id)) paint(ctx);
  else generic(ctx, id, s);
  outline(c);
  if (id === "morcego-da-cripta") px(ctx, 5, 14, 6, 1, "rgba(0, 0, 0, 0.35)");
  return c;
}

/** Sem poça: o que não sangra. */
const DRY = new Set(["ossada-inquieta", "automato-de-ferro", "brasa-viva", "guardiao-da-forja"]);
const POOL: Record<string, string> = {
  "serpente-da-comporta": "#1f5f80",
  "rei-das-comportas": "#1f5f80",
  "troll-do-lodo": "#4f5c2a",
  "matriarca-do-musgo": "#2d7336",
};

/** O corpo do monstro: achatado, escuro, numa poça (o saco de loot cai por cima). */
export function corpseCanvas(id: string, body: HTMLCanvasElement): HTMLCanvasElement {
  const s = body.width;
  const { c, ctx } = canvas(s, s);
  if (!DRY.has(id)) {
    ctx.fillStyle = POOL[id] ?? "#5a1e24";
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

// ---- efeitos -----------------------------------------------------------------

export type FxArt = "flecha" | "virote" | "orbe" | "lanca" | "estrela" | "faisca" | "fumaca" | "corte" | "saco" | "moedas";

/** Efeitos em branco (o tom do elemento entra pelo `tint`), menos fumaça, saco e moedas. */
export function fxCanvas(k: FxArt): HTMLCanvasElement {
  switch (k) {
    case "flecha": {
      const { c, ctx } = canvas(8, 3);
      px(ctx, 1, 1, 5, 1, "#c8a26a");
      px(ctx, 6, 0, 1, 3, "#d7dce6");
      px(ctx, 7, 1, 1, 1, "#d7dce6");
      px(ctx, 0, 0, 1, 1, "#e8e0cf");
      px(ctx, 0, 2, 1, 1, "#e8e0cf");
      return c;
    }
    case "virote": {
      const { c, ctx } = canvas(6, 3);
      px(ctx, 0, 1, 4, 1, "#8a5a34");
      px(ctx, 4, 0, 2, 3, "#9aa3b2");
      return c;
    }
    case "orbe": {
      const { c, ctx } = canvas(6, 6);
      px(ctx, 1, 0, 4, 6, "#ffffff");
      px(ctx, 0, 1, 6, 4, "#ffffff");
      return c;
    }
    case "lanca": {
      const { c, ctx } = canvas(10, 3);
      px(ctx, 0, 1, 7, 1, "#ffffff");
      px(ctx, 7, 0, 2, 3, "#ffffff");
      px(ctx, 9, 1, 1, 1, "#ffffff");
      return c;
    }
    case "estrela": {
      const { c, ctx } = canvas(12, 12);
      ctx.globalAlpha = 0.85;
      px(ctx, 5, 0, 2, 12, "#ffffff");
      px(ctx, 0, 5, 12, 2, "#ffffff");
      px(ctx, 3, 3, 6, 6, "#ffffff");
      ctx.globalAlpha = 1;
      px(ctx, 4, 4, 4, 4, "#ffffff");
      return c;
    }
    case "faisca": {
      const { c, ctx } = canvas(5, 5);
      px(ctx, 2, 0, 1, 5, "#ffffff");
      px(ctx, 0, 2, 5, 1, "#ffffff");
      return c;
    }
    case "fumaca": {
      const { c, ctx } = canvas(9, 7);
      px(ctx, 2, 1, 5, 5, "#c8ccd6");
      px(ctx, 1, 2, 7, 3, "#c8ccd6");
      px(ctx, 0, 3, 9, 2, "#aeb3c0");
      px(ctx, 3, 1, 2, 1, "#eceef3");
      return c;
    }
    case "corte": {
      const { c, ctx } = canvas(12, 12);
      for (let i = 0; i < 10; i++) px(ctx, 1 + i, 10 - i, 2, 1, "#ffffff");
      return c;
    }
    case "saco": {
      const { c, ctx } = canvas(9, 9);
      px(ctx, 2, 3, 5, 6, "#8a5a34");
      px(ctx, 1, 4, 7, 4, "#8a5a34");
      px(ctx, 3, 2, 3, 1, "#5e3c22");
      px(ctx, 3, 0, 3, 2, "#a8743f");
      px(ctx, 2, 4, 1, 2, "#b9823f");
      outline(c);
      return c;
    }
    case "moedas": {
      const { c, ctx } = canvas(7, 5);
      px(ctx, 0, 2, 3, 3, "#ffd23c");
      px(ctx, 3, 1, 4, 4, "#f0c03a");
      px(ctx, 2, 0, 3, 2, "#ffe27a");
      px(ctx, 1, 3, 1, 1, "#b9823f");
      px(ctx, 5, 3, 1, 1, "#b9823f");
      outline(c);
      return c;
    }
  }
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
};

/** A sala `st` de uma dungeon: parede com enfeites, chão de lajes, portas dos dois lados. */
export function roomCanvas(dungeon: string, st: number): HTMLCanvasElement {
  const th = THEMES[dungeon] ?? THEMES["cripta-do-musgo"]!;
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
  return c;
}
