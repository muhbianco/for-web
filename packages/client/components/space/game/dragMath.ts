/**
 * A conta das janelas arrastáveis do jogo (25/11/2026, pedido do dono): o deslocamento da janela
 * a partir do lugar dela (centro do diálogo, canto da corrida), preso à área do mapa, e a posição
 * guardada por janela no aparelho. Puro (sem DOM): roda nos testes do node.
 */

export interface Offset {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Folga entre a janela e a borda da área (a moldura não encosta na borda). */
export const EDGE = 4;
/** Passo das setas do teclado (com Shift, maior). */
export const STEP = 16;
export const BIG_STEP = 64;

const clamp = (v: number, min: number, max: number) =>
  max < min ? min : Math.max(min, Math.min(max, v));

/**
 * O deslocamento que mantém a janela inteira dentro da área. `natural` é onde a janela fica sem
 * deslocamento. Janela maior que a área: fica presa pelo canto de cima à esquerda (a barra do
 * título, onde está a alça, nunca sai da tela).
 */
export function clampOffset(
  off: Offset,
  natural: Box,
  bounds: Box,
  edge = EDGE,
): Offset {
  return {
    x: clamp(
      off.x,
      bounds.left + edge - natural.left,
      bounds.right - edge - natural.right,
    ),
    y: clamp(
      off.y,
      bounds.top + edge - natural.top,
      bounds.bottom - edge - natural.bottom,
    ),
  };
}

/** A seta do teclado vira um passo (null: não é seta). */
export function keyStep(key: string, shift: boolean): Offset | null {
  const s = shift ? BIG_STEP : STEP;
  switch (key) {
    case "ArrowLeft":
      return { x: -s, y: 0 };
    case "ArrowRight":
      return { x: s, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -s };
    case "ArrowDown":
      return { x: 0, y: s };
    default:
      return null;
  }
}

const KEY = (id: string) => `muchat:janela:${id}`;

/** Onde a pessoa deixou esta janela neste aparelho (null: nunca mexeu, ou o armazenamento falhou). */
export function loadOffset(
  id: string,
  store: Pick<Storage, "getItem"> | null = safeStore(),
): Offset | null {
  try {
    const raw = store?.getItem(KEY(id));
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Offset>;
    return Number.isFinite(o.x) && Number.isFinite(o.y)
      ? { x: o.x!, y: o.y! }
      : null;
  } catch {
    return null;
  }
}

export function saveOffset(
  id: string,
  off: Offset,
  store: Pick<Storage, "setItem" | "removeItem"> | null = safeStore(),
): void {
  try {
    if (off.x === 0 && off.y === 0) store?.removeItem(KEY(id));
    else
      store?.setItem(
        KEY(id),
        JSON.stringify({ x: Math.round(off.x), y: Math.round(off.y) }),
      );
  } catch {
    // Sem armazenamento (aba anônima, cota): a janela só não lembra o lugar.
  }
}

function safeStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
