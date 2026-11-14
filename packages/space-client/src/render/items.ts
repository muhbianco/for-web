import {
  alpha,
  ART_PX,
  bevel,
  block,
  cushion,
  DARK,
  DARKER,
  disc,
  dot,
  FABRIC,
  foliage,
  type G,
  glow,
  LEAF,
  legs,
  METAL,
  NEON,
  OUTLINE,
  outline,
  pick,
  pot,
  rect,
  screen,
  shade,
  TERRACOTTA,
  WHITE,
  WOOD,
} from "./pixel.ts";

/**
 * The art of every catalog item (space-core decor/catalog.ts), one drawing per
 * id. `tall` is the headroom in tiles above the footprint, for backrests,
 * shelves and lamps seen slightly from the front. Facings: 0 down (we see the
 * front), 1 left, 2 up (we see the back), 3 right. Items with 2 rotations
 * receive the transposed footprint and draw it as is.
 */
export interface ArtDef {
  tall?: number;
  draw(g: G): void;
}

const T = ART_PX;

const GAMER: Record<string, string> = { "preto-vermelho": "#d2473f", "preto-azul": "#3f6fd6", "branco-rosa": "#ff6fb0" };
const POT: Record<string, string> = { "vaso-terracota": TERRACOTTA, "vaso-branco": "#e6e3dc", "vaso-preto": "#35363f" };
const LOCKER: Record<string, string> = { azul: "#3c6ec0", verde: "#3f9b6a", cinza: "#7f8592" };
const WHITE_BLACK: Record<string, string> = { preto: "#30313b", branco: "#e8e8ec" };
const RED_BLUE: Record<string, string> = { vermelho: "#c9403a", azul: "#3b63c4", roxo: "#7a4fd0", amarelo: "#e2b23a" };

// ---- shared pieces -----------------------------------------------------------

/** Sofa or armchair: seats along the length, backrest away from the facing. */
function sofa(g: G, seats: number) {
  const c = pick(FABRIC, g.variant);
  const back = shade(c, -0.25);
  const horizontal = g.rot % 2 === 0;
  if (horizontal) {
    const x0 = 0;
    const W = seats * T;
    const y0 = g.top;
    if (g.rot === 0) {
      // Backrest rises into the headroom; seats in front.
      outline(g, x0, y0 - 6, W, T + 6);
      bevel(g, x0 + 1, y0 - 5, W - 2, 7, back);
      rect(g, x0 + 1, y0 + 1, W - 2, T - 3, c);
      for (let s = 0; s < seats; s++) cushion(g, x0 + 2 + s * T, y0 + 3, T - 4, T - 6, shade(c, 0.05));
      bevel(g, x0 + 1, y0 + 1, 2, T - 2, back);
      bevel(g, x0 + W - 3, y0 + 1, 2, T - 2, back);
      legs(g, x0, y0 + T - 2, W, DARKER);
    } else {
      // Facing up: we see the back of the backrest at the bottom.
      outline(g, x0, y0 - 2, W, T + 2);
      rect(g, x0 + 1, y0 - 1, W - 2, T - 6, c);
      for (let s = 0; s < seats; s++) cushion(g, x0 + 2 + s * T, y0, T - 4, T - 8, shade(c, 0.05));
      bevel(g, x0 + 1, y0 + T - 7, W - 2, 6, back);
      bevel(g, x0 + 1, y0 - 1, 2, T - 7, back);
      bevel(g, x0 + W - 3, y0 - 1, 2, T - 7, back);
    }
    return;
  }
  // Vertical: footprint 1 wide, `seats` tall. Backrest on the side we do not face.
  const H = seats * T;
  const y0 = g.top;
  const backLeft = g.rot === 3; // facing right → backrest on the left
  outline(g, 0, y0 - 2, T, H + 2);
  rect(g, 1, y0 - 1, T - 2, H, c);
  for (let s = 0; s < seats; s++) cushion(g, backLeft ? 6 : 2, y0 + 1 + s * T, T - 8, T - 4, shade(c, 0.05));
  bevel(g, backLeft ? 1 : T - 6, y0 - 1, 5, H, back);
  bevel(g, 1, y0 - 1, T - 2, 2, back);
  bevel(g, 1, y0 + H - 3, T - 2, 2, back);
}

/** Chair with a backrest; `gamer` adds a tall racing back and wheels. */
function chair(g: G, gamer: boolean) {
  const c = gamer ? "#2a2b34" : pick(WOOD, g.variant);
  const accent = gamer ? pick(GAMER, g.variant) : shade(c, 0.2);
  const y0 = g.top;
  const seat = (x: number, y: number, w: number, h: number) => {
    outline(g, x, y, w, h);
    bevel(g, x + 1, y + 1, w - 2, h - 2, gamer ? shade(c, 0.1) : c);
    if (gamer) rect(g, x + 2, y + 2, w - 4, 1, accent);
  };
  const back = (x: number, y: number, w: number, h: number) => {
    outline(g, x, y, w, h);
    bevel(g, x + 1, y + 1, w - 2, h - 2, gamer ? c : shade(c, -0.15));
    if (gamer && h > 3 && w > 3) rect(g, x + 2, y + 2, w - 4, h - 4, accent);
  };
  switch (g.rot) {
    case 0:
      back(3, y0 - (gamer ? 7 : 4), 10, gamer ? 9 : 6);
      seat(3, y0 + 1, 10, 9);
      break;
    case 2:
      seat(3, y0, 10, 9);
      back(3, y0 + 7, 10, gamer ? 8 : 6);
      break;
    case 1:
      seat(3, y0 + 2, 9, 10);
      back(10, y0 - 1, gamer ? 5 : 4, 14);
      break;
    default:
      seat(4, y0 + 2, 9, 10);
      back(1, y0 - 1, gamer ? 5 : 4, 14);
  }
  if (gamer) {
    for (const x of [2, 7, 12]) dot(g, x, y0 + T - 2, DARKER);
    rect(g, 7, y0 + T - 4, 2, 2, METAL);
  } else {
    legs(g, 3, y0 + T - 2, 10, shade(c, -0.4), 0);
  }
}

/** Table top covering the footprint, optionally round. */
function table(g: G, round: boolean) {
  const c = pick(WOOD, g.variant);
  const y0 = g.top;
  if (round) {
    const r = Math.min(g.W, g.H - y0) / 2 - 1;
    const cx = Math.floor(g.W / 2);
    const cy = y0 + Math.floor((g.H - y0) / 2) - 1;
    disc(g, cx, cy + 2, r, OUTLINE);
    disc(g, cx, cy + 2, r - 1, shade(c, -0.2));
    disc(g, cx, cy, r, OUTLINE);
    disc(g, cx, cy, r - 1, c);
    disc(g, cx - 1, cy - 1, Math.max(1, r - 3), shade(c, 0.12));
    return;
  }
  block(g, 1, y0 + 1, g.W - 2, g.H - y0 - 5, 3, c);
  legs(g, 1, y0 + g.H - y0 - 2, g.W - 2, shade(c, -0.4));
}

