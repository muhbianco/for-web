import type { JSX } from "solid-js";

/**
 * O tema do jogo idle fora da corrida (24/11/2026, "aproveitando que mudamos o visual da corrida,
 * vamos melhorar o visual out-game"): o mesmo escuro com moldura de bronze e dourado da tela da
 * dungeon (RunPanel/RunHud). Em vez de reescrever cada painel, a raiz de cada um troca as cores
 * do tema do app (as variáveis --md-sys-color-*) por estas: os botões, as abas, os campos e os
 * textos de dentro seguem sozinhos, e o resto do app não muda.
 */
const COLORS = {
  "--md-sys-color-surface": "#0d0c0b",
  "--md-sys-color-surface-container-low": "#14120f",
  "--md-sys-color-surface-container": "#1c1814",
  "--md-sys-color-surface-container-high": "#14120f",
  "--md-sys-color-surface-container-highest": "#2a241d",
  "--md-sys-color-on-surface": "#f3efe6",
  "--md-sys-color-on-surface-variant": "#b9ad97",
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

/** As cores de comparação (melhor, pior) e de raridade dos itens. */
export const GAME_UP = "#7ee08a";
export const GAME_DOWN = "#ff8a7a";
