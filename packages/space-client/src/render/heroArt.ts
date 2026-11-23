import type { AvatarGear, Direction } from "@muchat/space-core";
import { type Element, itemDef } from "@muchat/space-core/game/ot";

import { OUTLINE } from "./pixel.ts";
import { type Palette, DIRS, drawCharacter, FRAMES, palette, SPRITE } from "./sprites.ts";

/**
 * A arte do herói do jogo idle (docs/espaco/jogo/ot), num lugar só para o mapa e para a
 * dungeon vista de cima (etapa O10): o que ele tem na mão pela arma, a arma e o escudo
 * desenhados, a armadura e os efeitos (flecha, virote, orbe, corte...). A arma, o escudo,
 * `heroGear`, `heroFrames`, `ELEMENT_COLOR` e `fxCanvas` vieram da cena da O10 sem mudar o
 * desenho; as quatro direções, a armadura e o escudo arremessado são do treino no mapa.
 * Tudo é nosso, desenhado em código: 16 px de arte, contorno de 1 px, luz de cima à esquerda.
 */

export type Ctx = CanvasRenderingContext2D;

export function artCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: Ctx } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  // Canvas na memória (não na GPU): o contorno lê os pixels, e ler de um canvas acelerado trava a GPU.
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

export function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Contorno de 1 px em volta do que já foi pintado (para fora). */
export function outline(c: HTMLCanvasElement, color = OUTLINE) {
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

// ---- o que o herói tem na mão --------------------------------------------------

/** O que o herói tem na mão, pela arma do equipamento. */
export type HeroLook = "espada" | "machado" | "maca" | "arco" | "besta" | "varinha" | "cajado" | "punhos";

export interface HeroGear {
  look: HeroLook;
  /** Elemento do tiro da varinha (os outros batem no físico). */
  element: Element;
  shield: boolean;
}

export function heroGear(weapon: string | null | undefined, shield: string | null | undefined): HeroGear {
  const it = weapon ? itemDef(weapon) : undefined;
  let look: HeroLook = "punhos";
  let element: Element = "fisico";
  if (it) {
    switch (it.kind) {
      case "espada":
      case "machado":
      case "maca":
        look = it.kind;
        break;
      case "distancia":
        look = it.id.includes("besta") ? "besta" : "arco";
        break;
      case "varinha":
        look = /cajado|bastao/.test(it.id) ? "cajado" : "varinha";
        element = it.wand?.element ?? "energia";
        break;
      default:
        // Arma do kit sem tipo (a espada curta do arqueiro): luta com os punhos [run.ts weaponSkill].
        look = it.id.includes("espada") ? "espada" : "punhos";
    }
  }
  return { look, element, shield: !!shield };
}

export function isRanged(look: HeroLook): boolean {
  return look === "arco" || look === "besta" || look === "varinha" || look === "cajado";
}

/** Cor do número de dano pelo elemento; o físico é o sangue. */
export const ELEMENT_COLOR: Readonly<Record<Element | "cura", number>> = {
  fisico: 0xff6a5c,
  fogo: 0xff9a3c,
  gelo: 0x8fd8ff,
  energia: 0xc98cff,
  terra: 0x9ee35a,
  morte: 0xb5a6cc,
  sagrado: 0xffe27a,
  cura: 0x63e68a,
};

// ---- arma e escudo ---------------------------------------------------------------

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

/** As cores do escudo: o de tábuas (o da cena) e os outros pelo material. */
const SHIELD_COLORS: Readonly<Record<string, readonly [string, string, string]>> = {
  "escudo-de-tabuas": ["#8a5a34", "#b9823f", "#d7dce6"],
  "escudo-de-bronze": ["#a8742f", "#e0b25a", "#fff0c0"],
  "escudo-de-aco": ["#7f8796", "#c3cad6", "#f1f1f4"],
  "escudo-da-forja": ["#9a3f26", "#e07a3c", "#ffd27a"],
};

function shieldColors(item?: string): readonly [string, string, string] {
  return (item && SHIELD_COLORS[item]) || SHIELD_COLORS["escudo-de-tabuas"]!;
}

/** Escudo no braço de trás (virado para a direita, é o lado de dentro). */
function shield(ctx: Ctx, item?: string) {
  const [body, rim, boss] = shieldColors(item);
  px(ctx, 3, 7, 3, 5, body);
  px(ctx, 3, 7, 3, 1, rim);
  px(ctx, 4, 9, 1, 1, boss);
}

/** Desenha `fn` espelhado na horizontal, numa célula de SPRITE px. */
function mirrored(ctx: Ctx, fn: (ctx: Ctx) => void) {
  ctx.save();
  ctx.translate(SPRITE, 0);
  ctx.scale(-1, 1);
  fn(ctx);
  ctx.restore();
}

/** Quadros do herói: [parado, passo A, passo B] para a direita e [parado] de frente. */
export function heroFrames(pal: number, g: HeroGear): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let f = 0; f < 3; f++) {
    const { c, ctx } = artCanvas(SPRITE, SPRITE);
    if (g.shield) shield(ctx);
    drawCharacter(ctx, 0, 0, "right", f, palette(pal));
    weapon(ctx, g.look);
    out.push(c);
  }
  const { c, ctx } = artCanvas(SPRITE, SPRITE);
  drawCharacter(ctx, 0, 0, "down", 0, palette(pal));
  out.push(c);
  return out;
}

