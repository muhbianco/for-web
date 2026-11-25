import type { JSX } from "solid-js";

import type { RarityId } from "@muchat/space-core/game/ot/balance";

/**
 * O tema do jogo idle (24/11/2026): escuro com moldura de bronze e dourado. A raiz de cada painel
 * troca as cores do tema do app (as variáveis --md-sys-color-*) por estas: os textos e campos de
 * dentro seguem sozinhos, e o resto do app não muda.
 */
const COLORS = {
  "--md-sys-color-surface": "#0d0c0b",
  "--md-sys-color-surface-container-low": "#14120f",
  "--md-sys-color-surface-container": "#1c1814",
  "--md-sys-color-surface-container-high": "#241f1a",
  "--md-sys-color-surface-container-highest": "#2a241d",
  "--md-sys-color-on-surface": "#f3efe6",
  "--md-sys-color-on-surface-variant": "#c4b8a2",
  "--md-sys-color-outline": "#7a6440",
  "--md-sys-color-outline-variant": "#4a3d2a",
  "--md-sys-color-primary": "#d9b45a",
  "--md-sys-color-on-primary": "#1b140b",
  "--md-sys-color-primary-container": "#4a3a1c",
  "--md-sys-color-on-primary-container": "#ffe7a8",
  "--md-sys-color-secondary-container": "#3a2f20",
  "--md-sys-color-on-secondary-container": "#f0dcae",
  "--md-sys-color-tertiary": "#e0a45a",
  "--md-sys-color-tertiary-container": "#3a2f20",
  "--md-sys-color-on-tertiary-container": "#f0dcae",
  "--md-sys-color-error": "#ff8a7a",
  "color-scheme": "dark",
} as const;

/** A raiz de um painel do jogo (o cartão do diálogo): as cores, a moldura e o fundo. */
export const gameFrame: JSX.CSSProperties = {
  ...COLORS,
  color: "#f3efe6",
  "background-image":
    "linear-gradient(180deg, rgba(36, 31, 25, 0.98), rgba(14, 12, 10, 0.99))",
  "box-shadow":
    "0 0 0 1px rgba(122, 100, 64, 0.6), 0 12px 36px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
};

/** As faixas do jogo no mapa (treino, grupo, corrida): as cores sem o fundo de cartão. */
export const gameChip: JSX.CSSProperties = {
  ...COLORS,
  "box-shadow":
    "0 0 0 1px rgba(122, 100, 64, 0.55), 0 2px 8px rgba(0, 0, 0, 0.4)",
};

/** Melhor e pior na comparação; sempre junto de ▲/▼ (a cor nunca é o único sinal). */
export const GAME_UP = "#7ee08a";
export const GAME_DOWN = "#ff8a7a";

/** Os fundos onde o texto da raridade aparece (o cartão e a célula da mochila). */
export const GAME_BG = ["#1c1814", "#14120f", "#241f1a"] as const;

/**
 * Raridade (§9.4) com cor E forma E rótulo, para quem não distingue as cores: a cor do nome e da
 * moldura (cinza, verde, azul, roxo, laranja, em tons claros que passam 4,5:1 nos fundos do jogo),
 * os marcadores no canto do ícone (nenhum, ◆, ◆◆, ◆◆◆, ★) e o estilo da moldura (fina, grossa,
 * dupla, com cantos, com brilho). O nome da raridade vai escrito no detalhe do item.
 */
export const RARITY: Record<
  RarityId,
  {
    color: string;
    pips: string;
    frame: "fina" | "grossa" | "dupla" | "cantos" | "brilho";
  }
> = {
  comum: { color: "#bdb6aa", pips: "", frame: "fina" },
  incomum: { color: "#74d983", pips: "◆", frame: "grossa" },
  raro: { color: "#79b4ff", pips: "◆◆", frame: "dupla" },
  epico: { color: "#c99bff", pips: "◆◆◆", frame: "cantos" },
  lendario: { color: "#ffa64d", pips: "★", frame: "brilho" },
};

/** Vida, mana, XP, job e Proficiência nas barras (com o número escrito ao lado). */
export const BAR = {
  hp: "#e0574b",
  mp: "#4f8ff0",
  xp: "#d9b45a",
  job: "#9b7bd8",
  prof: "#5fbf8f",
  enemy: "#c8453b",
} as const;

/** Contraste WCAG entre duas cores #rrggbb (para o teste das cores do tema). */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = v.map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    ) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
