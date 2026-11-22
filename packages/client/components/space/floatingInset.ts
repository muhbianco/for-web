/**
 * The room the floating call card (VoiceCallCard in a corner) has to leave
 * for the Espaço's side panel (rooms, decoration, Refúgio). SpacePage's grid
 * puts the panel in a column on the right on wide screens and in a row at the
 * bottom on narrow ones. Pixels from the window's right and bottom edges; 0
 * when no panel is open.
 */
export interface FloatingInset {
  right: number;
  bottom: number;
}

export function floatingInset(o: {
  narrow: boolean;
  /** The side column's width (wide screens); 0 when no panel is open. */
  sideWidthPx: number;
  /** The panel row's share of the page height, in % (narrow screens); 0 when closed. */
  panelRowPct: number;
  /** The page grid, in viewport coordinates. */
  grid: { right: number; bottom: number; height: number };
  viewport: { width: number; height: number };
}): FloatingInset {
  if (o.narrow) {
    if (o.panelRowPct <= 0) return { right: 0, bottom: 0 };
    const below = o.viewport.height - o.grid.bottom;
    return {
      right: 0,
      bottom: Math.max(
        0,
        Math.round(below + (o.grid.height * o.panelRowPct) / 100),
      ),
    };
  }
  if (o.sideWidthPx <= 0) return { right: 0, bottom: 0 };
  const beside = o.viewport.width - o.grid.right;
  return { right: Math.max(0, Math.round(beside + o.sideWidthPx)), bottom: 0 };
}
