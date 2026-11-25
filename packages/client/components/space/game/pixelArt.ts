import type { ItemVisual, Material } from "@muchat/space-core/game/ot/balance";

/**
 * Ícones dos itens em pixel art 32×32 (spec §9.7), desenhados em código a partir do descritor do
 * núcleo (`itemVisual`): silhueta por família/peça, 4 tons por material, contorno escuro de 1 px.
 * Cada silhueta é uma lista de formas simples num quadro de 32; elas viram uma máscara por "parte"
 * (metal, madeira, couro, tecido, gema...), e a luz vem de cima à esquerda: borda de cima/esquerda
 * no tom claro, de baixo/direita nos escuros. O contorno é calculado, nunca desenhado à mão, para
 * todos os ícones terem o mesmo traço. Puro (sem DOM): a tela pinta a grade num canvas.
 */

export const ICON = 32;

type Part = "metal" | "wood" | "leather" | "cloth" | "gem" | "string" | "dark";

type Shape =
  | { k: "line"; a: [number, number]; b: [number, number]; w: number; p: Part }
  | { k: "rect"; x: number; y: number; w: number; h: number; p: Part }
  | { k: "circle"; c: [number, number]; r: number; p: Part }
  | { k: "ring"; c: [number, number]; r0: number; r1: number; p: Part }
  | {
      k: "arc";
      c: [number, number];
      r: number;
      w: number;
      from: number;
      to: number;
      p: Part;
    }
  | { k: "poly"; pts: [number, number][]; p: Part }
  | { k: "erase"; x: number; y: number; w: number; h: number };

const line = (
  a: [number, number],
  b: [number, number],
  w: number,
  p: Part,
): Shape => ({ k: "line", a, b, w, p });
const rect = (x: number, y: number, w: number, h: number, p: Part): Shape => ({
  k: "rect",
  x,
  y,
  w,
  h,
  p,
});
const circle = (c: [number, number], r: number, p: Part): Shape => ({
  k: "circle",
  c,
  r,
  p,
});
const poly = (pts: [number, number][], p: Part): Shape => ({
  k: "poly",
  pts,
  p,
});

/** Tecido, couro ou metal: o peso da armadura muda a matéria da peça. */
const WEIGHT_PART: Record<string, Part> = {
  leve: "cloth",
  media: "leather",
  pesada: "metal",
};

function armor(slot: string, weight: string): Shape[] {
  const p = WEIGHT_PART[weight] ?? "leather";
  switch (slot) {
    case "elmo":
      if (weight === "pesada")
        return [
          circle([16, 15], 11, "metal"),
          { k: "erase", x: 0, y: 24, w: 32, h: 8 },
          rect(6, 15, 4, 9, "metal"),
          rect(22, 15, 4, 9, "metal"),
          rect(9, 14, 14, 2, "dark"),
          rect(15, 14, 2, 8, "metal"),
          circle([16, 5], 1.6, "gem"),
        ];
      if (weight === "media")
        return [
          circle([16, 17], 10, "leather"),
          { k: "erase", x: 0, y: 21, w: 32, h: 11 },
          rect(4, 19, 24, 3, "leather"),
          rect(7, 13, 18, 1.5, "metal"),
          circle([16, 9], 1.6, "metal"),
        ];
      return [
        poly(
          [
            [16, 3],
            [26, 10],
            [28, 27],
            [20, 28],
            [20, 19],
            [12, 19],
            [12, 28],
            [4, 27],
            [6, 10],
          ],
          "cloth",
        ),
        { k: "circle", c: [16, 17], r: 4.6, p: "dark" },
        rect(11, 24, 10, 2, "metal"),
      ];
    case "armadura":
      if (weight === "pesada")
        return [
          poly(
            [
              [9, 5],
              [23, 5],
              [25, 12],
              [24, 27],
              [16, 29],
              [8, 27],
              [7, 12],
            ],
            "metal",
          ),
          circle([7, 9], 4.4, "metal"),
          circle([25, 9], 4.4, "metal"),
          rect(15.5, 8, 1, 18, "dark"),
          rect(10, 18, 12, 1.2, "dark"),
        ];
      if (weight === "media")
        return [
          poly(
            [
              [10, 4],
              [22, 4],
              [26, 9],
              [24, 13],
              [24, 28],
              [8, 28],
              [8, 13],
              [6, 9],
            ],
            "leather",
          ),
          rect(8, 20, 16, 2.4, "dark"),
          rect(14.5, 19.6, 3, 3.2, "metal"),
          line([12, 6], [16, 12], 1.2, "dark"),
          line([20, 6], [16, 12], 1.2, "dark"),
        ];
      return [
        poly(
          [
            [11, 4],
            [21, 4],
            [26, 10],
            [23, 12],
            [25, 29],
            [7, 29],
            [9, 12],
            [6, 10],
          ],
          "cloth",
        ),
        line([12, 5], [20, 16], 2, "metal"),
        rect(10, 17, 12, 2, "metal"),
      ];
    case "calcas":
      return [
        poly(
          [
            [8, 5],
            [24, 5],
            [25, 28],
            [18, 28],
            [16, 14],
            [14, 28],
            [7, 28],
          ],
          p,
        ),
        rect(8, 4, 16, 3, p === "metal" ? "leather" : "dark"),
        ...(p === "metal"
          ? [rect(9, 16, 5, 2, "dark"), rect(19, 16, 5, 2, "dark")]
          : []),
      ];
    default:
      // Botas.
      return [
        poly(
          [
            [10, 4],
            [19, 4],
            [19, 19],
            [26, 21],
            [28, 26],
            [10, 26],
          ],
          p === "cloth" ? "leather" : p,
        ),
        rect(9, 26, 20, 2.5, "dark"),
        rect(10, 4, 9, 2.5, p === "metal" ? "metal" : "dark"),
      ];
  }
}