/** Desk with the given things on it: monitors at the back, keyboard in front. */
function desk(g: G, kind: "plain" | "pc" | "laptop" | "stream") {
  const c = kind === "plain" || kind === "laptop" ? pick(WOOD, g.variant) : "#3a3b47";
  const n = pick(NEON, g.variant);
  const y0 = g.top;
  const horizontal = g.rot % 2 === 0;
  const facingDown = g.rot === 0;
  if (horizontal) {
    block(g, 0, y0 + 2, g.W, T - 7, 4, c);
    legs(g, 0, y0 + T - 2, g.W, shade(c, -0.4));
    if (kind === "plain") return;
    if (kind === "laptop") {
      const x = Math.floor(g.W / 2) - 5;
      if (facingDown) {
        screen(g, x, y0 - 2, 10, 7, "#5aa9e6");
        rect(g, x, y0 + 5, 10, 3, shade(c, -0.5));
        rect(g, x + 2, y0 + 6, 6, 1, METAL);
      } else {
        rect(g, x, y0 + 4, 10, 3, shade(c, -0.5));
        outline(g, x, y0 + 7, 10, 7, DARKER);
        rect(g, x + 1, y0 + 8, 8, 5, "#30323e");
        dot(g, x + 4, y0 + 10, n);
      }
      return;
    }
    // Monitors: two for pc, one wide for stream (plus mic and light).
    const screens = kind === "pc" ? [1, g.W / 2 + 1] : [Math.floor(g.W / 2) - 7];
    const sw = kind === "pc" ? Math.floor(g.W / 2) - 2 : 14;
    for (const sx of screens) {
      if (facingDown) {
        glow(g, sx, y0 - 4, sw, 8, n, 0.25);
        screen(g, sx, y0 - 4, sw, 8, kind === "pc" ? "#3f8fe0" : "#e04f8a");
        rect(g, sx + Math.floor(sw / 2) - 1, y0 + 4, 2, 2, DARKER);
      } else {
        outline(g, sx, y0 + 5, sw, 8, DARKER);
        rect(g, sx + 1, y0 + 6, sw - 2, 6, "#2d2f3a");
        dot(g, sx + 2, y0 + 7, n);
      }
    }
    if (facingDown) {
      // Keyboard, mouse, headset.
      rect(g, 3, y0 + 7, g.W - 12, 3, DARKER);
      for (let x = 4; x < g.W - 10; x += 2) dot(g, x, y0 + 8, n);
      rect(g, g.W - 7, y0 + 7, 3, 3, DARKER);
      dot(g, g.W - 6, y0 + 8, n);
      if (kind === "pc") {
        rect(g, g.W - 4, y0 - 3, 3, 10, DARKER);
        rect(g, g.W - 3, y0 - 1, 1, 6, n);
      }
      if (kind === "stream") {
        rect(g, 2, y0 - 6, 1, 13, METAL); // mic arm
        rect(g, 1, y0 - 7, 3, 4, DARKER);
        disc(g, g.W - 4, y0 - 3, 3, "#f2e4b0"); // ring light
        disc(g, g.W - 4, y0 - 3, 1, WHITE);
        rect(g, g.W - 4, y0, 1, 7, METAL);
      }
    }
    return;
  }
  // Vertical desk (facing left or right).
  block(g, 2, y0 + 1, T - 4, g.H - y0 - 5, 3, c);
  legs(g, 2, y0 + g.H - y0 - 2, T - 4, shade(c, -0.4));
  if (kind === "plain") return;
  const left = g.rot === 1; // facing left → screens on the right edge
  const sx = left ? T - 6 : 1;
  const count = kind === "pc" ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const sy = y0 + 2 + i * Math.floor((g.H - y0) / 2);
    glow(g, sx, sy, 5, 9, n, 0.2);
    outline(g, sx, sy, 5, 9, DARKER);
    rect(g, sx + 1, sy + 1, 3, 7, left ? "#3f8fe0" : "#2d2f3a");
  }
  rect(g, left ? 4 : 9, y0 + 4, 3, g.H - y0 - 10, DARKER);
}

/** Tall storage: body, doors or shelves inside. */
function tallBox(g: G, c: string, inner: (x: number, y: number, w: number, h: number) => void) {
  const y0 = g.top - 10;
  outline(g, 1, y0, g.W - 2, g.H - y0 - 1);
  bevel(g, 2, y0 + 1, g.W - 4, 3, shade(c, 0.15)); // top face
  rect(g, 2, y0 + 4, g.W - 4, g.H - y0 - 6, c);
  inner(2, y0 + 4, g.W - 4, g.H - y0 - 6);
  rect(g, 2, g.H - 3, g.W - 4, 1, shade(c, -0.35));
}

function books(g: G, x: number, y: number, w: number, h: number) {
  const palette = ["#d2473f", "#3f6fd6", "#e2b23a", "#3faa6a", "#8457d8", "#e8e8ec"];
  const rows = Math.max(1, Math.floor(h / 6));
  for (let r = 0; r < rows; r++) {
    const ry = y + 1 + r * 6;
    rect(g, x, ry + 4, w, 1, shade(WOOD.escuro!, -0.3));
    let bx = x + 1;
    let i = r;
    while (bx < x + w - 1) {
      const bw = 1 + (i % 2);
      const bh = 3 + ((i >> 1) % 2);
      rect(g, bx, ry + 4 - bh, bw, bh, palette[i % palette.length]!);
      bx += bw + 1;
      i++;
    }
  }
}

function plant(g: G, tall: boolean) {
  const c = pick(POT, g.variant);
  const y0 = g.top;
  if (tall) {
    pot(g, 4, y0 + 7, 8, 8, c);
    rect(g, 7, y0 - 2, 2, 10, "#5a3d22");
    foliage(g, 8, y0 - 6, 6);
    foliage(g, 4, y0 - 1, 3);
    foliage(g, 12, y0, 3);
  } else {
    pot(g, 5, y0 + 8, 6, 6, c);
    foliage(g, 8, y0 + 4, 4);
    dot(g, 6, y0 + 2, LEAF_HI);
  }
}
const LEAF_HI = "#8fe08c";