// ---- armadura (o treino no mapa) -----------------------------------------------

/** A cor de cada peça pelo material [nosso]: couro, escamas, malha, placa, túnica, manto. */
const WEAR: Readonly<Record<string, string>> = {
  "capuz-de-couro": "#8a5a34",
  "elmo-de-ferro": "#9aa3ad",
  "elmo-de-aco": "#d0d6de",
  "gibao-de-couro": "#8a5a34",
  "colete-de-escamas": "#5f7a5a",
  "cota-de-malha": "#9aa3ad",
  "placa-de-ferreiro": "#cfd5dd",
  "tunica-de-linho": "#e8e3d3",
  "manto-azul": "#3f5fbf",
  "calca-de-couro": "#6e4a2b",
  "calca-de-malha": "#8f98a3",
  "botas-de-couro": "#4a3020",
  "botas-de-viajante": "#2f3a44",
};
/** Túnica e manto descem até os pés: a calça fica da cor deles. */
const ROBES = new Set(["tunica-de-linho", "manto-azul"]);
const METAL_HELMS = new Set(["elmo-de-ferro", "elmo-de-aco"]);

function wear(item: string | undefined): string | null {
  if (!item) return null;
  return WEAR[item] ?? "#8f98a3";
}

/** A paleta do avatar com a armadura por cima (camisa, calça, sapato; o capacete cobre o cabelo). */
export function armoredPalette(base: Palette, gear: AvatarGear): Palette {
  const body = wear(gear.body);
  const legs = wear(gear.legs);
  const feet = wear(gear.feet);
  const head = wear(gear.head);
  const robe = gear.body && ROBES.has(gear.body) ? body : null;
  return {
    skin: base.skin,
    hair: head ?? base.hair,
    shirt: body ?? base.shirt,
    pants: robe ?? legs ?? base.pants,
    shoes: feet ?? base.shoes,
  };
}

/** Brilho do elmo de metal (a luz vem de cima à esquerda). */
function helmShine(ctx: Ctx, dir: Direction, item?: string) {
  if (!item || !METAL_HELMS.has(item)) return;
  px(ctx, dir === "right" ? 6 : 5, 1, 2, 1, "#f1f3f7");
  if (dir === "down") px(ctx, 5, 3, 6, 1, "#5d6470");
}

/**
 * Uma célula do avatar equipado: o boneco com a armadura, a arma na mão da frente e o escudo
 * no outro braço, na direção e no quadro pedidos.
 */
export function drawEquipped(ctx: Ctx, dir: Direction, frame: number, pal: Palette, gear: AvatarGear) {
  const g = heroGear(gear.weapon, gear.shield);
  const p = armoredPalette(pal, gear);
  switch (dir) {
    case "right":
      if (g.shield) shield(ctx, gear.shield);
      drawCharacter(ctx, 0, 0, "right", frame, p);
      helmShine(ctx, dir, gear.head);
      weapon(ctx, g.look);
      break;
    case "left":
      if (g.shield) mirrored(ctx, (c) => shield(c, gear.shield));
      drawCharacter(ctx, 0, 0, "left", frame, p);
      helmShine(ctx, dir, gear.head);
      mirrored(ctx, (c) => weapon(c, g.look));
      break;
    case "down":
      drawCharacter(ctx, 0, 0, "down", frame, p);
      helmShine(ctx, dir, gear.head);
      weapon(ctx, g.look);
      // De frente, o escudo fica no braço do outro lado da arma (à esquerda da tela).
      if (g.shield) shield(ctx, gear.shield);
      break;
    case "up":
      // De costas, a arma passa para a esquerda da tela (atrás) e o escudo para a direita.
      mirrored(ctx, (c) => weapon(c, g.look));
      drawCharacter(ctx, 0, 0, "up", frame, p);
      helmShine(ctx, dir, gear.head);
      if (g.shield) mirrored(ctx, (c) => shield(c, gear.shield));
      break;
  }
}

/** A folha do avatar equipado no formato da `characterSheet` (4 direções × 3 quadros). */
export function equippedSheet(pal: Palette, gear: AvatarGear): HTMLCanvasElement {
  const { c: sheet, ctx: out } = artCanvas(SPRITE * DIRS.length * FRAMES, SPRITE);
  DIRS.forEach((dir, d) => {
    for (let f = 0; f < FRAMES; f++) {
      const { c, ctx } = artCanvas(SPRITE, SPRITE);
      drawEquipped(ctx, dir, f, pal, gear);
      out.drawImage(c, (d * FRAMES + f) * SPRITE, 0);
    }
  });
  return sheet;
}