/** As silhuetas (§9.7: "silhueta única por família"). */
const SHAPES: Record<string, Shape[]> = {
  espada: [
    line([9, 23], [26, 6], 3.2, "metal"),
    line([27, 5], [28.5, 3.5], 1.6, "metal"),
    line([6, 19], [13, 26], 2.4, "metal"),
    line([8, 24], [5, 27], 2.4, "leather"),
    circle([4, 28], 1.8, "metal"),
  ],
  machado: [
    line([7, 28], [22, 7], 2.4, "wood"),
    poly(
      [
        [16, 5],
        [24, 3],
        [29, 9],
        [27, 17],
        [21, 15],
        [19, 10],
      ],
      "metal",
    ),
    poly(
      [
        [17, 11],
        [12, 9],
        [14, 14],
      ],
      "metal",
    ),
  ],
  lanca: [
    line([4, 29], [21, 11], 2, "wood"),
    line([20, 12], [27, 5], 3.8, "metal"),
    line([27, 5], [29.5, 2.5], 1.6, "metal"),
    circle([19.5, 12.5], 1.8, "dark"),
  ],
  martelo: [
    line([8, 28], [19, 13], 2.4, "wood"),
    poly(
      [
        [13, 10],
        [21, 2],
        [29, 9],
        [21, 17],
      ],
      "metal",
    ),
    line([16, 13], [24, 5], 1, "dark"),
  ],
  maca: [
    line([6, 29], [17, 16], 2.4, "wood"),
    circle([21, 11], 5.6, "metal"),
    line([21, 4], [21, 2], 2, "metal"),
    line([28, 11], [30, 11], 2, "metal"),
    line([26, 6], [27.5, 4.5], 2, "metal"),
    line([16, 6], [14.5, 4.5], 2, "metal"),
    line([26, 16], [27.5, 17.5], 2, "metal"),
    circle([4.5, 30], 1.6, "metal"),
  ],
  adaga: [
    line([12, 20], [24, 8], 2.8, "metal"),
    line([24, 8], [26, 6], 1.4, "metal"),
    line([9, 17], [15, 23], 2, "metal"),
    line([11, 21], [7, 25], 2.4, "leather"),
    circle([6, 26], 1.6, "metal"),
  ],
  katar: [
    poly(
      [
        [16, 2],
        [21, 14],
        [11, 14],
      ],
      "metal",
    ),
    rect(9, 14, 14, 3, "metal"),
    rect(9, 17, 2.5, 11, "metal"),
    rect(20.5, 17, 2.5, 11, "metal"),
    rect(11.5, 21, 9, 2.5, "leather"),
    rect(9, 27, 14, 2.5, "metal"),
    line([16, 4], [16, 12], 1, "dark"),
  ],
  arco: [
    {
      k: "arc",
      c: [5, 16],
      r: 14,
      w: 2.8,
      from: -1.25,
      to: 1.25,
      p: "wood",
    },
    line([10.5, 3], [10.5, 29], 1, "string"),
    rect(17, 13.5, 2.6, 5, "leather"),
    circle([10.5, 3], 1.4, "metal"),
    circle([10.5, 29], 1.4, "metal"),
  ],
  besta: [
    line([4, 26], [22, 13], 3.2, "wood"),
    line([16, 4], [28, 21], 2.2, "metal"),
    line([16, 4], [19, 16], 0.9, "string"),
    line([28, 21], [19, 16], 0.9, "string"),
    rect(9, 22, 2.4, 4, "metal"),
  ],
  cajado: [
    line([7, 30], [19, 10], 2.4, "wood"),
    circle([22, 6], 4.2, "gem"),
    line([18, 10], [18, 4], 1.3, "metal"),
    line([18, 10], [25, 10.5], 1.3, "metal"),
  ],
  cetro: [
    line([9, 27], [19, 13], 2, "metal"),
    poly(
      [
        [22, 3],
        [27, 9],
        [22, 15],
        [17, 9],
      ],
      "metal",
    ),
    circle([22, 9], 2.2, "gem"),
    circle([8, 28], 1.8, "metal"),
  ],
  bastao: [
    line([6, 28], [26, 4], 2.8, "wood"),
    line([4, 30], [8, 26], 3.2, "metal"),
    line([24, 6], [28, 2], 3.2, "metal"),
    circle([12, 21], 2, "wood"),
    circle([19, 12.5], 2, "wood"),
  ],
  escudo: [
    poly(
      [
        [5, 4],
        [27, 4],
        [27, 15],
        [16, 29],
        [5, 15],
      ],
      "metal",
    ),
    poly(
      [
        [8, 7],
        [24, 7],
        [24, 15],
        [16, 25],
        [8, 15],
      ],
      "wood",
    ),
    circle([16, 14], 2.6, "metal"),
  ],
  focus: [
    poly(
      [
        [16, 2],
        [23, 12],
        [16, 22],
        [9, 12],
      ],
      "gem",
    ),
    poly(
      [
        [11, 23],
        [21, 23],
        [25, 29],
        [7, 29],
      ],
      "metal",
    ),
    rect(14.5, 21, 3, 3, "metal"),
  ],
  aljava: [
    line([10, 28], [19, 10], 7, "leather"),
    line([18, 9], [22, 2], 1.2, "wood"),
    line([20, 10], [25, 4], 1.2, "wood"),
    poly(
      [
        [21, 1],
        [24, 3],
        [22, 4.5],
      ],
      "cloth",
    ),
    poly(
      [
        [24, 3],
        [27, 5],
        [25, 6.5],
      ],
      "cloth",
    ),
    line([8, 18], [16, 22], 1.6, "metal"),
    line([11, 12], [19, 16], 1.6, "metal"),
  ],
  colar: [
    ...Array.from({ length: 9 }, (_, i): Shape => {
      const a = Math.PI * (0.08 + (0.84 * i) / 8);
      return circle(
        [16 + Math.cos(a) * 10, 6 + Math.sin(a) * 10],
        1.3,
        "metal",
      );
    }),
    circle([16, 22], 4.4, "metal"),
    circle([16, 22], 2.4, "gem"),
  ],
  anel: [
    { k: "ring", c: [16, 19], r0: 5.2, r1: 8.4, p: "metal" },
    poly(
      [
        [12, 11],
        [20, 11],
        [18, 13],
        [14, 13],
      ],
      "metal",
    ),
    circle([16, 8], 3.6, "gem"),
  ],
};

