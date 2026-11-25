/**
 * Onde abre o detalhe de um item ao parar o mouse (25/11/2026, pedido do dono): ao lado do item,
 * nunca em cima dele, e sempre inteiro na tela. Puro (sem DOM): roda nos testes do node.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  w: number;
  h: number;
}

export type TipSide = "right" | "left" | "below" | "above";

export interface TipPlace {
  left: number;
  top: number;
  side: TipSide;
  /** Altura máxima do detalhe (quando não cabe inteiro, corta embaixo). */
  maxHeight: number;
}

/** Distância entre o item e o detalhe; folga do detalhe até a borda da tela. */
export const TIP_GAP = 8;
export const TIP_MARGIN = 8;

const clamp = (v: number, min: number, max: number) =>
  max < min ? min : Math.max(min, Math.min(max, v));

/**
 * À direita do item; sem espaço, à esquerda; sem espaço dos lados (celular), embaixo ou em cima,
 * onde couber (ou onde houver mais espaço, cortando a altura). Nos lados, o topo acompanha o item
 * e desce/sobe só o necessário para caber.
 */
export function placeTip(
  anchor: Rect,
  tip: Size,
  view: Size,
  gap = TIP_GAP,
  margin = TIP_MARGIN,
): TipPlace {
  const fullH = Math.max(0, view.h - 2 * margin);
  const sideTop = () => ({
    top: clamp(anchor.top, margin, view.h - margin - tip.h),
    maxHeight: fullH,
  });
  if (anchor.right + gap + tip.w <= view.w - margin) {
    return { left: anchor.right + gap, side: "right", ...sideTop() };
  }
  if (anchor.left - gap - tip.w >= margin) {
    return { left: anchor.left - gap - tip.w, side: "left", ...sideTop() };
  }
  const below = view.h - margin - (anchor.bottom + gap);
  const above = anchor.top - gap - margin;
  const left = clamp(
    (anchor.left + anchor.right) / 2 - tip.w / 2,
    margin,
    view.w - margin - tip.w,
  );
  const side: TipSide =
    tip.h <= below
      ? "below"
      : tip.h <= above
        ? "above"
        : below >= above
          ? "below"
          : "above";
  const room = Math.max(0, side === "below" ? below : above);
  const h = Math.min(tip.h, room);
  return {
    left,
    top: side === "below" ? anchor.bottom + gap : anchor.top - gap - h,
    side,
    maxHeight: room,
  };
}