/** Frame on the wall holding a picture painted by `motif`. */
function wallFrame(g: G, frameColor: string, motif: (x: number, y: number, w: number, h: number) => void) {
  const x = 2;
  const y = 3;
  const w = g.W - 4;
  const h = T - 7;
  outline(g, x - 1, y - 1, w + 2, h + 2);
  rect(g, x, y, w, h, frameColor);
  motif(x + 1, y + 1, w - 2, h - 2);
  rect(g, x, y + h, w, 1, shade(frameColor, -0.4));
}

function sky(g: G, night: boolean, city: boolean) {
  return (x: number, y: number, w: number, h: number) => {
    const top = night ? "#1b2550" : "#79c3f0";
    const bottom = night ? "#2b3a7a" : "#bfe6fb";
    rect(g, x, y, w, h, top);
    rect(g, x, y + Math.floor(h / 2), w, h - Math.floor(h / 2), bottom);
    if (city) {
      for (let bx = x; bx < x + w; bx += 3) {
        const bh = 2 + ((bx * 7) % 4);
        rect(g, bx, y + h - bh, 2, bh, night ? "#0f1430" : "#6c7a95");
        if (night) dot(g, bx, y + h - bh + 1, "#ffe08a");
      }
    } else {
      rect(g, x, y + h - 2, w, 2, night ? "#1f3a2a" : "#5fae5a");
      if (night) {
        dot(g, x + 2, y + 1, WHITE);
        dot(g, x + w - 3, y + 2, WHITE);
        disc(g, x + w - 4, y + 2, 1, "#f6f1c6");
      } else {
        disc(g, x + 2, y + 2, 1, "#fff3a3");
        rect(g, x + Math.floor(w / 2), y + 2, 3, 1, WHITE);
      }
    }
    // Window cross.
    rect(g, x + Math.floor(w / 2), y, 1, h, shade(WHITE, -0.2));
    rect(g, x, y + Math.floor(h / 2), w, 1, shade(WHITE, -0.2));
  };
}

function rugBorder(g: G, c: string, inset = 0) {
  const y0 = g.top;
  outline(g, inset, y0 + inset, g.W - 2 * inset, g.H - y0 - 2 * inset, shade(c, -0.35));
  rect(g, inset + 1, y0 + inset + 1, g.W - 2 * inset - 2, g.H - y0 - 2 * inset - 2, c);
  outline(g, inset + 2, y0 + inset + 2, g.W - 2 * inset - 4, g.H - y0 - 2 * inset - 4, shade(c, 0.15));
}

function arcadeCabinet(g: G, x: number, w: number, c: string) {
  const y0 = g.top;
  const n = pick(NEON, "ciano");
  if (g.rot === 2) {
    // Back of the cabinet.
    outline(g, x, y0 - 8, w, T + 8);
    bevel(g, x + 1, y0 - 7, w - 2, T + 6, shade(c, -0.35));
    rect(g, x + 2, y0 - 2, w - 4, 1, shade(c, -0.5));
    return;
  }
  outline(g, x, y0 - 10, w, T + 10);
  bevel(g, x + 1, y0 - 9, w - 2, 4, shade(c, 0.1)); // marquee
  rect(g, x + 2, y0 - 8, w - 4, 2, n);
  rect(g, x + 1, y0 - 5, w - 2, T + 4, c);
  glow(g, x + 2, y0 - 4, w - 4, 7, "#6fd3ff", 0.3);
  screen(g, x + 2, y0 - 4, w - 4, 7, "#2a6fd1");
  bevel(g, x + 1, y0 + 4, w - 2, 4, shade(c, -0.1)); // control panel
  for (let i = 0; i < Math.floor((w - 4) / 4); i++) dot(g, x + 3 + i * 4, y0 + 5, i % 2 ? "#ffe08a" : "#ff5d5d");
  rect(g, x + Math.floor(w / 2) - 1, y0 + 4, 1, 3, DARKER);
  rect(g, x + 1, y0 + 9, w - 2, T - 10, shade(c, -0.25));
  rect(g, x + 2, y0 + T - 3, w - 4, 1, DARKER);
}

/** Lamp fixture on the ceiling: glow around a small body. */
function ceilingLight(g: G, c: string, wide: boolean) {
  const cx = Math.floor(g.W / 2);
  const cy = g.top + Math.floor(T / 2);
  glow(g, cx - 7, cy - 7, 14, 14, c, wide ? 0.22 : 0.3);
  disc(g, cx, cy, wide ? 5 : 4, alpha(c, 0.35));
  disc(g, cx, cy, 2, OUTLINE);
  disc(g, cx, cy, 1, shade(c, 0.6));
}

// ---- the library -------------------------------------------------------------