/** Chave estável do que aparece no avatar (para não refazer a folha à toa). */
export function gearKey(gear: AvatarGear): string {
  return [gear.weapon, gear.shield, gear.head, gear.body, gear.legs, gear.feet].map((x) => x ?? "").join("|");
}

// ---- efeitos ---------------------------------------------------------------------

export type FxArt = "flecha" | "virote" | "orbe" | "lanca" | "estrela" | "faisca" | "fumaca" | "corte" | "saco" | "moedas" | "escudo";

/** Efeitos em branco (o tom do elemento entra pelo `tint`), menos fumaça, saco, moedas e escudo. */
export function fxCanvas(k: FxArt): HTMLCanvasElement {
  switch (k) {
    case "flecha": {
      const { c, ctx } = artCanvas(8, 3);
      px(ctx, 1, 1, 5, 1, "#c8a26a");
      px(ctx, 6, 0, 1, 3, "#d7dce6");
      px(ctx, 7, 1, 1, 1, "#d7dce6");
      px(ctx, 0, 0, 1, 1, "#e8e0cf");
      px(ctx, 0, 2, 1, 1, "#e8e0cf");
      return c;
    }
    case "virote": {
      const { c, ctx } = artCanvas(6, 3);
      px(ctx, 0, 1, 4, 1, "#8a5a34");
      px(ctx, 4, 0, 2, 3, "#9aa3b2");
      return c;
    }
    case "orbe": {
      const { c, ctx } = artCanvas(6, 6);
      px(ctx, 1, 0, 4, 6, "#ffffff");
      px(ctx, 0, 1, 6, 4, "#ffffff");
      return c;
    }
    case "lanca": {
      const { c, ctx } = artCanvas(10, 3);
      px(ctx, 0, 1, 7, 1, "#ffffff");
      px(ctx, 7, 0, 2, 3, "#ffffff");
      px(ctx, 9, 1, 1, 1, "#ffffff");
      return c;
    }
    case "estrela": {
      const { c, ctx } = artCanvas(12, 12);
      ctx.globalAlpha = 0.85;
      px(ctx, 5, 0, 2, 12, "#ffffff");
      px(ctx, 0, 5, 12, 2, "#ffffff");
      px(ctx, 3, 3, 6, 6, "#ffffff");
      ctx.globalAlpha = 1;
      px(ctx, 4, 4, 4, 4, "#ffffff");
      return c;
    }
    case "faisca": {
      const { c, ctx } = artCanvas(5, 5);
      px(ctx, 2, 0, 1, 5, "#ffffff");
      px(ctx, 0, 2, 5, 1, "#ffffff");
      return c;
    }
    case "fumaca": {
      const { c, ctx } = artCanvas(9, 7);
      px(ctx, 2, 1, 5, 5, "#c8ccd6");
      px(ctx, 1, 2, 7, 3, "#c8ccd6");
      px(ctx, 0, 3, 9, 2, "#aeb3c0");
      px(ctx, 3, 1, 2, 1, "#eceef3");
      return c;
    }
    case "corte": {
      const { c, ctx } = artCanvas(12, 12);
      for (let i = 0; i < 10; i++) px(ctx, 1 + i, 10 - i, 2, 1, "#ffffff");
      return c;
    }
    case "saco": {
      const { c, ctx } = artCanvas(9, 9);
      px(ctx, 2, 3, 5, 6, "#8a5a34");
      px(ctx, 1, 4, 7, 4, "#8a5a34");
      px(ctx, 3, 2, 3, 1, "#5e3c22");
      px(ctx, 3, 0, 3, 2, "#a8743f");
      px(ctx, 2, 4, 1, 2, "#b9823f");
      outline(c);
      return c;
    }
    case "moedas": {
      const { c, ctx } = artCanvas(7, 5);
      px(ctx, 0, 2, 3, 3, "#ffd23c");
      px(ctx, 3, 1, 4, 4, "#f0c03a");
      px(ctx, 2, 0, 3, 2, "#ffe27a");
      px(ctx, 1, 3, 1, 1, "#b9823f");
      px(ctx, 5, 3, 1, 1, "#b9823f");
      outline(c);
      return c;
    }
    case "escudo": {
      // O escudo arremessado do cavaleiro (o treino no mapa): redondo, visto de frente.
      const { c, ctx } = artCanvas(7, 7);
      px(ctx, 1, 0, 5, 7, "#8a5a34");
      px(ctx, 0, 1, 7, 5, "#8a5a34");
      px(ctx, 1, 1, 5, 1, "#b9823f");
      px(ctx, 3, 3, 1, 1, "#d7dce6");
      outline(c);
      return c;
    }
  }
}