function inside(s: Shape, x: number, y: number): boolean {
  switch (s.k) {
    case "rect":
    case "erase":
      return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
    case "circle":
      return (x - s.c[0]) ** 2 + (y - s.c[1]) ** 2 <= s.r * s.r;
    case "ring": {
      const d = Math.hypot(x - s.c[0], y - s.c[1]);
      return d >= s.r0 && d <= s.r1;
    }
    case "arc": {
      const d = Math.hypot(x - s.c[0], y - s.c[1]);
      const a = Math.atan2(y - s.c[1], x - s.c[0]);
      return Math.abs(d - s.r) <= s.w / 2 && a >= s.from && a <= s.to;
    }
    case "line": {
      const [ax, ay] = s.a;
      const [bx, by] = s.b;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2),
      );
      return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= s.w / 2;
    }
    case "poly": {
      let c = false;
      const p = s.pts;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i]!;
        const [xj, yj] = p[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
          c = !c;
      }
      return c;
    }
  }
}

/** 4 tons (luz, base, sombra, escuro) de cada material da região (§9.7). */
export const MATERIAL_TONES: Record<
  Material,
  [string, string, string, string]
> = {
  Ferro: ["#d3d9de", "#9aa3ab", "#6b737b", "#454b52"],
  Bronze: ["#f2c58a", "#c98a4b", "#93582c", "#5e3518"],
  Aço: ["#eef3f7", "#b9c6d1", "#7f8f9e", "#4f5d6b"],
  Prata: ["#ffffff", "#dfe5ec", "#a9b4c0", "#6f7a86"],
  "Ouro Rúnico": ["#fff2a8", "#f0c23c", "#b6861b", "#74520c"],
  Obsidiana: ["#8b7aa6", "#4d3f63", "#2e2540", "#18121f"],
  "Coral Abissal": ["#ffc2b0", "#ef7a68", "#3f9c9a", "#1f5a5f"],
  "Osso Ancestral": ["#fbf3dc", "#e0d1a8", "#b19f73", "#776947"],
  Celestita: ["#e4f6ff", "#9fd8f5", "#5ea6d0", "#2f6b93"],
  Vazio: ["#d68cff", "#7c3fb3", "#45206b", "#1e0b33"],
};