export const ART: Record<string, ArtDef> = {
  // Rugs
  "rug-round": {
    draw(g) {
      const c = pick(FABRIC, g.variant);
      const cx = Math.floor(g.W / 2);
      const cy = g.top + Math.floor((g.H - g.top) / 2);
      disc(g, cx, cy, 15, shade(c, -0.35));
      disc(g, cx, cy, 14, c);
      disc(g, cx, cy, 10, shade(c, 0.12));
      disc(g, cx, cy, 5, c);
    },
  },
  "rug-living": {
    draw(g) {
      const c = pick(FABRIC, g.variant);
      rugBorder(g, shade(c, -0.1));
      for (let y = g.top + 4; y < g.H - 4; y += 4) for (let x = 4; x < g.W - 4; x += 8) rect(g, x + ((y >> 2) % 2) * 4, y, 2, 2, shade(c, 0.2));
    },
  },
  "rug-runner": {
    draw(g) {
      const colors: Record<string, string> = { vermelho: "#a93a3a", azul: "#3b5aa8", cinza: "#7d808c" };
      const c = pick(colors, g.variant);
      rugBorder(g, c, 1);
      const vertical = g.H - g.top > g.W;
      for (let i = 4; i < (vertical ? g.H - g.top : g.W) - 4; i += 6) {
        if (vertical) rect(g, 5, g.top + i, g.W - 10, 1, shade(c, 0.25));
        else rect(g, i, g.top + 5, 1, g.H - g.top - 10, shade(c, 0.25));
      }
    },
  },
  "rug-gamer": {
    draw(g) {
      const n = pick(NEON, g.variant);
      rugBorder(g, "#262733", 0);
      outline(g, 1, g.top + 1, g.W - 2, g.H - g.top - 2, alpha(n, 0.8));
      const cx = Math.floor(g.W / 2);
      const cy = g.top + Math.floor((g.H - g.top) / 2);
      rect(g, cx - 6, cy - 1, 12, 2, alpha(n, 0.5));
      rect(g, cx - 1, cy - 6, 2, 12, alpha(n, 0.5));
    },
  },
  "rug-doormat": {
    draw(g) {
      rugBorder(g, "#8a6a3f", 1);
      for (let x = 4; x < T - 4; x += 3) rect(g, x, g.top + 5, 1, 6, "#6a4f2d");
    },
  },
  "rug-striped": {
    draw(g) {
      const colors: Record<string, string> = { areia: "#d8c9a5", marinho: "#2f4a7d" };
      const c = pick(colors, g.variant);
      rugBorder(g, c, 0);
      for (let y = g.top + 3; y < g.H - 3; y += 4) rect(g, 3, y, g.W - 6, 2, shade(c, g.variant === "marinho" ? 0.25 : -0.2));
    },
  },

  // Furniture
  "sofa-2": { tall: 1, draw: (g) => sofa(g, 2) },
  "sofa-3": { tall: 1, draw: (g) => sofa(g, 3) },
  armchair: { tall: 1, draw: (g) => sofa(g, 1) },
  beanbag: {
    draw(g) {
      const c = pick(FABRIC, g.variant);
      disc(g, 8, g.top + 9, 6, OUTLINE);
      disc(g, 8, g.top + 9, 5, c);
      disc(g, 7, g.top + 7, 3, shade(c, 0.15));
      rect(g, 5, g.top + 11, 6, 1, shade(c, -0.25));
    },
  },
  "coffee-table": { draw: (g) => table(g, false) },
  "table-round": { draw: (g) => table(g, true) },
  "table-square": { draw: (g) => table(g, false) },
  "dining-table": { draw: (g) => table(g, false) },
  "meeting-table": {
    draw(g) {
      table(g, false);
      const c = pick(WOOD, g.variant);
      rect(g, 4, g.top + 4, g.W - 8, 1, shade(c, -0.15));
    },
  },
  chair: { tall: 1, draw: (g) => chair(g, false) },
  "gaming-chair": { tall: 1, draw: (g) => chair(g, true) },
  stool: {
    draw(g) {
      const c = pick(WOOD, g.variant);
      disc(g, 8, g.top + 7, 5, OUTLINE);
      disc(g, 8, g.top + 7, 4, c);
      disc(g, 7, g.top + 6, 2, shade(c, 0.15));
      legs(g, 3, g.top + 12, 10, shade(c, -0.4), 0);
    },
  },
  desk: { tall: 1, draw: (g) => desk(g, "plain") },
  bookshelf: {
    tall: 1,
    draw(g) {
      const c = pick(WOOD, g.variant);
      tallBox(g, c, (x, y, w, h) => books(g, x, y, w, h));
    },
  },
  cabinet: {
    tall: 1,
    draw(g) {
      const c = pick(WOOD, g.variant);
      tallBox(g, c, (x, y, w, h) => {
        rect(g, x + Math.floor(w / 2), y, 1, h, shade(c, -0.35));
        dot(g, x + Math.floor(w / 2) - 2, y + Math.floor(h / 2), METAL);
        dot(g, x + Math.floor(w / 2) + 1, y + Math.floor(h / 2), METAL);
      });
    },
  },
  locker: {
    tall: 1,
    draw(g) {
      const c = pick(LOCKER, g.variant);
      tallBox(g, c, (x, y, w, h) => {
        rect(g, x + 2, y + 2, w - 4, 2, shade(c, -0.4));
        rect(g, x + 2, y + 5, w - 4, 2, shade(c, -0.4));
        rect(g, x + w - 4, y + Math.floor(h / 2), 1, 3, METAL);
      });
    },
  },
  counter: {
    tall: 1,
    draw(g) {
      const c = pick(WOOD, g.variant);
      block(g, 0, g.top - 4, g.W, 5, g.H - g.top - 2, c);
      for (let x = 3; x < g.W - 3; x += 6) rect(g, x, g.top + 4, 3, g.H - g.top - 8, shade(c, -0.2));
      rect(g, 1, g.top - 3, g.W - 2, 1, shade(c, 0.35));
    },
  },
  "bar-shelf": {
    tall: 1,
    draw(g) {
      const c = pick(WOOD, g.variant);
      tallBox(g, c, (x, y, w, h) => {
        const bottles = ["#4fa36f", "#d2a63f", "#c9403a", "#5aa9e6", "#e8e8ec"];
        for (let row = 0; row < 2; row++) {
          const ry = y + 2 + row * Math.floor(h / 2);
          rect(g, x, ry + 5, w, 1, shade(c, -0.3));
          for (let i = 0; i < Math.floor(w / 3); i++) {
            rect(g, x + 1 + i * 3, ry + 1, 2, 4, bottles[(i + row) % bottles.length]!);
            dot(g, x + 1 + i * 3, ry, DARKER);
          }
        }
      });
    },
  },

  // Gamer
  "desk-pc": { tall: 1, draw: (g) => desk(g, "pc") },
  "desk-laptop": { tall: 1, draw: (g) => desk(g, "laptop") },
  "desk-stream": { tall: 1, draw: (g) => desk(g, "stream") },
  "pc-tower": {
    tall: 1,
    draw(g) {
      const n = pick(NEON, g.variant);
      outline(g, 4, g.top - 6, 8, T + 5);
      bevel(g, 5, g.top - 5, 6, T + 3, "#2c2d38");
      rect(g, 6, g.top - 3, 4, 1, n);
      rect(g, 6, g.top, 4, 6, alpha(n, 0.4));
      dot(g, 7, g.top + 8, n);
    },
  },
  "tv-stand": {
    tall: 1,
    draw(g) {
      const y0 = g.top;
      if (g.rot % 2 === 0) {
        block(g, 0, y0 + 6, g.W, 4, 5, "#3a3b47");
        if (g.rot === 0) {
          glow(g, 2, y0 - 7, g.W - 4, 12, "#6fd3ff", 0.25);
          screen(g, 2, y0 - 7, g.W - 4, 12, "#3b86d9");
          rect(g, 4, y0 - 5, 3, 2, "#e8e8ec");
        } else {
          outline(g, 2, y0 - 6, g.W - 4, 12, DARKER);
          rect(g, 3, y0 - 5, g.W - 6, 10, "#2a2b36");
          dot(g, g.W - 5, y0 + 2, "#ff5d5d");
        }
        rect(g, Math.floor(g.W / 2) - 2, y0 + 4, 4, 2, DARKER);
      } else {
        block(g, 3, y0 + 1, T - 6, 3, g.H - y0 - 6, "#3a3b47");
        const left = g.rot === 1;
        outline(g, left ? 9 : 4, y0 - 2, 3, g.H - y0 - 2, DARKER);
        rect(g, left ? 10 : 5, y0 - 1, 1, g.H - y0 - 4, left ? "#3b86d9" : "#2a2b36");
      }
    },
  },
  "tv-wall": {
    draw(g) {
      outline(g, 2, 2, g.W - 4, T - 5);
      glow(g, 3, 3, g.W - 6, T - 7, "#6fd3ff", 0.2);
      screen(g, 3, 3, g.W - 6, T - 7, "#3b86d9");
      rect(g, 5, 5, 4, 2, "#e8e8ec");
      rect(g, Math.floor(g.W / 2) - 3, T - 3, 6, 1, DARKER);
    },
  },
  "console-shelf": {
    draw(g) {
      const c = pick(WHITE_BLACK, g.variant);
      block(g, 1, g.top + 3, T - 2, 4, 8, "#3a3b47");
      rect(g, 3, g.top + 1, 10, 3, c);
      dot(g, 4, g.top + 2, "#4dff7a");
      rect(g, 3, g.top + 9, 4, 3, "#c9403a");
      rect(g, 8, g.top + 9, 4, 3, "#3b63c4");
    },
  },
  arcade: { tall: 1, draw: (g) => arcadeCabinet(g, 1, T - 2, pick(RED_BLUE, g.variant)) },
  "arcade-double": {
    tall: 1,
    draw(g) {
      const colors: Record<string, string> = { preto: "#2b2c38", vermelho: "#c9403a" };
      arcadeCabinet(g, 0, g.W, pick(colors, g.variant));
      if (g.rot !== 2) rect(g, Math.floor(g.W / 2), g.top - 4, 1, T + 2, DARKER);
    },
  },
  pinball: {
    tall: 1,
    draw(g) {
      const c = pick(RED_BLUE, g.variant);
      const y0 = g.top;
      if (g.rot % 2 === 0) {
        // Playfield seen from above, backbox at the far end.
        const backTop = g.rot === 0;
        outline(g, 2, y0 - 6, T - 4, g.H - y0 + 5);
        bevel(g, 3, backTop ? y0 - 5 : g.H - 9, T - 6, 7, shade(c, -0.1));
        if (backTop) glow(g, 4, y0 - 4, T - 8, 4, "#ffe08a", 0.4);
        rect(g, 3, backTop ? y0 + 2 : y0 - 5, T - 6, g.H - y0 - 4, "#2b2c38");
        rect(g, 4, backTop ? y0 + 3 : y0 - 4, T - 8, g.H - y0 - 6, "#3b63c4");
        for (let i = 0; i < 5; i++) dot(g, 5 + ((i * 3) % 7), y0 + 5 + i * 3, i % 2 ? "#ffe08a" : "#ff5d5d");
        rect(g, 3, g.H - 3, T - 6, 1, shade(c, -0.4));
      } else {
        outline(g, 0, y0 - 4, g.W, T + 3);
        bevel(g, 1, y0 - 3, g.W - 2, T + 1, shade(c, -0.1));
        rect(g, 3, y0, g.W - 6, T - 6, "#3b63c4");
      }
    },
  },
  speaker: {
    draw(g) {
      const c = pick(WHITE_BLACK, g.variant);
      outline(g, 4, g.top + 1, 8, T - 2);
      bevel(g, 5, g.top + 2, 6, T - 4, c);
      disc(g, 8, g.top + 10, 2, shade(c, -0.5));
      disc(g, 8, g.top + 5, 1, shade(c, -0.5));
    },
  },
  "mic-stand": {
    tall: 1,
    draw(g) {
      rect(g, 7, g.top - 4, 2, T + 2, METAL);
      rect(g, 3, g.top + T - 3, 10, 2, DARKER);
      outline(g, 5, g.top - 9, 6, 7);
      bevel(g, 6, g.top - 8, 4, 5, "#4a4b57");
      rect(g, 6, g.top - 7, 4, 1, shade(METAL, 0.3));
    },
  },
  "vr-stand": {
    draw(g) {
      rect(g, 7, g.top + 6, 2, 8, METAL);
      rect(g, 4, g.top + 13, 8, 2, DARKER);
      outline(g, 3, g.top + 2, 10, 6);
      bevel(g, 4, g.top + 3, 8, 4, "#2b2c38");
      rect(g, 5, g.top + 4, 6, 1, alpha(NEON.ciano!, 0.8));
    },
  },
  "server-rack": {
    tall: 1,
    draw(g) {
      const n = pick({ azul: "#3f8fe0", verde: "#4dff7a" }, g.variant);
      tallBox(g, "#2b2c38", (x, y, w, h) => {
        for (let ry = y + 1; ry < y + h - 2; ry += 3) {
          rect(g, x + 1, ry, w - 2, 2, "#363745");
          dot(g, x + 2, ry, n);
          dot(g, x + 4, ry, (ry * 7) % 3 === 0 ? "#ffa52e" : n);
        }
      });
    },
  },

  // Decoration
  "plant-small": { draw: (g) => plant(g, false) },
  "plant-tall": { tall: 1, draw: (g) => plant(g, true) },
  "plant-hanging": {
    draw(g) {
      rect(g, 7, 1, 2, 3, "#5a3d22");
      pot(g, 4, 4, 8, 4, TERRACOTTA);
      for (let i = 0; i < 4; i++) {
        rect(g, 3 + i * 3, 8, 1, 4 + (i % 2) * 2, LEAF);
        dot(g, 3 + i * 3, 12 + (i % 2) * 2, LEAF_HI);
      }
    },
  },
  painting: {
    draw(g) {
      const motifs: Record<string, (x: number, y: number, w: number, h: number) => void> = {
        paisagem: sky(g, false, false),
        abstrato: (x, y, w, h) => {
          rect(g, x, y, w, h, "#f0c25a");
          rect(g, x + 1, y + 1, 3, 3, "#d2473f");
          rect(g, x + w - 4, y + h - 4, 3, 3, "#3f6fd6");
          rect(g, x + 2, y + h - 3, w - 4, 1, OUTLINE);
        },
        retrato: (x, y, w, h) => {
          rect(g, x, y, w, h, "#9bb0c9");
          disc(g, x + Math.floor(w / 2), y + 3, 2, "#f1c7a5");
          rect(g, x + Math.floor(w / 2) - 3, y + 6, 6, h - 6, "#3f3a5a");
        },
        mar: (x, y, w, h) => {
          rect(g, x, y, w, h, "#8fd0f5");
          rect(g, x, y + Math.floor(h / 2), w, h - Math.floor(h / 2), "#2d6fb3");
          rect(g, x + 1, y + Math.floor(h / 2) + 1, 3, 1, WHITE);
        },
      };
      wallFrame(g, pick(WOOD, "escuro"), motifs[g.variant ?? "paisagem"] ?? motifs.paisagem!);
    },
  },
  "painting-wide": {
    draw(g) {
      const motifs: Record<string, (x: number, y: number, w: number, h: number) => void> = {
        paisagem: sky(g, false, false),
        abstrato: (x, y, w, h) => {
          rect(g, x, y, w, h, "#2f2a44");
          for (let i = 0; i < 5; i++) rect(g, x + 2 + i * 5, y + 1 + (i % 3), 3, h - 2 - (i % 3), ["#d2473f", "#f0c25a", "#3faa6a", "#3f6fd6", "#ff6fb0"][i]!);
        },
        cidade: sky(g, true, true),
      };
      wallFrame(g, "#1d1d26", motifs[g.variant ?? "paisagem"] ?? motifs.paisagem!);
    },
  },
  poster: {
    draw(g) {
      const motif = g.variant ?? "gamer";
      const bg: Record<string, string> = { gamer: "#1f1b3a", retro: "#f0c25a", espaço: "#0d1030", banda: "#2a2a2a", mapa: "#e6dcc0" };
      const c = bg[motif] ?? bg.gamer!;
      rect(g, 3, 2, T - 6, T - 4, c);
      outline(g, 3, 2, T - 6, T - 4, shade(c, -0.4));
      if (motif === "gamer") {
        rect(g, 5, 5, 6, 4, "#4dff7a");
        rect(g, 6, 10, 4, 2, "#ff3fd0");
      } else if (motif === "retro") {
        for (let i = 0; i < 4; i++) rect(g, 4, 4 + i * 2, T - 8, 1, ["#d2473f", "#3f6fd6", "#3faa6a", "#2a2a2a"][i]!);
      } else if (motif === "espaço") {
        dot(g, 5, 4, WHITE);
        dot(g, 10, 6, WHITE);
        dot(g, 7, 10, WHITE);
        disc(g, 9, 9, 2, "#ffa52e");
      } else if (motif === "banda") {
        rect(g, 5, 4, 6, 6, "#e8e8ec");
        rect(g, 6, 11, 4, 1, "#d2473f");
      } else {
        rect(g, 5, 5, 3, 3, "#3faa6a");
        rect(g, 9, 4, 2, 5, "#3faa6a");
        rect(g, 5, 9, 6, 1, "#3f6fd6");
      }
      dot(g, 4, 3, METAL);
      dot(g, T - 5, 3, METAL);
    },
  },
  window: {
    draw(g) {
      wallFrame(g, "#dfe3ea", sky(g, g.variant === "noite", g.variant === "cidade"));
    },
  },
  "window-wide": {
    draw(g) {
      wallFrame(g, "#dfe3ea", sky(g, g.variant === "noite", g.variant === "cidade"));
      rect(g, Math.floor(g.W / 2), 3, 1, T - 7, "#dfe3ea");
    },
  },
  curtain: {
    draw(g) {
      const c = pick(FABRIC, g.variant);
      wallFrame(g, "#dfe3ea", sky(g, false, false));
      rect(g, 1, 1, g.W - 2, 2, shade(c, -0.3));
      for (const x of [2, g.W - 7]) {
        rect(g, x, 3, 5, T - 5, c);
        rect(g, x + 1, 3, 1, T - 5, shade(c, 0.2));
        rect(g, x + 3, 3, 1, T - 5, shade(c, -0.2));
      }
    },
  },
  clock: {
    draw(g) {
      disc(g, 8, 7, 6, OUTLINE);
      disc(g, 8, 7, 5, WHITE);
      for (const [dx, dy] of [[0, -3], [3, 0], [0, 3], [-3, 0]] as const) dot(g, 8 + dx, 7 + dy, DARKER);
      rect(g, 8, 5, 1, 3, DARKER);
      rect(g, 8, 7, 3, 1, "#d2473f");
    },
  },
  whiteboard: {
    draw(g) {
      outline(g, 1, 2, g.W - 2, T - 5, METAL);
      rect(g, 2, 3, g.W - 4, T - 7, WHITE);
      rect(g, 4, 5, g.W - 10, 1, "#3f6fd6");
      rect(g, 4, 7, g.W - 14, 1, "#d2473f");
      rect(g, 4, 9, g.W - 8, 1, "#2a2a2a");
      rect(g, 3, T - 4, g.W - 6, 1, shade(METAL, -0.2));
    },
  },
  sign: {
    draw(g) {
      const styles: Record<string, string> = { madeira: WOOD.mel!, neon: "#1d1a2e", metal: "#6f7480" };
      const c = pick(styles, g.variant);
      outline(g, 1, 3, g.W - 2, T - 7);
      bevel(g, 2, 4, g.W - 4, T - 9, c);
      const ink = g.variant === "neon" ? NEON.magenta! : shade(c, -0.5);
      if (g.variant === "neon") glow(g, 4, 6, g.W - 8, 4, ink, 0.4);
      rect(g, 4, 7, g.W - 8, 2, ink);
      rect(g, 6, 10, g.W - 12, 1, ink);
    },
  },
  "trophy-shelf": {
    draw(g) {
      rect(g, 1, 10, g.W - 2, 2, WOOD.escuro!);
      for (let i = 0; i < Math.floor(g.W / 8); i++) {
        const x = 3 + i * 8;
        rect(g, x + 1, 4, 3, 3, "#f0c25a");
        rect(g, x, 3, 5, 1, "#f0c25a");
        rect(g, x + 2, 7, 1, 2, "#b8802f");
        rect(g, x + 1, 9, 3, 1, "#6a4a2e");
      }
    },
  },
  "trash-can": {
    draw(g) {
      const colors: Record<string, string> = { cinza: "#7f8592", azul: "#3b63c4", verde: "#3f9b6a" };
      const c = pick(colors, g.variant);
      outline(g, 5, g.top + 3, 6, T - 4);
      bevel(g, 6, g.top + 4, 4, T - 6, c);
      rect(g, 4, g.top + 2, 8, 2, shade(c, -0.3));
    },
  },
  "box-stack": {
    tall: 1,
    draw(g) {
      const c = "#c69a5d";
      block(g, 2, g.top + 4, 12, 4, 8, c);
      block(g, 4, g.top - 5, 9, 4, 6, shade(c, 0.08));
      rect(g, 5, g.top + 8, 6, 1, shade(c, -0.5));
    },
  },
  "vending-machine": {
    tall: 1,
    draw(g) {
      const colors: Record<string, string> = { azul: "#3b63c4", vermelho: "#c9403a" };
      const c = pick(colors, g.variant);
      tallBox(g, c, (x, y, w, h) => {
        glow(g, x + 1, y + 1, w - 4, h - 7, "#ffffff", 0.15);
        rect(g, x + 1, y + 1, w - 4, h - 7, "#20222e");
        for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) dot(g, x + 2 + i * 3, y + 2 + r * 3, ["#ffe08a", "#ff5d5d", "#4dff7a"][(r + i) % 3]!);
        rect(g, x + w - 3, y + 2, 2, h - 8, shade(c, -0.3));
        rect(g, x + 1, y + h - 4, w - 2, 2, DARKER);
      });
    },
  },
  "water-cooler": {
    tall: 1,
    draw(g) {
      outline(g, 4, g.top + 2, 8, T - 3);
      bevel(g, 5, g.top + 3, 6, T - 5, "#dfe3ea");
      outline(g, 5, g.top - 6, 6, 9);
      rect(g, 6, g.top - 5, 4, 7, alpha("#6fd3ff", 0.8));
      rect(g, 6, g.top - 5, 4, 2, alpha(WHITE, 0.6));
      dot(g, 7, g.top + 6, "#3f6fd6");
      dot(g, 8, g.top + 6, "#d2473f");
    },
  },
  fridge: {
    tall: 1,
    draw(g) {
      const colors: Record<string, string> = { branco: "#e8e8ec", preto: "#30313b", vermelho: "#c9403a" };
      const c = pick(colors, g.variant);
      tallBox(g, c, (x, y, w, h) => {
        rect(g, x, y + Math.floor(h / 3), w, 1, shade(c, -0.35));
        rect(g, x + w - 3, y + 2, 1, Math.floor(h / 3) - 3, METAL);
        rect(g, x + w - 3, y + Math.floor(h / 3) + 2, 1, h - Math.floor(h / 3) - 4, METAL);
      });
    },
  },
  "bar-cart": {
    draw(g) {
      block(g, 2, g.top + 2, 12, 3, 4, "#b8802f");
      rect(g, 3, g.top + 9, 10, 1, METAL);
      for (const x of [3, 12]) rect(g, x, g.top + 5, 1, 8, METAL);
      for (const x of [4, 12]) dot(g, x, g.top + 13, DARKER);
      rect(g, 4, g.top, 2, 3, "#4fa36f");
      rect(g, 7, g.top - 1, 2, 4, "#d2a63f");
      rect(g, 10, g.top + 1, 2, 2, WHITE);
    },
  },
  "punching-bag": {
    tall: 1,
    draw(g) {
      rect(g, 7, g.top - 8, 2, 4, METAL);
      outline(g, 4, g.top - 4, 8, T + 2);
      bevel(g, 5, g.top - 3, 6, T, "#c9403a");
      rect(g, 5, g.top + 2, 6, 1, shade("#c9403a", -0.3));
      rect(g, 5, g.top + 8, 6, 1, shade("#c9403a", -0.3));
    },
  },

  // Lighting
  "floor-lamp": {
    tall: 1,
    draw(g) {
      const colors: Record<string, string> = { preto: "#30313b", dourado: "#c9a24a", branco: "#e8e8ec" };
      const c = pick(colors, g.variant);
      glow(g, 2, g.top - 10, 12, 8, "#ffe8a3", 0.3);
      rect(g, 7, g.top - 4, 2, T + 1, c);
      rect(g, 4, g.top + T - 3, 8, 2, c);
      outline(g, 3, g.top - 10, 10, 6);
      bevel(g, 4, g.top - 9, 8, 4, "#f6ecc8");
    },
  },
  "led-pillar": {
    tall: 1,
    draw(g) {
      const n = pick(NEON, g.variant);
      glow(g, 4, g.top - 10, 8, T + 8, n, 0.25);
      outline(g, 6, g.top - 9, 4, T + 7);
      rect(g, 7, g.top - 8, 2, T + 5, n);
      rect(g, 7, g.top - 8, 1, T + 5, shade(n, 0.5));
      rect(g, 4, g.top + T - 3, 8, 2, DARKER);
    },
  },
  "neon-strip": {
    draw(g) {
      const n = pick(NEON, g.variant);
      glow(g, 1, 6, g.W - 2, 3, n, 0.45);
      rect(g, 1, 7, g.W - 2, 1, n);
      rect(g, 1, 7, g.W - 2, 1, alpha(WHITE, 0.4));
    },
  },
  "neon-sign": {
    draw(g) {
      const words: Record<string, string> = { gg: NEON.verde!, live: NEON.magenta!, play: NEON.ciano!, coracao: "#ff5d8a" };
      const n = pick(words, g.variant);
      glow(g, 2, 3, g.W - 4, T - 6, n, 0.4);
      const glyph = (x: number, y: number) => {
        rect(g, x, y, 4, 1, n);
        rect(g, x, y, 1, 5, n);
        rect(g, x, y + 4, 4, 1, n);
        rect(g, x + 3, y + 2, 1, 3, n);
        rect(g, x + 2, y + 2, 2, 1, n);
      };
      if (g.variant === "coracao") {
        disc(g, Math.floor(g.W / 2) - 3, 6, 3, n);
        disc(g, Math.floor(g.W / 2) + 3, 6, 3, n);
        rect(g, Math.floor(g.W / 2) - 5, 8, 10, 2, n);
        rect(g, Math.floor(g.W / 2) - 3, 10, 6, 2, n);
        rect(g, Math.floor(g.W / 2) - 1, 12, 2, 1, n);
      } else {
        glyph(Math.floor(g.W / 2) - 7, 5);
        glyph(Math.floor(g.W / 2) + 1, 5);
      }
      rect(g, 1, T - 3, g.W - 2, 1, alpha(n, 0.3));
    },
  },
  "ceiling-lamp": { draw: (g) => ceilingLight(g, g.variant === "frio" ? "#cfe9ff" : "#ffe3a3", true) },
  spotlight: { draw: (g) => ceilingLight(g, pick(NEON, g.variant), false) },

  // Equipment
  "camera-tripod": {
    tall: 1,
    draw(g) {
      const y0 = g.top;
      for (const [dx, dy] of [[-3, 0], [3, 0], [0, 1]] as const) rect(g, 8 + dx, y0 + 7 + dy, 1, 7, METAL);
      rect(g, 7, y0 + 1, 2, 7, METAL);
      const left = g.rot === 1 || g.rot === 2;
      outline(g, left ? 3 : 7, y0 - 5, 7, 6);
      bevel(g, left ? 4 : 8, y0 - 4, 5, 4, "#2b2c38");
      dot(g, left ? 4 : 11, y0 - 2, "#ff5d5d");
      rect(g, left ? 10 : 5, y0 - 3, 2, 2, DARKER);
    },
  },
  "ring-light": {
    tall: 1,
    draw(g) {
      glow(g, 2, g.top - 8, 12, 12, "#fff3c4", 0.35);
      disc(g, 8, g.top - 2, 5, "#f6ecc8");
      disc(g, 8, g.top - 2, 3, alpha(DARKER, 0.35));
      rect(g, 7, g.top + 3, 2, 9, METAL);
      rect(g, 4, g.top + 12, 8, 2, DARKER);
    },
  },
  mixer: {
    draw(g) {
      block(g, 1, g.top + 2, g.W - 2, T - 8, 4, "#2b2c38");
      for (let x = 3; x < g.W - 3; x += 4) {
        rect(g, x, g.top + 4, 1, 6, METAL);
        dot(g, x, g.top + 5 + (x % 5), "#ffa52e");
        dot(g, x + 1, g.top + 3, "#4dff7a");
      }
    },
  },
  "projector-screen": {
    draw(g) {
      rect(g, 1, 1, g.W - 2, 2, DARKER);
      outline(g, 2, 3, g.W - 4, T - 5, "#c9cdd6");
      rect(g, 3, 4, g.W - 6, T - 7, WHITE);
      rect(g, 4, 5, g.W - 8, 1, alpha("#3b86d9", 0.5));
    },
  },
  podium: {
    tall: 1,
    draw(g) {
      const c = pick(WOOD, g.variant);
      block(g, 3, g.top - 4, 10, 4, T + 1, c);
      rect(g, 4, g.top - 3, 8, 1, shade(c, 0.35));
      if (g.rot === 0) rect(g, 6, g.top + 3, 4, 5, shade(c, -0.25));
    },
  },
  "drum-kit": {
    draw(g) {
      const y0 = g.top;
      disc(g, 16, y0 + 20, 8, OUTLINE);
      disc(g, 16, y0 + 20, 7, "#c9403a");
      disc(g, 16, y0 + 20, 4, "#e8e8ec");
      disc(g, 8, y0 + 10, 5, OUTLINE);
      disc(g, 8, y0 + 10, 4, "#e8e8ec");
      disc(g, 24, y0 + 10, 5, OUTLINE);
      disc(g, 24, y0 + 10, 4, "#e8e8ec");
      disc(g, 5, y0 + 4, 4, "#d9b560");
      disc(g, 27, y0 + 4, 4, "#d9b560");
      rect(g, 5, y0 + 4, 1, 10, METAL);
      rect(g, 27, y0 + 4, 1, 10, METAL);
    },
  },
  "guitar-stand": {
    tall: 1,
    draw(g) {
      const colors: Record<string, string> = { vermelho: "#c9403a", preto: "#2b2c38", sunburst: "#d9892f" };
      const c = pick(colors, g.variant);
      rect(g, 7, g.top - 8, 2, 6, "#5a3d22");
      rect(g, 6, g.top - 10, 4, 2, DARKER);
      disc(g, 8, g.top + 2, 4, OUTLINE);
      disc(g, 8, g.top + 2, 3, c);
      disc(g, 8, g.top + 8, 5, OUTLINE);
      disc(g, 8, g.top + 8, 4, c);
      rect(g, 8, g.top - 2, 1, 10, "#5a3d22");
      rect(g, 4, g.top + 13, 8, 1, METAL);
    },
  },

  // Special
  "portal-pad": {
    draw(g) {
      const n = pick(NEON, g.variant);
      disc(g, 8, g.top + 8, 7, alpha(n, 0.2));
      disc(g, 8, g.top + 8, 6, OUTLINE);
      disc(g, 8, g.top + 8, 5, alpha(n, 0.9));
      disc(g, 8, g.top + 8, 3, shade(n, -0.4));
      disc(g, 8, g.top + 8, 1, WHITE);
    },
  },
  "info-totem": {
    tall: 1,
    draw(g) {
      outline(g, 5, g.top - 8, 6, T + 6);
      bevel(g, 6, g.top - 7, 4, T + 4, "#3f6fd6");
      rect(g, 7, g.top - 5, 2, 1, WHITE);
      rect(g, 7, g.top - 3, 2, 5, WHITE);
      rect(g, 3, g.top + T - 3, 10, 2, DARKER);
    },
  },
  "photo-frame": {
    tall: 1,
    draw(g) {
      const c = pick(WOOD, g.variant);
      outline(g, 3, g.top - 6, 10, 10);
      rect(g, 4, g.top - 5, 8, 8, c);
      sky(g, false, false)(5, g.top - 4, 6, 6);
      rect(g, 6, g.top + 4, 4, 9, shade(c, -0.3));
      rect(g, 4, g.top + 12, 8, 2, DARKER);
    },
  },
  kiosk: {
    tall: 1,
    draw(g) {
      outline(g, 3, g.top - 8, 10, T + 6);
      bevel(g, 4, g.top - 7, 8, T + 4, "#30313b");
      glow(g, 5, g.top - 6, 6, 7, "#6fd3ff", 0.3);
      screen(g, 5, g.top - 6, 6, 7, "#3b86d9");
      rect(g, 6, g.top + 3, 4, 1, METAL);
    },
  },
  fountain: {
    draw(g) {
      const cx = 16;
      const cy = g.top + 16;
      disc(g, cx, cy, 15, OUTLINE);
      disc(g, cx, cy, 14, "#9aa3b2");
      disc(g, cx, cy, 11, "#3b86d9");
      disc(g, cx - 2, cy - 2, 7, "#6fd3ff");
      disc(g, cx, cy, 4, OUTLINE);
      disc(g, cx, cy, 3, "#9aa3b2");
      rect(g, cx - 1, cy - 8, 2, 6, alpha(WHITE, 0.8));
      dot(g, cx - 4, cy - 6, WHITE);
      dot(g, cx + 3, cy - 7, WHITE);
    },
  },
  statue: {
    tall: 1,
    draw(g) {
      const colors: Record<string, string> = { mármore: "#e6e3dc", bronze: "#9a6b3f", ouro: "#d9b560" };
      const c = pick(colors, g.variant);
      block(g, 3, g.top + 7, 10, 3, 6, shade(c, -0.1));
      disc(g, 8, g.top - 6, 3, OUTLINE);
      disc(g, 8, g.top - 6, 2, c);
      rect(g, 5, g.top - 3, 6, 10, OUTLINE);
      rect(g, 6, g.top - 2, 4, 9, c);
      rect(g, 6, g.top - 2, 1, 9, shade(c, 0.25));
    },
  },
};

/** Fallback for an id without art yet: a labelled crate, so the editor still works. */
export const FALLBACK_ART: ArtDef = {
  draw(g) {
    block(g, 0, g.top, g.W, 4, g.H - g.top - 4, "#8a6a3f");
    rect(g, 2, g.top + 6, g.W - 4, 1, OUTLINE);
    rect(g, 2, g.top + 9, g.W - 4, 1, OUTLINE);
  },
};

export function artOf(itemId: string): ArtDef {
  return ART[itemId] ?? FALLBACK_ART;
}