const FIXED: Record<
  Exclude<Part, "metal">,
  [string, string, string, string]
> = {
  wood: ["#d29a5c", "#9c6a37", "#6c4522", "#432a13"],
  leather: ["#c48a57", "#8e5c38", "#633f25", "#3e2716"],
  cloth: ["#e7dfcf", "#b9ae98", "#867c69", "#565043"],
  gem: ["#d9fbff", "#62d6ea", "#2a8eae", "#155069"],
  string: ["#efe6d2", "#efe6d2", "#c9bea6", "#c9bea6"],
  dark: ["#2b2420", "#2b2420", "#1e1915", "#1e1915"],
};

export const OUTLINE = "#130e0a";

/**
 * A grade 32×32 do ícone: cada célula é uma cor (#rrggbb) ou null (transparente). A silhueta
 * desconhecida cai num quadrado (nunca some da tela).
 */
export function iconPixels(
  visual: Pick<ItemVisual, "silhouette" | "material">,
): (string | null)[] {
  const [slot, weight] = visual.silhouette.split("-");
  const shapes =
    SHAPES[visual.silhouette] ??
    (weight ? armor(slot!, weight) : [rect(8, 8, 16, 16, "metal")]);
  const part: (Part | null)[] = new Array(ICON * ICON).fill(null);
  for (let y = 0; y < ICON; y++)
    for (let x = 0; x < ICON; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      for (const s of shapes)
        if (inside(s, cx, cy))
          part[y * ICON + x] = s.k === "erase" ? null : s.p;
    }
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= ICON || y >= ICON ? null : part[y * ICON + x]!;
  const metal = MATERIAL_TONES[visual.material] ?? MATERIAL_TONES.Ferro;
  const out: (string | null)[] = new Array(ICON * ICON).fill(null);
  for (let y = 0; y < ICON; y++)
    for (let x = 0; x < ICON; x++) {
      const p = at(x, y);
      if (!p) {
        // Contorno de 1 px: vazio colado a algo pintado.
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))
          out[y * ICON + x] = OUTLINE;
        continue;
      }
      const tones = p === "metal" ? metal : FIXED[p];
      const lit = at(x - 1, y) !== p || at(x, y - 1) !== p;
      const right = at(x + 1, y) !== p;
      const below = at(x, y + 1) !== p;
      const tone = right && below ? 3 : right || below ? 2 : lit ? 0 : 1;
      out[y * ICON + x] = tones[tone];
    }
  return out;
}
